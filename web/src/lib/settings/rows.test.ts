import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
	appliesWhen,
	groupSettings,
	hasChanged,
	ORIGIN_LABEL,
	rowState,
	storedProblem,
	storedSettings,
	unitLabel,
} from "./rows.ts";
import { view } from "./testing/view.ts";

describe("rowState: qué se puede hacer con cada fila", () => {
	it("por defecto: editable, sin nada que restablecer", () => {
		const row = rowState(view(), null);
		assert.equal(row.readOnly, false);
		assert.equal(row.canReset, false);
		assert.equal(row.ignoredStored, null);
		assert.equal(row.pendingRestart, false);
	});

	it("guardado en el panel: editable y restablecer vuelve al valor por defecto", () => {
		const row = rowState(
			view({ origin: "panel", stored: "77", effective: 77, running: 77 }),
			null,
		);
		assert.equal(row.readOnly, false);
		assert.equal(row.canReset, true);
		assert.equal(row.resetsTo, "200");
	});

	it("fijado en el entorno: solo lectura y no se puede restablecer si no hay nada guardado", () => {
		const row = rowState(
			view({ origin: "env", effective: 30, running: 30 }),
			null,
		);
		assert.equal(row.readOnly, true);
		assert.equal(row.canReset, false);
	});

	it("fijado en el entorno con algo guardado debajo: dice que no se aplica y restablecer lo borra sin cambiar el efectivo (D-6)", () => {
		const row = rowState(
			view({ origin: "env", stored: "77", effective: 30, running: 30 }),
			null,
		);
		assert.equal(row.readOnly, true);
		assert.equal(row.canReset, true);
		assert.equal(row.ignoredStored, "77");
		assert.equal(row.resetsTo, "30");
	});

	it("guardado que no vale: lo enseña con su motivo y restablecer lo borra", () => {
		const row = rowState(
			view({ origin: "default", stored: "abc" }),
			"ajuste ignorado: «FCC_HISTORY_MAX_ROWS»: número inválido",
		);
		assert.equal(row.readOnly, false);
		assert.equal(row.canReset, true);
		assert.equal(row.ignoredStored, "abc");
		assert.match(row.storedProblem ?? "", /número inválido/);
	});

	it("pendiente de reinicio: lo usa el panel y arrancó con otro valor", () => {
		const changed = view({
			usedBy: ["panel"],
			origin: "panel",
			stored: "900",
			effective: 900,
			running: 500,
		});
		assert.equal(rowState(changed, null).pendingRestart, true);
	});

	it("un ajuste que solo usa el agente nunca está pendiente de reiniciar el panel", () => {
		const agentOnly = view({ usedBy: ["agent"], effective: 900, running: 500 });
		assert.equal(rowState(agentOnly, null).pendingRestart, false);
	});
});

describe("storedProblem: el motivo de un guardado que no vale, sacado de los avisos", () => {
	it("encuentra el aviso de esa clave y no el de otra", () => {
		const problems = [
			"ajuste ignorado: «FCC_LIVE_POLL_MS»: inválido",
			"ajuste ignorado: «FCC_HISTORY_MAX_ROWS»: demasiado pequeño",
		];
		assert.equal(storedProblem("FCC_HISTORY_MAX_ROWS", problems), problems[1]);
		assert.equal(storedProblem("FCC_BUILD_MAX_STEPS", problems), null);
	});

	it("no confunde una clave con otra que la contiene", () => {
		assert.equal(
			storedProblem("FCC_HISTORY_MAX", [
				"ajuste ignorado: «FCC_HISTORY_MAX_ROWS»: x",
			]),
			null,
		);
	});
});

describe("appliesWhen: para quién vale y cuándo (D-1, D-2)", () => {
	it("el agente: al próximo que se lance", () => {
		assert.equal(
			appliesWhen(["agent"]),
			"Se aplica al próximo agente que lances",
		);
	});

	it("el panel: al reiniciarlo", () => {
		assert.equal(appliesWhen(["panel"]), "Se aplica al reiniciar el panel");
	});

	it("los dos: las dos cosas", () => {
		assert.equal(
			appliesWhen(["panel", "agent"]),
			"Se aplica al próximo agente que lances y al reiniciar el panel",
		);
	});
});

describe("unitLabel: la unidad de la variable y, al lado, en humano (D-4)", () => {
	it("milisegundos en segundos, minutos u horas", () => {
		assert.equal(unitLabel("300000", "ms"), "ms · 5 min");
		assert.equal(unitLabel("1500", "ms"), "ms · 1,5 s");
		assert.equal(unitLabel("7200000", "ms"), "ms · 2 h");
		assert.equal(unitLabel("500", "ms"), "ms");
	});

	it("bytes en kB o MB", () => {
		assert.equal(unitLabel("20000", "bytes"), "bytes · 20 kB");
		assert.equal(unitLabel("5000000", "bytes"), "bytes · 5 MB");
		assert.equal(unitLabel("300", "bytes"), "bytes");
	});

	it("otras unidades y valores que no son un número, solo la unidad", () => {
		assert.equal(unitLabel("90", "días"), "días");
		assert.equal(unitLabel("abc", "ms"), "ms");
		assert.equal(unitLabel("", "ms"), "ms");
	});
});

describe("groupSettings: una tarjeta por grupo", () => {
	it("agrupa en el orden en que llegan, también un grupo que la web no conoce", () => {
		const a = view({ key: "A", group: "Panel" });
		const b = view({ key: "B", group: "Exportación" });
		const c = view({ key: "C", group: "Panel" });
		assert.deepEqual(groupSettings([a, b, c]), [
			{ group: "Panel", settings: [a, c] },
			{ group: "Exportación", settings: [b] },
		]);
	});
});

describe("ORIGIN_LABEL", () => {
	it("dice de dónde sale el valor con las palabras de la pantalla", () => {
		assert.deepEqual(ORIGIN_LABEL, {
			default: "Por defecto",
			panel: "Guardado en el panel",
			env: "Fijado en el entorno",
		});
	});
});

describe("hasChanged: «Guardar» solo si lo escrito difiere del valor efectivo", () => {
	it("igual al efectivo: no hay cambio, aunque sobren espacios", () => {
		assert.equal(hasChanged("200", 200), false);
		assert.equal(hasChanged(" 200 ", 200), false);
	});

	it("distinto, vacío o no numérico: hay cambio (valida el servidor)", () => {
		assert.equal(hasChanged("201", 200), true);
		assert.equal(hasChanged("", 200), true);
		assert.equal(hasChanged("abc", 200), true);
	});
});

describe("storedSettings: lo que «Restablecer todo» devolvería a su valor por defecto", () => {
	it("los que tienen algo guardado, también si lo tapa el entorno o no vale", () => {
		const list = [
			view({ key: "A" }),
			view({ key: "B", stored: "7", origin: "panel" }),
			view({ key: "C", stored: "9", origin: "env" }),
			view({ key: "D", stored: "abc" }),
		];
		assert.deepEqual(
			storedSettings(list).map((s) => s.key),
			["B", "C", "D"],
		);
	});

	it("sin nada guardado, ninguno", () => {
		assert.deepEqual(storedSettings([view()]), []);
	});
});
