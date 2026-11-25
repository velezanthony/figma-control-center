---
seo:
  title: "Figma MCP limitations"
  description: "Known limitations of Figma Control Center: the unofficial figma object, scripts that cannot be interrupted, one batch per file, Linux helpers and more."
---

# Known limitations

Part of the contract, not a list of apologies. Each one says why it exists.

## The transport

:::danger[The `figma` object in the browser tab is not an official automation channel]
The server drives Figma through the plugin API object that the Figma web editor exposes in its
own page, reached over the Chrome DevTools Protocol. Figma does not document or support this as a
way to automate the editor. It can change or disappear without notice, and an update to the
editor can break the tool overnight. Use it on files you can afford to repair, keep Figma's
version history in mind, and do not build a business process that cannot survive it stopping.
:::

- **Why not a plugin.** Figma web does not load development plugins, and there is no official
  Figma Desktop for Linux, which is the only place they load, so the server reaches Figma over CDP
  instead.
- **Edit permission is required.** Figma only exposes the plugin API to accounts that can edit the
  file. With view-only access, `figma_status` reports `viewOnly` and nothing can be done on that file.
- **The session expires.** When the debug profile's Figma session ends, `figma_status` says so:
  `make login`, then `make chrome`.
- **The tab states are inferred.** How `figma_status` tells "no session", "view only" and
  "loading" apart is read from the page, not from an API.

## Execution

- **A running script cannot be interrupted.** Figma offers no way to stop one. A script that outlives
  its timeout keeps running in the tab, and writes are refused until it ends or the tab reloads
  (`previousScriptRunning` in `figma_status`). Split long work into `figma_build` steps: a batch can
  be cancelled between steps.
- **Jobs live in memory.** Restarting the server loses the jobs it was tracking; the history still
  has what was recorded.
- **One batch at a time per Figma file**, across every session on the machine. Reads still run and
  may see a screen half-built.
- **One project per MCP server session.** With several in scope and none chosen, the tools refuse
  until you pick one (`FCC_PROJECTS`).
- **One web capture at a time** on the machine.
- **Scripts are read only from the project's scripts roots.** A path outside them is refused, by
  design: the tools receive paths, and the paths are fenced.

## Platform

- **The helper scripts are written for Linux.** `spikes/m0/chrome.sh` and `login.sh` use `setsid`,
  `pkill` and `ss`, and launch `google-chrome`. On another system, adapt them; the server itself is
  plain Node.
- **Launch agent** opens the terminal named by `FCC_AGENT_TERMINAL` (`gnome-terminal --` by
  default): set it to your desktop's terminal.

## The chat

- **Channels are a Claude Code research preview.** The dashboard chat depends on them; if your
  organization disables channels, messages never reach the session. Claude Code ignores channels in
  non-interactive mode (`-p`) and in the Agent SDK.
- **The dashboard cannot know whether a permission was answered in the terminal.** The first answer
  wins.
- **A hung dashboard is not detected.** An agent launched from the dashboard closes when the dashboard
  closes or crashes and does not come back; one that is alive but not responding keeps it open.
- **The harness is fixed.** A launched agent has no Bash, no network and no access outside its
  project's roots, and there is no setting to change that.

## Data

- **The Chrome profile stores cookies unencrypted** (`--password-store=basic`): anyone who can read the
  folder has your Figma session.
- **The database holds every project's history.** Each server and each query is scoped to one project,
  but the file itself is shared: protect it like the rest of your output folder.
