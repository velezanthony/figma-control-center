# Changelog

All notable changes to Figma Control Center are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and
the project will adhere to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
from its first tagged release. `Unreleased` carries no date: the date is what a
release stamps on it.

## [Unreleased]

The first public version. Everything below is what the repository holds before
it has a version number.

### MCP server

- **Scripts by path.** `figma_run_script` runs a Plugin API script read from
  disk (only under `FCC_SCRIPTS_ROOT`) in a figma.com tab driven over Chrome
  DevTools Protocol. Long scripts turn into jobs (`figma_get_job`).
- **Batches.** `figma_build` runs a manifest, a short list of steps, areas or
  component sheets in the background, resumable with `fromStep`, cancellable
  between steps with `figma_cancel_job`, and guarded by `expect`.
- **Reads to file.** `figma_variables`, `figma_styles`, `figma_components`,
  `figma_instances`, `figma_export` and `figma_design_context` write their
  results to the project's output folder and answer with the path and a
  summary. `figma_screenshot` saves a PNG; `figma_metadata` answers with a
  light layer tree.
- **Diagnosis.** `figma_status` checks Chrome, the tab, the `figma` global, the
  file and the page, and names the next step when something is missing.
- **Web capture.** `figma_capture` captures the screens of a project's web in a
  separate Chrome, validated against `capture@1`.
- **History for agents.** Read-only `figma_history_*` tools and MCP prompts
  over a single SQLite database, isolated per project, including attempts and
  their diffs.

### Figma kit

- `figma-kit@1`, installed once per tab and passed to every script as `kit`.
- `step@1`: a script whose first line declares the contract has its result
  checked.
- Kit steps for batches: `place`, `share`, `links`, `fill-image`,
  `layout-check`, `build-screen`, `build-component` and `compose`.

### Contracts

- Versioned JSON Schemas in `schemas/`, generated from the zod schemas the
  server validates with.

### Dashboard

- Local activity dashboard: activity, jobs, captures, attempts, projects,
  settings and a chat with a Claude Code session launched with a restricted
  harness, including permission prompts answered from the browser.
