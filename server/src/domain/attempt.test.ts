import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	ATTEMPT_ROLE,
	type AttemptScriptRef,
	blobKindOf,
	changedRoles,
	describeChange,
} from "./attempt.ts";

const ref = (
	role: AttemptScriptRef["role"],
	sha256: string,
	path = "",
): AttemptScriptRef => ({ role, path, sha256 });

const base = [
	ref(ATTEMPT_ROLE.step, "s1"),
	ref(ATTEMPT_ROLE.params, "p1"),
	ref(ATTEMPT_ROLE.kit, "k1"),
];

describe("papeles que cambiaron entre dos intentos", () => {
	it("nada cambia: lista vacía", () => {
		assert.deepEqual(changedRoles(base, [...base]), []);
	});

	it("cambia solo el contenido de un papel: ese papel", () => {
		const next = [
			ref(ATTEMPT_ROLE.step, "s2"),
			ref(ATTEMPT_ROLE.params, "p1"),
			ref(ATTEMPT_ROLE.kit, "k1"),
		];
		assert.deepEqual(changedRoles(base, next), [ATTEMPT_ROLE.step]);
	});

	it("un papel que aparece o desaparece cuenta como cambio", () => {
		const withHooks = [...base, ref(ATTEMPT_ROLE.hooks, "h1", "hooks.js")];
		assert.deepEqual(changedRoles(base, withHooks), [ATTEMPT_ROLE.hooks]);
		assert.deepEqual(changedRoles(withHooks, base), [ATTEMPT_ROLE.hooks]);
	});

	it("el plan, map.json y el reconocimiento son papeles: cambiar la captura cambia `plan`; cambiar el mapa, `map` y `plan`", () => {
		const before = [
			...base,
			ref(ATTEMPT_ROLE.plan, "pl1"),
			ref(ATTEMPT_ROLE.map, "m1", "map.json"),
		];
		const newCapture = [
			...base,
			ref(ATTEMPT_ROLE.plan, "pl2"),
			ref(ATTEMPT_ROLE.map, "m1", "map.json"),
		];
		assert.deepEqual(changedRoles(before, newCapture), [ATTEMPT_ROLE.plan]);
		const newMap = [
			...base,
			ref(ATTEMPT_ROLE.plan, "pl3"),
			ref(ATTEMPT_ROLE.map, "m2", "map.json"),
		];
		assert.deepEqual(
			changedRoles(before, newMap),
			[ATTEMPT_ROLE.map, ATTEMPT_ROLE.plan].sort(
				(a, b) =>
					Object.values(ATTEMPT_ROLE).indexOf(a) -
					Object.values(ATTEMPT_ROLE).indexOf(b),
			),
		);
		const withRecognize = [
			...before,
			ref(ATTEMPT_ROLE.recognize, "r1", "recognize.js"),
		];
		assert.deepEqual(changedRoles(before, withRecognize), [
			ATTEMPT_ROLE.recognize,
		]);
	});

	it("blobKindOf: el plan y el map son JSON; el reconocimiento, código", () => {
		assert.equal(blobKindOf(ATTEMPT_ROLE.plan), "json");
		assert.equal(blobKindOf(ATTEMPT_ROLE.map), "json");
		assert.equal(blobKindOf(ATTEMPT_ROLE.recognize), "js");
	});

	it("misma ruta con otro contenido, o otra ruta con el mismo contenido: cambió", () => {
		const a = [ref(ATTEMPT_ROLE.hooks, "h1", "a.js")];
		assert.deepEqual(changedRoles(a, [ref(ATTEMPT_ROLE.hooks, "h2", "a.js")]), [
			ATTEMPT_ROLE.hooks,
		]);
		assert.deepEqual(changedRoles(a, [ref(ATTEMPT_ROLE.hooks, "h1", "b.js")]), [
			ATTEMPT_ROLE.hooks,
		]);
	});

	it("sale en el orden fijo de los papeles y sin repetir", () => {
		const next = [
			ref(ATTEMPT_ROLE.kit, "k2"),
			ref(ATTEMPT_ROLE.step, "s2"),
			ref(ATTEMPT_ROLE.params, "p1"),
		];
		assert.deepEqual(changedRoles(base, next), [
			ATTEMPT_ROLE.step,
			ATTEMPT_ROLE.kit,
		]);
	});
});

describe("frase de lo que cambió", () => {
	it("dice cuáles cambiaron y cuáles no", () => {
		assert.equal(
			describeChange(
				3,
				[ATTEMPT_ROLE.step],
				[ATTEMPT_ROLE.step, ATTEMPT_ROLE.params, ATTEMPT_ROLE.kit],
			),
			"intento 3: cambió step; params y kit iguales",
		);
	});

	it("con varios cambiados usa «cambiaron»", () => {
		assert.equal(
			describeChange(
				2,
				[ATTEMPT_ROLE.step, ATTEMPT_ROLE.kit],
				[ATTEMPT_ROLE.step, ATTEMPT_ROLE.params, ATTEMPT_ROLE.kit],
			),
			"intento 2: cambiaron step y kit; params igual",
		);
	});

	it("sin cambios dice que todo es igual", () => {
		assert.equal(
			describeChange(2, [], [ATTEMPT_ROLE.step, ATTEMPT_ROLE.params]),
			"intento 2: sin cambios (step y params iguales)",
		);
	});
});
