import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type {
	AssetRecord,
	AttemptItem,
	AttemptKind,
	AttemptScriptItem,
	ScriptLookup,
} from "#domain/attempt.ts";
import { makeAttemptDiff } from "./attempt-diff.ts";
import { createHistory } from "./history.ts";
import { InMemoryHistoryQuery } from "./testing/in-memory-history-query.ts";

type Content = {
	readonly role: string;
	readonly path?: string;
	readonly text: string;
	readonly tooBig?: boolean;
};

const sha = (text: string) => `sha:${text}`;

// Un doble con intentos y contenidos por hash
function setup(maxEdits?: number) {
	const query = new InMemoryHistoryQuery();
	const blobs = new Map<string, string | null>();
	query.storedScriptFor = (selector): ScriptLookup => {
		if (selector.by !== "sha256" || !blobs.has(selector.sha256)) {
			return { kind: "not_found" };
		}
		const content = blobs.get(selector.sha256) ?? null;
		return {
			kind: "found",
			script: {
				sha256: selector.sha256,
				kind: "js",
				bytes: content?.length ?? 99,
				stored: content === null ? "too_big" : "full",
				content,
			},
		};
	};
	const history = createHistory({
		query,
		now: () => new Date("2026-06-01T12:00:00Z"),
		maxRows: 100,
	});
	const attempt = (
		id: number,
		contents: readonly Content[],
		over: Partial<AttemptItem> & { kind?: AttemptKind } = {},
	): AttemptItem => {
		const scripts: AttemptScriptItem[] = contents.map((c) => {
			const hash = sha(`${c.role}:${c.path ?? ""}:${c.text}`);
			blobs.set(hash, c.tooBig === true ? null : c.text);
			return {
				role: c.role as AttemptScriptItem["role"],
				path: c.path ?? "",
				sha256: hash,
				bytes: c.text.length,
				stored: c.tooBig === true ? "too_big" : "full",
			};
		});
		const item: AttemptItem = {
			id,
			n: id,
			kind: "run_script",
			target: "a.js",
			status: "ok",
			firstError: null,
			callId: null,
			jobId: null,
			stepIndex: null,
			startedAt: "2026-06-01T10:00:00.000Z",
			finishedAt: "2026-06-01T10:00:01.000Z",
			kit: "figma-kit@1",
			kitSha256: "k",
			assets: [],
			scripts,
			changed: null,
			callKept: true,
			...over,
		};
		query.attemptsById.set(id, item);
		return item;
	};
	return {
		attempt,
		diff: makeAttemptDiff({
			history,
			...(maxEdits !== undefined && { maxEdits }),
		}),
	};
}

const c = (
	role: string,
	text: string,
	rest: Partial<Content> = {},
): Content => ({
	role,
	text,
	...rest,
});

