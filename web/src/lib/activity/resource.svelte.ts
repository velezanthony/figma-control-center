import { withProject } from "#web/lib/projects/endpoints.ts";
import { projectState } from "#web/lib/projects/projects.svelte.ts";

// Una consulta a la API que se vuelve a pedir cuando cambia su URL, cuando `refresh` cambia (un evento en
// vivo) o cuando cambia el proyecto activo. Mientras llega la respuesta nueva se conserva la anterior (la
// tabla no parpadea) y una respuesta tardía de una URL vieja se descarta
export function createResource<T>(
	url: () => string | null,
	refresh: () => unknown,
) {
	let data = $state.raw<T | null>(null);
	let loading = $state(false);
	let error = $state<string | null>(null);

	$effect(() => {
		const target = url();
		refresh();
		// Leer el proyecto activo aquí hace que al cambiarlo se vuelva a pedir con el nuevo ?project
		const projectId = projectState.activeId;
		if (target === null) return;
		const controller = new AbortController();
		loading = true;
		fetch(withProject(target, projectId), { signal: controller.signal })
			.then(async (response) => {
				const body = (await response.json()) as {
					ok?: boolean;
					error?: { message?: string };
				};
				if (!response.ok || body.ok === false) {
					throw new Error(body.error?.message ?? response.statusText);
				}
				data = body as T;
				error = null;
			})
			.catch((e: unknown) => {
				if ((e as Error).name !== "AbortError") error = (e as Error).message;
			})
			.finally(() => {
				if (!controller.signal.aborted) loading = false;
			});
		return () => controller.abort();
	});

	return {
		get data() {
			return data;
		},
		get loading() {
			return loading;
		},
		get error() {
			return error;
		},
	};
}
