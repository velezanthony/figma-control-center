// E1: un escenario por cada tipo de error del dominio. Los valores esperados salen de las REGLAS del dominio
// (server/src/domain/figma-error.ts), no de lo que devuelva una ejecución.
import { FIGMA_ERROR_TYPE, type FigmaErrorType } from "#domain/figma-error.ts";
import type { ScenarioKey } from "./scenarios.ts";

// Cómo se provoca el error en el entorno
export type ErrorSetup =
	// Chrome no escucha en el puerto
	| { readonly kind: "chromeDown" }
	// Hay Chrome, pero ninguna pestaña del archivo
	| { readonly kind: "wrongTab" }
	// La pestaña existe pero `figma` no llega a definirse
	| { readonly kind: "figmaNotLoaded" }
	// Una ruta fuera de las raíces de scripts
	| { readonly kind: "pathOutsideRoots" }
	// Un figma_screenshot de un id que no existe en el archivo
	| { readonly kind: "nodeMissing" }
	// Un escenario de script (marcador de línea opcional)
	| {
			readonly kind: "script";
			readonly scenario: ScenarioKey;
			readonly lineMarker?: string;
	  };

export type ErrorScenario = {
	readonly id: string;
	readonly type: FigmaErrorType;
	readonly setup: ErrorSetup;
	// Regla de dominio: se puede relanzar con seguridad
	readonly retryable: boolean;
	// Fragmento que debe contener el siguiente paso que ve el usuario
	readonly nextStep: RegExp;
};

export const ERROR_SCENARIOS: readonly ErrorScenario[] = [
	{
		id: "chrome-unreachable",
		type: FIGMA_ERROR_TYPE.chromeUnreachable,
		setup: { kind: "chromeDown" },
		retryable: true,
		nextStep: /chrome\.sh/,
	},
	{
		id: "figma-tab-not-found",
		type: FIGMA_ERROR_TYPE.figmaTabNotFound,
		setup: { kind: "wrongTab" },
		retryable: true,
		nextStep: /Abre .*Proyectos/,
	},
	{
		id: "figma-not-ready",
		type: FIGMA_ERROR_TYPE.figmaNotReady,
		setup: { kind: "figmaNotLoaded" },
		retryable: true,
		nextStep: /Proyectos/,
	},
	{
		id: "script-read-error",
		type: FIGMA_ERROR_TYPE.scriptReadError,
		setup: { kind: "pathOutsideRoots" },
		retryable: false,
		nextStep: /FCC_SCRIPTS_ROOT/,
	},
	{
		id: "script-error-syntax",
		type: FIGMA_ERROR_TYPE.scriptError,
		setup: { kind: "script", scenario: "errorSyntax", lineMarker: "@error-here" },
		retryable: false,
		nextStep: /sintaxis/,
	},
	{
		id: "script-error-runtime",
		type: FIGMA_ERROR_TYPE.scriptError,
		setup: { kind: "script", scenario: "errorRuntime", lineMarker: "@throw-here" },
		retryable: false,
		nextStep: /excepción/,
	},
	{
		id: "script-error-figma-internal",
		type: FIGMA_ERROR_TYPE.scriptError,
		setup: {
			kind: "script",
			scenario: "errorFigmaInternal",
			lineMarker: "@throw-here",
		},
		retryable: false,
		nextStep: /excepción/,
	},
	{
		id: "node-not-found",
		type: FIGMA_ERROR_TYPE.nodeNotFound,
		setup: { kind: "nodeMissing" },
		retryable: false,
		nextStep: /figma_metadata/,
	},
	{
		id: "timeout",
		type: FIGMA_ERROR_TYPE.timeout,
		setup: { kind: "script", scenario: "errorTimeout" },
		retryable: false,
		nextStep: /figma_get_job/,
	},
];
