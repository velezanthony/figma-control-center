<script module lang="ts">
// Tamaños del panel del modal como fuente única: la unión se deriva del token.
export const MODAL_SIZE = { sm: "sm", md: "md", lg: "lg", xl: "xl" } as const;
export type ModalSize = (typeof MODAL_SIZE)[keyof typeof MODAL_SIZE];
</script>

<script lang="ts">
import type { Snippet } from "svelte";
import Icon from "#web/lib/ui/icons/Icon.svelte";
import Button, { BUTTON_VARIANT } from "#web/lib/ui/atoms/Button.svelte";

// Modal accesible sobre <dialog>: foco atrapado, Escape y capa superior nativos (no se recorta).
// Es presentacional: el padre controla `open` y recibe `onclose` (Escape, clic fuera o botón de cerrar).
type Props = {
	open: boolean;
	onclose: () => void;
	size?: ModalSize;
	title: Snippet;
	children: Snippet;
	// Pie opcional para las acciones (Guardar, Cancelar…)
	footer?: Snippet;
};
let { open, onclose, size = "md", title, children, footer }: Props = $props();

let dialog = $state<HTMLDialogElement | null>(null);
const titleId = $props.id();

// Foco al abrir: el primer campo del cuerpo; si no hay ninguno (un aviso de confirmación), el primer botón del pie
const FOCUSABLE =
	"input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), a[href]";
function focusFirst(el: HTMLDialogElement): void {
	const target =
		el.querySelector<HTMLElement>(`[data-modal-body] :is(${FOCUSABLE})`) ??
		el.querySelector<HTMLElement>(`[data-modal-footer] :is(${FOCUSABLE})`);
	target?.focus();
}

// Abre/cierra el <dialog> real siguiendo la prop `open`
$effect(() => {
	const el = dialog;
	if (el === null) return;
	if (open && !el.open) {
		el.showModal();
		focusFirst(el);
	} else if (!open && el.open) el.close();
});

const SIZE: Record<ModalSize, string> = {
	sm: "max-w-sm",
	md: "max-w-lg",
	lg: "max-w-2xl",
	xl: "max-w-3xl",
};

// Escape: el padre decide si cierra (p. ej. no mientras guarda); el <dialog> solo se cierra con `open`
// Un segundo Escape sin gesto no se deja cancelar y el navegador cierra él solo, con el `close` algo después:
// el padre decide ya, en la pulsación, y no cuando llegue el `close` (para entonces pudo dejar de estar ocupado)
let decidedOnCancel = false;
function onCancel(event: Event): void {
	event.preventDefault();
	onclose();
	if (!event.cancelable) decidedOnCancel = true;
}

// Si el navegador lo cierra por su cuenta, el estado no se separa: se vuelve a abrir si el padre lo quiere abierto
function onNativeClose(): void {
	const decided = decidedOnCancel;
	decidedOnCancel = false;
	if (!open) return;
	if (!decided) onclose();
	if (open && dialog !== null && !dialog.open) dialog.showModal();
}

// Clic en el backdrop (el propio <dialog>, fuera del panel) = cerrar, pero solo si el botón también se pulsó allí:
// soltar sobre el fondo un arrastre de selección que empezó en un campo no es un clic en el fondo
let pressedOnBackdrop = false;
function onBackdropDown(event: MouseEvent): void {
	pressedOnBackdrop = event.target === dialog;
}
function onBackdrop(event: MouseEvent): void {
	const closes = event.target === dialog && pressedOnBackdrop;
	pressedOnBackdrop = false;
	if (closes) onclose();
}
</script>

<dialog
	bind:this={dialog}
	oncancel={onCancel}
	onclose={onNativeClose}
	aria-labelledby={titleId}
	onmousedown={onBackdropDown}
	onclick={onBackdrop}
	class="m-auto w-[calc(100vw-2rem)] {SIZE[size]} rounded-lg border border-border bg-surface-raised p-0 text-text-primary shadow-modal backdrop:bg-overlay/55 backdrop:backdrop-blur-[2px]"
>
	{#if open}
		<!-- Cabecera y pie fijos; solo el cuerpo hace scroll cuando el contenido es alto -->
		<div class="flex max-h-[calc(100dvh-4rem)] flex-col">
			<div class="flex shrink-0 items-center justify-between gap-4 border-b border-border px-5 py-4">
				<h2 id={titleId} class="text-base font-semibold text-text-primary">{@render title()}</h2>
				<Button variant={BUTTON_VARIANT.ghost} size="sm" shape="icon" aria-label="Cerrar" onclick={onclose}>
					<Icon name="x-mark" size="sm" />
				</Button>
			</div>
			<div data-modal-body class="overflow-y-auto px-5 py-4">{@render children()}</div>
			{#if footer}
				<div data-modal-footer class="flex shrink-0 justify-end gap-2 border-t border-border px-5 py-4">{@render footer()}</div>
			{/if}
		</div>
	{/if}
</dialog>
