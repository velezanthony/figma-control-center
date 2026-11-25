<script lang="ts">
import type { Snippet } from "svelte";
import { float } from "#web/lib/ui/float.ts";

type Placement = "top" | "bottom";
type Props = {
	placement?: Placement;
	// Ocupa todo el ancho (el disparador es un campo que debe seguir llenando su contenedor)
	fill?: boolean;
	// Recibe el atributo que enlaza el disparador con el tooltip: se esparce sobre el elemento enfocable
	children: Snippet<[{ "aria-describedby": string }]>;
	content: Snippet;
};

let { placement = "top", fill = false, children, content }: Props = $props();

const id = $props.id();
let open = $state(false);

const GAP = 8;
let anchor: HTMLElement | undefined = $state();

const close = () => (open = false);
const show = () => (open = true);
</script>

<span
	bind:this={anchor}
	class={fill ? "flex w-full flex-col" : "inline-flex"}
	role="presentation"
	onmouseenter={show}
	onmouseleave={close}
	onfocusin={show}
	onfocusout={close}
	onkeydown={(event) => event.key === "Escape" && close()}
>
	{@render children({ "aria-describedby": id })}
	<!-- inert: sin él, Tab desde el disparador entra en el popover abierto (hermano siguiente) y el foco cae en <body> -->
	<span
		{id}
		role="tooltip"
		popover="manual"
		inert
		use:float={{ anchor, placement, gap: GAP, open }}
		class="pointer-events-none m-0 w-max max-w-xs rounded-md border-0 bg-text-primary px-2.5 py-1.5 text-xs leading-snug text-surface shadow-md transition duration-base starting:translate-y-0.5 starting:opacity-0"
	>
		{@render content()}
	</span>
</span>
