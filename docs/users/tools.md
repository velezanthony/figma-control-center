---
seo:
  title: "Figma MCP tools: reference"
  description: "Reference for the Figma Control Center MCP tools: the response envelope, jobs, scripts and batches, catalog reads, web capture and the history."
---

# Tools

Every tool is named `figma_*`, validates its input with zod, and declares MCP annotations
(`readOnlyHint`, `destructiveHint`…) so a client can tell reads from writes. Each tool's full input
and output schema is visible in `/mcp` or with `make tools` (MCP Inspector, CLI mode).

## The response envelope

The Figma tools answer with the same shape:

```json
{ "ok": true, "result": {}, "error": null, "touchedNodeIds": ["12:3"], "retryable": false }
```

| Field | Meaning |
|---|---|
| `ok` | Whether the call did what it was asked |
| `result` | A small value, or `{ path, bytes }` when it was too large (`FCC_MAX_INLINE_RESULT_BYTES`) and went to `results/` |
| `error` | `{ type, message, nextStep, retryable, … }` or `null`. `nextStep` always says what to do |
| `touchedNodeIds` | Every node the call created or changed. When the list does not fit, `touchedPath` points to a file with all of them |
| `retryable` | `false` when the failure is in your call (path, script, params) or uncertain (a timeout: something may have run). `true` when it is in the environment (Chrome, tab, session) and fixing that is enough |
| `tabOpened` | Present only when the server opened the project's tab for this call |

> [!TIP]
> **Large data never travels through the conversation.** Scripts are passed by path, reads go to files,
> and the response carries the path plus a small summary. Read the file when you need the detail.

## Jobs

A call that outlives the soft deadline (`FCC_SOFT_DEADLINE_MS`) answers `status: "running"` with a
`jobId`. Follow it with `figma_get_job`.

- Jobs live in memory: a server restart loses them.
- One batch at a time per Figma file, across sessions (lock files in `FCC_LOCK_DIR`). While a batch
  runs, another `figma_build` or `figma_run_script` is rejected; reads still work and may see a
  half-built screen.

> [!WARNING]
> A script that is already running in the Figma tab **cannot be interrupted** — Figma offers no way.
> If the client goes away mid-job, the job ends `Interrupted` and the script may have kept going.
> For anything long, split it into steps with `figma_build`, which can be cancelled between steps
> and says where it stopped.

## Figma

### `figma_status`

Diagnosis, and the first thing to call when another tool fails: is Chrome reachable, is the project's
tab open (it opens it if not), is `figma` ready, which file and page. On failure, the error and the
next step. `previousScriptRunning` is `true` when a script that outlived its deadline is still
running in the tab: writes are refused until it ends or the tab reloads.

### `figma_run_script`

Runs a plugin-API script in the open file.

| Input | |
|---|---|
| `file` | Path of the script, inside the project's scripts roots. Use it for anything but a one-liner: the content never passes through the conversation |
| `code` | Inline code, for short fragments only. Exactly one of `file` or `code` |
| `format` | `body` (default): the body of an async function, with `await` and `return`. `function`: a complete `async (params, assets, kit) => { … }` |
| `params` | A small JSON value the script receives as `params` (`FCC_MAX_PARAMS_BYTES`) |
| `assets` | `{ name: path }` of binary files; they arrive as `Uint8Array` in `assets[name]` (`FCC_MAX_ASSET_BYTES`) |
| `resultFile` | A bare file name: the `result` always goes to `results/<resultFile>`, even when small, and is overwritten |
| `timeoutMs` | Timeout of the call to Chrome (default `FIGMA_CDP_CALL_TIMEOUT_MS`) |

