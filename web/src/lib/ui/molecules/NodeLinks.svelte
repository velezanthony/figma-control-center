<script lang="ts">
	import { nodeUrl } from "#web/lib/activity/format.ts";
	import { ID_TERM, termOf } from "#web/lib/glossary/terms.ts";
	import Term, { TERM_VARIANT } from "./Term.svelte";
	import Tooltip from "#web/lib/ui/atoms/Tooltip.svelte";
	import Icon from "#web/lib/ui/icons/Icon.svelte";

	const node = termOf(ID_TERM.node);

	// Sin fileUrl (sesión desconocida) los ids se muestran sin enlace
	type Props = { ids: readonly string[]; fileUrl: string | null };
	let { ids, fileUrl }: Props = $props();
</script>

<ul class="flex flex-wrap gap-2">
	{#each ids as id (id)}
		{@const href = fileUrl === null ? null : nodeUrl(fileUrl, id)}
		<li>
			{#if href !== null}
				{#snippet link(trigger: { "aria-describedby"?: string })}
					<a
						{href}
						target="_blank"
						rel="noopener"
						class="inline-flex items-center gap-1 rounded-md bg-surface-sunken px-2 py-1 font-mono text-xs text-text-secondary transition-colors hover:bg-brand-50 hover:text-brand-700"
						{...trigger}
					>
						{id}<Icon name="arrow-top-right-on-square" size="xs" />
					</a>
				{/snippet}
				{#if node}
					<Tooltip>
						{#snippet children(trigger)}{@render link(trigger)}{/snippet}
						{#snippet content()}<span class="font-semibold">{node.label}.</span> {node.short}{/snippet}
					</Tooltip>
				{:else}
					{@render link({})}
				{/if}
			{:else}
				<Term term={ID_TERM.node} variant={TERM_VARIANT.bare}><span class="rounded-md bg-surface-sunken px-2 py-1 font-mono text-xs text-text-secondary">{id}</span></Term>
			{/if}
		</li>
	{/each}
</ul>
