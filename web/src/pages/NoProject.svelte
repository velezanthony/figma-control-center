<script lang="ts">
import { NEEDS_PROJECT_HINT } from "#web/lib/projects/gating.ts";
import { hrefOf, ROUTE_NAME } from "#web/lib/route.ts";
import Button, { BUTTON_VARIANT } from "#web/lib/ui/atoms/Button.svelte";
import Icon from "#web/lib/ui/icons/Icon.svelte";
import EmptyState from "#web/lib/ui/molecules/EmptyState.svelte";
</script>

<EmptyState>
	{#snippet icon()}<Icon name="server-stack" size="lg" />{/snippet}
	{NEEDS_PROJECT_HINT}
	{#snippet description()}Esta pantalla muestra la actividad de un proyecto, y ahora no hay ninguno activo.{/snippet}
	{#snippet actions()}<Button variant={BUTTON_VARIANT.primary} href={hrefOf(ROUTE_NAME.projects)}>Ir a Proyectos</Button>{/snippet}
</EmptyState>
