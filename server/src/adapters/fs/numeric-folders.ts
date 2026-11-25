import { readdirSync } from "node:fs";

const NUMBER = /^[1-9][0-9]*$/;

// Los números de las carpetas de `dir` que se llaman como un id de proyecto (1, 2, 3…): restos de una base borrada a
// mano que el id nuevo no debe pisar. Una carpeta que no existe no es error
export function numericFolders(dir: string): number[] {
	try {
		return readdirSync(dir, { withFileTypes: true })
			.filter((e) => e.isDirectory() && NUMBER.test(e.name))
			.map((e) => Number(e.name));
	} catch {
		return [];
	}
}
