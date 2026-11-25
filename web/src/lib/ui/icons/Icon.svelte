<script lang="ts">
import { ICONS, type IconName } from "./icons.ts";

type Size = "xs" | "sm" | "md" | "lg";
type Weight = "regular" | "bold";
type Props = { name: IconName; size?: Size; weight?: Weight };

let { name, size = "sm", weight = "regular" }: Props = $props();

const SIZE: Record<Size, string> = {
	xs: "size-3",
	sm: "size-4",
	md: "size-5",
	lg: "size-10",
};
// Tabler se dibuja a trazo 2; 1.75 lo afina un punto para un acabado más fino sin perder presencia
const WEIGHT: Record<Weight, string> = { regular: "1.75", bold: "2" };
</script>

<svg
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width={WEIGHT[weight]}
	stroke-linecap="round"
	stroke-linejoin="round"
	aria-hidden="true"
	class="shrink-0 {SIZE[size]}"
>
	{#each ICONS[name] as d (d)}
		<path {d} />
	{/each}
</svg>
