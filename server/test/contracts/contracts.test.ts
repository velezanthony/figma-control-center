import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import { FIGMA_ACCESS } from "#adapters/cdp/protocol.ts";
import { AreasSchema } from "#adapters/contracts/areas.ts";
import { CaptureSchema } from "#adapters/contracts/capture.ts";
import { ComponentPlanSchema } from "#adapters/contracts/component.ts";
import { MapSchema } from "#adapters/contracts/map.ts";
import { ProjectSchema } from "#adapters/contracts/project.ts";
import { ScreenPlanSchema } from "#adapters/contracts/screen.ts";
import { ScreensSchema } from "#adapters/contracts/screens.ts";
import {
	SheetsSchema,
	sheetsSchemaIssues,
} from "#adapters/contracts/sheets.ts";
import { StepResultSchema } from "#adapters/contracts/step.ts";
import { AREAS_CONTRACT_SOURCES, areasExample } from "./areas.ts";
import { ParamsEchoSchema, paramsEcho } from "./build.ts";
import {
	CAPTURE_CONTRACT_SOURCES,
	captureExample,
	projectExample,
	screensExample,
} from "./capture.ts";
import {
	EvaluateResponseSchema,
	exceptionReply,
	FIGMA_BUNDLE_ORIGIN,
	protocolErrorReply,
	SCRIPT_ORIGIN,
	StackDescriptionSchema,
} from "./cdp.ts";
import {
	ChannelNotificationSchema,
	PanelChannelNotificationSchema,
	PermissionRequestNotificationSchema,
} from "./channel.ts";
import {
	COMPONENT_CONTRACT_SOURCES,
	componentPlanExample,
} from "./component.ts";
import {
	ACCESS_VALUES,
	AccessValueSchema,
	buildJpg,
	buildPdf,
	buildPng,
	buildSvg,
	ComponentsValueSchema,
	ExportValueSchema,
	exportNodesSchema,
	exportValue,
	InstancesValueSchema,
	MetadataNodeSchema,
	NODE_TYPES,
	NodeIdSchema,
	pngDimensions,
	StylesValueSchema,
	VariablesValueSchema,
	WriteResultSchema,
} from "./figma-values.ts";
import { LaunchedSchema, TokenSchema } from "./launch.ts";
import { MAP_CONTRACT_SOURCES, mapExample } from "./map.ts";
import { SCREEN_CONTRACT_SOURCES, screenPlanExample } from "./screen.ts";
import { SHEETS_CONTRACT_SOURCES, sheetsExample } from "./sheets.ts";
import { STEP_CONTRACT_SOURCES, stepExample } from "./step.ts";

// biome-ignore lint/suspicious/noExplicitAny: JSON de prueba que se edita campo a campo
type Loose = any;

describe("contrato CDP", () => {
	it("una excepción lleva exceptionId, lineNumber y columnNumber (ExceptionDetails)", () => {
		const reply = exceptionReply(2, {
			className: "Error",
			message: "boom",
			frames: [{ origin: SCRIPT_ORIGIN, line: 3, column: 9 }],
		});
		assert.equal(EvaluateResponseSchema.safeParse(reply).success, true);
		const broken = {
			id: 2,
			result: { result: { type: "object" }, exceptionDetails: { text: "x" } },
		};
		assert.equal(EvaluateResponseSchema.safeParse(broken).success, false);
	});

	it("un error de protocolo lleva code y message", () => {
		assert.equal(
			EvaluateResponseSchema.safeParse(protocolErrorReply(3, -32000, "no"))
				.success,
			true,
		);
		assert.equal(
			EvaluateResponseSchema.safeParse({ id: 3, error: { message: "no" } })
				.success,
			false,
		);
	});

	it("la pila acepta marcos del script y del bundle de Figma y rechaza texto suelto", () => {
		const stack = [
			"Error: dentro de Figma",
			`    at get (${FIGMA_BUNDLE_ORIGIN}:42:1337)`,
			`    at ${SCRIPT_ORIGIN}:7:3`,
		].join("\n");
		assert.equal(StackDescriptionSchema.safeParse(stack).success, true);
		assert.equal(
			StackDescriptionSchema.safeParse("Error: x\n  en alguna parte").success,
			false,
		);
	});
});

