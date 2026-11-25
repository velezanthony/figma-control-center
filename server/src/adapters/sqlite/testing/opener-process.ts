// Proceso hijo: espera (activamente) a una hora común y abre la base, para que varios procesos choquen en la
// primera migración. Uso: node opener-process.ts <base> <ms-epoch>
import { openFigmaDatabase } from "../database.ts";

const [file, startAt] = process.argv.slice(2);
if (file === undefined || startAt === undefined) {
	console.error("uso: opener-process.ts <base> <ms-epoch>");
	process.exit(2);
}
while (Date.now() < Number(startAt));
openFigmaDatabase(file).$client.close();
