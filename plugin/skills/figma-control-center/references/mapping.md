# Code to Figma

## File organisation

An example organisation (the one `sheets@1` sets with its `sections`, and the one each project
declares): design-system pages (foundations: colours, typography, radii, icons), atoms, molecules,
organisms and templates, then the product pages (screens per area). Child pages indented with three
spaces, grandchildren with six. No numbers in page names. One component = one page named after it.

## Components

| Code | Figma |
|---|---|
| A component's template (its `source` in `sheets@1`, for example `components/atoms/button.html`) | Set `Button` on the page `   Button`; the description carries the template path |
| A prop that chooses between values, or a boolean prop | Variant with the same name and values |
| A text prop | TEXT property with the code's name |
| An optional part that depends on a prop in code | BOOLEAN `Show …` bound to `visible` (if the content is free, prefer a slot) |
| An icon to choose | INSTANCE_SWAP `Icon` (preferred values: `icons/*`) |
| A slot or free content | Native SLOT (`component.createSlot()`), with `Show …` if optional |
| A component inside another | Nested instance; if one of several is chosen, INSTANCE_SWAP with `preferredValues` |
| A partial of one screen or area | Organism, not atom |

Before adding a property to a set, check whether the code has that prop. If it does not, it is
visibility or content (a Figma-only property), never a new variant.

## Icons

- Own catalog: `icons/<name>` components on an icons page (a grid of cells: frame + component +
  label). The catalog is declared in `map@1` (`icons`).
- If the web also uses an icon font (for example Font Awesome), those icons go in as
  `icons/fa-<name>` with the real glyph, taken from the font the web serves. Do not replace them with
  a "similar" icon.
- A new icon: prefer `figma.createNodeFromSvg(svg)` (or `kit.icons.fromSvg`) and bind its colour to a
  variable, over converting paths by hand. A new cell in the grid: clone a cell holding **a single**
  icon (a cell with two icons drags the extra one along).
- Icon colour: stroke or fill bound to a variable; the painter repaints with the captured colour
  after a swap.

## Tokens

- Source: the file `map.tokens` points to. COLOR variables named exactly like the token
  (`brand-500`, `text-primary`, `surface`…).
- Levels (palette and semantic) and when to create a token: `design-craft` → tokens.md. In Figma
  components, bind to the semantic token when one exists.
- Text styles by family, size and weight; monospace ones by size + line height + letter spacing +
  case.
- No raw colours from the CSS framework's palette: if a capture brings a colour with no variable, it
  is a failure to review, not a hex value to keep.

## Extending a component: a table cell example

A table-cell component can carry: text (`content`, `subtitle`), an icon next to the text
(`Show icon` + `Icon`), one component (`Component`: an INSTANCE_SWAP among, say, a badge, a button
or an action menu) and a free slot (`Show slot` + `Slot`, a native slot) for custom cells (avatar +
lines, person + badge…). New cases go into the slot instead of new variants.
