<script lang="ts">
import { findRanges, splitByRanges } from "#web/lib/chat/fold.ts";

// Un texto con lo buscado envuelto en <mark>. Solo troceado de texto: no toca atributos ni estructura, y como lo pinta
// Svelte, el contenido nunca se interpreta como HTML. `active`: el resultado en el que está el cursor de la búsqueda
type Props = { text: string; query: string; active?: boolean };
let { text, query, active = false }: Props = $props();

const parts = $derived(splitByRanges(text, findRanges(text, query)));
const MARK = { idle: "bg-warning-100", active: "bg-warning-300" } as const;
</script>

{#each parts as part, i (i)}{#if part.hit}<mark class="rounded-sm text-text-primary {active ? MARK.active : MARK.idle}">{part.text}</mark>{:else}{part.text}{/if}{/each}
