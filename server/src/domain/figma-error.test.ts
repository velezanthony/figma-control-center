import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	areasContractError,
	assetReadError,
	callTimeout,
	chromeUnreachable,
	contractError,
	FIGMA_NOT_READY_REASON,
	type FigmaError,
	figmaNotReady,
	figmaTabNotFound,
	manifestError,
	nodeNotFound,
	paramsTooLargeError,
	projectConfigError,
	scriptError,
	scriptReadError,
	secretMissing,
	stateNotReached,
	stepContractError,
	unexpectedScriptError,
	WEB_PAGE_REASON,
	webPageError,
} from "./figma-error.ts";

const PROJECT_URL = "https://www.figma.com/design/abc123/Mi-archivo";

type Case = {
	readonly name: string;
	readonly error: FigmaError;
	readonly retryable: boolean;
	readonly nextStep: RegExp;
};

// La regla de retryable: entrada → false; entorno → true; incierto → false
const CASES: readonly Case[] = [
	{
		name: "ruta del script",
		error: scriptReadError("../x.js", "fuera de las raíces."),
		retryable: false,
		nextStep: /Corrige la ruta/,
	},
	{
		name: "manifiesto (clave desconocida): el nextStep lleva el detalle, no la ruta",
		error: manifestError("m.json", "no cumple el esquema: clave desconocida"),
		retryable: false,
		nextStep: /manifiesto.*clave desconocida/,
	},
	{
		name: "asset",
		error: assetReadError("a.png", "no existe."),
		retryable: false,
		nextStep: /asset/,
	},
	{
		name: "params por encima del tope",
		error: paramsTooLargeError(10, 5),
		retryable: false,
		nextStep: /Reduce los params o pásalos como asset/,
	},
	{
		name: "error de sintaxis",
		error: scriptError("SyntaxError", 3, true),
		retryable: false,
		nextStep: /sintaxis/,
	},
	{
		name: "excepción del script",
		error: scriptError("boom", 3, false),
		retryable: false,
		nextStep: /excepción/,
	},
	{
		name: "fallo inesperado al ejecutar",
		error: unexpectedScriptError(new Error("x")),
		retryable: false,
		nextStep: /excepción|script/,
	},
	{
		name: "Chrome",
		error: chromeUnreachable("127.0.0.1:9222"),
		retryable: true,
		nextStep: /chrome\.sh|make chrome/,
	},
	{
		name: "pestaña no encontrada",
		error: figmaTabNotFound(PROJECT_URL),
		retryable: true,
		nextStep: new RegExp(`${PROJECT_URL}.*Proyectos`),
	},
	{
		name: "cargando",
		error: figmaNotReady(1000, FIGMA_NOT_READY_REASON.loading, PROJECT_URL),
		retryable: true,
		nextStep: new RegExp(`${PROJECT_URL}.*Proyectos`),
	},
	{
		name: "sin sesión: necesita a una persona",
		error: figmaNotReady(0, FIGMA_NOT_READY_REASON.notLoggedIn, PROJECT_URL),
		retryable: true,
		nextStep: /make login[\s\S]*persona|persona[\s\S]*make login/,
	},
	{
		name: "solo lectura: necesita a una persona",
		error: figmaNotReady(0, FIGMA_NOT_READY_REASON.viewOnly, PROJECT_URL),
		retryable: true,
		nextStep: /persona[\s\S]*permiso de edición/,
	},
	{
		name: "nodo inexistente",
		error: nodeNotFound("9:9"),
		retryable: false,
		nextStep: /figma_metadata/,
	},
	{
		name: "plazo vencido: incierto",
		error: callTimeout(1000),
		retryable: false,
		nextStep: /figma_get_job/,
	},
	{
		name: "secreto que falta: necesita a una persona, con el nombre y el fichero",
		error: secretMissing("qa-lector", "/home/x/secretos.json"),
		retryable: false,
		nextStep: /persona[\s\S]*qa-lector[\s\S]*\/home\/x\/secretos\.json/,
	},
];

describe("regla única de retryable y nextStep", () => {
	for (const c of CASES) {
		it(`${c.name}: retryable ${c.retryable}`, () => {
			assert.equal(c.error.retryable, c.retryable);
			assert.match(c.error.nextStep, c.nextStep);
		});
	}

	it("ningún nextStep manda a revisar FIGMA_FILE_URL ni el .env", () => {
		for (const c of CASES) {
			assert.doesNotMatch(c.error.nextStep, /FIGMA_FILE_URL|\.env/, c.name);
		}
	});

	it("el nextStep de cada causa de entrada es distinto del de las demás", () => {
		const inputs = CASES.slice(0, 6).map((c) => c.error.nextStep);
		assert.equal(new Set(inputs).size, inputs.length);
	});
});