describe("contrato de los valores de Figma", () => {
	it("el diagnóstico de acceso del adaptador devuelve justo los valores del contrato", () => {
		assert.deepEqual(
			Object.values(FIGMA_ACCESS).sort(),
			[...ACCESS_VALUES].sort(),
		);
		assert.equal(AccessValueSchema.safeParse("editing").success, false);
	});

	it("los tipos de nodo salen del .d.ts de plugin-typings", () => {
		for (const t of ["FRAME", "TEXT", "PAGE", "DOCUMENT", "COMPONENT"]) {
			assert.ok(NODE_TYPES.includes(t), `falta ${t}`);
		}
	});

	it("ids de nodo: «1:2», instancias «I1:2;3:4»; no «abc»", () => {
		assert.equal(NodeIdSchema.safeParse("1:2").success, true);
		assert.equal(NodeIdSchema.safeParse("I12:3;4:5").success, true);
		assert.equal(NodeIdSchema.safeParse("abc").success, false);
	});

	it("un árbol de metadatos con tipo inexistente no cumple", () => {
		const tree = {
			id: "0:1",
			name: "p",
			type: "PAGE",
			children: [{ id: "1:2", name: "f", type: "FRAME" }],
		};
		assert.equal(MetadataNodeSchema.safeParse(tree).success, true);
		assert.equal(
			MetadataNodeSchema.safeParse({ ...tree, type: "INVENTADO" }).success,
			false,
		);
	});

	it("un PNG construido tiene firma e IHDR con sus dimensiones; unos bytes cualquiera no cumplen", () => {
		const png = buildPng(30, 20);
		assert.deepEqual(pngDimensions(png), { width: 30, height: 20 });
		assert.equal(ExportValueSchema.safeParse(exportValue(png)).success, true);
		assert.equal(
			ExportValueSchema.safeParse({ base64: "AAAA" }).success,
			false,
		);
	});

	it("el resultado de un script de escritura declara ids válidos", () => {
		assert.equal(
			WriteResultSchema.safeParse({ createdNodeIds: ["1:2"], otro: 1 }).success,
			true,
		);
		assert.equal(
			WriteResultSchema.safeParse({ createdNodeIds: ["x"] }).success,
			false,
		);
	});
});

describe("contrato de las lecturas del catálogo (M3)", () => {
	const variable = {
		id: "VariableID:1:2",
		name: "color/fondo",
		resolvedType: "COLOR",
		scopes: ["ALL_FILLS"],
		description: "",
		valuesByMode: {
			"1:0": { r: 1, g: 1, b: 1, a: 1 },
			"1:1": { alias: { id: "VariableID:1:3", name: "gris/900" } },
		} as Record<string, unknown>,
	};
	const collection = {
		id: "VariableCollectionId:1:1",
		name: "Tokens",
		modes: [
			{ id: "1:0", name: "Claro" },
			{ id: "1:1", name: "Oscuro" },
		],
		defaultModeId: "1:0",
		variables: [variable],
	};
	const withVariable = (changed: Record<string, unknown>) => ({
		collections: [{ ...collection, variables: [{ ...variable, ...changed }] }],
	});

	it("las variables con modos, valores y alias resueltos cumplen; un alias crudo de Figma no", () => {
		assert.equal(
			VariablesValueSchema.safeParse({ collections: [collection] }).success,
			true,
		);
		const raw = withVariable({
			valuesByMode: {
				...variable.valuesByMode,
				"1:1": { type: "VARIABLE_ALIAS", id: "VariableID:1:3" },
			},
		});
		assert.equal(VariablesValueSchema.safeParse(raw).success, false);
	});

	it("un tipo de variable que no está en plugin-typings no cumple", () => {
		const bad = withVariable({ resolvedType: "INVENTADO" });
		assert.equal(VariablesValueSchema.safeParse(bad).success, false);
	});

	it("los enlaces de un subárbol llevan nodo, campo y variable", () => {
		const bindings = [
			{ nodeId: "10:1", field: "fills", variableId: "VariableID:1:2" },
		];
		assert.equal(
			VariablesValueSchema.safeParse({ collections: [collection], bindings })
				.success,
			true,
		);
		assert.equal(
			VariablesValueSchema.safeParse({
				collections: [collection],
				bindings: [{ nodeId: "x", field: "fills", variableId: "v" }],
			}).success,
			false,
		);
	});

	it("un estilo de pintura cumple; uno de un tipo que no leemos no", () => {
		const paint = {
			id: "S:abc,",
			key: "abc",
			name: "Marca/Primario",
			kind: "paint",
			description: "",
			boundVariables: {},
			value: [{ type: "SOLID", color: { r: 1, g: 0.4, b: 0 }, opacity: 1 }],
		};
		assert.equal(
			StylesValueSchema.safeParse({ styles: [paint] }).success,
			true,
		);
		assert.equal(
			StylesValueSchema.safeParse({ styles: [{ ...paint, kind: "animation" }] })
				.success,
			false,
		);
	});

	it("un set con variantes y propiedades cumple; un tipo de propiedad inventado no", () => {
		const set = {
			id: "20:1",
			key: "k",
			name: "Botón",
			type: "COMPONENT_SET",
			page: "Componentes",
			pageIndex: 1,
			description: "",
			variants: { Tamaño: ["S", "M"] },
			properties: [{ name: "Texto#1:0", type: "TEXT", defaultValue: "Hola" }],
			variantCount: 2,
		};
		assert.equal(
			ComponentsValueSchema.safeParse({ components: [set] }).success,
			true,
		);
		assert.equal(
			ComponentsValueSchema.safeParse({
				components: [
					{
						...set,
						properties: [{ name: "x", type: "INVENTADO", defaultValue: "" }],
					},
				],
			}).success,
			false,
		);
	});

	it("una propiedad SLOT va con defaultValue null; las demás no pueden ir sin valor", () => {
		const set = {
			id: "40:1",
			key: "k",
			name: "Td",
			type: "COMPONENT_SET",
			page: "Tablas",
			pageIndex: 0,
			description: "",
			variants: { Estado: ["Normal"] },
			variantCount: 1,
		};
		const withProperty = (property: object) =>
			ComponentsValueSchema.safeParse({
				components: [{ ...set, properties: [property] }],
			}).success;
		assert.equal(
			withProperty({ name: "Hueco#1:0", type: "SLOT", defaultValue: null }),
			true,
		);
		assert.equal(
			withProperty({ name: "Texto#1:0", type: "TEXT", defaultValue: null }),
			false,
		);
		assert.equal(
			withProperty({ name: "Hueco#1:0", type: "SLOT", defaultValue: "x" }),
			false,
		);
	});

	it("los conteos por frame son enteros no negativos", () => {
		const frame = {
			page: "Pantallas",
			frameId: "30:1",
			frameName: "Inicio",
			counts: { Botón: 3 },
		};
		assert.equal(
			InstancesValueSchema.safeParse({ frames: [frame] }).success,
			true,
		);
		assert.equal(
			InstancesValueSchema.safeParse({
				frames: [{ ...frame, counts: { Botón: -1 } }],
			}).success,
			false,
		);
	});

	it("los bytes exportados llevan la firma de su formato (PNG, JPG, SVG, PDF)", () => {
		const cases = [
			["PNG", buildPng(4, 3)],
			["JPG", buildJpg()],
			["SVG", buildSvg(4, 3)],
			["PDF", buildPdf()],
		] as const;
		for (const [format, bytes] of cases) {
			const value = {
				nodes: [{ nodeId: "10:1", base64: bytes.toString("base64") }],
			};
			assert.equal(
				exportNodesSchema(format).safeParse(value).success,
				true,
				format,
			);
		}
		const pngAsSvg = {
			nodes: [{ nodeId: "10:1", base64: buildPng(4, 3).toString("base64") }],
		};
		assert.equal(exportNodesSchema("SVG").safeParse(pngAsSvg).success, false);
	});
});

