import type {
	PermissionBehavior,
	PermissionRequest,
} from "#web/lib/contract.ts";
import { withProject } from "#web/lib/projects/endpoints.ts";
import { projectState } from "#web/lib/projects/projects.svelte.ts";
import {
	CHAT_PERMISSIONS_PATH,
	chatPermissionsUrl,
	DECIDE_PERMISSION_INIT,
} from "./endpoints.ts";
import { decisionError } from "./permissions.ts";

const POLL_MS = 1500;

// Las peticiones de permiso de la sesión elegida. Se piden a la API (el estado cambia en la base y no hay cola de
// eventos) y se repiten mientras la pantalla está abierta. Debe crearse durante la inicialización de un componente
export function createPermissions(session: () => string | null) {
	let items = $state.raw<readonly PermissionRequest[]>([]);
	// La petición que se está contestando: sus botones esperan a que el servidor responda
	let busyId = $state<number | null>(null);
	let error = $state<string | null>(null);

	async function refresh(id: string, signal?: AbortSignal): Promise<void> {
		const response = await fetch(
			withProject(chatPermissionsUrl(id), projectState.activeId),
			signal === undefined ? {} : { signal },
		);
		const body = (await response.json()) as { items?: PermissionRequest[] };
		if (session() === id) items = body.items ?? [];
	}

	$effect(() => {
		const id = session();
		// Leer el proyecto activo aquí hace que al cambiarlo se vuelvan a pedir los permisos del nuevo
		void projectState.activeId;
		items = [];
		error = null;
		busyId = null;
		if (id === null) return;
		const controller = new AbortController();
		const poll = () => {
			refresh(id, controller.signal).catch(() => {
				// el siguiente intento lo reintenta
			});
		};
		poll();
		const timer = setInterval(poll, POLL_MS);
		return () => {
			clearInterval(timer);
			controller.abort();
		};
	});

	async function decide(
		requestId: number,
		behavior: PermissionBehavior,
	): Promise<void> {
		const id = session();
		if (id === null || busyId !== null) return;
		busyId = requestId;
		error = null;
		try {
			const response = await fetch(
				withProject(CHAT_PERMISSIONS_PATH, projectState.activeId),
				DECIDE_PERMISSION_INIT(id, requestId, behavior),
			);
			if (!response.ok)
				error = decisionError(
					await response.json().catch(() => null),
					response.statusText,
				);
			// Con éxito o con conflicto, el estado verdadero es el del servidor
			await refresh(id);
		} catch (e) {
			error = (e as Error).message;
		} finally {
			busyId = null;
		}
	}

	return {
		get items() {
			return items;
		},
		get busyId() {
			return busyId;
		},
		get error() {
			return error;
		},
		decide,
	};
}
