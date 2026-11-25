import { z } from "zod";
import {
	type FigmaGateway,
	type FigmaStatus,
	type MetadataNode,
	type RunOptions,
	SCRIPT_FORMAT,
	type Screenshot,
	type ScriptToRun,
} from "#application/ports/figma-gateway.ts";
import {
	FIGMA_ERROR_TYPE,
	FIGMA_NOT_READY_REASON,
	type FigmaError,
	figmaNotReady,
	scriptError,
} from "#domain/figma-error.ts";
import { err, ok, type Result } from "#domain/result.ts";
import type { CdpClient } from "./cdp-client.ts";
import {
	type FigmaKitBundle,
	hasKit,
	KIT_PROBE_EXPRESSION,
	kitInstallExpression,
	readFigmaKitBundle,
} from "./figma-kit.ts";
import { pngSize } from "./png.ts";
import { FIGMA_ACCESS, FIGMA_ACCESS_EXPRESSION } from "./protocol.ts";
import { wrapScript } from "./script-wrapper.ts";
import { metadataScript } from "./scripts/metadata.ts";
import { screenshotScript } from "./scripts/screenshot.ts";

const STATUS_EXPRESSION = `(() => ({ file: figma.root.name, page: figma.currentPage.name }))()`;

const MetadataSchema = z.object({
	id: z.string(),
	name: z.string(),
	type: z.string(),
	get children() {
		return z.array(MetadataSchema).optional();
	},
});
const ScreenshotSchema = z.object({ base64: z.string() });
const StatusSchema = z.object({ file: z.string(), page: z.string() });
const AccessSchema = z.enum(Object.values(FIGMA_ACCESS));

// Lo que no es «listo» se traduce a la razón del dominio; una respuesta desconocida, a «cargando» (lo de antes)
const NOT_READY_REASON = Object.freeze({
	[FIGMA_ACCESS.loading]: FIGMA_NOT_READY_REASON.loading,
	[FIGMA_ACCESS.notLoggedIn]: FIGMA_NOT_READY_REASON.notLoggedIn,
	[FIGMA_ACCESS.viewOnly]: FIGMA_NOT_READY_REASON.viewOnly,
} as const);

// `where`: qué elemento y qué campo no cumplen, si se sabe
export const unexpectedReply = (what: string, where?: string): FigmaError =>
	scriptError(
		`Respuesta inesperada de Figma al pedir ${what}${where ? ` (${where})` : ""}.`,
		null,
		false,
	);

export class CdpFigmaGateway implements FigmaGateway {
	readonly #client: CdpClient;
	readonly #readKit: () => FigmaKitBundle;
	#kit: FigmaKitBundle | undefined;

	// `readKit`: de dónde sale el empaquetado del kit (por defecto, kits/dist/figma-kit.js; se lee al primer uso)
	constructor(
		client: CdpClient,
		readKit: () => FigmaKitBundle = readFigmaKitBundle,
	) {
		this.#client = client;
		this.#readKit = readKit;
	}

