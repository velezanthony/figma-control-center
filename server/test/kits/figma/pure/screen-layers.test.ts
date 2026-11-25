// kit.layers.role: el nombre de una capa por su papel, no por su etiqueta HTML.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { frame, planMap, text, world } from "../screen-support.ts";

const layers = (over: Record<string, unknown> = {}) =>
	({ ...(planMap()["layers"] as object), ...over }) as never;
const role = (n: unknown, l = layers()) =>
	world().kit.layers.role(n as never, l);

describe("kit.layers.role", () => {
	it("una etiqueta con papel en map@1 usa ese nombre", () => {
		assert.equal(role(frame({ tag: "button" }, [])), "botón");
		assert.equal(role(frame({ tag: "p" }, [text("x")])), "párrafo");
	});

	it("botón, enlace, etiqueta y títulos llevan delante lo que dicen, acortado a 32 caracteres", () => {
		assert.equal(
			role(frame({ tag: "button" }, [text("Guardar")])),
			"botón · Guardar",
		);
		assert.equal(
			role(frame({ tag: "a" }, [text("Ir   al  panel")])),
			"enlace · Ir al panel",
		);
		const long = "x".repeat(40);
		assert.equal(
			role(frame({ tag: "button" }, [text(long)])),
			`botón · ${"x".repeat(31)}…`,
		);
		assert.equal(
			role(frame({ tag: "h2" }, [text("Título")])),
			"heading · Título",
		);
	});

	it("con `textPrefix: false` no lleva el texto delante", () => {
		const l = layers({ textPrefix: false });
		assert.equal(role(frame({ tag: "button" }, [text("Guardar")]), l), "botón");
	});

	it("sin papel por etiqueta: solo textos, solo svg, span, rejilla, fila, columna o bloque", () => {
		assert.equal(role(frame({ tag: "div" }, [text("a")])), "text");
		assert.equal(
			role(
				frame({ tag: "div" }, [{ t: "svg", id: "1", path: "0", w: 1, h: 1 }]),
			),
			"icon",
		);
		assert.equal(role(frame({ tag: "span", kids: [] }, [])), "group");
		assert.equal(role(frame({ tag: "div", disp: "grid" }, [])), "grid");
		assert.equal(
			role(frame({ tag: "div", disp: "flex", dir: "column" }, [])),
			"column",
		);
		assert.equal(
			role(frame({ tag: "div", disp: "flex", dir: "row" }, [])),
			"row",
		);
		assert.equal(role(frame({ tag: "div", disp: "block" }, [])), "block");
	});

	it("map@1 puede dar el nombre de esos papeles (heading, text, icon, group, grid, column, row, block)", () => {
		const l = layers({
			roles: {
				...(planMap()["layers"] as { roles: object }).roles,
				grid: "rejilla",
				block: "bloque",
			},
		});
		assert.equal(role(frame({ tag: "div", disp: "grid" }, []), l), "rejilla");
		assert.equal(role(frame({ tag: "div", disp: "block" }, []), l), "bloque");
	});
});