The script declares what it touched in its return value —
`return { createdNodeIds: ["1:2"], mutatedNodeIds: ["1:3"] }` — or the response carries a `warning`.
A read-only script declares empty lists (`createdNodeIds: []`): that counts as a declaration, so no `warning`.
It also receives `kit`, the [Figma kit](kit.md); with `// @contract step@1 · <what it does>` as its
first line, its result is checked against [`step@1`](contracts.md#step1).

### `figma_build`

Runs a batch: a list of steps, one script or one [kit step](kit.md#kit-steps) each. Exactly one of:

| Input | |
|---|---|
| `manifest` | Path to a [`build-manifest@1`](contracts.md#build-manifest1) JSON file — the usual choice: versionable and re-runnable |
| `steps` | A short list written inline, same step shapes as the manifest |
| `areas` | Area names from `areas@1`: the server assembles each area's plan with no manifest |
| `sheets` | Sheet keys from `sheets@1`: one `kit/build-component@1` per sheet, in the file's order (nested sheets first) |

Plus `fromStep` (resume: earlier steps report `skipped`), `stopOnError` (default `true`), `params`
(shared by every step; each step can override) and `expect: { fileName }` — a guard: if the open file
is not called that, the batch is refused before anything is sent, also when resuming.

It answers as soon as the batch is accepted, with `status: "running"`, the `jobId` and the whole plan
in `steps`. A validation error (path, manifest, script, asset, params, a `compose@1` that names
something missing) comes back in that same answer, with no job and Figma untouched. Each step's own
result is not in the response — it is in the history (`figma_history_call`). With `sheets`, a sheet
without a valid capture has no step and appears in `skippedSheets` with `NO_SOURCE`.

### `figma_get_job`

State and result of a job left running by `figma_run_script`, `figma_build`, a read or
`figma_capture`. With `waitMs`, waits until it finishes (capped by the soft deadline) and emits MCP
progress notifications if the client sent a progress token. A batch adds `kind: "build"`, `progress`
(`done`, `total`, `cancelled`, `skipped`, `current`) and `steps`.

### `figma_cancel_job`

Cancels a batch between steps: the running step finishes, the following ones are never sent. Answers
immediately with the real progress and `cancelRequested: true` if it had not finished; follow the end
with `figma_get_job`. It does not stop a `figma_run_script`.

### `figma_screenshot`

PNG of one node (`nodeId`, `scale` up to 4) saved to
`<output>/screenshots/<YYYY-MM-DD>/<node>_<HHMMSS>.png` in local time (`-2`, `-3`… if it exists). Returns
the path and size; the image does not travel through the conversation. Shows up in the dashboard's
Captures page.

### `figma_metadata`

A light layer tree `{ id, name, type, children? }` of a node (default: the current page) down to
`depth` levels. Use it to find ids before writing or capturing.

## Catalog reads

Read-only, never touch a node. Each writes its full JSON to `reads/` and answers with `path`, a
`summary` of counts and the `jobId` of its job — every read runs as a job, so a long one returns
`running`. They work while a batch is running.

| Tool | Reads | Inputs |
|---|---|---|
| `figma_variables` | Local variable collections: modes, values per mode, aliases | `collection`, or `nodeId` for only the variables bound in that subtree and where (`bindings`) |
| `figma_styles` | Local paint, text, effect and grid styles, with bound variables and a short value | `kind` |
| `figma_components` | Component sets with their variant options and non-variant properties, and loose components | `page`, `query` |
| `figma_instances` | Instances per top-level frame, counted by set or component name | `pages` (required), `frame` |
| `figma_export` | Nodes to PNG, JPG, SVG or PDF: one file per node in `exports/`, the index in `reads/` | `nodeIds` (up to `FIGMA_EXPORT_MAX_NODES`), `format`, `scale` |
| `figma_design_context` | One node as [`design-context@1`](contracts.md#design-context1), for writing its template | see below |

### `figma_design_context`

Design to code. Reads a frame, an instance or a component set and writes its context to `reads/`:
the tree breadth-first with auto-layout, fills, strokes, radii, text and styles. Each bound value
comes as its resolved variable (name, collection, value in the default mode) or style; each unbound
value is listed in `unmapped` — either a token is missing or the design left the system. An instance
carries its component, variant, properties and overrides without descending, except into its slots.
Each component carries its sheet and template (`code.source`, `code.tag`), or the warning
`NO_CODE_MAPPING` with candidates when it has none.

| Input | |
|---|---|
| `nodeId` | The node to read |
| `variant` | Only for a component set: `{ property: option }` of the variant to walk (default: the set's default) |
| `maxNodes` | Node cap (default `FIGMA_DESIGN_CONTEXT_MAX_NODES`); the rest is listed in `truncated` |
| `screenshot` | Also capture the node, the visual target (default `true`; `false` in batches of nodes) |

It generates no code and writes nothing to the consumer project. See
[Workflows](workflows.md#figma-to-code).

## Web capture

### `figma_capture`

Captures screens of the project's **web** — the keys of its `screens@1` — in a separate headless
Chrome, never the Figma one. Touches no Figma node.

It reads `figma-control-center.json`, signs in through the login form with the screen's user when
asked (password from `FCC_WEB_SECRETS_FILE`), and judges each capture against `capture@1`: a valid
one goes to `web-captures/<day>/`, one that fails goes to `rejected/` with its errors. The response
carries the file paths, one `summary` line per screen and at most `FCC_CONTRACT_INLINE_ERRORS`
errors — read the tree from the file. Screens using `evaluateInPage` (code in the page's own world)
need `allowPageWorld: true`. One capture at a time on the machine.

## History

Everything the tools do is recorded in SQLite, in the single database, with the project's number in
every row: a server only ever sees its own project's history. Consulting the history records nothing.

The rule is **aggregate first, detail by id**: start with the summary, then ask for one call. Every
list returns `total` and `truncated` (cap: `FCC_HISTORY_MAX_ROWS`). The range is given with
`preset` (`last_hour`, `today`), `since`/`until` (ISO 8601) or `sessionId`, plus `limit`.

| Tool | Returns |
|---|---|
| `figma_history_summary` | Calls, Figma writes, errors, in-flight, mean and p95 duration, jobs, touched nodes, most-used tools |
| `figma_history_errors` | Errors grouped by type, with the next step and up to three examples (failed jobs count) |
| `figma_history_nodes` | Touched nodes: how many calls touched each, and the last one |
| `figma_history_sessions` | Server sessions (one per Claude Code session) with their counters |
| `figma_history_search` | Calls matching `query` (full-text: script path, tool, error text or node id), with a one-line summary |
| `figma_history_call` | One call by `callId`: arguments, result, error, nodes, job, screenshots, attempts. For a batch, a short excerpt of each step's result; `step` returns one step's whole result |

### Attempts

Every execution — a `figma_run_script`, each batch step that runs, each screen of a `figma_capture` —
records an **attempt** with the exact content it used (script, params, kit, hooks, screens…),
deduplicated by hash and linked to its call. It answers "what changed between the run that worked and
the one that didn't?".

| Tool | Returns |
|---|---|
| `figma_history_attempts` | Without `target`: the targets (script path relative to its root, `(código)` for inline code, or a screen key) with their attempt count and last status. With `target`: its attempts in order, with status, first error, call, kit, and **which roles changed** since the previous one. Filters: `kind` (`run_script`, `build_step`, `capture`), `since` |
| `figma_history_script` | Writes the exact content of one attempt's role (`attempt` + `role`, or a `sha256`) to `history-scripts/<sha256>.<js\|json>` and returns its `path`. Content above `FCC_SCRIPT_MAX_BYTES` was kept only as a hash, and it says so |
| `figma_history_diff` | Compares two attempts of the same target (`from`, `to`): each role's state with lines added and removed, the assets that changed, and the unified diff of one role (`role`, or the first that changed) — trimmed to `FCC_HISTORY_DIFF_INLINE_LINES` inline, whole in `history-diffs/`. JSON roles are compared formatted with sorted keys |

> [!NOTE]
> The server **never stores a script's content in the activity log** — only its path, or the length
> and first characters of an inline `code`. Attempt content is the exception, by design, and follows
> the history's retention.

## Chat

### `figma_chat_reply`

Claude's answer to a message that arrived from the dashboard as a `<channel>` tag: `chat_id` from that
tag, and `text`. Only meaningful in a session started with `make agent` — see
[Use it from Claude Code](claude-code.md#the-dashboard-chat).

## Prompts

The history prompts (`last-hour`, `errors-today`, …) are listed in
[Use it from Claude Code](claude-code.md#prompts).
