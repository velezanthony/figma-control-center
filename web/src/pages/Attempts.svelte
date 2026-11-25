<script lang="ts">
import { onDestroy } from "svelte";
import { PER_PAGE_CHOICES, paginate } from "#web/lib/activity/paginate.ts";
import { createResource } from "#web/lib/activity/resource.svelte.ts";
import type { LiveStore } from "#web/lib/activity/store.svelte.ts";
import {
	attemptDiffRawUrl,
	attemptDiffUrl,
	attemptScriptRawUrl,
	attemptScriptUrl,
	attemptTargetsUrl,
	targetAttemptsUrl,
} from "#web/lib/attempts/endpoints.ts";
import { contentHunk } from "#web/lib/attempts/hunks.ts";
import { resolvePair } from "#web/lib/attempts/pair.ts";
import { type AttemptRow, formatBytes, kindLabel, kindTerm, roleLabel, roleStateText, statusLabel } from "#web/lib/attempts/present.ts";
import {
	type AttemptFilters,
	type AttemptsView,
	closeDetail,
	DEFAULT_ATTEMPT_FILTERS,
	hasActiveAttemptFilters,
	KINDS,
	openTarget,
	parseAttemptsView,
	serializeAttemptsView,
	STATUSES,
} from "#web/lib/attempts/view-state.ts";
import type { AssetDiff, AttemptDiff, AttemptKind, AttemptOrder, AttemptTarget, ContentDiff, DiffHunk, RoleDiff, ScriptStored } from "#web/lib/contract.ts";
import { projectState } from "#web/lib/projects/projects.svelte.ts";
import { withProject } from "#web/lib/projects/endpoints.ts";
import { replaceSearch, routeState } from "#web/lib/route.svelte.ts";
import Badge from "#web/lib/ui/atoms/Badge.svelte";
import Button, { BUTTON_VARIANT } from "#web/lib/ui/atoms/Button.svelte";
import Input from "#web/lib/ui/atoms/Input.svelte";
import Spinner from "#web/lib/ui/atoms/Spinner.svelte";
import Icon from "#web/lib/ui/icons/Icon.svelte";
import DiffView from "#web/lib/ui/molecules/DiffView.svelte";
import Disclosure from "#web/lib/ui/molecules/Disclosure.svelte";
import ErrorBlock from "#web/lib/ui/molecules/ErrorBlock.svelte";
import FilterDropdown from "#web/lib/ui/molecules/FilterDropdown.svelte";
import PageHeader from "#web/lib/ui/molecules/PageHeader.svelte";
import ProjectIndicator from "#web/lib/ui/molecules/ProjectIndicator.svelte";
import SearchBar from "#web/lib/ui/molecules/SearchBar.svelte";
import TabGroup from "#web/lib/ui/molecules/TabGroup.svelte";
import Term, { TERM_VARIANT } from "#web/lib/ui/molecules/Term.svelte";
import AttemptsTable from "#web/lib/ui/organisms/AttemptsTable.svelte";
import AttemptTimeline from "#web/lib/ui/organisms/AttemptTimeline.svelte";
import DataTable from "#web/lib/ui/organisms/DataTable.svelte";
import TableFooter from "#web/lib/ui/organisms/TableFooter.svelte";
import Td from "#web/lib/ui/organisms/Td.svelte";

type Props = { store: LiveStore };
let { store }: Props = $props();

type TargetsReply = { items: AttemptTarget[]; total: number; page: number; perPage: number };
type AttemptsReply = { items: AttemptRow[]; total: number };
type ScriptReply = {
	sha256: string;
	bytes: number;
	stored: ScriptStored;
	lines: number;
	content: string | null;
	truncated: boolean;
};
// Lo que manda la ruta: el diff recortado trae `truncated`
type DiffReply = Omit<AttemptDiff<DiffHunk>, "diff"> & { diff: (ContentDiff<DiffHunk> & { truncated?: boolean }) | null };

// Un papel cerrado a mano (el primero que cambió se abre solo mientras no se elija otro)
const NO_ROLE = "-";
const COPIED_MS = 1500;
const KIND_OPTIONS = KINDS.map((k) => ({ value: k, label: kindLabel(k) }));
const STATUS_OPTIONS = STATUSES.map((s) => ({ value: s, label: statusLabel(s) }));
const SINCE_OPTIONS = [
	{ value: "today", label: "Hoy" },
	{ value: "last_hour", label: "La última hora" },
];

