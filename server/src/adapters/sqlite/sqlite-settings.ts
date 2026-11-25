import { eq, inArray } from "drizzle-orm";
import type { SettingsStore } from "#application/ports/settings.ts";
import type { FigmaDb } from "./database.ts";
import { settings } from "./schema.ts";

const WRITE_TX = { behavior: "immediate" } as const;

export class SqliteSettings implements SettingsStore {
	readonly #db: FigmaDb;

	constructor(options: { readonly db: FigmaDb }) {
		this.#db = options.db;
	}

	all(): Readonly<Record<string, string>> {
		return Object.fromEntries(
			this.#db
				.select()
				.from(settings)
				.all()
				.map((row) => [row.key, row.value]),
		);
	}

	set(key: string, value: string): void {
		this.#db
			.insert(settings)
			.values({ key, value })
			.onConflictDoUpdate({ target: settings.key, set: { value } })
			.run();
	}

	remove(key: string): void {
		this.#db.delete(settings).where(eq(settings.key, key)).run();
	}

	removeMany(keys: readonly string[]): readonly string[] {
		if (keys.length === 0) return [];
		return this.#db.transaction((tx) => {
			const there = tx
				.select({ key: settings.key })
				.from(settings)
				.where(inArray(settings.key, [...keys]))
				.all()
				.map((row) => row.key);
			tx.delete(settings)
				.where(inArray(settings.key, [...keys]))
				.run();
			return there;
		}, WRITE_TX);
	}
}
