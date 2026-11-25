// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/svelte";
// Desmonta lo pintado tras cada test (el autoCleanup del plugin no carga en Vitest 5: ruta /@fs/ sin resolver)
import "@testing-library/svelte/vitest";
import { beforeAll, describe, expect, it } from "vitest";
import type { ConnectionStatus } from "#web/lib/contract.ts";
import { DASHBOARD_MODE } from "#web/lib/dashboard-mode.ts";
import { ROUTE_NAME } from "#web/lib/route.ts";
import Sidebar from "#web/lib/ui/organisms/Sidebar.svelte";
import { stubPopover } from "./support.ts";

beforeAll(stubPopover);

const props = {
	route: ROUTE_NAME.home,
	status: null,
	now: 0,
	connection: "open",
	theme: "light",
	ontheme: () => {},
} as const;

const sections = () => screen.getByRole("navigation", { name: "Secciones" });

describe("Sidebar según el modo del panel", () => {
	it("en producción no ofrece «Componentes»; el resto de secciones sigue", () => {
		render(Sidebar, { ...props, mode: DASHBOARD_MODE.production });
		expect(sections().textContent).not.toContain("Componentes");
		expect(sections().textContent).toContain("Ajustes");
	});

	it("en desarrollo «Componentes» lleva a la galería", () => {
		render(Sidebar, { ...props, mode: DASHBOARD_MODE.development });
		const link = screen.getByRole("link", { name: /Componentes/ });
		expect(link.getAttribute("href")).toBe("#/components");
	});

	it("«Ayuda» está en los dos modos, abajo y fuera de las secciones de datos", () => {
		for (const mode of Object.values(DASHBOARD_MODE)) {
			const { unmount } = render(Sidebar, { ...props, mode });
			const link = screen.getByRole("link", { name: "Ayuda" });
			expect(link.getAttribute("href")).toBe("#/help");
			expect(sections().contains(link)).toBe(false);
			unmount();
		}
	});
});

const READY: ConnectionStatus = {
	at: "2026-01-01T00:00:00.000Z",
	chromeReachable: true,
	tabFound: true,
	figmaReady: true,
	fileName: "Sistema",
	pageName: "Portada",
};
const production = { ...props, mode: DASHBOARD_MODE.production };
const summary = () => screen.getByTestId("connection-summary");

describe("Sidebar: pie", () => {
	it("con panel, Chrome y Figma bien dice «Todo listo · en vivo», y el detalle sale en un tooltip", async () => {
		render(Sidebar, { ...production, status: READY });
		expect(summary().textContent?.trim()).toBe("Todo listo · en vivo");
		await fireEvent.focus(summary());
		const tooltip = document.getElementById(
			summary().getAttribute("aria-describedby") ?? "",
		);
		expect(tooltip?.textContent).toContain("Panel conectado");
		expect(tooltip?.textContent).toContain("Chrome responde");
		expect(tooltip?.textContent).toContain("Figma listo");
		expect(tooltip?.textContent).toContain("Sistema · Portada");
	});

	it("si algo falla, el resumen dice qué", () => {
		render(Sidebar, {
			...production,
			status: {
				...READY,
				chromeReachable: false,
				tabFound: false,
				figmaReady: false,
			},
		});
		expect(summary().textContent?.trim()).toBe("Chrome no responde");
	});

	it("sin conexión con el panel, lo dice aunque Figma estuviera bien", () => {
		render(Sidebar, { ...production, status: READY, connection: "closed" });
		expect(summary().textContent?.trim()).toBe("Sin conexión con el panel");
	});

	it("la versión sale de package.json y el tema y GitHub son botones de icono con nombre", () => {
		render(Sidebar, production);
		expect(screen.getByText(`v${__APP_VERSION__}`)).toBeTruthy();
		expect(__APP_VERSION__).toMatch(/^\d+\.\d+\.\d+$/);
		expect(screen.getByText("Figma Control Center")).toBeTruthy();
		expect(
			screen
				.getByRole("button", { name: "Cambiar a tema oscuro" })
				.textContent?.trim(),
		).toBe("");
		const github = screen.getByRole("link", {
			name: "Abrir el repositorio en GitHub (pestaña nueva)",
		});
		expect(github.getAttribute("href")).toBe(
			"https://github.com/velezanthony/figma-control-center",
		);
		expect(github.getAttribute("target")).toBe("_blank");
		expect(screen.queryByText("Conexión")).toBeNull();
	});
});
