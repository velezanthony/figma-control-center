import type {
	CaptureWarning,
	ImageType,
	Screen,
	Viewport,
	WebLogin,
} from "#domain/capture.ts";
import type { FigmaError } from "#domain/figma-error.ts";
import type { Result } from "#domain/result.ts";

// Un usuario de la captura con su contraseña ya resuelta (en memoria; nunca sale de aquí)
export type CaptureUser = {
	readonly username: string;
	readonly password: string;
};

// Lo que se pide al Chrome de captura (pasos 3 a 5)
export type WebCaptureRequest = {
	readonly web: {
		readonly baseUrl: string;
		readonly viewport: Viewport;
		readonly screenScale: number;
		readonly devicePixelRatio: number;
		readonly login: WebLogin | null;
		readonly strip: readonly string[];
		readonly hideScrollbar: boolean;
	};
	readonly screens: readonly Screen[];
	// Por nombre de usuario de `web.users` (el `session` de cada pantalla)
	readonly users: ReadonlyMap<string, CaptureUser>;
	readonly hooks: string | null;
	readonly allowPageWorld: boolean;
	readonly pageTimeoutMs: number;
};

// Una imagen ya sacada de su `data:` (bytes y sha256 de los bytes)
export type CapturedImage = {
	readonly sha256: string;
	readonly bytes: Uint8Array;
	readonly width: number;
	readonly height: number;
	readonly type: ImageType;
};

// Una pantalla capturada: los nodos llevan `path` y las imágenes `ref`; el `id` lo pone el caso de uso
export type CapturedScreen = {
	readonly key: string;
	readonly url: string;
	readonly variants: readonly {
		readonly props: Readonly<Record<string, string>>;
		readonly nodes: readonly unknown[];
	}[];
	readonly images: readonly CapturedImage[];
	readonly warnings: readonly CaptureWarning[];
};

export interface WebCapturer {
	// Lanza el Chrome de captura, inicia sesión, captura cada pantalla (avisando con `onScreen` al acabar cada una) y lo
	// cierra todo al final, también si falla. Un fallo de la página es WebPageError o StateNotReached
	capture(
		request: WebCaptureRequest,
		onScreen: (screen: CapturedScreen) => Promise<void>,
	): Promise<Result<true, FigmaError>>;
}
