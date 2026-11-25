import type { FigmaError } from "#domain/figma-error.ts";
import type { Result } from "#domain/result.ts";
import { SCRIPT_FORMAT, type ScriptFormat } from "#domain/script-format.ts";

export type { ScriptFormat };
// El formato de un script es vocabulario del dominio; se reexporta aquí para no cambiar los imports existentes.
export { SCRIPT_FORMAT };

export type ScriptToRun = {
	readonly code: string;
	readonly format: ScriptFormat;
	// Datos pequeños (valor JSON) y ficheros binarios (bytes por nombre) que el script recibe sin pasar por `window`.
	// El envoltorio los inyecta en la expresión: el puerto sigue recibiendo un único script.
	readonly params?: unknown;
	readonly assets?: Readonly<Record<string, Uint8Array>>;
};

export type RunOptions = {
	readonly timeoutMs?: number | undefined;
	// Un script del proyecto (no uno interno del servidor): antes de enviarlo se comprueba que la pestaña tiene el kit de
	// Figma instalado (versión y hash) y, si no, se instala. El script lo recibe como `kit`
	readonly installKit?: boolean | undefined;
};

export type FigmaStatus = {
	readonly chromeReachable: boolean;
	readonly tabFound: boolean;
	readonly figmaReady: boolean;
	readonly fileName: string | null;
	readonly pageName: string | null;
	readonly error: FigmaError | null;
};

export type Screenshot = {
	readonly png: Uint8Array;
	readonly width: number;
	readonly height: number;
};

export type MetadataNode = {
	readonly id: string;
	readonly name: string;
	readonly type: string;
	readonly children?: readonly MetadataNode[] | undefined;
};

export interface FigmaGateway {
	// Un script que venció su plazo no muere con él: sigue en la pestaña hasta que responde o la pestaña se cierra o
	// recarga. Esta promesa se resuelve entonces; `undefined` si no hay ningún script así.
	orphanedScript(): Promise<void> | undefined;
	// Lo que el servidor hizo por su cuenta y la respuesta debe decir, una sola vez (abrir la pestaña del proyecto)
	takeTabNotice(): string | null;
	// Espera a que la pestaña esté lista (Chrome, pestaña, sesión y `figma`) sin enviar ningún script: sin sesión o
	// con solo lectura falla en el acto con su motivo; cargando, espera como mucho el plazo del adaptador.
	ready(): Promise<Result<true, FigmaError>>;
	status(): Promise<FigmaStatus>;
	run(
		script: ScriptToRun,
		options?: RunOptions,
	): Promise<Result<unknown, FigmaError>>;
	screenshot(
		nodeId: string,
		scale: number,
	): Promise<Result<Screenshot, FigmaError>>;
	metadata(
		nodeId: string | null,
		depth: number,
	): Promise<Result<MetadataNode, FigmaError>>;
}
