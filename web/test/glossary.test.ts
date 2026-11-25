import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { ACTIVITY_ERROR } from "../../server/src/domain/activity.ts";
import { FIGMA_ERROR_TYPE } from "../../server/src/domain/figma-error.ts";
import { TOOL_NAME } from "../../server/src/domain/tool-names.ts";
import { ACTIVITY_COLUMNS, JOBS_COLUMNS } from "../src/lib/activity/columns.ts";
import { callLabel, jobLabel } from "../src/lib/activity/present.ts";
import {
	COLUMN_TERM,
	CONNECTION_TERM,
	GROUPS,
	ID_TERM,
	METRIC_TERM,
	RETRYABLE_TERM,
	STATUS_TERM,
	STEP_STATUS_TERM,
	TERMS,
	termOf,
} from "../src/lib/glossary/terms.ts";

// Todo código que la interfaz puede mostrar debe poder explicarse: si añades un tipo de error, una herramienta,
// una métrica o una columna y este test falla, falta su entrada en lib/glossary/terms.ts

const missing = (keys: readonly string[]) =>
	keys.filter((k) => termOf(k) === null);

describe("glosario: cobertura de lo que la interfaz muestra", () => {
	it("cada tipo de error de Figma tiene término", () => {
		assert.deepEqual(missing(Object.values(FIGMA_ERROR_TYPE)), []);
	});

	it("cada tipo de error que no viene de Figma tiene término", () => {
		assert.deepEqual(missing(Object.values(ACTIVITY_ERROR)), []);
	});

	it("Interrupted explica que el script pudo seguir o terminar en Figma, sin afirmar que no llegó a terminar", () => {
		const term = termOf(ACTIVITY_ERROR.interrupted);
		assert.ok(term);
		const text = `${term.short} ${term.long ?? ""}`;
		assert.match(text, /pudo seguir o terminar en Figma/);
		assert.match(text, /figma_metadata/);
		assert.match(text, /figma_build/);
		assert.doesNotMatch(text, /no llegó a terminar/);
	});

	it("«reintentable» tiene término", () => {
		assert.deepEqual(missing([RETRYABLE_TERM]), []);
	});

	it("cada herramienta figma_* y figma_history_* tiene término, con su nombre como clave", () => {
		assert.deepEqual(missing(Object.values(TOOL_NAME)), []);
	});

	it("cada estado, estado de paso, id, métrica y pieza de conexión tiene término", () => {
		for (const group of [
			STATUS_TERM,
			STEP_STATUS_TERM,
			ID_TERM,
			METRIC_TERM,
			CONNECTION_TERM,
		]) {
			assert.deepEqual(missing(Object.values(group)), []);
		}
	});

	it("cada cabecera de columna de las tablas tiene término", () => {
		for (const column of [...ACTIVITY_COLUMNS, ...JOBS_COLUMNS]) {
			assert.ok(column.term, `la columna «${column.label}» no declara término`);
			assert.deepEqual(missing([column.term]), [], column.label);
		}
		assert.deepEqual(missing(Object.values(COLUMN_TERM)), []);
	});

	it("las etiquetas de resultado de una llamada y de un job apuntan a un término", () => {
		const base = {
			callId: "a",
			sessionId: "s",
			fileUrl: null,
			tool: "t",
			startedAt: "x",
			args: {},
			ms: 1,
			retryable: null,
			touchedNodeIds: [],
			resultPath: null,
			jobId: null,
			screenshots: [],
			summary: "",
		} as const;
		const failure = (type: string) => ({
			type,
			message: "m",
			nextStep: null,
			line: null,
		});
		const job = (status: "running" | "done" | "failed", type?: string) => ({
			status,
			ms: null,
			error: type === undefined ? null : failure(type),
			touchedNodeIds: [],
		});
		const labels = [
			callLabel({ ...base, status: "running", error: null, job: null }),
			callLabel({ ...base, status: "ok", error: null, job: null }),
			callLabel({ ...base, status: "error", error: null, job: null }),
			callLabel({
				...base,
				status: "error",
				error: failure("TipoQueNoExiste"),
				job: null,
			}),
			...Object.values(FIGMA_ERROR_TYPE).map((type) =>
				callLabel({
					...base,
					status: "error",
					error: failure(type),
					job: null,
				}),
			),
			...[
				job("running"),
				job("done"),
				job("failed"),
				job("failed", "ScriptError"),
			].map((j) => jobLabel({ ...base, status: "ok", error: null, job: j })),
		];
		for (const label of labels) {
			assert.ok(label?.term, JSON.stringify(label));
			assert.deepEqual(missing([label.term]), [], label.text);
		}
	});
});

describe("glosario: la fuente única", () => {
	it("las claves no se repiten", () => {
		const keys = TERMS.map((t) => t.key);
		assert.deepEqual(
			keys.filter((k, i) => keys.indexOf(k) !== i),
			[],
		);
	});

	it("cada término tiene nombre y explicación corta, y pertenece a un grupo del glosario", () => {
		const groups = new Set(GROUPS.map((g) => g.id));
		for (const t of TERMS) {
			assert.ok(t.label.trim() !== "", t.key);
			assert.ok(t.short.trim() !== "", t.key);
			assert.ok(groups.has(t.group), `${t.key}: grupo ${t.group}`);
			if (t.long !== undefined) assert.ok(t.long.trim() !== "", t.key);
		}
	});

	it("la explicación corta cabe en un tooltip (una o dos frases)", () => {
		for (const t of TERMS)
			assert.ok(t.short.length <= 160, `${t.key}: ${t.short.length}`);
	});

	it("todos los grupos tienen al menos un término", () => {
		for (const g of GROUPS) {
			assert.ok(
				TERMS.some((t) => t.group === g.id),
				g.id,
			);
		}
	});

	it("un término que no existe devuelve null, no lanza", () => {
		assert.equal(termOf("NoExiste"), null);
	});
});