// «Reintentar» vuelve a pedir lo que falló
let retry = $state(0);
const refresh = () => [store.tick, retry];
const view = $derived(parseAttemptsView(routeState.search));
const detail = $derived(view.detail);
const update = (next: AttemptsView) => replaceSearch(serializeAttemptsView(next));

// ---- lista ----
const targets = createResource<TargetsReply>(
	() => (detail === null ? attemptTargetsUrl(view) : null),
	refresh,
);
// Con filtros, ¿hay intentos en el proyecto aunque ninguno los cumpla?
const anyTargets = createResource<TargetsReply>(
	() => (detail === null && hasActiveAttemptFilters(view.filters) ? attemptTargetsUrl({ ...view, filters: DEFAULT_ATTEMPT_FILTERS, page: 1, perPage: 1 }) : null),
	refresh,
);
const total = $derived(targets.data?.total ?? 0);
const window = $derived(paginate(total, view.page, view.perPage));
const hasAttempts = $derived(hasActiveAttemptFilters(view.filters) ? (anyTargets.data?.total ?? 1) > 0 : total > 0);

// La página se ajusta sola si los filtros reducen el total
$effect(() => {
	if (detail !== null || targets.loading || targets.data === null) return;
	if (window.page !== view.page) update({ ...view, page: window.page });
});

const setFilters = (patch: Partial<AttemptFilters>) =>
	update({ ...view, filters: { ...view.filters, ...patch }, page: 1 });
const clearFilters = () => update({ ...view, filters: DEFAULT_ATTEMPT_FILTERS, page: 1 });
const onsort = (key: AttemptOrder) =>
	update({
		...view,
		sort: view.sort.key === key ? { key, dir: view.sort.dir === "asc" ? "desc" : "asc" } : { key, dir: "desc" },
		page: 1,
	});
const sincePreset = $derived(view.filters.since !== null ? "" : (view.filters.preset ?? ""));

// ---- detalle ----
const attemptsRes = createResource<AttemptsReply>(
	() => (detail === null ? null : targetAttemptsUrl(detail.kind, detail.target)),
	refresh,
);
const mine = $derived(
	detail !== null && attemptsRes.data !== null && attemptsRes.data.items.every((i) => i.kind === detail.kind && i.target === detail.target)
		? attemptsRes.data.items
		: null,
);
const missing = $derived(mine !== null && mine.length === 0 && !attemptsRes.loading);
const items = $derived(mine ?? []);
const pair = $derived(resolvePair(items, detail?.a ?? null, detail?.b ?? null));
const before = $derived(items.find((i) => i.id === pair.a) ?? null);
const after = $derived(items.find((i) => i.id === pair.b) ?? null);
const last = $derived(items[items.length - 1] ?? null);

const comparing = $derived(pair.a !== null && pair.b !== null);
const diffRes = createResource<DiffReply>(
	() => (comparing && detail !== null ? attemptDiffUrl(pair.a as number, pair.b as number, detail.role === NO_ROLE ? null : detail.role, detail.path) : null),
	() => retry,
);
const diffData = $derived(
	diffRes.data !== null && diffRes.data.from.id === pair.a && diffRes.data.to.id === pair.b ? diffRes.data : null,
);

// Papeles del par: los que calcula el servidor o, con un solo intento, los que tiene
const roles = $derived<readonly RoleDiff[]>(
	comparing
		? (diffData?.roles ?? [])
		: (after?.scripts ?? []).map((s) => ({ role: s.role, path: s.path, state: "same" as const, added: null, removed: null })),
);
const assets = $derived<readonly AssetDiff[]>(comparing ? (diffData?.assets ?? []) : []);

const selected = $derived.by(() => {
	if (detail === null || detail.role === NO_ROLE) return null;
	if (detail.role !== null) return { role: detail.role, path: detail.path ?? "" };
	const first = diffData?.diff;
	return first ? { role: first.role, path: first.path } : null;
});
const isOpen = (r: RoleDiff) => selected?.role === r.role && selected.path === r.path;
const choose = (r: RoleDiff, open: boolean) => {
	if (detail === null) return;
	update({ ...view, detail: { ...detail, role: open ? r.role : NO_ROLE, path: open && r.path !== "" ? r.path : null } });
};

