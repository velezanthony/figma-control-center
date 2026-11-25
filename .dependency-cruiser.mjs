// Capas y alcanzabilidad del servidor (lo transitivo; las fronteras directas también las vigila ESLint).
// Las rutas salen de la misma fuente que ESLint. `npm run lint` lo ejecuta.
import { ADAPTER, PATH } from "./eslint/architecture.ts";

const under = (dir) => `^${dir}/`;
const exactly = (file) => `^${file.replaceAll(".", "\\.")}$`;
const adapters = (...names) => `^${PATH.adapters}/(?:${names.join("|")})/`;

export default {
	forbidden: [
		{
			name: "dominio-puro",
			comment: "domain no importa application ni adapters",
			severity: "error",
			from: { path: under(PATH.domain) },
			to: { path: [under(PATH.application), under(PATH.adapters)] },
		},
		{
			name: "application-sin-adaptadores",
			comment: "application solo importa domain",
			severity: "error",
			from: { path: under(PATH.application) },
			to: { path: under(PATH.adapters) },
		},
		{
			name: "mcp-sin-http",
			comment:
				"adapters/http escribe en stdout y abre puertos: el proceso MCP no lo carga ni transitivamente",
			severity: "error",
			from: { path: exactly(PATH.main) },
			to: { path: adapters(ADAPTER.http), reachable: true },
		},
		{
			name: "panel-sin-figma-ni-mcp",
			comment:
				"el panel solo lee la base: nunca habla con Figma ni con MCP, ni transitivamente",
			severity: "error",
			from: { path: exactly(PATH.dashboard) },
			to: { path: adapters(ADAPTER.cdp, ADAPTER.mcp), reachable: true },
		},
		{
			name: "panel-sin-navegador",
			comment:
				"el panel no lanza el Chrome de captura de la web, ni transitivamente (solo lo cablea main.ts)",
			severity: "error",
			from: { path: exactly(PATH.dashboard) },
			to: { path: adapters(ADAPTER.web), reachable: true },
		},
	],
	options: {
		// Sin los `import type`: se borran al ejecutar y no cargan nada
		tsPreCompilationDeps: false,
		tsConfig: { fileName: "server/tsconfig.json" },
		doNotFollow: { path: "node_modules" },
		exclude: { path: ["\\.test\\.ts$", "/testing/"] },
		enhancedResolveOptions: {
			conditionNames: ["import", "node", "default"],
			exportsFields: ["exports"],
		},
	},
};
