<script lang="ts">
import { tick } from "svelte";
import {
	deleteProjectInit,
	PROJECTS_DELETE_PATH,
	PROJECTS_SAVE_PATH,
	saveProjectInit,
} from "#web/lib/projects/endpoints.ts";
import {
	confirmationStands,
	emptyForm,
	formOf,
	needsScriptsConfirm,
	scriptsRootsKey,
	type FormProblem,
	type ProjectForm,
	toEntryInput,
	validateForm,
} from "#web/lib/projects/form.ts";
import { loadProjects, projectState } from "#web/lib/projects/projects.svelte.ts";
import type { ProjectEntry } from "#web/lib/projects/selection.ts";
import Button, { BUTTON_VARIANT } from "#web/lib/ui/atoms/Button.svelte";
import Input from "#web/lib/ui/atoms/Input.svelte";
import Textarea from "#web/lib/ui/atoms/Textarea.svelte";
import Icon from "#web/lib/ui/icons/Icon.svelte";
import EmptyState from "#web/lib/ui/molecules/EmptyState.svelte";
import Modal from "#web/lib/ui/molecules/Modal.svelte";
import PageHeader from "#web/lib/ui/molecules/PageHeader.svelte";

// Las filas y los avisos del registro vienen de la única carga del panel (projectState)
const entries = $derived(projectState.entries);
const problems = $derived(projectState.problems);
let form = $state<ProjectForm>(emptyForm());
// id que se está editando (null = alta nueva); el formulario vive en un modal
let editing = $state<string | null>(null);
let formOpen = $state(false);
// Cada modal tiene su error: el de uno no aparece en el otro
let formError = $state<string | null>(null);
let deleteError = $state<string | null>(null);
// Campo del formulario al que pertenece el error (null = error del servidor, sin campo)
let errorField = $state<FormProblem["field"] | null>(null);
let list = $state<HTMLElement | null>(null);
// Raíces de scripts sobre las que se pidió confirmación; si se editan, la confirmación deja de valer
let pendingRoots = $state<string | null>(null);
const confirming = $derived(confirmationStands(form, pendingRoots));
let busy = $state(false);
// Proyecto pendiente de borrar (abre el modal de confirmación); null = ninguno
let deleting = $state<ProjectEntry | null>(null);

const FORM_ERROR_ID = "project-form-error";
const FIELD_ID = {
	name: "project-name",
	projectDir: "project-dir",
	fileUrl: "project-url",
} as const satisfies Record<FormProblem["field"], string>;
const OPTIONAL_FIELD_ID = {
	scriptsRoots: "project-scripts-roots",
	outputDir: "project-output-dir",
} as const;
// Enlaza el error del formulario con el campo al que pertenece
const describedBy = (field: FormProblem["field"]): string | undefined =>
	errorField === field ? FORM_ERROR_ID : undefined;

const openCreate = (): void => {
	form = emptyForm();
	editing = null;
	pendingRoots = null;
	formError = null;
	errorField = null;
	formOpen = true;
};

const openEdit = (entry: ProjectEntry): void => {
	form = formOf({
		name: entry.name,
		projectDir: entry.projectDir ?? "",
		fileUrl: entry.fileUrl ?? "",
		...(entry.scriptsRoots !== undefined && { scriptsRoots: entry.scriptsRoots }),
		...(entry.outputDir !== undefined && { outputDir: entry.outputDir }),
	});
	editing = entry.id;
	pendingRoots = null;
	formError = null;
	errorField = null;
	formOpen = true;
};

const openDelete = (entry: ProjectEntry): void => {
	deleteError = null;
	deleting = entry;
};

const closeForm = (): void => {
	if (busy) return;
	formOpen = false;
};

const closeDelete = (): void => {
	if (busy) return;
	deleting = null;
};

