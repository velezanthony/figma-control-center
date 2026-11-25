import { createHash } from "node:crypto";

// De un token solo se guarda su huella: ni la base ni el panel de otra máquina pueden fabricar mensajes con ella
export const hashToken = (token: string): string =>
	createHash("sha256").update(token).digest("hex");