describe("contrato del channel", () => {
	it("la notificación lleva content y meta con claves identificador", () => {
		const n = {
			method: "notifications/claude/channel",
			params: { content: "hola", meta: { chat_id: "1" } },
		};
		assert.equal(ChannelNotificationSchema.safeParse(n).success, true);
		assert.equal(PanelChannelNotificationSchema.safeParse(n).success, true);
		const dashed = {
			...n,
			params: { content: "hola", meta: { "chat-id": "1" } },
		};
		assert.equal(
			ChannelNotificationSchema.safeParse(dashed).success,
			false,
			"las claves con guion se descartan en silencio",
		);
	});

	it("el panel exige chat_id", () => {
		const n = {
			method: "notifications/claude/channel",
			params: { content: "hola", meta: { otra: "1" } },
		};
		assert.equal(PanelChannelNotificationSchema.safeParse(n).success, false);
	});
});

describe("contrato del relevo de permisos del channel", () => {
	const request = {
		method: "notifications/claude/channel/permission_request",
		params: {
			request_id: "abcde",
			tool_name: "Bash",
			description: "Run shell command",
			input_preview: '{"command":"ls"}',
		},
	};

	it("la petición lleva request_id de cinco letras sin l, tool_name, description e input_preview", () => {
		assert.equal(
			PermissionRequestNotificationSchema.safeParse(request).success,
			true,
		);
		for (const bad of ["abcd", "abcdef", "abcle", "ABCDE", "ab1de"]) {
			assert.equal(
				PermissionRequestNotificationSchema.safeParse({
					...request,
					params: { ...request.params, request_id: bad },
				}).success,
				false,
				bad,
			);
		}
		const { input_preview: _omitted, ...incomplete } = request.params;
		assert.equal(
			PermissionRequestNotificationSchema.safeParse({
				...request,
				params: incomplete,
			}).success,
			false,
		);
	});
});

