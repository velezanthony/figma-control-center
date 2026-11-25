// Dobles de los puertos de la captura de la web: respuesta programable y registro de llamadas
import { CONTRACT, type ProjectConfig, type Screen } from "#domain/capture.ts";
import type { FigmaError } from "#domain/figma-error.ts";
import { ok, type Result } from "#domain/result.ts";
import { makeCaptureScreens } from "../capture-screens.ts";
import { type JobRegistry, localBuildLock } from "../job-registry.ts";
import type {
	LoadedProject,
	ProjectConfigSource,
} from "../ports/project-config.ts";
import type { SecretStore } from "../ports/secrets.ts";
import type {
	StoredCapture,
	WebCaptureStore,
} from "../ports/web-capture-store.ts";
import type {
	CapturedImage,
	CapturedScreen,
	WebCaptureRequest,
	WebCapturer,
} from "../ports/web-capturer.ts";

export const PROJECT_FILE = "/proyecto/figma-control-center.json";

export const projectWith = (
	screens: readonly Screen[],
	web: Partial<ProjectConfig["web"]> = {},
	hooks: LoadedProject["hooks"] = null,
	areas: LoadedProject["areas"] = null,
	areaAssets: LoadedProject["areaAssets"] = {},
	mapData: Partial<
		Pick<
			LoadedProject,
			| "map"
			| "mapSource"
			| "iconCatalog"
			| "recognize"
			| "fingerprints"
			| "sheets"
			| "sheetsSource"
			| "composeDir"
		>
	> = {},
): LoadedProject => ({
	file: PROJECT_FILE,
	config: {
		contract: CONTRACT.project,
		web: {
			baseUrl: "http://127.0.0.1:8123",
			viewport: { w: 800, h: 600 },
			...web,
		},
		screens: "screens.json",
	},
	screens: { contract: CONTRACT.screens, screens },
	hooks,
	areas,
	areaAssets,
	map: null,
	mapSource: null,
	iconCatalog: [],
	recognize: null,
	fingerprints: {},
	sheets: null,
	sheetsSource: null,
	composeDir: null,
	...mapData,
});

export class InMemoryProjectConfig implements ProjectConfigSource {
	reply: () => Promise<Result<LoadedProject, FigmaError>>;
	loads = 0;
	constructor(project: LoadedProject) {
		this.reply = async () => ok(project);
	}
	load() {
		this.loads++;
		return this.reply();
	}
}

export class InMemorySecrets implements SecretStore {
	values = new Map<string, string>();
	calls: (readonly string[])[] = [];
	// Respuesta programable (por defecto, los valores de `values`)
	reply:
		| ((
				refs: readonly string[],
		  ) => Promise<Result<ReadonlyMap<string, string>, FigmaError>>)
		| null = null;
	resolve(refs: readonly string[]) {
		this.calls.push(refs);
		if (this.reply) return this.reply(refs);
		return Promise.resolve(
			ok(new Map(refs.map((r) => [r, this.values.get(r) ?? ""]))),
		);
	}
}

// Un nodo de texto con su ruta (el capturador no pone ids: los pone el caso de uso)
export const textNode = (
	path: string,
	extra: Record<string, unknown> = {},
) => ({
	t: "text",
	path,
	txt: "Hola",
	x: 0,
	y: 0,
	w: 10,
	h: 10,
	...extra,
});

export const capturedScreen = (
	key: string,
	nodes: readonly unknown[],
	images: readonly CapturedImage[] = [],
): CapturedScreen => ({
	key,
	url: `http://127.0.0.1:8123/${key}/`,
	variants: [{ props: {}, nodes }],
	images,
	warnings: [],
});

export class InMemoryWebCapturer implements WebCapturer {
	requests: WebCaptureRequest[] = [];
	// Lo que «captura» cada pantalla, por clave (por defecto, un texto)
	screens = new Map<string, CapturedScreen>();
	finalReply: Result<true, FigmaError> = ok(true);
	// Si se fija, la captura no acaba hasta que se resuelva
	gate: Promise<void> | null = null;
	async capture(
		request: WebCaptureRequest,
		onScreen: (s: CapturedScreen) => Promise<void>,
	) {
		this.requests.push(request);
		if (this.gate) await this.gate;
		for (const s of request.screens)
			await onScreen(
				this.screens.get(s.key) ?? capturedScreen(s.key, [textNode("p[0]")]),
			);
		return this.finalReply;
	}
}

