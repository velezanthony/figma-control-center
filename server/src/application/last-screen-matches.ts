import type { HistoryQuery } from "#application/ports/history-query.ts";
import type { PaintMatch } from "#domain/design-context/to-code.ts";
import { kitStepLabel, SCREEN_KIT_STEP } from "#domain/step.ts";
import { TOOL_NAME } from "#domain/tool-names.ts";

// Cuántos figma_build recientes se miran para dar con el último que pintó esa pantalla (valor fijo del programa)
const RECENT_BUILDS = 20;

const isMatch = (value: unknown): value is PaintMatch =>
	typeof value === "object" &&
	value !== null &&
	typeof (value as PaintMatch).node === "string" &&
	typeof (value as PaintMatch).set === "string" &&
	typeof (value as PaintMatch).by === "string";

// `report.matches` de un paso que acabó bien y cuyo resultado cupo en línea; lo demás, nada
const matchesOf = (value: unknown): readonly PaintMatch[] => {
	const report =
		typeof value === "object" && value !== null
			? (value as { report?: unknown }).report
			: undefined;
	const matches =
		typeof report === "object" && report !== null
			? (report as { matches?: unknown }).matches
			: undefined;
	return Array.isArray(matches) ? matches.filter(isMatch) : [];
};

// Por qué instancia de un frame pintado desde la web es la que es (paso 4): lo que dejó
// el último `kit/build-screen@1` de esa pantalla en el histórico. Un resultado que fue a fichero (informe grande) no se
// lee: `matched` es un extra y su ausencia no es un error
export const makeLastScreenMatches =
	(deps: { readonly history: Pick<HistoryQuery, "calls" | "steps"> }) =>
	(screen: string): readonly PaintMatch[] => {
		const label = kitStepLabel(SCREEN_KIT_STEP, screen);
		const recent = deps.history.calls({
			range: { fromMs: null, toMs: null, sessionId: null },
			tool: TOOL_NAME.build,
			status: "ok",
			search: "",
			jobsOnly: true,
			sort: { key: "time", dir: "desc" },
			page: 1,
			perPage: RECENT_BUILDS,
			locate: null,
		});
		for (const call of recent.items) {
			if (call.jobId === null) continue;
			const painted = deps.history
				.steps(call.jobId)
				.find((s) => s.file === label && s.status === "done");
			if (painted === undefined) continue;
			if (painted.result?.kind === "inline")
				return matchesOf(painted.result.value);
		}
		return [];
	};
