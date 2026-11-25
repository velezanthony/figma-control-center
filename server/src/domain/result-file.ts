// Nombre del fichero de `resultFile` en figma_run_script: solo un nombre, nunca una ruta. Lo
// comprueban la frontera MCP (error de uso sin tocar Figma) y el almacén (no escribe fuera de results/).
const NAME = /^[\w.-]+$/;
const PARENT = "..";
const ONLY_DOTS = /^\.+$/;

export const RESULT_FILE_NAME_RULE =
	"solo un nombre de fichero (letras, números, «_», «.» y «-»), sin «/» ni «..»";

export const isResultFileName = (name: string): boolean =>
	NAME.test(name) && !name.includes(PARENT) && !ONLY_DOTS.test(name);
