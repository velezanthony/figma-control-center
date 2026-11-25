<script lang="ts">
import { modeState } from "#web/lib/dashboard-mode.svelte.ts";
import { isRouteAvailable } from "#web/lib/dashboard-mode.ts";
import type { GroupId } from "#web/lib/glossary/terms.ts";
import { HELP_TAB, type HelpTab, helpSearch, parseHelpView } from "#web/lib/help/view.ts";
import { SECTIONS } from "#web/lib/home/sections.ts";
import { replaceSearch, routeState } from "#web/lib/route.svelte.ts";
import FlowDiagram from "#web/lib/ui/molecules/FlowDiagram.svelte";
import PageHeader from "#web/lib/ui/molecules/PageHeader.svelte";
import SectionCard from "#web/lib/ui/molecules/SectionCard.svelte";
import TabGroup from "#web/lib/ui/molecules/TabGroup.svelte";
import Glossary from "#web/lib/ui/organisms/Glossary.svelte";
import SectionLinks from "#web/lib/ui/organisms/SectionLinks.svelte";

// Pestaña y grupo del glosario viven en la URL: un enlace (glossaryHref) llega directo a un grupo
const view = $derived(parseHelpView(routeState.search));
const TABS = [
	{ id: HELP_TAB.how, label: "Cómo funciona" },
	{ id: HELP_TAB.glossary, label: "Glosario" },
] as const;
const isTab = (id: string): id is HelpTab => TABS.some((t) => t.id === id);

const selectTab = (id: string) => {
	if (isTab(id)) replaceSearch(helpSearch({ tab: id, group: id === HELP_TAB.glossary ? view.group : null }));
};
const selectGroup = (group: GroupId | null) => replaceSearch(helpSearch({ tab: HELP_TAB.glossary, group }));
</script>

<PageHeader>
	{#snippet title()}Ayuda{/snippet}
	{#snippet description()}Cómo encaja cada pieza, para qué sirve cada sección y qué significa cada código del panel.{/snippet}
</PageHeader>

<div class="mb-6"><TabGroup label="Secciones de la ayuda" tabs={TABS} selected={view.tab} onselect={selectTab} /></div>

<div role="tabpanel" aria-label={TABS.find((t) => t.id === view.tab)?.label}>
	{#if view.tab === HELP_TAB.glossary}
		<div class="flex flex-col gap-4">
			<p class="text-sm text-text-secondary">Lo que significa cada código del panel. Pasa el ratón o enfoca con el teclado cualquier código subrayado, etiqueta o cabecera para ver esta misma explicación.</p>
			<Glossary group={view.group} onselectgroup={selectGroup} />
		</div>
	{:else}
		<div class="flex flex-col gap-8">
			<SectionCard padding="lg">
				{#snippet title()}Qué es{/snippet}
				<div class="flex flex-col gap-5">
					<p class="max-w-prose text-sm text-text-secondary">
						Figma Control Center es un servidor MCP que deja a Claude Code leer y modificar archivos de Figma ejecutando scripts del API de plugins.
						Este panel enseña lo que hace en directo, guarda su histórico y te permite hablar con la sesión de Claude que trabaja en el proyecto.
					</p>
					<FlowDiagram />
				</div>
			</SectionCard>

			<section aria-labelledby="help-sections" class="flex flex-col gap-3">
				<h2 id="help-sections" class="text-section text-text-primary">Para qué sirve cada sección</h2>
				<SectionLinks sections={SECTIONS.filter((section) => isRouteAvailable(section.route, modeState.current))} />
			</section>
		</div>
	{/if}
</div>
