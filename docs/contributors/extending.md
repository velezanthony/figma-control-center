---
seo:
  title: "Add MCP tools and contracts"
  description: "How to add an MCP tool, a Figma kit step, a contract, a configuration variable or a database migration to Figma Control Center, test first."
---

# Extending

Every change below starts the same way: a failing test. See [testing](testing.md) for where it goes.
Before adding anything, read the closest existing example end to end — the repository already has
one of each, and a parallel pattern rots the first time someone changes the original.

## Adding an MCP tool

1. **Name it** in `TOOL_NAME` in
   [`server/src/domain/tool-names.ts`](https://github.com/velezanthony/figma-control-center/blob/main/server/src/domain/tool-names.ts).
   Names are `figma_*`. The history classifies calls by these names, so they are domain vocabulary,
   not an adapter detail. If the tool modifies the Figma file, add it to `WRITE_TOOLS` in the same
   file.
2. **Write the use case** in `server/src/application/`, against ports, with its test next to it.
   A new port gets an in-memory double in `application/testing/` before it gets a real adapter.
3. **Register it** in the `register*` function of `server/src/adapters/mcp/` that matches its
   family (`tools.ts`, `read-tools.ts`, `build-tools.ts`, `capture-tools.ts`, `history-tools.ts`);
   `createMcpServer` in `server.ts` calls them. Each registration declares:
   - an input schema in zod — the tool's only validation, at the edge;
   - an output schema, with the common envelope `{ ok, …, error, retryable }`. Every write returns
     the ids of the nodes it touched;
   - annotations — `readOnlyHint: true` for anything that does not write.
4. **Wrap the handler in `track(recorder, TOOL_NAME.x, args, …)`** so the call reaches the activity
   log and the history. Build the reply with the helpers in `presenters.ts` (`reply`, `usageError`).
5. **Decide what the agent harness does with it.** `server/src/domain/agent-harness.ts` lists which
   tools the dashboard chat agent may call without asking (`MCP_READS`); one that changes Figma or
   captures the web goes in `CHAT_AGENT_DENIED_TOOLS` (`server/src/domain/tool-names.ts`), which its
   settings, its guard and the server refuse.
   The exact generated configuration is pinned by a fixture in `server/test/fixtures/agent-harness/`;
   update it in the same change.
6. **Test it through MCP** with an in-memory client and server: see
   `server/src/adapters/mcp/tools.int.test.ts`.
7. **Document it** in the [tools reference](../users/tools.md), in both languages.

## Adding a kit step

A kit step is a `{ use: "kit/<name>@1", … }` entry in a build manifest: fixed code the server
sends to the tab, which calls a piece of the Figma kit with parameters the server assembles from the
consumer project's files.

1. **The piece** goes in `kits/figma/steps/<name>.ts` and is exported from `steps` in
   `kits/figma/steps/index.ts`. It returns a `step@1` result: the ids it created, mutated or removed,
   plus warnings and a report.
2. **The name** goes into the step lists and the name-to-piece map in
   [`server/src/domain/step.ts`](https://github.com/velezanthony/figma-control-center/blob/main/server/src/domain/step.ts),
   which also builds the fixed code (`kitStepCode`).
3. **The manifest contract** in `server/src/adapters/contracts/build-manifest.ts` accepts the new
   `use` and its fields. Then `npm run schemas`.
4. **Resolving the parameters** — from the loaded project, without reading disk — lives in
   `server/src/application/kit-step.ts` (and its `*-plan.ts` siblings for screens, sheets and
   compose).
5. **The simulator.** Hermetic tests never run the kit in Figma: `server/test/harness/kit-step-reply.ts`
   recognises a step's fixed code and answers a `step@1` result built from its parameters. Teach it
   the new step so E2E scenarios can exercise it.
6. **Pure tests** of the piece run against a fake Figma in `server/test/kits/figma/pure/`.
7. **Re-bundle** with `npm run build:kit`; the bundle test fails otherwise.
8. If the behaviour depends on what real Figma does, add a case to `make kit-contract`
   (`server/test/contract/figma-kit.e2e.test.ts`).

## Adding or changing a contract

1. Change the zod schema in `server/src/adapters/contracts/`. A contract is versioned (`@1`): an
   incompatible change is a new version, not an edit.
2. `npm run schemas` regenerates `schemas/<name>.v<n>.json`. The schema's test compares the
   committed file with `z.toJSONSchema` and tells you to regenerate when they differ.
3. The example in `server/test/contracts/` is **built** from the schema and validated as it is
   built — never pasted from a real output. Update it and its cases in `contracts.test.ts`.
4. Each contract cites its public source in a `*_CONTRACT_SOURCES` list; keep it pointing at the
   [contracts reference](../users/contracts.md), and update that page in both languages.

## Adding a configuration variable

Configuration has one reader: `server/src/adapters/config/env.ts`. Everything else receives the
parsed configuration. A new variable goes, in the same change, into:

1. **The schema** in `server/src/adapters/config/schema.ts`, with its `.default(...)` unless it is
   truly mandatory. Watch Zod 4: `.default()` takes the *output* value and skips the `transform`, so a
   default path is passed already resolved with `toAbsolute(...)` and a list as its array.
2. **Exactly one class**: `EDITABLE_KEYS` (changeable from the dashboard's settings page) with its
   entry in `SETTING_INFO` — group, name, help, unit and who uses it, which the page renders without
   touching the web — or `BOOT_KEYS` (fixed at startup). A test fails if a key is left unclassified.
3. **`.env.example`**, as documentation of the override.
4. **Shell scripts** under `spikes/` read the environment, not the schema: if one needs the variable,
   repeat its default with `${VAR:-…}`.

> [!NOTE]
> Fixed values of the program — protocol method names, thresholds — are not configuration. They are
> `as const` constants in their adapter's module.

## Changing the database

1. Change `server/src/adapters/sqlite/schema.ts` and run `npm run db:generate`; the Drizzle
   migration lands in `server/src/adapters/sqlite/migrations/`.
2. A table with project data gets `project_id` (foreign key, `ON DELETE CASCADE`, first in its
   indexes), is read through a scoped repository, and is added to the project-table list in
   `server/test/architecture.test.ts` — which fails if the schema and that list disagree.
3. Drizzle knows nothing about FTS5. Full-text tables and their triggers go in a hand-written SQL
   migration, like `0002_fts.sql`, with `--> statement-breakpoint` between statements.
