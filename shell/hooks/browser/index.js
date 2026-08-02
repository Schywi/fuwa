import '../editor.js';
import '../terminal.js';
import '../workspace.js';
import { create as createRuntimeSession } from '../runtime-session.js';
import { create as createPreviewBrowserDriver } from '../preview-browser.js';
import '../preview.js';
import {
	log as observabilityLog,
	mount as mountObservability,
	unmount as unmountObservability,
	refresh as refreshObservability,
	appendEvents,
	ROOT_SELECTOR as observabilitySelector
} from '../observability.js';
import '../motion.js';
import { mount as mountCursor, unmount as unmountCursor } from '../cursor.js';
import { mountAll, unmountAll, toggleFilter } from '../tmux.js';

window.FuwaObservability = {
	log: observabilityLog
};

window.FuwaShellObservability = {
	mount: mountObservability,
	unmount: unmountObservability,
	refresh: refreshObservability,
	selector: observabilitySelector,
	appendEvents: appendEvents
};

window.FuwaShellCursor = {
	mount: mountCursor,
	unmount: unmountCursor
};

window.FuwaShellTmux = {
	mountAll: mountAll,
	unmountAll: unmountAll,
	toggleFilter: toggleFilter
};

window.FuwaRuntimeSession = {
	create: createRuntimeSession
};

window.FuwaPreviewBrowserDriver = {
	create: createPreviewBrowserDriver
};
