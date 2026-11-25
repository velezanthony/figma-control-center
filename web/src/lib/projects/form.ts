import type { ProjectEntryInput } from "./endpoints.ts";

// El formulario de alta/edición de un proyecto (texto plano; scriptsRoots una ruta por línea).
// El id no se edita: lo da la base en el alta (un número) y en la edición lo lleva el propio registro.
export type ProjectForm = {
	name: string;
	projectDir: string;
	fileUrl: string;
	scriptsRoots: string;
	outputDir: string;
};

export const emptyForm = (): ProjectForm => ({
	name: "",
	projectDir: "",
	fileUrl: "",
	scriptsRoots: "",
	outputDir: "",
});

export const formOf = (entry: {
	name: string;
	projectDir: string;
	fileUrl: string;
	scriptsRoots?: readonly string[];
	outputDir?: string;
}): ProjectForm => ({
	name: entry.name,
	projectDir: entry.projectDir,
	fileUrl: entry.fileUrl,
	scriptsRoots: (entry.scriptsRoots ?? []).join("\n"),
	outputDir: entry.outputDir ?? "",
});

const roots = (text: string): string[] =>
	text
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "");

// Fijar la raíz de scripts (de dónde se ejecuta código) requiere confirmación (CA-10)
export const needsScriptsConfirm = (form: ProjectForm): boolean =>
	roots(form.scriptsRoots).length > 0;

// Una confirmación de la raíz de scripts vale para las raíces sobre las que se pidió: esta clave las identifica
// (sin espacios ni líneas vacías). Si se edita la raíz después, la confirmación ya no está en pie.
export const scriptsRootsKey = (form: ProjectForm): string =>
	roots(form.scriptsRoots).join("\n");

export const confirmationStands = (
	form: ProjectForm,
	pendingKey: string | null,
): boolean => pendingKey !== null && pendingKey === scriptsRootsKey(form);

// Una URL de archivo de Figma con su clave: /design/<clave> o el formato antiguo /file/<clave>. Misma regla que el
// servidor (domain/figma-url.ts); server/test/web-form-url.test.ts comprueba que no se separan.
const FIGMA_FILE_URL =
	/^https:\/\/www\.figma\.com\/(?:design|file)\/[A-Za-z0-9]+(?:[/?#]|$)/;
const isFigmaFileUrl = (url: string): boolean => FIGMA_FILE_URL.test(url);

// Lo que falla del formulario y en qué campo (para enlazar el error con él), o null si es válido
export type FormProblem = {
	readonly field: "name" | "projectDir" | "fileUrl";
	readonly message: string;
};

export function validateForm(form: ProjectForm): FormProblem | null {
	if (form.name.trim() === "")
		return { field: "name", message: "El nombre es obligatorio." };
	if (form.projectDir.trim() === "")
		return {
			field: "projectDir",
			message: "El directorio del proyecto es obligatorio.",
		};
	const fileUrl = form.fileUrl.trim();
	const fail = (message: string): FormProblem => ({
		field: "fileUrl",
		message,
	});
	if (fileUrl === "")
		return fail("La URL del archivo de Figma es obligatoria.");
	if (fileUrl.includes("?") || fileUrl.includes("#"))
		return fail(
			"La URL no puede llevar query string ni fragmento (quita desde «?»).",
		);
	if (!isFigmaFileUrl(fileUrl))
		return fail(
			"La URL debe ser un archivo de Figma con su clave (https://www.figma.com/design/<clave> o /file/<clave>).",
		);
	return null;
}

// Convierte el formulario a lo que la API espera; los opcionales vacíos no se envían.
// El id no va aquí: en la edición lo añade la página con el id que se está editando.
export function toEntryInput(form: ProjectForm): ProjectEntryInput {
	const scriptsRoots = roots(form.scriptsRoots);
	const outputDir = form.outputDir.trim();
	return {
		name: form.name.trim(),
		projectDir: form.projectDir.trim(),
		fileUrl: form.fileUrl.trim(),
		...(scriptsRoots.length > 0 && { scriptsRoots }),
		...(outputDir !== "" && { outputDir }),
	};
}
