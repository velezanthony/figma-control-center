<script lang="ts">
import { DEFAULT_FILTERS, type Filters, hasActiveFilters, STATUS_FILTER } from "#web/lib/activity/filters.ts";
import { shortId } from "#web/lib/activity/format.ts";
import type { SessionItem } from "#web/lib/contract.ts";
import Button, { BUTTON_VARIANT } from "#web/lib/ui/atoms/Button.svelte";
import Icon from "#web/lib/ui/icons/Icon.svelte";
import FilterDropdown from "#web/lib/ui/molecules/FilterDropdown.svelte";
import SearchBar from "#web/lib/ui/molecules/SearchBar.svelte";

type Props = {
	filters: Filters;
	tools: readonly string[];
	sessions: readonly SessionItem[];
	onchange: (next: Filters) => void;
};
let { filters, tools, sessions, onchange }: Props = $props();

const STATUS_OPTIONS = [
	{ value: STATUS_FILTER.ok, label: "Correctas" },
	{ value: STATUS_FILTER.error, label: "Con error" },
	{ value: STATUS_FILTER.running, label: "En curso" },
];
const toolOptions = $derived(tools.map((t) => ({ value: t, label: t })));
const sessionOptions = $derived(
	sessions.map((s) => ({ value: s.sessionId, label: `${shortId(s.sessionId)}${s.pid !== null ? ` · pid ${s.pid}` : ""}` })),
);
</script>

<div class="mb-4 flex flex-row flex-wrap items-center gap-3">
	<div class="min-w-64 flex-1 sm:max-w-md">
		<SearchBar
			label="Buscar en la actividad"
			placeholder="Buscar herramienta, ruta o nodo"
			bind:value={() => filters.query, (query) => onchange({ ...filters, query })}
		/>
	</div>
	<FilterDropdown label="Herramienta" options={toolOptions} value={filters.tool ?? ""} onchange={(v) => onchange({ ...filters, tool: v === "" ? null : v })} />
	<FilterDropdown label="Estado" options={STATUS_OPTIONS} value={filters.status === STATUS_FILTER.all ? "" : filters.status} onchange={(v) => onchange({ ...filters, status: v === "" ? STATUS_FILTER.all : (v as Filters["status"]) })} />
	<FilterDropdown label="Sesión" options={sessionOptions} value={filters.sessionId ?? ""} onchange={(v) => onchange({ ...filters, sessionId: v === "" ? null : v })} />
	{#if hasActiveFilters(filters)}
		<Button variant={BUTTON_VARIANT.link} onclick={() => onchange(DEFAULT_FILTERS)}><Icon name="x-mark" size="xs" />Limpiar filtros</Button>
	{/if}
</div>
