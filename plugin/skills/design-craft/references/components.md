# Component architecture

## Component, partial or one-off?

| Question | Yes → |
|---|---|
| Does it make sense in another role, another feature or another project? | A component of the project's library (its atom or molecule level) |
| Does it only make sense next to its screen or role? | A partial (the one closest to where it is used); in Figma, an organism |
| Does it appear once and never repeat? | It stays in the screen |

Start at the most specific level and promote only on **real duplication** (the promotion rule is set
by the project's template architecture). Atom and molecule are a mental model, not a debate: the
written criterion is "molecules compose atoms, not raw markup".

## Prop or slot?

**Props (configuration)**, only for:
- persistent **state**: `disabled`, `selected`, `invalid`, `loading`;
- **appearance**: `variant` (primary, danger…);
- **size**: `size` (sm, md, lg).

**Slot (composition)**, for:
- variable content (long texts, lists, actions, icon + text);
- optional parts (header, footer, actions);
- repeated elements (items of a list or a menu).

**Not props:**
- visibility (`show-icon`, `hide-description`) → the part appears if its content arrives;
- layout (padding, direction, width) → decided by the container, or fixed by the component itself;
- patches to one element (the colour of one text, the radius of one corner).

With slots, offer the common case ready-made: default content in the slot, or an example in the
gallery.

## Signs a component should be split

- A boolean changes the **structure** (another child order, another anatomy), not just the look.
- More than three `show-*` or `with-*` booleans.
- Prop combinations that "make no sense together".
- The template has conditionals wrapping half of it.

Fix: a subcomponent with a slot (for example `card` + `card-header` + `card-actions`), or two
components with distinct purposes. Different components when the **function** changes; variants when
only the **look** changes.

## Space and layout

- **Inside** the component: its own padding and gap, fixed and from the scale's tokens.
- **Between** components: set by the parent (gap, vertical spacing). No component carries an outer
  margin on its root.
- Responsive behaviour is solved by the container (grid, stack), not by a prop per component.

## How to check

In the project's component system, look for visibility switches in the prop declarations (`show-*`,
`hide-*`, `with-*`), the components with the most props, and margins on the root element. For
example, with props declared as `prop <name>` annotations and utility-class CSS:

```bash
rg -n "prop (show|hide|with)[-_]" <components-folder>
rg -n '^<[a-z][^>]*class="[^"]*\bm[trblxy]?-[0-9]' <components-folder>
```
