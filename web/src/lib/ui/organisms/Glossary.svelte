<script lang="ts">
import { filterGlossary } from "#web/lib/glossary/filter.ts";
import { GROUPS, type GroupId, TERMS } from "#web/lib/glossary/terms.ts";
import Button, { BUTTON_VARIANT } from "#web/lib/ui/atoms/Button.svelte";
import Icon from "#web/lib/ui/icons/Icon.svelte";
import EmptyState from "#web/lib/ui/molecules/EmptyState.svelte";
import SearchBar from "#web/lib/ui/molecules/SearchBar.svelte";
import SectionCard from "#web/lib/ui/molecules/SectionCard.svelte";

type Props = {
	// Grupo elegido (null: todos). Lo guarda quien lo pinta, para que un enlace pueda llegar a él
	group: GroupId | null;
	onselectgroup: (group: GroupId | null) => void;
};
let { group, onselectgroup }: Props = $props();

let query = $state("");
// Todo lo que el panel muestra y puede no entenderse, agrupado. Los mismos términos salen en los tooltips
const shown = $derived(filterGlossary(TERMS, { query, group }));
const countLabel = (count: number) => `${count} ${count === 1 ? "término" : "términos"}`;
const PILLS: readonly { id: GroupId | null; title: string }[] = [{ id: null, title: "Todos" }, ...GROUPS];
</script>

<div class="flex flex-col gap-4">
	<div class="flex flex-col gap-3">
		<div class="max-w-md"><SearchBar bind:value={query} label="Buscar en el glosario" placeholder="Buscar un término o una explicación" /></div>
		<div role="group" aria-label="Filtrar por grupo" class="flex flex-wrap gap-2">
			{#each PILLS as pill (pill.id)}
				{@const pressed = pill.id === group}
				<Button variant={pressed ? BUTTON_VARIANT.tertiary : BUTTON_VARIANT.secondary} shape="pill" size="sm" aria-pressed={pressed} onclick={() => onselectgroup(pill.id)}>{pill.title}</Button>
			{/each}
		</div>
	</div>

	{#if shown.length === 0}
		<EmptyState>
			{#snippet icon()}<Icon name="magnifying-glass" size="lg" />{/snippet}
			Ningún término coincide
			{#snippet description()}Prueba con otra palabra o elige «Todos».{/snippet}
		</EmptyState>
	{:else}
		<div class="flex flex-col gap-4">
			{#each shown as shownGroup (shownGroup.id)}
				<SectionCard padding="none">
					{#snippet title()}{shownGroup.title}{/snippet}
					{#snippet actions()}<span class="text-xs text-text-muted tabular-nums">{countLabel(shownGroup.terms.length)}</span>{/snippet}
					<dl class="divide-y divide-border border-t border-border">
						{#each shownGroup.terms as term (term.key)}
							<div id="termino-{term.key}" class="grid content-start gap-1 px-5 py-3 sm:grid-cols-[220px_minmax(0,1fr)] sm:gap-x-6">
								<dt class="flex min-w-0 flex-col gap-0.5 sm:row-span-2">
									<span class="text-sm font-semibold break-words text-text-primary {term.group === 'tools' ? 'font-mono' : ''}">{term.label}</span>
									{#if term.key !== term.label && term.group === "errors"}<code class="font-mono text-xs text-text-muted">{term.key}</code>{/if}
								</dt>
								<dd class="text-sm text-text-secondary">{term.short}</dd>
								{#if term.long}
									<dd class="flex gap-1.5 text-sm text-text-muted sm:col-start-2">
										<span class="mt-0.5 shrink-0 text-brand-700"><Icon name="arrow-right" size="xs" /></span>
										<span><span class="font-semibold text-text-secondary">Qué hacer:</span> {term.long}</span>
									</dd>
								{/if}
							</div>
						{/each}
					</dl>
				</SectionCard>
			{/each}
		</div>
	{/if}
</div>
