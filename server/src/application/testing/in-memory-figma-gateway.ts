import type {
	FigmaGateway,
	FigmaStatus,
	MetadataNode,
	RunOptions,
	Screenshot,
	ScriptToRun,
} from "#application/ports/figma-gateway.ts";
import type { FigmaError } from "#domain/figma-error.ts";
import { ok, type Result } from "#domain/result.ts";

export const READY_STATUS: FigmaStatus = {
	chromeReachable: true,
	tabFound: true,
	figmaReady: true,
	fileName: "Archivo",
	pageName: "Página",
	error: null,
};

// Doble en memoria del puerto: cada método responde con lo que se le haya programado y deja constancia de la llamada
export class InMemoryFigmaGateway implements FigmaGateway {
	readonly runCalls: {
		script: ScriptToRun;
		options: RunOptions | undefined;
	}[] = [];
	readonly screenshotCalls: { nodeId: string; scale: number }[] = [];
	readonly metadataCalls: { nodeId: string | null; depth: number }[] = [];

	// Programable: el script vencido que sigue en la pestaña (ver FigmaGateway.orphanedScript)
	orphan: Promise<void> | undefined = undefined;
	statusReply: FigmaStatus = READY_STATUS;
	runReply: (script: ScriptToRun) => Promise<Result<unknown, FigmaError>> =
		() => Promise.resolve(ok(null));
	screenshotReply: Result<Screenshot, FigmaError> = ok({
		png: new Uint8Array(0),
		width: 0,
		height: 0,
	});
	metadataReply: Result<MetadataNode, FigmaError> = ok({
		id: "0:1",
		name: "Página",
		type: "PAGE",
	});

	orphanedScript(): Promise<void> | undefined {
		return this.orphan;
	}

	// Programable: el aviso que devolvería el adaptador real tras abrir la pestaña
	tabNotice: string | null = null;

	takeTabNotice(): string | null {
		const notice = this.tabNotice;
		this.tabNotice = null;
		return notice;
	}

	readyReply: () => Promise<Result<true, FigmaError>> = () =>
		Promise.resolve(ok(true as const));

	ready(): Promise<Result<true, FigmaError>> {
		return this.readyReply();
	}

	status(): Promise<FigmaStatus> {
		return Promise.resolve(this.statusReply);
	}

	run(
		script: ScriptToRun,
		options?: RunOptions,
	): Promise<Result<unknown, FigmaError>> {
		this.runCalls.push({ script, options });
		return this.runReply(script);
	}

	screenshot(
		nodeId: string,
		scale: number,
	): Promise<Result<Screenshot, FigmaError>> {
		this.screenshotCalls.push({ nodeId, scale });
		return Promise.resolve(this.screenshotReply);
	}

	metadata(
		nodeId: string | null,
		depth: number,
	): Promise<Result<MetadataNode, FigmaError>> {
		this.metadataCalls.push({ nodeId, depth });
		return Promise.resolve(this.metadataReply);
	}
}

export function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((r) => {
		resolve = r;
	});
	return { promise, resolve };
}
