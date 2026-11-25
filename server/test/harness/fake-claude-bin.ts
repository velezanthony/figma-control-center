// Instala el `claude` FALSO (fake-claude-cli.ts) en `<dir>/bin/claude`: va delante en el PATH y en FCC_CLAUDE_BIN, así
// que ningún test del lanzador arranca un Claude Code real.
import {
	chmodSync,
	existsSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type {
	FakeClaudeConfig,
	FakeClaudeMode,
	FakeClaudeRecord,
	FakeClaudeTraffic,
} from "./fake-claude-cli.ts";

const CLI = join(import.meta.dirname, "fake-claude-cli.ts");
// La versión con la que se comprobó el arnés (la mínima que exige agent-run.ts)
export const FAKE_CLAUDE_VERSION = "2.1.287";

export type FakeClaude = {
	// Carpeta para poner delante en el PATH
	readonly bin: string;
	// Para FCC_CLAUDE_BIN
	readonly claudeBin: string;
	readonly recordFile: string;
	// Lo que vio el falso al arrancar (null si no arrancó)
	record(): FakeClaudeRecord | null;
	// La señal que recibió (modos wait y session), o null
	signal(): string | null;
	// Todas las señales que recibió, en orden
	signals(): readonly string[];
	// Lo que le llegó por el canal y las herramientas que llamó (modo sesión), o null si aún no conectó
	traffic(): FakeClaudeTraffic | null;
	// Lo que respondió figma_status a la sesión (modo session), o null
	status(): Record<string, unknown> | null;
};

const shellQuote = (s: string): string => `'${s.replaceAll("'", `'\\''`)}'`;

export function installFakeClaude(
	dir: string,
	options: {
		readonly mode?: FakeClaudeMode;
		readonly version?: string;
		readonly sessionEnv?: Readonly<Record<string, string>>;
		readonly exitCode?: number;
		readonly ignoreSigterm?: boolean;
	} = {},
): FakeClaude {
	const bin = join(dir, "bin");
	mkdirSync(bin, { recursive: true });
	const recordFile = join(dir, "fake-claude-record.json");
	const configFile = join(dir, "fake-claude.json");
	const config: FakeClaudeConfig = {
		version: options.version ?? FAKE_CLAUDE_VERSION,
		mode: options.mode ?? "exit",
		record: recordFile,
		sessionEnv: options.sessionEnv ?? {},
		exitCode: options.exitCode ?? 0,
		ignoreSigterm: options.ignoreSigterm ?? false,
	};
	writeFileSync(configFile, JSON.stringify(config));
	const claudeBin = join(bin, "claude");
	writeFileSync(
		claudeBin,
		`#!/bin/sh\nexec ${shellQuote(process.execPath)} ${shellQuote(CLI)} ${shellQuote(configFile)} "$@"\n`,
	);
	chmodSync(claudeBin, 0o755);
	return {
		bin,
		claudeBin,
		recordFile,
		record: () =>
			existsSync(recordFile)
				? (JSON.parse(readFileSync(recordFile, "utf8")) as FakeClaudeRecord)
				: null,
		status: () =>
			existsSync(`${recordFile}.status.json`)
				? (JSON.parse(
						readFileSync(`${recordFile}.status.json`, "utf8"),
					) as Record<string, unknown>)
				: null,
		signals: () =>
			existsSync(`${recordFile}.signals`)
				? readFileSync(`${recordFile}.signals`, "utf8")
						.split("\n")
						.filter((l) => l !== "")
				: [],
		traffic: () =>
			existsSync(`${recordFile}.traffic.json`)
				? (JSON.parse(
						readFileSync(`${recordFile}.traffic.json`, "utf8"),
					) as FakeClaudeTraffic)
				: null,
		signal: () =>
			existsSync(`${recordFile}.signal`)
				? readFileSync(`${recordFile}.signal`, "utf8")
				: null,
	};
}