describe("contrato del script con params y assets", () => {
	it("el eco de la sonda lleva los params y la longitud del asset en bytes", () => {
		const echo = paramsEcho({ page: "App", n: 3 }, 5);
		assert.equal(ParamsEchoSchema.safeParse(echo).success, true);
		assert.deepEqual(echo, {
			params: { page: "App", n: 3 },
			assetLength: 5,
		});
	});
});

describe("contrato del lanzamiento", () => {
	it("el token son 64 hexadecimales y el lanzamiento trae su plazo", () => {
		assert.equal(TokenSchema.safeParse("a".repeat(64)).success, true);
		assert.equal(TokenSchema.safeParse("xyz").success, false);
		assert.equal(
			LaunchedSchema.safeParse({
				launchId: "x",
				startedAt: new Date().toISOString(),
				timeoutMs: 1000,
			}).success,
			true,
		);
	});
});

describe("contratos de la captura de la web", () => {
	const project = () => projectExample() as Record<string, unknown>;
	const screens = () => screensExample() as Record<string, unknown>;
	const capture = () => captureExample() as Record<string, unknown>;
	const firstNode = (c: Record<string, unknown>) =>
		(c["variants"] as { nodes: Record<string, unknown>[] }[])[0]?.nodes[0] ??
		{};

	it("cita su fuente", () => {
		assert.ok(
			CAPTURE_CONTRACT_SOURCES.some((s) =>
				s.includes("docs/users/contracts.md"),
			),
		);
	});

	it("project@1: el ejemplo cumple; una clave de más o una baseUrl que no es http no", () => {
		assert.equal(ProjectSchema.safeParse(project()).success, true);
		assert.equal(
			ProjectSchema.safeParse({ ...project(), extra: 1 }).success,
			false,
		);
		const web = project()["web"] as Record<string, unknown>;
		assert.equal(
			ProjectSchema.safeParse({
				...project(),
				web: { ...web, baseUrl: "file:///etc" },
			}).success,
			false,
		);
	});

	it("project@1 (F4b): `recognize` es la ruta de un módulo, opcional y no vacía", () => {
		assert.equal(
			ProjectSchema.safeParse({ ...project(), recognize: "recognize.js" })
				.success,
			true,
		);
		assert.equal(
			ProjectSchema.safeParse({ ...project(), recognize: "" }).success,
			false,
		);
		assert.equal(
			ProjectSchema.safeParse({ ...project(), recognize: 3 }).success,
			false,
		);
	});

	it("project@1: un usuario sin secretRef no cumple (nunca una contraseña)", () => {
		const web = project()["web"] as Record<string, unknown>;
		const users = { lector: { username: "lector", password: "x" } };
		assert.equal(
			ProjectSchema.safeParse({ ...project(), web: { ...web, users } }).success,
			false,
		);
	});

	it("project@1: ningún campo pide atributos del HTML (P2, CA-3)", () => {
		const json =
			JSON.stringify(z.toJSONSchema(ProjectSchema)) +
			JSON.stringify(z.toJSONSchema(ScreensSchema));
		assert.doesNotMatch(json, /data-/);
	});

	it("screens@1: el ejemplo cumple; una acción con clic y evaluateInPage a la vez no", () => {
		assert.equal(ScreensSchema.safeParse(screens()).success, true);
		const bad = {
			contract: "screens@1",
			screens: [
				{
					key: "x",
					title: "X",
					url: "/",
					variants: [{ props: {}, run: [{ click: "a", evaluateInPage: "1" }] }],
				},
			],
		};
		assert.equal(ScreensSchema.safeParse(bad).success, false);
	});

	it("screens@1: una clave repetida o una url que no empieza por / no cumple", () => {
		const one = { key: "x", title: "X", url: "/" };
		assert.equal(
			ScreensSchema.safeParse({ contract: "screens@1", screens: [one, one] })
				.success,
			false,
		);
		assert.equal(
			ScreensSchema.safeParse({
				contract: "screens@1",
				screens: [{ ...one, url: "http://otra.web/" }],
			}).success,
			false,
		);
	});

	it("capture@1: el ejemplo cumple; una clave de más en un nodo no", () => {
		assert.equal(CaptureSchema.safeParse(capture()).success, true);
		const c = capture();
		const node = firstNode(c);
		node["inventado"] = 1;
		assert.equal(CaptureSchema.safeParse(c).success, false);
	});

	it("capture@1: una imagen con data: en vez de ref no cumple", () => {
		const c = capture();
		const img = (firstNode(c)["kids"] as Record<string, unknown>[])[1] ?? {};
		delete img["ref"];
		img["data"] = "data:image/png;base64,AAAA";
		assert.equal(CaptureSchema.safeParse(c).success, false);
	});

	it("capture@1: un nodo sin w o con un id que no son 8 hexadecimales no cumple", () => {
		const noW = capture();
		delete firstNode(noW)["w"];
		assert.equal(CaptureSchema.safeParse(noW).success, false);
		const badId = capture();
		firstNode(badId)["id"] = "main";
		assert.equal(CaptureSchema.safeParse(badId).success, false);
	});
});

