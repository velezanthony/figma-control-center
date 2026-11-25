# Design review

Three modes. Pick the one the task asks for and do not mix them.

## 1. Review a component

Go through in order and note findings:
1. Should it be a component? ([components.md](components.md))
2. API: only state, appearance and size as props? `show-*` switches? Layout as a prop?
3. Tokens: semantic? Raw colours or arbitrary values? ([tokens.md](tokens.md))
4. States: full matrix? Right priority? ([states-a11y.md](states-a11y.md))
5. Accessibility: contrast, focus, touch target, semantics.
6. Spec: annotations, gallery example, Figma set aligned ([spec.md](spec.md)).

## 2. Review a screen

1. Does it use components, or recreate by hand something that exists? (In Figma, `figma_instances`
   lists the instances of each top-level frame.)
2. Visual hierarchy: one main focus; size, weight and colour do the work, not borders or boxes;
   grouping by proximity.
3. Spacing: on the scale, steady rhythm, space between blocks set by the container.
4. Screen states: with data, empty, loading, error.
5. Texts: concrete verbs, correct domain terms, numbers in the format the project sets.
6. Keyboard accessibility.

## 3. Audit the system (drift)

- Raw colours and arbitrary values (commands in [tokens.md](tokens.md)).
- Components with the most props and visibility switches (commands in
  [components.md](components.md)).
- Code versus Figma: the drift audit (code props versus variants) should come out empty — compare
  `figma_components` with the props declared in code; the sheet step warns `SHEET_DRIFT` — and no
  screen should recreate by hand a component that exists.
- Components without a gallery example (if the project has a gallery) or without a description in
  their declaration.

## Findings format

One per line, sorted by severity:

```
[blocking] <path>:<line> — `outline-none` without `focus-visible:` → focus is invisible from the keyboard
[major]    <components>/map.html:12 — `show-marker`/`show-circle`: visibility as a prop
[minor]    <components>/page-header.html:10 — `mb-6` on the root: the container sets the margin
```

- **blocking**: breaks accessibility, uses raw colours or duplicates an existing component.
- **major**: badly shaped API, missing states, a palette token where a semantic one exists.
- **minor**: off-rhythm spacing, improvable text.

Propose a fix for each, but **do not apply it without permission** if it changes a shared component:
first measure how many places use it.
