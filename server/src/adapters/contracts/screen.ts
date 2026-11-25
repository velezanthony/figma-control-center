// screen@1: el plan de una pantalla. Contrato PROPIO (docs/users/contracts.md);  JSON Schema
// publicado en schemas/screen.v1.json. Solo datos; lo genera el servidor, el agente no lo escribe. El nodo es el de
// capture@1 tal cual (no se transforma).
import { z } from "zod";
import { NodeSchema } from "#adapters/contracts/capture.ts";
import { FingerprintsSchema, MapSchema } from "#adapters/contracts/map.ts";
import {
	PLAN_WARNING,
	SCREEN_CONTRACT,
	type ScreenPlan,
} from "#domain/screen-plan.ts";

export const SCREEN_CONTRACT_NAME = Object.freeze({
	name: "screen",
	version: 1,
} as const);

export const SHA256 = /^[0-9a-f]{64}$/;
const nonEmpty = z.string().min(1);

export const PlanSourceSchema = z.strictObject({
	path: nonEmpty,
	sha256: z.string().regex(SHA256),
});

export const PlanMapSchema = z.strictObject({
	tokens: MapSchema.shape.tokens,
	fonts: MapSchema.shape.fonts,
	effects: MapSchema.shape.effects,
	icons: z.strictObject({
		pages: nonEmpty,
		prefix: nonEmpty,
		glyphs: MapSchema.shape.icons.shape.glyphs,
	}),
	layers: MapSchema.shape.layers,
	screen: MapSchema.shape.screen,
	components: z.strictObject({ genericClasses: z.array(nonEmpty) }).optional(),
});

export const PlanImageSchema = z.strictObject({
	asset: nonEmpty,
	width: z.number().int().positive(),
	height: z.number().int().positive(),
	type: z.enum(["png", "jpeg"]),
	tooLarge: z.boolean().optional(),
});

export const ScreenPlanSchema = z.strictObject({
	contract: z.literal(SCREEN_CONTRACT),
	screen: nonEmpty,
	title: nonEmpty,
	variant: z.number().int().min(0),
	props: z.record(z.string(), z.string()),
	sources: z.strictObject({
		capture: PlanSourceSchema,
		map: PlanSourceSchema,
		recognize: z.strictObject({ sha256: z.string().regex(SHA256) }).optional(),
	}),
	target: z.strictObject({
		page: z.strictObject({
			name: nonEmpty,
			key: nonEmpty,
			after: nonEmpty.optional(),
		}),
		frame: z.strictObject({ name: nonEmpty, key: nonEmpty }),
	}),
	root: z.array(NodeSchema),
	images: z.record(z.string().regex(SHA256), PlanImageSchema),
	icons: z.record(z.string(), nonEmpty),
	map: PlanMapSchema,
	fingerprints: FingerprintsSchema.optional(),
	rules: z.array(nonEmpty).optional(),
	warnings: z.array(
		z.strictObject({
			code: z.enum(Object.values(PLAN_WARNING)),
			nodeId: z.string().optional(),
			message: z.string(),
		}),
	),
}) satisfies z.ZodType<ScreenPlan>;
