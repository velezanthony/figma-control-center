# Component spec

The spec lives in **two places that do not copy each other**: the component's declaration in code
(its description, props and slots) is the API; the set's description in Figma links to the
component's path and summarises its use. The project's gallery or catalog, if any, is the live
example.

## What a spec covers (in this order)

1. **What it is**: one sentence.
2. **When to use it and when not**, and what to use instead. This is the most valuable part.
3. **Anatomy**: its parts, and which are optional (slots).
4. **API**: props (state, appearance, size) and slots. The code declares them; they are not repeated
   elsewhere.
5. **States**: the part of the [states-a11y.md](states-a11y.md) matrix that applies.
6. **Content**: text length, verbs, capitalisation, numbers in the format the project sets.
7. **Accessibility**: role, keyboard, focus, labels.
8. **Do / Don't**: one or two examples of common misuse.

## Keeping it honest

- The API is read from the code; the spec **points**, it does not copy (a copied signature goes
  stale).
- A known limitation is written down ("does not support more than one nesting level"). A spec that
  hides gaps is worse than none.
- Changing a component includes updating its declaration, its gallery example and its Figma set in
  the same change.

## In Figma

Set description: what it is + when to use it + template path (the same as `source` in `sheets@1`).
The set's properties carry the same names as the code's props.
