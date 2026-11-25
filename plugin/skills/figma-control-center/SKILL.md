---
name: figma-control-center
description: Keeps a project's Figma file as a mirror of its code (components, tokens and screens) using the figma_* tools of the Figma Control Center MCP server. Use it when building or rebuilding components or screens in Figma, capturing the web into Figma, syncing props or tokens with the code, auditing which components a screen is missing, turning a Figma design into templates (Figma to code), designing a new screen in Figma before it exists on the web (compose@1), running figma_build batches or kit steps, or writing Plugin API scripts for figma_run_script.
---

# Figma Control Center

**The code leads; Figma mirrors it.** Never design in Figma something that does not exist in the
project's components or on its web. The one exception is a `compose@1` screen (see below).

This skill covers what is specific to Figma Control Center and its contracts with your project; none
of it depends on a particular framework. What counts as good design (props versus slots, tokens,
states, review) is decided by the **`design-craft`** skill: read it before adding props, variants or
variables. For generic Plugin API knowledge, Figma's official `figma-use` skill is a useful companion
if it is installed.

## Where things are

| What | Where |
|---|---|
| Tools that touch Figma | The `figma_*` tools of the `figma-control-center` MCP server. `/mcp` lists them; each tool's description says what it takes. Reference: https://velezanthony.github.io/figma-control-center/users/tools/ |
| Kit pieces and kit steps (`kit/<step>@1`) | https://velezanthony.github.io/figma-control-center/users/kit/ |
| Contracts (`project@1`, `screens@1`, `areas@1`, `map@1`, `sheets@1`, `compose@1`, `step@1`, `build-manifest@1`…) | https://velezanthony.github.io/figma-control-center/users/contracts/ and the JSON Schemas at `https://github.com/velezanthony/figma-control-center/blob/main/schemas/<name>.v1.json` |
| End-to-end workflows | https://velezanthony.github.io/figma-control-center/users/workflows/ |
| The project's data (`screens@1`, `map@1`, `areas@1`, `sheets@1`, `recognize.js`, manifests) | The files its `figma-control-center.json` (`project@1`) points to, in the project directory. The project owner makes or approves changes there |
| Code components | The project's own component system; each one's template path is `source` in its `sheets@1` sheet |
| Tokens | The file that `map.tokens` (`map@1`) points to |
| Step-by-step flow | [references/pipeline.md](references/pipeline.md) |
| Code to Figma (names, props, slots, tokens) | [references/mapping.md](references/mapping.md) |
| What breaks | [references/gotchas.md](references/gotchas.md) |

Before promising a tool, a kit step or a contract field, check that it exists in the tool list or the
docs above.

## How code runs in Figma

Always through the `figma_*` tools. Start with `figma_status`: it says whether Chrome, the tab and the
file are ready, and gives the next step when something is not. Call it again whenever another tool
fails.

- **Repeatable work goes through kit steps** with `figma_build`: screens, component sheets, placing
  screens into areas, shared content, prototype links, image fills and layout review. Flow in
  [references/pipeline.md](references/pipeline.md).
- **A script of your own** goes through `figma_run_script` with `file`. The server reads it **by
  path**, and only from the project's scripts roots (set per project in the dashboard; the default is
  `FCC_SCRIPTS_ROOT`), so write scripts there. The script receives `params`, `assets` and `kit` (the
  Figma kit, `figma-kit@1`). If its first line is `// @contract step@1 · <what it does>`, its result is
  checked; `kit.track()` … `.done()` returns a compliant one. Use `code` only for one-liners.
- Pass data as `assets` (files by path, read with `kit.json`), never pasted into a script.
- A script or batch that takes long returns a `jobId`: follow it with `figma_get_job` (`waitMs`), do
  not relaunch it. `figma_cancel_job` stops a batch between steps.
- Every write returns the node ids it touched: keep them to verify.
- To see the result, `figma_screenshot` of a node; for the tree, `figma_metadata`; for the catalog,
  `figma_variables`, `figma_styles`, `figma_components` and `figma_instances` (they write to `reads/`
  in the output folder and answer with the path and a summary).
- **Figma to code**: `figma_design_context` on a frame, instance or set gives, for each component
  used, its template (`code.source`, `code.tag`). It comes from `sheets@1` `source`, so a sheet
  without `source` or a hand-made set gives `NO_CODE_MAPPING`. Values in `unmapped` are bound to no
  token: either a token is missing or the design left the system. For a set, ask for one `variant`.
- What happened before (errors, touched nodes, each batch step's result, attempts and their diffs):
  the `figma_history_*` tools.

Do **not** run code in the Figma tab through other browser-automation tools (such as a DevTools MCP
`evaluate_script`), and do not set up a file server to feed scripts: the `figma_*` tools are the path.

## Designing in Figma before the web

A screen that does not exist on the web yet is written as a `compose@1` (a data file in the project's
`compose` folder) and painted with `figma_build { steps: [{ use: "kit/compose@1", compose: "<key>" }] }`.
Only existing pieces: `sheets@1` sheets with their variants and props, and the file's variables and
styles. A loose number or colour is rejected: if a token is missing, create it first. The compose is
validated before Figma is touched, and repainting it does not duplicate.

Then `figma_design_context` on its frame (`origin` says `compose`) gives the template of each block:
use it to write the screen's template in the project. Once the screen exists on the web, it stops
being a compose and follows the usual path (capture and `kit/build-screen@1`).

## Rules

- **Real components, not recreations.** If something on a screen is a component in code, it is an
  instance in Figma. If it does not fit the component, extend the component (prop or slot); do not
  draw it by hand.
- **Props are the code's props.** Variants and value names come from the props the component
  declares (choices between values and booleans). Editable texts are TEXT properties, in the language
  of the project's UI.
- **Free or optional content is a native slot**; a choice among fixed options (icons) is an instance
  swap. A new `Show …` boolean only when it mirrors an optional part that depends on a prop in code;
  otherwise, a slot. See [references/mapping.md](references/mapping.md).
- **Colours and type always bound** to variables and text styles. No loose hex values.
- **Verify every component edit**: screenshot and read the properties back after writing. A swap or a
  variant that looks right can carry default texts.
- **After rebuilding screens**, always restore shared content, prototype links and maps
  ([references/pipeline.md](references/pipeline.md)). Otherwise they are lost.
- **Do not delete or overwrite without looking first** at what is there (hand-made interactions,
  maps, overlays). A screen with hand-made interactions or instances is not rebuilt whole: it is
  transplanted or patched ([references/gotchas.md](references/gotchas.md)).
- **Experiment on a sandbox file**, not on the working one: register a copy of the file as its own
  project in the dashboard.

## Checking nothing broke

- **Overlapping texts, collapsed containers and misaligned rows**: `kit/layout-check@1` in a
  `figma_build` (read-only; the per-frame report is in the step's `report.layout`).
  `figma_build { areas }` does not add it: ask for it.
- **Prototype links at `×0`**: the `LINK_ZERO` warning of `kit/links@1` (full report in
  `report.links`). Check whether the button still exists on the web before treating it as a failure.
- **Sheet versus Figma**: if Figma is ahead of the web, the sheet step writes nothing and warns
  `SHEET_DRIFT` ([references/pipeline.md](references/pipeline.md)).
- **Components missing per screen, and code props versus variants**: there is no dedicated tool.
  `figma_components` and `figma_instances` give the data to compare against the code.
