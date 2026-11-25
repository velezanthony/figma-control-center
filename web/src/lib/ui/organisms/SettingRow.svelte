<script lang="ts">
import type { SettingOrigin, SettingView } from "#web/lib/contract.ts";
import { appliesWhen, hasChanged, ORIGIN_LABEL, rowState, unitLabel } from "#web/lib/settings/rows.ts";
import Badge, { BADGE_VARIANT, type BadgeVariant } from "#web/lib/ui/atoms/Badge.svelte";
import Button, { BUTTON_VARIANT } from "#web/lib/ui/atoms/Button.svelte";
import Input from "#web/lib/ui/atoms/Input.svelte";

type Props = {
	setting: SettingView;
	// El aviso del servidor sobre lo guardado de esta clave (si no vale), o null
	problem: string | null;
	// Por qué no se guardó lo último (el mensaje de zod o del entorno), o null
	error: string | null;
	busy: boolean;
	onsave: (value: string) => void;
	onreset: () => void;
};
let { setting, problem, error, busy, onsave, onreset }: Props = $props();

const ORIGIN_VARIANT: Record<SettingOrigin, BadgeVariant> = {
	default: BADGE_VARIANT.secondary,
	panel: BADGE_VARIANT.primary,
	env: BADGE_VARIANT.info,
};

const id = $props.id();
const labelId = `${id}-nombre`;
const fieldId = `${id}-valor`;
const errorId = `${id}-error`;
const resetId = `${id}-restablecer`;

const row = $derived(rowState(setting, problem));
// Lo escrito en el campo; vuelve a lo efectivo cada vez que el listado cambia (al guardar o restablecer)
let draft = $derived(String(setting.effective));
// «Guardar» solo si lo escrito difiere del valor efectivo
const changed = $derived(hasChanged(draft, setting.effective));
</script>

<div role="group" aria-labelledby={labelId} class="grid gap-3 px-5 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:gap-6">
	<div class="min-w-0 space-y-1.5">
		<div class="flex flex-wrap items-center gap-2">
			<label id={labelId} for={fieldId} class="text-sm font-medium text-text-primary">{setting.name}</label>
			<Badge variant={ORIGIN_VARIANT[setting.origin]} size="sm">{ORIGIN_LABEL[setting.origin]}</Badge>
			{#if row.pendingRestart}<Badge variant={BADGE_VARIANT.warning} size="sm" dot>Pendiente: reinicia el panel</Badge>{/if}
		</div>
		<p class="text-xs text-text-secondary">{setting.help}</p>
		<p class="font-mono text-[11px] break-all text-text-muted">{setting.key}</p>
		<p class="text-xs text-text-muted">{appliesWhen(setting.usedBy)}</p>
		{#if row.readOnly}
			<p class="text-xs text-text-secondary">Lo fija <span class="font-mono">.env</span> o el entorno del panel: para cambiarlo aquí, quítalo de allí y reinicia.</p>
		{/if}
		{#if row.ignoredStored !== null}
			<p class="text-xs text-warning-700">
				{#if row.readOnly}Hay un valor guardado, «{row.ignoredStored}», que no se aplica mientras lo fije el entorno.{:else}El valor guardado, «{row.ignoredStored}», no vale y no se aplica{#if row.storedProblem !== null}: {row.storedProblem}{/if}.{/if}
			</p>
		{/if}
	</div>
	<div class="min-w-0 space-y-2">
		<div class="grid grid-cols-[8rem_minmax(0,1fr)] items-center gap-2">
			<Input id={fieldId} bind:value={draft} size="sm" readonly={row.readOnly} invalid={error !== null} aria-describedby={error !== null ? errorId : undefined} inputmode="numeric" autocomplete="off" />
			<span class="min-w-0 font-mono text-xs break-words text-text-muted">{unitLabel(draft, setting.unit)}</span>
		</div>
		{#if error !== null}
			<p id={errorId} role="alert" class="text-xs text-danger-700">{error}</p>
		{/if}
		<div class="flex flex-wrap items-center justify-between gap-2">
			<span class="text-xs text-text-muted">Por defecto: {String(setting.default)}</span>
			<div class="flex items-center gap-2">
				{#if row.canReset}
					<span id={resetId} class="text-xs text-text-muted">Vuelve a {row.resetsTo}</span>
					<Button variant={BUTTON_VARIANT.tertiary} size="sm" disabled={busy} aria-describedby={resetId} onclick={onreset}>Restablecer</Button>
				{/if}
				{#if !row.readOnly}
					<Button variant={BUTTON_VARIANT.primary} size="sm" loading={busy} disabled={!changed} onclick={() => onsave(draft)}>Guardar</Button>
				{/if}
			</div>
		</div>
	</div>
</div>
