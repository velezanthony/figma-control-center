import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { isAtBottom, isScrollSettled, shouldRepin } from "./scroll.ts";

describe("isAtBottom", () => {
	it("verdadero al final del todo y dentro de la tolerancia", () => {
		assert.equal(
			isAtBottom({ scrollTop: 600, clientHeight: 400, scrollHeight: 1000 }),
			true,
		);
		assert.equal(
			isAtBottom({ scrollTop: 570, clientHeight: 400, scrollHeight: 1000 }),
			true,
		);
	});

	it("falso en cuanto se sube más de la tolerancia", () => {
		assert.equal(
			isAtBottom({ scrollTop: 400, clientHeight: 400, scrollHeight: 1000 }),
			false,
		);
		assert.equal(
			isAtBottom({ scrollTop: 559, clientHeight: 400, scrollHeight: 1000 }, 40),
			false,
		);
	});

	it("una lista que cabe sin scroll está siempre abajo", () => {
		assert.equal(
			isAtBottom({ scrollTop: 0, clientHeight: 400, scrollHeight: 300 }),
			true,
		);
	});
});

const AT = { scrollTop: 600, clientHeight: 400, scrollHeight: 1000 };
const SHORT = { scrollTop: 580, clientHeight: 400, scrollHeight: 1000 };
const UP = { scrollTop: 100, clientHeight: 400, scrollHeight: 1000 };

describe("shouldRepin", () => {
	it("pegado al final y sin gesto del usuario, un scroll que deja la lista corta se vuelve a pegar", () => {
		assert.equal(
			shouldRepin({ pinned: true, userScrolling: false, metrics: SHORT }),
			true,
		);
	});

	it("si ya está exactamente abajo no hay nada que mover", () => {
		assert.equal(
			shouldRepin({ pinned: true, userScrolling: false, metrics: AT }),
			false,
		);
	});

	it("si el usuario está moviendo el scroll no se le lleva al final", () => {
		assert.equal(
			shouldRepin({ pinned: true, userScrolling: true, metrics: SHORT }),
			false,
		);
	});

	it("un salto lejos del final (un scrollTop = 0 de código) no es el acotado del navegador y no se corrige", () => {
		assert.equal(
			shouldRepin({ pinned: true, userScrolling: false, metrics: UP }),
			false,
		);
	});

	it("si no estaba pegado al final no se mueve", () => {
		assert.equal(
			shouldRepin({ pinned: false, userScrolling: false, metrics: UP }),
			false,
		);
	});
});

describe("isScrollSettled", () => {
	it("pegado al final, solo está quieta cuando el scroll está exactamente abajo", () => {
		assert.equal(isScrollSettled({ pinned: true, metrics: AT }), true);
		assert.equal(isScrollSettled({ pinned: true, metrics: SHORT }), false);
	});

	it("si el usuario leía más arriba, el anclaje no mueve nada y está quieta", () => {
		assert.equal(isScrollSettled({ pinned: false, metrics: UP }), true);
	});
});