export class InMemoryWebCaptureStore implements WebCaptureStore {
	captures = new Map<string, string>();
	rejected = new Map<string, { json: string; errors: string }>();
	images = new Map<string, CapturedImage>();
	imagePath(image: Pick<CapturedImage, "sha256" | "type">) {
		return `img/${image.sha256}.${image.type === "jpeg" ? "jpg" : "png"}`;
	}
	saveImage(image: CapturedImage) {
		this.images.set(image.sha256, image);
		return Promise.resolve();
	}
	saveCapture(screen: string, json: string): Promise<StoredCapture> {
		const base = `/salida/web-captures/2026-11-11/${screen}_100000`;
		let path = `${base}.json`;
		for (let n = 2; this.captures.has(path); n++) path = `${base}-${n}.json`;
		this.captures.set(path, json);
		return Promise.resolve({ path, bytes: json.length });
	}
	plans = new Map<string, string>();
	sheetPlans = new Map<string, string>();
	imageFile(image: Pick<CapturedImage, "sha256" | "type">) {
		return `/salida/web-captures/${this.imagePath(image)}`;
	}
	savePlan(screen: string, json: string): Promise<StoredCapture> {
		const base = `/salida/screen-plans/2026-11-11/${screen}_100000`;
		let path = `${base}.json`;
		for (let n = 2; this.plans.has(path); n++) path = `${base}-${n}.json`;
		this.plans.set(path, json);
		return Promise.resolve({ path, bytes: json.length });
	}
	saveSheetPlan(sheet: string, json: string): Promise<StoredCapture> {
		const base = `/salida/sheet-plans/2026-11-11/${sheet}_100000`;
		let path = `${base}.json`;
		for (let n = 2; this.sheetPlans.has(path); n++) path = `${base}-${n}.json`;
		this.sheetPlans.set(path, json);
		return Promise.resolve({ path, bytes: json.length });
	}
	latest(screen: string) {
		const prefix = `/salida/web-captures/2026-11-11/${screen}_`;
		const found = [...this.captures]
			.filter(([p]) => p.startsWith(prefix))
			.at(-1);
		return Promise.resolve(
			found === undefined
				? null
				: {
						path: found[0],
						relative: found[0].replace("/salida/web-captures/", ""),
						json: found[1],
					},
		);
	}
	read(relative: string) {
		const path = `/salida/web-captures/${relative}`;
		const json = this.captures.get(path);
		return Promise.resolve(
			json === undefined ? null : { path, relative, json },
		);
	}
	saveRejected(screen: string, json: string, errors: string) {
		const path = `/salida/web-captures/rejected/2026-11-11/${screen}_100000.json`;
		const errorsPath = path.replace(/\.json$/, ".errors.json");
		this.rejected.set(path, { json, errors });
		return Promise.resolve({ path, errorsPath });
	}
}

// El caso de uso de la captura montado sobre los dobles (para las pruebas del servidor MCP)
export function inMemoryCapture(options: {
	readonly jobs: JobRegistry;
	readonly screens?: readonly Screen[];
	readonly softDeadlineMs?: number;
	readonly inlineErrors?: number;
}) {
	const capturer = new InMemoryWebCapturer();
	const store = new InMemoryWebCaptureStore();
	const run = makeCaptureScreens({
		project: new InMemoryProjectConfig(
			projectWith(
				options.screens ?? [{ key: "inicio", title: "Inicio", url: "/" }],
			),
		),
		secrets: new InMemorySecrets(),
		capturer,
		store,
		lock: localBuildLock(),
		jobs: options.jobs,
		softDeadlineMs: options.softDeadlineMs ?? 1000,
		pageTimeoutMs: 1000,
		captureMaxBytes: 1_000_000,
		inlineErrors: options.inlineErrors ?? 10,
		checkSchema: () => [],
		clock: () => new Date("2026-11-11T09:00:00Z"),
		localIso: () => "2026-11-11T10:00:00.000+01:00",
	});
	return { run, capturer, store };
}
