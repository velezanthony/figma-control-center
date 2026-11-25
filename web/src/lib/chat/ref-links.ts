import { nodeUrl, shortId } from "#web/lib/activity/format.ts";
import { hrefOf, ROUTE_NAME } from "#web/lib/route.ts";

type Ref = { readonly t: "node" | "call"; readonly id: string };

// Un nodo abre Figma (si se conoce el archivo de la sesión); una llamada abre su detalle en Actividad
export const refHref = (ref: Ref, fileUrl: string | null): string | null =>
	ref.t === "node"
		? fileUrl === null
			? null
			: nodeUrl(fileUrl, ref.id)
		: hrefOf(ROUTE_NAME.activity, `open=${encodeURIComponent(ref.id)}`);

export const refLabel = (ref: Ref): string =>
	ref.t === "node" ? ref.id : shortId(ref.id);
