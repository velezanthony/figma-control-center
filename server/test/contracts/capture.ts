// Contratos de la captura de la web (project@1, screens@1 y capture@1). Son contratos PROPIOS: su fuente es el esquema
// zod y docs/users/contracts.md, no una salida real.
// Viven en el servidor (#adapters/contracts/{project,screens,capture}.ts, JSON Schema en schemas/). Los ejemplos se
// CONSTRUYEN aquí y se validan al construirlos: nunca se pega una captura real.
import { CaptureSchema } from "#adapters/contracts/capture.ts";
import { ProjectSchema } from "#adapters/contracts/project.ts";
import { ScreensSchema } from "#adapters/contracts/screens.ts";
import { CAPTURE_KIT, CONTRACT } from "#domain/capture.ts";
import { nodeId } from "#domain/node-id.ts";

export const CAPTURE_CONTRACT_SOURCES = Object.freeze([
	"docs/users/contracts.md (project@1, screens@1, capture@1)",
	"schemas/project.v1.json",
	"schemas/screens.v1.json",
	"schemas/capture.v1.json",
] as const);

export const projectExample = (): unknown =>
	ProjectSchema.parse({
		contract: CONTRACT.project,
		web: {
			baseUrl: "http://127.0.0.1:8123",
			viewport: { w: 1440, h: 900 },
			screenScale: 1,
			devicePixelRatio: 1,
			login: {
				path: "/entrar/",
				fields: { user: "#usuario", password: "#clave" },
				submit: "button[type=submit]",
			},
			users: { lector: { username: "lector", secretRef: "ejemplo-lector" } },
			strip: [".aviso-flotante"],
			hideScrollbar: true,
		},
		screens: "screens.json",
		hooks: "hooks.js",
	});

export const screensExample = (): unknown =>
	ScreensSchema.parse({
		contract: CONTRACT.screens,
		screens: [
			{ key: "inicio", title: "Inicio", url: "/" },
			{
				key: "panel",
				title: "Panel",
				url: "/privado/?pestana=1",
				session: "lector",
				pick: "main",
				variants: [
					{ props: { menu: "cerrado" } },
					{
						props: { menu: "abierto" },
						run: [{ click: "#menu" }],
						until: "document.querySelector('#lista').offsetHeight > 0",
					},
				],
			},
		],
	});

const IMAGE_REF = "a".repeat(64);

export const captureExample = (): unknown =>
	CaptureSchema.parse({
		contract: CONTRACT.capture,
		screen: "inicio",
		title: "Inicio",
		source: {
			url: "http://127.0.0.1:8123/",
			viewport: { w: 1440, h: 900 },
			screenScale: 1,
			devicePixelRatio: 1,
			capturedAt: "2026-11-11T10:00:00.000+01:00",
			kit: CAPTURE_KIT,
			hooks: { sha256: "b".repeat(64) },
		},
		variants: [
			{
				props: {},
				nodes: [
					{
						t: "frame",
						id: nodeId("main[0]"),
						path: "main[0]",
						tag: "main",
						cls: "",
						x: 0,
						y: 0,
						w: 1440,
						h: 900,
						pos: "static",
						op: 1,
						bg: [255, 255, 255, 1],
						pad: [0, 0, 0, 0],
						grad: null,
						kids: [
							{
								t: "text",
								id: nodeId("main[0]/#text[0]"),
								path: "main[0]/#text[0]",
								txt: "Hola",
								x: 8,
								y: 8,
								w: 32,
								h: 18,
								lines: 1,
							},
							{
								t: "img",
								id: nodeId("main[0]/img[0]"),
								path: "main[0]/img[0]",
								tag: "img",
								ref: IMAGE_REF,
								x: 8,
								y: 40,
								w: 20,
								h: 20,
								fit: "fill",
							},
						],
					},
				],
				annotations: [],
			},
		],
		images: {
			[IMAGE_REF]: {
				path: `img/${IMAGE_REF}.png`,
				width: 20,
				height: 20,
				type: "png",
			},
		},
		warnings: [],
	});
