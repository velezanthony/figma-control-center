<script lang="ts" generics="T">
import { onDestroy, type Snippet, untrack } from "svelte";
import { isAtBottom, isExactlyAtBottom, isScrollSettled, shouldRepin } from "#web/lib/chat/scroll.ts";
import {
	applyMeasurements,
	buildOffsets,
	captureAnchor,
	includeIndex,
	keysInView,
	restoreAnchor,
	visibleRange,
} from "#web/lib/chat/virtual.ts";

// Lista con scroll que solo monta lo que se ve más un colchón arriba y abajo (alturas variables: se estima lo que no
// se ha montado y se mide lo que sí). La matemática vive en lib/chat/virtual.ts (con tests); esto mide, anota y pinta.
// Mantiene lo que se ve quieto cuando cambian las alturas de arriba o se añaden elementos antiguos, y pega la vista
// al final mientras el usuario esté abajo. Limitación: el buscador del navegador (Ctrl+F) solo ve lo montado.
type Props = {
	items: readonly T[];
	// Clave estable de cada elemento (el id del mensaje): con ella se conservan las alturas medidas y el ancla
	keyOf: (item: T) => number;
	row: Snippet<[T]>;
	// Contenido tras el último elemento (p. ej. «Claude está pensando»); sigue al final si el usuario está abajo
	footer?: Snippet;
	label: string;
	busy?: boolean;
	// Altura que se supone a un elemento sin medir
	estimate: number;
	// Colchón montado a cada lado, en alturas de pantalla
	overscan: number;
	// El usuario está (aprox.) al final: lo lee quien pinta «Ir al final»
	atBottom?: boolean;
	// Claves de lo que se ve de verdad en la pantalla (null hasta que la lista se coloca): lo lee quien avisa de algo
	// que ha quedado fuera de la vista
	inView?: readonly number[] | null;
	// La vista se acerca al primer elemento: hora de pedir los anteriores
	onreachstart?: () => void;
};
let { items, keyOf, row, footer, label, busy = false, estimate, overscan, atBottom = $bindable(true), inView = $bindable(null), onreachstart }: Props = $props();

// Cuántos elementos desde el principio cuentan como «cerca del principio»
const REACH_START_ROWS = 2;
const MOVE_EPSILON_PX = 0.5;
const NOT_A_ROW = null;
// Tras saltar a un elemento se mantiene centrado mientras se miden las filas de alrededor (las estimaciones se corrigen)
const PIN_MS = 800;
// Lo que tiene que asomar un elemento para contar como visto (o entero, si es más bajo)
const MIN_VISIBLE_PX = 48;

// Alturas medidas: no reactivas (se leen al calcular los desplazamientos, que dependen de `version`)
const heights = new Map<number, number>();
let version = $state(0);
let scrollTop = $state(0);
let viewport = $state(0);
let ready = $state(false);
let focusedKey = $state<number | null>(null);
let scroller: HTMLDivElement | undefined = $state();
// Último scroll conocido: el del evento, no el del DOM (que el navegador puede haber acotado al encoger el contenido)
let lastTop = 0;
let pinned: { key: number; until: number } | null = null;
// El usuario movió el scroll (rueda, tacto, puntero, teclado) y no ha vuelto abajo del todo: un scroll sin gesto
// (el navegador acotándolo al cambiar el alto de la caja) no es suyo y se corrige
let userScrolling = false;
// La lista ya midió y colocó el scroll: lo leen los tests y la captura de la galería antes de fotografiarla
let settled = $state(false);

const keys = $derived(items.map(keyOf));
const offsets = $derived.by(() => {
	version;
	return buildOffsets(keys, heights, estimate);
});
const total = $derived(offsets[offsets.length - 1] ?? 0);
const range = $derived.by(() => {
	const base = visibleRange(offsets, scrollTop, viewport, viewport * overscan);
	return focusedKey === null ? base : includeIndex(base, keys.indexOf(focusedKey), keys.length);
});
const mounted = $derived(items.slice(range.start, range.end));
const topSpace = $derived(offsets[range.start] ?? 0);
const bottomSpace = $derived(total - (offsets[range.end] ?? total));

// Un solo observador para todas las filas: la altura real de cada una sustituye a la estimación
const keyOfElement = new Map<Element, number | typeof NOT_A_ROW>();
const observer = new ResizeObserver((entries) => {
	const measured: (readonly [number, number])[] = [];
	let footerChanged = false;
	for (const entry of entries) {
		const key = keyOfElement.get(entry.target);
		if (key === undefined) continue;
		if (key === NOT_A_ROW) footerChanged = true;
		else measured.push([key, entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height]);
	}
	if (applyMeasurements(heights, measured) || footerChanged) {
		settled = false;
		version++;
	}
});
onDestroy(() => observer.disconnect());

