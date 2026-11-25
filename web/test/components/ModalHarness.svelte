<script lang="ts">
// Un Modal controlado como lo usan las páginas: el padre no lo cierra mientras está ocupado (p. ej. guardando)
import Modal from "#web/lib/ui/molecules/Modal.svelte";

let { isBusy }: { isBusy: () => boolean } = $props();
let open = $state(true);
</script>

<Modal {open} onclose={() => { if (!isBusy()) open = false; }}>
	{#snippet title()}Formulario{/snippet}
	<p>Cuerpo</p>
</Modal>
