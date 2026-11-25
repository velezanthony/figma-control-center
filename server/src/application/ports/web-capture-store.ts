import type { CapturedImage } from "./web-capturer.ts";

// Dónde se guarda la captura de la web: web-captures/ de la carpeta de salida del proyecto,
// con fecha y hora local en el nombre
export type StoredCapture = { readonly path: string; readonly bytes: number };

// Una captura válida ya guardada: su ruta real, su ruta relativa a web-captures/ y su texto
export type StoredCaptureFile = {
	readonly path: string;
	readonly relative: string;
	readonly json: string;
};

export interface WebCaptureStore {
	// La ruta de una imagen dentro de web-captures/ (la que va en `images` de capture@1)
	imagePath(image: Pick<CapturedImage, "sha256" | "type">): string;
	// img/<sha256>.<ext>: si ya existe no se repite
	saveImage(image: CapturedImage): Promise<void>;
	// <AAAA-MM-DD>/<pantalla>_<HHMMSS>.json
	saveCapture(screen: string, json: string, at: Date): Promise<StoredCapture>;
	// rejected/<AAAA-MM-DD>/<pantalla>_<HHMMSS>.json y su .errors.json
	saveRejected(
		screen: string,
		json: string,
		errors: string,
		at: Date,
	): Promise<{ readonly path: string; readonly errorsPath: string }>;
	// La captura válida más reciente de una pantalla (nunca rejected/ ni oracle/); null si no hay ninguna
	latest(screen: string): Promise<StoredCaptureFile | null>;
	// Una captura válida por su ruta relativa a web-captures/; null si no existe, se sale de la carpeta o no es una válida
	read(relative: string): Promise<StoredCaptureFile | null>;
	// La ruta real de una imagen (la que va en `images` de capture@1 es relativa a web-captures/)
	imageFile(image: Pick<CapturedImage, "sha256" | "type">): string;
	// screen-plans/<AAAA-MM-DD>/<pantalla>_<HHMMSS>.json: el plan de un paso (screen@1)
	savePlan(screen: string, json: string, at: Date): Promise<StoredCapture>;
	// sheet-plans/<AAAA-MM-DD>/<hoja>_<HHMMSS>.json: el plan de una hoja de componente (component@1)
	saveSheetPlan(sheet: string, json: string, at: Date): Promise<StoredCapture>;
}
