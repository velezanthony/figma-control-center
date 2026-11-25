<script lang="ts">
import { onMount } from "svelte";
import { createSettings } from "#web/lib/settings/settings.svelte.ts";
import { groupSettings, storedProblem, storedSettings } from "#web/lib/settings/rows.ts";
import Spinner from "#web/lib/ui/atoms/Spinner.svelte";
import Icon from "#web/lib/ui/icons/Icon.svelte";
import EmptyState, { EMPTY_STATE_VARIANT } from "#web/lib/ui/molecules/EmptyState.svelte";
import PageHeader from "#web/lib/ui/molecules/PageHeader.svelte";
import SectionCard from "#web/lib/ui/molecules/SectionCard.svelte";
import ResetAllSettings from "#web/lib/ui/organisms/ResetAllSettings.svelte";
import SettingRow from "#web/lib/ui/organisms/SettingRow.svelte";

// Los ajustes son de la máquina, no de un proyecto: la pantalla funciona sin ninguno dado de alta (D-3)
const settings = createSettings();
onMount(() => {
	void settings.load();
});
const groups = $derived(groupSettings(settings.state.settings));
const storedNames = $derived(storedSettings(settings.state.settings).map((s) => s.name));
</script>

<PageHeader>
	{#snippet title()}Ajustes{/snippet}
	{#snippet description()}Cambia los ajustes de esta máquina sin tocar el <span class="font-mono">.env</span>. Nada se recarga en caliente: cada fila dice cuándo se aplica.{/snippet}
</PageHeader>

{#if !settings.state.loaded}
	<div class="flex items-center gap-2 text-sm text-text-secondary"><Spinner size="sm" />Cargando los ajustes…</div>
{:else if settings.state.loadError !== null}
	<EmptyState variant={EMPTY_STATE_VARIANT.error}>
		{#snippet icon()}<Icon name="exclamation-triangle" size="lg" />{/snippet}
		{#snippet children()}No se pudieron leer los ajustes{/snippet}
		{#snippet description()}<span class="break-all">{settings.state.loadError}</span>. Sin la base no se puede guardar nada; revisa que se pueda abrir y vuelve a cargar la página.{/snippet}
	</EmptyState>
{:else}
	<div class="mb-4 flex flex-wrap items-center justify-end gap-3">
		{#if settings.state.resetAllError !== null}
			<p role="alert" class="mr-auto text-xs text-danger-700">{settings.state.resetAllError}</p>
		{/if}
		<ResetAllSettings names={storedNames} busy={settings.state.resettingAll} onreset={() => void settings.resetAll()} />
	</div>
	{#if settings.state.problems.length > 0}
		<div role="alert" class="mb-4 rounded-xl border border-warning-500 bg-warning-100 px-4 py-3 text-sm text-warning-700">
			<p class="font-medium">Hay ajustes guardados que no se aplican:</p>
			<ul class="mt-1 list-disc space-y-1 pl-5 font-mono text-xs">
				{#each settings.state.problems as problem (problem)}<li class="break-all">{problem}</li>{/each}
			</ul>
		</div>
	{/if}
	<div class="space-y-6">
		{#each groups as group (group.group)}
			<SectionCard padding="none">
				{#snippet title()}{group.group}{/snippet}
				{#snippet children()}
					<div class="divide-y divide-border border-t border-border">
						{#each group.settings as setting (setting.key)}
							<SettingRow
								{setting}
								problem={storedProblem(setting.key, settings.state.problems)}
								error={settings.state.errors[setting.key] ?? null}
								busy={settings.state.busyKey === setting.key}
								onsave={(value) => void settings.save(setting.key, value)}
								onreset={() => void settings.reset(setting.key)}
							/>
						{/each}
					</div>
				{/snippet}
			</SectionCard>
		{/each}
	</div>
	<p class="mt-6 text-xs text-text-muted">Puertos, rutas, la base y la orden de la terminal no se cambian aquí: van en <span class="font-mono">.env</span> (ver <span class="font-mono">docs/users/configuration.md</span>) y se aplican al reiniciar.</p>
{/if}
