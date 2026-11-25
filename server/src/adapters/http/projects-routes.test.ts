import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { InMemoryProjectRegistry } from "#application/testing/in-memory-project-registry.ts";
import type { Registry } from "#domain/registry.ts";
import { registryError } from "#domain/registry.ts";
import { err } from "#domain/result.ts";
import { handleProjectsRequest } from "./projects-routes.ts";
import type { ApiRequest } from "./request-guard.ts";

const HOSTS = ["127.0.0.1:4173", "localhost:4173"];
const ENTRY = {
	id: "1",
	name: "Ejemplo",
	projectDir: "/p/ejemplo",
	fileUrl: "https://www.figma.com/design/abc/Ejemplo",
} as const;

function setup(initial: Registry = { entries: [] }) {
	const registry = new InMemoryProjectRegistry(initial);
	const deps = { registry, allowedHosts: HOSTS };
	const req = (over: Partial<ApiRequest> = {}): ApiRequest => ({
		method: "POST",
		pathname: "/api/projects/save",
		params: new URLSearchParams(),
		headers: {
			host: HOSTS[0],
			"content-type": "application/json",
			origin: `http://${HOSTS[0]}`,
		},
		body: "",
		...over,
	});
	const raw = (over: Partial<ApiRequest> = {}) =>
		handleProjectsRequest(deps, req(over));
	const call = async (over: Partial<ApiRequest> = {}) => {
		const r = await raw(over);
		assert.ok(r, "debería ser una ruta de proyectos");
		return r;
	};
	return { registry, raw, call };
}

const typeOf = (body: unknown) =>
	(body as { error?: { type?: string } }).error?.type;

