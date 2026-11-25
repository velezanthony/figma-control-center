<script lang="ts">
import type { Snippet } from "svelte";
import Badge from "#web/lib/ui/atoms/Badge.svelte";
import { BADGE_VARIANT } from "#web/lib/ui/atoms/Badge.svelte";
import Term, { TERM_VARIANT } from "./Term.svelte";

type Tone = "running" | "ok" | "error" | "cancelled";
// term: clave del glosario que explica la etiqueta (tooltip con foco)
type Props = { tone: Tone; term?: string | undefined; children: Snippet };
let { tone, term, children }: Props = $props();

// Mapeo de estado a rol: correcto = success, en curso = warning, fallo = danger.
// Cancelado lo pidió el usuario, no es un fallo: neutro.
const VARIANT = {
	ok: BADGE_VARIANT.success,
	running: BADGE_VARIANT.warning,
	error: BADGE_VARIANT.danger,
	cancelled: BADGE_VARIANT.secondary,
} as const;
</script>

{#if term}
	<Term {term} variant={TERM_VARIANT.bare}><Badge variant={VARIANT[tone]} size="sm" dot>{@render children()}</Badge></Term>
{:else}
	<Badge variant={VARIANT[tone]} size="sm" dot>{@render children()}</Badge>
{/if}
