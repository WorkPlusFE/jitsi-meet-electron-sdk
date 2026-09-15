/* global process */

const crypto = require('crypto');
const electron = require('electron');
const { BrowserWindow, ipcMain } = electron;

const { EVENTS, STATES, AOT_WINDOW_NAME, EVENTS_CHANNEL } = require('../constants');
const {
    getPosition,
    getSize,
    logError,
    logInfo,
    resetSize,
    savePosition,
    setAspectRatioToResizeableWindow,
    setLogger,
    windowExists
} = require('./utils');
const aotConfig = require('./config');

/**
 * Token for matching window open requests.
 */
let aotMagic;

/**
 * The main window instance
 */
let mainWindow;

/**
 * Whether the meeting is currently in view.
 */
let isIntersecting;

/**
 * Pre-existing window open handler.
 * Ideally electron would expose something like BrowserWindow.webContents.getWindowOpenHandler
 */
let _existingWindowOpenHandler;

let frameBridgeEnabled = false;
let framePumpTimer;
let framePumpBusy = false;

const FRAME_INTERVAL = 160;
const MIN_FRAME_BRIDGE_ELECTRON_MAJOR = 39;

/**
 * The aot window instance
 */
const getAotWindow = () => BrowserWindow.getAllWindows().find(win => {
    if (!win || win.isDestroyed() || win.webContents.isCrashed()) return false;
    const frameName = win.webContents.mainFrame.name || '';
    return frameName === `${AOT_WINDOW_NAME}-${aotMagic}`;
});

const FRAME_SCRIPT = `(() => {
    const video = document.getElementById('largeVideo');
    const style = video && getComputedStyle(video);
    const hasVideo = Boolean(video
        && video.readyState >= 2
        && video.videoWidth
        && video.videoHeight
        && style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity || 1) !== 0);

    if (!hasVideo) {
        return { dataUrl: null, hasVideo: false };
    }

    const width = 640;
    const height = 360;
    let canvas = window.__electronAotCanvas;

    if (!canvas) {
        canvas = document.createElement('canvas');
        window.__electronAotCanvas = canvas;
    }

    canvas.width = width;
    canvas.height = height;

    const sourceRatio = video.videoWidth / video.videoHeight;
    const targetRatio = width / height;
    let sx = 0;
    let sy = 0;
    let sw = video.videoWidth;
    let sh = video.videoHeight;

    if (sourceRatio > targetRatio) {
        sw = video.videoHeight * targetRatio;
        sx = (video.videoWidth - sw) / 2;
    } else if (sourceRatio < targetRatio) {
        sh = video.videoWidth / targetRatio;
        sy = (video.videoHeight - sh) / 2;
    }

    const context = canvas.getContext('2d', { alpha: false });

    context.fillStyle = '#000';
    context.fillRect(0, 0, width, height);
    context.drawImage(video, sx, sy, sw, sh, 0, 0, width, height);

    return {
        dataUrl: canvas.toDataURL('image/jpeg', 0.72),
        hasVideo: true
    };
})()`;

const getElectronMajor = () => Number.parseInt(process.versions.electron, 10);

const supportsFrameBridge = () => {
    const mainFrame = mainWindow && mainWindow.webContents.mainFrame;

    return getElectronMajor() >= MIN_FRAME_BRIDGE_ELECTRON_MAJOR
        && mainFrame
        && Array.isArray(mainFrame.frames);
};

const getJitsiFrame = () => {
    if (!supportsFrameBridge() || mainWindow.isDestroyed()) return undefined;

    return mainWindow.webContents.mainFrame.frames.find(frame =>
        frame.name && frame.name.startsWith('jitsiConferenceFrame'));
};

const pushVideoFrame = async () => {
    if (!frameBridgeEnabled || framePumpBusy) return;

    const aotWindow = getAotWindow();
    const jitsiFrame = getJitsiFrame();

    if (!windowExists(aotWindow) || !jitsiFrame) return;

    framePumpBusy = true;

    try {
        const frame = await jitsiFrame.executeJavaScript(FRAME_SCRIPT);

        if (frame && windowExists(aotWindow)) {
            await aotWindow.webContents.executeJavaScript(
                `window.__setAotFrame && window.__setAotFrame(${JSON.stringify(frame)})`);
        }
    } catch (error) {
        logError(error);
    } finally {
        framePumpBusy = false;
    }
};