describe("contrato del paso step@1", () => {
	const step = () => stepExample() as Record<string, unknown>;

	it("cita su fuente", () => {
		assert.ok(
			STEP_CONTRACT_SOURCES.some((s) => s.includes("docs/users/contracts.md")),
		);
	});

	it("el ejemplo cumple, y también lo mínimo: dos listas de ids", () => {
		assert.equal(StepResultSchema.safeParse(step()).success, true);
		assert.equal(
			StepResultSchema.safeParse({ createdNodeIds: [], mutatedNodeIds: [] })
				.success,
			true,
		);
	});

	it("faltan las listas obligatorias: no cumple", () => {
		assert.equal(StepResultSchema.safeParse({}).success, false);
		assert.equal(
			StepResultSchema.safeParse({ createdNodeIds: [] }).success,
			false,
		);
	});

	it("un id que no es texto o una clave de más no cumple", () => {
		assert.equal(
			StepResultSchema.safeParse({ ...step(), createdNodeIds: ["1:2", 3] })
				.success,
			false,
		);
		assert.equal(
			StepResultSchema.safeParse({ ...step(), inventado: 1 }).success,
			false,
		);
	});

	it("un aviso sin código o con una clave de más no cumple", () => {
		const bad = (warning: unknown) =>
			StepResultSchema.safeParse({ ...step(), warnings: [warning] }).success;
		assert.equal(bad({ message: "x" }), false);
		assert.equal(bad({ code: "A", message: "x", otro: 1 }), false);
		assert.equal(bad({ code: "A", message: "x" }), true);
	});

	it("`report` es un objeto libre, no una lista ni un texto", () => {
		assert.equal(
			StepResultSchema.safeParse({ ...step(), report: [1] }).success,
			false,
		);
		assert.equal(
			StepResultSchema.safeParse({ ...step(), report: "x" }).success,
			false,
		);
	});
});

describe("contrato areas@1", () => {
	const areas = () => structuredClone(areasExample()) as Loose;
	const valid = (value: unknown) => AreasSchema.safeParse(value).success;

	it("cita su fuente", () => {
		assert.ok(
			AREAS_CONTRACT_SOURCES.some((s) => s.includes("docs/users/contracts.md")),
		);
	});

	it("el ejemplo cumple, en los dos modos de colocar", () => {
		assert.equal(valid(areas()), true);
		const modes = (areas()["areas"] as { place: { mode: string } }[]).map(
			(a) => a.place.mode,
		);
		assert.deepEqual(modes, ["replace-content", "transplant"]);
	});

	it("una clave de más en cualquier nivel no cumple", () => {
		for (const edit of [
			(a: Loose) => (a["inventado"] = 1),
			(a: Loose) => (a["linkRules"].extra = 1),
			(a: Loose) => (a["areas"][0].frame.extra = 1),
			(a: Loose) => (a["shared"][0].page.extra = 1),
		]) {
			const a = areas();
			edit(a);
			assert.equal(valid(a), false);
		}
	});

	it("un modo que no existe (`graft` queda fuera, D-5) o un `take` que no existe no cumplen", () => {
		const a = areas();
		a["areas"][0].place.mode = "graft";
		assert.equal(valid(a), false);
		const b = areas();
		b["areas"][0].place.source.take = "last-frame";
		assert.equal(valid(b), false);
	});

	it("un enlace es por texto o por filas: sin ninguna de las dos no cumple, y `rows` solo vale true", () => {
		const a = areas();
		a["areas"][0].links[0] = { from: "inicio", to: "detalle" };
		assert.equal(valid(a), false);
		const b = areas();
		b["areas"][0].links[2] = { from: "inicio", rows: false, to: "detalle" };
		assert.equal(valid(b), false);
	});

	it("`match` solo admite exact, start o contains", () => {
		const a = areas();
		a["areas"][0].links[1].match = "regex";
		assert.equal(valid(a), false);
	});

	it("la transición solo admite los tipos y las curvas de Figma", () => {
		const a = areas();
		a["linkRules"].transition.type = "FLIP";
		assert.equal(valid(a), false);
		const b = areas();
		b["linkRules"].transition.easing = "BOUNCE";
		assert.equal(valid(b), false);
	});

	it("`areas` no puede estar vacío ni repetir nombres", () => {
		const a = areas();
		a["areas"] = [];
		assert.equal(valid(a), false);
		const b = areas();
		b["areas"][1].name = "Panel";
		assert.equal(valid(b), false);
	});

	it("los nombres de capa son listas, no texto", () => {
		const a = areas();
		a["areas"][0].main = "principal";
		assert.equal(valid(a), false);
		const b = areas();
		b["areas"][0].shell.in = "lateral";
		assert.equal(valid(b), false);
	});

	it("el tamaño mínimo de un relleno son dos números", () => {
		const a = areas();
		a["areas"][0].fills[0].find.minSize = [200];
		assert.equal(valid(a), false);
	});

	it("sin `contract` o con otro nombre no cumple", () => {
		const a = areas();
		delete a["contract"];
		assert.equal(valid(a), false);
		const b = areas();
		b["contract"] = "areas@2";
		assert.equal(valid(b), false);
	});
});

