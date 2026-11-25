<script lang="ts">
import { ATTEMPT_COLUMNS } from "#web/lib/attempts/columns.ts";
import { formatWhen, kindLabel, kindTerm, statusLabel, statusVariant } from "#web/lib/attempts/present.ts";
import type { AttemptKind, AttemptOrder, AttemptTarget } from "#web/lib/contract.ts";
import { ATTEMPT_TERM, STATUS_TERM } from "#web/lib/glossary/terms.ts";
import Badge from "#web/lib/ui/atoms/Badge.svelte";
import Button, { BUTTON_VARIANT } from "#web/lib/ui/atoms/Button.svelte";
import Icon from "#web/lib/ui/icons/Icon.svelte";
import EmptyState from "#web/lib/ui/molecules/EmptyState.svelte";
import Term, { TERM_VARIANT } from "#web/lib/ui/molecules/Term.svelte";
import DataTable from "./DataTable.svelte";
import Td from "./Td.svelte";

type Props = {
	rows: readonly AttemptTarget[];
	sort: { readonly key: AttemptOrder; readonly dir: "asc" | "desc" };
	onsort: (key: AttemptOrder) => void;
	onopen: (kind: AttemptKind, target: string) => void;
	// «Quitar filtros» cuando ninguna fila los cumple
	onclear: () => void;
	// Hay intentos en el proyecto (aunque los filtros no dejen ninguno)
	hasAttempts: boolean;
	// Para pintar la hora local (en los tests se fijan)
	now?: Date;
	timeZone?: string;
};
let { rows, sort, onsort, onopen, onclear, hasAttempts, now = new Date(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone }: Props = $props();

const SEPARATOR = "\u0000";
const rowId = (t: AttemptTarget) => `${t.kind}${SEPARATOR}${t.target}`;
const byId = $derived(new Map(rows.map((t) => [rowId(t), t])));
const open = (id: string) => {
	const t = byId.get(id);
	if (t !== undefined) onopen(t.kind, t.target);
};
const STATUS_TERM_OF = { ok: STATUS_TERM.ok, error: STATUS_TERM.error, contract_error: ATTEMPT_TERM.contractError } as const;
</script>

<DataTable label="Objetivos con intentos" columns={ATTEMPT_COLUMNS} {rows} {rowId} {sort} {onsort} onopen={open}>
	{#snippet cells(t)}
		{@const when = formatWhen(t.lastAt, now, timeZone)}
		<Td label="Objetivo">
			<button
				type="button"
				title={t.target}
				onclick={() => onopen(t.kind, t.target)}
				class="block max-w-96 cursor-pointer truncate rounded-md text-left font-mono text-sm font-semibold text-brand-700 hover:underline max-md:max-w-56"
			>{t.target}</button>
		</Td>
		<Td label="Tipo"><Term term={kindTerm(t.kind)} variant={TERM_VARIANT.bare}><Badge size="sm">{kindLabel(t.kind)}</Badge></Term></Td>
		<Td mono align="right" label="Intentos">{t.attempts}</Td>
		<Td label="Último estado"><Term term={STATUS_TERM_OF[t.lastStatus]} variant={TERM_VARIANT.bare}><Badge variant={statusVariant(t.lastStatus)} size="sm" dot>{statusLabel(t.lastStatus)}</Badge></Term></Td>
		<Td mono muted align="right" label="Último"><span title={when.title}>{when.text}</span></Td>
	{/snippet}
	{#snippet empty()}
		<EmptyState size="sm">
			{#snippet icon()}<Icon name={hasAttempts ? "magnifying-glass" : "arrow-path"} size="lg" />{/snippet}
			{hasAttempts ? "Ningún objetivo cumple estos filtros" : "Todavía no hay intentos"}
			{#snippet description()}
				{hasAttempts
					? "Prueba con otra búsqueda o quita algún filtro."
					: "Cada figma_run_script, cada paso de figma_build y cada captura deja uno."}
			{/snippet}
			{#snippet actions()}
				{#if hasAttempts}<Button variant={BUTTON_VARIANT.secondary} onclick={onclear}>Quitar filtros</Button>{/if}
			{/snippet}
		</EmptyState>
	{/snippet}
</DataTable>
