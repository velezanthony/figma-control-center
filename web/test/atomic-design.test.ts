import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";

// Que ningún nivel importe hacia arriba (átomo ↛ molécula/organismo, molécula ↛ organismo, iconos ↛ componentes)
// lo vigila ESLint (`npm run lint`; casos en server/test/lint-rules.test.ts). Aquí solo queda lo semántico.

const UI = join(import.meta.dirname, "../src/lib/ui");
const MOLECULES = join(UI, "molecules");

// Las moléculas sin imports solo ordenan contenido: se listan para que sea una decisión explícita
const NO_COMPOSITION = new Set([
	"ArgList",
	"ChatBubble",
	"DetailSection",
	"EmptyState",
	"PageHeader",
	"ResultsCount",
	"SectionCard",
]);

describe("atomic design: el código real", () => {
	it("una molécula compone al menos un componente de la librería o es un contenedor de contenido", () => {
		const bare = readdirSync(MOLECULES)
			.filter((f) => f.endsWith(".svelte"))
			.filter(
				(f) =>
					!/import\s+\w+\s+from\s+["']#web\/lib\/ui\//.test(
						readFileSync(join(MOLECULES, f), "utf8"),
					),
			)
			.map((f) => f.replace(".svelte", ""))
			.filter((n) => !NO_COMPOSITION.has(n));
		assert.deepEqual(bare, []);
	});
});