	// Antes de un script del proyecto: la pestaña tiene que tener ESTE kit (versión y hash). Si falta o es otro
	// (pestaña recargada, kit nuevo) se evalúa el empaquetado y se vuelve a preguntar. Los scripts internos no instalan nada
	async #ensureKit(): Promise<Result<true, FigmaError>> {
		let bundle: FigmaKitBundle;
		try {
			this.#kit ??= this.#readKit();
			bundle = this.#kit;
		} catch (e) {
			return err(
				scriptError(
					`No se pudo leer el kit de Figma (kits/dist/figma-kit.js): ${e instanceof Error ? e.message : String(e)}. Genéralo con «npm run build:kit».`,
					null,
					false,
				),
			);
		}
		const asked = await this.#client.evaluate(KIT_PROBE_EXPRESSION);
		if (!asked.ok) return asked;
		if (hasKit(asked.value, bundle)) return ok(true);
		const installed = await this.#client.evaluate(kitInstallExpression(bundle));
		if (!installed.ok) return installed;
		const again = await this.#client.evaluate(KIT_PROBE_EXPRESSION);
		if (!again.ok) return again;
		if (!hasKit(again.value, bundle)) {
			return err(
				scriptError(
					"La pestaña no quedó con el kit de Figma instalado tras evaluarlo.",
					null,
					false,
				),
			);
		}
		return ok(true);
	}

	orphanedScript(): Promise<void> | undefined {
		return this.#client.orphanedScript();
	}

	takeTabNotice(): string | null {
		return this.#client.takeOpenedNotice();
	}

	ready(): Promise<Result<true, FigmaError>> {
		return this.#client.ready();
	}

	async status(): Promise<FigmaStatus> {
		const base = {
			chromeReachable: true,
			tabFound: true,
			figmaReady: false,
			fileName: null,
			pageName: null,
		} as const;
		const probe = await this.#client.evaluate(FIGMA_ACCESS_EXPRESSION, {
			waitReady: false,
		});
		if (!probe.ok) {
			return {
				...base,
				chromeReachable:
					probe.error.type !== FIGMA_ERROR_TYPE.chromeUnreachable,
				tabFound:
					probe.error.type !== FIGMA_ERROR_TYPE.chromeUnreachable &&
					probe.error.type !== FIGMA_ERROR_TYPE.figmaTabNotFound,
				error: probe.error,
			};
		}
		const access = AccessSchema.safeParse(probe.value);
		const state = access.success ? access.data : FIGMA_ACCESS.loading;
		if (state !== FIGMA_ACCESS.ready) {
			// Sin esperar: un estado que se cuelga un minuto no sirve de diagnóstico
			return {
				...base,
				error: figmaNotReady(0, NOT_READY_REASON[state], this.#client.fileUrl),
			};
		}
		const info = await this.#client.evaluate(STATUS_EXPRESSION);
		if (!info.ok) return { ...base, figmaReady: true, error: info.error };
		const parsed = StatusSchema.safeParse(info.value);
		if (!parsed.success) {
			return { ...base, figmaReady: true, error: unexpectedReply("el estado") };
		}
		return {
			...base,
			figmaReady: true,
			fileName: parsed.data.file,
			pageName: parsed.data.page,
			error: null,
		};
	}

	async run(
		script: ScriptToRun,
		options: RunOptions = {},
	): Promise<Result<unknown, FigmaError>> {
		if (options.installKit === true) {
			const kit = await this.#ensureKit();
			if (!kit.ok) return kit;
		}
		const { expression, lineOffset } = wrapScript(script);
		return this.#client.evaluate(expression, {
			lineOffset,
			timeoutMs: options.timeoutMs,
		});
	}

	async screenshot(
		nodeId: string,
		scale: number,
	): Promise<Result<Screenshot, FigmaError>> {
		const raw = await this.run({
			code: screenshotScript(nodeId, scale),
			format: SCRIPT_FORMAT.body,
		});
		if (!raw.ok) return raw;
		const parsed = ScreenshotSchema.safeParse(raw.value);
		if (!parsed.success) return err(unexpectedReply("la captura"));
		const png = Buffer.from(parsed.data.base64, "base64");
		const size = pngSize(png);
		if (size === null) return err(unexpectedReply("la captura"));
		return ok({ png, ...size });
	}

	async metadata(
		nodeId: string | null,
		depth: number,
	): Promise<Result<MetadataNode, FigmaError>> {
		const raw = await this.run({
			code: metadataScript(nodeId, depth),
			format: SCRIPT_FORMAT.body,
		});
		if (!raw.ok) return raw;
		const parsed = MetadataSchema.safeParse(raw.value);
		if (!parsed.success) return err(unexpectedReply("los metadatos"));
		return ok(parsed.data);
	}
}
