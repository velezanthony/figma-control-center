// ¿Existe un proceso con ese pid? `kill(pid, 0)` no manda nada: solo comprueba. EPERM = existe pero es de otro usuario.
// Un pid reutilizado por otro proceso da un falso «vivo»: el job se queda como estaba y se ve (nunca se cierra de más)
export function isProcessAlive(pid: number | null): boolean {
	if (pid === null) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		return (e as NodeJS.ErrnoException).code === "EPERM";
	}
}
