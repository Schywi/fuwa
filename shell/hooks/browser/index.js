import {
	mount as mountEditor,
	unmount as unmountEditor,
	refresh as refreshEditor,
	switchFile as switchEditorFile,
	getPendingEdits,
	selector as editorSelector
} from '../editor.js';
import {
	mount as mountTerminal,
	refresh as refreshTerminal,
	write as writeTerminal,
	clear as clearTerminal,
	dispose as disposeTerminal,
	selector as terminalSelector
} from '../terminal.js';
import {
	createState,
	initialize as initializeWorkspace,
	state as workspaceState
} from '../workspace.js';
import { create as createRuntimeSession } from '../runtime-session.js';
import { create as createPreviewBrowserDriver } from '../preview-browser.js';
import {
	mode as previewMode,
	refresh as refreshPreview,
	updateCode as updatePreviewCode,
	deploy as deployPreview,
	mount as mountPreview,
	browserDriver as getPreviewBrowserDriver
} from '../preview.js';
import {
	log as observabilityLog,
	mount as mountObservability,
	unmount as unmountObservability,
	refresh as refreshObservability,
	appendEvents,
	ROOT_SELECTOR as observabilitySelector
} from '../observability.js';
import {
	developPreview,
	loadMermaid,
	runLoader,
	startTypewriter
} from '../motion.js';
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

window.FuwaShellEditor = {
	mount: mountEditor,
	unmount: unmountEditor,
	refresh: refreshEditor,
	switchFile: switchEditorFile,
	pendingEdits: getPendingEdits(),
	selector: editorSelector()
};

window.FuwaShellTerminal = {
	mount: mountTerminal,
	refresh: refreshTerminal,
	write: writeTerminal,
	clear: clearTerminal,
	dispose: disposeTerminal,
	selector: terminalSelector()
};

window.FuwaShellWorkspace = {
	createState: createState,
	state: workspaceState(),
	initialize: initializeWorkspace
};

window.FuwaShellMotion = {
	developPreview: developPreview,
	loadMermaid: loadMermaid,
	runLoader: runLoader,
	startTypewriter: startTypewriter
};

window.FuwaShellPreview = {
	mode: previewMode,
	refresh: refreshPreview,
	updateCode: updatePreviewCode,
	deploy: deployPreview,
	mount: mountPreview,
	get browserDriver() {
		return getPreviewBrowserDriver();
	}
};
