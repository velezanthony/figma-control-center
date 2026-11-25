// kit/build-component@1: el plan de una hoja (component@1, que arma el servidor desde la captura de la
// galería, sheets@1 y map@1) pintado en su página: cabecera, tarjeta y el set con la matriz y sus propiedades.
import { fail, note, startTracking } from "../core.ts";
import { readJson } from "../json.ts";
import { assessPlan, driftSummary } from "../sheet/drift.ts";
import { paintSheet } from "../sheet/index.ts";
import type { ComponentPlan } from "../sheet/types.ts";
import { variantName } from "../sheet/variants.ts";

export type SheetParams = { sheet: string; scratch: boolean };

const MAX_UNTOKENIZED_WARNINGS = 20;
const MAX_MOVED_SHOWN = 12;
const MAX_WRAPPED_SHOWN = 6;

function readPlan(
	assets: Readonly<Record<string, Uint8Array>>,
	sheet: string,
): ComponentPlan {
	const bytes = assets["plan"];
	if (bytes === undefined) {
		return fail(
			"PLAN_MISSING",
			"El paso no recibió el asset `plan`.",
			"Lanza el paso con figma_build (el servidor arma el plan); no lo llames a mano sin `plan`.",
		);
	}
	const plan = readJson(bytes) as ComponentPlan;
	if (plan.contract !== "component@1" || plan.sheet.key !== sheet) {
		return fail(
			"PLAN_INVALID",
			`El plan no es un component@1 de «${sheet}» (trae ${String(plan.contract)} de «${String(plan.sheet?.key)}»).`,
			"Repite el paso con figma_build: el servidor vuelve a armar el plan desde la última captura.",
		);
	}
	if (plan.variants.length === 0) {
		return fail(
			"PLAN_EMPTY",
			`La captura de «${sheet}» no tiene variantes que pintar.`,
			"Captura la pantalla otra vez con figma_capture.",
		);
	}
	const empty = plan.variants.filter((v) => v.root.length === 0);
	if (empty.length > 0) {
		return fail(
			"PLAN_VARIANT_EMPTY",
			`La captura de «${sheet}» tiene ${empty.length} variante(s) sin nada que pintar (${empty.map((v) => variantName(v.props)).join("; ")}).`,
			"Abre la URL de la pantalla en el navegador (¿responde la página? ¿encuentra el `pick`?) y captúrala otra vez con figma_capture.",
		);
	}
	return plan;
}

export async function buildComponent(
	params: SheetParams,
	assets: Readonly<Record<string, Uint8Array>>,
	// recognize@1: el módulo del proyecto como objeto (o null)
	recognize?: unknown,
) {
	const tracker = startTracking();
	const plan = readPlan(assets, params.sheet);
	for (const w of plan.warnings) {
		note.warn(
			w.code,
			w.nodeId === undefined
				? w.message
				: `${w.message} (nodo ${w.nodeId} de la captura)`,
		);
	}
	// Antes de escribir nada: si Figma va por delante de la web la hoja no se escribe y se informa
	const { existing, verdict } = await assessPlan(plan);
	if (verdict.kind === "blocked") {
		note.warn(
			"SHEET_DRIFT",
			driftSummary(verdict.report),
			verdict.report.set.id,
		);
		return tracker.done({
			sheet: params.sheet,
			skipped: "drift",
			drift: verdict.report,
		});
	}
	if (verdict.kind === "figma-wins") {
		note.warn(
			"DRIFT_FIGMA_WINS",
			`La hoja «${params.sheet}» no se escribe: la decisión de sheets.json es que manda Figma.`,
		);
		return tracker.done({ sheet: params.sheet, skipped: "figma" });
	}
	const painted = await paintSheet(plan, assets, recognize ?? null, {
		existing,
		...(verdict.mapValues !== undefined && { mapValues: verdict.mapValues }),
	});
	const { counters } = painted.ctx;
	for (const [color, times] of [...counters.untokenized].slice(
		0,
		MAX_UNTOKENIZED_WARNINGS,
	)) {
		note.warn(
			"TOKEN_UNTOKENIZED",
			`El color #${color} (${times} ${times === 1 ? "vez" : "veces"}) no tiene variable: se pinta suelto.`,
		);
	}
	return tracker.done({
		sheet: params.sheet,
		page: painted.page.name,
		setId: painted.set.id,
		variants: painted.counts.variants,
		properties: painted.counts.properties,
		instances: painted.counts.outside,
		overrides: painted.counts.overrides,
		matches: counters.matches,
		moved: [...new Set(counters.moved)].slice(0, MAX_MOVED_SHOWN),
		wrapped: [...new Set(counters.wrapped)].slice(0, MAX_WRAPPED_SHOWN),
		untokenized: [...counters.untokenized.values()].reduce((a, b) => a + b, 0),
	});
}
