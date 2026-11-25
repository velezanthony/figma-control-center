// Solo para drizzle-kit (generar migraciones): npm run db:generate
import { defineConfig } from "drizzle-kit";

export default defineConfig({
	dialect: "sqlite",
	schema: "./server/src/adapters/sqlite/schema.ts",
	out: "./server/src/adapters/sqlite/migrations",
});
