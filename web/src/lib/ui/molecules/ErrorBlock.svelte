<script lang="ts">
	import type { Snippet } from "svelte";
	import type { ActivityError } from "#web/lib/contract.ts";
	import Badge, { BADGE_VARIANT } from "#web/lib/ui/atoms/Badge.svelte";
	import { RETRYABLE_TERM } from "#web/lib/glossary/terms.ts";
	import Icon from "#web/lib/ui/icons/Icon.svelte";
	import Term, { TERM_VARIANT } from "./Term.svelte";

	// children: el prefijo del título («Error», «Job»); se le añade el tipo del error
	type Props = { error: ActivityError; retryable?: boolean | null; children: Snippet };
	let { error, retryable = null, children }: Props = $props();
</script>

<div role="alert" class="flex flex-col gap-2 rounded-md border border-danger-200 bg-danger-50 p-3 text-sm">
	<div class="flex flex-wrap items-center gap-2 font-semibold text-danger-700">
		<Icon name="exclamation-triangle" size="xs" />{@render children()}: <Term term={error.type}>{error.type}</Term>
		{#if error.line !== null}<Badge variant={BADGE_VARIANT.danger} size="sm">línea {error.line}</Badge>{/if}
		{#if retryable === true}<Term term={RETRYABLE_TERM} variant={TERM_VARIANT.bare}><Badge variant={BADGE_VARIANT.warning} size="sm">reintentable</Badge></Term>{/if}
	</div>
	<p class="font-mono text-xs break-words text-danger-700">{error.message}</p>
	{#if error.nextStep}
		<p class="text-text-primary"><span class="font-semibold">Siguiente paso:</span> {error.nextStep}</p>
	{/if}
</div>
