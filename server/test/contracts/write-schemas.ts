// Regenera los JSON Schema publicados en schemas/ desde sus esquemas zod (npm run schemas). Su test
// (adapters/contracts/*.test.ts) falla si el fichero versionado no coincide.
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { AREAS_CONTRACT_NAME, AreasSchema } from "#adapters/contracts/areas.ts";
import {
	BUILD_MANIFEST_CONTRACT,
	ManifestSchema,
} from "#adapters/contracts/build-manifest.ts";
import {
	CAPTURE_CONTRACT,
	CaptureSchema,
} from "#adapters/contracts/capture.ts";
import {
	COMPONENT_CONTRACT_NAME,
	ComponentPlanSchema,
} from "#adapters/contracts/component.ts";
import {
	COMPOSE_CONTRACT_NAME,
	ComposeSchema,
} from "#adapters/contracts/compose.ts";
import {
	DESIGN_CONTEXT_CONTRACT_NAME,
	DesignContextSchema,
} from "#adapters/contracts/design-context.ts";
import { MAP_CONTRACT_NAME, MapSchema } from "#adapters/contracts/map.ts";
import {
	PROJECT_CONTRACT,
	ProjectSchema,
} from "#adapters/contracts/project.ts";
import {
	SCREEN_CONTRACT_NAME,
	ScreenPlanSchema,
} from "#adapters/contracts/screen.ts";
import {
	SCREENS_CONTRACT,
	ScreensSchema,
} from "#adapters/contracts/screens.ts";
import {
	SHEETS_CONTRACT_NAME,
	SheetsSchema,
} from "#adapters/contracts/sheets.ts";
import { STEP_CONTRACT, StepResultSchema } from "#adapters/contracts/step.ts";

const SCHEMAS_DIR = resolve(import.meta.dirname, "../../../schemas");
const PUBLISHED = [
	[BUILD_MANIFEST_CONTRACT, ManifestSchema],
	[PROJECT_CONTRACT, ProjectSchema],
	[SCREENS_CONTRACT, ScreensSchema],
	[CAPTURE_CONTRACT, CaptureSchema],
	[STEP_CONTRACT, StepResultSchema],
	[AREAS_CONTRACT_NAME, AreasSchema],
	[MAP_CONTRACT_NAME, MapSchema],
	[SCREEN_CONTRACT_NAME, ScreenPlanSchema],
	[SHEETS_CONTRACT_NAME, SheetsSchema],
	[COMPONENT_CONTRACT_NAME, ComponentPlanSchema],
	[DESIGN_CONTEXT_CONTRACT_NAME, DesignContextSchema],
	[COMPOSE_CONTRACT_NAME, ComposeSchema],
] as const;

for (const [{ name, version }, schema] of PUBLISHED) {
	const path = join(SCHEMAS_DIR, `${name}.v${version}.json`);
	writeFileSync(
		path,
		`${JSON.stringify(z.toJSONSchema(schema), null, "\t")}\n`,
	);
	process.stderr.write(`${path}\n`);
}