describe("contrato map@1", () => {
	const map = () => structuredClone(mapExample()) as Loose;
	const valid = (value: unknown) => MapSchema.safeParse(value).success;

	it("cita su fuente y el ejemplo cumple", () => {
		assert.ok(
			MAP_CONTRACT_SOURCES.some((s) => s.includes("docs/users/contracts.md")),
		);
		assert.equal(valid(map()), true);
	});

	it("una clave de más en cualquier nivel no cumple", () => {
		for (const edit of [
			(m: Loose) => (m["inventado"] = 1),
			(m: Loose) => (m["tokens"].extra = 1),
			(m: Loose) => (m["fonts"].italic.extra = 1),
			(m: Loose) => (m["icons"].extra = 1),
			(m: Loose) => (m["layers"].extra = 1),
		]) {
			const m = map();
			edit(m);
			assert.equal(valid(m), false);
		}
	});

	it("`textPrefix` es booleano y los roles son texto a texto", () => {
		const a = map();
		a["layers"].textPrefix = "sí";
		assert.equal(valid(a), false);
		const b = map();
		b["layers"].roles = { p: 1 };
		assert.equal(valid(b), false);
	});

	it("sin `contract` o con otro nombre no cumple", () => {
		const a = map();
		delete a["contract"];
		assert.equal(valid(a), false);
		const b = map();
		b["contract"] = "map@2";
		assert.equal(valid(b), false);
	});

	it("F4b: `components` (huellas, hojas y clases genéricas) y `screens` (reglas por pantalla) cumplen y son estrictos", () => {
		const ok = map();
		ok["components"] = {
			fingerprints: "fingerprints.json",
			leaf: ["a.b"],
			genericClasses: ["flex", "items-\\S+"],
		};
		ok["screens"] = { inicio: { rules: ["Button", "Tab"] }, otra: {} };
		assert.equal(valid(ok), true);
		for (const edit of [
			(m: Loose) => (m["components"].extra = 1),
			(m: Loose) => delete m["components"].leaf,
			(m: Loose) => (m["components"].fingerprints = ""),
			(m: Loose) => (m["components"].genericClasses = [1]),
			(m: Loose) => (m["screens"].inicio.extra = 1),
			(m: Loose) => (m["screens"].inicio.rules = "Button"),
			(m: Loose) => (m["screens"].inicio.rules = [""]),
		]) {
			const bad = structuredClone(ok);
			edit(bad);
			assert.equal(valid(bad), false);
		}
	});
});

describe("contrato screen@1", () => {
	const plan = () => structuredClone(screenPlanExample()) as Loose;
	const valid = (value: unknown) => ScreenPlanSchema.safeParse(value).success;

	it("cita su fuente y el ejemplo cumple", () => {
		assert.ok(
			SCREEN_CONTRACT_SOURCES.some((s) =>
				s.includes("docs/users/contracts.md"),
			),
		);
		assert.equal(valid(plan()), true);
	});

	it("F4b: las huellas de los componentes hoja, las reglas, las clases genéricas y el hash de recognize cumplen", () => {
		const p = plan();
		p["fingerprints"] = {
			"a.b": {
				title: "Tarjeta",
				tag: "div",
				cls: ["x"],
				opt: ["y"],
				cond: { "p-4": ["size", "sm"] },
				defaults: { size: "md" },
				alias: { a: "b" },
				sig: { tag: "h3", cls: ["font-bold"] },
				sig_cond: null,
			},
		};
		p["rules"] = ["Button"];
		p["map"].components = { genericClasses: ["flex"] };
		p["sources"].recognize = { sha256: "d".repeat(64) };
		assert.equal(valid(p), true);
		for (const edit of [
			(x: Loose) => delete x["fingerprints"]["a.b"].tag,
			(x: Loose) => (x["fingerprints"]["a.b"].cond["p-4"] = ["solo uno"]),
			(x: Loose) => (x["rules"] = [3]),
			(x: Loose) => (x["map"].components.fingerprints = "fp.json"),
			(x: Loose) => (x["sources"].recognize.sha256 = "corto"),
		]) {
			const bad = structuredClone(p);
			edit(bad);
			assert.equal(valid(bad), false);
		}
	});

	it("una variante negativa, un aviso sin mensaje o un destino sin clave no cumplen", () => {
		const a = plan();
		a["variant"] = -1;
		assert.equal(valid(a), false);
		const b = plan();
		delete b["warnings"][0].message;
		assert.equal(valid(b), false);
		const c = plan();
		delete c["target"].frame.key;
		assert.equal(valid(c), false);
	});
});