function measure(node: HTMLElement, key: number | typeof NOT_A_ROW) {
	keyOfElement.set(node, key);
	observer.observe(node);
	return {
		update(next: number | typeof NOT_A_ROW) {
			keyOfElement.set(node, next);
		},
		destroy() {
			keyOfElement.delete(node);
			observer.unobserve(node);
		},
	};
}

function onscroll() {
	if (scroller === undefined) return;
	const pinnedBefore = atBottom;
	if (shouldRepin({ pinned: pinnedBefore && pinned === null, userScrolling, metrics: scroller })) scroller.scrollTop = scroller.scrollHeight;
	lastTop = scrollTop = scroller.scrollTop;
	atBottom = isAtBottom(scroller);
	if (isExactlyAtBottom(scroller)) userScrolling = false;
	settled = ready && isScrollSettled({ pinned: atBottom, metrics: scroller });
}

function setTop(top: number) {
	if (scroller === undefined) return;
	scroller.scrollTop = top;
	lastTop = scrollTop = scroller.scrollTop;
}

// El scroll que deja el elemento centrado en la vista
function centeredTop(index: number): number {
	const top = offsets[index] ?? 0;
	const height = (offsets[index + 1] ?? top) - top;
	return Math.max(0, top - Math.max(0, (viewport - height) / 2));
}

// Lleva la vista a un elemento (debe estar en `items`) y lo mantiene centrado un instante mientras se miden las
// filas de alrededor. Cualquier gesto del usuario suelta el anclaje
export function scrollToKey(key: number) {
	const index = keys.indexOf(key);
	if (scroller === undefined || index === -1) return;
	atBottom = false;
	pinned = { key, until: performance.now() + PIN_MS };
	setTop(centeredTop(index));
}
const release = () => {
	pinned = null;
	userScrolling = true;
};

export function scrollToBottom() {
	if (scroller === undefined) return;
	atBottom = true;
	userScrolling = false;
	setTop(scroller.scrollHeight);
}

// Tras cada cambio de layout (mensajes nuevos o antiguos, alturas medidas): al final si estaba abajo; si no, el ancla
// (el elemento que había bajo el borde superior) vuelve a donde estaba en pantalla
let committed: { keys: number[]; offsets: number[] } | null = null;
$effect(() => {
	const next = { keys, offsets };
	const previous = committed;
	committed = next;
	if (scroller === undefined) return;
	const pin = pinned !== null && performance.now() < pinned.until ? pinned : null;
	if (pin !== null && keys.includes(pin.key)) {
		setTop(centeredTop(keys.indexOf(pin.key)));
	} else if (untrack(() => atBottom)) {
		setTop(scroller.scrollHeight);
	} else if (previous !== null) {
		const anchor = captureAnchor(previous.keys, previous.offsets, lastTop);
		const top = anchor === null ? null : restoreAnchor(anchor, next.keys, next.offsets);
		if (top !== null && Math.abs(top - scroller.scrollTop) > MOVE_EPSILON_PX) setTop(top);
	}
	ready = true;
	settled = isScrollSettled({ pinned: untrack(() => atBottom), metrics: scroller });
});

$effect(() => {
	inView = ready ? keysInView(keys, offsets, scrollTop, viewport, MIN_VISIBLE_PX) : null;
});

// Con la vista cerca del principio se piden los anteriores (no antes de colocarse abajo la primera vez)
$effect(() => {
	if (ready && items.length > 0 && range.start <= REACH_START_ROWS) untrack(() => onreachstart?.());
});

// El elemento con el foco (un enlace, «Copiar») no se desmonta aunque salga del colchón
function onfocusin(event: FocusEvent) {
	const key = (event.target as Element | null)?.closest("[data-key]")?.getAttribute("data-key");
	focusedKey = key === null || key === undefined ? null : Number(key);
}
function onfocusout(event: FocusEvent) {
	if (!scroller?.contains(event.relatedTarget as Node | null)) focusedKey = null;
}
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions: una región con scroll debe poder enfocarse con teclado y los gestos del usuario sueltan el anclaje del salto -->
<div
	bind:this={scroller}
	bind:clientHeight={viewport}
	role="feed"
	tabindex="0"
	aria-label={label}
	aria-busy={busy}
	data-settled={settled}
	{onscroll}
	onwheel={release}
	ontouchstart={release}
	onpointerdown={release}
	onkeydown={release}
	{onfocusin}
	{onfocusout}
	class="h-full overflow-y-auto [overflow-anchor:none]"
>
	<div style:padding-top="{topSpace}px" style:padding-bottom="{bottomSpace}px">
		{#each mounted as item, i (keyOf(item))}
			<div use:measure={keyOf(item)} data-key={keyOf(item)} role="article" aria-posinset={range.start + i + 1} aria-setsize={items.length} class="pb-6">{@render row(item)}</div>
		{/each}
	</div>
	{#if footer}<div use:measure={NOT_A_ROW} class="pb-6">{@render footer()}</div>{/if}
</div>
