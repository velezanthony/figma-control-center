import { tick } from "svelte";
import type { ChatMessage, ChatSearchResult } from "#web/lib/contract.ts";
import { withProject } from "#web/lib/projects/endpoints.ts";
import { projectState } from "#web/lib/projects/projects.svelte.ts";
import { chatSearchUrl } from "./endpoints.ts";
import { fold, foldQuery } from "./fold.ts";
import { plainTextOf } from "./plain-text.ts";
import {
	countLabel,
	initialResult,
	mergeResults,
	stepResult,
} from "./search-state.ts";

// Con menos letras que esto no se pregunta al servidor (FTS5 buscaría por prefijo en casi todo)
const MIN_REMOTE_CHARS = 2;
const REMOTE_DEBOUNCE_MS = 200;

// El buscador del chat: dos niveles. Lo cargado se busca al instante en memoria (sobre el texto que se ve, sin
// Markdown); todo el historial, en el servidor (FTS5). Los resultados son los dos unidos, por id. Debe crearse durante
// la inicialización de un componente
export function createChatSearch(deps: {
	session: () => string | null;
	messages: () => readonly ChatMessage[];
	// Carga lo que falte hasta el mensaje (los antiguos no están en memoria)
	loadAround: (messageId: number) => Promise<void>;
}) {
	let open = $state(false);
	let query = $state("");
	let remote = $state.raw<readonly number[]>([]);
	let truncated = $state(false);
	let searching = $state(false);
	let current = $state<number | null>(null);
	let jumper: ((messageId: number) => void) | null = null;
	let jumpToken = 0;

	// Texto plegado de cada mensaje cargado, calculado una vez (lo que dice un mensaje no cambia)
	const folded = new Map<number, string>();
	const foldedOf = (m: ChatMessage): string => {
		let text = folded.get(m.id);
		if (text === undefined) {
			// Lo que escribe el usuario se pinta tal cual; lo de Claude, como Markdown
			text = fold(m.direction === "in" ? m.body : plainTextOf(m.body)).text;
			folded.set(m.id, text);
		}
		return text;
	};

	const needle = $derived(foldQuery(query));
	const local = $derived(
		!open || needle === ""
			? []
			: deps
					.messages()
					.filter((m) => foldedOf(m).includes(needle))
					.map((m) => m.id),
	);
	const results = $derived(mergeResults(local, remote));

	$effect(() => {
		const text = query;
		const id = deps.session();
		const projectId = projectState.activeId;
		remote = [];
		truncated = false;
		searching = false;
		if (!open || id === null || needle.length < MIN_REMOTE_CHARS) return;
		searching = true;
		const controller = new AbortController();
		const timer = setTimeout(async () => {
			try {
				const response = await fetch(
					withProject(chatSearchUrl(id, text), projectId),
					{ signal: controller.signal },
				);
				const body = (await response.json()) as ChatSearchResult;
				remote = body.items.map((hit) => hit.id);
				truncated = body.truncated;
			} catch {
				// una búsqueda cancelada o caída deja solo lo local
			} finally {
				if (!controller.signal.aborted) searching = false;
			}
		}, REMOTE_DEBOUNCE_MS);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	});

	async function go(messageId: number): Promise<void> {
		const token = ++jumpToken;
		await deps.loadAround(messageId);
		await tick();
		if (token === jumpToken) jumper?.(messageId);
	}

	// Al cambiar los resultados se conserva el actual si sigue valiendo; si no, el más reciente
	$effect(() => {
		const next = initialResult(results, current);
		if (next === current) return;
		current = next;
		if (next !== null) void go(next);
	});

	function step(direction: 1 | -1): void {
		const next = stepResult(results, current, direction);
		if (next === null) return;
		current = next;
		void go(next);
	}

	return {
		get open() {
			return open;
		},
		get query() {
			return query;
		},
		set query(value: string) {
			query = value;
		},
		// Lo que se resalta en los mensajes: nada si la barra está cerrada
		get highlight() {
			return open ? query : "";
		},
		get current() {
			return current;
		},
		get label() {
			return countLabel({ ids: results, current, searching, truncated });
		},
		get hasResults() {
			return results.length > 0;
		},
		show() {
			open = true;
		},
		close() {
			open = false;
			current = null;
		},
		next: () => step(1),
		previous: () => step(-1),
		// Quien pinta la lista dice cómo llegar a un mensaje (scroll)
		bindJumper(fn: ((messageId: number) => void) | null) {
			jumper = fn;
		},
	};
}

export type ChatSearch = ReturnType<typeof createChatSearch>;
