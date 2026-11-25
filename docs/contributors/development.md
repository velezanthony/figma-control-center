---
seo:
  title: "Development setup: make and npm"
  description: "Set up Figma Control Center for development: the processes and entry points, the make and npm commands, and where to start reading the code."
---

# Development

## Setup

```bash
make install      # npm ci
make e2e-setup    # once: Playwright's own Chromium, for the hermetic E2E
make check        # should be green before you change anything
```

Requires Node **24** or newer. Node runs the `.ts` files directly — there is no compile step for
the server. `better-sqlite3` ships prebuilt binaries; its implicit install script is **not**
approved (`allowScripts` is `false`) and is not needed.

> [!NOTE]
> Nothing in the test suite needs Chrome, Figma or a Claude Code session. Those only come in when
> you run the tool for real — see the [user guide](../users/installation.md).

## The processes

There are three entry points, and each is a composition root: the only place in its process that
wires concrete adapters together.

| Process | Entry point | What it is |
|---|---|---|
| MCP server | [`server/src/main.ts`](https://github.com/velezanthony/figma-control-center/blob/main/server/src/main.ts) | Started by Claude Code over **stdio** from `.mcp.json`. Talks CDP to the Figma tab |
| Dashboard | [`server/src/dashboard.ts`](https://github.com/velezanthony/figma-control-center/blob/main/server/src/dashboard.ts) | Local HTTP server for the panel in `web/`. Reads the same SQLite database. May write to stdout |
| Agent launcher | [`server/src/agent-run.ts`](https://github.com/velezanthony/figma-control-center/blob/main/server/src/agent-run.ts) | What `make agent PROJECT=<id>` runs: starts `claude` with the per-project harness and cleans up after it |

> [!NOTE]
> The MCP server and the dashboard never import each other's adapters. That split is why the
> dashboard survives a Claude Code restart, and why the MCP process cannot load code that prints to
> stdout.

## Working on each part

- **Server** — `make test-watch` and the TDD loop in [testing](testing.md).
- **Dashboard UI** — `make dashboard` in one terminal, `make dev-web` in another: Vite with hot
  reload, proxying `/api`, `/events` and `/screenshots` to the running panel. `make test-watch-web`
  runs the Vitest side. Set `FCC_DASHBOARD_MODE=development` in `.env` to get the component gallery
  (`#/components`).
- **Kits** (`kits/capture/`, `kits/figma/`) — they run inside a browser page and are bundled to
  `kits/dist/`. After touching them, `npm run build:kit`: a test rebuilds the bundle in memory and
  fails if the committed file does not match the sources.
- **Contracts** — after changing a zod schema in `server/src/adapters/contracts/`, `npm run schemas`
  regenerates the published JSON Schema in `schemas/`. A test compares both.
- **Database** — after changing `server/src/adapters/sqlite/schema.ts`, `npm run db:generate`
  writes the Drizzle migration.
- **Trying a tool by hand** — `make tools` lists the tools through the MCP Inspector CLI;
  `make inspector` opens the Inspector UI against `server/src/main.ts`.

## The commands

`make help` lists every target. The ones you will use:

| | |
|---|---|
| `make check` | typecheck + lint + test — run it before every commit |
| `make verify` | `make check` + every hermetic E2E |
| `make typecheck` | `tsc` for server, domain, kits and web tooling, plus `svelte-check` |
| `make lint` | Biome, ESLint (boundaries and promises) and dependency-cruiser, without modifying files |
| `make format` | Biome with its safe fixes applied |
| `make test` | `server/` with `node:test`, then `web/` with Vitest |
| `make test-watch` · `make test-watch-web` | The same, re-running on save |
| `make coverage` | Tests with coverage |
| `make e2e-setup` · `make e2e` | Playwright's Chromium, once · the hermetic E2E |
| `make e2e-record` · `make e2e-contract` · `make kit-contract` | Opt-in, against the real Figma test file — see [testing](testing.md#against-real-figma) |
| `make dashboard` · `make build-web` · `make dev-web` | Build and serve the panel · build only · Vite dev server |
| `make inspector` · `make tools` · `make mcp` | MCP Inspector UI · tool list · how Claude Code sees the server |
| `make chrome` · `make chrome-stop` · `make login` · `make probe` | The debugging Chrome and a quick read/write probe against Figma |
| `npm run build:kit` | Re-bundle `kits/dist/` |
| `npm run schemas` | Regenerate `schemas/` from zod |
| `npm run db:generate` | Drizzle migration after a schema change |

## Where to start reading

[`server/src/main.ts`](https://github.com/velezanthony/figma-control-center/blob/main/server/src/main.ts)
is wiring and nothing else, split across the `server/src/compose-*.ts` helpers it calls:
[`compose-tenant.ts`](https://github.com/velezanthony/figma-control-center/blob/main/server/src/compose-tenant.ts)
builds a project's data plane (CDP gateway, file-system adapters, database) and
[`compose-session.ts`](https://github.com/velezanthony/figma-control-center/blob/main/server/src/compose-session.ts)
mounts the session on top.

Then follow one tool:
[`adapters/mcp/tools.ts`](https://github.com/velezanthony/figma-control-center/blob/main/server/src/adapters/mcp/tools.ts)
registers `figma_run_script`, which calls
[`application/run-script.ts`](https://github.com/velezanthony/figma-control-center/blob/main/server/src/application/run-script.ts),
which talks to the `FigmaGateway` port implemented in
[`adapters/cdp/`](https://github.com/velezanthony/figma-control-center/tree/main/server/src/adapters/cdp).
That path — adapter, use case, port, adapter — is the shape of every feature.
[Architecture](architecture.md) has the map.
