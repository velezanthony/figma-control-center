---
seo:
  title: "Figma Plugin API kit for scripts"
  description: "The Figma kit injected into the tab: named pieces that solve Plugin API traps, step@1 results, and the kit steps that build screens and components."
---

# The Figma kit

Writing to Figma through the plugin API has traps that bite every script the same way: a page found
by its untrimmed name, a paint bound to a variable that silently loses its opacity, a node that
changes id when it moves page, a slot filled with an instance whose text was edited. The **Figma kit**
(`figma-kit@1`) is the set of named pieces that solve each trap once.

The server installs the kit in the Figma tab — once; before each script it checks the installed
version and hash, and reinstalls if the tab reloaded — and passes it to every script as `kit`. Its
sources live in `kits/figma/`; the bundle the server installs is `kits/dist/figma-kit.js`.

## The pieces

| Piece | What it solves |
|---|---|
| `kit.page.find` · `ensure` · `remove` | Pages by trimmed name or by key; never deletes the open page without leaving it first |
| `kit.node.get` · `tag` · `byKey` | Nodes by id, and by a key stored with `setSharedPluginData` — ids change, keys do not |
| `kit.frame.ensure` · `replaceContent` | Frames by key, created once; replacing content keeps the frame's id, so links to it survive |
| `kit.component.find` · `setNameOf` · `variant` · `cloneVariant` | The component catalog (cached), the set of an instance, a variant by its props, cloning variants |
| `kit.instance.create` | Instances with texts and boolean properties already set, on the nested instance that owns each property |
| `kit.slot.fill` · `share` | Slot content goes in as a clone; variants of a set share one slot property |
| `kit.fonts.ensure` · `load` | Loads what is missing, all at once, before touching `characters`: `ensure` for the fonts of some text nodes, `load` for a list of `{ family, style }` |
| `kit.tokens.load` · `resolver` · `paint` | Variables by name, from the single mode of each collection; fills and strokes bound to their variable |
| `kit.paints.set` | Paints bound to variables with their opacity restored |
| `kit.icons.fromSvg` | Icons from SVG, normalised so `createNodeFromSvg` accepts them |
| `kit.links.*` · `kit.flow.start` | Prototype links by text or table row, saved and restored around a rebuild; flow starting points edited by name without dropping others |
| `kit.json` | An asset (bytes) parsed as JSON: data goes through `assets`, never pasted into the script |
| `kit.track()` | Opens the tracker of the current step: pieces that create, change or delete nodes report there, and `.done(report?)` returns a valid `step@1` result |
| `kit.fail(code, message, next)` | Fails the step with a code and a next step; the server turns it into a `ScriptError` whose `nextStep` is `next` |
| `kit.steps.*` | The kit steps below, as functions |

The kit never imports server code. Its types come from the plugin API typings only.

## `step@1`: scripts whose result is checked

If the **first line** of a script is

```js
// @contract step@1 · places the cards of the home screen
```

