import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import { startFakeCdp } from "#adapters/cdp/testing/fake-cdp-server.ts";
import { openTestingTab, TestingTabNotOpen } from "../contract/raw-cdp.ts";
import { EvaluateResponseSchema } from "../contracts/cdp.ts";
import { LOOPBACK, testEnv } from "./env.ts";

const RECORD = join(import.meta.dirname, "../contract/record.ts");
const TESTING_FILE_KEY = "ABC123";
const TESTING_URL = `https://www.figma.com/design/${TESTING_FILE_KEY}/pruebas`;
const REFUSED_EXIT = 2;

const fakes: Array<{ close(): Promise<void> }> = [];
afterEach(async () => {
	for (const f of fakes.splice(0)) await f.close();
});

describe("sesión CDP sin interpretar", () => {
	it("se conecta a la pestaña del archivo de pruebas por su fileKey y devuelve el mensaje de Chrome tal cual", async () => {
		const fake = await startFakeCdp({
			tabUrl: `${TESTING_URL}?node-id=0-1`,
			respond: () => ({ kind: "value", value: "object" }),
		});
		fakes.push(fake);
		const session = await openTestingTab({
			host: LOOPBACK,
			port: fake.port,
			testFileUrl: TESTING_URL,
		});
		const message = await session.evaluate("typeof figma", 1000);
		session.close();
		assert.equal(EvaluateResponseSchema.safeParse(message).success, true);
	});

	it("se conecta también a la pestaña redirigida a /login del archivo de pruebas (sin sesión)", async () => {
		const redirect = encodeURIComponent(`/design/${TESTING_FILE_KEY}/pruebas`);
		const fake = await startFakeCdp({
			tabUrl: `https://www.figma.com/login?redirect_uri=${redirect}`,
			respond: () => ({ kind: "value", value: "undefined" }),
		});
		fakes.push(fake);
		const session = await openTestingTab({
			host: LOOPBACK,
			port: fake.port,
			testFileUrl: TESTING_URL,
		});
		session.close();
	});

	it("no se conecta a un /login que vuelve a otro archivo", async () => {
		const redirect = encodeURIComponent("/design/OTRO/trabajo");
		const fake = await startFakeCdp({
			tabUrl: `https://www.figma.com/login?redirect_uri=${redirect}`,
		});
		fakes.push(fake);
		await assert.rejects(
			openTestingTab({
				host: LOOPBACK,
				port: fake.port,
				testFileUrl: TESTING_URL,
			}),
			TestingTabNotOpen,
		);
	});

	it("no se conecta a la pestaña de otro archivo (CA-8)", async () => {
		const fake = await startFakeCdp({
			tabUrl: "https://www.figma.com/design/OTRO/Trabajo",
		});
		fakes.push(fake);
		await assert.rejects(
			openTestingTab({
				host: LOOPBACK,
				port: fake.port,
				testFileUrl: TESTING_URL,
			}),
			TestingTabNotOpen,
		);
	});
});

describe("make e2e-record", () => {
	const run = async (testFileUrl?: string) => {
		const dir = await mkdtemp(join(tmpdir(), "figma-record-"));
		try {
			const env = testEnv({
				dir,
				cdpPort: 1,
				scriptsRoot: dir,
				dashboardPort: 1,
				agentTerminal: "x --",
				...(testFileUrl === undefined
					? {}
					: { extra: { FIGMA_TEST_FILE_URL: testFileUrl } }),
			});
			return spawnSync(process.execPath, [RECORD], {
				env: { PATH: process.env["PATH"] ?? "", ...env },
				encoding: "utf8",
			});
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	};

	it("se niega a ejecutarse sin FIGMA_TEST_FILE_URL (CA-8)", async () => {
		const r = await run();
		assert.equal(r.status, REFUSED_EXIT);
		assert.match(r.stderr, /FIGMA_TEST_FILE_URL/);
	});
});
