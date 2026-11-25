---
seo:
  title: "Conventions: TypeScript and commits"
  description: "Conventions for contributing to Figma Control Center: commits, language rules, strict TypeScript, the MCP process, comments, formatting and docs."
---

# Conventions

## Commits

[Conventional Commits](https://www.conventionalcommits.org/), with the **description and body in English**:

```text
feat(kit): add the kit/links@1 step
fix(cdp): retry the connection when the tab reloads
```

State the change and its consequence; that is what someone needs when `git blame` lands them on a
line they do not understand. No AI attribution or co-author trailers. One theme per commit, and
`make check` green before it.

## Language

- **File and folder names in English**, test fixtures included.
- **Code in English**: variables, functions, types, classes, constants, internal object keys, npm
  scripts and Makefile targets.
- **Comments and docstrings in Spanish.** Test titles (`describe`, `it`) count as documentation and
  are in Spanish too.
- **Public contracts keep their names**: fields of the published schemas and of the project files,
  MCP tool and prompt names and their parameters, warning and error codes, `fcc:` keys stored in
  Figma, and environment variables. Renaming one breaks existing setups, so it is a decision of its
  own, never a side effect of this rule. The same goes for texts the user reads (errors, the
  dashboard, tool descriptions).
- Test data that stands for a user's content — Figma layer and property names, screen keys, token
  names, page URLs of a test site — is data, not code, and can be in any language.

## Tests first

Every feature, use case, tool and bug fix starts with a failing test. The loop and where each test
goes are in [testing](testing.md).

## TypeScript

- Strict: `@tsconfig/strictest` plus `erasableSyntaxOnly`. Node runs the sources directly, so
  nothing that needs a transform: **no `enum`, no `namespace`**. Use `as const` objects and unions.
- **Expected errors are values** (`Result`), not exceptions. Exceptions are for bugs.
- **zod only at the edges** — tool input, files from disk, HTTP bodies, CDP replies. Inside, the
  types are already trusted.
- Imports between layers through the `#domain/…`, `#application/…`, `#adapters/…` aliases, never
  `../../`.

## No magic values

Anything that depends on the machine or the use — ports, hosts, paths, timeouts — has a **default**
in the configuration schema, and the environment only overrides it. Configuration is read in one
place, `server/src/adapters/config/env.ts`; nothing else touches `process.env`. Fixed values of the
program are `as const` constants in their adapter's module. How to add one: [extending](extending.md).

## The MCP process

- **Never write to stdout.** It is the MCP channel. Logs go to stderr.
- **Tools receive paths.** Scripts, manifests and project files are read from disk by the server;
  the model passes a path. `code` exists for short snippets only.
- **Tools are named `figma_*`**, validate their input with zod, answer
  `{ ok, …, error, retryable }`, and every write returns the ids it touched. An error carries a
  `nextStep` that tells the caller what to change.

## Dependencies

No new dependency without a problem that already exists. There is no web framework in the server:
the MCP side is a stdio process and the dashboard's HTTP server is small on purpose. Native modules
do not get their install scripts approved.

## Comments

Keep the ones that say something the code cannot: a counter-intuitive choice someone would otherwise
"fix", an ordering that *is* the bug, where a responsibility deliberately lives. Everything else goes
— file-header narratives, docstrings restating a name, and references to planning documents. The
story of how a line came to be belongs in the commit message.

## Formatting and lint

Biome formats (tabs, double quotes) and lints; `make format` applies it. ESLint does no styling —
only boundaries and promises. Markdown is not auto-formatted.

## Documentation

- User-facing behaviour changes update `docs/users/`, contributor-facing ones `docs/contributors/`,
  in the **same change**.
- **Both languages**: every `.md` has its `.es.md` sibling and they say the same thing. English is
  the primary one.
- Write what does not rot: where something lives, the rule, what breaks it. No counts, no dates, no
  history of how things used to be.
- The site is built from `docs/` by `docs-site/` (an Astro project with the
  [Design](https://github.com/velezanthony/design) library). Preview it with
  `npm install --prefix docs-site` and `npm run dev --prefix docs-site`; its build fails on a broken
  link or anchor and warns on a code block without a language.
