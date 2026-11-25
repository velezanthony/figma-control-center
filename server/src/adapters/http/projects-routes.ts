import { z } from "zod";
import type { ProjectRegistry } from "#application/ports/project-registry.ts";
import { figmaFileUrlProblem } from "#domain/figma-url.ts";
import {
	type EntryDraft,
	projectIdProblem,
	type RegistryError,
} from "#domain/registry.ts";
import {
	type ApiRequest,
	type ApiResponse,
	failure,
	STATUS,
	untrusted,
} from "./request-guard.ts";
import { PROJECTS_ROUTE } from "./routes.ts";

// Validación del borde del formulario. strictObject: una clave desconocida es error.
// La URL sigue la regla única de domain/figma-url.ts (la misma que el .env y el registro).
const fileUrl = z.string().superRefine((u, ctx) => {
	const problem = figmaFileUrlProblem(u);
	if (problem !== null) ctx.addIssue({ code: "custom", message: problem });
});
// El id lo da el registro en el alta (un número); en la edición llega el id existente.
// Por eso es opcional en la ENTRADA de la API; el RegistryEntry guardado siempre lleva id.
const projectIdSchema = z.string().superRefine((id, ctx) => {
	const problem = projectIdProblem(id);
	if (problem !== null) ctx.addIssue({ code: "custom", message: problem });
});
const entrySchema = z.strictObject({
	id: projectIdSchema.optional(),
	name: z.string().min(1),
	projectDir: z.string().min(1),
	fileUrl,
	scriptsRoots: z.array(z.string().min(1)).optional(),
	outputDir: z.string().min(1).optional(),
});
const saveSchema = z.strictObject({
	entry: entrySchema,
	// CA-10: fijar la raíz de scripts (de dónde se lee código a ejecutar) exige confirmación explícita
	confirmScriptsRoots: z.boolean().optional(),
});
const deleteSchema = z.strictObject({ id: z.string().min(1) });

// Quita los opcionales sin valor (exactOptionalPropertyTypes: nada de `campo: undefined`)
function toDraft(e: z.infer<typeof entrySchema>): EntryDraft {
	return {
		name: e.name,
		projectDir: e.projectDir,
		fileUrl: e.fileUrl,
		...(e.scriptsRoots !== undefined && { scriptsRoots: e.scriptsRoots }),
		...(e.outputDir !== undefined && { outputDir: e.outputDir }),
	};
}

// Un fallo del registro como respuesta: choque con otro proyecto (409), proyecto inexistente (404) o fallo de disco (500)
function failureOf(error: RegistryError): ApiResponse {
	if (error.reason === "conflict") {
		return failure(
			STATUS.conflict,
			"Duplicate",
			`No se puede guardar: ${error.message}.`,
		);
	}
	if (error.reason === "notFound") {
		return failure(
			STATUS.notFound,
			"NotFound",
			`${error.message} No se puede editar.`,
		);
	}
	return failure(STATUS.serverError, error.type, error.message);
}

// /api/projects/*. Listar es lectura; guardar y borrar son escrituras (mismas comprobaciones que el chat:
// Host local, ningún origen ajeno, JSON) y solo las hace el panel. Devuelve null si la ruta no es de proyectos.
export async function handleProjectsRequest(
	deps: {
		readonly registry: ProjectRegistry;
		readonly allowedHosts: readonly string[];
	},
	request: ApiRequest,
): Promise<ApiResponse | null> {
	if (!request.pathname.startsWith(PROJECTS_ROUTE.prefix)) return null;

	if (request.pathname === PROJECTS_ROUTE.list) {
		if (request.method !== "GET") {
			return failure(STATUS.methodNotAllowed, "MethodNotAllowed", "Solo GET.");
		}
		// Un registro roto no tumba la lista: sale vacía y «Proyectos» cuenta qué pasó (con la ruta)
		const read = await deps.registry.read();
		const rows = read.ok ? read.value.entries : [];
		const problems = read.ok
			? (read.value.problems ?? [])
			: [read.error.message];
		return {
			status: STATUS.ok,
			body: { ok: true, entries: rows, problems },
		};
	}

	if (
		request.pathname !== PROJECTS_ROUTE.save &&
		request.pathname !== PROJECTS_ROUTE.delete
	) {
		return failure(
			STATUS.notFound,
			"NotFound",
			`No existe ${request.pathname}`,
		);
	}
	if (request.method !== "POST") {
		return failure(STATUS.methodNotAllowed, "MethodNotAllowed", "Solo POST.");
	}
	const blocked = untrusted(request, deps.allowedHosts);
	if (blocked !== null) return blocked;

	let json: unknown;
	try {
		json = JSON.parse(request.body);
	} catch {
		return failure(
			STATUS.badRequest,
			"BadRequest",
			"El cuerpo no es JSON válido.",
		);
	}

	if (request.pathname === PROJECTS_ROUTE.save) {
		const parsed = saveSchema.safeParse(json);
		if (!parsed.success) {
			return failure(
				STATUS.badRequest,
				"BadRequest",
				z.prettifyError(parsed.error),
			);
		}
		const { entry, confirmScriptsRoots } = parsed.data;
		if (entry.scriptsRoots !== undefined && confirmScriptsRoots !== true) {
			return failure(
				STATUS.forbidden,
				"ScriptsRootNotConfirmed",
				"Guardar la raíz de scripts (de dónde se ejecuta código) requiere confirmación.",
			);
		}
		// Alta: el registro da el número. Edición: llega el id y tiene que existir (un id inventado no crea nada).
		const saved =
			entry.id === undefined
				? await deps.registry.add(toDraft(entry))
				: await deps.registry.update({ id: entry.id, ...toDraft(entry) });
		return saved.ok
			? { status: STATUS.ok, body: { ok: true } }
			: failureOf(saved.error);
	}

	const parsed = deleteSchema.safeParse(json);
	if (!parsed.success) {
		return failure(
			STATUS.badRequest,
			"BadRequest",
			z.prettifyError(parsed.error),
		);
	}
	const removed = await deps.registry.remove(parsed.data.id);
	return removed.ok
		? { status: STATUS.ok, body: { ok: true } }
		: failureOf(removed.error);
}
