module.exports = {
    AOT_WINDOW_NAME: 'AlwaysOnTop',
    ASPECT_RATIO: 16 / 9,
    EVENTS: {
        TOGGLE_COLLAPSE: 'aot-toggle-collapse',
        MOVE: 'aot-move',
        RESIZE: 'aot-resize',
        SET_FRAME_BRIDGE: 'aot-set-frame-bridge',
        UPDATE_STATE: 'aot-update-state',
    },
    EXTERNAL_EVENTS: {
        ALWAYSONTOP_DISMISSED: 'dismissed',
        ALWAYSONTOP_WILL_CLOSE: 'will-close',
        ALWAYSONTOP_DOUBLE_CLICK: 'double-click'
    },
    EVENTS_CHANNEL: 'aot-events-channel',
    SIZE: {
        width: 150,
        // One participant (60px) plus 10px top and bottom list padding.
        height: 80
    },
    STATES: {
        CLOSE: 'aot-close',
        CONFERENCE_JOINED: 'aot-conference-joined',
        DISMISS: 'aot-dismiss',
        HIDE: 'aot-hide',
        OPEN: 'aot-open',
        SHOW: 'aot-show',
        SHOW_MAIN_WINDOW: 'aot-main-window-show',
        IS_NOT_INTERSECTING: 'is-not-intersecting',
        IS_INTERSECTING: 'is-intersecting'
    },
    STORAGE: {
        AOT_X: 'aot-x',
        AOT_Y: 'aot-y'
    }
};
