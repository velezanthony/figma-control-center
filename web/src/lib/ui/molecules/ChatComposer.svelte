<script lang="ts">
import { tick } from "svelte";
import { composerHeight, shouldSubmit } from "#web/lib/chat/composer.ts";
import Button, { BUTTON_VARIANT } from "#web/lib/ui/atoms/Button.svelte";
import Icon from "#web/lib/ui/icons/Icon.svelte";
import ChatHelp from "#web/lib/ui/molecules/ChatHelp.svelte";

// Campo de mensaje que crece con el texto: Intro envía, Mayús+Intro salta de línea. El botón de enviar va dentro
// del campo. `lg` es el del estado vacío (más alto desde el principio)
type Size = "md" | "lg";
type Props = {
	value?: string;
	size?: Size;
	// Sin sesión viva no se puede escribir: el motivo ocupa el lugar del placeholder
	disabledReason?: string | undefined;
	sending?: boolean;
	error?: string | null;
	maxLength: number;
	onsubmit: () => void;
};

let { value = $bindable(""), size = "md", disabledReason, sending = false, error = null, maxLength, onsubmit }: Props = $props();

const MAX_LINES = 8;
const MIN_LINES: Record<Size, number> = { md: 1, lg: 2 };
const FINE_POINTER = "(pointer: fine)";

let field: HTMLTextAreaElement | undefined = $state();
let box: HTMLDivElement | undefined = $state();
const disabled = $derived(disabledReason !== undefined);
const canSend = $derived(!disabled && !sending && value.trim() !== "");

// Mide el contenido y ajusta el alto; con `auto` primero para que también encoja al borrar
$effect(() => {
	value;
	if (field === undefined) return;
	field.style.height = "auto";
	const style = getComputedStyle(field);
	field.style.height = `${composerHeight({
		scrollHeight: field.scrollHeight,
		lineHeight: Number.parseFloat(style.lineHeight),
		minLines: MIN_LINES[size],
		maxLines: MAX_LINES,
		padding: Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom),
	})}px`;
});

// El foco al montar solo con ratón: en móvil abriría el teclado sin que nadie lo pida
$effect(() => {
	if (field !== undefined && !disabled && matchMedia(FINE_POINTER).matches) field.focus();
});

// Un ejemplo de la ayuda sustituye el texto; no se envía, el usuario lo completa
async function pickExample(text: string) {
	value = text;
	await tick();
	field?.focus();
	field?.setSelectionRange(text.length, text.length);
}

function onkeydown(event: KeyboardEvent) {
	if (!shouldSubmit(event)) return;
	event.preventDefault();
	if (canSend) onsubmit();
}
</script>

<div>
	<div bind:this={box} class="flex items-end gap-2 rounded-2xl border border-border bg-surface p-2 shadow-xs transition duration-base focus-within:border-brand-500 focus-within:ring-3 focus-within:ring-brand-500/15 {disabled ? 'bg-surface-sunken' : ''}">
		<textarea
			bind:this={field}
			bind:value
			{onkeydown}
			{disabled}
			rows={1}
			maxlength={maxLength}
			name="mensaje"
			aria-label="Mensaje para Claude"
			aria-invalid={error !== null || undefined}
			placeholder={disabledReason ?? "Pregunta algo sobre el trabajo en Figma"}
			class="min-w-0 flex-1 resize-none bg-transparent px-2 py-2 text-sm leading-6 text-text-primary outline-none placeholder:text-text-muted disabled:cursor-not-allowed"
		></textarea>
		<Button type="button" variant={BUTTON_VARIANT.primary} shape="icon" aria-label="Enviar mensaje" disabled={!canSend} loading={sending} onclick={onsubmit}>
			<Icon name="arrow-up" weight="bold" />
		</Button>
	</div>
	{#if error}<p role="alert" class="mt-1.5 px-2 text-xs text-danger-700">{error}</p>{/if}
	<div class="mt-1.5 flex items-center justify-between gap-3 px-2">
		<p class="hidden text-[11px] text-text-muted sm:block">Intro envía · Mayús+Intro añade una línea</p>
		<span class="ml-auto"><ChatHelp anchor={box} onpick={pickExample} /></span>
	</div>
</div>
