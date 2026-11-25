# Contributing

Thanks for looking. Figma Control Center does one thing — runs Plugin API
scripts from disk in a Figma tab for Claude Code — and the bar is less "does it
work" and more "does it still read clearly in six months".

## Before you open a pull request

```bash
make check     # typecheck + lint + tests
make e2e       # hermetic E2E, when you touch a tool, a kit step, the dashboard or the agent harness
```

`make e2e` needs Playwright's Chromium once (`make e2e-setup`). Neither command
needs Chrome, a Figma account or a `.env`: Figma and Claude Code are simulated.
See [testing](docs/contributors/testing.md).

Branch off `master`, keep the branch to one theme, write the failing test
first, and let CI go green.

## What gets pushed back

**A tool that receives code or data instead of a path.** Tools take file
paths; the server reads the file. Megabytes never travel through the model's
context — that requirement shapes the whole design.

**Anything written to stdout from the MCP process.** stdout is the MCP
channel. Logs go to stderr.

**An import across a layer boundary.** `domain` imports nothing, `application`
imports `domain`, `adapters` import both, and the composition roots wire them.
ESLint, dependency-cruiser and an architecture test enforce it — see
[architecture](docs/contributors/architecture.md).

**Knowledge of one particular project in the server.** The tool is generic:
projects bring their data through the contracts in `schemas/`.

**Reading `process.env` outside the config adapter**, or a value that depends
on the machine without a default in the schema.

**A new dependency without a problem that already exists.**

**Docs in one language only.** Every page under `docs/` has an `.es.md`
sibling; update both.

## Reporting a bug

The useful report is the failing call — tool, input, `error` and `nextStep` —
plus what you expected. `figma_history_errors` or the dashboard's Activity page
give it to you. Do not paste Figma file URLs or keys, cookies or tokens.

Open an issue at
[github.com/velezanthony/figma-control-center/issues](https://github.com/velezanthony/figma-control-center/issues).

## Where things are

- **[Overview](docs/contributors/index.md)** — where to start
- **[Development](docs/contributors/development.md)** — setup, commands, the two processes
- **[Architecture](docs/contributors/architecture.md)** — layers, folders, why CDP
- **[Extending](docs/contributors/extending.md)** — a new tool, kit step, contract or setting
- **[Testing](docs/contributors/testing.md)** — the suite, the simulator, opt-in tests against real Figma
- **[Conventions](docs/contributors/conventions.md)** — commits, TypeScript, comments
