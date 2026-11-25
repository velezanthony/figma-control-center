<script lang="ts">
import { type Theme, THEME } from "#web/lib/theme.ts";
import Button, { BUTTON_VARIANT } from "#web/lib/ui/atoms/Button.svelte";
import Icon from "#web/lib/ui/icons/Icon.svelte";

// compact: solo el icono (sidebar colapsada). El texto dice el tema AL QUE se cambia
type Props = { theme: Theme; compact?: boolean; ontoggle: () => void };
let { theme, compact = false, ontoggle }: Props = $props();

const target = $derived(theme === THEME.dark ? THEME.light : THEME.dark);
const label = $derived(target === THEME.light ? "Cambiar a tema claro" : "Cambiar a tema oscuro");
</script>

<Button variant={BUTTON_VARIANT.ghost} size="sm" shape={compact ? "icon" : "default"} onclick={ontoggle} aria-label={label}>
	<Icon name={target === THEME.light ? "sun" : "moon"} />
	{#if !compact}{label}{/if}
</Button>
