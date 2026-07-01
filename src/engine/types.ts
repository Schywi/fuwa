export type RuntimeId = 'lua';

export type RuntimeState = 'idle' | 'booting' | 'ready' | 'running' | 'error' | 'unavailable';

export type RuntimeFiles = Record<string, string>;

export type RuntimeLanguage = 'lua';

export type PreviewState =
	| { kind: 'none' }
	| { kind: 'tenant'; sessionId: number };

export type TenantCommand =
	| { type: 'clear'; message?: string }
	| { type: 'swap'; html: string; path?: string; title?: string }
	| { type: 'backend'; backend: 'runtime' | 'server'; baseUrl?: string; appBasePath?: string }
	| { type: 'reply'; requestId: number; html: string; path?: string; title?: string; status?: number }
	| { type: 'stream'; stream: 'stdout' | 'stderr' | 'log'; text: string }
	| { type: 'activate'; selector?: string; detail?: Record<string, unknown> };

export type TenantEvent =
	| { type: 'ready' }
	| { type: 'request'; requestId?: number; method: 'GET' | 'POST'; path: string; body?: string }
	| { type: 'meta'; title?: string; path?: string }
	| { type: 'stream'; stream: 'stdout' | 'stderr' | 'log'; text: string };

export type LaunchTarget =
	| { kind: 'script'; entryFile: string }
	| { kind: 'request'; method: 'GET' | 'POST'; path: string; body?: string; requestId?: number };

export interface RuntimeMetrics {
	bootMs?: number;
	runMs?: number;
	totalMs?: number;
	memoryBeforeMb?: number;
	memoryAfterMb?: number;
	memoryDeltaMb?: number;
	stdoutBytes?: number;
	stderrBytes?: number;
	htmlBytes?: number;
	resourceBytes?: number;
}

export interface RuntimeIo {
	write: (data: string) => void;
	clear?: () => void;
	setPreview?: (preview: PreviewState) => void;
	sendTenantCommand?: (command: TenantCommand) => void;
	patchMetrics?: (metrics: Partial<RuntimeMetrics>) => void;
	getFile?: (name: string) => string | null;
}

export interface RuntimeAdapter {
	id: RuntimeId;
	label: string;
	description: string;
	supportsInteractiveShell: boolean;
	boot(io: RuntimeIo): Promise<void>;
	writeInput(data: string): void;
	saveFiles(files: RuntimeFiles): Promise<void>;
	run(files: RuntimeFiles, target: LaunchTarget): Promise<void>;
	reset(): Promise<void>;
	dispose(): Promise<void>;
	status(): RuntimeState;
	error(): string | null;
}

export interface RuntimeDefinition {
	id: RuntimeId;
	label: string;
	description: string;
	language: RuntimeLanguage;
	entryFile: string;
	files: RuntimeFiles;
	defaultTarget: LaunchTarget;
	executionFiles?: string[];
	visibleFiles?: string[];
}
