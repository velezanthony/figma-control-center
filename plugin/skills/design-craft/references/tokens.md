# Tokens

Single source: the project's tokens file (the one `map.tokens` points to, and from which Figma takes
its variables). Figma has one variable per token with the same name; Figma is never edited without
the code.

## Levels

| Level | What it is | Family examples | Who uses it |
|---|---|---|---|
| Palette (primitive) | Raw value, no intent | `brand-*`, `gray-*`, `success-*`, `danger-*`… | Only other tokens and cases with no semantic role |
| Semantic (function) | Intent of use | `text-*`, `surface`, `border`, `canvas-*`, `status-*` | Components and screens |
| Component | A single component's exception | — | Only that component |

Rule: **in components, the semantic token first**. Use the palette only when no role describes the
need; if the same tone is repeated for the same function in several places, a semantic token is
missing.

To see what each level holds, list the tokens of the source file (for example the CSS custom
properties `--color-*`).

## When to create a token

- It is a **repeated decision** (same value, same function, several components) → token.
- It is a one-off value → not a token; check whether the piece should use an existing one.
- **Name by function**, from general to specific: what it communicates → what it affects → when
  (`text-secondary`, `border-subtle`, `status-pending`). Never by hue (`gray-light`).
- A new token ships in the same change as its first use and its Figma variable.

## Scales

- Spacing, radii, shadows and typography: **closed scales** of the system. No invented in-between
  values (a stray `13px`); if a step is needed, add it to the scale with a name.
- Typography: the family, weights and sizes of the project's scale.
- Numbers and units: in the format the project sets, not by hand.

## Dark theme (preparation)

A theme is achieved by changing only the semantic level's values. The more components use the
palette directly, the more expensive the theme. Every palette use in a component is debt to measure,
not to hide.

## How to check

Look in the project's templates for raw colours from the CSS framework's palette, arbitrary values,
and palette tones where a semantic token may belong. For example, with utility-class CSS:

```bash
rg -n "(bg|text|border)-(red|blue|green|yellow|slate|zinc|neutral)-[0-9]" <templates>
rg -n "\[(#|[0-9]+px)" <templates>
rg -c "text-gray-[0-9]" <components>
```
