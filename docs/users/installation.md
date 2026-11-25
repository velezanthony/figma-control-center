---
seo:
  title: "Install a local Figma MCP server"
  description: "Install Figma Control Center: requirements, the debug Chrome with your Figma session, registering a Figma file as a project and checking it works."
---

# Installation

Figma Control Center runs on your machine: an MCP server that Claude Code starts over stdio, and a
Chrome with a remote-debugging port that holds your Figma session. Nothing is hosted.

## Requirements

| What | Version | Notes |
|---|---|---|
| Node | **24** or newer (`engines` in `package.json`) | Runs the `.ts` sources directly, no compile step |
| npm | the one that ships with Node 24 | |
| Google Chrome | stable, `google-chrome` on the `PATH` | The helper scripts in `spikes/m0/` use `setsid`, `pkill` and `ss`: they are written for **Linux**. On another OS, adapt them |
| Claude Code | a recent release | The dashboard chat uses Claude Code *channels*, a research preview |
| Figma account | with **edit** permission on the file | Figma only exposes the plugin API to editors |
| A graphical terminal | the one in `FCC_AGENT_TERMINAL` | Only for the dashboard's **Launch agent** button |

## Install

```bash
make install       # npm ci
```

> [!NOTE]
> `better-sqlite3` ships prebuilt binaries, so no compiler is needed. npm attributes an implicit install
> script to it (`node-gyp rebuild`); it is **not approved** (`allowScripts` is `false`) and it is not
> needed — the package loads `prebuilds/<platform>.node`.

## Configuration file (optional)

Everything has a default: the project starts **without a `.env`**. A `.env` only overrides what you
want to change, and the shell scripts read it without executing it.

```bash
make env           # copies the template to .env if there is none
```

Every variable, and which ones you can change from the dashboard instead, is in
[Configuration](configuration.md). The `.env` is never committed.

## Chrome with your Figma session

Two commands, once each:

```bash
make login         # once: a normal Chrome window on the debug profile, to sign in to Figma
make chrome        # headless Chrome with the debugging port and that session
```

- **`make login`** (`spikes/m0/login.sh`) stops the debug Chrome if it is running — two Chromes on
  one profile can corrupt it — and opens a **normal** Chrome on `FIGMA_CHROME_PROFILE` at the Figma
  login page. Sign in, open your file to check you can **edit** it, and close the window. The first
  sign-in has to happen like this because Google refuses sign-in from an automated browser.
- **`make chrome`** (`spikes/m0/chrome.sh`) starts Chrome **headless** with the debugging port and
  that profile, on `about:blank`. Figma tabs are opened by the server when a project needs one. If
  the profile does not exist, it is seeded from `FIGMA_CHROME_SEED_PROFILE` (optional) or created
  empty, and the script reminds you to run `make login`.
- **`make chrome-stop`** stops it.

:::warning[The profile holds your Figma session, unencrypted]
Both scripts start Chrome with `--password-store=basic`, which stores the profile's cookies in the
profile itself instead of the system keyring. Anyone who can read that folder has your Figma
session. Keep it readable only by your user and out of shared backups.
:::

- **Where the profile goes.** The default is `~/.cache/figma-control-center-chrome`. A relative
  `FIGMA_CHROME_PROFILE` resolves against the repository root, and one that falls **inside** the
  repository is rejected at start-up: git does not ignore it and it would end up in a commit.
- **The session expires.** When `figma_status` reports no session, run `make login` and
  `make chrome` again.

:::question[Port already taken]{collapsed}
`make chrome` checks who owns `FIGMA_CDP_PORT`. If it is already *our*
Chrome (same port, same profile), it says so and exits cleanly. If another process holds it —
another Chrome, one with a different profile, one left behind by a test — it fails with that
process's pid and command line and starts nothing on top: a server talking to a Chrome without the
expected session is worse than one that does not start. Inspect it with
`ss -ltnp 'sport = :9222'` and `pgrep -af remote-debugging-port`, then stop it yourself or set a
different `FIGMA_CDP_PORT`.
:::

## Register your Figma file

Files are not configured in `.env`: each one is a **project**, registered in the dashboard.

```bash
make dashboard     # builds the web UI and serves it on http://127.0.0.1:4173
```

Open **Projects** (`#/projects`) and add one:

| Field | What it is |
|---|---|
| Name | Free text, e.g. `ejemplo` |
| Project directory | The folder of the project you are designing (where `figma-control-center.json` lives, if you capture its web) |
| Figma file | The file URL, `https://www.figma.com/design/<key>/<name>`, without `?…` or `#…` |
| Scripts root | Optional, one per line: folders the tools may read scripts from |
| Output folder | Optional: where screenshots, reads and captures go (`output/<id>` by default) |

The database assigns the project a number (`1`, `2`, …): that number is what `FCC_PROJECTS` and
`make agent PROJECT=<n>` refer to. A project added while Claude Code is running is picked up without
a restart.

## Check it works

In Claude Code (see [Use it from Claude Code](claude-code.md)), call `figma_status`. It must report
Chrome reachable, the tab found, `figma` ready, and the file and page names. If the project's tab is
not open, the server opens it the first time a tool needs it and says so in `tabOpened`; it never
closes tabs it did not open.

`figma_status` explains each failure with a `nextStep`. The common ones:

| Reason | Meaning |
|---|---|
| `notLoggedIn` | No Figma session in the debug profile: `make login`, then `make chrome` |
| `viewOnly` | Your account can only view the file: ask for edit access, or duplicate the file and register the copy |
| `loading` | The editor has not finished loading within `FIGMA_READY_TIMEOUT_MS` |

> [!NOTE]
> `make probe` is a lower-level transport check (read, reversible write and a multi-megabyte script)
> from `spikes/m0/cdp-probe.ts`. It works on a single file given by `FIGMA_FILE_URL` in the environment
> of that command, with that file's tab already open.
