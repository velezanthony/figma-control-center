<script lang="ts">
import type { ProjectOption } from "#web/lib/projects/selection.ts";
import { hrefOf, ROUTE_NAME } from "#web/lib/route.ts";
import Icon from "#web/lib/ui/icons/Icon.svelte";
import Select from "#web/lib/ui/atoms/Select.svelte";
import Tooltip from "#web/lib/ui/atoms/Tooltip.svelte";

// Selector del proyecto activo: toda la app muestra el proyecto elegido. Es presentacional (recibe la lista,
// el id activo y el callback); quien lo cablea al store es el Sidebar.
type Props = {
	projects: readonly ProjectOption[];
	activeId: string | null;
	onselect: (id: string) => void;
	// En la barra lateral compacta se reduce a un icono (el nombre sale en el tooltip)
	compact?: boolean;
};
let { projects, activeId, onselect, compact = false }: Props = $props();

const activeName = $derived(
	projects.find((p) => p.id === activeId)?.name ?? "Proyecto",
);
</script>

{#if projects.length === 0}
	<!-- Sin proyectos el selector no tiene nada que elegir: lleva a «Proyectos», donde se da de alta uno -->
	{#if compact}
		<Tooltip placement="bottom">
			{#snippet children(describedby)}
				<a href={hrefOf(ROUTE_NAME.projects)} aria-label="Crear un proyecto" {...describedby} class="flex size-9 items-center justify-center rounded-md border border-border bg-surface text-text-secondary transition duration-base hover:bg-surface-raised">
					<Icon name="server-stack" size="md" />
				</a>
			{/snippet}
			{#snippet content()}Sin proyectos: crear uno{/snippet}
		</Tooltip>
	{:else}
		<a href={hrefOf(ROUTE_NAME.projects)} class="flex items-center gap-2 rounded-md border border-dashed border-border-strong px-3 py-2 text-xs font-medium text-text-secondary transition duration-base hover:bg-surface-raised hover:text-text-primary motion-safe:hover:translate-x-0.5">
			<Icon name="server-stack" size="md" />Sin proyectos: crear uno
		</a>
	{/if}
{:else}
	<!-- El nombre cabe truncado en la barra: el tooltip (ratón y foco) y la descripción accesible lo dan entero -->
	<Tooltip placement="bottom" fill>
		{#snippet children(describedby)}
			<Select
				{...describedby}
				value={activeId ?? ""}
				size="sm"
				{compact}
				name="proyecto-activo"
				aria-label="Proyecto activo"
				onchange={(e) => onselect((e.currentTarget as HTMLSelectElement).value)}
			>
				{#snippet icon()}<Icon name="server-stack" size="md" />{/snippet}
				{#snippet label()}Proyecto{/snippet}
				{#each projects as project (project.id)}
					<option value={project.id}>{project.name}</option>
				{/each}
			</Select>
		{/snippet}
		{#snippet content()}{activeName}{/snippet}
	</Tooltip>
{/if}
