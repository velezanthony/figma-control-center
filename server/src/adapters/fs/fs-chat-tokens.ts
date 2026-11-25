import {
	chmodSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { ChatTokens } from "#application/ports/chat.ts";

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const SUFFIX = ".token";
const NOT_FOUND = "ENOENT";
// Los ids de sesión son UUID: el id llega del navegador y no puede salirse de la carpeta
const SESSION_ID = /^[A-Za-z0-9-]{1,64}$/;

// Un archivo por sesión, solo legible por el usuario: el servidor MCP lo escribe y el panel lo lee
export class FsChatTokens implements ChatTokens {
	readonly #dir: string;

	constructor(options: { readonly dir: string }) {
		this.#dir = options.dir;
	}

	publish(sessionId: string, token: string): void {
		const file = this.#fileOf(sessionId);
		if (file === null)
			throw new Error(`id de sesión inválido: ${JSON.stringify(sessionId)}`);
		mkdirSync(this.#dir, { recursive: true, mode: DIR_MODE });
		chmodSync(this.#dir, DIR_MODE);
		writeFileSync(file, token, { mode: FILE_MODE });
		chmodSync(file, FILE_MODE);
	}

	read(sessionId: string): string | null {
		const file = this.#fileOf(sessionId);
		if (file === null) return null;
		try {
			return readFileSync(file, "utf8");
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code === NOT_FOUND) return null;
			throw e;
		}
	}

	revoke(sessionId: string): void {
		const file = this.#fileOf(sessionId);
		if (file !== null) rmSync(file, { force: true });
	}

	#fileOf(sessionId: string): string | null {
		return SESSION_ID.test(sessionId)
			? join(this.#dir, `${sessionId}${SUFFIX}`)
			: null;
	}
}