describe("makeAttemptDiff: papeles", () => {
	it("dos intentos con lo mismo: todos los papeles iguales y sin diff", () => {
		const { attempt, diff } = setup();
		attempt(1, [c("step", "a\nb\n"), c("kit", "K")]);
		attempt(2, [c("step", "a\nb\n"), c("kit", "K")]);
		const out = diff({ from: 1, to: 2 });
		assert.ok(out.ok);
		assert.deepEqual(
			out.value.roles.map((r) => [r.role, r.state]),
			[
				["step", "same"],
				["kit", "same"],
			],
		);
		assert.equal(out.value.diff, null);
	});

	it("un papel que cambia: cuenta las líneas y abre su diff por defecto", () => {
		const { attempt, diff } = setup();
		attempt(1, [c("step", "a\nb\nc\n"), c("kit", "K")]);
		attempt(2, [c("step", "a\nB\nc\nd\n"), c("kit", "K")]);
		const out = diff({ from: 1, to: 2 });
		assert.ok(out.ok);
		assert.deepEqual(out.value.roles[0], {
			role: "step",
			path: "",
			state: "changed",
			added: 2,
			removed: 1,
		});
		assert.equal(out.value.diff?.role, "step");
		assert.equal(out.value.diff?.kind, "diff");
	});

	it("con varios papeles cambiados abre el primero; role pide otro", () => {
		const { attempt, diff } = setup();
		attempt(1, [c("step", "a"), c("kit", "K1")]);
		attempt(2, [c("step", "b"), c("kit", "K2")]);
		const first = diff({ from: 1, to: 2 });
		assert.ok(first.ok);
		assert.equal(first.value.diff?.role, "step");
		const kit = diff({ from: 1, to: 2, role: "kit" });
		assert.ok(kit.ok);
		assert.equal(kit.value.diff?.role, "kit");
	});

	it("un papel que aparece o desaparece: todo añadido o todo borrado", () => {
		const { attempt, diff } = setup();
		attempt(1, [c("step", "a"), c("hooks", "h1\nh2\n")]);
		attempt(2, [c("step", "a"), c("map", "{}")]);
		const out = diff({ from: 1, to: 2 });
		assert.ok(out.ok);
		const states = Object.fromEntries(
			out.value.roles.map((r) => [r.role, [r.state, r.added, r.removed]]),
		);
		assert.deepEqual(states["hooks"], ["removed", 0, 2]);
		assert.deepEqual(states["map"], ["added", 1, 0]);
		assert.equal(out.value.diff?.role, "hooks");
	});

	it("un papel desconocido (sheets) sale igual, tras los conocidos", () => {
		const { attempt, diff } = setup();
		attempt(1, [c("sheets", "x"), c("step", "a")]);
		attempt(2, [c("sheets", "y"), c("step", "a")]);
		const out = diff({ from: 1, to: 2 });
		assert.ok(out.ok);
		assert.deepEqual(
			out.value.roles.map((r) => r.role),
			["step", "sheets"],
		);
		assert.equal(out.value.diff?.role, "sheets");
	});

	it("un papel con varias rutas: un papel por ruta, y piden path si role es ambiguo", () => {
		const { attempt, diff } = setup();
		attempt(1, [
			c("hooks", "a", { path: "x.js" }),
			c("hooks", "b", { path: "y.js" }),
		]);
		attempt(2, [
			c("hooks", "a2", { path: "x.js" }),
			c("hooks", "b", { path: "y.js" }),
		]);
		const all = diff({ from: 1, to: 2 });
		assert.ok(all.ok);
		assert.deepEqual(
			all.value.roles.map((r) => [r.path, r.state]),
			[
				["x.js", "changed"],
				["y.js", "same"],
			],
		);
		const ambiguous = diff({ from: 1, to: 2, role: "hooks" });
		assert.ok(!ambiguous.ok);
		assert.equal(ambiguous.error.type, "InvalidInput");
		assert.match(ambiguous.error.message, /x\.js/);
		const exact = diff({ from: 1, to: 2, role: "hooks", path: "x.js" });
		assert.ok(exact.ok);
		assert.equal(exact.value.diff?.path, "x.js");
	});

	it("un papel que ninguno de los dos tiene: no encontrado", () => {
		const { attempt, diff } = setup();
		attempt(1, [c("step", "a")]);
		attempt(2, [c("step", "b")]);
		const out = diff({ from: 1, to: 2, role: "kit" });
		assert.ok(!out.ok);
		assert.equal(out.error.type, "NotFound");
	});
});

describe("makeAttemptDiff: JSON (D-5)", () => {
	it("formatea y ordena las claves: sale el campo que cambió, no una línea entera", () => {
		const { attempt, diff } = setup();
		attempt(1, [c("params", '{"b":1,"a":{"y":2,"x":1}}')]);
		attempt(2, [c("params", '{"a":{"x":1,"y":3},"b":1}')]);
		const out = diff({ from: 1, to: 2 });
		assert.ok(out.ok);
		assert.deepEqual(out.value.roles[0], {
			role: "params",
			path: "",
			state: "changed",
			added: 1,
			removed: 1,
		});
		const lines =
			out.value.diff?.kind === "diff"
				? out.value.diff.hunks.flatMap((h) => h.lines)
				: [];
		assert.deepEqual(
			lines.filter((l) => l.op !== "context").map((l) => l.text),
			['    "y": 2', '    "y": 3'],
		);
	});

	it("solo cambió el orden de las claves: el papel cambió, sin líneas cambiadas", () => {
		const { attempt, diff } = setup();
		attempt(1, [c("params", '{"a":1,"b":2}')]);
		attempt(2, [c("params", '{"b":2,"a":1}')]);
		const out = diff({ from: 1, to: 2 });
		assert.ok(out.ok);
		assert.deepEqual(out.value.roles[0], {
			role: "params",
			path: "",
			state: "changed",
			added: 0,
			removed: 0,
		});
	});

	it("un JSON inválido se compara tal cual; un script no se toca", () => {
		const { attempt, diff } = setup();
		attempt(1, [c("plan", "no {json\nuno"), c("step", '{"a":1}')]);
		attempt(2, [c("plan", "no {json\ndos"), c("step", '{"a":2}')]);
		const out = diff({ from: 1, to: 2 });
		assert.ok(out.ok);
		const byRole = Object.fromEntries(out.value.roles.map((r) => [r.role, r]));
		assert.equal(byRole["plan"]?.added, 1);
		assert.equal(
			byRole["step"]?.added,
			1,
			"un script de una línea: una línea cambiada",
		);
	});
});

