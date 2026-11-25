---
seo:
  title: "Contributor guide: Figma MCP server"
  description: "Contributor guide for Figma Control Center: development setup, hexagonal architecture, extending tools and contracts, testing and conventions."
---

# For contributors

Figma Control Center is an MCP server that lets Claude Code read and modify a Figma file by running
scripts against the plugin API. The server reads each script from disk and sends it to a figma.com
tab over the Chrome DevTools Protocol, so the large payloads never pass through the model's
context. Around it sit an activity dashboard, a SQLite history, a Figma kit that runs inside the
tab, and a capture kit that reads the project's own web.

Start here:

- **[Development](development.md)** — setup, the processes you run, the commands, where to start
  reading
- **[Architecture](architecture.md)** — why CDP, the hexagonal layers, the folder map and how the
  boundaries are enforced
- **[Extending](extending.md)** — adding an MCP tool, a kit step, a contract, a setting or a
  migration
- **[Testing](testing.md)** — `make check`, the Figma simulator, hermetic E2E and the opt-in runs
  against real Figma
- **[Conventions](conventions.md)** — commits, TypeScript, comments, and the rules that hold
  something up rather than being style

## The short version

- **Tools receive file paths, not code.** The server reads the script from disk. A tool that makes
  the model paste megabytes into its arguments defeats the reason the project exists.
- **Never write to stdout in the MCP process.** stdout *is* the MCP channel; one stray `console.log`
  corrupts the protocol. Logs go to stderr.
- **Respect the layers.** `domain` imports nothing, `application` imports `domain`, `adapters`
  import both, and only the composition roots call `new`. ESLint, dependency-cruiser and
  `architecture.test.ts` fail the build otherwise — they are the rule, not a suggestion.
