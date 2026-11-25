import { realpath } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";

// Un fichero está dentro de la raíz si su ruta relativa no sube («..») ni es absoluta (otra raíz/unidad).
const isInside = (root: string, file: string): boolean => {
	const rel = relative(root, file);
	return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
};

// realpath en ambos lados: un enlace simbólico o un «..» no pueden sacar el fichero de la raíz.
export async function insideAnyRoot(
	roots: readonly string[],
	file: string,
): Promise<boolean> {
	for (const root of roots) {
		try {
			if (isInside(await realpath(root), file)) return true;
		} catch {
			// una raíz que no existe no autoriza nada
		}
	}
	return false;
}

// La ruta de `file` relativa a la raíz en que está (con «/» en todas las plataformas); null si no está en ninguna.
// Es la identidad de un script o un asset en el historial: la misma carpeta en dos máquinas da el mismo nombre
export async function relativeToRoot(
	roots: readonly string[],
	file: string,
): Promise<string | null> {
	for (const root of roots) {
		try {
			const real = await realpath(root);
			if (isInside(real, file))
				return relative(real, file).split(sep).join("/");
		} catch {
			// una raíz que no existe no identifica nada
		}
	}
	return null;
}
