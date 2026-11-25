---
name: design-craft
description: Design criteria for a project's design system (its components and templates in code, and their mirror in Figma) - component architecture, props versus slots, design tokens, interaction states, accessibility, component specs and design review. Use it when designing or extending a component, deciding whether something is a component, a partial or a one-off, adding a prop, a variant or a token, reviewing a screen or a component, auditing design-system drift between code and Figma, or documenting a component.
---

# Design criteria

The `rg` commands in these notes are templates: adapt paths and patterns to the project's own
component system and run them there. Where a specific technology is named, it is only an example.

This skill says **what is well designed**. How to do it in Figma is in the `figma-control-center`
skill; how a component is written and where each template lives, in the project's own conventions.

## Process: plan, critique, build

1. **Search before creating.** Look in the project's component folder and its gallery or catalog (if
   it has one). If something similar exists, extend it; a parallel component is debt.
2. **Write the plan in four lines** before touching anything: what it is (component or partial), its
   API (props + slots), the states it needs and the tokens it uses.
3. **Critique the plan** against the references below. If a new prop appears, justify why it is not
   a slot; if a new token appears, why an existing one does not fit.
4. **Build** in code; Figma mirrors it afterwards.
5. **Review** with [references/review.md](references/review.md) and offer to check it in a browser.

## The five rules broken most often

1. **Common things configurable; rare things composable.** Props only for state, appearance
   (variant) and size. Optional or variable content goes in a slot.
   → [components.md](references/components.md)
2. **No new visibility switches** (`show-x`, `hide-y`): an optional part renders when its content
   arrives (a slot, or an empty text prop).
3. **No component sets its own outer margin.** Spacing between pieces is the container's job (the
   parent's gap or spacing).
4. **Colours by function, not by hue.** In components, a token such as `text-secondary` before a
   palette tone such as `gray-500`. → [tokens.md](references/tokens.md)
5. **Every state designed**, including visible focus, disabled, empty and error.
   → [states-a11y.md](references/states-a11y.md)

## References

| File | When |
|---|---|
| [components.md](references/components.md) | Component, partial or one-off? Prop or slot? Split the component? |
| [tokens.md](references/tokens.md) | Adding or using colours, typography, spacing, radii, shadows |
| [states-a11y.md](references/states-a11y.md) | States of an interactive component and accessibility requirements |
| [spec.md](references/spec.md) | Documenting a component (spec) |
| [review.md](references/review.md) | Reviewing a screen, a component or the whole system |

## Sources

Nathan Curtis, *Configuration Collapse* (nathanacurtis.substack.com/p/configuration-collapse) ·
Adobe Spectrum, *State model* (opensource.adobe.com/spectrum-design-data/spec/state-model/) and
*Design tokens* (spectrum.adobe.com/page/design-tokens/) · Atlassian, *Design tokens* · IBM Carbon,
*Color tokens* · GOV.UK, *How we document components* · WCAG 2.2 SC 2.5.8.
