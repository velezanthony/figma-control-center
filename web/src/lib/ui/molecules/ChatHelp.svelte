<script lang="ts">
import { tick } from "svelte";
import { CHAT_AGENT_ROLE } from "#web/lib/chat/agent-role.ts";
import Button, { BUTTON_VARIANT } from "#web/lib/ui/atoms/Button.svelte";
import Icon from "#web/lib/ui/icons/Icon.svelte";
import { glossaryHref } from "#web/lib/help/view.ts";
import { float } from "#web/lib/ui/float.ts";

// Ayuda del campo de mensaje: botón de texto que abre un popover (encima, el campo va al pie de la página) con lo que
// se puede pedir desde el navegador
// `anchor`: el elemento sobre el que se abre el popover (la caja del campo); sin él, el propio botón
type Props = { anchor?: HTMLElement | undefined; onpick: (text: string) => void };
let { anchor, onpick }: Props = $props();

// `text` es lo que se escribe en la caja; `code` marca un trozo de la etiqueta que se pinta como código
type Example = { readonly text: string; readonly code?: string };
const EXAMPLES: readonly Example[] = [
	{ text: "¿Cómo está Figma?" },
	{ text: "¿Qué se hizo en la última hora?" },
	{ text: "¿Qué falló hoy?" },
	{ text: "¿Qué cambió hoy en Figma?" },
	{ text: "¿Qué hace el script scripts/", code: "scripts/" },
];

function pick(text: string) {
	close(false);
	onpick(text);
}

const LABEL = "¿Qué puedo pedir?";
const GAP = 8;
const id = $props.id();

let open = $state(false);
let root: HTMLSpanElement | undefined = $state();
let trigger: HTMLSpanElement | undefined = $state();
let panel: HTMLDivElement | undefined = $state();

async function show() {
	open = true;
	await tick();
	panel?.focus();
}

function close(refocus: boolean) {
	open = false;
	if (refocus) root?.querySelector("button")?.focus();
}

function onPanelKey(event: KeyboardEvent) {
	if (event.key === "Escape") {
		event.preventDefault();
		close(true);
	} else if (event.key === "Tab") close(false);
}

function onWindowPointer(event: MouseEvent) {
	if (open && root && !root.contains(event.target as Node)) close(false);
}
</script>

{#snippet code(text: string)}<code class="rounded-md bg-surface-sunken px-1.5 py-0.5 font-mono text-[0.85em] break-words">{text}</code>{/snippet}

<svelte:window onclick={onWindowPointer} />

<span class="inline-flex" bind:this={root}>
	<span bind:this={trigger} class="inline-flex">
		<Button variant={BUTTON_VARIANT.link} size="sm" aria-expanded={open} aria-controls="{id}-help" onclick={() => (open ? close(false) : void show())}><Icon name="information-circle" />{LABEL}</Button>
	</span>
	{#if open}
		<div
			bind:this={panel}
			id="{id}-help"
			role="dialog"
			aria-label={LABEL}
			tabindex="-1"
			popover="manual"
			use:float={{ anchor: anchor ?? trigger, placement: "top-end", gap: GAP }}
			onkeydown={onPanelKey}
			class="m-0 w-80 max-w-[calc(100vw-1rem)] rounded-md border border-border bg-surface p-3 text-xs leading-relaxed text-text-secondary shadow-xl outline-none"
		>
			<p class="font-medium text-text-primary">Pulsa un ejemplo para escribirlo en la caja:</p>
			<ul class="mt-1.5 flex flex-col">
				{#each EXAMPLES as example (example.text)}
					<li>
						<button type="button" onclick={() => pick(example.text)} class="block w-full cursor-pointer rounded-md px-2 py-1.5 text-left transition-colors hover:bg-surface-raised hover:text-text-primary">
							{#if example.code}{example.text.slice(0, -example.code.length)}{@render code(example.code)}{:else}{example.text}{/if}
						</button>
					</li>
				{/each}
			</ul>
			<p class="mt-2">{CHAT_AGENT_ROLE}</p>
			<p class="mt-2 text-text-muted">Los comandos con barra ({@render code("/mcp")}, {@render code("/exit")}…) no existen aquí. Para cerrar el agente, usa <strong class="font-semibold text-text-primary">Cerrar agente</strong>.</p>
			<div class="mt-2"><Button variant={BUTTON_VARIANT.link} size="sm" href={glossaryHref("tools")} onclick={() => close(false)}>Ver las herramientas del agente</Button></div>
		</div>
	{/if}
</span>
