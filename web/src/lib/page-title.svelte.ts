import { pageTitle, type RouteName } from "#web/lib/route.ts";

// El título de la pestaña sigue a la pantalla que se pinta; se llama dentro de un componente (o un $effect.root)
export function followPageTitle(route: () => RouteName): void {
	$effect(() => {
		document.title = pageTitle(route());
	});
}
