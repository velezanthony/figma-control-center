// E81: pseudoclases forzadas en la captura. Chrome de captura real (el de example-mini, nunca el 9222)
// con una página cuyo estilo cambia con :hover y :focus-visible: la variante con `force` mide el estilo forzado y la que no, el de
// reposo; un selector que no existe corta la pantalla con su error. Sin Figma, sin el proyecto consumidor.
import assert from "node:assert/strict";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { TOOL_NAME } from "#domain/tool-names.ts";
import {
	type CaptureEnvironment,
	startCaptureEnvironment,
} from "../../harness/capture-environment.ts";

let c: CaptureEnvironment | undefined;
afterEach(async () => {
	await c?.stop();
	c = undefined;
});

type Json = Record<string, any>;
const readJson = async (file: string) =>
	JSON.parse(await readFile(file, "utf8")) as Json;

async function withScreen(force: unknown) {
	c = await startCaptureEnvironment({ projectIsScriptsRoot: true });
	const dir = c.env.projects[0]?.projectDir ?? "";
	const file = join(dir, "screens.json");
	const screens = await readJson(file);
	screens["screens"].push({
		key: "cmp-estados",
		title: "Estados",
		url: "/componente/",
		pick: "#cmp",
		variants: [
			{ props: { state: "default" } },
			{ props: { state: "hover" }, force },
		],
	});
	await writeFile(file, JSON.stringify(screens));
	return c;
}

async function captured(e: CaptureEnvironment) {
	const days = await readdir(join(e.outputDir, "web-captures"));
	const day = days.find((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) ?? "";
	const files = await readdir(join(e.outputDir, "web-captures", day));
	const file = files.find((f) => f.startsWith("cmp-estados_")) ?? "";
	return readJson(join(e.outputDir, "web-captures", day, file));
}

describe("E81 · pseudoclases forzadas", () => {
	it(":hover forzado cambia el estilo medido solo en su variante; la de reposo no lo lleva", async () => {
		const e = await withScreen([{ selector: "#cmp", state: "hover" }]);
		const r = await e.claude.callTool(TOOL_NAME.capture, {
			screens: ["cmp-estados"],
		});
		assert.equal(r.isError, false, r.text);
		const stored = await captured(e);
		const [rest, hover] = stored["variants"].map((v: Json) => v["nodes"][0]);
		assert.notDeepEqual(rest["bg"], [0, 128, 0, 1]);
		assert.deepEqual(hover["bg"], [0, 128, 0, 1]);
		assert.deepEqual(
			stored["variants"].map((v: Json) => v["props"]),
			[{ state: "default" }, { state: "hover" }],
		);
	});

	it("dos estados forzados en el mismo elemento se acumulan (:hover y :active: gana la regla de :active) y :focus-visible se acepta", async () => {
		const e = await withScreen([
			{ selector: "#cmp", state: "hover" },
			{ selector: "#cmp", state: "active" },
			{ selector: "#cmp", state: "focus-visible" },
		]);
		const r = await e.claude.callTool(TOOL_NAME.capture, {
			screens: ["cmp-estados"],
		});
		assert.equal(r.isError, false, r.text);
		const stored = await captured(e);
		const [rest, forced] = stored["variants"].map((v: Json) => v["nodes"][0]);
		assert.notDeepEqual(rest["bg"], [128, 0, 0, 1]);
		assert.deepEqual(forced["bg"], [128, 0, 0, 1]);
	});

	it("un selector que no existe corta la pantalla: WebPageError con el selector y sin captura válida", async () => {
		const e = await withScreen([{ selector: "#no-existe", state: "hover" }]);
		const r = await e.claude.callTool(TOOL_NAME.capture, {
			screens: ["cmp-estados"],
		});
		assert.equal(r.isError, true);
		assert.match(r.text, /#no-existe/);
		assert.match(r.text, /forzar :hover/);
	});
});
