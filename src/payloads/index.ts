import type { RuntimeFiles, RuntimeId } from '../engine/types';
import {
	FUWA_GOMEN_ENTRY_FILE,
	FUWA_GOMEN_VISIBLE_FILES,
	buildFuwaGomenFiles
} from './fuwa-gomen/index';

export type PayloadId = 'fuwa-gomen';

export type PayloadOption = {
	id: PayloadId;
	label: string;
	description: string;
	runtimeId: RuntimeId;
	entryFile: string;
	visibleFiles?: readonly string[];
	loadFiles: () => RuntimeFiles;
};

export type TestPanelDbSummary = {
	documentCount: number;
	loadedFrom: 'memory' | 'sqlite' | 'static';
	buildOk: boolean;
};

export type TestPanelPayload = {
	revision: number;
	selectedAssetId: PayloadId;
	availableAssets: PayloadOption[];
	entryFile: string;
	files: RuntimeFiles;
	terminalHistory: string[];
	dbSummary: TestPanelDbSummary;
	browserJs: string;
};

export const PAYLOADS: readonly PayloadOption[] = [
	{
		id: 'fuwa-gomen',
		label: 'Fuwa Gomen',
		description: 'Canonical Fuwa DSL demo payload.',
		runtimeId: 'lua',
		entryFile: FUWA_GOMEN_ENTRY_FILE,
		visibleFiles: [...FUWA_GOMEN_VISIBLE_FILES],
		loadFiles: buildFuwaGomenFiles
	}
] as const;

export const DEFAULT_PAYLOAD_ID: PayloadId = 'fuwa-gomen';

export function normalizePayloadId(value: string | null | undefined): PayloadId {
	return value === 'fuwa-gomen' ? value : DEFAULT_PAYLOAD_ID;
}

export function getPayloadOption(payloadId: PayloadId): PayloadOption {
	return PAYLOADS.find((payload) => payload.id === payloadId) ?? PAYLOADS[0];
}

export function buildPayloadFiles(
	payloadId: PayloadId
): { files: RuntimeFiles; entryFile: string; payload: PayloadOption; browserJs: string } {
	const payload = getPayloadOption(payloadId);
	const files = payload.loadFiles();

	return {
		payload,
		entryFile: payload.entryFile,
		files,
		browserJs: files['browser.js'] ?? ''
	};
}

export function loadDefaultPayload(): { files: RuntimeFiles; entryFile: string; payload: PayloadOption; browserJs: string } {
	return buildPayloadFiles(DEFAULT_PAYLOAD_ID);
}

export { FUWA_GOMEN_ENTRY_FILE, FUWA_GOMEN_VISIBLE_FILES, buildFuwaGomenFiles };
