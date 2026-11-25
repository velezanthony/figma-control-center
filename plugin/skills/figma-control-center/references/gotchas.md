# What breaks

Traps seen on real files. Generic Plugin API failures are covered by Figma's official `figma-use`
skill, when installed. Before repeating a pattern below by hand, check whether the kit already does
it (last section, and https://velezanthony.github.io/figma-control-center/users/kit/).

## Plugin API

- **Cloned variants lose `componentPropertyReferences`.** After `clone()` of a variant, copy the
  references layer by layer from the original again and read them back.
- **An instance with edited text (`.characters`) moved into a SLOT** leaves its sublayers
  "nonexistent", and any `findAll` throws. Build the content apart and put a **clone** into the slot,
  at the end.
- **A slot shared by several variants:** `createSlot()` in each, point `slotContentId` at the common
  key and delete the leftover. `setProperties` does not touch slots.
- **Rebuilding a variant in place:** emptying and refilling it keeps its instances on the same
  component with texts set through properties. Inner layers are born with new ids, and Figma ties
  overrides made directly on an instance sublayer to the id, so those are lost (see "Rebuilding a
  sheet"); the instance's `overrides` list does not clear itself. `addComponentProperty` with a name
  that already exists **does not throw**: it creates `name2`. `editComponentProperty` with
  `defaultValue` or `preferredValues` keeps the key and the instances' values. A property with no
  layers stays on the set. `set.appendChild(component)` adds a variant and reads its props from the
  name. Sharing a slot with `editComponentProperty` renames the SLOT node after the property: find it
  by its `slotContentId`, not by the layer name. A SLOT accepts `slotContentId` and `visible` at once.
- **`setBoundVariableForPaint` drops the paint's opacity**: set it again.
- **Resizing an instance sublayer is ignored**; use padding. `layoutSizingHorizontal` and
  `textAutoResize` can be changed.
- **`vectorPaths` does not accept implicit lineto** after `M` (`M x y x2 y2`): write explicit `L`.
  Better: `figma.createNodeFromSvg`.
- **The open page cannot be deleted:** `setCurrentPageAsync` to another first.
- **`setFileThumbnailNodeAsync`** needs a FRAME, not an instance.
- **Ids that change:** after combining variants or moving between pages, fetch nodes by id
  (`getNodeByIdAsync`) instead of reusing references.
- **Slow traversals on large pages:** `findAllWithCriteria({ types })` instead of `findAll`, and
  `figma.skipInvisibleInstanceChildren = true` unless you need hidden instance layers.
- **`setPluginData` fails outside a plugin** ("Cannot set private plugin data in a plugin without an
  ID"): the page's `figma` object has no plugin id. Use `setSharedPluginData(namespace, key, value)`.
- **`INSTANCE_SWAP` through `setProperties`** takes a component id; anything else throws. A
  recognition rule that causes it warns `RULE_ERROR` and the node is painted anyway.
- **Texts of a new instance need their font loaded** before writing.
- **Deprecated APIs:** `getNodeById` → `getNodeByIdAsync`; `resetOverrides` → `removeOverrides`;
  `.instances` → `getInstancesAsync()`.

### Assumed by the kit, not all confirmed on real Figma

- `createComponentFromNode` on an auto-layout frame keeps the layout and returns another node: always
  follow the returned node.
- `combineAsVariants` can change each variant's id: read them back from the set by name.
- A layer inside a nested instance does not accept `componentPropertyReferences` (throws): reference
  only the component's own layers.
- `preferredValues` takes `{ type: "COMPONENT", key }` with no extra keys.
- `isExposedInstance` exists only on an instance. A `SLOT` property reads back without
  `defaultValue`.
- A set does not resize itself when a variant moves: `resizeWithoutConstraints` on the matrix.
- `insertChild` of an existing page moves it without changing its id.

## Painter and captures

- **Booleans that only reorder children** (for example a "value first" layout) have no class that
  gives them away: they are inferred from structure and weigh more when choosing a variant (sets are
  sparse).
- **Text of a nested component** (a label inside a select): its property lives on the nested
  instance; apply it to that instance.
- **Sets without text properties** (a breadcrumb, say): free texts in order plus a numeric variant
  (number of levels).
- **Tooltips and popovers**: closed state unless the capture shows the bubble.
- **Icons from an icon font** arrive as images: translate them to `icons/fa-<name>` (or the prefix the
  project uses).
- **A cell holding only a checkbox** is a bulk-selection cell; the checkbox component's label is not
  cell text.
- **Columns outside the scroll area** (actions beyond the container at 1440 px) are not visible on the
  web either: not a failure.
- **Block text in a sheet** fills its width and wraps, as in CSS; on a screen it hugs its content.

## Rebuilding a sheet

- **A rebuild recreates the layers inside each variant with new ids** and would lose overrides made
  directly on sublayers of that component's instances on other screens. Before painting, the step
  inspects those instances. If any has inner overrides, the sheet is not written
  (`overrides-at-risk`) until the person decides in `drift` of `sheets.json`, with the report's
  fingerprint. If Figma changes afterwards, the fingerprint no longer matches and it stops again
  (`fingerprint-changed`).
- **What comes back and what does not:** overrides are read by their path (names and index among
  siblings) and reapplied to the layer at that path after the rebuild. Texts, visibility and nested
  instance properties come back. Anything else (fills, strokes, reactions…) and anything on a layer
  that no longer exists is reported in the `OVERRIDES_LOST` warning with its path and value: tell the
  person.

## Areas

- **`kit/place@1` in `replace-content` mode empties the whole frame**, including the instance of the
  shared content; it only keeps the sets in `place.keep`. In an area with shared pages, `kit/share@1`
  always follows. Without it, the frame holds loose content and the other areas' variants go stale.

## Screens

- **A rebuild loses** shared content, prototype links and maps. Restore all three
  ([pipeline.md](pipeline.md), stage 4).
- **Screens with header and footer as instances and hand-made interactions** (hero, modal): only a
  transplant (`kit/place@1` in `transplant` mode) or a patch as a step of the project's own.
- **Links at zero** (`×0`) are often buttons the web no longer has (for example a "Back" that is now
  a breadcrumb). Check before "fixing" it.
- **Open tooltips or default texts** (the component's sample texts) mean a failed match: review the
  chosen variant before the texts.

## Which kit piece solves each trap (`kit` in scripts: `figma-kit@1`)

What the kit does not cover is still the script's job.

- Clones losing `componentPropertyReferences` → `kit.component.cloneVariant`.
- Instance with edited text moved into a slot → `kit.slot.fill` (puts a clone in, at the end).
- Slot shared by several variants → `kit.slot.share`.
- `setBoundVariableForPaint` losing opacity → `kit.paints.set` with `{ bind, opacity }`.
- `vectorPaths` without `L` → `kit.icons.fromSvg` (`createNodeFromSvg`).
- The open page cannot be deleted → `kit.page.remove`.
- Ids that change → `kit.node.get` (`getNodeByIdAsync`) and keys instead of ids: `kit.node.tag` and
  `kit.node.byKey`.
- Slow traversals → `kit.component.find` (`findAllWithCriteria`, with a checked cache) and
  `kit.node.byKey`.
- `setPluginData` failing outside a plugin → `kit.node.tag` (`setSharedPluginData`, namespace `fcc`).
- Text of a nested component → `kit.instance.create` applies the text to the instance that owns the
  property; `Show …` booleans with no content are turned off.
- Choosing a variant in sparse sets → `kit.component.variant` (with `strong` for props that must
  match).
- Fonts → `kit.fonts.ensure` and `kit.fonts.load`. Single-mode variables → `kit.tokens.load` (with
  more modes it warns and uses the default one).
- A repeated step must not duplicate → `kit.frame.ensure` and `kit.page.ensure` (by key), and
  `kit.track()` to declare what was created, changed and removed.
- Rebuilding a frame loses links, components and maps → `kit.frame.replaceContent` empties and
  refills without deleting the frame (its id is kept); `kit/place@1` uses it.
- A prototype link can only target a frame on its own page → `kit.links.to` fails with
  `LINK_OTHER_PAGE`; `kit/share@1` removes the links before moving a layer to another page.
- A stored duration comes back as a 32-bit float → `kit.links.to` compares with tolerance: repeating a
  link changes nothing (`unchanged`).
- `numberOfFixedChildren` sometimes throws; with auto-layout only the last children outside the flow
  (`ABSOLUTE`) count → `kit/place@1` makes the shell layer `ABSOLUTE` and last and, if it still does
  not stay fixed, warns `FIXED_FAILED`.
- Copying layout: some properties throw depending on the node → `kit.frame.replaceContent` copies
  them one by one and warns `LAYOUT_PROP` with the name.
- `flowStartingPoints` is assigned whole (a short list erases the others) → `kit.flow.start`.
- Painting a screen from a capture → `kit.screen.paint` and `kit/build-screen@1`: colour is bound
  with `kit.tokens.paint` (classes of the node and its ancestors, then the fallback collection; RGB
  and alpha compared separately); the whole font is loaded BEFORE writing a text (a missing one gives
  `FONT_MISSING` with nothing written); a text only gets what differs from its text style (touching
  line height, letter spacing or case detaches it); an image over 4096 px comes out as a rectangle
  with no image (`IMAGE_TOO_LARGE`); `scrollBehavior` on an auto-layout child may not stick
  (`SCROLL_BEHAVIOR`); stretch, grow or `FILL` on a child of a frame without auto-layout may throw
  (`LAYOUT_PROP`). The last three are not all confirmed on real Figma.
- Removing a variant from a set leaves its instances in other frames pointing at the removed one →
  `kit/share@1` does not remove it: it rebuilds it in place (same id) and reapplies or reports
  (`OVERRIDES_LOST`) those instances' overrides.
- A variant change (`CHANGE_TO`) is only valid on an instance of its set; Figma rejects it on any
  other node by throwing → `kit.links.restore` drops it with `REACTION_DROPPED`.
  `setReactionsAsync` replaces every reaction → `kit.links.to` and `kit.links.restore` only change the
  one for their trigger.
- An image over 4096 px per side, or not PNG, JPEG or GIF, fails → `kit/fill-image@1` rejects it
  first with `IMAGE_UNSUPPORTED`.
- Text hidden by an ancestor is not button text → `kit.links.byText` and `kit.links.capture` only
  read visible text.