describe("screens@1 para componentes", () => {
	const screens = () => structuredClone(screensExample()) as Loose;
	const valid = (value: unknown) => ScreensSchema.safeParse(value).success;

	it("query por variante y viewport por pantalla valen", () => {
		const f = screens();
		f.screens[1].viewport = { w: 320, h: 480 };
		f.screens[1].variants[0].query = { size: "sm", _slot: "Hola mundo" };
		assert.equal(valid(f), true);
	});

	it("una clave de query vacía no vale", () => {
		const f = screens();
		f.screens[1].variants[0].query = { "": "x" };
		assert.equal(valid(f), false);
	});

	it("un viewport con w o h menor que 1, o con una clave de más, no vale", () => {
		for (const viewport of [
			{ w: 0, h: 10 },
			{ w: 10, h: 0 },
			{ w: 1, h: 1, z: 1 },
		]) {
			const f = screens();
			f.screens[1].viewport = viewport;
			assert.equal(valid(f), false);
		}
	});

	it("viewport por variante: vale con w y h de 1 o más; con cero o una clave de más no", () => {
		const f = screens();
		f.screens[1].variants[0].viewport = { w: 375, h: 800 };
		assert.equal(valid(f), true);
		for (const viewport of [
			{ w: 0, h: 10 },
			{ w: 10, h: 0 },
			{ w: 1, h: 1, z: 1 },
		]) {
			const g = screens();
			g.screens[1].variants[0].viewport = viewport;
			assert.equal(valid(g), false);
		}
	});

	it("`force`: hover, focus, focus-visible y active sobre un selector valen; lo demás no", () => {
		for (const state of ["hover", "focus", "focus-visible", "active"]) {
			const f = screens();
			f.screens[1].variants[0].force = [{ selector: "button", state }];
			assert.equal(valid(f), true, state);
		}
		const two = screens();
		two.screens[1].variants[0].force = [
			{ selector: "button", state: "hover" },
			{ selector: "button", state: "active" },
		];
		assert.equal(valid(two), true);
		for (const force of [
			[],
			[{ selector: "", state: "hover" }],
			[{ selector: "button", state: "visited" }],
			[{ selector: "button" }],
			[{ state: "hover" }],
			[{ selector: "button", state: "hover", extra: 1 }],
			"hover",
		]) {
			const f = screens();
			f.screens[1].variants[0].force = force;
			assert.equal(valid(f), false, JSON.stringify(force));
		}
	});

	it("un valor de query que no es texto no vale", () => {
		const f = screens();
		f.screens[1].variants[0].query = { a: 1 };
		assert.equal(valid(f), false);
	});

	it("project@1 admite `sheets` y rechaza que no sea texto", () => {
		const p = structuredClone(projectExample()) as Loose;
		p.sheets = "sheets.json";
		assert.equal(ProjectSchema.safeParse(p).success, true);
		p.sheets = 3;
		assert.equal(ProjectSchema.safeParse(p).success, false);
	});
});

