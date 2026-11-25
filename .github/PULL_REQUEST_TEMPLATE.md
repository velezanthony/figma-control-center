<!--
Thanks for the PR! Fill in the sections below — anything not relevant can be removed.
See CONTRIBUTING.md for what tends to get pushed back.
-->

## What this changes

<!-- One or two sentences. -->

## Why

<!-- Link to an issue (`Fixes #123`) or describe the motivation. -->

## How

<!-- Quick walkthrough of the approach if it's not obvious from the diff. -->

## Checklist

- [ ] `make check` passes locally
- [ ] `make e2e` passes if the change touches a tool, a kit step, the dashboard or the agent harness
- [ ] Tests written first (red → green → refactor) for the behaviour this changes
- [ ] Touched `kits/`? `npm run build:kit` and the rebuilt `kits/dist/` are in the PR
- [ ] Touched a contract? `npm run schemas` and the regenerated `schemas/*.json` are in the PR
- [ ] `CHANGELOG.md` updated under `[Unreleased]`
- [ ] Docs updated if user-facing behaviour changed — **both** the `.md` and its `.es.md`
- [ ] No Figma file URL or key, cookie, token or personal path in code, tests or fixtures

## Anything else

<!-- Trade-offs, follow-up work, anything reviewers should know. -->
