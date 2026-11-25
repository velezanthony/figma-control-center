import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { CancelPanel } from "#application/ports/cancel-requests.ts";
import type { CancelState } from "#domain/cancel-request.ts";
import { err, ok } from "#domain/result.ts";
import { handleCancelRequest } from "./cancel-routes.ts";
import type { ApiRequest } from "./request-guard.ts";

const HOSTS = ["127.0.0.1:4173"];
const PATH = "/api/jobs/cancel";

function setup(states: Record<string, CancelState> = {}) {
	const asked: string[] = [];
	const panel: CancelPanel = {
		stateOf: (jobId) => states[jobId] ?? null,
		request: (jobId) => {
			const state = states[jobId];
			if (state === undefined)
				return err({ type: "NoSuchJob", message: "no existe" });
			if (state !== "available")
				return err({ type: "NotCancellable", state, message: "no" });
			asked.push(jobId);
			return ok({ id: 1, jobId, sessionId: "s1" });
		},
	};
	const call = (over: Partial<ApiRequest>) => {
		const r = handleCancelRequest(
			{ panel, allowedHosts: HOSTS },
			{
				method: "GET",
				pathname: PATH,
				params: new URLSearchParams(),
				headers: { host: HOSTS[0] },
				body: "",
				...over,
			},
		);
		assert.ok(r);
		return r;
	};
	const post = (body: unknown, headers: Record<string, string> = {}) =>
		call({
			method: "POST",
			headers: {
				host: HOSTS[0],
				"content-type": "application/json",
				origin: `http://${HOSTS[0]}`,
				...headers,
			},
			body: JSON.stringify(body),
		});
	return { asked, call, post };
}

describe("handleCancelRequest", () => {
	it("otra ruta no la maneja", () => {
		const r = handleCancelRequest(
			{
				panel: {
					stateOf: () => null,
					request: () => err({ type: "NoSuchJob", message: "" }),
				},
				allowedHosts: HOSTS,
			},
			{
				method: "GET",
				pathname: "/api/x",
				params: new URLSearchParams(),
				headers: {},
				body: "",
			},
		);
		assert.equal(r, null);
	});

	it("GET dice el estado de un job; sin job, 400; job desconocido, 404", () => {
		const { call } = setup({ "job-1": "sessionGone" });
		const ok_ = call({ params: new URLSearchParams("job=job-1") });
		assert.equal(ok_.status, 200);
		assert.deepEqual(ok_.body, {
			ok: true,
			jobId: "job-1",
			state: "sessionGone",
		});
		assert.equal(call({}).status, 400);
		assert.equal(call({ params: new URLSearchParams("job=nada") }).status, 404);
	});

	it("POST deja la petición de un lote que se puede cancelar", () => {
		const { post, asked } = setup({ "job-1": "available" });
		const r = post({ jobId: "job-1" });
		assert.equal(r.status, 200);
		assert.deepEqual(asked, ["job-1"]);
	});

	it("POST sobre un job que no se puede cancelar es 409 con el motivo", () => {
		const { post, asked } = setup({ "job-1": "requested" });
		const r = post({ jobId: "job-1" });
		assert.equal(r.status, 409);
		assert.deepEqual(r.body, {
			ok: false,
			error: { type: "NotCancellable", message: "no", state: "requested" },
		});
		assert.deepEqual(asked, []);
	});

	it("POST con otro Host, otro origen o un cuerpo inválido no llega a pedir nada", () => {
		const { post, call, asked } = setup({ "job-1": "available" });
		assert.equal(
			post({ jobId: "job-1" }, { host: "evil.example" }).status,
			403,
		);
		assert.equal(
			post({ jobId: "job-1" }, { origin: "http://evil.example" }).status,
			403,
		);
		assert.equal(post({ nope: 1 }).status, 400);
		assert.equal(
			call({ method: "POST", headers: { host: HOSTS[0] }, body: "{}" }).status,
			415,
		);
		assert.deepEqual(asked, []);
	});
});
