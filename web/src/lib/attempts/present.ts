import type {
	AttemptItem,
	AttemptKind,
	AttemptStatus,
	RoleState,
} from "#web/lib/contract.ts";
import { ATTEMPT_TERM } from "#web/lib/glossary/terms.ts";

// Un intento tal como lo manda /api/history/attempts: con la frase de qué cambió respecto al anterior
export type AttemptRow = AttemptItem & { readonly change: string };

const LOCALE = "es-ES";

const KIND_LABEL: Record<AttemptKind, string> = {
	run_script: "Script",
	build_step: "Paso de lote",
	capture: "Captura",
};
const KIND_TERM: Record<AttemptKind, string> = {
	run_script: ATTEMPT_TERM.runScript,
	build_step: ATTEMPT_TERM.buildStep,
	capture: ATTEMPT_TERM.capture,
};

export const kindLabel = (kind: AttemptKind): string => KIND_LABEL[kind];
export const kindTerm = (kind: AttemptKind): string => KIND_TERM[kind];

// Los valores de BADGE_VARIANT que usan los estados (el .ts no importa un .svelte)
type StatusVariant = "success" | "warning" | "danger";

const STATUS_VARIANT: Record<AttemptStatus, StatusVariant> = {
	ok: "success",
	contract_error: "warning",
	error: "danger",
};
const STATUS_LABEL: Record<AttemptStatus, string> = {
	ok: "Correcto",
	contract_error: "Contrato incumplido",
	error: "Error",
};

export const statusVariant = (status: AttemptStatus): StatusVariant =>
	STATUS_VARIANT[status];
export const statusLabel = (status: AttemptStatus): string =>
	STATUS_LABEL[status];

const ROLE_LABEL: Readonly<Record<string, string>> = {
	step: "Script",
	params: "Parámetros",
	kit: "Kit",
	hooks: "Ganchos",
	screens: "Pantallas",
	map: "Mapa",
	plan: "Plan",
	recognize: "Reconocimiento",
};

// Un papel que este código no conoce (p. ej. `sheets`) se pinta con su nombre
export const roleLabel = (role: string): string => ROLE_LABEL[role] ?? role;

export const roleTerm = (role: string): string | null =>
	(ATTEMPT_TERM.role as Readonly<Record<string, string>>)[role] ?? null;

const lines = (n: number) => (n === 1 ? "línea" : "líneas");

// Qué pasó con un papel entre los dos intentos, con las líneas si se calcularon
export function roleStateText(
	state: RoleState,
	added: number | null,
	removed: number | null,
): string {
	switch (state) {
		case "same":
			return "igual";
		case "hash_only":
			return "solo hash";
		case "changed":
			if (added === null || removed === null) return "cambió";
			if (added === 0 && removed === 0)
				return "cambió (solo el orden o el formato)";
			return `cambió (+${added} −${removed} líneas)`;
		case "added":
			return added === null ? "aparece" : `aparece (+${added} ${lines(added)})`;
		case "removed":
			return removed === null
				? "desaparece"
				: `desaparece (−${removed} ${lines(removed)})`;
	}
}

export type When = { readonly text: string; readonly title: string };

const parts = (date: Date, timeZone: string) =>
	new Intl.DateTimeFormat(LOCALE, {
		timeZone,
		year: "numeric",
		month: "numeric",
		day: "numeric",
	}).format(date);

// Hora local: la hora sola si es de hoy (en esa zona), día y hora si no; la fecha completa, para el `title`
export function formatWhen(iso: string, now: Date, timeZone: string): When {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return { text: "—", title: "" };
	const clock = (withSeconds: boolean) =>
		date.toLocaleTimeString(LOCALE, {
			timeZone,
			hour: "2-digit",
			minute: "2-digit",
			...(withSeconds && { second: "2-digit" }),
			hour12: false,
		});
	const title = `${date.toLocaleDateString(LOCALE, { timeZone, day: "numeric", month: "long", year: "numeric" })}, ${clock(true)}`;
	if (parts(date, timeZone) === parts(now, timeZone))
		return { text: clock(true), title };
	const day = date
		.toLocaleDateString(LOCALE, { timeZone, day: "numeric", month: "short" })
		.replace(".", "");
	return { text: `${day}, ${clock(false)}`, title };
}

const KB = 1024;

// «1,5 KB»: el tamaño de un asset, con coma decimal
export function formatBytes(bytes: number): string {
	if (bytes < KB) return `${bytes} B`;
	const number = (n: number) =>
		n.toLocaleString(LOCALE, { maximumFractionDigits: 1 });
	return bytes < KB * KB
		? `${number(bytes / KB)} KB`
		: `${number(bytes / (KB * KB))} MB`;
}
