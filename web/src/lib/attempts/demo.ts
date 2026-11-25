import type { AttemptTarget, DiffHunk } from "#web/lib/contract.ts";
import type { AttemptRow } from "./present.ts";

// Datos de ejemplo de la galería (web/src/pages/Gallery.svelte)
export const DEMO_ATTEMPT_TARGETS: readonly AttemptTarget[] = [
	{
		kind: "capture",
		target: "home",
		attempts: 7,
		lastStatus: "ok",
		lastAt: "2026-11-12T08:30:00.000Z",
	},
	{
		kind: "build_step",
		target: "kit/build-screen@1 · home",
		attempts: 4,
		lastStatus: "contract_error",
		lastAt: "2026-11-11T17:05:00.000Z",
	},
	{
		kind: "run_script",
		target: "pasos/pintar-cabecera.js",
		attempts: 2,
		lastStatus: "error",
		lastAt: "2026-11-10T09:12:00.000Z",
	},
	{
		kind: "run_script",
		target: "(código)",
		attempts: 1,
		lastStatus: "ok",
		lastAt: "2026-11-09T12:00:00.000Z",
	},
];

const row = (n: number, over: Partial<AttemptRow> = {}): AttemptRow => ({
	id: 100 + n,
	n,
	kind: "build_step",
	target: "kit/build-screen@1 · home",
	status: "ok",
	firstError: null,
	callId: `llamada-${n}`,
	jobId: `job-${n}`,
	stepIndex: 0,
	startedAt: `2026-11-1${n}T10:00:00.000Z`,
	finishedAt: `2026-11-1${n}T10:00:04.000Z`,
	kit: "figma-kit@1",
	kitSha256: "k",
	assets: [],
	scripts: [],
	changed: n === 1 ? null : ["map", "plan"],
	callKept: true,
	change:
		n === 1
			? "intento 1: primero de este objetivo"
			: `intento ${n}: cambiaron map y plan; kit igual`,
	...over,
});

export const DEMO_ATTEMPT_ROWS: readonly AttemptRow[] = [
	row(1),
	row(2, {
		status: "error",
		firstError: "ContractError: /children/3/type debe ser «FRAME»",
	}),
	row(3, { callKept: false }),
];

const context = (oldNo: number, newNo: number, text: string) => ({
	op: "context" as const,
	oldNo,
	newNo,
	text,
});

export const DEMO_HUNKS: readonly DiffHunk[] = [
	{
		oldStart: 12,
		oldLines: 4,
		newStart: 12,
		newLines: 5,
		lines: [
			context(12, 12, "const frame = figma.createFrame();"),
			{ op: "del", oldNo: 13, newNo: null, text: "frame.name = 'Cabecera';" },
			{ op: "add", oldNo: null, newNo: 13, text: "frame.name = params.name;" },
			{
				op: "add",
				oldNo: null,
				newNo: 14,
				text: "frame.layoutMode = 'VERTICAL';",
			},
			context(14, 15, "return { createdNodeIds: [frame.id] };"),
		],
	},
	{
		oldStart: 40,
		oldLines: 3,
		newStart: 41,
		newLines: 2,
		lines: [
			context(40, 41, "// fin"),
			{ op: "del", oldNo: 41, newNo: null, text: "console.log('listo');" },
			context(42, 42, ""),
		],
	},
];