describe("secreto que falta", () => {
	it("nombra el secretRef y el motivo, nunca un valor", () => {
		const e = secretMissing("qa-lector", "/s.json", "el fichero no existe");
		assert.equal(e.type, "SecretMissing");
		assert.equal(e.type === "SecretMissing" && e.secretRef, "qa-lector");
		assert.match(e.message, /qa-lector[\s\S]*el fichero no existe/);
	});
});

describe("errores de la página web", () => {
	it("WebPageError lleva su motivo; un login fallido no se arregla repitiendo", () => {
		const e = webPageError(WEB_PAGE_REASON.login, "sigue en /entrar/");
		assert.equal(e.type, "WebPageError");
		assert.equal(e.type === "WebPageError" && e.reason, "login");
		assert.equal(e.retryable, false);
		assert.match(e.nextStep, /usuario|contraseña/);
	});

	it("salir de baseUrl dice la URL y que no se sigue", () => {
		const e = webPageError(WEB_PAGE_REASON.navigation, "http://otra.web/");
		assert.match(e.message, /otra\.web/);
		assert.equal(e.retryable, false);
	});

	it("el Chrome de captura (puerto ocupado o que no arranca) es del entorno: reintentable", () => {
		const e = webPageError(
			WEB_PAGE_REASON.chrome,
			"el puerto 9333 ya contesta",
		);
		assert.equal(e.retryable, true);
		assert.match(e.nextStep, /FCC_WEB_CHROME/);
	});

	it("StateNotReached nombra la condición y el plazo", () => {
		const e = stateNotReached("document.querySelector('#x')", 500);
		assert.equal(e.type, "StateNotReached");
		assert.match(e.message, /#x[\s\S]*500/);
		assert.equal(e.retryable, false);
	});
});

describe("errores de la configuración y del contrato de la captura", () => {
	it("ProjectConfigError nombra el fichero y el campo, y dice corregirlo", () => {
		const e = projectConfigError(
			"/p/figma-control-center.json",
			"web.baseUrl",
			"no es una URL",
		);
		assert.equal(e.type, "ProjectConfigError");
		assert.equal(e.type === "ProjectConfigError" && e.field, "web.baseUrl");
		assert.match(
			e.message,
			/figma-control-center\.json[\s\S]*web\.baseUrl[\s\S]*no es una URL/,
		);
		assert.equal(e.retryable, false);
		assert.match(e.nextStep, /web\.baseUrl/);
	});

	it("ContractError cuenta las capturas rechazadas y dice dónde están sus errores", () => {
		const e = contractError(
			2,
			"/s/web-captures/rejected/2026-11-11/inicio_100000.errors.json",
		);
		assert.equal(e.type, "ContractError");
		assert.match(e.message, /2[\s\S]*capture@1[\s\S]*errors\.json/);
		assert.equal(e.retryable, false);
	});

	it("ContractError de step@1: el puntero del primer fallo en `path`, los tres primeros en el mensaje y no reintentable", () => {
		const e = stepContractError([
			{ pointer: "/createdNodeIds/2", message: "no es texto" },
			{ pointer: "/mutatedNodeIds", message: "falta" },
			{ pointer: "/warnings/0/code", message: "está vacío" },
			{ pointer: "/report", message: "no es un objeto" },
		]);
		assert.equal(e.type, "ContractError");
		assert.equal(e.type === "ContractError" && e.path, "/createdNodeIds/2");
		assert.match(
			e.message,
			/step@1.*\/createdNodeIds\/2: no es texto.*\/mutatedNodeIds: falta/,
		);
		assert.match(e.message, /y 1 más/);
		assert.equal(e.retryable, false);
		assert.match(e.nextStep, /ya corrió/);
	});

	it("ContractError de step@1 en la raíz usa «/» como ruta", () => {
		const e = stepContractError([{ pointer: "", message: "no es un objeto" }]);
		assert.equal(e.type === "ContractError" && e.path, "/");
		assert.match(e.message, /\/: no es un objeto/);
	});
});

describe("areasContractError", () => {
	it("nombra el fichero y el puntero del primer fallo, y es reintentable: no se tocó nada", () => {
		const e = areasContractError("/p/areas.json", [
			{ pointer: "/areas/0/place/mode", message: "no vale" },
			{ pointer: "/areas/1/name", message: "repetida" },
		]);
		assert.equal(e.type, "ContractError");
		assert.equal(e.type === "ContractError" && e.path, "/areas/0/place/mode");
		assert.match(
			e.message,
			/areas\.json.*areas@1.*\/areas\/0\/place\/mode: no vale.*\/areas\/1\/name/,
		);
		assert.equal(e.retryable, true);
		assert.match(e.nextStep, /no se tocó nada/);
	});
});
