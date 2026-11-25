export const SIDEBAR_STORAGE_KEY = "figma-control-center-sidebar-collapsed";
const COLLAPSED = "1";
const EXPANDED = "0";

// Como el tema: sin almacenamiento (ventana privada, datos bloqueados) la página funciona igual
export function readCollapsed(storage: Pick<Storage, "getItem">): boolean {
	try {
		return storage.getItem(SIDEBAR_STORAGE_KEY) === COLLAPSED;
	} catch {
		return false;
	}
}

export function storeCollapsed(
	storage: Pick<Storage, "setItem">,
	collapsed: boolean,
): void {
	try {
		storage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? COLLAPSED : EXPANDED);
	} catch {
		// sin almacenamiento: solo dura esta visita
	}
}
