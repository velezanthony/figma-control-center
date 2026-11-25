import type { ChatSessionInfo } from "#web/lib/contract.ts";

const LOCALE = "es-ES";
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;

const hourMinute = (iso: string, timeZone?: string): string =>
	new Date(iso).toLocaleTimeString(LOCALE, {
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
		...(timeZone !== undefined && { timeZone }),
	});

// Cómo se ve una sesión para una persona: la hora a la que arrancó y si sigue escuchando. El id y el pid van en el tooltip
export const sessionLabel = (s: ChatSessionInfo, timeZone?: string): string =>
	`Sesión de las ${hourMinute(s.startedAt, timeZone)} · ${s.alive ? "activa" : "terminada"}`;

export function relativeAgo(iso: string, now: number): string {
	const minutes = Math.floor(
		Math.max(0, now - Date.parse(iso)) / MS_PER_SECOND / SECONDS_PER_MINUTE,
	);
	if (minutes < 1) return "ahora mismo";
	if (minutes < MINUTES_PER_HOUR) return `hace ${minutes} min`;
	const hours = Math.floor(minutes / MINUTES_PER_HOUR);
	if (hours < HOURS_PER_DAY) return `hace ${hours} h`;
	return `hace ${Math.floor(hours / HOURS_PER_DAY)} d`;
}
