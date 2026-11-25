// @vitest-environment happy-dom
import { flushSync } from "svelte";
import { describe, expect, it } from "vitest";
import { followPageTitle } from "#web/lib/page-title.svelte.ts";
import { ROUTE_NAME, type RouteName } from "#web/lib/route.ts";

describe("el título de la pestaña sigue a la pantalla", () => {
	it("lo pone al montar y lo cambia al navegar", () => {
		const route = $state<{ current: RouteName }>({ current: ROUTE_NAME.jobs });
		const stop = $effect.root(() => followPageTitle(() => route.current));
		flushSync();
		expect(document.title).toBe("Jobs · Figma Control Center");
		route.current = ROUTE_NAME.settings;
		flushSync();
		expect(document.title).toBe("Ajustes · Figma Control Center");
		stop();
	});
});
