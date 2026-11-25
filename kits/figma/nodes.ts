// Nodos por id y por clave guardada con setSharedPluginData (setPluginData falla fuera de un plugin)
import { figmaApi, note } from "./core.ts";
import { insideInstance } from "./tree.ts";
import { KEY, NS, type PageNode, type SceneNode } from "./types.ts";

export const getNode = (id: string) => figmaApi().getNodeByIdAsync(id);

export function tagNode<T extends SceneNode | PageNode>(
	node: T,
	key: string,
): T {
	node.setSharedPluginData(NS, KEY, key);
	note.mutated(node);
	return node;
}

// Figma refleja el sharedPluginData del componente principal en sus instancias (medido en el archivo de pruebas: 32 copias de una
// clave en subcapas de instancias). Dueño de una clave es el nodo que la lleva de verdad: no cuentan las subcapas de una
// instancia ni una instancia cuyo componente principal lleva la misma clave. Una instancia etiquetada a propósito con su
// propia clave sí cuenta
async function isMirror(node: SceneNode, key: string): Promise<boolean> {
	if (insideInstance(node)) return true;
	if (node.type !== "INSTANCE") return false;
	const main = await node.getMainComponentAsync();
	return main !== null && main.getSharedPluginData(NS, KEY) === key;
}

// El nodo con esa clave, en una página o en todas. Con la clave repetida devuelve el primero y avisa
export async function nodeByKey(
	key: string,
	options: { page?: PageNode } = {},
): Promise<SceneNode | null> {
	const pages = options.page ? [options.page] : figmaApi().root.children;
	const found: SceneNode[] = [];
	for (const page of pages) {
		await page.loadAsync();
		for (const node of page.findAllWithCriteria({
			sharedPluginData: { namespace: NS, keys: [KEY] },
		})) {
			if (
				node.getSharedPluginData(NS, KEY) === key &&
				!(await isMirror(node, key))
			) {
				found.push(node);
			}
		}
	}
	if (found.length > 1) {
		note.warn(
			"KEY_DUPLICATED",
			`La clave «${key}» está en ${found.length} nodos; se usa el primero.`,
			found[0]?.id,
		);
	}
	return found[0] ?? null;
}