describe("makeAttemptDiff: casos sin diff", () => {
	it("un lado pasó del tope (too_big): solo hash, con los dos hashes", () => {
		const { attempt, diff } = setup();
		attempt(1, [c("kit", "K1", { tooBig: true })]);
		attempt(2, [c("kit", "K2")]);
		const out = diff({ from: 1, to: 2 });
		assert.ok(out.ok);
		assert.equal(out.value.roles[0]?.state, "hash_only");
		assert.deepEqual(out.value.diff, {
			role: "kit",
			path: "",
			kind: "too_big",
			fromSha256: sha("kit::K1"),
			toSha256: sha("kit::K2"),
		});
	});

	it("too_big con el mismo hash en los dos lados: igual, no solo hash", () => {
		const { attempt, diff } = setup();
		attempt(1, [c("kit", "K", { tooBig: true })]);
		attempt(2, [c("kit", "K", { tooBig: true })]);
		const out = diff({ from: 1, to: 2 });
		assert.ok(out.ok);
		assert.equal(out.value.roles[0]?.state, "same");
	});

	it("pasado el tope de cambios: demasiado grande, y el papel sigue marcado como cambiado", () => {
		const { attempt, diff } = setup(10);
		const lines = (p: string) =>
			Array.from({ length: 60 }, (_, i) => `${p}${i}`).join("\n");
		attempt(1, [c("plan", lines("a"))]);
		attempt(2, [c("plan", lines("b"))]);
		const out = diff({ from: 1, to: 2 });
		assert.ok(out.ok);
		assert.deepEqual(out.value.roles[0], {
			role: "plan",
			path: "",
			state: "changed",
			added: null,
			removed: null,
		});
		assert.deepEqual(out.value.diff, {
			role: "plan",
			path: "",
			kind: "too_large",
		});
	});
});

describe("makeAttemptDiff: errores de uso", () => {
	it("un id que no existe (o de otro proyecto): no encontrado, con el id", () => {
		const { attempt, diff } = setup();
		attempt(1, [c("step", "a")]);
		const out = diff({ from: 1, to: 404 });
		assert.ok(!out.ok);
		assert.equal(out.error.type, "NotFound");
		assert.match(out.error.message, /404/);
	});

	it("objetivos distintos: error de uso que nombra los dos", () => {
		const { attempt, diff } = setup();
		attempt(1, [c("step", "a")], { target: "uno.js" });
		attempt(2, [c("step", "a")], { target: "dos.js" });
		const out = diff({ from: 1, to: 2 });
		assert.ok(!out.ok);
		assert.equal(out.error.type, "InvalidInput");
		assert.match(out.error.message, /uno\.js/);
		assert.match(out.error.message, /dos\.js/);
	});

	it("el mismo objetivo de otro tipo tampoco se compara", () => {
		const { attempt, diff } = setup();
		attempt(1, [c("step", "a")]);
		attempt(2, [c("step", "a")], { kind: "build_step" });
		const out = diff({ from: 1, to: 2 });
		assert.ok(!out.ok);
		assert.equal(out.error.type, "InvalidInput");
	});
});

describe("makeAttemptDiff: assets", () => {
	const asset = (name: string, hash: string, bytes = 10): AssetRecord => ({
		name,
		path: `/x/${name}`,
		bytes,
		sha256: hash,
	});

	it("por nombre: aparece, desaparece, cambia de hash o de tamaño, o es igual", () => {
		const { attempt, diff } = setup();
		attempt(1, [c("step", "a")], {
			assets: [asset("igual", "h"), asset("cambia", "h1"), asset("sale", "h")],
		});
		attempt(2, [c("step", "a")], {
			assets: [asset("igual", "h"), asset("cambia", "h2"), asset("entra", "h")],
		});
		const out = diff({ from: 1, to: 2 });
		assert.ok(out.ok);
		assert.deepEqual(
			out.value.assets.map((a) => [a.name, a.state]),
			[
				["cambia", "changed"],
				["entra", "added"],
				["igual", "same"],
				["sale", "removed"],
			],
		);
	});
});

describe("makeAttemptDiff: cabecera", () => {
	it("trae los dos extremos con su número, tipo, objetivo y hora", () => {
		const { attempt, diff } = setup();
		attempt(1, [c("step", "a")]);
		attempt(2, [c("step", "a")]);
		const out = diff({ from: 1, to: 2 });
		assert.ok(out.ok);
		assert.deepEqual(out.value.to, {
			id: 2,
			n: 2,
			kind: "run_script",
			target: "a.js",
			startedAt: "2026-06-01T10:00:00.000Z",
		});
		assert.equal(out.value.from.id, 1);
	});
});