type Tab = "changes" | "before" | "after";
const selectedState = $derived(roles.find((r) => selected !== null && isOpen(r))?.state ?? "same");
const selectedKey = $derived(selected === null ? "" : `${selected.role}\u0000${selected.path}`);
let tabChoice = $state<{ key: string; tab: Tab } | null>(null);
const tab = $derived<Tab>(
	tabChoice?.key === selectedKey
		? tabChoice.tab
		: comparing && selectedState !== "same"
			? "changes"
			: "after",
);
const tabs = $derived([
	...(comparing ? [{ id: "changes", label: "Cambios" }] : []),
	...(before !== null ? [{ id: "before", label: "Antes" }] : []),
	...(after !== null ? [{ id: "after", label: "Después" }] : []),
]);
const sideId = $derived(tab === "before" ? pair.a : pair.b);
const script = createResource<ScriptReply>(
	() => (selected !== null && tab !== "changes" && sideId !== null ? attemptScriptUrl(sideId, selected.role, selected.path) : null),
	() => 0,
);
const scriptData = $derived(script.data);
const diffShown = $derived(diffData?.diff ?? null);

const project = $derived(projectState.activeId);
const diffRaw = $derived(
	comparing && selected !== null
		? withProject(attemptDiffRawUrl(pair.a as number, pair.b as number, selected.role, selected.path || null), project)
		: null,
);
const scriptRaw = $derived(
	selected !== null && sideId !== null ? withProject(attemptScriptRawUrl(sideId, selected.role, selected.path || null), project) : null,
);

let copied = $state(false);
let copiedTimer: ReturnType<typeof setTimeout> | undefined;
async function copy() {
	const text = scriptData?.content;
	if (text === null || text === undefined) return;
	try {
		await navigator.clipboard.writeText(text);
		copied = true;
		clearTimeout(copiedTimer);
		copiedTimer = setTimeout(() => (copied = false), COPIED_MS);
	} catch {
		copied = false;
	}
}
onDestroy(() => clearTimeout(copiedTimer));

const activeProjectName = $derived(projectState.projects.find((p) => p.id === projectState.activeId)?.name ?? null);

const open = (kind: AttemptKind, target: string) => update(openTarget(view, kind, target));
const pick = (side: "a" | "b", id: number) => {
	if (detail === null) return;
	const next = { ...pair, [side]: id };
	update({ ...view, detail: { ...detail, a: next.a, b: next.b, role: null, path: null } });
};

const ASSET_COLUMNS = [
	{ id: "name", label: "Asset" },
	{ id: "state", label: "Estado" },
	{ id: "bytes", label: "Tamaño", align: "right" as const },
	{ id: "sha", label: "sha256" },
];
const ASSET_STATE_TEXT = { same: "igual", changed: "cambió", added: "aparece", removed: "desaparece" } as const;
const SHORT_SHA = 12;
</script>

