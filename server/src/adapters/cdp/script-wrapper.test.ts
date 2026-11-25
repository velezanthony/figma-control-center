import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createContext, Script } from "node:vm";
import { SCRIPT_FORMAT } from "#application/ports/figma-gateway.ts";
import { KIT_STEPS, kitStepCode } from "#domain/step.ts";
import { toScriptError } from "./script-error.ts";
import { wrapScript } from "./script-wrapper.ts";

describe("wrapScript", () => {
	it("body: expone params como JSON y assets como figma.base64Decode", () => {
		const { expression, lineOffset } = wrapScript({
			code: "return params.page;",
			format: SCRIPT_FORMAT.body,
			params: { page: "App" },
			assets: { mapa: Uint8Array.from([1, 2, 3]) },
		});
		assert.match(expression, /const params = \{"page":"App"\};/);
		assert.match(
			expression,
			/const assets = \{"mapa":figma\.base64Decode\("AQID"\)\};/,
		);
		// El código del usuario queda en la segunda línea: offset 1
		assert.equal(lineOffset, 1);
	});

	it("function: invoca la expresión con (params, assets)", () => {
		const { expression, lineOffset } = wrapScript({
			code: "async (params, assets) => { return params.n; }",
			format: SCRIPT_FORMAT.function,
			params: { n: 7 },
			assets: { logo: Uint8Array.from([255]) },
		});
		assert.match(
			expression,
			/\)\(\{"n":7\}, \{"logo":figma\.base64Decode\("\/w=="\)\}, globalThis\.__fccFigmaKit\)$/,
		);
		assert.equal(lineOffset, 0);
	});

	it("un script sin params ni assets sigue funcionando en los dos formatos", () => {
		const body = wrapScript({ code: "return 1;", format: SCRIPT_FORMAT.body });
		assert.match(
			body.expression,
			/const params = undefined;const assets = \{\};/,
		);
		assert.equal(body.lineOffset, 1);

		const fn = wrapScript({
			code: "async () => 1;",
			format: SCRIPT_FORMAT.function,
		});
		assert.match(
			fn.expression,
			/\)\(undefined, \{\}, globalThis\.__fccFigmaKit\)$/,
		);
		assert.equal(fn.lineOffset, 0);
	});

	// CA-7: con params/assets inyectados, un error en la primera línea del usuario sigue señalando la línea 1
	it("body: un error en la primera línea del usuario se reporta como línea 1", () => {
		const { lineOffset } = wrapScript({
			code: "throw new Error('x');",
			format: SCRIPT_FORMAT.body,
			params: { a: 1 },
			assets: { b: Uint8Array.from([0]) },
		});
		const error = toScriptError(
			{
				text: "Uncaught (in promise)",
				exception: {
					className: "Error",
					// La primera línea del usuario es la línea 2 de la expresión envuelta (body)
					description: "Error: x\n    at <anonymous>:2:7",
				},
			},
			lineOffset,
		);
		assert.equal(error.type === "ScriptError" && error.line, 1);
	});

	it("function: un error en la primera línea del usuario se reporta como línea 1", () => {
		const { lineOffset } = wrapScript({
			code: "async (params, assets) => { throw new Error('x'); }",
			format: SCRIPT_FORMAT.function,
			params: { a: 1 },
		});
		const error = toScriptError(
			{
				text: "Uncaught (in promise)",
				exception: {
					className: "Error",
					description: "Error: x\n    at <anonymous>:1:35",
				},
			},
			lineOffset,
		);
		assert.equal(error.type === "ScriptError" && error.line, 1);
	});

	// `body` ya declara `params` y `assets` con const: es una limitación conocida, no un fallo a arreglar
	for (const name of ["params", "assets"]) {
		it(`body: un script que declara su propio \`${name}\` da SyntaxError al compilarse`, () => {
			const { expression } = wrapScript({
				code: `const ${name} = 1; return ${name};`,
				format: SCRIPT_FORMAT.body,
			});
			assert.throws(
				() => new Script(expression),
				new RegExp(`SyntaxError.*'${name}' has already been declared`),
			);
		});
	}

	it("body: `kit` es una constante más en la misma primera línea que params y assets (sin mover el offset)", () => {
		const { expression, lineOffset } = wrapScript({
			code: "return kit.version;",
			format: SCRIPT_FORMAT.body,
			params: { a: 1 },
		});
		const [first, second] = expression.split("\n");
		assert.match(
			first ?? "",
			/const params = \{"a":1\};const assets = \{\};const kit = globalThis\.__fccFigmaKit;$/,
		);
		assert.equal(second, "return kit.version;");
		assert.equal(lineOffset, 1);
	});

	it("function: `kit` llega como tercer argumento y el offset sigue en 0", async () => {
		const { expression, lineOffset } = wrapScript({
			code: "async (params, assets, kit) => kit.version",
			format: SCRIPT_FORMAT.function,
		});
		const context = createContext({
			__fccFigmaKit: { version: "figma-kit@1" },
		});
		assert.equal(
			await new Script(expression).runInContext(context),
			"figma-kit@1",
		);
		assert.equal(lineOffset, 0);
	});

	it("los dos formatos pasan el kit instalado en la pestaña al script", async () => {
		const kit = { version: "figma-kit@1" };
		const body = wrapScript({
			code: "return kit.version;",
			format: SCRIPT_FORMAT.body,
		});
		const fn = wrapScript({
			code: "async (params, assets, kit) => kit.version",
			format: SCRIPT_FORMAT.function,
		});
		for (const { expression } of [body, fn]) {
			const context = createContext({ __fccFigmaKit: kit });
			assert.equal(
				await new Script(expression).runInContext(context),
				"figma-kit@1",
			);
		}
	});

	it("body: un script que declara su propio `kit` da SyntaxError al compilarse (se dice en la descripción de la herramienta)", () => {
		const { expression } = wrapScript({
			code: "const kit = 1; return kit;",
			format: SCRIPT_FORMAT.body,
		});
		assert.throws(
			() => new Script(expression),
			/SyntaxError.*'kit' has already been declared/,
		);
	});

	it("function: declarar `params` o `assets` dentro de la función sí es posible", () => {
		const { expression } = wrapScript({
			code: "async () => { const params = 1; const assets = 2; return params + assets; }",
			format: SCRIPT_FORMAT.function,
		});
		assert.doesNotThrow(() => new Script(expression));
	});
});

