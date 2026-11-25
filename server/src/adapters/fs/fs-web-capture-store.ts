// La captura de la web en disco: web-captures/ de la carpeta de salida del proyecto, aparte
// de screenshots/ (los PNG de Figma). Fechas y horas locales, como reads/; un nombre que existe se numera (-2, -3…).
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, normalize } from "node:path";
import type {
	StoredCapture,
	StoredCaptureFile,
	WebCaptureStore,
} from "#application/ports/web-capture-store.ts";
import type { CapturedImage } from "#application/ports/web-capturer.ts";
import { dayOf, safeName, timeOf, writeUnique } from "./local-files.ts";

// Las carpetas de la salida que el servidor deja para que los pasos de pantalla las lean como assets
export const WEB_CAPTURES_DIR = "web-captures";
export const SCREEN_PLANS_DIR = "screen-plans";
export const SHEET_PLANS_DIR = "sheet-plans";

const DIR = Object.freeze({
	root: WEB_CAPTURES_DIR,
	images: "img",
	rejected: "rejected",
	plans: SCREEN_PLANS_DIR,
	sheetPlans: SHEET_PLANS_DIR,
} as const);
const DAY_FOLDER = /^\d{4}-\d{2}-\d{2}$/;
const JSON_EXT = ".json";
const ERRORS_EXT = ".errors.json";
const IMAGE_EXT = { png: ".png", jpeg: ".jpg" } as const;
const EXISTS = "EEXIST";

const utf8 = (text: string): Uint8Array => Buffer.from(text, "utf8");

export class FsWebCaptureStore implements WebCaptureStore {
	readonly #root: string;
	readonly #plans: string;
	readonly #sheetPlans: string;

	constructor(outputDir: string) {
		this.#root = join(outputDir, DIR.root);
		this.#plans = join(outputDir, DIR.plans);
		this.#sheetPlans = join(outputDir, DIR.sheetPlans);
	}

	imageFile(image: Pick<CapturedImage, "sha256" | "type">): string {
		return join(this.#root, this.imagePath(image));
	}

	savePlan(screen: string, json: string, at: Date): Promise<StoredCapture> {
		return writeUnique(
			join(this.#plans, dayOf(at)),
			`${safeName(screen)}_${timeOf(at)}`,
			JSON_EXT,
			utf8(json),
		);
	}

	saveSheetPlan(sheet: string, json: string, at: Date): Promise<StoredCapture> {
		return writeUnique(
			join(this.#sheetPlans, dayOf(at)),
			`${safeName(sheet)}_${timeOf(at)}`,
			JSON_EXT,
			utf8(json),
		);
	}

	async latest(screen: string): Promise<StoredCaptureFile | null> {
		let days: string[];
		try {
			days = (await readdir(this.#root)).filter((d) => DAY_FOLDER.test(d));
		} catch {
			return null;
		}
		const name = new RegExp(
			`^${safeName(screen)}_(\\d{6})(?:-(\\d+))?\\.json$`,
		);
		// Más nuevo primero: el día, la hora y el número de la repetición de esa hora (sin número es la primera)
		let best: { key: string; relative: string } | null = null;
		for (const day of days) {
			let files: string[];
			try {
				files = await readdir(join(this.#root, day));
			} catch {
				continue;
			}
			for (const file of files) {
				const m = name.exec(file);
				if (m === null) continue;
				const key = `${day}_${m[1]}_${String(m[2] ?? "1").padStart(6, "0")}`;
				if (best === null || key > best.key)
					best = { key, relative: `${day}/${file}` };
			}
		}
		return best === null ? null : this.read(best.relative);
	}

	async read(relative: string): Promise<StoredCaptureFile | null> {
		const clean = normalize(relative).split("\\").join("/");
		const first = clean.split("/")[0] ?? "";
		if (
			isAbsolute(relative) ||
			!DAY_FOLDER.test(first) ||
			clean.split("/").includes("..")
		)
			return null;
		const path = join(this.#root, clean);
		try {
			return { path, relative: clean, json: await readFile(path, "utf8") };
		} catch {
			return null;
		}
	}

	imagePath(image: Pick<CapturedImage, "sha256" | "type">): string {
		return `${DIR.images}/${image.sha256}${IMAGE_EXT[image.type]}`;
	}

	async saveImage(image: CapturedImage): Promise<void> {
		await mkdir(join(this.#root, DIR.images), { recursive: true });
		try {
			await writeFile(join(this.#root, this.imagePath(image)), image.bytes, {
				flag: "wx",
			});
		} catch (e) {
			// Mismo sha256 = mismos bytes: ya está
			if ((e as { code?: string }).code !== EXISTS) throw e;
		}
	}

	saveCapture(screen: string, json: string, at: Date): Promise<StoredCapture> {
		return writeUnique(
			join(this.#root, dayOf(at)),
			`${safeName(screen)}_${timeOf(at)}`,
			JSON_EXT,
			utf8(json),
		);
	}

	async saveRejected(
		screen: string,
		json: string,
		errors: string,
		at: Date,
	): Promise<{ readonly path: string; readonly errorsPath: string }> {
		const stored = await writeUnique(
			join(this.#root, DIR.rejected, dayOf(at)),
			`${safeName(screen)}_${timeOf(at)}`,
			JSON_EXT,
			utf8(json),
		);
		const errorsPath = `${stored.path.slice(0, -JSON_EXT.length)}${ERRORS_EXT}`;
		await writeFile(errorsPath, errors, "utf8");
		return { path: stored.path, errorsPath };
	}
}