<PageHeader>
	{#snippet title()}Intentos{/snippet}
	{#snippet meta()}<ProjectIndicator name={activeProjectName} />{/snippet}
	{#snippet description()}
		{#if detail === null}
			{total} {total === 1 ? "objetivo con intentos" : "objetivos con intentos"}; solo lectura.
		{:else}
			Qué cambió entre dos intentos del mismo objetivo; solo lectura.
		{/if}
	{/snippet}
</PageHeader>

{#if detail === null}
	<div class="mb-4 flex flex-row flex-wrap items-center gap-3">
		<div class="min-w-64 flex-1 sm:max-w-md">
			<SearchBar
				label="Buscar objetivo"
				placeholder="Buscar ruta, pantalla o área"
				bind:value={() => view.filters.query, (query) => setFilters({ query })}
			/>
		</div>
		<FilterDropdown label="Tipo" options={KIND_OPTIONS} value={view.filters.kind ?? ""} onchange={(v) => setFilters({ kind: v === "" ? null : (v as AttemptKind) })} />
		<FilterDropdown
			label="Último estado"
			options={STATUS_OPTIONS}
			value={view.filters.status ?? ""}
			onchange={(v) => setFilters({ status: v === "" ? null : (v as (typeof STATUSES)[number]) })}
		/>
		<FilterDropdown
			label="Desde"
			options={SINCE_OPTIONS}
			value={sincePreset}
			onchange={(v) => setFilters({ preset: v === "" ? null : (v as "today" | "last_hour"), since: null })}
		/>
		<div class="w-40">
			<Input type="date" aria-label="Desde la fecha" bind:value={() => view.filters.since ?? "", (since) => setFilters({ since: since === "" ? null : since, preset: null })} />
		</div>
		{#if hasActiveAttemptFilters(view.filters)}
			<Button variant={BUTTON_VARIANT.link} onclick={clearFilters}><Icon name="x-mark" size="xs" />Limpiar filtros</Button>
		{/if}
	</div>

	{#if targets.error !== null && targets.data === null}
		<ErrorBlock error={{ type: "HistoryError", message: targets.error, line: null, nextStep: null }}>{#snippet children()}No se pudieron cargar los intentos{/snippet}</ErrorBlock>
		<div class="mt-3"><Button onclick={() => retry++}>Reintentar</Button></div>
	{:else if targets.data === null}
		<div class="flex justify-center p-12"><Spinner size="lg" /></div>
	{:else}
		<AttemptsTable rows={targets.data.items} sort={view.sort} {onsort} onopen={open} onclear={clearFilters} {hasAttempts} />
		<TableFooter
			{window}
			perPage={view.perPage}
			choices={PER_PAGE_CHOICES}
			onpage={(page) => update({ ...view, page })}
			onperpage={(perPage) => update({ ...view, perPage, page: 1 })}
		/>
	{/if}
{:else}
	<div class="mb-4">
		<Button variant={BUTTON_VARIANT.link} onclick={() => update(closeDetail(view))}><Icon name="chevron-left" size="xs" />Volver a la lista</Button>
	</div>

	{#if attemptsRes.error !== null && mine === null}
		<ErrorBlock error={{ type: "HistoryError", message: attemptsRes.error, line: null, nextStep: null }}>{#snippet children()}No se pudieron cargar los intentos{/snippet}</ErrorBlock>
		<div class="mt-3"><Button onclick={() => retry++}>Reintentar</Button></div>
	{:else if missing}
		<ErrorBlock error={{ type: "NotFound", message: "Ese objetivo no tiene intentos en este proyecto", line: null, nextStep: "Vuelve a la lista y elige otro objetivo." }}>{#snippet children()}Objetivo sin intentos{/snippet}</ErrorBlock>
	{:else if mine === null}
		<div class="flex justify-center p-12"><Spinner size="lg" /></div>
	{:else}
		<section class="mb-6 flex flex-col gap-2" aria-label="Objetivo">
			<h2 class="font-mono text-lg font-semibold break-all text-text-primary">{detail.target}</h2>
			<div class="flex flex-wrap items-center gap-2 text-sm text-text-secondary">
				<Term term={kindTerm(detail.kind)} variant={TERM_VARIANT.bare}><Badge size="sm">{kindLabel(detail.kind)}</Badge></Term>
				<span>{items.length === attemptsRes.data?.total ? items.length : `${items.length} de ${attemptsRes.data?.total}`} {attemptsRes.data?.total === 1 ? "intento" : "intentos"}</span>
				{#if last !== null}<span class="font-mono text-xs text-text-muted">kit {last.kit}</span>{/if}
			</div>
		</section>

		<section class="mb-6 flex flex-col gap-3" aria-labelledby="attempts-timeline">
			<h3 id="attempts-timeline" class="text-base font-semibold text-text-primary">Intentos</h3>
			<AttemptTimeline {items} a={pair.a} b={pair.b} onpick={pick} />
		</section>

		<section class="mb-6 flex flex-col gap-3" aria-labelledby="attempts-roles">
			<h3 id="attempts-roles" class="text-base font-semibold text-text-primary">
				{#if comparing && before !== null && after !== null}Papeles: #{before.n} (antes) contra #{after.n} (después){:else}Papeles del intento{/if}
			</h3>
			{#if !comparing}<p class="text-sm text-text-secondary">Solo hay un intento (o no se ha elegido el par): no hay con qué comparar. Se muestra su contenido.</p>{/if}
			{#if comparing && diffRes.error !== null && diffData === null}
				<ErrorBlock error={{ type: "HistoryError", message: diffRes.error, line: null, nextStep: null }}>{#snippet children()}No se pudo comparar{/snippet}</ErrorBlock>
				<div><Button onclick={() => retry++}>Reintentar</Button></div>
			{:else if comparing && diffData === null}
				<div class="flex justify-center p-8"><Spinner size="lg" /></div>
			{:else}
				{#each roles as r (`${r.role}\u0000${r.path}`)}
					<Disclosure bind:open={() => isOpen(r), (value) => choose(r, value)}>
						{#snippet title()}<span class="font-semibold">{roleLabel(r.role)}</span>{#if r.path !== ""}<span class="ml-2 font-mono text-xs font-normal text-text-muted">{r.path}</span>{/if}{/snippet}
						{#snippet subtitle()}{roleStateText(r.state, r.added, r.removed)}{/snippet}
						<div class="flex flex-col gap-3">
							<div class="flex flex-wrap items-center justify-between gap-3">
								<TabGroup
									label="Qué ver de {roleLabel(r.role)}"
									{tabs}
									selected={tab}
									onselect={(id) => (tabChoice = { key: selectedKey, tab: id as Tab })}
								/>
								{#if tab !== "changes" && scriptData?.content}
									<Button size="sm" onclick={copy}><Icon name={copied ? "check" : "document-duplicate"} size="xs" />{copied ? "Copiado" : "Copiar"}</Button>
								{/if}
							</div>
							{#if tab === "changes"}
								{#if diffShown === null}
									<DiffView label="Cambios de {roleLabel(r.role)}" hunks={[]} />
								{:else if diffShown.kind === "diff"}
									<DiffView label="Cambios de {roleLabel(diffShown.role)}" hunks={diffShown.hunks} truncated={diffShown.truncated ?? false} rawHref={diffRaw} />
								{:else if diffShown.kind === "too_large"}
									<DiffView label="Cambios de {roleLabel(diffShown.role)}" hunks={[]} tooLarge rawHref={diffRaw} />
								{:else}
									<DiffView label="Cambios de {roleLabel(diffShown.role)}" hunks={[]} hashOnly={{ from: diffShown.fromSha256, to: diffShown.toSha256 }} />
								{/if}
							{:else if script.loading && scriptData === null}
								<div class="flex justify-center p-8"><Spinner size="lg" /></div>
							{:else if scriptData !== null}
								{#if scriptData.content === null}
									<DiffView label="Contenido de {roleLabel(r.role)}" hunks={[]} hashOnly={tab === "before" ? { from: scriptData.sha256, to: null } : { from: null, to: scriptData.sha256 }} />
								{:else}
									<DiffView
										label="Contenido de {roleLabel(r.role)} en el intento {(tab === 'before' ? before : after)?.n}"
										mode="content"
										hunks={[contentHunk(scriptData.content)]}
										truncated={scriptData.truncated}
										rawHref={scriptRaw}
									/>
								{/if}
							{/if}
						</div>
					</Disclosure>
				{:else}
					<p class="text-sm text-text-secondary">Este intento no guardó ningún papel.</p>
				{/each}
			{/if}
		</section>

		{#if assets.length > 0}
			<section class="mb-6 flex flex-col gap-3" aria-labelledby="attempts-assets">
				<h3 id="attempts-assets" class="text-base font-semibold text-text-primary">Assets</h3>
				<DataTable label="Assets de los dos intentos" columns={ASSET_COLUMNS} rows={assets} rowId={(a) => a.name}>
					{#snippet cells(a)}
						{@const side = a.to ?? a.from}
						<Td label="Asset"><span class="font-mono text-xs">{a.name}</span></Td>
						<Td label="Estado">
							<Badge variant={a.state === "same" ? "secondary" : a.state === "removed" ? "danger" : a.state === "added" ? "success" : "warning"} size="sm">{ASSET_STATE_TEXT[a.state]}</Badge>
						</Td>
						<Td mono align="right" label="Tamaño">{side === null ? "—" : formatBytes(side.bytes)}</Td>
						<Td mono muted label="sha256">{side === null ? "—" : side.sha256.slice(0, SHORT_SHA)}</Td>
					{/snippet}
					{#snippet empty()}<p class="p-6 text-sm text-text-secondary">Sin assets</p>{/snippet}
				</DataTable>
			</section>
		{/if}
	{/if}
{/if}
