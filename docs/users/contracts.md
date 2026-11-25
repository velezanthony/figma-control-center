---
seo:
  title: "JSON contracts for Figma projects"
  description: "Reference for the versioned JSON contracts a project exchanges with the Figma MCP server: project, screens, map, sheets, compose, design context and more."
---

# Contracts

The tool knows nothing about any particular project. It publishes **contracts** — versioned data
shapes, like the inputs and outputs of an API — and each project signs them by supplying its data.
A contract is a zod schema in `server/src/adapters/contracts/`, published as a JSON Schema in
[`schemas/`](https://github.com/velezanthony/figma-control-center/tree/main/schemas); a test
fails if the two drift apart.

> [!IMPORTANT]
> Every contract is **strict**: a key the contract does not define is an error, not ignored. A typo
> (`timoutMs`) is rejected instead of silently dropping your value. Checks the schema cannot express —
> unique ids, regular expressions that compile, cross-references between files — run in the domain
> (`server/src/domain/*-check.ts`) and report each problem with a JSON pointer.

| Contract | Written by | Read by | Lives in |
|---|---|---|---|
| [`project@1`](#project1) | You | `figma_capture`, the kit steps, `figma_design_context` | `figma-control-center.json` in the project directory |
| [`screens@1`](#screens1) | You | `figma_capture` | The project directory |
| [`capture@1`](#capture1) | `figma_capture` | `kit/build-screen@1`, `kit/build-component@1` | `web-captures/` in the output folder |
| [`areas@1`](#areas1) | You | `figma_build` with `areas`, area kit steps | The project directory |
| [`map@1`](#map1) | You | Screen and sheet painters, `figma_design_context` | The project directory |
| [`screen@1`](#screen1) | The server | `kit/build-screen@1` | `screen-plans/` in the output folder |
| [`sheets@1`](#sheets1) | You | `figma_build` with `sheets`, `figma_design_context` | The project directory |
| [`component@1`](#component1) | The server | `kit/build-component@1` | `sheet-plans/` in the output folder |
| [`compose@1`](#compose1) | You (or the agent) | `kit/compose@1` | `compose/<key>.json` in the project directory |
| [`design-context@1`](#design-context1) | `figma_design_context` | The agent writing the template | `reads/` in the output folder |
| [`step@1`](#step1) | Any script with the header | `figma_run_script`, `figma_build` | The result of the step |
| [`build-manifest@1`](#build-manifest1) | You | `figma_build` | Anywhere inside the scripts roots |

> [!NOTE]
> Two more are **code** rather than data, and so have no JSON Schema: the capture hooks
> (`hooks.js`, `capture@1` hooks) and the recognition rules (`recognize.js`, `recognize@1`). Both are
> written by the consumer project and are never executed by the server.

The minimal examples below come from the fixture
`server/test/fixtures/projects/example-mini/`, which holds a complete set.

## `project@1`

[Schema](https://github.com/velezanthony/figma-control-center/blob/main/schemas/project.v1.json).
How to reach the project's web and where its other files are. Required: `contract`, `web`, `screens`.

`web` holds `baseUrl` (navigation never leaves it), `viewport` (`w`, `h`, optional scale factor),
an optional `login` form (`path`, `fields.user`, `fields.password`, optional `submit`), `users` (each
with a `username` and a `secretRef` resolved from `FCC_WEB_SECRETS_FILE`, never the password
itself), `strip` (selectors removed before capturing) and `hideScrollbar`. The other keys are paths,
relative to the file: `screens`, `hooks`, `areas`, `map`, `recognize`, `sheets`, `compose`.

```json
{
  "contract": "project@1",
  "web": { "baseUrl": "http://127.0.0.1:8000", "viewport": { "w": 800, "h": 600 } },
  "screens": "screens.json"
}
```

## `screens@1`

[Schema](https://github.com/velezanthony/figma-control-center/blob/main/schemas/screens.v1.json).
The screens to capture. Each one has a `key` (it names the output files: no slashes or dots), a
`title` and a `url` under `baseUrl`, and optionally `session` (a user from `project@1`), `pick` (a
selector: capture only that element), `viewport`, `until` (a condition to wait for) and `variants`.
A variant has `props` (what makes it different, used later as variant properties) and optionally
`query`, `run` (`click` or `evaluateInPage` actions), `force` (`{ selector, state }` to force a CSS
state), `viewport` and `until`.

```json
{
  "contract": "screens@1",
  "screens": [{ "key": "inicio", "title": "Inicio", "url": "/" }]
}
```

## `capture@1`

[Schema](https://github.com/velezanthony/figma-control-center/blob/main/schemas/capture.v1.json).
The result of capturing one screen: `screen`, `title`, `source`, one entry per variant with its node
tree, `props` and annotations, the `images` (referenced by `ref`, never inlined as `data:` URLs), and
`warnings`. Every node carries an `id` and a `path`, so an error points to the exact node. You never
write it; read it when a capture is rejected.

## `areas@1`

[Schema](https://github.com/velezanthony/figma-control-center/blob/main/schemas/areas.v1.json).
The areas of the Figma file. Required: `contract`, `linkRules` (what counts as clickable, how table
rows are recognised, the prototype transition) and `areas`. Each area has a `name`, a `page`, a
`frame` (`width`, `minHeight`, optional `fill` variable and `clip`), a `place` rule (`mode`, the
temporary pages' `source`, what to `keep`/`drop`/`unwrap`), its `screens` (frame name, optional
screen key and shell variant), and optionally a `shell`, `links`, `flowStart` and image `fills`.
`shared` groups content common to several areas into one component.

```json
{
  "contract": "areas@1",
  "linkRules": {
    "clickable": { "names": ["boton"], "namePrefixes": [], "components": ["Boton"] },
    "rows": { "row": ["fila"], "body": ["cuerpo"] },
    "transition": { "type": "DISSOLVE", "easing": "EASE_OUT", "duration": 0.2 }
  },
  "areas": [
    {
      "name": "Portada",
      "page": "Portada",
      "frame": { "width": 1280, "minHeight": 800 },
      "place": { "mode": "transplant", "source": { "pagePrefix": "tmp ", "take": "first-component" } },
      "screens": [{ "frame": "Portada" }]
    }
  ]
}
```

## `map@1`

[Schema](https://github.com/velezanthony/figma-control-center/blob/main/schemas/map.v1.json).
How the project's code maps to Figma. Required: `contract`, `tokens` (variable collections, class
prefixes for fill, text and stroke, rules from class to variable name, numbers for radius and
spacing), `fonts` (families by pattern, default family, weight to style, italics), `icons` (pages,
prefix and the `icons.json` catalog) and `layers` (layer names by HTML role). Optional: `effects`,
`screen` (background), `components` (the `fingerprints.json` file, leaf components, generic classes
to ignore) and per-screen recognition `rules`.

```json
{
  "contract": "map@1",
  "tokens": {
    "collections": ["Base"],
    "classPrefixes": { "fill": ["bg-"], "text": ["text-"], "stroke": ["border-"] },
    "classToVariable": [{ "from": "^(.+)$", "to": "$1" }]
  },
  "fonts": {
    "families": [],
    "default": "Sans",
    "styles": { "400": "Regular", "700": "Bold" },
    "italic": { "suffix": "Italic" }
  },
  "icons": { "pages": "Iconos", "prefix": "icons/", "catalog": "icons.json" },
  "layers": { "roles": { "header": "cabecera", "main": "principal" }, "textPrefix": true }
}
```

## `screen@1`

[Schema](https://github.com/velezanthony/figma-control-center/blob/main/schemas/screen.v1.json).
The plan of one screen, built by the server from a capture and `map@1`: the target, the chosen
variant and props, the capture's node tree unchanged, and the images, icons and mapping it needs. You
never write it; it is what `kit/build-screen@1` paints, and an attempt keeps it so two builds can be
compared.

## `sheets@1`

[Schema](https://github.com/velezanthony/figma-control-center/blob/main/schemas/sheets.v1.json).
One sheet per component. Required: `contract`, `style` (the header, card, text and matrix variables
of the sheet pages) and `sheets`. Each sheet has a `key`, the captured `screen` that shows it, a
`title`, a `page`, a `description`, the `tag` and the template file it comes from (`source`), the
variant `matrix`, the `texts` that become text properties and optional recognition `rules`. Optional
`sections` group sheets.

```json
{
  "contract": "sheets@1",
  "style": {
    "header": { "fill": "gris/900", "text": "gris/50" },
    "card": { "fill": "gris/50" },
    "texts": { "description": "gris/900", "bug": "gris/900", "tag": "gris/900", "rowLabel": "gris/900", "colLabel": "gris/900" },
    "bug": { "prefix": "Fallo: ", "setPrefix": "FALLO: " },
    "matrix": { "stroke": "gris/900" }
  },
  "sheets": [
    {
      "key": "marca", "screen": "cmp-marca", "title": "Marca",
      "page": { "name": "Marca" }, "description": "La marca de la cabecera",
      "tag": "<span class=\"marca\">", "source": "plantillas/marca.html",
      "matrix": { "rows": ["tamano"] }
    }
  ]
}
```

## `component@1`

[Schema](https://github.com/velezanthony/figma-control-center/blob/main/schemas/component.v1.json).
The plan of one sheet, built by the server from the gallery capture, `sheets@1` and `map@1`: one node
tree per variant, the matrix, the style and the mapping. Like `screen@1`, it is generated, never
written by hand.

## `compose@1`

[Schema](https://github.com/velezanthony/figma-control-center/blob/main/schemas/compose.v1.json).
A screen designed in Figma with no web behind it. Required: `contract`, `key`, `title`, `target`
(`page`, `width`, optional `frame` and `height`) and `root`, a block. A block is exactly one of a
stack, an instance of a sheet, a text, an image or an icon — a block mixing two kinds fails. Every
value other than text content names a variable or a style. See
[Workflows](workflows.md#designing-without-a-web-compose1).

```json
{
  "contract": "compose@1",
  "key": "card",
  "title": "Ficha de ejemplo",
  "target": { "page": "Pruebas", "width": 480 },
  "root": { "stack": "VERTICAL", "gap": "espacio/m", "children": [{ "text": "Hola", "style": "Título/L" }] }
}
```

## `design-context@1`

[Schema](https://github.com/velezanthony/figma-control-center/blob/main/schemas/design-context.v1.json).
What `figma_design_context` writes: the `file` and `readAt`, the `origin` of the frame, the `root`
node and the `nodes` breadth-first, the resolved `variables` and `styles`, the `components` with their
sheet and template (`code.source`, `code.tag`, `code.by`), `warnings` (such as `NO_CODE_MAPPING`) and,
when the node cap was hit, `truncated` with the ids left out. See
[Workflows](workflows.md#figma-to-code).

## `step@1`

[Schema](https://github.com/velezanthony/figma-control-center/blob/main/schemas/step.v1.json).
The result of a script whose first line is `// @contract step@1 · <what it does>`, and of every kit
step.

```json
{ "createdNodeIds": ["1:2"], "mutatedNodeIds": ["1:3"] }
```

`removedNodeIds`, `warnings` (`{ code, message, nodeId? }`) and `report` are optional.
`kit.track().done()` returns a compliant result; see [The Figma kit](kit.md#step1-scripts-whose-result-is-checked).

## `build-manifest@1`

[Schema](https://github.com/velezanthony/figma-control-center/blob/main/schemas/build-manifest.v1.json).
A batch for `figma_build`: optional `name`, `expect` (`{ fileName }`, a guard on the open file) and
shared `params`, and at least one step. A step is a script (`file`, `format`, `params`, `assets`,
`timeoutMs`) or a kit step (`use` plus its target). See [The Figma kit](kit.md#kit-steps).

```json
{
  "expect": { "fileName": "Ejemplo" },
  "steps": [{ "use": "kit/build-screen@1", "screen": "inicio" }, { "file": "scripts/ejemplo/tidy.js" }]
}
```
