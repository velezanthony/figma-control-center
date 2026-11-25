<script lang="ts">
import type { Section } from "#web/lib/home/sections.ts";
import { hrefOf } from "#web/lib/route.ts";
import Icon from "#web/lib/ui/icons/Icon.svelte";

// detailed: tarjeta con para qué sirve (Ayuda); compact: acceso rápido con icono y nombre (Inicio)
type Variant = "detailed" | "compact";
type Props = { sections: readonly Section[]; variant?: Variant };
let { sections, variant = "detailed" }: Props = $props();

const GRID: Record<Variant, string> = {
	detailed: "grid gap-4 sm:grid-cols-2 lg:grid-cols-3",
	compact: "grid grid-cols-2 gap-3 sm:grid-cols-4",
};
</script>

<ul class={GRID[variant]}>
	{#each sections as section (section.route)}
		<li>
			{#if variant === "compact"}
				<a
					href={hrefOf(section.route)}
					class="flex h-full items-center gap-3 rounded-xl border border-border bg-surface px-4 py-3 text-sm font-semibold text-text-primary shadow-xs transition duration-base hover:border-brand-300 hover:shadow-lg motion-safe:hover:-translate-y-0.5"
				>
					<span class="flex size-8 shrink-0 items-center justify-center rounded-md bg-brand-50 text-brand-700"><Icon name={section.icon} /></span>
					<span class="truncate">{section.title}</span>
				</a>
			{:else}
				<a
					href={hrefOf(section.route)}
					class="group flex h-full flex-col gap-3 rounded-xl border border-border bg-surface p-5 shadow-xs transition duration-base hover:border-brand-300 hover:shadow-lg motion-safe:hover:-translate-y-0.75"
				>
					<span class="flex size-9 items-center justify-center rounded-md bg-brand-50 text-brand-700"><Icon name={section.icon} size="md" /></span>
					<span class="text-heading text-text-primary transition-colors duration-base group-hover:text-brand-700">{section.title}</span>
					<span class="text-sm text-text-secondary">{section.description}</span>
					<span class="mt-auto flex items-center gap-1 text-sm font-medium text-brand-700 group-hover:underline">Abrir<Icon name="chevron-right" size="xs" /></span>
				</a>
			{/if}
		</li>
	{/each}
</ul>
