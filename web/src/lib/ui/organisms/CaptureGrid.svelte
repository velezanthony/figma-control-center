<script lang="ts">
import { projectScreenshotUrl } from "#web/lib/projects/projects.svelte.ts";
import type { CaptureItem } from "#web/lib/contract.ts";
import { formatClock } from "#web/lib/activity/format.ts";
import { hrefOf, ROUTE_NAME } from "#web/lib/route.ts";
import Thumbnail from "#web/lib/ui/atoms/Thumbnail.svelte";
import Icon from "#web/lib/ui/icons/Icon.svelte";
import EmptyState from "#web/lib/ui/molecules/EmptyState.svelte";
import NodeLinks from "#web/lib/ui/molecules/NodeLinks.svelte";
import SectionCard from "#web/lib/ui/molecules/SectionCard.svelte";

// imageUrl: de dónde sale la imagen de cada captura (la galería usa una de ejemplo)
type Props = {
	items: readonly CaptureItem[];
	imageUrl?: (path: string) => string;
};
let { items, imageUrl = projectScreenshotUrl }: Props = $props();
</script>

{#if items.length === 0}
	<EmptyState>
		{#snippet icon()}<Icon name="photo" size="lg" />{/snippet}
		Aún no hay capturas
		{#snippet description()}Aparecen cuando Claude llama a figma_screenshot.{/snippet}
	</EmptyState>
{:else}
	<ul class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
		{#each items as item (`${item.call.callId}:${item.shot.path}`)}
			<li>
				<SectionCard padding="none">
					<Thumbnail src={imageUrl(item.shot.path)} alt="Captura del nodo {item.shot.nodeId}" size="fill" />
					<div class="flex flex-col gap-2 border-t border-border p-4">
						<div class="flex items-center justify-between gap-2">
							<NodeLinks ids={[item.shot.nodeId]} fileUrl={item.call.fileUrl} />
							<span class="font-mono text-xs text-text-muted">{item.shot.width}×{item.shot.height}</span>
						</div>
						<div class="flex items-center justify-between gap-2 text-xs text-text-muted">
							<span class="font-mono">{formatClock(item.call.startedAt)}</span>
							<a href={hrefOf(ROUTE_NAME.activity, `open=${encodeURIComponent(item.call.callId)}`)} class="font-medium text-brand-700 hover:underline">Ver llamada</a>
						</div>
					</div>
				</SectionCard>
			</li>
		{/each}
	</ul>
{/if}