async function save(): Promise<void> {
	const invalid = validateForm(form);
	if (invalid !== null) {
		formError = invalid.message;
		errorField = invalid.field;
		document.getElementById(FIELD_ID[invalid.field])?.focus();
		return;
	}
	// Fijar la raíz de scripts requiere confirmación explícita (CA-10)
	if (needsScriptsConfirm(form) && !confirming) {
		pendingRoots = scriptsRootsKey(form);
		return;
	}
	busy = true;
	formError = null;
	errorField = null;
	try {
		// En la edición viaja el id existente (upsert); en el alta lo da la base
		const base = toEntryInput(form);
		const entry = editing !== null ? { ...base, id: editing } : base;
		const response = await fetch(
			PROJECTS_SAVE_PATH,
			saveProjectInit(entry, needsScriptsConfirm(form)),
		);
		const body = (await response.json()) as {
			ok?: boolean;
			error?: { message?: string };
		};
		if (!response.ok || body.ok === false) {
			formError = body.error?.message ?? response.statusText;
			return;
		}
		await loadProjects();
		formOpen = false;
	} catch (e) {
		formError = (e as Error).message;
	} finally {
		busy = false;
	}
}

async function remove(id: string): Promise<void> {
	busy = true;
	deleteError = null;
	try {
		const response = await fetch(PROJECTS_DELETE_PATH, deleteProjectInit(id));
		const body = (await response.json()) as {
			ok?: boolean;
			error?: { message?: string };
		};
		if (!response.ok || body.ok === false) {
			deleteError = body.error?.message ?? response.statusText;
			return;
		}
		deleting = null;
		if (editing === id) formOpen = false;
		await loadProjects();
		// La fila borrada tenía el foco: sin esto cae en <body>
		await tick();
		list?.focus();
	} catch (e) {
		deleteError = (e as Error).message;
	} finally {
		busy = false;
	}
}
</script>