describe("wrapScript: lo que se envía a la pestaña compila (sin Figma)", () => {
	const compiles = (expression: string) => new Script(expression);

	it("el código fijo de cada paso del kit, con params y assets, es JavaScript válido", () => {
		for (const step of KIT_STEPS) {
			const { expression } = wrapScript({
				code: kitStepCode(step),
				format: SCRIPT_FORMAT.body,
				params: { screen: "a", area: { name: "x" } },
				assets: { plan: Uint8Array.from([1]) },
			});
			assert.doesNotThrow(() => compiles(expression), step);
		}
	});

	it("`build-screen` con un módulo recognize@1 (con comentarios, `;` final y funciones) también compila, y lo evalúa", async () => {
		const sources = [
			'{ contract: "recognize@1", rules: { A: { match: (n) => n.t === "x", props: () => ({ variant: {} }) } } }',
			'{ contract: "recognize@1", rules: {} }; // fin',
			'{ contract: "recognize@1", rules: {} } // sin ; ni salto',
			'/* cabecera */\n{ contract: "recognize@1", rules: {}, after: { A: async (i) => { await i; } } }\n',
		];
		for (const recognize of sources) {
			const { expression } = wrapScript({
				code: kitStepCode("kit/build-screen@1", { recognize }),
				format: SCRIPT_FORMAT.body,
				params: { screen: "a" },
				assets: { plan: Uint8Array.from([1]) },
			});
			assert.doesNotThrow(() => compiles(expression), recognize);
		}
		// y el objeto llega al paso con sus funciones
		const code = kitStepCode("kit/build-screen@1", {
			recognize:
				'{ contract: "recognize@1", rules: { A: { match: () => true } } }',
		}).replace(
			"return await kit.steps.buildScreen(params, assets, recognize);",
			"return recognize;",
		);
		const { expression } = wrapScript({
			code,
			format: SCRIPT_FORMAT.body,
			params: {},
			assets: {},
		});
		const globals = {
			figma: { base64Decode: () => new Uint8Array() },
			__fccFigmaKit: {},
		};
		const fn = new Script(expression).runInNewContext({ ...globals });
		const value = (await fn) as { rules: { A: { match(): boolean } } };
		assert.equal(value.rules.A.match(), true);
	});

	it("`build-component` con un módulo recognize@1 también compila", () => {
		const { expression } = wrapScript({
			code: kitStepCode("kit/build-component@1", {
				recognize: '{ contract: "recognize@1", rules: {} } // fin',
			}),
			format: SCRIPT_FORMAT.body,
			params: { sheet: "button", scratch: true },
			assets: { plan: Uint8Array.from([1]) },
		});
		assert.doesNotThrow(() => compiles(expression));
	});

	it("un cuerpo que declara `params`, `assets` o `kit` otra vez no compila: el envoltorio ya los declara", () => {
		for (const name of ["params", "assets", "kit"]) {
			const { expression } = wrapScript({
				code: `const ${name} = 1; return ${name};`,
				format: SCRIPT_FORMAT.body,
			});
			assert.throws(
				() => compiles(expression),
				/has already been declared/,
				name,
			);
		}
	});
});
