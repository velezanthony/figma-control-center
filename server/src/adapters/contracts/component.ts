// component@1: el plan de una hoja de componente. Contrato PROPIO (docs/users/contracts.md);  JSON
// Schema publicado en schemas/component.v1.json. Solo datos; lo genera el servidor, el agente no lo escribe. El nodo es el
// de capture@1 tal cual (no se transforma).
import { z } from "zod";
import { NodeSchema } from "#adapters/contracts/capture.ts";
import { FingerprintsSchema } from "#adapters/contracts/map.ts";
import {
	PlanImageSchema,
	PlanMapSchema,
	PlanSourceSchema,
	SHA256,
} from "#adapters/contracts/screen.ts";
import { SheetSchema, StyleSchema } from "#adapters/contracts/sheets.ts";
import {
	COMPONENT_CONTRACT,
	type ComponentPlan,
	SHEET_WARNING,
} from "#domain/component-plan.ts";

export const COMPONENT_CONTRACT_NAME = Object.freeze({
	name: "component",
	version: 1,
} as const);

const nonEmpty = z.string().min(1);

export const ComponentPlanSchema = z.strictObject({
	contract: z.literal(COMPONENT_CONTRACT),
	sheet: SheetSchema,
	style: StyleSchema,
	sources: z.strictObject({
		capture: PlanSourceSchema,
		sheets: PlanSourceSchema,
		map: PlanSourceSchema,
		recognize: z.strictObject({ sha256: z.string().regex(SHA256) }).optional(),
	}),
	target: z.strictObject({
		page: z.strictObject({
			name: nonEmpty,
			key: nonEmpty,
			after: nonEmpty.optional(),
			section: nonEmpty.optional(),
		}),
		set: z.strictObject({ name: nonEmpty, key: nonEmpty }),
	}),
	variants: z.array(
		z.strictObject({
			props: z.record(z.string(), z.string()),
			root: z.array(NodeSchema),
		}),
	),
	images: z.record(z.string().regex(SHA256), PlanImageSchema),
	icons: z.record(z.string(), nonEmpty),
	map: PlanMapSchema,
	fingerprints: FingerprintsSchema.optional(),
	rules: z.array(nonEmpty).optional(),
	matrix: z.strictObject({
		rows: z.array(z.string()),
		columns: z.array(z.string()),
		cells: z.array(z.array(z.number().int().min(0))),
	}),
	warnings: z.array(
		z.strictObject({
			code: z.enum(Object.values(SHEET_WARNING)),
			nodeId: z.string().optional(),
			message: z.string(),
		}),
	),
}) satisfies z.ZodType<ComponentPlan>;
