// @vitest-environment happy-dom
import { fireEvent, render, screen } from "@testing-library/svelte";
// Desmonta lo pintado tras cada test (el autoCleanup del plugin no carga en Vitest 5: ruta /@fs/ sin resolver)
import "@testing-library/svelte/vitest";
import { afterEach, describe, expect, it } from "vitest";
import PermissionCard from "#web/lib/ui/molecules/PermissionCard.svelte";

const DESCRIPTION =
	"Ejecuta un comando en la terminal del equipo con los permisos del usuario.";
const INPUT = '{\n  "command": "ls -la output/"\n}';
const COMPACT_INPUT = '{"command":"ls -la output/"}';
const CLAMPED_PX = 40;

const props = (overrides: Partial<Record<string, unknown>> = {}) => ({
	tool: "Bash",
	description: DESCRIPTION,
	input: INPUT,
	status: "pending" as const,
	time: "12:00:00",
	onallow: () => {},
	ondeny: () => {},
	...overrides,
});

// happy-dom no maqueta: el recorte se decide midiendo, así que cada test dice cuánto ocupa el texto
const restores: (() => void)[] = [];
function textHeight(px: number): void {
	for (const [key, value] of [
		["scrollHeight", px],
		["clientHeight", CLAMPED_PX],
	] as const) {
		const before = Object.getOwnPropertyDescriptor(HTMLElement.prototype, key);
		Object.defineProperty(HTMLElement.prototype, key, {
			configurable: true,
			get: () => value,
		});
		restores.push(() => {
			if (before) Object.defineProperty(HTMLElement.prototype, key, before);
			else Reflect.deleteProperty(HTMLElement.prototype, key);
		});
	}
}

afterEach(() => {
	for (const restore of restores.splice(0).reverse()) restore();
});

describe("PermissionCard: recorte de la descripción y de la entrada", () => {
	it("si el texto cabe, no hay «Ver más» ni «Ver todo»", () => {
		textHeight(CLAMPED_PX);
		render(PermissionCard, props());
		expect(screen.queryByRole("button", { name: "Ver más" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Ver todo" })).toBeNull();
	});

	it("si la descripción no cabe, «Ver más» la despliega y pasa a «Ver menos»", async () => {
		textHeight(CLAMPED_PX * 3);
		render(PermissionCard, props());
		const more = screen.getByRole("button", { name: "Ver más" });
		expect(more.getAttribute("aria-expanded")).toBe("false");
		const description = document.getElementById(
			more.getAttribute("aria-controls") ?? "",
		);
		expect(description?.textContent).toBe(DESCRIPTION);
		expect(description?.classList.contains("line-clamp-2")).toBe(true);

		await fireEvent.click(more);
		const less = screen.getByRole("button", { name: "Ver menos" });
		expect(less.getAttribute("aria-expanded")).toBe("true");
		expect(description?.classList.contains("line-clamp-2")).toBe(false);
	});

	it("si la entrada no cabe, «Ver todo» la despliega y pasa a «Ver menos»", async () => {
		textHeight(CLAMPED_PX * 3);
		render(PermissionCard, props({ description: "" }));
		const all = screen.getByRole("button", { name: "Ver todo" });
		expect(all.getAttribute("aria-expanded")).toBe("false");
		await fireEvent.click(all);
		const less = screen.getByRole("button", { name: "Ver menos" });
		expect(less.getAttribute("aria-expanded")).toBe("true");
		expect(less.getAttribute("aria-controls")).toBe(
			all.getAttribute("aria-controls"),
		);
	});
});

describe("PermissionCard: «Copiar»", () => {
	it("copia la entrada compactada y lo confirma con «Copiado»", async () => {
		const copied: string[] = [];
		const before = Object.getOwnPropertyDescriptor(navigator, "clipboard");
		Object.defineProperty(navigator, "clipboard", {
			configurable: true,
			value: { writeText: async (text: string) => void copied.push(text) },
		});
		restores.push(() => {
			if (before) Object.defineProperty(navigator, "clipboard", before);
			else Reflect.deleteProperty(navigator, "clipboard");
		});
		render(PermissionCard, props());
		await fireEvent.click(screen.getByRole("button", { name: "Copiar" }));
		expect(copied).toEqual([COMPACT_INPUT]);
		expect(await screen.findByRole("button", { name: "Copiado" })).toBeTruthy();
	});
});

describe("PermissionCard: contestar", () => {
	it("pendiente, Aprobar y Denegar avisan a quien la usa", async () => {
		const answers: string[] = [];
		render(
			PermissionCard,
			props({
				onallow: () => answers.push("allow"),
				ondeny: () => answers.push("deny"),
			}),
		);
		await fireEvent.click(screen.getByRole("button", { name: "Aprobar" }));
		await fireEvent.click(screen.getByRole("button", { name: "Denegar" }));
		expect(answers).toEqual(["allow", "deny"]);
	});

	it("mientras se envía la respuesta, los dos botones esperan desactivados", () => {
		render(PermissionCard, props({ busy: true }));
		for (const name of ["Aprobar", "Denegar"])
			expect(
				screen.getByRole("button", { name }).hasAttribute("disabled"),
				name,
			).toBe(true);
	});

	it("ya contestada, no hay botones para contestar", () => {
		render(PermissionCard, props({ status: "allowed" }));
		expect(screen.queryByRole("button", { name: "Aprobar" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Denegar" })).toBeNull();
	});

	it("lo que trae la petición se pinta como texto, nunca como HTML", () => {
		const hostile = '<img src="x" onerror="alert(1)">';
		const { container } = render(
			PermissionCard,
			props({ description: hostile, input: hostile }),
		);
		expect(container.querySelector("img")).toBeNull();
		expect(container.textContent).toContain(hostile);
	});
});
