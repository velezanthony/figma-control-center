<script lang="ts">
import type { Snippet } from "svelte";
import Button, { BUTTON_VARIANT } from "#web/lib/ui/atoms/Button.svelte";
import Icon from "#web/lib/ui/icons/Icon.svelte";

// Aviso pequeño sobre el campo de escribir: hay peticiones de permiso esperando que no se ven en la conversación.
// El texto llega por el snippet («2 permisos esperando»); «Ver» lleva hasta la primera
type Props = { onview: () => void; children: Snippet };
let { onview, children }: Props = $props();
</script>

<div class="flex items-center gap-2 rounded-md border border-warning-200 bg-warning-50 py-1 pr-1 pl-3 text-sm text-warning-700">
	<Icon name="command-line" size="sm" />
	<span class="font-medium">{@render children()}</span>
	<span aria-hidden="true">·</span>
	<Button variant={BUTTON_VARIANT.link} size="sm" onclick={onview}>Ver</Button>
</div>
