// Versión mínima de Claude Code para el arnés (D-10): las opciones de las que depende son recientes (`--restricted`
// desde 2.1.248) y con una versión que no las tenga `claude` podría arrancar sin ellas en silencio. Es la versión con la
// que se comprobaron; la prueba manual del dueño la confirma o la sube.
export const MIN_CLAUDE_VERSION = "2.1.287";

const VERSION = /^\s*(\d+)\.(\d+)\.(\d+)/;

const parts = (v: string): readonly number[] | null => {
	const m = VERSION.exec(v);
	return m === null ? null : [Number(m[1]), Number(m[2]), Number(m[3])];
};

// Por qué no vale la salida de `claude --version` (null si vale)
export function claudeVersionProblem(output: string): string | null {
	const got = parts(output);
	const min = parts(MIN_CLAUDE_VERSION) as readonly number[];
	if (got === null)
		return `no se pudo leer la versión de Claude Code («${output.trim()}»); hace falta la ${MIN_CLAUDE_VERSION} o posterior`;
	for (let i = 0; i < min.length; i++) {
		const a = got[i] as number;
		const b = min[i] as number;
		if (a > b) return null;
		if (a < b)
			return `la versión de Claude Code es la ${got.join(".")} y el arnés necesita la ${MIN_CLAUDE_VERSION} o posterior: actualízalo (claude update)`;
	}
	return null;
}
