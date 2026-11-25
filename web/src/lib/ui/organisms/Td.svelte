<script lang="ts">
import type { Snippet } from "svelte";

type Align = "left" | "right";
// label: etiqueta de la columna, que se muestra delante del valor cuando la tabla pasa a tarjetas (móvil)
type Props = { align?: Align; muted?: boolean; mono?: boolean; label?: string; children: Snippet };

let { align = "left", muted = false, mono = false, label, children }: Props = $props();
</script>

<td
	data-label={label}
	class="px-4 py-2.5 text-sm max-md:flex max-md:items-center max-md:justify-between max-md:gap-3 max-md:px-0 max-md:py-1.5 max-md:before:text-xs max-md:before:text-text-muted max-md:before:content-[attr(data-label)] {align === 'right' ? 'text-right tabular-nums' : 'text-left'} {muted ? 'text-text-muted' : ''} {mono ? 'font-mono text-xs' : ''}"
>
	{@render children()}
</td>
