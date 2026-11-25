import { KIT_FAIL_MARKER } from "../protocol.ts";

// Código del error de un set que Figma da por roto (sale delante del mensaje del ScriptError)
const BROKEN_COMPONENT_SET_CODE = "BROKEN_COMPONENT_SET";

// Cabecera común de los scripts internos de lectura: qué lectura es y lo que se le pidió. La entrada llega como `params`
// del envoltorio (adapters/cdp/script-wrapper.ts): el script es un texto fijo, sin nada interpolado, y una sonda puede
// llamarlo con ids que solo existen en tiempo de ejecución. `READ_KIND` es la huella por la que el simulador de los E2E
// reconoce cada lectura (server/test/harness).
export const readHeader = (kind: string): string => `
const READ_KIND = ${JSON.stringify(kind)};
const QUERY = params;`;

// Lo que lanzan los scripts cuando una página pedida no está en el archivo (ScriptError con su nombre)
export const MISSING_PAGE_SNIPPET = `
const missingPage = (name) => new Error('La página «' + name + '» no existe en el archivo');`;

// Las definiciones de propiedades de un set o componente. Figma lanza al leerlas si el set está roto («Component set has
// existing errors»); la lectura sigue abortando, pero el error dice qué set es, con su id y su página
export const PROPERTY_DEFINITIONS_SNIPPET = `
const propertyDefinitionsOf = (owner) => {
	try {
		return owner.componentPropertyDefinitions;
	} catch (e) {
		let page = owner.parent;
		while (page && page.type !== 'PAGE') page = page.parent;
		const where = page ? ', página «' + page.name + '»' : '';
		const cause = e && typeof e.message === 'string' ? e.message : String(e);
		throw new Error(${JSON.stringify(KIT_FAIL_MARKER)} + JSON.stringify({
			code: ${JSON.stringify(BROKEN_COMPONENT_SET_CODE)},
			message: 'El set «' + owner.name + '» (' + owner.id + where + ') tiene errores en Figma: ' + cause + '; arréglalo en Figma o quítalo.',
			next: 'Necesita a una persona: arréglalo en Figma o quítalo y vuelve a leer; mientras siga roto, la lectura falla igual.',
		}));
	}
};`;
