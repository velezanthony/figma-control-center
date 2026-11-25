# Flow: from the web to Figma

Four stages and a check, all with `figma_*` tools and kit steps. What belongs to the project is
**data**: it lives in the project directory, at the paths its `figma-control-center.json`
(`project@1`) declares: `screens@1`, `map@1`, `areas@1`, `sheets@1`, `recognize.js` and the step
manifests. What each file accepts: https://velezanthony.github.io/figma-control-center/users/contracts/
and the JSON Schemas at `https://github.com/velezanthony/figma-control-center/blob/main/schemas/`.

## 1. Capture the web

- `figma_capture { screens: ["<key>", …] }` captures the screens of `screens.json` in a separate
  Chrome, signed in as each screen's `session` user. It does not touch Figma.
- A valid capture lands in `web-captures/<day>/` of the project's output folder; one that fails
  `capture@1` lands in `rejected/` with its errors. Read the file, not the response, for the tree.
- What the URL alone does not produce is declared on the variant in `screens.json`: `query` per
  variant, `viewport` per screen or per variant (the mobile view), `force` for a CSS state (`hover`,
  `focus`, `focus-visible`, `active`), `run` actions and an `until` condition.
- A screen that depends on environment data (a stateful flow, a freshly created user) is not
  recaptured until that data is ready.

## 2. Build in Figma

**Screens.** `{ "use": "kit/build-screen@1", "screen": "<key>", "area": "<area>" }` paints a screen
from its latest valid capture and `map.json`. Without `area` it goes to the page
`fcc · pantalla · <key>`. `figma_build { areas }` adds it by itself before each screen with a capture.

- Components are recognised by `recognize.js` (hand-written rules) and by the fingerprints in
  `map.components`; `map.screens.<key>.rules` limits the rules per screen. What is not recognised is
  painted as frames, texts, SVGs and images.
- Each match is in the step's `report.matches` (`figma_history_call` with `step`).
- If a code component changed, recompute the fingerprints (the file `map.components` points to)
  before building.
- A screen with no capture yet keeps the frame already in Figma.

**Component sheets.** Each sheet comes from the capture of the screen named in its `screen` field
(by convention a gallery screen such as `cmp-<key>`) and from its entry in `sheets.json`.

- `{ "use": "kit/build-component@1", "sheet": "<key>" }` paints it; with `scratch: true`, on the
  separate page `fcc · hoja · <key>`.
- `figma_build { sheets: ["<key>", …] }` builds one step per sheet in the order of `sheets.json`
  (nested sheets first). A sheet without a valid capture is listed in `skippedSheets` with
  `NO_SOURCE`.
- **If the sheet exists, it is rebuilt over its set**: same set id, same id for each variant matched
  by props, and properties kept by name. The inside of each variant is repainted and its layers get
  new ids (see [gotchas.md](gotchas.md), "Rebuilding a sheet").
- Properties made by hand in Figma that the data does not declare are listed in the sheet's `keep`;
  without that the step refuses (`SHEET_HAND_EDITS`). A slot is declared with `slots`.
- **The step writes nothing and a person decides** when Figma is ahead of the web (`SHEET_DRIFT`:
  props or variants the capture does not have, hand-made layers) or when instances on other screens
  have overrides on inner layers (`overrides-at-risk`). The full report is saved in `reads/` of the
  output folder (file name starting with `desfase_<sheet>`) and in the step's history; the other
  sheets of the batch carry on. Tell the person, and write their decision in the sheet's `drift` with
  the report's fingerprint: `figma` (skip), `web` (rebuild) or `map` (values added to the web's
  variants).
- A page holding content that is not the sheet is not repainted (`SHEET_EXISTS`).
- `source` (the component's template path) is sheet data that `kit/build-component@1` does not
  paint: `figma_design_context` reads it to say which template each instance maps to. Without it, that
  sheet gives `NO_CODE_MAPPING` going from Figma to code.
- Before rebuilding, run `figma_instances` to see what uses the set. Afterwards, check that the set
  id, its variant ids and the property keys are unchanged.

## 3. Place into areas

What changes from one area to another is data in `areas.json`; the kit paints it. In a manifest, each
step is `{ "use": "kit/<step>@1", "area": "<area>" }`.

| What | Kit step |
|---|---|
| Screen into its frame, with the shell variant of its area, keeping the frame id | `kit/place@1`, mode `replace-content` |
| Screen whose header and footer are instances: the whole central content; keeps them and restores links by text | `kit/place@1`, mode `transplant` |
| Only some blocks of a screen | No kit step: a step of the project's own (a script with the `step@1` header) |
| Several areas in a row | `figma_build { areas: [...] }` assembles `place` → `share` → `links` → `fill-image` per area, no manifest |

The source screen comes from `kit/build-screen@1` (with `take: "first-frame"` in the area's
`place.source`). After editing `areas.json`, run `figma_build { areas: ["<area>"] }`; repeating it
duplicates nothing.

`kit/place@1` in `replace-content` mode empties the whole frame, including the instance of the shared
content (it only keeps the sets in `place.keep`). That is why, in an area with shared pages,
`kit/share@1` always follows.

## 4. After rebuilding (do not skip)

1. `kit/share@1`: content common to several areas becomes a component with one variant per area
   (the groups are in `shared` of `areas.json`). Without it, the frame holds loose content and the
   other areas' variants go stale.
2. `kit/links@1`: prototype links, starting point and clipping (`links` and `flowStart` of each
   area). A link at zero raises `LINK_ZERO`; the full report (`report.links`) is in the step result.
3. `kit/fill-image@1`: puts a real image as the fill of embedded maps or similar placeholders
   (`fills` of the area; the image goes by path). Maps are lost on rebuild. To find maps without a
   fill, look for a large frame (over 300×200) with the map controls (for example a "+" text) and no
   image fill.
4. `kit/layout-check@1`: overlapping texts, collapsed containers and misaligned rows per frame
   (`report.layout`). `figma_build { areas }` does not add it: ask for it.

## Mobile

Mobile screens are `screens.json` screens with their own `viewport` and an area of their own; links
and maps go through `kit/links@1` and `kit/fill-image@1`. An overlay menu (open with a hamburger,
close on the backdrop) is not done by the kit: it is a step of the project's own (`step@1`).
