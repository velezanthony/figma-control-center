import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ATTEMPT_TERM, termOf } from "#web/lib/glossary/terms.ts";
import {
	formatBytes,
	formatWhen,
	kindLabel,
	kindTerm,
	roleLabel,
	roleStateText,
	roleTerm,
	statusLabel,
	statusVariant,
} from "./present.ts";

describe("etiquetas de tipo, estado y papel", () => {
	it("cada tipo de intento tiene etiqueta y un término del glosario que existe", () => {
		for (const kind of ["run_script", "build_step", "capture"] as const) {
			assert.notEqual(kindLabel(kind), kind);
			assert.ok(termOf(kindTerm(kind)), kind);
		}
	});

	it("el estado va a una variante de Badge y siempre con texto", () => {
		assert.equal(statusVariant("ok"), "success");
		assert.equal(statusVariant("contract_error"), "warning");
		assert.equal(statusVariant("error"), "danger");
		assert.equal(statusLabel("ok"), "Correcto");
		assert.equal(statusLabel("contract_error"), "Contrato incumplido");
		assert.equal(statusLabel("error"), "Error");
	});

	it("un papel conocido tiene etiqueta y término; uno desconocido cae a su nombre y no tiene término", () => {
		assert.equal(roleLabel("step"), "Script");
		assert.equal(roleLabel("plan"), "Plan");
		assert.equal(roleLabel("sheets"), "sheets");
		assert.equal(roleTerm("plan"), ATTEMPT_TERM.role.plan);
		assert.equal(roleTerm("sheets"), null);
	});

	it("los términos de los papeles y estados del glosario existen", () => {
		const keys = [
			...Object.values(ATTEMPT_TERM).filter((k) => typeof k === "string"),
			...Object.values(ATTEMPT_TERM.role),
		];
		for (const key of keys) assert.ok(termOf(key), String(key));
	});

	it("el estado de un papel dice qué pasó, con las líneas si las hay", () => {
		assert.equal(roleStateText("same", null, null), "igual");
		assert.equal(roleStateText("changed", 3, 1), "cambió (+3 −1 líneas)");
		assert.equal(roleStateText("changed", 1, 0), "cambió (+1 −0 líneas)");
		assert.equal(
			roleStateText("changed", 0, 0),
			"cambió (solo el orden o el formato)",
		);
		assert.equal(roleStateText("changed", null, null), "cambió");
		assert.equal(roleStateText("added", 4, 0), "aparece (+4 líneas)");
		assert.equal(roleStateText("removed", 0, 6), "desaparece (−6 líneas)");
		assert.equal(roleStateText("hash_only", null, null), "solo hash");
	});
});

describe("fecha local (hora sola si es de hoy, día y hora si no)", () => {
	const NOW = new Date("2026-11-12T10:00:00Z");

	it("de hoy: solo la hora, en 24 h y en la zona dada", () => {
		const when = formatWhen("2026-11-12T08:30:15Z", NOW, "Europe/Madrid");
		assert.equal(when.text, "09:30:15");
	});

	it("la misma hora UTC es otra hora local según la zona", () => {
		assert.equal(
			formatWhen("2026-11-12T08:30:15Z", NOW, "UTC").text,
			"08:30:15",
		);
	});

	it("de otro día: día y hora", () => {
		const when = formatWhen("2026-11-10T22:05:00Z", NOW, "Europe/Madrid");
		assert.equal(when.text, "10 nov, 23:05");
	});

	it("«hoy» se decide en la zona local: a las 23:30 UTC ya es mañana en Madrid", () => {
		const now = new Date("2026-11-12T23:30:00Z");
		assert.equal(
			formatWhen("2026-11-12T10:00:00Z", now, "Europe/Madrid").text,
			"12 nov, 11:00",
		);
		assert.equal(
			formatWhen("2026-11-13T00:10:00Z", now, "Europe/Madrid").text,
			"01:10:00",
		);
	});

	it("la fecha completa va en el title", () => {
		const when = formatWhen("2026-11-12T08:30:15Z", NOW, "Europe/Madrid");
		assert.match(when.title, /12 de noviembre de 2026/);
		assert.match(when.title, /09:30:15/);
	});

	it("una fecha que no se entiende no rompe: devuelve «—»", () => {
		assert.equal(formatWhen("nada", NOW, "UTC").text, "—");
	});
});

describe("tamaño de un asset", () => {
	it("bytes, KB y MB con coma decimal", () => {
		assert.equal(formatBytes(0), "0 B");
		assert.equal(formatBytes(512), "512 B");
		assert.equal(formatBytes(1536), "1,5 KB");
		assert.equal(formatBytes(2_500_000), "2,4 MB");
	});
});
