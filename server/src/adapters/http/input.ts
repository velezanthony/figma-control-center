// Entrada de las rutas del panel validada con zod: el cuerpo JSON y los parámetros de la URL (texto)
import { z } from "zod";

// Un entero de un parámetro de URL, convertido con `Number()` (" 5" y "1e1" valen; "" y "x" no)
export const positiveIntParam = z.coerce.number().int().positive();
export const nonNegativeIntParam = z.coerce.number().int().nonnegative();

// Los parámetros como objeto para un esquema: el primer valor de cada clave, como `URLSearchParams.get`
export const paramsOf = (
	params: URLSearchParams,
): Readonly<Record<string, string>> =>
	Object.fromEntries(
		[...new Set(params.keys())].map((key) => [key, params.get(key) ?? ""]),
	);

// El cuerpo JSON que cumple el esquema, o null si no es JSON o no lo cumple
export function parseBody<T>(schema: z.ZodType<T>, body: string): T | null {
	let json: unknown;
	try {
		json = JSON.parse(body);
	} catch {
		return null;
	}
	const parsed = schema.safeParse(json);
	return parsed.success ? parsed.data : null;
}
