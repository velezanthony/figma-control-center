# States and accessibility

## Two kinds of state (Adobe Spectrum model)

| Kind | Origin | Examples | In code | In Figma |
|---|---|---|---|---|
| **Persistent** | Set by the code (prop) | `disabled`, `selected`, `invalid`, `read-only`, `loading` | Component prop | `state` variant |
| **Interaction** | Caused by the user | `hover`, `focus-visible`, `active` | Pseudo-class styles (`:hover`, `:focus-visible`) | `state` variant (to document) |

**Priority:** `disabled` beats every interaction state (a disabled button does not change on hover).
**Focus overlays**: the focus ring shows even when the element is selected or invalid.

## Required matrix

Every interactive component designs and tests: default · hover · focus-visible · active · disabled.
Depending on its function, also: loading · error/invalid · selected · empty · partial data.
A screen with data designs: with data · empty · loading · error.

## Accessibility (gate)

- **Contrast** (WCAG): 4.5:1 for normal text, 3:1 for large text and UI elements (input borders,
  informative icons).
- **Visible focus** on everything interactive, with the same treatment across the system; never
  remove the outline (`outline: none`) without a replacement.
- **Touch target** at least 24×24 px (WCAG 2.2, 2.5.8); for icon buttons, the target counts even if
  the icon is smaller.
- **Native semantics** first: `<button>` for actions, `<a>` to navigate, a `<label>` tied to each
  field, errors linked to their field.
- **Not colour alone**: a state (error, success, pending) also carries text or an icon.
- **Motion**: respect `prefers-reduced-motion` in non-essential animations.
- Button labels: a concrete verb ("Save changes", "Create request"), not "Submit" or "OK".

## How to check

Look in the project's templates for focus removed without a replacement, and actions hung on a
`<div>` instead of a `<button>`. For example, with utility-class CSS and inline handlers:

```bash
rg -n "outline-none" <templates> | rg -v "focus-visible"
rg -n "<div[^>]*on(click|keydown)=" <templates>
```

In a browser: go through the screen with the keyboard only and check that focus is always visible.
