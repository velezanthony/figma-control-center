import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { localizeDates, toLocalIso } from "./local-time.ts";

describe("fechas del histórico en la hora local", () => {
	it("una fecha UTC sale con la hora y la diferencia de la zona, en verano y en invierno", () => {
		assert.equal(
			toLocalIso("2026-06-01T11:30:00.000Z", "Europe/Madrid"),
			"2026-06-01T13:30:00.000+02:00",
		);
		assert.equal(
			toLocalIso("2026-11-11T09:11:08.829Z", "Europe/Madrid"),
			"2026-11-11T10:11:08.829+01:00",
		);
		assert.equal(
			toLocalIso("2026-11-11T09:11:08.829Z", "UTC"),
			"2026-11-11T09:11:08.829+00:00",
		);
	});

	it("cambia las fechas de cualquier nivel y deja igual el resto, también los argumentos y el resultado de una llamada", () => {
		const out = localizeDates(
			{
				ok: true,
				items: [{ startedAt: "2026-06-01T11:30:00.000Z", summary: "x" }],
				call: {
					startedAt: "2026-06-01T11:30:00.000Z",
					args: { since: "2026-06-01T11:30:00.000Z" },
					result: { at: "2026-06-01T11:30:00.000Z" },
				},
				total: 1,
			},
			"Europe/Madrid",
		);
		assert.deepEqual(out, {
			ok: true,
			items: [{ startedAt: "2026-06-01T13:30:00.000+02:00", summary: "x" }],
			call: {
				startedAt: "2026-06-01T13:30:00.000+02:00",
				args: { since: "2026-06-01T11:30:00.000Z" },
				result: { at: "2026-06-01T11:30:00.000Z" },
			},
			total: 1,
		});
	});
});
