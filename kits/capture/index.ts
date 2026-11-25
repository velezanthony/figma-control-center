// Entrada del empaquetado (kits/dist/capture-kit.js): instala el capturador en el mundo donde se evalúa (el aislado,
// cuando lo instala el servidor) bajo un nombre fijo. Instalarlo dos veces en el mismo mundo no hace nada.
import { createCapturer } from "./capturer.ts";

export const KIT_GLOBAL = "__figmaCaptureKit";

const scope = globalThis as unknown as Record<string, unknown>;
if (scope[KIT_GLOBAL] === undefined) scope[KIT_GLOBAL] = createCapturer(window);
