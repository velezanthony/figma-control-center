<script lang="ts">
import Icon from "#web/lib/ui/icons/Icon.svelte";

// Recordatorio discreto del proyecto cuyos datos se están viendo. El selector global sigue siendo
// la fuente única de cambio; esto solo da contexto en la cabecera de una vista de datos. Si no hay
// proyecto activo (registro vacío) no pinta nada. Es presentacional: recibe el nombre ya resuelto.
type Props = { name: string | null };
let { name }: Props = $props();
</script>

{#if name}
	<span class="inline-flex items-center gap-1.5 rounded-md bg-surface-sunken px-2 py-1 text-xs font-medium text-text-secondary">
		<span class="text-brand-600"><Icon name="server-stack" size="xs" /></span>{name}
	</span>
{/if}
