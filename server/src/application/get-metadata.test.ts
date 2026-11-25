import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { callTimeout } from "#domain/figma-error.ts";
import { err, ok } from "#domain/result.ts";
import { makeGetMetadata } from "./get-metadata.ts";
import { InMemoryFigmaGateway } from "./testing/in-memory-figma-gateway.ts";

describe("makeGetMetadata", () => {
	it("pide al gateway el nodo y la profundidad indicados, sin cruzarlos", async () => {
		const gateway = new InMemoryFigmaGateway();
		await makeGetMetadata(gateway)("12:34", 3);
		assert.deepEqual(gateway.metadataCalls, [{ nodeId: "12:34", depth: 3 }]);
	});

	it("sin nodo pide la página actual", async () => {
		const gateway = new InMemoryFigmaGateway();
		await makeGetMetadata(gateway)(null, 1);
		assert.deepEqual(gateway.metadataCalls, [{ nodeId: null, depth: 1 }]);
	});

	it("devuelve el árbol del gateway", async () => {
		const gateway = new InMemoryFigmaGateway();
		const tree = ok({ id: "1:1", name: "Portada", type: "FRAME" });
		gateway.metadataReply = tree;
		assert.deepEqual(await makeGetMetadata(gateway)("1:1", 1), tree);
	});

	it("propaga el error del gateway sin transformarlo", async () => {
		const gateway = new InMemoryFigmaGateway();
		const failure = err(callTimeout(5000));
		gateway.metadataReply = failure;
		assert.deepEqual(await makeGetMetadata(gateway)(null, 1), failure);
	});
});
