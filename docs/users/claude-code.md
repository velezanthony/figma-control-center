---
seo:
  title: "Use the Figma MCP from Claude Code"
  description: "Register the Figma Control Center MCP server in Claude Code, install its plugin skills, and run the restricted agent harness with the dashboard chat."
---

# Use it from Claude Code

## In this repository

The server is already declared in `.mcp.json` at the repository root (project scope, name
`figma-control-center`, command `node server/src/main.ts`). There is nothing to register:

1. Run `claude` in the repository folder and approve the `figma-control-center` server when asked.
2. `/mcp` must show it connected, with the `figma_*` tools, the `figma_history_*` tools and
   `figma_chat_reply`. From a terminal, `make mcp` prints how Claude Code sees it.

## From another project

To drive Figma while working in the project you are designing, register the same server there. The
command needs an **absolute** path to `server/src/main.ts`, because the `${CLAUDE_PROJECT_DIR}` in this
repository's `.mcp.json` would point at the other project:

::::tabs
:::tab[claude mcp add]
```bash
claude mcp add figma-control-center -e FCC_PROJECTS=1 -- node /path/to/figma-control-center/server/src/main.ts
```
:::
:::tab[.mcp.json]
In that project's `.mcp.json`:

```json
{
  "mcpServers": {
    "figma-control-center": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/figma-control-center/server/src/main.ts"],
      "env": { "FCC_PROJECTS": "1" }
    }
  }
}
```
:::
::::

> [!NOTE]
> Relative paths in the configuration still resolve against the Figma Control Center repository, not
> against the folder Claude Code runs in, so the same `.env`, database and output folders are used.

### Which project the server serves

`FCC_PROJECTS` is the server's access scope: `any`, or project numbers separated by commas. Unset,
every registered project is in scope. Set but naming nothing valid, no project is.

| Projects in scope | What the tools do |
|---|---|
| none registered | Each tool answers a usage error saying to register one in the dashboard, with its URL |
| exactly one | That one is used |
| several | Each tool answers a usage error listing them (`<number> («<name>»)`) and asking you to pick one with `FCC_PROJECTS` |

The project is resolved on each call, not at start-up: a project registered later is used without
restarting Claude Code.

## Agent skills: the plugin

The server gives the agent tools; the **`figma-control-center` plugin** gives it the manual for
using them. Install it in Claude Code, from any folder:

```text
/plugin marketplace add velezanthony/figma-control-center
/plugin install figma-control-center@figma-control-center
```

It adds two skills, which Claude Code loads when the task calls for them:

| Skill | What it gives the agent |
|---|---|
| `figma-control-center` | The web-to-Figma flow (capture, build screens and component sheets, place them into areas, restore links and maps), Figma to code with `figma_design_context`, designing with `compose@1`, how code maps to Figma, and the Plugin API traps the kit solves |
| `design-craft` | Design criteria for your components: props versus slots, tokens, states and accessibility, component specs and design review |

> [!IMPORTANT]
> The plugin only carries instructions: the server still has to be registered as shown above. The
> skills point to these docs and to the JSON Schemas in `schemas/`, so they work from your own
> project. An agent started with `make agent` doesn't need them: it only consults.

## The agent harness: `make agent PROJECT=<n>`

```bash
make agent PROJECT=1
```

starts Claude Code locked to **one** project and connected to the dashboard chat. Without `PROJECT`
it refuses: an agent never sees every project.

There are two roles. Your own `claude`, opened in your project with the server connected, does the
work: capturing, painting, building. The dashboard chat agent only answers questions about the
project's state and activity.

The launch writes its own `settings.json` and `mcp.json` to a temporary folder
(`<tmp>/figma-agent-<id>/`, removed on exit), runs `claude --restricted` with them, and installs a
`PreToolUse` guard (`server/src/agent-guard.ts`). It never touches `~/.claude/`, a `.claude/` folder
or anybody's `.mcp.json`.

**What the agent can do**