describe("handleProjectsRequest", () => {
	it("una ruta que no es de proyectos no la maneja", async () => {
		assert.equal(await setup().raw({ pathname: "/api/chat/sessions" }), null);
	});

	it("GET /list devuelve solo las filas del registro, sin ningún proyecto del .env ni marca isDefault", async () => {
		const r = await setup({ entries: [ENTRY] }).call({
			method: "GET",
			pathname: "/api/projects/list",
		});
		assert.equal(r.status, 200);
		assert.deepEqual(
			(r.body as { entries: { id: string; name: string }[] }).entries.map(
				(e) => [e.id, e.name],
			),
			[[ENTRY.id, ENTRY.name]],
		);
	});

	it("GET /list sin problemas trae problems vacío", async () => {
		const r = await setup().call({
			method: "GET",
			pathname: "/api/projects/list",
		});
		assert.deepEqual((r.body as { problems: string[] }).problems, []);
	});

	it("GET /list con el registro vacío trae la lista vacía", async () => {
		const r = await setup().call({
			method: "GET",
			pathname: "/api/projects/list",
		});
		assert.deepEqual((r.body as { entries: unknown }).entries, []);
	});

	it("GET /list con el registro roto da la lista vacía y cuenta el problema con la ruta", async () => {
		const { call, registry } = setup();
		registry.readReply = () =>
			err(registryError("unreadable", "no se pudo leer /x/figma.db"));
		const r = await call({ method: "GET", pathname: "/api/projects/list" });
		assert.equal(r.status, 200);
		const body = r.body as { entries: { id: string }[]; problems: string[] };
		assert.deepEqual(body.entries, []);
		assert.deepEqual(body.problems, ["no se pudo leer /x/figma.db"]);
	});

	it("GET /list con filas ignoradas las cuenta en problems", async () => {
		const r = await setup({
			entries: [ENTRY],
			problems: ["proyecto 2 ignorado: URL inválida"],
		}).call({ method: "GET", pathname: "/api/projects/list" });
		assert.deepEqual((r.body as { problems: string[] }).problems, [
			"proyecto 2 ignorado: URL inválida",
		]);
	});

	it("/list solo admite GET", async () => {
		const r = await setup().call({ pathname: "/api/projects/list" });
		assert.equal(r.status, 405);
	});

	it("POST /save guarda una fila nueva y el servidor le da el siguiente número", async () => {
		const { call, registry } = setup();
		const { id: _omit, ...entryNoId } = ENTRY;
		const ids: string[] = [];
		for (const name of ["A", "B"]) {
			const r = await call({
				pathname: "/api/projects/save",
				body: JSON.stringify({
					entry: {
						...entryNoId,
						name,
						fileUrl: `https://www.figma.com/design/${name}/${name}`,
					},
				}),
			});
			assert.equal(r.status, 200);
			ids.push(
				...registry
					.current()
					.entries.map((e) => e.id)
					.slice(-1),
			);
		}
		assert.deepEqual(ids, ["1", "2"]);
	});

	it("borrar un proyecto no libera su número: el alta siguiente no lo reutiliza", async () => {
		const { call, registry } = setup();
		const { id: _omit, ...entryNoId } = ENTRY;
		const register = (name: string) =>
			call({
				pathname: "/api/projects/save",
				body: JSON.stringify({
					entry: {
						...entryNoId,
						name,
						fileUrl: `https://www.figma.com/design/${name}/${name}`,
					},
				}),
			});
		await register("A");
		await register("B");
		await call({
			pathname: "/api/projects/delete",
			body: JSON.stringify({ id: "2" }),
		});
		await register("C");
		assert.deepEqual(
			registry.current().entries.map((e) => e.id),
			["1", "3"],
		);
	});

	it("un alta con id propio se trata como edición: si no existe, 404 y no crea nada", async () => {
		const { call, registry } = setup();
		const r = await call({
			pathname: "/api/projects/save",
			body: JSON.stringify({ entry: { ...ENTRY, id: "7" } }),
		});
		assert.equal(r.status, 404);
		assert.deepEqual(registry.current().entries, []);
	});

	it("/save con raíz de scripts SIN confirmar se rechaza (CA-10)", async () => {
		const { call, registry } = setup();
		const r = await call({
			pathname: "/api/projects/save",
			body: JSON.stringify({ entry: { ...ENTRY, scriptsRoots: ["/s"] } }),
		});
		assert.equal(r.status, 403);
		assert.equal(typeOf(r.body), "ScriptsRootNotConfirmed");
		assert.deepEqual(registry.writes, []);
	});

	it("/save con raíz de scripts confirmada sí guarda", async () => {
		const { call, registry } = setup({ entries: [ENTRY] });
		const r = await call({
			pathname: "/api/projects/save",
			body: JSON.stringify({
				entry: { ...ENTRY, scriptsRoots: ["/s"] },
				confirmScriptsRoots: true,
			}),
		});
		assert.equal(r.status, 200);
		assert.deepEqual(registry.current().entries[0]?.scriptsRoots, ["/s"]);
	});

	it("/save sustituye la fila con el mismo id (upsert)", async () => {
		const { call, registry } = setup({ entries: [ENTRY] });
		await call({
			pathname: "/api/projects/save",
			body: JSON.stringify({ entry: { ...ENTRY, name: "Renombrado" } }),
		});
		const entries = registry.current().entries;
		assert.equal(entries.length, 1);
		assert.equal(entries[0]?.name, "Renombrado");
	});

	for (const [id, why] of [
		["../..", "sale de la carpeta"],
		["a/b", "lleva una barra"],
		["a,b", "lleva una coma"],
		[".oculto", "empieza por punto"],
		["", "vacío"],
		["abc", "no es un número"],
		["0", "el cero no es un id"],
		["01", "ceros a la izquierda"],
		["32768", "pasa el tope"],
		["9bd5548d-835d-47bf-88c8-3e84fb4dd806", "un UUID antiguo"],
		["default", "un nombre"],
	] as const) {
		it(`/save rechaza el id «${id.slice(0, 12)}» (${why}) y no escribe nada`, async () => {
			const { call, registry } = setup({ entries: [ENTRY] });
			const r = await call({
				pathname: "/api/projects/save",
				body: JSON.stringify({ entry: { ...ENTRY, id } }),
			});
			assert.equal(r.status, 400);
			assert.equal(typeOf(r.body), "BadRequest");
			assert.deepEqual(registry.writes, []);
		});
	}

	it("/save de un id que no existe (edición de un proyecto inventado) se rechaza y no crea una fila", async () => {
		const { call, registry } = setup({ entries: [ENTRY] });
		const r = await call({
			pathname: "/api/projects/save",
			body: JSON.stringify({ entry: { ...ENTRY, id: "99" } }),
		});
		assert.equal(r.status, 404);
		assert.equal(typeOf(r.body), "NotFound");
		assert.deepEqual(
			registry.current().entries.map((e) => e.id),
			["1"],
		);
	});

	it("POST /delete quita la fila por id", async () => {
		const { call, registry } = setup({ entries: [ENTRY] });
		const r = await call({
			pathname: "/api/projects/delete",
			body: JSON.stringify({ id: "1" }),
		});
		assert.equal(r.status, 200);
		assert.deepEqual(registry.current().entries, []);
	});

	it("una escritura de otro Host, cross-site o sin JSON se rechaza", async () => {
		const { call, registry } = setup();
		const cases: [Record<string, string | undefined>, number][] = [
			[{ host: "malo.example:4173" }, 403],
			[{ "sec-fetch-site": "cross-site" }, 403],
			[{ "content-type": "text/plain" }, 415],
		];
		for (const [extra, status] of cases) {
			const r = await call({
				pathname: "/api/projects/save",
				body: JSON.stringify({ entry: ENTRY }),
				headers: {
					host: HOSTS[0],
					"content-type": "application/json",
					origin: `http://${HOSTS[0]}`,
					...extra,
				},
			});
			assert.equal(r.status, status, JSON.stringify(extra));
		}
		assert.deepEqual(registry.writes, []);
	});

	it("un cuerpo que no es JSON, una clave desconocida o una fileUrl con query dan 400", async () => {
		const { call } = setup();
		const bodies = [
			"no-es-json",
			JSON.stringify({ entry: { ...ENTRY, foo: 1 } }),
			JSON.stringify({ entry: { ...ENTRY, fileUrl: `${ENTRY.fileUrl}?x=1` } }),
		];
		for (const body of bodies) {
			const r = await call({ pathname: "/api/projects/save", body });
			assert.equal(r.status, 400, body);
		}
	});

	it("una fileUrl que no es un archivo de Figma da 400", async () => {
		const { call, registry } = setup();
		const r = await call({
			pathname: "/api/projects/save",
			body: JSON.stringify({
				entry: { ...ENTRY, fileUrl: "https://example.com/design/abc/Ejemplo" },
			}),
		});
		assert.equal(r.status, 400);
		assert.deepEqual(registry.writes, []);
	});

	it("si el registro no se puede escribir, responde 500", async () => {
		const { call, registry } = setup();
		registry.writeReply = () =>
			err(registryError("unreadable", "no se pudo escribir"));
		const r = await call({
			pathname: "/api/projects/save",
			body: JSON.stringify({ entry: ENTRY }),
		});
		assert.equal(r.status, 500);
	});

	it("otra ruta bajo /api/projects/ es 404", async () => {
		const r = await setup().call({ pathname: "/api/projects/otra" });
		assert.equal(r.status, 404);
	});

	describe("escrituras", () => {
		const save = (entry: Record<string, unknown>) => ({
			body: JSON.stringify({ entry }),
		});
		const NEW = {
			name: "Otro",
			projectDir: "/p/otro",
			fileUrl: "https://www.figma.com/design/otro/Otro",
		};

		it("dos altas a la vez conservan las dos filas", async () => {
			const { registry, call } = setup();
			const [a, b] = await Promise.all([
				call(
					save({
						...NEW,
						name: "A",
						fileUrl: "https://www.figma.com/design/aaa/A",
					}),
				),
				call(
					save({
						...NEW,
						name: "B",
						fileUrl: "https://www.figma.com/design/bbb/B",
					}),
				),
			]);
			assert.equal(a.status, 200);
			assert.equal(b.status, 200);
			const read = await registry.read();
			assert.ok(read.ok);
			assert.deepEqual(read.value.entries.map((e) => e.name).sort(), [
				"A",
				"B",
			]);
		});

		it("rechaza una URL sin clave de archivo", async () => {
			const { call } = setup();
			const r = await call(
				save({ ...NEW, fileUrl: "https://www.figma.com/design/" }),
			);
			assert.equal(r.status, 400);
		});

		it("rechaza una fila con la misma URL de Figma que otra", async () => {
			const { call } = setup({ entries: [ENTRY] });
			const r = await call(save({ ...NEW, fileUrl: ENTRY.fileUrl }));
			assert.equal(r.status, 409);
			assert.equal(typeOf(r.body), "Duplicate");
			assert.match(JSON.stringify(r.body), /Ejemplo/);
		});

		it("rechaza el mismo archivo escrito de otra forma (/file/ en vez de /design/, sin nombre)", async () => {
			const { call } = setup({ entries: [ENTRY] });
			for (const fileUrl of [
				"https://www.figma.com/file/abc/Ejemplo",
				"https://www.figma.com/design/abc",
			]) {
				const r = await call(save({ ...NEW, fileUrl }));
				assert.equal(r.status, 409, fileUrl);
			}
		});

		it("la Base SQLite por proyecto ya no existe: un dbPath en la fila da 400 y no escribe nada", async () => {
			const { call, registry } = setup();
			const r = await call(save({ ...NEW, dbPath: "/otra/h.db" }));
			assert.equal(r.status, 400);
			assert.deepEqual(registry.writes, []);
		});

		it("rechaza el mismo outputDir", async () => {
			const { call } = setup({ entries: [ENTRY] });
			const r = await call(save({ ...NEW, outputDir: "/salida/1" }));
			assert.equal(r.status, 409);
			assert.match(JSON.stringify(r.body), /outputDir/);
		});

		it("editar una fila sin cambiar sus valores no choca consigo misma", async () => {
			const { call } = setup({ entries: [ENTRY] });
			const r = await call(save({ ...ENTRY, name: "Ejemplo 2" }));
			assert.equal(r.status, 200);
		});
	});
});