<PageHeader>
	{#snippet title()}Proyectos{/snippet}
	{#snippet description()}Da de alta los proyectos de Figma; el selector de arriba elige cuál ves en todo el panel.{/snippet}
	{#snippet actions()}
		<Button variant={BUTTON_VARIANT.primary} onclick={openCreate}>
			<Icon name="plus" size="sm" />Nuevo proyecto
		</Button>
	{/snippet}
</PageHeader>

{#if problems.length > 0}
	<div role="alert" class="mb-4 rounded-xl border border-warning-500 bg-warning-100 px-4 py-3 text-sm text-warning-700">
		<p class="font-medium">El registro de proyectos tiene problemas: solo se usa lo que se pudo leer.</p>
		<ul class="mt-1 list-disc space-y-1 pl-5 font-mono text-xs">
			{#each problems as problem (problem)}<li class="break-all">{problem}</li>{/each}
		</ul>
	</div>
{/if}
{#if entries.length > 0}
	<ul bind:this={list} tabindex="-1" aria-label="Proyectos registrados" class="space-y-2">
		{#each entries as project (project.id)}
			<li class="flex items-center justify-between gap-3 rounded-xl border border-border bg-surface px-4 py-3">
				<div class="min-w-0">
					<p class="truncate text-sm font-medium text-text-primary">{project.name}</p>
					<p class="truncate font-mono text-xs text-text-muted">{project.id}</p>
				</div>
				<div class="flex shrink-0 gap-2">
					<Button variant={BUTTON_VARIANT.secondary} size="sm" onclick={() => openEdit(project)}>Editar</Button>
					<Button variant={BUTTON_VARIANT.danger} size="sm" onclick={() => openDelete(project)}>Borrar</Button>
				</div>
			</li>
		{/each}
	</ul>
{/if}
{#if entries.length === 0}
	<div>
		<EmptyState>
			{#snippet icon()}<Icon name="server-stack" size="lg" />{/snippet}
			{#snippet children()}Todavía no has dado de alta ningún proyecto{/snippet}
			{#snippet description()}Añade el primer proyecto de Figma con el botón «Nuevo proyecto».{/snippet}
			{#snippet actions()}
				<Button variant={BUTTON_VARIANT.primary} onclick={openCreate}>
					<Icon name="plus" size="sm" />Nuevo proyecto
				</Button>
			{/snippet}
		</EmptyState>
	</div>
{/if}

<Modal open={formOpen} onclose={closeForm} size="xl">
	{#snippet title()}{editing === null ? "Nuevo proyecto" : "Editar proyecto"}{/snippet}
	{#snippet children()}
		<div class="grid gap-x-4 gap-y-3.5 sm:grid-cols-2">
			{#if editing !== null}
				<p class="sm:col-span-2 text-xs text-text-muted">ID <span class="ml-1 font-mono text-text-secondary">{editing}</span></p>
			{/if}
			<label class="flex flex-col gap-1.5"><span class="text-sm font-medium text-text-primary">Nombre <span class="text-danger-600" aria-hidden="true">*</span></span><Input id={FIELD_ID.name} bind:value={form.name} placeholder="Mi proyecto" required invalid={errorField === "name"} aria-describedby={describedBy("name")} /></label>
			<label class="flex flex-col gap-1.5"><span class="text-sm font-medium text-text-primary">Directorio del proyecto <span class="text-danger-600" aria-hidden="true">*</span></span><Input id={FIELD_ID.projectDir} bind:value={form.projectDir} placeholder="~/proyectos/mi-proyecto" required invalid={errorField === "projectDir"} aria-describedby={describedBy("projectDir")} /></label>
			<label class="sm:col-span-2 flex flex-col gap-1.5"><span class="text-sm font-medium text-text-primary">Archivo de Figma (sin «?…») <span class="text-danger-600" aria-hidden="true">*</span></span><Input id={FIELD_ID.fileUrl} bind:value={form.fileUrl} placeholder="https://www.figma.com/design/CLAVE/Nombre" required invalid={errorField === "fileUrl"} aria-describedby={describedBy("fileUrl")} /></label>
			<label class="sm:col-span-2 flex flex-col gap-1.5"><span class="text-sm font-medium text-text-primary">Raíz de scripts <span class="text-text-muted">(opcional, una por línea)</span></span>
				<Textarea id={OPTIONAL_FIELD_ID.scriptsRoots} bind:value={form.scriptsRoots} rows={2} size="sm" mono placeholder="~/proyectos/mi-proyecto/scripts" />
			</label>
			<label class="flex flex-col gap-1.5"><span class="text-sm font-medium text-text-primary">Carpeta de salida <span class="text-text-muted">(opcional)</span></span><Input id={OPTIONAL_FIELD_ID.outputDir} bind:value={form.outputDir} placeholder="output/mi-proyecto" /></label>

			{#if confirming}
				<p class="sm:col-span-2 rounded-md border border-warning-500 bg-warning-100 px-3 py-2 text-xs text-warning-700">Vas a fijar la raíz de scripts: de ahí se lee el código que se ejecuta en Figma. Confirma que es de fiar.</p>
			{/if}
			{#if formError}
				<p id={FORM_ERROR_ID} role="alert" class="sm:col-span-2 rounded-md border border-danger-500 bg-danger-100 px-3 py-2 text-xs text-danger-700">{formError}</p>
			{/if}
		</div>
	{/snippet}
	{#snippet footer()}
		<Button variant={BUTTON_VARIANT.tertiary} disabled={busy} onclick={closeForm}>Cancelar</Button>
		<Button variant={BUTTON_VARIANT.primary} loading={busy} onclick={save}>{confirming ? "Confirmar y guardar" : "Guardar"}</Button>
	{/snippet}
</Modal>

<Modal open={deleting !== null} onclose={closeDelete} size="sm">
	{#snippet title()}Borrar proyecto{/snippet}
	{#snippet children()}
		<p class="text-sm text-text-secondary">Vas a borrar <span class="font-medium text-text-primary">«{deleting?.name}»</span> del registro. No se puede deshacer; los archivos del proyecto no se tocan.</p>
		{#if deleteError}
			<p role="alert" class="mt-3 rounded-md border border-danger-500 bg-danger-100 px-3 py-2 text-xs text-danger-700">{deleteError}</p>
		{/if}
	{/snippet}
	{#snippet footer()}
		<Button variant={BUTTON_VARIANT.tertiary} disabled={busy} onclick={closeDelete}>Cancelar</Button>
		<Button variant={BUTTON_VARIANT.danger} loading={busy} onclick={() => deleting && remove(deleting.id)}>Borrar</Button>
	{/snippet}
</Modal>