describe("contrato sheets@1", () => {
	const sheets = () => structuredClone(sheetsExample()) as Loose;
	const valid = (value: unknown) => SheetsSchema.safeParse(value).success;

	it("cita su fuente", () => {
		assert.ok(
			SHEETS_CONTRACT_SOURCES.some((s) =>
				s.includes("docs/users/contracts.md"),
			),
		);
	});

	it("el ejemplo cumple con todos sus campos opcionales", () => {
		assert.equal(valid(sheets()), true);
		assert.deepEqual(sheetsSchemaIssues(sheets()), []);
	});

	it("una clave de más en cualquier nivel no cumple y el puntero la sitúa", () => {
		for (const [edit, pointer] of [
			[(f: Loose) => (f.inventada = 1), ""],
			[(f: Loose) => (f.style.header.extra = 1), "/style/header"],
			[(f: Loose) => (f.sheets[0].extra = 1), "/sheets/0"],
			[(f: Loose) => (f.sheets[0].icons[0].extra = 1), "/sheets/0/icons/0"],
		] as const) {
			const f = sheets();
			edit(f);
			assert.equal(valid(f), false);
			assert.equal(sheetsSchemaIssues(f)[0]?.pointer, pointer);
		}
	});

	it("lo mínimo de una hoja (clave, pantalla, título, página y descripción) basta", () => {
		const f = sheets();
		f.sheets = [
			{
				key: "a",
				screen: "cmp-a",
				title: "A",
				page: { name: "A" },
				description: "d",
			},
		];
		assert.equal(valid(f), true);
	});

	it("falta el estilo, o una variable vacía, o un align inventado: no cumple", () => {
		const noStyle = sheets();
		delete noStyle.style;
		assert.equal(valid(noStyle), false);
		const empty = sheets();
		empty.style.card.fill = "";
		assert.equal(valid(empty), false);
		const align = sheets();
		align.sheets[0].matrix.align = "bottom";
		assert.equal(valid(align), false);
	});

	it("una clave de hoja con barras o espacios no vale (nombra ficheros del plan)", () => {
		for (const key of ["a/b", "a b", "", ".x"]) {
			const f = sheets();
			f.sheets[0].key = key;
			assert.equal(valid(f), false, key);
		}
	});

	it("`drift`: figma, web y map con su huella (con sus capas a mano) valen; map pide `values` no vacío y las otras dos no los admiten", () => {
		const fp = {
			variantProps: { align: ["left", "right"], card: ["no", "title"] },
			variants: ["align=left, card=no"],
			properties: ["contenido"],
			layers: [
				{
					name: "icono",
					type: "INSTANCE",
					properties: ["Icono", "Mostrar icono"],
					variants: ["align=left, card=no"],
				},
			],
		};
		for (const drift of [
			{ decision: "figma", fingerprint: fp },
			{ decision: "web", fingerprint: fp },
			{ decision: "map", values: { card: "no" }, fingerprint: fp },
		]) {
			const f = sheets();
			f.sheets[1].drift = drift;
			assert.equal(valid(f), true, JSON.stringify(drift));
		}
		for (const drift of [
			{ decision: "map", fingerprint: fp },
			{ decision: "map", values: {}, fingerprint: fp },
			{ decision: "map", values: { card: "" }, fingerprint: fp },
			{ decision: "figma", values: { card: "no" }, fingerprint: fp },
			{ decision: "web", fingerprint: undefined },
			{ decision: "otra", fingerprint: fp },
			{ decision: "web", fingerprint: { ...fp, extra: 1 } },
			{ decision: "web", fingerprint: { variants: [], properties: [] } },
			{ decision: "web", fingerprint: { ...fp, layers: undefined } },
			{
				decision: "web",
				fingerprint: { ...fp, layers: [{ name: "icono", type: "INSTANCE" }] },
			},
			{ fingerprint: fp },
		]) {
			const f = sheets();
			f.sheets[1].drift = drift;
			assert.equal(valid(f), false, JSON.stringify(drift));
		}
	});

	it("un fichero que no es un objeto da un problema en la raíz", () => {
		assert.deepEqual(sheetsSchemaIssues([]), [
			{ pointer: "", message: "no es un objeto" },
		]);
	});
});

describe("contrato component@1", () => {
	const plan = () => structuredClone(componentPlanExample()) as Loose;
	const valid = (value: unknown) =>
		ComponentPlanSchema.safeParse(value).success;

	it("cita su fuente", () => {
		assert.ok(
			COMPONENT_CONTRACT_SOURCES.some((s) =>
				s.includes("docs/users/contracts.md"),
			),
		);
	});

	it("el ejemplo cumple", () => {
		assert.equal(valid(plan()), true);
	});

	it("una clave de más en el plan, en sus fuentes o en la matriz no cumple", () => {
		for (const edit of [
			(p: Loose) => (p.inventada = 1),
			(p: Loose) => (p.sources.sheets.extra = 1),
			(p: Loose) => (p.matrix.extra = 1),
			(p: Loose) => (p.target.set.extra = 1),
			(p: Loose) => (p.variants[0].extra = 1),
		]) {
			const p = plan();
			edit(p);
			assert.equal(valid(p), false);
		}
	});

	it("la hoja del plan tiene que ser una entrada válida de sheets@1", () => {
		const p = plan();
		p.sheet.matrix.align = "bottom";
		assert.equal(valid(p), false);
	});

	it("falta la matriz, las fuentes de sheets o las variantes: no cumple", () => {
		for (const key of ["matrix", "variants", "style"]) {
			const p = plan();
			delete p[key];
			assert.equal(valid(p), false);
		}
		const p = plan();
		delete p.sources.sheets;
		assert.equal(valid(p), false);
	});

	it("un código de aviso desconocido no cumple; FINGERPRINT_WITHOUT_SHEET sí", () => {
		const p = plan();
		p.warnings = [{ code: "FINGERPRINT_WITHOUT_SHEET", message: "x" }];
		assert.equal(valid(p), true);
		p.warnings = [{ code: "INVENTADO", message: "x" }];
		assert.equal(valid(p), false);
	});
});
