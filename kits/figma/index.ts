// Entrada del empaquetado (kits/dist/figma-kit.js): deja el kit en el global de la pestaña. Instalar otra vez lo
// sustituye (el servidor reinstala cuando cambia la versión o el hash).
import { createKit } from "./kit.ts";
import { KIT_GLOBAL } from "./types.ts";

(globalThis as unknown as Record<string, unknown>)[KIT_GLOBAL] = createKit();