const stopFramePump = () => {
    if (framePumpTimer) {
        clearInterval(framePumpTimer);
        framePumpTimer = undefined;
    }
};

const startFramePump = () => {
    if (!frameBridgeEnabled || framePumpTimer) return;

    pushVideoFrame();
    framePumpTimer = setInterval(pushVideoFrame, FRAME_INTERVAL);
};

const setFrameBridgeEnabled = enabled => {
    frameBridgeEnabled = Boolean(enabled && supportsFrameBridge());

    if (!frameBridgeEnabled) {
        stopFramePump();
        return;
    }

    const aotWindow = getAotWindow();

    if (windowExists(aotWindow) && aotWindow.isVisible()) {
        startFramePump();
    }
};

/**
 * Sends an update state event to renderer process
 * @param {string} value the updated aot window state
 */
const sendStateUpdate = (state, data = {}) => {
    logInfo(`sending ${state} state update to renderer process`);

    mainWindow.webContents.send(EVENTS_CHANNEL, { name: EVENTS.UPDATE_STATE, state, data });
};

/**
 * Handles window created event
 *
 * @param {BrowserWindow} window the newly created window
 */
const handleWindowCreated = window => {
    logInfo(`received window created event`);

    const aotWindow = getAotWindow();

    if (window !== aotWindow) {
        return;
    }

    logInfo(`setting aot window options`);

    // Required to allow the window to be rendered on top of full screen apps
    aotWindow.setAlwaysOnTop(true, 'screen-saver');

    // Content protection makes the AoT window appear black in screenshots,
    // screen mirroring and remote debugging sessions, so keep it visible for
    // local debugging.

    aotWindow.once('ready-to-show', () => {
        aotWindow.show();

        if (frameBridgeEnabled) {
            startFramePump();
        }
    });

    aotWindow.webContents.on('error', error => {
        logError(error);
    });

    aotWindow.webContents.on('render-process-gone', (event, details) => {
        logInfo('close aot because renderer crashed', details);
        aotWindow.close();
    });


    setAspectRatioToResizeableWindow(aotWindow);
};

const windowOpenHandler = args => {
    const { frameName } = args;

    if (frameName.startsWith(AOT_WINDOW_NAME)) {
        logInfo('handling new aot window event');

        const magic = frameName.split('-')[1];

        if (magic !== aotMagic) {
            logInfo('bad AoT window magic');

            return { action: 'deny' };
        }

        return {
            action: 'allow',
            overrideBrowserWindowOptions: {
                ...aotConfig,
                ...getPosition(),
                ...getSize()
            }
        };
    }

    if (_existingWindowOpenHandler) {
        return _existingWindowOpenHandler(args);
    }

    return { action: 'deny' };
};

/**
 * Handle show aot event.
 */
const showAot = () => {
    logInfo('show aot handler');

    let state;
    let data = {};

    const aotWindow = getAotWindow();

    if (windowExists(aotWindow)) {
        state = STATES.SHOW;
        aotWindow.showInactive();

        if (frameBridgeEnabled) {
            startFramePump();
        }
    } else {
        state = STATES.OPEN;
        data.aotMagic = aotMagic;
    }

    sendStateUpdate(state, data);
};

/**
 * Handle hide aot event.
 */
 const hideAot = () => {
    logInfo('hide aot handler');

    if (isIntersecting) {
        hideWindow();
    }
};

/**
 * Attaches event handlers on the main window
 */
const addMainWindowHandlers = () => {
    logInfo(`adding main window event handlers`);

    mainWindow.on('blur', showAot);
    mainWindow.on('focus', hideAot);
};

/**
 * Detaches event handlers from the main window
 */
const removeMainWindowHandlers = () => {
    logInfo(`removing main window event handlers`);

    mainWindow.removeListener('blur', showAot);
    mainWindow.removeListener('focus', hideAot);
};