its result must satisfy [`step@1`](contracts.md#step1):

```json
{ "createdNodeIds": ["1:2"], "mutatedNodeIds": ["1:3"], "removedNodeIds": [], "warnings": [], "report": {} }
```

`removedNodeIds`, `warnings` and `report` are optional. A result that does not comply fails with
`ContractError` and the JSON pointer of the problem; the `warnings` end up in the response's
`warning`. Without the header, nothing is checked. The easy way to comply:

```js
// @contract step@1 · adds a title
const t = kit.track();
const page = await kit.page.ensure({ name: "Ejemplo", key: "ejemplo" });
await kit.fonts.load([{ family: "Inter", style: "Regular" }]);
const title = figma.createText();
page.appendChild(title);
title.characters = "Hola";
t.created(title);
return t.done();
```

## Attempts

Each execution of a script records an **attempt** with the exact content it used — the script, its
params, the kit, and for kit steps the plans and project files they read — so two runs of the same
target can be compared line by line. See [Attempts](tools.md#attempts) and the dashboard's
[Attempts page](dashboard.md#attempts).

## Kit steps

A kit step is a step of `figma_build` whose code ships with the kit: no script file, just its name and
its target. The server sends fixed code that calls `kit.steps.<piece>(params, assets)`, so every kit
step is checked against `step@1`. Their inputs come from the consumer project's contract files, not
from you.

| Step | Manifest shape | What it does |
|---|---|---|
| `kit/place@1` | `{ "use": "kit/place@1", "area": "<name>" }` | Moves a built screen from its temporary page (`pagePrefix + frame`) into the area's frame, keeping the frame's id (links point at it). `place.mode` is `replace-content` or `transplant`; `shell` swaps the area's shared shell for an instance with the right variant |
| `kit/share@1` | `{ "use": "kit/share@1", "area": "<name>" }` | Content common to several areas becomes one component with a variant per area, and each frame uses an instance (`shared` in `areas@1`) |
| `kit/links@1` | `{ "use": "kit/links@1", "area": "<name>" }` | Prototype links by text or by table rows, the flow's starting point, and clipping |
| `kit/fill-image@1` | `{ "use": "kit/fill-image@1", "area": "<name>" }` | Puts a real image as the fill of the node that holds a given text (e.g. a map placeholder) |
| `kit/layout-check@1` | `{ "use": "kit/layout-check@1", "area": "<name>" }` | Read-only review of each top-level frame: overlapping texts, collapsed containers, misaligned table rows, in `report.layout` |
| `kit/build-screen@1` | `{ "use": "kit/build-screen@1", "screen": "<key>", "area"?, "variant"?, "capture"? }` | Paints a screen from its latest valid web capture, using `map@1` (and `recognize@1`) — the server builds the `screen@1` plan first. With `area`, on that area's temporary page, ready for `kit/place@1` |
| `kit/build-component@1` | `{ "use": "kit/build-component@1", "sheet": "<key>", "scratch"? }` | Paints a component sheet — header, card and the variant set with its matrix and properties — from its capture, `sheets@1` and `map@1`. If the set exists it is rebuilt in place (same id, variants matched by props). If Figma is *ahead* of the web, nothing is written and the step reports the drift. `scratch` paints on a separate page |
| `kit/compose@1` | `{ "use": "kit/compose@1", "compose": "<key>" }` | Paints a `compose@1` with instances of sheets, variables and styles only. Everything it names is resolved before writing; re-running does not duplicate (the frame is found by key and rebuilt) |

Every step also accepts `timeoutMs` (default `FCC_BUILD_STEP_TIMEOUT_MS`).

### Plans from areas and sheets

You rarely list these steps by hand:

- `figma_build({ areas: ["Panel"] })` assembles, for each area: `build-screen` for every screen with a
  capture (when the project declares a `map`) → `place` → `share` (if it is in a shared group) →
  `links` (if it has links or a starting point) → `fill-image` (if it has fills).
  `kit/layout-check@1` is never added automatically: ask for it in `steps` or a manifest.
- `figma_build({ sheets: ["marca"] })` emits one `kit/build-component@1` per sheet, in the order of
  `sheets@1` so nested sheets come first.

### A manifest

```json
{
  "name": "ejemplo · panel",
  "expect": { "fileName": "Ejemplo" },
  "params": { "theme": "light" },
  "steps": [
    { "use": "kit/build-screen@1", "screen": "inicio", "area": "Panel" },
    { "use": "kit/place@1", "area": "Panel" },
    { "file": "scripts/ejemplo/tidy.js", "params": { "gap": 24 } },
    { "use": "kit/layout-check@1", "area": "Panel" }
  ]
}
```

A script step takes `file`, and optionally `format`, `params` (merged over the batch's, the step
wins), `assets` and `timeoutMs`. Any key the contract does not define is an error, so a typo is
rejected instead of silently ignored. The schema is
[`build-manifest@1`](contracts.md#build-manifest1).
