const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const NODE_ID_SEPARATOR = ":";
const NODE_ID_URL_SEPARATOR = "-";
const NODE_ID_PARAM = "node-id";
const LOCALE = "es-ES";
const SHORT_ID_CHARS = 8;
const DECIMAL_POINT = ".";
const DECIMAL_COMMA = ",";

export function formatDuration(ms: number): string {
	if (ms < MS_PER_SECOND) return `${Math.round(ms)} ms`;
	const seconds = ms / MS_PER_SECOND;
	if (seconds < SECONDS_PER_MINUTE) {
		return `${seconds.toFixed(1).replace(DECIMAL_POINT, DECIMAL_COMMA)} s`;
	}
	const minutes = Math.floor(seconds / SECONDS_PER_MINUTE);
	const rest = Math.round(seconds - minutes * SECONDS_PER_MINUTE);
	return `${minutes} min ${rest} s`;
}

export function formatClock(iso: string, timeZone?: string): string {
	return new Date(iso).toLocaleTimeString(LOCALE, {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
		hour12: false,
		...(timeZone !== undefined && { timeZone }),
	});
}

export const shortId = (id: string): string => id.slice(0, SHORT_ID_CHARS);

// Enlace al nodo en Figma: el id «1:23» viaja como «1-23»
export function nodeUrl(fileUrl: string, nodeId: string): string | null {
	try {
		const url = new URL(fileUrl);
		url.search = "";
		url.searchParams.set(
			NODE_ID_PARAM,
			nodeId.replaceAll(NODE_ID_SEPARATOR, NODE_ID_URL_SEPARATOR),
		);
		return url.toString();
	} catch {
		return null;
	}
}

const PERCENT_DIGITS = 1;
const PERCENT = 100;

// «7 %»; sin total, null (nada que comparar)
export function formatPercent(part: number, total: number): string | null {
	if (total === 0) return null;
	return `${((part / total) * PERCENT).toLocaleString(LOCALE, { maximumFractionDigits: PERCENT_DIGITS })} %`;
}
