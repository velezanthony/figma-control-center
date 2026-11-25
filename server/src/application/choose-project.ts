import type { TenantConfig } from "#domain/config.ts";

export type ProjectChoice =
	| { readonly kind: "one"; readonly tenant: TenantConfig }
	| { readonly kind: "none"; readonly message: string }
	| {
			readonly kind: "ambiguous";
			readonly ids: readonly string[];
			readonly message: string;
	  };

// Con varios proyectos en alcance y ninguno elegido, servir el primero escribiría en un archivo de Figma que nadie
// eligió: se pide elegir. Un proyecto elige por FCC_PROJECTS o por `make agent PROJECT=<id>`. Los mensajes son el
// error de uso que reciben las herramientas: `panelUrl` es dónde se da de alta un proyecto y `problems` lo que el
// registro no pudo leer (con su ruta).
export function chooseProject(
	tenants: readonly TenantConfig[],
	panelUrl: string,
	problems: readonly string[] = [],
): ProjectChoice {
	const [first] = tenants;
	if (first === undefined) {
		const registry =
			problems.length === 0
				? ""
				: ` El registro tiene un problema: ${problems.join(" · ")}`;
		return {
			kind: "none",
			message: `No hay ningún proyecto. Da de alta uno en la página "Proyectos" del panel (${panelUrl}).${registry}`,
		};
	}
	if (tenants.length === 1) return { kind: "one", tenant: first };
	const ids = tenants.map((t) => t.id);
	return {
		kind: "ambiguous",
		ids,
		message: `Hay ${ids.length} proyectos en alcance y ninguno elegido: elige uno: ${tenants.map((t) => `${t.id} («${t.name}»)`).join(", ")}. Hazlo con FCC_PROJECTS=<id> en el entorno del servidor MCP, o lanza el agente con make agent PROJECT=<id>.`,
	};
}
