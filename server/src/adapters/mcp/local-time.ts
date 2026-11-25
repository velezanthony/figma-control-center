// El agente repite las horas tal cual le llegan: en UTC no cuadran con las que enseña el panel
const UTC_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

// Lo que la llamada recibió o devolvió se enseña como fue, sin reescribirlo
const VERBATIM_KEYS = new Set(["args", "result"]);

// La zona del sistema; los tests la fijan
export const systemTimeZone = (): string =>
	Intl.DateTimeFormat().resolvedOptions().timeZone;

export function toLocalIso(utcIso: string, timeZone: string): string {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat("en-US", {
			timeZone,
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			fractionalSecondDigits: 3,
			hourCycle: "h23",
			timeZoneName: "longOffset",
		})
			.formatToParts(new Date(utcIso))
			.map((p) => [p.type, p.value]),
	);
	// «GMT+02:00», o «GMT» a secas en UTC
	const offset = parts["timeZoneName"]?.replace("GMT", "") || "+00:00";
	return `${parts["year"]}-${parts["month"]}-${parts["day"]}T${parts["hour"]}:${parts["minute"]}:${parts["second"]}.${parts["fractionalSecond"]}${offset}`;
}

export function localizeDates<T>(value: T, timeZone: string): T {
	if (typeof value === "string") {
		return (UTC_ISO.test(value) ? toLocalIso(value, timeZone) : value) as T;
	}
	if (Array.isArray(value)) {
		return value.map((v) => localizeDates(v, timeZone)) as T;
	}
	if (value !== null && typeof value === "object") {
		return Object.fromEntries(
			Object.entries(value).map(([k, v]) => [
				k,
				VERBATIM_KEYS.has(k) ? v : localizeDates(v, timeZone),
			]),
		) as T;
	}
	return value;
}
