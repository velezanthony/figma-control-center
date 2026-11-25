// El kit de captura empaquetado (kits/dist/capture-kit.js) como lo guarda el historial de intentos: versión y texto
import { readFileSync } from "node:fs";
import { CAPTURE_KIT } from "#domain/capture.ts";
import { KIT_BUNDLE } from "./protocol.ts";

export function readCaptureKitBundle(path: string = KIT_BUNDLE): {
	readonly version: string;
	readonly content: string;
} {
	return { version: CAPTURE_KIT, content: readFileSync(path, "utf8") };
}
