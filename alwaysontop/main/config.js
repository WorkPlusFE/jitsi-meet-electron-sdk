const { SIZE } = require("../constants");

module.exports = {
    backgroundColor: 'transparent',
    minWidth: SIZE.width,
    minHeight: 1,
    minimizable: false,
    maximizable: false,
    resizable: false,
    alwaysOnTop: true,
    fullscreen: false,
    fullscreenable: false,
    skipTaskbar: true,
    titleBarStyle: undefined,
    frame: false,
    show: false,
    webPreferences: {
        contextIsolation: false,
        // The renderer populates this about:blank window through its WindowProxy.
        // Electron 45 requires matching the unsandboxed meeting opener explicitly.
        sandbox: false
    }
};
