const {
    api,
    move,
    resize,
    ondblclick,
    onload,
    dismiss
} = window.alwaysOnTop;

let initialSize;

const dismissButton = document.querySelector('.dismiss');
if (dismissButton) {
    dismissButton.addEventListener('click', dismiss);
}

window.addEventListener('dblclick', ondblclick);

onload();
setupDraggable();
setupParticipantHeightObserver();
// load all resources from meet
api._getAlwaysOnTopResources().forEach(src => loadFile(src));


/**
 * Enables draggable functionality for the always on top window.
 *
 * @returns {void}
 */
function setupDraggable() {
    /**
     * If we use the standard drag (-webkit-app-region: drag) all mouse
     * events are blocked. To fix this we'll implement drag ourselves.
     */
    window.addEventListener('mousedown', mouseDownEvent => {
        initialSize = {
            width: window.innerWidth,
            height: window.innerHeight
        };
        pageX = mouseDownEvent.pageX;
        pageY = mouseDownEvent.pageY;
        window.addEventListener('mousemove', drag);
    });

    window.addEventListener('mouseup', () => {
        window.removeEventListener('mousemove', drag);
    });
}

/**
 * Stores the position of the mouse relative to the page on mouse down events.
 *
 * @type {int}
 */
let pageX = 0, pageY = 0;

/**
 * Mouse move listener.
 *
 * @param {MouseMove} mouseMoveEvent - The mouse move event.
 * @returns {void}
 */
function drag(mouseMoveEvent) {
    mouseMoveEvent.stopPropagation();
    mouseMoveEvent.preventDefault();
    const { screenX, screenY } = mouseMoveEvent;
    move(screenX - pageX, screenY - pageY, initialSize);
}

/**
 * Keeps the window height equal to the height of up to five participants.
 */
function setupParticipantHeightObserver() {
    const updateHeight = () => {
        const participantList = document.querySelector('.always-on-top-participants');
        const participants = Array.from(document.querySelectorAll('.always-on-top-participant'))
            .slice(0, 5);

        if (!participantList || !participants.length) {
            return;
        }

        const styles = window.getComputedStyle(participantList);
        const paddingTop = Number.parseFloat(styles.paddingTop) || 10;
        const paddingBottom = Number.parseFloat(styles.paddingBottom) || 10;
        const gap = Number.parseFloat(styles.rowGap || styles.gap) || 5;
        const participantsHeight = participants.reduce((total, participant) =>
            total + participant.getBoundingClientRect().height, 0);
        const height = participantsHeight
            + paddingTop
            + paddingBottom
            + gap * Math.max(0, participants.length - 1);

        if (height > 0) {
            resize(height);
        }
    };

    const participantObserver = new MutationObserver(() => {
        window.requestAnimationFrame(updateHeight);
    });
    participantObserver.observe(document.body, { childList: true, subtree: true });
    window.requestAnimationFrame(updateHeight);
}

/**
 * Loads a file from a specific source.
 *
 * @param src the source from the which the script is to be (down)loaded
 */
function loadFile(src) {
    if(src.endsWith('.js')) {
        const script = document.createElement('script');

        script.async = true;
        script.src = src;

        document.head.appendChild(script);
    } else if(src.endsWith('.css')) {
        const link = document.createElement('link');
        link.setAttribute("rel", "stylesheet");
        link.setAttribute("type", "text/css");
        link.setAttribute("href", src);
        document.head.appendChild(link);
    }
}
