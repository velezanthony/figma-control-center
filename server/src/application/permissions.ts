import {
	PERMISSION_LIMITS,
	type PermissionBehavior,
	type PermissionError,
	type PermissionRequest,
} from "#domain/permission.ts";
import { err, type Result } from "#domain/result.ts";
import type { ChatTokens, SessionCredentials } from "./ports/chat.ts";
import type {
	PermissionAsk,
	PermissionInbox,
	PermissionPanel,
} from "./ports/permissions.ts";

// Lo que se devuelve a Claude Code: el id que él emitió y la decisión
export type PermissionPush = {
	readonly requestId: string;
	readonly behavior: PermissionBehavior;
};

const clip = (text: string): string =>
	text.length > PERMISSION_LIMITS.maxFieldChars
		? `${text.slice(0, PERMISSION_LIMITS.maxFieldChars)}…`
		: text;

const reasonOf = (e: unknown): string =>
	e instanceof Error ? e.message : String(e);

// Claude Code pide permiso: se guarda para que el panel la muestre
export function makeRecordPermission(deps: {
	readonly inbox: PermissionInbox;
	readonly credentials: SessionCredentials;
}): (ask: PermissionAsk) => PermissionRequest | null {
	return (ask) =>
		deps.inbox.record(deps.credentials, {
			requestId: ask.requestId,
			toolName: clip(ask.toolName),
			description: clip(ask.description),
			inputPreview: clip(ask.inputPreview),
		});
}

export function createPermissionRelay(deps: {
	readonly inbox: PermissionInbox;
	readonly credentials: SessionCredentials;
	readonly push: (verdict: PermissionPush) => Promise<void>;
	readonly warn: (message: string) => void;
}): { deliverVerdicts(): Promise<number> } {
	return {
		// Al menos una vez: un veredicto solo se da por devuelto cuando el empuje terminó bien
		async deliverVerdicts() {
			let delivered = 0;
			for (const verdict of deps.inbox.verdicts(deps.credentials)) {
				try {
					await deps.push({
						requestId: verdict.requestId,
						behavior: verdict.behavior,
					});
				} catch (e) {
					deps.warn(
						`permisos: no se pudo devolver el veredicto ${verdict.id}: ${reasonOf(e)}`,
					);
					return delivered;
				}
				deps.inbox.markSent(deps.credentials, verdict.id);
				delivered++;
			}
			return delivered;
		},
	};
}

// El panel decide, firmando con el token que la sesión publicó (el navegador nunca lo ve)
export function makeDecidePermission(deps: {
	readonly panel: PermissionPanel;
	readonly tokens: ChatTokens;
}): (input: {
	sessionId: string;
	id: number;
	behavior: PermissionBehavior;
}) => Result<PermissionRequest, PermissionError> {
	return (input) => {
		const token = deps.tokens.read(input.sessionId);
		if (token === null) {
			return err({
				type: "NoSuchSession",
				message: `La sesión ${input.sessionId} no tiene chat activo (no ha publicado su token).`,
			});
		}
		return deps.panel.decide({ ...input, token });
	};
}
