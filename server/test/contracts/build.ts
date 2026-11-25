// Contrato del lote (figma_build). Es un contrato PROPIO: su fuente es el esquema zod y docs/users/contracts.md, no una salida real.
//  - Manifiesto: vive en el servidor, fuente única para el adaptador de
//    disco, la herramienta MCP y los tests (#adapters/contracts/build-manifest.ts, JSON Schema en schemas/).
//  - Script con params y assets: lo que la sonda de params/assets devuelve (el eco de params y la
//    longitud en bytes del asset recibido como Uint8Array).
// Los ejemplos se CONSTRUYEN desde estos esquemas (y se validan al construirlos), nunca se pegan a mano.
import { z } from "zod";

export const BUILD_CONTRACT_SOURCES = Object.freeze([
	"docs/users/contracts.md (manifiesto del lote)",
	"schemas/build-manifest.v1.json",
] as const);

// Un objeto JSON de params: claves string, valores cualesquiera.
const jsonRecord = z.record(z.string(), z.unknown());

// Lo que devuelve la sonda de params/assets: el eco de los params que recibió y la longitud en bytes
// del asset (assets[nombre].length de un Uint8Array). Sin escritura: solo lectura de lo que llegó.
export const ParamsEchoSchema = z.strictObject({
	params: jsonRecord,
	assetLength: z.number().int().nonnegative(),
});
export type ParamsEcho = z.infer<typeof ParamsEchoSchema>;

export const paramsEcho = (
	params: Readonly<Record<string, unknown>>,
	assetLength: number,
): ParamsEcho => ParamsEchoSchema.parse({ params, assetLength });