- Answer questions about the project's state, activity and history with every
  `figma-control-center` read tool and the `figma_history_*` tools, without asking.
- `Read`, `Glob` and `Grep` inside the project's roots (project directory, scripts roots, output
  folder), to look at scripts, results and saved reads.

**What it cannot do**

- Change anything: it has no `Write` or `Edit`, and `figma_run_script`, `figma_build`,
  `figma_cancel_job` and `figma_capture` are refused by its settings, its guard and the server itself.
  Asked for a change, it answers that changes are made from Claude Code in your project.
- Bash (git included), WebFetch, WebSearch, other MCP servers, plugins or claude.ai connectors.
- Read outside the project's roots — the tool's own repository, other projects, the database, the
  chat tokens, your home.
- Read secrets (`.env`, keys, `~/.ssh`, the capture secrets file…).
- Switch to bypass-permissions mode.
- Load your `~/.claude/settings.json`, your global `CLAUDE.md` or auto-memory.

The harness is fixed: there is no setting to open writing, Bash or the network. A task that needs
them is one to do in your normal `claude`.

:::info[Project requirements to launch]
Its roots (project directory, scripts roots, output folder) must
exist, must not be `/` or your home nor contain it, must not be inside the Figma Control Center
repository nor contain it, and must not overlap another project's. In particular, a project with no
scripts root of its own, or with the default output folder (inside the repository), does not launch:
give it its own in **Projects**. The error names the root and the reason.
:::

## The dashboard chat

What you type in the dashboard's **Chat** page reaches the agent's session as a `<channel>` message,
and Claude answers with `figma_chat_reply`, live in the dashboard. No API key or model of its own:
it is your Claude Code session.

- **Launch agent** (in Chat and Home, when no session is listening) writes the harness configuration
  for the project you are viewing and opens the terminal in `FCC_AGENT_TERMINAL` running
  `make agent PROJECT=<n> AGENT_DIR=<folder>`. Accept the channel warnings in that terminal; until you
  do, the chat says no session is listening. The browser never sends the command line: the dashboard
  builds it, only for a local origin, and never launches two at once.
- **Close agent** asks the launcher to stop the agent for the project you are viewing (if a batch is
  running, it asks first: the batch would be cut). The dashboard never signals processes itself.
- When the dashboard closes, an agent launched from it closes too: its launcher keeps a connection to
  the dashboard and, if the dashboard does not come back within `FCC_AGENT_PANEL_GRACE_MS`, stops
  `claude` and removes its folder. A quick restart of the dashboard does not close it. An agent
  started by hand with `make agent` watches no dashboard.
- **Permissions from the dashboard.** If the session asks permission for a tool, the request shows
  up in the chat (tool, description and input, shown as text) with **Aprobar** and **Denegar**. The
  answer goes back to Claude Code signed with the session's token. The terminal still works; the
  first answer wins.

:::warning[The chat is an injection path]
A message without the session's signature never produces a notification, and the token never
reaches the browser. What a permission request carries is shown as untrusted text.
:::

> [!NOTE]
> Channels are a Claude Code research preview: if your organization disables them (`channelsEnabled`),
> nothing reaches the session. `spikes/channel/README.md` walks through verifying the chain by hand.

## Prompts

The server publishes MCP prompts that ask for a summary from the history, following "aggregate first,
detail by id". In Claude Code they show up as `/mcp__figma-control-center__<name>`:

| Prompt | Arguments | Asks for |
|---|---|---|
| `last-hour` | — | What happened in the last hour: calls, errors, touched nodes |
| `errors-today` | — | Today's errors grouped by type, with their next step and one example call |
| `nodes-today` | — | Nodes touched today, how many times and by which call |
| `session` | `id` | What one server session did |
| `attempts` | `target` | The attempts of a script, screen or kit step, and which roles changed |
| `attempt-changes` | `target`, `a`, `b` | What changed between two attempts of the same target |
| `costly-screens` | — | The targets that took the most attempts in the last week |

The tools these prompts call are listed in [Tools](tools.md#history).
