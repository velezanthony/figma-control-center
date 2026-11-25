<script lang="ts">
import type { PageWindow } from "#web/lib/activity/paginate.ts";
import Paginator from "#web/lib/ui/molecules/Paginator.svelte";
import PerPage from "#web/lib/ui/molecules/PerPage.svelte";
import ResultsCount from "#web/lib/ui/molecules/ResultsCount.svelte";

type Props = {
	window: PageWindow;
	perPage: number;
	choices: readonly number[];
	onpage: (page: number) => void;
	onperpage: (perPage: number) => void;
};
let { window: pageWindow, perPage, choices, onpage, onperpage }: Props = $props();
</script>

<div class="mt-4 flex flex-wrap items-center justify-between gap-4 text-sm">
	<div class="flex flex-col gap-1.5">
		<ResultsCount from={pageWindow.from} to={pageWindow.to} total={pageWindow.total} />
		<PerPage value={perPage} {choices} onchange={onperpage} />
	</div>
	<Paginator page={pageWindow.page} pageCount={pageWindow.pageCount} {onpage} />
</div>
