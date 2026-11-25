// La superficie del kit: cada pieza del kit existe, y su marca de error es la que lee el servidor
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { KIT_VERSION } from "../../../../../kits/figma/types.ts";
import { setup } from "../support.ts";

describe("figma-kit@1: superficie", () => {
	it("trae todas las piezas del kit básico", () => {
		const { kit } = setup();
		const surface = {
			"": ["version", "sha256", "track", "fail", "json"],
			page: ["find", "ensure", "remove"],
			node: ["get", "tag", "byKey"],
			frame: ["ensure", "replaceContent"],
			links: ["capture", "restore", "to", "byText", "rows"],
			flow: ["start"],
			steps: ["place", "share", "links", "fillImage"],
			component: ["find", "setNameOf", "variant", "cloneVariant"],
			instance: ["create"],
			slot: ["fill", "share"],
			fonts: ["ensure"],
			tokens: ["load"],
			paints: ["set"],
			icons: ["fromSvg"],
		} as const;
		for (const [group, names] of Object.entries(surface)) {
			const target =
				group === "" ? kit : (kit as unknown as Record<string, object>)[group];
			for (const name of names) {
				assert.ok(
					name in (target ?? {}),
					`kit${group ? `.${group}` : ""}.${name}`,
				);
			}
		}
		assert.equal(kit.version, KIT_VERSION);
	});

	it("las piezas de F4a están: screen.paint, layers.role y tokens.paint", () => {
		const { kit } = setup();
		assert.equal(typeof kit.screen.paint, "function");
		assert.equal(typeof kit.steps.buildScreen, "function");
		assert.equal(typeof kit.layers.role, "function");
		assert.equal(typeof kit.tokens.paint, "function");
	});
});
