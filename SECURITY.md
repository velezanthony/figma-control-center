# Security

## What this tool can reach

**Your Figma account, through your own session.** The server drives a figma.com
tab in a Chrome it talks to over Chrome DevTools Protocol, and runs scripts
there with the Plugin API. A script can do anything you can do on that file.
The Chrome profile that holds the session stores its cookies **unencrypted**
(`--password-store=basic`): whoever can read that folder has your Figma session.
Keep it outside the repository (the server refuses a profile inside it), owned
by your user, and out of shared backups.

**Scripts only from the folders you allow.** Tools take a path, and the server
reads it only if it sits under `FCC_SCRIPTS_ROOT`. Results, captures and the
history database stay on your disk, under the output folder and `FCC_DB`.

**Local only.** The Chrome debugging port and the dashboard listen on loopback;
the dashboard refuses any other host, and requests that change state are
refused cross-site. The agent launched from the dashboard runs with a fixed
harness: only its project's folders, no shell, no network tools, no other MCP
servers. Chat messages reach Claude Code only when signed with the session's
token, and what a permission request carries is shown as untrusted text.

**No telemetry.** The server talks to the local Chrome, and the web capture
opens the pages of the project you point it at. Nothing else leaves your
machine.

## Reporting a vulnerability

Do not open a public issue.

Use GitHub's private reporting at
[github.com/velezanthony/figma-control-center/security/advisories/new](https://github.com/velezanthony/figma-control-center/security/advisories/new).

Include the commit, the smallest input that reproduces it, and what you
observed — without Figma file URLs or keys, cookies, tokens or `.env` values.
You will get an acknowledgement within a few days.

## Supported versions

The latest commit on the default branch. This is a single-maintainer project,
so fixes land there rather than as patches to older versions.
