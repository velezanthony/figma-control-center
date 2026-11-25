---
seo:
  title: "Testing with fakes and hermetic E2E"
  description: "How Figma Control Center is tested: unit and integration tests, fakes over mocks, a simulated Figma and Claude, hermetic E2E and opt-in real Figma runs."
---

# Testing

```bash
make check     # typecheck + lint + test — before every commit
make verify    # make check + every hermetic E2E
```

`make test` runs two runners, one after the other, split by directory: `node:test` for `server/`
(the same runtime that runs production) and Vitest for `web/` (with the Vite configuration that
builds the dashboard). Neither needs Chrome, Figma or a network.

## Kinds of test

| Kind | Suffix and place | What it uses |
|---|---|---|
| Unit | `*.test.ts`, next to its code | Pure functions, or a use case with in-memory doubles of its ports (`server/src/application/testing/`) |
| Integration | `*.int.test.ts`, next to its code | A fake Chrome speaking CDP, a temporary directory, an in-memory MCP client and server, a temporary SQLite database |
| Architecture | `server/test/architecture.test.ts`, `server/test/lint-rules.test.ts` | The source tree itself — see [architecture](architecture.md#how-the-boundaries-are-enforced) |
| Contracts | `server/test/contracts/` | zod schemas of every boundary and examples built from them |
| Web | `web/test/` | Svelte components mounted in `happy-dom` with `@testing-library/svelte`: attributes, roles, text, clicks. Also colour rules, contrast, and that the gallery covers every component |
| Hermetic E2E | `server/test/e2e/`, `server/test/kits/` | Real processes against the Figma simulator and a fake Claude |
| Against real Figma | `server/test/contract/` | Opt-in, the test file only |

> [!NOTE]
> There are no screenshot tests. What looks wrong is fixed when it is seen; the component gallery
> (`/#/components` in the dashboard, with `FCC_DASHBOARD_MODE=development`) is there for looking.

## Doubles: fakes, not mocks

A double implements the whole port in memory, with a programmable reply per method and a log of
the calls it received. Each test file has a `setup()` that builds the subject with its doubles and
takes overrides, so a test only states what it cares about. Doubles live in a `testing/` folder of
their layer, and production code never imports them — ESLint enforces it.

To control *when* something resolves (soft deadlines, running jobs), use a deferred promise rather
than a real wait. Use mocked timers only when the code reads the clock and there is no other way.

## The harness: a simulated Figma and a simulated Claude

`server/test/harness/` is what lets the whole system run in CI without Figma or Claude Code:

- **`figma-simulator.ts`** answers CDP like a Figma tab would, validated against the contracts in
  `server/test/contracts/`. Every example it serves is *built* from a contract, never copied from a
  real response.
- **`kit-step-reply.ts`** recognises the fixed code of a kit step and answers a `step@1` result
  derived from its parameters, so build scenarios can check reports without running the kit.
- **`fake-claude.ts`** and **`fake-claude-bin.ts`** stand in for Claude Code. The fake `claude` is
  put first on the `PATH` and in `FCC_CLAUDE_BIN`.
- **`example-mini.ts`** and `server/test/fixtures/projects/example-mini/` are a small consumer
  project — screens, areas, map, sheets, compose files and a tiny web — used across the scenarios.

> [!IMPORTANT]
> **No test ever starts a real Claude Code.** The harness sets `FCC_TEST_HARNESS`, and with it
> `agent-run.ts` refuses to start any `claude` other than the fake one.

## Hermetic E2E

```bash
make e2e-setup   # once: Playwright's own Chromium — never your Chrome
make e2e         # builds the web, then the three suites below
```

- **Server scenarios** (`server/test/e2e/scenarios/`): real `main.ts` and `dashboard.ts` processes,
  real SQLite, the simulator in place of Figma and the fake Claude in place of Claude Code. The same
  run covers the capture Chrome (`server/test/e2e/web/`) against a minimal local web, with
  Playwright's Chromium as `FCC_WEB_CHROME_BIN`; it needs a browser, so it is not part of
  `make check`.
- **Kits** (`server/test/kits/`): the capture kit run on example pages in Playwright's Chromium.
- **Browser** (`server/test/e2e/browser/`, Playwright): the dashboard's behaviour only — flows, focus,
  scrolling, accessibility.

## Against real Figma

Some things cannot be simulated honestly: what breaks a slot, what a cloned variant loses, what the
editor returns in each tab state. A double that imitated the plugin API would pass in the test and
fail in Figma. Those are checked against a **test file** you own, and only that file:

| Command | What it does |
|---|---|
| `make e2e-record` | Saves real responses from the test file to `output/contract-samples/`, for investigating a contract. `STATE=<state>` records only the tab state |
| `make e2e-contract` | Validates real responses from the test file against the same contracts the simulator uses |
| `make kit-contract` | Runs the Figma kit's pieces against real Figma. Creates and deletes its own page, `fcc:kit-test` |

> [!WARNING]
> They are opt-in: they need `FIGMA_TEST_FILE_URL` set to the test file and its tab open in the
> debugging Chrome (`make chrome`), and they refuse any other file. `make e2e-contract` and
> `make kit-contract` set `FCC_E2E=1` for you. Never point them at a file whose contents matter.

## The TDD loop

```bash
make test-watch        # server/, re-runs on save
make test-watch-web    # web/
node --test server/src/application/run-script.test.ts               # one file
node --test --test-name-pattern="<text>" "server/src/**/*.test.ts"  # one behaviour
```

1. **Red.** One test for the next behaviour. Watch it fail for the right reason — a failed
   assertion, not a broken import. A test you never saw fail proves nothing.
2. **Green.** The least code that passes. Do not anticipate the next case.
3. **Refactor.** With everything green. If a refactor forces a test to change, the test was checking
   the implementation.

Rules that follow from it:

- **One behaviour per test**, named as a sentence about what is observed.
- **Test through the entry point** — the use case, the MCP tool, the adapter's public method — and
  check what is observable: the result and the calls to the ports.
- **A bug is a red test first.** It is fixed when that test passes.
- **Deterministic.** No real waits, no system clock, no external network, no order between tests.

Natural order for a feature: domain → use case with doubles → adapter (integration) → MCP tool
(integration) → hermetic E2E if it crosses processes.

## Coverage

`make coverage` runs both runners with coverage. It is reported, not gated.
