<script lang="ts">
// Barra de progreso: done/total → un relleno. Los valores parametrizan el estado (como el tamaño de un Spinner);
// el texto que la acompaña lo pone quien la usa. La lógica que deriva done/total vive en lib/activity/build-progress.ts.
type Tone = "brand" | "success" | "danger";
type Props = { done: number; total: number; tone?: Tone; label?: string };
let { done, total, tone = "brand", label }: Props = $props();

const FILL: Record<Tone, string> = {
	brand: "bg-brand-500",
	success: "bg-success-500",
	danger: "bg-danger-500",
};

// Entre 0 y 100; sin total (0) la barra queda vacía
const pct = $derived(
	total <= 0 ? 0 : Math.min(100, Math.max(0, (done / total) * 100)),
);
</script>

<div
	class="h-2 w-full overflow-hidden rounded-full bg-surface-sunken"
	role="progressbar"
	aria-valuenow={done}
	aria-valuemin={0}
	aria-valuemax={total}
	aria-label={label}
>
	<div class="h-full rounded-full motion-safe:transition-[width] {FILL[tone]}" style="width: {pct}%"></div>
</div>