/**
 * Hides the aot window
 */
 const hideWindow = () => {
    stopFramePump();
    const aotWindow = getAotWindow();

    if (windowExists(aotWindow)) {
        logInfo('hiding aot window');
        aotWindow.hide();
        sendStateUpdate(STATES.HIDE);
    }
};

/**
 * Shows the aot window
 */
const closeWindow = () => {
    stopFramePump();
    const aotWindow = getAotWindow();

    if (windowExists(aotWindow)) {
        logInfo('closing aot window');
        aotWindow.close();
    }
};

/**
 * Handler for state updates
 * @param {IpcMainEvent} event electron event
 * @param {Object} options channel params
 */
const onAotEvent = (event, { name, ...rest }) => {
    logInfo(`received aot event ${name}`);

    switch (name) {
        case EVENTS.UPDATE_STATE:
            handleStateChange(rest.state);
            break;
        case EVENTS.SET_FRAME_BRIDGE:
            setFrameBridgeEnabled(rest.enabled);
            break;
        case EVENTS.MOVE:
            handleMove(rest.position, rest.initialSize);
            break;
        case EVENTS.RESIZE:
            handleResize(rest.height);
            break;
    }
};

/**
 * Handler for state updates
 * @param {string} value - updated state name
 */
const handleStateChange = state => {
    logInfo(`handling ${state} state update from renderer process`);

    switch (state) {
        case STATES.DISMISS:
            closeWindow();
            break;
        case STATES.CLOSE:
            removeMainWindowHandlers();
            savePosition(getAotWindow());
            resetSize();
            closeWindow();
            break;
        case STATES.CONFERENCE_JOINED:
            addMainWindowHandlers();
            break;
        case STATES.SHOW_MAIN_WINDOW:
            // this will switch focus to main window, which in turns triggers hide on aot
            mainWindow.show();

            break;
        case STATES.IS_NOT_INTERSECTING:
            isIntersecting = false;
            showAot();

            break;
        case STATES.IS_INTERSECTING:
            isIntersecting = true;
            hideAot();

            break;
        default:
            break;
    }
};

/**
 * Handler for move event
 * @param {Object} position the new position
 * @param {Object} initialSize the window size before move
 */
const handleMove = (position, initialSize) => {
    const aotWindow = getAotWindow();

    if (!windowExists(aotWindow)) {
        return;
    }

    const { width, height } = initialSize;
    const { x, y } = position;

    aotWindow.setBounds({
        x,
        y,
        width,
        height
    });
};

/**
 * Resizes the AOT window to match the participant list height.
 * @param {number} height
 */
const handleResize = height => {
    const aotWindow = getAotWindow();

    if (!windowExists(aotWindow) || !Number.isFinite(height) || height <= 0) {
        return;
    }

    const [ width ] = aotWindow.getSize();
    aotWindow.setSize(width, Math.round(height));
};

const cleanup = () => {
    stopFramePump();
    frameBridgeEnabled = false;
    framePumpBusy = false;
    ipcMain.removeListener(EVENTS_CHANNEL, onAotEvent);
};

/**
 * Initializes the always on top functionality in the main electron process.
 *
 * @param {BrowserWindow} jitsiMeetWindow - the BrowserWindow object which displays the meeting
 * @param {Logger} loggerTransports - external loggers
 * @param {Function} existingWindowOpenHandler - preexisting window open handler, in order to avoid overwriting it.
 */
 const setupAlwaysOnTopMain = (jitsiMeetWindow, loggerTransports, existingWindowOpenHandler) => {
    logInfo('setting up aot for main window');

    aotMagic = crypto.randomUUID().replaceAll('-', '');

    setLogger(loggerTransports);

    ipcMain.on(EVENTS_CHANNEL, onAotEvent);

    _existingWindowOpenHandler = existingWindowOpenHandler;
    mainWindow = jitsiMeetWindow;
    mainWindow.webContents.setWindowOpenHandler(windowOpenHandler);
    mainWindow.webContents.on('did-create-window', handleWindowCreated);

    // Clean up ipcMain handlers to avoid leaks.
    mainWindow.on('closed', cleanup);
};

module.exports = {
    cleanupAlwaysOnTopMain: cleanup,
    setupAlwaysOnTopMain
};
