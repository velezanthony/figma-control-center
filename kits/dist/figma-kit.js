"use strict";
(() => {
  // kits/figma/types.ts
  var AREA_KEY_PREFIX = "fcc:area:";
  var SHARED_KEY_PREFIX = "fcc:shared:";
  var COMPOSE_KEY_PREFIX = "fcc:compose:";
  var COMPOSE_PAGE_KEY_PREFIX = "fcc:compose-page:";
  var composePageKey = (compose2) => `${COMPOSE_PAGE_KEY_PREFIX}${compose2}`;
  var composeKey = (compose2) => `${COMPOSE_KEY_PREFIX}${compose2}`;
  var SHEET_KEY_PREFIX = "fcc:sheet:";
  var SHEET_VARIANT_KEY_PREFIX = "fcc:sheet-variant:";
  var SHEET_SCRATCH_KEY_PREFIX = "fcc:sheet-scratch:";
  var KIT_VERSION = "figma-kit@1";
  var KIT_GLOBAL = "__fccFigmaKit";
  var KIT_SHA_GLOBAL = "__fccFigmaKitSha";
  var NS = "fcc";
  var KEY = "key";
  var FAIL_MARKER = "__fcc_kit_fail__:";

  // kits/figma/core.ts
  var figmaApi = () => globalThis.figma;
  var states = /* @__PURE__ */ new WeakMap();
  function stateOf() {
    const f = figmaApi();
    let state = states.get(f);
    if (state === void 0) {
      state = { components: /* @__PURE__ */ new Map(), fonts: /* @__PURE__ */ new Set() };
      states.set(f, state);
    }
    return state;
  }
  var idOf = (ref) => typeof ref === "string" ? ref : ref.id;
  var refsOf = (what) => Array.isArray(what) ? what : [what];
  function createTracker() {
    const created = /* @__PURE__ */ new Set();
    const mutated = /* @__PURE__ */ new Set();
    const removed = /* @__PURE__ */ new Set();
    const warnings = [];
    const add = (into) => (what) => {
      for (const ref of refsOf(what)) into.add(idOf(ref));
      return what;
    };
    return {
      created: add(created),
      mutated: add(mutated),
      removed: add(removed),
      warn(code, message, nodeId) {
        warnings.push({ code, message, ...nodeId !== void 0 && { nodeId } });
      },
      done(report) {
        const result = {
          createdNodeIds: [...created].filter((id) => !removed.has(id)),
          mutatedNodeIds: [...mutated].filter(
            (id) => !created.has(id) && !removed.has(id)
          )
        };
        if (removed.size > 0) result.removedNodeIds = [...removed];
        if (warnings.length > 0) result.warnings = [...warnings];
        if (report !== void 0) result.report = report;
        return result;
      }
    };
  }
  var current = { tracker: null };
  var startTracking = () => {
    current.tracker = createTracker();
    return current.tracker;
  };
  var note = Object.freeze({
    created: (what) => current.tracker?.created(what) ?? what,
    mutated: (what) => current.tracker?.mutated(what) ?? what,
    removed: (what) => current.tracker?.removed(what) ?? what,
    warn: (code, message, nodeId) => current.tracker?.warn(code, message, nodeId)
  });
  function fail(code, message, next) {
    throw new Error(`${FAIL_MARKER}${JSON.stringify({ code, message, next })}`);
  }

  // kits/figma/components.ts
  var isCatalog = (node) => {
    const n = node;
    return n !== null && (n.type === "COMPONENT_SET" || n.type === "COMPONENT") && n.removed !== true;
  };
  async function findComponent(name) {
    const wanted = name.trim();
    const cache = stateOf().components;
    const cachedId = cache.get(wanted);
    if (cachedId !== void 0) {
      const hit = await figmaApi().getNodeByIdAsync(cachedId);
      if (isCatalog(hit) && hit.name.trim() === wanted) return hit;
      cache.delete(wanted);
    }
    let standalone = null;
    for (const page of figmaApi().root.children) {
      await page.loadAsync();
      for (const node of page.findAllWithCriteria({
        types: ["COMPONENT_SET", "COMPONENT"]
      })) {
        if (node.name.trim() !== wanted) continue;
        if (node.type === "COMPONENT_SET") {
          cache.set(wanted, node.id);
          return node;
        }
        if (node.parent?.type !== "COMPONENT_SET") standalone ??= node;
      }
    }
    if (standalone !== null) cache.set(wanted, standalone.id);
    return standalone;
  }
  async function setNameOf(instance) {
    const main = await instance.getMainComponentAsync();
    if (main === null) return null;
    return main.parent?.type === "COMPONENT_SET" ? main.parent.name : main.name;
  }
  var propsOfVariant = (variant) => {
    if (variant.variantProperties) return variant.variantProperties;
    const out = {};
    for (const part of variant.name.split(",")) {
      const [k, v] = part.split("=");
      if (k !== void 0 && v !== void 0) out[k.trim()] = v.trim();
    }
    return out;
  };
  var STRONG_WEIGHT = 1e3;
  function pickVariant(set, props2, options2 = {}) {
    if (set.type === "COMPONENT") return set;
    const strong = options2.strong ?? [];
    let best = null;
    let bestScore = -1;
    let bestMisses = 0;
    for (const variant of set.children) {
      if (variant.type !== "COMPONENT") continue;
      const own = propsOfVariant(variant);
      let score = 0;
      let misses = 0;
      let excluded = false;
      for (const [name, value] of Object.entries(props2)) {
        if (own[name] === value)
          score += strong.includes(name) ? STRONG_WEIGHT : 1;
        else {
          misses += 1;
          if (strong.includes(name)) excluded = true;
        }
      }
      if (excluded) continue;
      if (score > bestScore) {
        best = variant;
        bestScore = score;
        bestMisses = misses;
      }
    }
    if (best === null) {
      return fail(
        "VARIANT_NOT_FOUND",
        `«${set.name}» no tiene ninguna variante con ${strong.join(", ")} como pide ${JSON.stringify(props2)}.`,
        "Mira las variantes del set con figma_components y ajusta las props."
      );
    }
    if (bestMisses > 0) {
      note.warn(
        "VARIANT_APPROX",
        `«${set.name}» no tiene la variante ${JSON.stringify(props2)}; se usa «${best.name}».`,
        best.id
      );
    }
    return best;
  }
  var copyReferences = (original, copy, lost) => {
    const refs = original.componentPropertyReferences;
    if (refs !== null && Object.keys(refs).length > 0) {
      copy.componentPropertyReferences = { ...refs };
      const back = copy.componentPropertyReferences ?? {};
      for (const [field, key] of Object.entries(refs)) {
        if (back[field] !== key)
          lost.push(copy.id);
      }
    }
    if ("children" in original && "children" in copy) {
      original.children.forEach((child, i) => {
        const twin = copy.children[i];
        if (twin !== void 0) copyReferences(child, twin, lost);
      });
    }
  };
  function cloneVariant(variant) {
    const copy = variant.clone();
    if (variant.parent !== null && copy.parent !== variant.parent) {
      variant.parent.appendChild(copy);
    }
    const lost = [];
    copyReferences(variant, copy, lost);
    note.created(copy);
    if (lost.length > 0) {
      note.warn(
        "REFERENCES_LOST",
        `${lost.length} capas de la copia no recuperaron sus referencias a propiedades.`,
        copy.id
      );
    }
    return copy;
  }

  // kits/figma/flow.ts
  function startFlow(page, frame, name) {
    const points = page.flowStartingPoints;
    const mine = points.find((p) => p.name === name);
    if (mine?.nodeId === frame.id) return { changed: false };
    const point = { nodeId: frame.id, name };
    const next = points.filter((p) => p.name !== name && p.nodeId !== frame.id).map((p) => ({ nodeId: p.nodeId, name: p.name }));
    const at2 = points.findIndex((p) => p.name === name);
    next.splice(at2 === -1 ? next.length : Math.min(at2, next.length), 0, point);
    page.flowStartingPoints = next;
    note.mutated(page);
    return { changed: true };
  }

  // kits/figma/fonts.ts
  var reasonOf = (e) => e instanceof Error ? e.message : typeof e === "string" ? e : JSON.stringify(e) ?? String(e);
  var fontKey = (f) => `${f.family}\0${f.style}`;
  var textsOf = (nodes) => {
    const out = [];
    for (const node of nodes) {
      if (node.type === "TEXT") out.push(node);
      else if ("findAllWithCriteria" in node) {
        out.push(...node.findAllWithCriteria({ types: ["TEXT"] }));
      }
    }
    return out;
  };
  var fontsOf = (text) => {
    if (text.type !== "TEXT") return [];
    if (text.fontName !== figmaApi().mixed) return [text.fontName];
    return text.getStyledTextSegments(["fontName"]).map((segment) => segment.fontName);
  };
  async function loadFonts(fonts, options2 = {}) {
    const loaded = stateOf().fonts;
    const missing = [];
    const unique = new Map(
      fonts.map((f) => [
        fontKey(f),
        { family: f.family, style: f.style }
      ])
    );
    await Promise.all(
      [...unique].filter(([key]) => !loaded.has(key)).map(async ([key, font]) => {
        try {
          await figmaApi().loadFontAsync(font);
          loaded.add(key);
        } catch (e) {
          if (options2.optional === true) {
            missing.push(font);
            return;
          }
          fail(
            "FONT_MISSING",
            `No se pudo cargar la fuente ${font.family} ${font.style}: ${reasonOf(e)}`,
            "Comprueba que la fuente está disponible en el archivo (o cambia la del texto) y repite el paso."
          );
        }
      })
    );
    return missing;
  }
  async function ensureFonts(nodes) {
    const loaded = stateOf().fonts;
    const wanted = /* @__PURE__ */ new Map();
    for (const text of textsOf(
      Array.isArray(nodes) ? nodes : [nodes]
    )) {
      for (const font of fontsOf(text)) wanted.set(fontKey(font), font);
    }
    await Promise.all(
      [...wanted].filter(([key]) => !loaded.has(key)).map(async ([key, font]) => {
        try {
          await figmaApi().loadFontAsync(font);
        } catch (e) {
          fail(
            "FONT_MISSING",
            `No se pudo cargar la fuente ${font.family} ${font.style}: ${reasonOf(e)}`,
            "Comprueba que la fuente está disponible en el archivo (o cambia la del texto) y repite el paso."
          );
        }
        loaded.add(key);
      })
    );
  }

  // kits/figma/tree.ts
  var LINKABLE_TYPES = [
    "FRAME",
    "INSTANCE",
    "COMPONENT",
    "COMPONENT_SET",
    "GROUP",
    "SECTION",
    "TEXT",
    "RECTANGLE",
    "ELLIPSE",
    "VECTOR",
    "LINE",
    "POLYGON",
    "STAR",
    "BOOLEAN_OPERATION"
  ];
  function descendantsOfType(node, types) {
    return "findAllWithCriteria" in node ? node.findAllWithCriteria({
      types: [...types]
    }) : [];
  }
  function pageOf(node) {
    for (let n = node; n !== null && n !== void 0; n = n.parent ?? null) {
      if (n.type === "PAGE") return n;
    }
    return null;
  }
  function topFrameName(node) {
    let top = node;
    while (top.parent !== null && top.parent.type !== "PAGE")
      top = top.parent;
    return top.name;
  }
  function insideInstance(node) {
    for (let p = node.parent; p !== null; p = p.parent) {
      if (p.type === "INSTANCE") return true;
    }
    return false;
  }
  function visibleText(node) {
    const texts = node.type === "TEXT" ? [node] : descendantsOfType(node, ["TEXT"]);
    const shown = (text) => {
      let p = text;
      while (p !== null && p !== node) {
        if ("visible" in p && !p.visible) return false;
        p = p.parent;
      }
      return true;
    };
    return texts.filter(shown).map((t) => t.characters.trim()).filter((t) => t !== "").join(" ");
  }

  // kits/figma/nodes.ts
  var getNode = (id) => figmaApi().getNodeByIdAsync(id);
  function tagNode(node, key) {
    node.setSharedPluginData(NS, KEY, key);
    note.mutated(node);
    return node;
  }
  async function isMirror(node, key) {
    if (insideInstance(node)) return true;
    if (node.type !== "INSTANCE") return false;
    const main = await node.getMainComponentAsync();
    return main !== null && main.getSharedPluginData(NS, KEY) === key;
  }
  async function nodeByKey(key, options2 = {}) {
    const pages = options2.page ? [options2.page] : figmaApi().root.children;
    const found = [];
    for (const page of pages) {
      await page.loadAsync();
      for (const node of page.findAllWithCriteria({
        sharedPluginData: { namespace: NS, keys: [KEY] }
      })) {
        if (node.getSharedPluginData(NS, KEY) === key && !await isMirror(node, key)) {
          found.push(node);
        }
      }
    }
    if (found.length > 1) {
      note.warn(
        "KEY_DUPLICATED",
        `La clave «${key}» está en ${found.length} nodos; se usa el primero.`,
        found[0]?.id
      );
    }
    return found[0] ?? null;
  }

  // kits/figma/frames.ts
  var LAYOUT_PROPS = [
    "layoutMode",
    "primaryAxisSizingMode",
    "counterAxisSizingMode",
    "primaryAxisAlignItems",
    "counterAxisAlignItems",
    "itemSpacing",
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft",
    "clipsContent",
    "fills"
  ];
  var messageOf = (e) => e instanceof Error ? e.message : String(e);
  async function ensureFrame(options2) {
    const existing = await nodeByKey(options2.key, { page: options2.page });
    if (existing !== null) {
      if (existing.type === "FRAME") return existing;
      fail(
        "KEY_NOT_FRAME",
        `La clave «${options2.key}» ya la tiene un nodo de tipo ${existing.type}, no un marco.`,
        "Usa otra clave para el marco o quita la del otro nodo."
      );
    }
    const frame = figmaApi().createFrame();
    frame.name = options2.name;
    frame.layoutMode = "VERTICAL";
    frame.resize(options2.width, options2.minHeight);
    frame.primaryAxisSizingMode = "AUTO";
    frame.minHeight = options2.minHeight;
    options2.page.appendChild(frame);
    tagNode(frame, options2.key);
    note.created(frame);
    return frame;
  }
  async function replaceContent(frame, source, options2 = {}) {
    try {
      frame.numberOfFixedChildren = 0;
    } catch (e) {
      note.warn(
        "FIXED_FAILED",
        `No se pudo quitar lo fijo de «${frame.name}»: ${messageOf(e)}`,
        frame.id
      );
    }
    const old = [...frame.children];
    note.removed(old);
    for (const child of old) child.remove();
    if (options2.copyLayout === true) {
      const from = source;
      const to = frame;
      for (const prop of LAYOUT_PROPS) {
        try {
          to[prop] = from[prop];
        } catch (e) {
          note.warn(
            "LAYOUT_PROP",
            `No se pudo copiar «${prop}» al marco «${frame.name}»: ${messageOf(e)}`,
            frame.id
          );
        }
      }
    }
    const incoming = source.children;
    for (const child of [...incoming]) frame.appendChild(child);
    const children = [...frame.children];
    note.created(children);
    note.mutated(frame);
    return children;
  }

  // kits/figma/icons.ts
  function iconFromSvg(name, svg, options2 = {}) {
    let frame;
    try {
      frame = figmaApi().createNodeFromSvg(svg);
    } catch (e) {
      return fail(
        "BAD_SVG",
        `Figma no pudo leer el SVG de «${name}»: ${e instanceof Error ? e.message : String(e)}`,
        "Comprueba que el SVG es válido y vuelve a ejecutar el paso."
      );
    }
    frame.name = name;
    if (options2.size !== void 0) frame.resize(options2.size, options2.size);
    note.created(frame);
    return frame;
  }

  // kits/figma/instances.ts
  var baseName = (key) => key.split("#")[0] ?? key;
  var SHOW_PREFIX = /^mostrar\s+/i;
  function ownerOf(root, name, type) {
    const own = (instance) => {
      for (const [key, prop] of Object.entries(instance.componentProperties)) {
        if (prop.type === type && baseName(key) === name)
          return { instance, key };
      }
      return null;
    };
    const direct = own(root);
    if (direct !== null) return direct;
    for (const nested of root.findAllWithCriteria({ types: ["INSTANCE"] })) {
      const found = own(nested);
      if (found !== null) return found;
    }
    return null;
  }
  async function createInstance(set, options2 = {}) {
    const component = pickVariant(set, options2.variant ?? {});
    const instance = component.createInstance();
    note.created(instance);
    await ensureFonts(instance);
    const texts = options2.texts ?? {};
    for (const [name, value] of Object.entries(texts)) {
      const owner = ownerOf(instance, name, "TEXT");
      if (owner === null) {
        note.warn(
          "TEXT_PROP_NOT_FOUND",
          `«${set.name}» no tiene una propiedad de texto «${name}».`,
          instance.id
        );
        continue;
      }
      owner.instance.setProperties({ [owner.key]: value });
    }
    const visible = { ...options2.visible ?? {} };
    for (const key of Object.keys(instance.componentProperties)) {
      const prop = instance.componentProperties[key];
      const name = baseName(key);
      if (prop?.type !== "BOOLEAN" || !SHOW_PREFIX.test(name)) continue;
      if (name in visible) continue;
      const target = name.replace(SHOW_PREFIX, "").trim().toLowerCase();
      const given = Object.entries(texts).find(
        ([textName]) => textName.trim().toLowerCase() === target
      );
      visible[name] = given !== void 0 && given[1] !== "";
    }
    for (const [name, value] of Object.entries(visible)) {
      const owner = ownerOf(instance, name, "BOOLEAN");
      if (owner === null) {
        note.warn(
          "VISIBLE_PROP_NOT_FOUND",
          `«${set.name}» no tiene una propiedad «${name}».`,
          instance.id
        );
        continue;
      }
      owner.instance.setProperties({ [owner.key]: value });
    }
    return instance;
  }

  // kits/figma/json.ts
  function readJson(bytes) {
    try {
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) {
      return fail(
        "BAD_JSON",
        `El asset no es JSON: ${e instanceof Error ? e.message : String(e)}`,
        "Comprueba el fichero que pasas en `assets`."
      );
    }
  }

  // kits/figma/links.ts
  async function componentOf(node, cache) {
    if (node === null || node.type !== "INSTANCE") return null;
    const cached = cache.get(node.id);
    if (cached !== void 0) return cached;
    const name = await setNameOf(node);
    cache.set(node.id, name);
    return name;
  }
  async function isClickable(node, clickable, cache) {
    if (node.type === "FRAME") {
      if (clickable.names.includes(node.name)) return true;
      if (clickable.namePrefixes.some((prefix) => node.name.startsWith(prefix)))
        return true;
    }
    const own = await componentOf(node, cache);
    if (own !== null && clickable.components.includes(own)) return true;
    for (const part of clickable.parts ?? []) {
      if (node.name === part.name && await componentOf(node.parent, cache) === part.insideComponent)
        return true;
    }
    return false;
  }
  async function insideComponent(node, root, component, cache) {
    for (let p = node.parent; p !== null && p !== root; p = p.parent) {
      if (await componentOf(p, cache) === component) return true;
    }
    return false;
  }
  var matcher = (text, match) => match === "exact" ? (candidate) => candidate === text : match === "start" ? (candidate) => candidate.startsWith(text) : (candidate) => candidate.includes(text);
  async function byText(frame, text, options2) {
    const matches2 = matcher(text, options2.match ?? "exact");
    const cache = /* @__PURE__ */ new Map();
    const found = [];
    for (const node of descendantsOfType(frame, ["FRAME", "INSTANCE"])) {
      if (!await isClickable(node, options2.clickable, cache)) continue;
      if (options2.skipInside !== void 0 && await insideComponent(node, frame, options2.skipInside, cache))
        continue;
      if (matches2(visibleText(node))) found.push(node);
    }
    return found;
  }
  function rows(frame, rules) {
    return descendantsOfType(frame, ["FRAME"]).filter(
      (node) => rules.row.includes(node.name) && node.parent !== null && rules.body.includes(node.parent.name)
    );
  }
  var reactionFor = (destinationId, transition) => [
    {
      trigger: { type: "ON_CLICK" },
      actions: [
        {
          type: "NODE",
          destinationId,
          navigation: "NAVIGATE",
          // Sin transición, Figma dice `null` (cambio instantáneo)
          transition: transition.type === "INSTANT" ? null : {
            type: transition.type,
            easing: { type: transition.easing },
            duration: transition.duration
          },
          preserveScrollPosition: false,
          resetVideoPosition: false
        }
      ]
    }
  ];
  var NEAR = 1e-6;
  var near = (a, b) => Math.abs(a - b) <= NEAR * Math.max(1, Math.abs(a), Math.abs(b));
  function sameAction(a, b) {
    if (a.type !== b.type || a.destinationId !== b.destinationId || a.navigation !== b.navigation)
      return false;
    const x = a.transition ?? null;
    const y = b.transition ?? null;
    if (x === null || y === null) return x === y;
    return x.type === y.type && x.easing?.type === y.easing?.type && near(x.duration ?? 0, y.duration ?? 0);
  }
  function sameReactions(current2, wanted) {
    if (current2.length !== wanted.length) return false;
    return current2.every((reaction, i) => {
      const a = reaction;
      const b = wanted[i];
      const actions = a.actions ?? [];
      const others = b.actions ?? [];
      return a.trigger?.type === b.trigger?.type && actions.length === others.length && actions.every((action, j) => sameAction(action, others[j]));
    });
  }
  var messageOf2 = (e) => e instanceof Error ? e.message : String(e);
  function triggerKey(reaction) {
    const trigger = reaction.trigger ?? null;
    if (trigger === null) return "null";
    return JSON.stringify(
      Object.entries(trigger).sort(([a], [b]) => a.localeCompare(b))
    );
  }
  function withReactions(current2, incoming) {
    const next = [...current2];
    for (const reaction of incoming) {
      const at2 = next.findIndex((r) => triggerKey(r) === triggerKey(reaction));
      if (at2 === -1) next.push(reaction);
      else next[at2] = reaction;
    }
    return next;
  }
  async function linkTo(node, destination, options2) {
    const from = pageOf(node);
    const to = pageOf(destination);
    if (from === null || to === null || from.id !== to.id) {
      fail(
        "LINK_OTHER_PAGE",
        `«${node.name}» y su destino «${destination.name}» no están en la misma página: un enlace del prototipo solo puede ir a un frame de su página.`,
        "Pon el destino en la página del origen o quita ese enlace de areas@1."
      );
    }
    const target = node;
    const wanted = withReactions(
      target.reactions,
      reactionFor(destination.id, options2.transition)
    );
    if (sameReactions(target.reactions, wanted)) return { changed: false };
    await target.setReactionsAsync(wanted);
    note.mutated(node);
    if (!sameReactions(target.reactions, wanted)) {
      note.warn(
        "REACTION_NOT_KEPT",
        `«${node.name}» no conservó el enlace que se le puso.`,
        node.id
      );
    }
    return { changed: true };
  }
  async function ownSetId(node) {
    for (let n = node; n !== null; n = n.parent) {
      if (n.type !== "INSTANCE" && n.type !== "COMPONENT") continue;
      const main = n.type === "INSTANCE" ? await n.getMainComponentAsync() : n;
      if (main === null) return null;
      return main.parent?.type === "COMPONENT_SET" ? main.parent.id : main.id;
    }
    return null;
  }
  async function invalidAction(target, action) {
    if (typeof action.destinationId !== "string") return null;
    const destination = await figmaApi().getNodeByIdAsync(
      action.destinationId
    );
    if (destination === null || destination.removed === true)
      return "el destino ya no existe";
    if (action.navigation === "CHANGE_TO") {
      const set = await ownSetId(target);
      return set !== null && destination.parent?.id === set ? null : `un cambio de variante solo vale en una instancia de su set y «${target.name}» es ${target.type === "INSTANCE" ? "una instancia de otro set" : `un ${target.type}`}`;
    }
    const here = pageOf(target);
    return here !== null && pageOf(destination)?.id === here.id ? null : "el destino está en otra página";
  }
  async function describeAction(reaction, action) {
    const destination = typeof action.destinationId === "string" ? await figmaApi().getNodeByIdAsync(action.destinationId) : null;
    return `${reaction.trigger?.type ?? "?"} → ${action.navigation ?? action.type ?? "?"}${destination === null ? "" : ` «${destination.name}»`}`;
  }
  async function validFor(target, reactions, own) {
    const covered = new Set(own.map(triggerKey));
    const kept = [];
    const dropped = [];
    for (const reaction of reactions) {
      const r = reaction;
      let why = null;
      for (const action of r.actions ?? []) {
        why = await invalidAction(target, action);
        if (why !== null) {
          if (!covered.has(triggerKey(reaction)))
            dropped.push(`${await describeAction(r, action)} (${why})`);
          break;
        }
      }
      if (why === null) kept.push(reaction);
    }
    return { kept, dropped };
  }
  function capture(node) {
    const saved = [];
    for (const x of [node, ...descendantsOfType(node, LINKABLE_TYPES)]) {
      const reactions = x.reactions;
      if (reactions === void 0 || reactions.length === 0) continue;
      const text = visibleText(x);
      if (text !== "") saved.push({ text, reactions: [...reactions] });
    }
    return saved;
  }
  async function restore(nodes, saved, options2) {
    const cache = /* @__PURE__ */ new Map();
    const candidates = [];
    const roots = Array.isArray(nodes) ? nodes : [nodes];
    const within = roots.flatMap((root) => [
      root,
      ...descendantsOfType(root, ["FRAME", "INSTANCE"])
    ]);
    for (const x of within) {
      if (x.type === "INSTANCE" || await isClickable(x, options2.clickable, cache))
        candidates.push(x);
    }
    let restored = 0;
    for (const link of saved) {
      const target = candidates.find((x) => visibleText(x) === link.text);
      if (target === void 0) continue;
      const node = target;
      const { kept, dropped } = await validFor(
        target,
        link.reactions,
        node.reactions
      );
      const where = `«${link.text}» (marco «${topFrameName(target)}»)`;
      if (dropped.length > 0) {
        note.warn(
          "REACTION_DROPPED",
          `${where}: no se repone ${dropped.join("; ")}.`,
          target.id
        );
      }
      if (kept.length === 0) continue;
      const next = withReactions(node.reactions, kept);
      if (!sameReactions(node.reactions, next)) {
        try {
          await node.setReactionsAsync(next);
        } catch (e) {
          note.warn(
            "REACTION_REJECTED",
            `${where}: Figma rechazó sus enlaces y se queda sin ellos: ${messageOf2(e)}`,
            target.id
          );
          continue;
        }
        note.mutated(target);
      }
      restored += 1;
    }
    return { restored, total: saved.length };
  }

  // kits/figma/pages.ts
  async function findPage(name) {
    const wanted = name.trim();
    const page = figmaApi().root.children.find((p) => p.name.trim() === wanted);
    if (page === void 0) return null;
    await page.loadAsync();
    return page;
  }
  async function ensurePage(options2) {
    const f = figmaApi();
    for (const page2 of f.root.children) {
      await page2.loadAsync();
      if (page2.getSharedPluginData(NS, KEY) === options2.key) return page2;
    }
    const byName = await findPage(options2.name);
    if (byName !== null) {
      byName.setSharedPluginData(NS, KEY, options2.key);
      note.mutated(byName);
      return byName;
    }
    const page = f.createPage();
    page.name = options2.name;
    page.setSharedPluginData(NS, KEY, options2.key);
    note.created(page);
    return page;
  }
  async function removePage(page) {
    const f = figmaApi();
    if (f.currentPage.id === page.id) {
      const other = f.root.children.find((p) => p.id !== page.id);
      if (other === void 0) {
        fail(
          "LAST_PAGE",
          `«${page.name}» es la única página del archivo y no se puede borrar.`,
          "Crea otra página antes de borrar ésta."
        );
      }
      await f.setCurrentPageAsync(other);
    }
    const id = page.id;
    page.remove();
    note.removed(id);
  }

  // kits/figma/paints.ts
  var isBind = (p) => "bind" in p;
  var toPaint = (input) => isBind(input) ? bound(input) : input;
  var bound = (input) => {
    const opacity = input.opacity ?? 1;
    const base = { type: "SOLID", color: { r: 0, g: 0, b: 0 }, opacity };
    const linked = figmaApi().variables.setBoundVariableForPaint(
      base,
      "color",
      input.bind
    );
    return { ...linked, opacity };
  };
  function setPaints(node, field, paints, options2 = {}) {
    const target = node;
    const wanted = paints.map(
      (paint) => isBind(paint) ? paint.opacity ?? 1 : null
    );
    target[field] = paints.map((paint) => isBind(paint) ? bound(paint) : paint);
    const read = target[field];
    const fixed = read.map((paint, i) => {
      const opacity = wanted[i];
      return opacity === null || opacity === void 0 || paint.opacity === opacity ? paint : { ...paint, opacity };
    });
    if (fixed.some((paint, i) => paint !== read[i])) target[field] = fixed;
    const after = target[field];
    for (const [i, opacity] of wanted.entries()) {
      if (opacity !== null && after[i]?.opacity !== opacity) {
        note.warn(
          "OPACITY_LOST",
          `La pintura ${i} de ${field} no conservó su opacidad (${opacity}) al ligarla a una variable.`,
          node.id
        );
      }
    }
    if (options2.track !== false) note.mutated(node);
  }

  // kits/figma/recognize/types.ts
  var RECOGNIZE_CONTRACT = "recognize@1";

  // kits/figma/recognize/module.ts
  var NEXT = 'Corrige recognize.js del proyecto: un objeto { contract: "recognize@1", rules: { <set>: { match(), props() } }, after?: { <set>: función } }.';
  var invalid = (why) => fail(
    "RECOGNIZE_INVALID",
    `El módulo recognize@1 no es válido: ${why}.`,
    NEXT
  );
  var isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
  function checkRecognize(value) {
    if (!isObject(value)) return invalid("no es un objeto");
    if (value["contract"] !== RECOGNIZE_CONTRACT)
      return invalid(`\`contract\` tiene que ser «${RECOGNIZE_CONTRACT}»`);
    const rules = value["rules"];
    if (!isObject(rules)) return invalid("`rules` tiene que ser un objeto");
    for (const [name, rule] of Object.entries(rules)) {
      if (!isObject(rule) || typeof rule["match"] !== "function" || typeof rule["props"] !== "function")
        return invalid(
          `la regla «${name}» tiene que tener las funciones \`match\` y \`props\``
        );
    }
    const after = value["after"];
    if (after !== void 0) {
      if (!isObject(after)) return invalid("`after` tiene que ser un objeto");
      for (const [name, hook] of Object.entries(after)) {
        if (typeof hook !== "function")
          return invalid(`\`after.${name}\` tiene que ser una función`);
      }
    }
    return value;
  }

  // kits/figma/screen/appearance.ts
  var MAX_RADIUS = 9999;
  var ZERO4 = [0, 0, 0, 0];
  var stops = (g) => g.stops.map((st) => ({
    position: st.p,
    color: { r: st.c[0] / 255, g: st.c[1] / 255, b: st.c[2] / 255, a: st.c[3] }
  }));
  function gradPaint(g, w, h) {
    if (g.radial === true) {
      const R = Math.SQRT1_2;
      return {
        type: "GRADIENT_RADIAL",
        gradientTransform: [
          [0.5 / R, 0, 0.5 - 0.25 / R],
          [0, 0.5 / R, 0.5 - 0.25 / R]
        ],
        gradientStops: stops(g)
      };
    }
    const a = g.angle * Math.PI / 180;
    const dx = Math.sin(a);
    const dy = -Math.cos(a);
    const L = Math.abs(w * dx) + Math.abs(h * dy);
    const sx = (w / 2 - dx * L / 2) / w;
    const sy = (h / 2 - dy * L / 2) / h;
    const ex = (w / 2 + dx * L / 2) / w;
    const ey = (h / 2 + dy * L / 2) / h;
    const vx = ex - sx;
    const vy = ey - sy;
    const d2 = vx * vx + vy * vy;
    return {
      type: "GRADIENT_LINEAR",
      gradientTransform: [
        [vx / d2, vy / d2, -(vx * sx + vy * sy) / d2],
        [-vy / d2, vx / d2, 0.5 + (vy * sx - vx * sy) / d2]
      ],
      gradientStops: stops(g)
    };
  }
  function paintBox(ctx, f, n, chain) {
    const own = chain.slice(0, 1);
    setPaints(f, "fills", n.bg ? [ctx.paint.paint(n.bg, own, "fill")] : [], {
      track: false
    });
    if (n.grad) f.fills = [...f.fills, gradPaint(n.grad, n.w, n.h)];
    f.clipsContent = /hidden|auto|scroll|clip/.test(n.ov ?? "");
    {
      const [ox, oy] = (n.ov ?? "visible").split(" ").map((v, _i, a) => v || a[0]);
      const sx = /auto|scroll/.test(ox);
      const sy = /auto|scroll/.test(oy === void 0 ? ox : oy);
      if (sx || sy)
        f.overflowDirection = sx && sy ? "BOTH" : sy ? "VERTICAL" : "HORIZONTAL";
    }
    const bw = n.bw ?? ZERO4;
    const bc = bw[0] ? n.bc ?? n.bcb : n.bcb ?? n.bc;
    if (bw.some((x) => x > 0) && bc) {
      setPaints(f, "strokes", [ctx.paint.paint(bc, own, "stroke")], {
        track: false
      });
      f.strokeAlign = "INSIDE";
      if (bw.every((x) => x === bw[0])) f.strokeWeight = bw[0];
      else {
        f.strokeTopWeight = bw[0];
        f.strokeRightWeight = bw[1];
        f.strokeBottomWeight = bw[2];
        f.strokeLeftWeight = bw[3];
      }
    }
    return bc ?? null;
  }
  var CORNERS = [
    "topLeftRadius",
    "topRightRadius",
    "bottomLeftRadius",
    "bottomRightRadius"
  ];
  async function paintShape(ctx, f, n) {
    const rad = (n.rad ?? ZERO4).map((r) => Math.min(r, MAX_RADIUS));
    if (rad.every((r) => r === rad[0])) {
      const r0 = rad[0];
      const rv = r0 >= MAX_RADIUS ? ctx.paint.fullRadius() : ctx.paint.numVar("radius", r0);
      f.cornerRadius = r0;
      if (rv && r0 > 0) for (const k of CORNERS) f.setBoundVariable(k, rv);
    } else {
      f.topLeftRadius = rad[0];
      f.topRightRadius = rad[1];
      f.bottomRightRadius = rad[2];
      f.bottomLeftRadius = rad[3];
    }
    if (typeof n.op === "number" && n.op < 1) f.opacity = n.op;
    const visible = (n.shs ?? []).filter((e) => e.c[3] > 0);
    const named = visible.length > 0 && ctx.effectPattern !== null ? (n.cls ?? "").split(" ").find(
      (c) => ctx.effectPattern.test(c) && ctx.effects.has(c)
    ) : void 0;
    if (named !== void 0) {
      await f.setEffectStyleIdAsync(
        ctx.effects.get(named).id
      );
    } else if (visible.length > 0) {
      f.effects = visible.map(
        (e) => ({
          type: e.inset ? "INNER_SHADOW" : "DROP_SHADOW",
          color: {
            r: e.c[0] / 255,
            g: e.c[1] / 255,
            b: e.c[2] / 255,
            a: e.c[3]
          },
          offset: { x: e.x, y: e.y },
          radius: e.b,
          spread: e.s,
          visible: true,
          blendMode: "NORMAL",
          ...e.inset ? {} : { showShadowBehindNode: false }
        })
      ).reverse();
    }
  }

  // kits/figma/screen/layout.ts
  var JC = {
    "flex-start": "MIN",
    start: "MIN",
    normal: "MIN",
    center: "CENTER",
    "flex-end": "MAX",
    end: "MAX",
    "space-between": "SPACE_BETWEEN"
  };
  var AI = {
    "flex-start": "MIN",
    start: "MIN",
    center: "CENTER",
    "flex-end": "MAX",
    end: "MAX",
    baseline: "BASELINE",
    stretch: "MIN",
    normal: "MIN"
  };
  var ZERO42 = [0, 0, 0, 0];
  var GROW = /(^| )(flex-1|grow|flex-grow|flex-auto)( |$)/;
  var growsOf = (k) => k.fg !== void 0 ? k.fg > 0 : GROW.test(k.cls ?? "");
  var isAbs = (k) => k.pos === "absolute" || k.pos === "fixed";
  var startsInline = (k) => (k.disp ?? "").startsWith("inline");
  var at = (list, i) => (list ?? ZERO42)[i] ?? 0;
  function childProp(_ctx, _parent, child, key, value) {
    child[key] = value;
  }
  function configureLayout(ctx, f, n, kids, bc) {
    const disp = n.disp ?? "";
    const flex = disp.includes("flex");
    const grid = disp.includes("grid");
    const trow = disp === "table-row";
    const tgroup = /^(table|table-row-group|table-header-group|table-footer-group)$/.test(
      disp
    );
    const tcell = disp === "table-cell";
    const ta = n.font?.ta;
    const TA = n.font ? ta === "right" || ta === "end" ? "MAX" : ta === "center" ? "CENTER" : "MIN" : void 0;
    const flow = kids.filter((k) => k.pos !== "absolute" && k.y != null);
    const sameLine = flow.length < 2 || Math.max(...flow.map((k) => k.y)) < Math.min(...flow.map((k) => k.y + k.h)) - 0.5;
    const allInline = sameLine && kids.every(
      (k) => k.t === "text" || k.t === "svg" || k.t === "img" || k.t === "icon" || k.pos === "absolute" || k.fl === "left" || startsInline(k)
    );
    const tstack = tcell && !sameLine;
    f.layoutMode = tstack ? "VERTICAL" : trow || tcell ? "HORIZONTAL" : tgroup ? "VERTICAL" : grid ? "HORIZONTAL" : flex ? (n.dir ?? "").startsWith("column") ? "VERTICAL" : "HORIZONTAL" : allInline ? "HORIZONTAL" : "VERTICAL";
    f.strokesIncludedInLayout = true;
    const pads = [
      "paddingTop",
      "paddingRight",
      "paddingBottom",
      "paddingLeft"
    ];
    const transB = !bc ? n.bw ?? ZERO42 : ZERO42;
    pads.forEach((k, i) => {
      const v = at(n.pad, i) + (transB[i] ?? 0);
      f[k] = v;
      const sv = !transB[i] && v > 0 && ctx.paint.numVar("spacing", v);
      if (sv) f.setBoundVariable(k, sv);
    });
    const spacing = (g) => {
      f.itemSpacing = g;
      const gv = g > 0 && ctx.paint.numVar("spacing", g);
      if (gv) f.setBoundVariable("itemSpacing", gv);
    };
    if (trow || tgroup) {
      f.itemSpacing = 0;
      f.primaryAxisAlignItems = "MIN";
      f.counterAxisAlignItems = "MIN";
    } else if (tstack) {
      f.primaryAxisAlignItems = n.va === "top" ? "MIN" : n.va === "bottom" ? "MAX" : "CENTER";
      f.counterAxisAlignItems = TA ?? "MIN";
      f.itemSpacing = 0;
    } else if (tcell) {
      f.counterAxisAlignItems = n.va === "top" ? "MIN" : n.va === "bottom" ? "MAX" : "CENTER";
      f.primaryAxisAlignItems = TA ?? "MIN";
    } else if (grid) {
      const fk = kids.filter((k) => k.pos !== "absolute" && k.pos !== "fixed");
      const first = fk[0];
      const oneRow = fk.length > 1 && fk.every(
        (k) => k.y < first.y + first.h && first.y < k.y + k.h
      );
      f.layoutWrap = oneRow ? "NO_WRAP" : "WRAP";
      f.itemSpacing = n.gap ?? 0;
      f.counterAxisSpacing = n.rgap ?? 0;
      f.primaryAxisAlignItems = "MIN";
      f.counterAxisAlignItems = AI[n.ai ?? ""] ?? "MIN";
    } else if (flex) {
      spacing(f.layoutMode === "HORIZONTAL" ? n.gap ?? 0 : n.rgap ?? 0);
      f.primaryAxisAlignItems = JC[n.jc ?? ""] ?? "MIN";
      f.counterAxisAlignItems = AI[n.ai ?? ""] ?? "MIN";
      if (n.wrap === "wrap" && !sameLine) {
        f.layoutWrap = "WRAP";
        f.counterAxisSpacing = f.layoutMode === "HORIZONTAL" ? n.rgap ?? 0 : n.gap ?? 0;
      }
    } else if (allInline) {
      const mixed = kids.some((k) => k.t === "frame") && kids.some((k) => k.t === "text");
      f.counterAxisAlignItems = n.va === "top" ? "MIN" : mixed ? "BASELINE" : "CENTER";
      f.primaryAxisAlignItems = TA ?? "MIN";
      const g = Math.max(0, ...kids.map((k) => Math.max(k.ml ?? 0, k.mr ?? 0)));
      if (g) {
        f.itemSpacing = g;
        const gv = ctx.paint.numVar("spacing", g);
        if (gv) f.setBoundVariable("itemSpacing", gv);
      }
    }
    if (!flex && !grid && flow.length > 1) {
      const V = f.layoutMode === "VERTICAL";
      const srt = [...flow].sort(
        (a, b) => V ? a.y - b.y : a.x - b.x
      );
      const gaps = srt.slice(1).map((k, i) => {
        const p = srt[i];
        return Math.round(
          V ? k.y - (p.y + p.h) : k.x - (p.x + p.w)
        );
      }).filter((g) => g > 0);
      if (gaps.length > 0) {
        const g = Math.min(...gaps);
        if (g > f.itemSpacing) spacing(g);
      }
    }
    f.primaryAxisSizingMode = grid ? "FIXED" : "AUTO";
    f.counterAxisSizingMode = "AUTO";
    if (grid) f.resize(n.w + (f.layoutWrap === "WRAP" ? 1 : 0), f.height);
    const iwrap = !flex && !grid && kids.some(
      (k, i) => i > 0 && k.t === "frame" && startsInline(k) && (k.kids ?? []).some((y) => y.t === "text" && (y.lines ?? 1) > 1) && k.x < kids[i - 1].x + kids[i - 1].w - 0.5
    );
    if (iwrap) {
      f.layoutMode = "HORIZONTAL";
      f.layoutWrap = "WRAP";
      f.counterAxisSpacing = 0;
      f.counterAxisAlignItems = "MIN";
      for (const k of kids) k.noPos = true;
    }
    return { flex, grid, trow, tgroup, tcell, sameLine, iwrap };
  }
  function placeChild(ctx, f, c, k, n, shape, anchors) {
    const { flex, grid, trow, tgroup, tcell, iwrap } = shape;
    if ((trow || tgroup) && !isAbs(k))
      childProp(ctx, f, c, "layoutAlign", "STRETCH");
    const inFlow = !isAbs(k) && k.t === "frame";
    const innerW = n.w - at(n.pad, 1) - at(n.pad, 3) - at(n.bw, 1) - at(n.bw, 3);
    const innerH = n.h - at(n.pad, 0) - at(n.pad, 2) - at(n.bw, 0) - at(n.bw, 2);
    const fillsW = Math.abs(k.w - innerW) < 1;
    const fillsH = Math.abs(k.h - innerH) < 1;
    if (inFlow && !flex && !grid && !trow && !tcell && f.layoutMode === "VERTICAL" && !startsInline(k) && (!k.fl || k.fl === "none") && fillsW)
      childProp(ctx, f, c, "layoutAlign", "STRETCH");
    if (inFlow && flex && /^(normal|stretch)$/.test(n.ai ?? "") && (f.layoutMode === "HORIZONTAL" ? fillsH : fillsW) && (k.kids ?? []).length > 0)
      childProp(ctx, f, c, "layoutAlign", "STRETCH");
    if (flex && growsOf(k) && !isAbs(k)) {
      childProp(ctx, f, c, "layoutGrow", 1);
      if (c.type === "TEXT") c.textAutoResize = "HEIGHT";
      if (c.type === "FRAME" && c.layoutMode === "HORIZONTAL" && !/flex/.test(k.disp ?? ""))
        c.counterAxisAlignItems = "MIN";
    }
    if ("layoutGrow" in c && c.layoutGrow === 1 && c.type === "FRAME" && f.layoutMode === "HORIZONTAL") {
      for (const tx of c.children.filter(
        (x) => x.type === "TEXT"
      )) {
        if (c.layoutMode === "HORIZONTAL") childProp(ctx, c, tx, "layoutGrow", 1);
        else if (c.layoutMode === "VERTICAL")
          childProp(ctx, c, tx, "layoutAlign", "STRETCH");
        tx.textAutoResize = "HEIGHT";
      }
    }
    if (k.grow) {
      childProp(ctx, f, c, "layoutGrow", 1);
      if (c.type === "TEXT") c.textAutoResize = "HEIGHT";
    }
    if (ctx.ownTitle !== null && c.type === "TEXT" && c.textTruncation !== "ENDING" && fillsBlock(f, k, n)) {
      childProp(ctx, f, c, "layoutGrow", 1);
      c.textAutoResize = "HEIGHT";
    }
    if (isAbs(k)) {
      absolute(ctx, f, c, k);
      anchors.push([c, k]);
    }
    if (iwrap && c.type === "FRAME" && (k.kids ?? []).some((y) => y.t === "text" && (y.lines ?? 1) > 1)) {
      for (const x of c.findAllWithCriteria({ types: ["TEXT"] }))
        x.textAutoResize = "WIDTH_AND_HEIGHT";
      c.primaryAxisSizingMode = "AUTO";
      c.counterAxisSizingMode = "AUTO";
    }
  }
  var BLOCK = /^(block|flow-root|list-item)$/;
  var FIT = /(^| )(w-fit|w-min|w-max)( |$)/;
  function fillsBlock(f, k, n) {
    const flow = (n.kids ?? []).filter((x) => !isAbs(x));
    return k.t === "text" && f.layoutMode === "HORIZONTAL" && flow.length === 1 && BLOCK.test(n.disp ?? "") && !FIT.test(n.cls ?? "");
  }
  function absolute(ctx, f, c, k) {
    if (f.layoutMode === "NONE") {
      ctx.warn(
        "LAYOUT_PROP",
        `«${f.name}» no tiene auto-layout: un hijo absoluto no se saca del flujo.`,
        f.id
      );
    } else {
      try {
        c.layoutPositioning = "ABSOLUTE";
      } catch (e) {
        ctx.warn(
          "LAYOUT_PROP",
          `No se pudo poner un hijo de «${f.name}» en posición absoluta: ${e instanceof Error ? e.message : String(e)}`,
          c.id
        );
      }
    }
    c.x = k.x;
    c.y = k.y;
  }
  var isPositioned = (k) => k !== void 0 && !!k.pos && k.pos !== "static";
  function paintOrder(ctx, f) {
    const ch0 = [...f.children];
    for (const c of ch0) {
      if (!("layoutPositioning" in c) || c.layoutPositioning !== "ABSOLUTE" || c.name === "imagen")
        continue;
      const later = ch0.slice(ch0.indexOf(c) + 1).find((x) => {
        const kx = ctx.km.get(x);
        return isPositioned(kx) && !("layoutPositioning" in x && x.layoutPositioning === "ABSOLUTE");
      });
      if (later && !ctx.km.get(c)?.top)
        f.insertChild(f.children.indexOf(later), c);
      else f.appendChild(c);
    }
    [...f.children].filter((c) => /(^| )-z-/.test(ctx.km.get(c)?.cls ?? "")).reverse().forEach((c) => {
      f.insertChild(0, c);
    });
  }
  function sizeFrame(f, n, shape) {
    const H = f.layoutMode === "HORIZONTAL";
    const textual = f.children.some((c) => c.type === "TEXT") && f.width > n.w;
    if (Math.abs(f.width - n.w) > 1.5 && !textual) {
      if (H) f.primaryAxisSizingMode = "FIXED";
      else f.counterAxisSizingMode = "FIXED";
      f.resize(n.w, f.height);
    }
    const hasText = hasTextNode(n.kids ?? []);
    const explicitH = /(^| )(h-|size-|min-h-|max-h-|aspect-|inset-0|inset-y-0)/.test(
      n.cls ?? ""
    ) || n.pos === "fixed" || shape.tcell || shape.trow || !hasText || n.tag === "textarea" || // flex con un hijo flex-1: el alto lo reparte el contenedor (si abraza, el flex-1 no tiene nada que llenar)
    /flex/.test(n.disp ?? "") && (n.dir ?? "").startsWith("column") && (n.kids ?? []).some(growsOf);
    if (Math.abs(f.height - n.h) > 1.5 && (explicitH || f.children.length === 0)) {
      if (H) f.counterAxisSizingMode = "FIXED";
      else f.primaryAxisSizingMode = "FIXED";
      f.resize(f.width, n.h);
    }
  }
  var hasTextNode = (nodes) => nodes.some((k) => k.t === "text" || hasTextNode(k.kids ?? []));
  function gridColumns(ctx, f, n) {
    const inF = f.children.filter(
      (c) => ctx.km.get(c) && !("layoutPositioning" in c && c.layoutPositioning === "ABSOLUTE")
    );
    const ks = inF.map((c) => ctx.km.get(c));
    const cols = new Set(ks.map((k) => Math.round(k.x))).size;
    const ws = ks.map((k) => k.w);
    if (cols > 1 && Math.max(...ws) - Math.min(...ws) < 2) {
      const cw = Math.floor(
        (n.w - at(n.pad, 1) - at(n.pad, 3) - (cols - 1) * (n.gap ?? 0)) / cols * 100
      ) / 100 - 0.5;
      for (const k of ks) k.w = cw;
    } else if (cols > 1) {
      for (const k of ks) k.w -= 0.5;
    }
    for (const c of f.children) {
      const k = ctx.km.get(c);
      if (!k || "layoutPositioning" in c && c.layoutPositioning === "ABSOLUTE" || !("resize" in c) || Math.abs(c.width - k.w) <= 0.01)
        continue;
      if (c.type === "FRAME") {
        if (c.layoutMode === "HORIZONTAL") c.primaryAxisSizingMode = "FIXED";
        else if (c.layoutMode === "VERTICAL") c.counterAxisSizingMode = "FIXED";
      }
      if (c.type === "TEXT") c.textAutoResize = "HEIGHT";
      c.resize(k.w, c.height);
    }
  }

  // kits/figma/screen/fix-positions.ts
  var isAbs2 = (k) => k.pos === "absolute" || k.pos === "fixed";
  var isAbsolute = (c) => "layoutPositioning" in c && c.layoutPositioning === "ABSOLUTE";
  var asLayout = (c) => c;
  function anchor(ctx, c, k, n) {
    const ax = (pos, size, full) => (
      // padre de tamaño 0 (aside colapsado): no hay nada que estirar ni medio que calcular, se conserva el desfase desde el origen
      full <= 0 ? "MIN" : size >= full - 1 ? "STRETCH" : Math.abs(pos + size / 2 - full / 2) < 1.5 ? "CENTER" : pos + size / 2 > full / 2 ? "MAX" : "MIN"
    );
    try {
      c.constraints = {
        horizontal: ax(k.x, k.w, n.w),
        vertical: ax(k.y, k.h, n.h)
      };
    } catch (e) {
      ctx.warn(
        "CONSTRAINTS_FAILED",
        `No se pudieron poner las anclas de un hijo absoluto: ${e instanceof Error ? e.message : String(e)}`,
        c.id
      );
    }
  }
  function fixPositions(ctx, f, n, anchors, grid) {
    let moved = 0;
    let afterText = false;
    let pk = null;
    let pc = null;
    const HZ = f.layoutMode === "HORIZONTAL";
    for (const c of grid ? [] : [...f.children]) {
      const k = ctx.km.get(c);
      if (k && k.t === "text") afterText = true;
      if (!k || isAbsolute(c) || isAbs2(k)) continue;
      if (k.t === "text" || k.noPos || k.x == null) {
        if (k.x != null) {
          pk = k;
          pc = c;
        }
        continue;
      }
      const tol = afterText ? 3 : 1.5;
      let dx = k.x - c.x;
      let dy = k.y - c.y;
      if (pk && pc && HZ)
        dx = k.x - (pk.x + pk.w) - (c.x - (pc.x + pc.width));
      if (pk && pc && !HZ)
        dy = k.y - (pk.y + pk.h) - (c.y - (pc.y + pc.height));
      pk = k;
      pc = c;
      if (Math.abs(dx) <= tol && Math.abs(dy) <= tol) continue;
      const tag = `${Object.values(ctx.plan.props).join("/")} ${n.tag}>${k.tag ?? k.t}`;
      if (dx >= -0.5 && dy >= -0.5) {
        const wr = figmaApi().createFrame();
        ctx.counters.nodes++;
        wr.name = "margen";
        wr.fills = [];
        wr.clipsContent = false;
        f.insertChild(f.children.indexOf(c), wr);
        wr.layoutMode = "HORIZONTAL";
        wr.primaryAxisSizingMode = "AUTO";
        wr.counterAxisSizingMode = "AUTO";
        const fillW = !HZ && asLayout(c).layoutAlign === "STRETCH";
        asLayout(wr).layoutGrow = asLayout(c).layoutGrow;
        asLayout(wr).layoutAlign = asLayout(c).layoutAlign;
        asLayout(c).layoutAlign = "INHERIT";
        wr.appendChild(c);
        asLayout(c).layoutGrow = fillW ? 1 : 0;
        if (c.type === "FRAME" && (k.kids ?? []).length === 0) c.resize(k.w, k.h);
        wr.resize(c.width + Math.max(0, dx), c.height + Math.max(0, dy));
        wr.primaryAxisSizingMode = "AUTO";
        wr.counterAxisSizingMode = "AUTO";
        if (fillW) {
          wr.layoutSizingHorizontal = "FILL";
          c.layoutSizingHorizontal = "FILL";
        }
        wr.paddingLeft = Math.round(dx * 2) / 2;
        wr.paddingTop = Math.round(dy * 2) / 2;
        ctx.counters.wrapped.push(tag);
        pc = wr;
      } else if (Math.min(dx, dy) >= -4) {
      } else {
        absolute(ctx, f, c, k);
        anchors.push([c, k]);
        moved++;
        ctx.counters.moved.push(tag);
      }
    }
    if (moved) {
      f.primaryAxisSizingMode = "FIXED";
      f.counterAxisSizingMode = "FIXED";
      f.resize(n.w, n.h);
    }
    return moved;
  }
  function growForAbsolutes(ctx, f, n, kids) {
    const abs = kids.filter(isAbs2);
    const bw = n.bw ?? [0, 0, 0, 0];
    if (abs.length === 0 || n.bg || bw.some((x) => x > 0)) return;
    const dx = ctx.clip ? 0 : Math.max(0, ...abs.map((k) => -k.x));
    if (dx > 0) {
      f.paddingLeft += dx;
      for (const c of f.children) if (isAbsolute(c)) c.x += dx;
      for (const k of abs) k.x = k.x + dx;
      n.w += dx;
    }
    const mw = Math.max(f.width, ...abs.map((k) => k.x + k.w));
    const mh = Math.max(f.height, ...abs.map((k) => k.y + k.h));
    if (mw > f.width + 0.5 || mh > f.height + 0.5) {
      if (f.layoutMode === "HORIZONTAL") {
        if (mh > f.height + 0.5) f.counterAxisAlignItems = "MIN";
        if (mw > f.width + 0.5) f.primaryAxisAlignItems = "MIN";
      } else if (f.layoutMode === "VERTICAL") {
        if (mh > f.height + 0.5) f.primaryAxisAlignItems = "MIN";
        if (mw > f.width + 0.5) f.counterAxisAlignItems = "MIN";
      }
      f.primaryAxisSizingMode = "FIXED";
      f.counterAxisSizingMode = "FIXED";
      f.resize(mw, mh);
    }
  }
  function anchorAll(ctx, anchors, n) {
    for (const [c, k] of anchors) anchor(ctx, c, k, n);
  }

  // kits/figma/screen/image.ts
  var MAX_RADIUS2 = 9999;
  function paintImage(ctx, n) {
    const r = figmaApi().createRectangle();
    ctx.counters.nodes++;
    r.name = "imagen";
    r.resize(n.w, n.h);
    const info = n.ref === void 0 ? void 0 : ctx.plan.images[n.ref];
    if (info === void 0 || n.ref === void 0) {
      ctx.warn("IMAGE_MISSING", `La imagen del nodo ${n.id} no está en el plan.`);
    } else if (info.tooLarge === true) {
      ctx.warn(
        "IMAGE_TOO_LARGE",
        `La imagen ${n.ref.slice(0, 8)} (${info.width} × ${info.height}) pasa del tope de Figma: rectángulo sin imagen.`
      );
    } else {
      const bytes = ctx.assets[info.asset];
      if (bytes === void 0) {
        ctx.warn(
          "IMAGE_MISSING",
          `Falta el asset de la imagen ${n.ref.slice(0, 8)}.`
        );
      } else {
        try {
          let hash = ctx.hashes.get(n.ref);
          if (hash === void 0) {
            hash = figmaApi().createImage(bytes).hash;
            ctx.hashes.set(n.ref, hash);
          }
          r.fills = [
            {
              type: "IMAGE",
              imageHash: hash,
              scaleMode: n.fit === "contain" ? "FIT" : "FILL"
            }
          ];
          ctx.counters.images++;
        } catch (e) {
          ctx.warn(
            "IMAGE_FAILED",
            `Figma no aceptó la imagen ${n.ref.slice(0, 8)}: ${e instanceof Error ? e.message : String(e)}`
          );
        }
      }
    }
    const rad = (n.rad ?? [0, 0, 0, 0]).map((x) => Math.min(x, MAX_RADIUS2));
    r.topLeftRadius = rad[0];
    r.topRightRadius = rad[1];
    r.bottomRightRadius = rad[2];
    r.bottomLeftRadius = rad[3];
    if (typeof n.op === "number" && n.op < 1) r.opacity = n.op;
    return r;
  }

  // kits/figma/screen/layers.ts
  var HINT_TAGS = /* @__PURE__ */ new Set(["button", "a", "label"]);
  var HEADING = /^h[1-6]$/;
  var HINT_MAX = 32;
  var FALLBACK = Object.freeze({
    heading: "heading",
    text: "text",
    icon: "icon",
    group: "group",
    grid: "grid",
    column: "column",
    row: "row",
    block: "block"
  });
  var allText = (n) => n.t === "text" ? [n.txt ?? ""] : (n.kids ?? []).flatMap(allText);
  function layerRole(n, layers) {
    const kids = n.kids ?? [];
    const tag = n.tag ?? "div";
    const named = (key) => layers.roles[key] ?? FALLBACK[key];
    const hint = (role) => {
      if (!layers.textPrefix) return role;
      const text = allText(n).join(" ").replace(/\s+/g, " ").trim();
      if (text === "") return role;
      return `${role} · ${text.length > HINT_MAX ? `${text.slice(0, HINT_MAX - 1)}…` : text}`;
    };
    if (HEADING.test(tag)) return hint(named("heading"));
    const byTag = layers.roles[tag];
    if (HINT_TAGS.has(tag) && byTag !== void 0) return hint(byTag);
    if (byTag !== void 0) return byTag;
    if (kids.length > 0 && kids.every((k) => k.t === "text"))
      return named("text");
    if (kids.length > 0 && kids.every((k) => k.t === "svg")) return named("icon");
    if (tag === "span") return named("group");
    if (n.disp === "grid" || n.wrap === "wrap") return named("grid");
    if (/flex/.test(n.disp ?? ""))
      return n.dir === "column" ? named("column") : named("row");
    return named("block");
  }

  // kits/figma/screen/svg.ts
  var STROKE_TYPES = [
    "FRAME",
    "VECTOR",
    "RECTANGLE",
    "ELLIPSE",
    "LINE",
    "POLYGON",
    "STAR",
    "BOOLEAN_OPERATION"
  ];
  var ANY_TYPES = [...STROKE_TYPES, "GROUP", "TEXT"];
  var hex = (r, g, b) => [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, "0")).join("");
  function recolorStrokes(ctx, node, paint) {
    for (const k of descendantsOfType(node, STROKE_TYPES)) {
      const strokes = k["strokes"];
      if (Array.isArray(strokes) && strokes.length > 0)
        setPaints(k, "strokes", [paint], { track: false });
    }
    void ctx;
  }
  var withOpacity = (paint, opacity) => isBind(paint) ? { bind: paint.bind, opacity } : { ...paint, opacity };
  var count = (ctx, name) => {
    ctx.counters.icons++;
    ctx.counters.components[name] = (ctx.counters.components[name] ?? 0) + 1;
  };
  function paintIcon(ctx, n, chain) {
    const component = ctx.icons.get(n.name ?? "");
    if (component === void 0) {
      ctx.warn(
        "ICON_MISSING",
        `No hay icono «${n.name}» en las páginas de iconos.`
      );
      ctx.counters.nodes++;
      return figmaApi().createFrame();
    }
    const node = component.createInstance();
    ctx.counters.nodes++;
    count(ctx, n.name ?? "");
    node.rescale(n.w / node.width);
    if (n.color)
      recolorStrokes(ctx, node, ctx.paint.paint(n.color, chain, "text"));
    return node;
  }
  function paintSvg(ctx, n, chain) {
    const name = n.key === void 0 ? void 0 : ctx.plan.icons[n.key];
    const col = n.color;
    const paint = col ? ctx.paint.paint(col, chain, "svg") : null;
    const component = name === void 0 ? void 0 : ctx.icons.get(name);
    let node;
    if (component !== void 0 && name !== void 0) {
      node = component.createInstance();
      ctx.counters.nodes++;
      count(ctx, name);
      node.rescale(n.w / node.width);
      if (paint !== null) recolorStrokes(ctx, node, paint);
    } else {
      if (name !== void 0)
        ctx.warn(
          "ICON_MISSING",
          `No hay icono «${name}» en las páginas de iconos: se pinta el svg.`
        );
      node = figmaApi().createNodeFromSvg(n.svg ?? "");
      ctx.counters.nodes++;
      node.rescale(n.w / node.width);
      node.name = n.spin ? "spinner" : "svg";
      node.fills = [];
      if (col && paint !== null) {
        for (const k of descendantsOfType(node, ANY_TYPES)) {
          for (const prop of ["fills", "strokes"]) {
            const list = k[prop];
            if (!Array.isArray(list) || list.length === 0) continue;
            const painted = list.map(
              (p) => p.type === "SOLID" && hex(p.color.r * 255, p.color.g * 255, p.color.b * 255) === hex(col[0], col[1], col[2]) ? withOpacity(paint, p.opacity ?? 1) : p
            );
            setPaintsMixed(k, prop, painted);
          }
        }
      }
    }
    if (typeof n.op === "number" && n.op < 1) node.opacity = n.op;
    return node;
  }
  function setPaintsMixed(node, prop, paints) {
    setPaints(node, prop, paints, { track: false });
  }

  // kits/figma/screen/text.ts
  var px = (value) => ({ unit: "PIXELS", value });
  var ZERO43 = [0, 0, 0, 0];
  var inlineOf = (x) => (x.disp ?? "").startsWith("inline") && (x.kids ?? []).length > 0 && (x.kids ?? []).every((y) => y.t === "text");
  function inlineSegments(n) {
    if (n.t !== "frame" || /flex|grid/.test(n.disp ?? "")) return null;
    const k = (n.kids ?? []).filter((x) => x.pos !== "absolute");
    if (k.length === 0 || !k.some((x) => x.t === "frame")) return null;
    const plain = (x) => x.t === "frame" && !x.ml && !x.bg && !(x.bw ?? []).some((b) => b > 0) && (x.pad ?? []).every((p) => p === 0) && inlineOf(x);
    const br = (x) => x.t === "frame" && x.tag === "br";
    if (!k.every((x) => x.t === "text" || plain(x) || br(x))) return null;
    const own = n.font;
    return k.flatMap(
      (x) => x.t === "text" ? [{ txt: x.txt ?? "", font: x.font ?? own }] : br(x) ? [{ txt: "\n", font: own }] : (x.kids ?? []).map((y) => ({
        txt: y.txt ?? "",
        font: y.font ?? x.font
      }))
    );
  }
  function applySegs(ctx, t, segs, chain) {
    t.characters = segs.map((s) => s.txt).join("");
    let i = 0;
    for (const sg of segs) {
      const j = i + sg.txt.length;
      if (j === i) continue;
      const f = sg.font;
      t.setRangeFontName(i, j, {
        family: ctx.text.family(f.fam),
        style: ctx.text.style(f.weight)
      });
      t.setRangeFontSize(i, j, f.size);
      if (f.color !== null) {
        t.setRangeFills(i, j, [
          toPaint(ctx.paint.paint(f.color, chain, "text"))
        ]);
      }
      if (f.td?.includes("underline"))
        t.setRangeTextDecoration(i, j, "UNDERLINE");
      else if (f.td?.includes("line-through"))
        t.setRangeTextDecoration(i, j, "STRIKETHROUGH");
      i = j;
    }
  }
  function mergedLists(n) {
    const out = [];
    const rec = (x) => {
      const segs = inlineSegments(x);
      if (segs) out.push(segs);
      else for (const k of x.kids ?? []) rec(k);
    };
    rec(n);
    return out;
  }
  function fitLines(t, lines, lhPx) {
    if (!(lines >= 1) || t.textAutoResize !== "HEIGHT" || !(lhPx > 0)) return;
    const ls = t.letterSpacing;
    const base = typeof ls === "object" && ls.unit === "PIXELS" ? ls.value : 0;
    for (let k = 1; k <= 5 && Math.round(t.height / lhPx) > lines; k++) {
      t.letterSpacing = px(base - 0.1 * k);
    }
  }
  var textAlign = (ta) => ta === "center" ? "CENTER" : ta === "right" || ta === "end" ? "RIGHT" : "LEFT";
  async function mergedText(ctx, n, segs, chain) {
    const t = figmaApi().createText();
    ctx.counters.nodes++;
    t.name = "texto enriquecido";
    const f = n.font;
    const style = ctx.text.style(f.weight);
    const family = ctx.text.family(void 0);
    t.fontName = { family, style };
    t.characters = "x";
    t.fontSize = f.size;
    const ts = ctx.text.textStyle(family, f.size, style);
    if (ts !== void 0) await t.setTextStyleIdAsync(ts.id);
    const lh = Number.parseFloat(f.lh);
    if (!Number.isNaN(lh)) t.lineHeight = px(lh);
    applySegs(ctx, t, segs, chain);
    t.textAlignHorizontal = textAlign(f.ta);
    const pad = n.pad ?? ZERO43;
    const bw = n.bw ?? ZERO43;
    const inner = n.w - (pad[1] ?? 0) - (pad[3] ?? 0) - (bw[1] ?? 0) - (bw[3] ?? 0);
    if (n.h > (Number.isNaN(lh) ? f.size * 1.4 : lh) * 1.4) {
      t.textAutoResize = "HEIGHT";
      t.resize(Math.max(1, inner), t.height);
    } else t.textAutoResize = "WIDTH_AND_HEIGHT";
    if (!Number.isNaN(lh)) {
      fitLines(
        t,
        Math.round(
          (n.h - (pad[0] ?? 0) - (pad[2] ?? 0) - (bw[0] ?? 0) - (bw[2] ?? 0)) / lh
        ),
        lh
      );
    }
    return t;
  }
  async function paintText(ctx, n, parent, chain) {
    const f = n.font ?? parent.font;
    const t = figmaApi().createText();
    ctx.counters.nodes++;
    const base = ctx.text.style(f.weight);
    const name = ctx.text.fontName(f);
    const strict = ctx.text.isStrict(name.family);
    t.fontName = name;
    t.characters = n.txt ?? "";
    t.fontSize = f.size;
    const ts = strict ? ctx.text.strictStyle(name.family, f, base) : ctx.text.textStyle(name.family, f.size, base);
    if (ts !== void 0) await t.setTextStyleIdAsync(ts.id);
    else
      ctx.warn(
        "TEXT_STYLE_MISSING",
        `No hay estilo de texto local para ${name.family} ${f.size}/${base}${strict ? " (con su interlineado, interletraje y mayúsculas)" : ""}.`
      );
    if (f.fs === "italic") t.fontName = name;
    const lh = Number.parseFloat(f.lh);
    if (!Number.isNaN(lh) && !(ts !== void 0 && ts.lineHeight.unit === "PIXELS" && Math.abs(ts.lineHeight.value - lh) < 0.01))
      t.lineHeight = px(lh);
    const sameLs = ts !== void 0 && ts.letterSpacing.unit === "PIXELS" && Math.abs(ts.letterSpacing.value - (Number.parseFloat(f.ls) || 0)) < 0.01;
    if (f.ls !== "normal" && Number.parseFloat(f.ls) && !sameLs)
      t.letterSpacing = px(Number.parseFloat(f.ls));
    const tc = f.tt === "uppercase" ? "UPPER" : f.tt === "capitalize" ? "TITLE" : null;
    if (tc !== null && !(ts !== void 0 && ts.textCase === tc)) t.textCase = tc;
    if (f.td?.includes("underline")) t.textDecoration = "UNDERLINE";
    else if (f.td?.includes("line-through")) t.textDecoration = "STRIKETHROUGH";
    if (f.color !== null)
      setPaints(t, "fills", [ctx.paint.paint(f.color, chain, "text")], {
        track: false
      });
    t.textAlignHorizontal = textAlign(f.ta);
    const only = (parent.kids ?? []).length === 1;
    const ppad = parent.pad ?? ZERO43;
    const pbw = parent.bw ?? ZERO43;
    const piw = parent.w - (ppad[1] ?? 0) - (ppad[3] ?? 0) - (pbw[1] ?? 0) - (pbw[3] ?? 0);
    const lines = n.lines ?? 1;
    if (lines > 1) {
      t.textAutoResize = "HEIGHT";
      t.resize(Math.ceil(only && piw > n.w ? piw : n.w) + 1, t.height);
      fitLines(t, lines, Number.isNaN(lh) ? t.height / lines : lh);
    } else t.textAutoResize = "WIDTH_AND_HEIGHT";
    if (/(^| )truncate( |$)/.test(parent.cls ?? "")) {
      const iw = parent.w - (ppad[1] ?? 0) - (ppad[3] ?? 0);
      if (t.width > iw + 0.5) {
        t.textAutoResize = "HEIGHT";
        t.resize(Math.max(1, iw), t.height);
        t.maxLines = 1;
        t.textTruncation = "ENDING";
      }
    }
    return t;
  }

  // kits/figma/screen/frame.ts
  var CLIPS = /hidden|auto|scroll|clip/;
  async function paintKid(ctx, k, n, chain) {
    if (k.t === "text") return paintText(ctx, k, n, chain);
    return paintNode(ctx, k, chain);
  }
  async function paintNode(ctx, k, chain) {
    const sheetRoot = ctx.ownTitle !== null && ctx.plan.root.length === 1 && ctx.plan.root[0] === k;
    const made = sheetRoot ? null : await ctx.recognizer?.recognize(k, chain) ?? null;
    if (made !== null) return made;
    if (k.t === "svg") return paintSvg(ctx, k, chain);
    if (k.t === "img") return paintImage(ctx, k);
    if (k.t === "icon") return paintIcon(ctx, k, chain);
    return paintFrame(ctx, k, chain);
  }
  async function paintFrame(ctx, n, parentChain) {
    const chain = [n.cls ?? "", ...parentChain];
    const f = figmaApi().createFrame();
    ctx.counters.nodes++;
    f.name = ctx.layerNames.find((l) => (n.cls ?? "").includes(l.classes))?.name ?? layerRole(n, ctx.plan.map.layers);
    const bc = paintBox(ctx, f, n, chain);
    await paintShape(ctx, f, n);
    const kids = n.kids ?? [];
    const anchors = [];
    if (kids.length === 0) {
      f.resize(Math.max(n.w, 0.01), Math.max(n.h, 0.01));
      return f;
    }
    const shape = configureLayout(ctx, f, n, kids, bc);
    const segs = inlineSegments(n);
    if (segs) {
      const t = await mergedText(ctx, n, segs, chain);
      f.appendChild(t);
      if (t.textAutoResize === "HEIGHT")
        childProp(ctx, f, t, "layoutAlign", "STRETCH");
    }
    const clips = CLIPS.test(n.ov ?? "");
    if (clips) ctx.clip++;
    const order = segs ? kids.filter((x) => x.pos === "absolute") : shape.flex && /reverse/.test(n.dir ?? "") ? [...kids].reverse() : kids;
    for (const k of order) {
      const c = await paintKid(ctx, k, n, chain);
      f.appendChild(c);
      ctx.km.set(c, k);
      placeChild(ctx, f, c, k, n, shape, anchors);
    }
    if (clips) ctx.clip--;
    if (shape.iwrap) {
      f.primaryAxisSizingMode = "FIXED";
      f.resize(n.w, f.height);
    }
    paintOrder(ctx, f);
    sizeFrame(f, n, shape);
    if (shape.grid) gridColumns(ctx, f, n);
    fixPositions(ctx, f, n, anchors, shape.grid);
    growForAbsolutes(ctx, f, n, kids);
    anchorAll(ctx, anchors, n);
    return f;
  }

  // kits/figma/recognize/catalog.ts
  async function loadCatalog(names, titles) {
    const exact = /* @__PURE__ */ new Map();
    const lower = /* @__PURE__ */ new Map();
    const wantExact = new Set(names.map((n) => n.trim()));
    const wantLower = new Set(titles.map((t) => t.trim().toLowerCase()));
    const done = () => exact.size >= wantExact.size && lower.size >= wantLower.size;
    if (wantExact.size > 0 || wantLower.size > 0) {
      for (const page of figmaApi().root.children) {
        await page.loadAsync();
        for (const node of page.findAllWithCriteria({
          types: ["COMPONENT_SET"]
        })) {
          const name = node.name.trim();
          if (wantExact.has(name) && !exact.has(name)) exact.set(name, node);
          const key = name.toLowerCase();
          if (wantLower.has(key) && !lower.has(key)) lower.set(key, node);
        }
        if (done()) break;
      }
    }
    return {
      set: (name) => exact.get(name.trim()) ?? lower.get(name.trim().toLowerCase())
    };
  }

  // kits/figma/recognize/fingerprint.ts
  var fpSet = (s) => new Set((s ?? "").split(/\s+/).filter(Boolean));
  var fpHas = (cls, need) => need.every((c) => cls.has(c));
  function genericMatcher(patterns) {
    const regexes = patterns.map((p) => new RegExp(`^(?:${p})$`));
    return (cls) => regexes.some((re) => re.test(cls));
  }
  var distinct = (cls, isGeneric) => cls.filter((c) => !isGeneric(c));
  function fpFindDesc(n, sig, depth = 0, max = 4) {
    if (depth > max) return false;
    for (const k of n.kids ?? []) {
      if (k.tag === sig.tag && fpHas(fpSet(k.cls), sig.cls)) return true;
      if (fpFindDesc(k, sig, depth + 1, max)) return true;
    }
    return false;
  }
  function fpMatch(n, fingerprints, isGeneric, skip) {
    if (!n?.tag) return null;
    const cls = fpSet(n.cls);
    let best = null;
    for (const [key, fp] of Object.entries(fingerprints)) {
      if (skip?.has(fp.title) || fp.tag !== n.tag || !fpHas(cls, fp.cls))
        continue;
      const weak = distinct(fp.cls, isGeneric).length < 2;
      const max = weak ? 1 : 4;
      const always = fp.sig ? fpFindDesc(n, fp.sig, 0, max) : false;
      if (fp.sig && !always) continue;
      const sig = always || (fp.sig_cond ? fpFindDesc(n, fp.sig_cond, 0, max) : false);
      if (weak && !sig) continue;
      const score = distinct(fp.cls, isGeneric).length + (sig ? 3 : 0) + fp.cls.length / 100;
      if (!best || score > best.score) best = { key, title: fp.title, score };
    }
    return best;
  }

  // kits/figma/recognize/recolor.ts
  var STROKE_TYPES2 = [
    "FRAME",
    "VECTOR",
    "RECTANGLE",
    "ELLIPSE",
    "LINE",
    "POLYGON",
    "STAR",
    "BOOLEAN_OPERATION"
  ];
  var has = (node, field) => {
    const list = node[field];
    return Array.isArray(list) && list.length > 0;
  };
  function recolorIcon(ctx, icon, color, chain) {
    const paint = ctx.paint.paint(color, chain, "svg");
    for (const k of descendantsOfType(icon, STROKE_TYPES2)) {
      if (has(k, "strokes")) setPaints(k, "strokes", [paint], { track: false });
    }
    for (const k of descendantsOfType(icon, ["VECTOR"])) {
      if (has(k, "fills")) setPaints(k, "fills", [paint], { track: false });
    }
  }
  function iconInstances(ctx, root) {
    return descendantsOfType(root, ["INSTANCE"]).filter((x) => x.name.startsWith(ctx.plan.map.icons.prefix) && x.visible);
  }

  // kits/figma/recognize/instance.ts
  var norm = (s) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  var SEPARATOR = /^[/›>»·|]$/;
  var HELP_LAYER = /ayuda|help/i;
  var ICON_LAYER = /icono|icon/i;
  var ICON_SWAP = /^icono/i;
  var CLOSED = "closed";
  var MAX_DEPTH = 4;
  var WIDTH_TOLERANCE = 1.5;
  var COLOR_PROP = /color/i;
  var refsOf2 = (n) => n.componentPropertyReferences ?? {};
  var textsIn = (n) => n.type === "TEXT" ? [n] : descendantsOfType(n, ["TEXT"]);
  var options = (def) => def.variantOptions ?? [];
  function ownTexts(n, key, fps, isGeneric) {
    const out = [];
    const walk = (x, f) => {
      const ff = x.font ?? f;
      if (x !== n && x.tag) {
        const m = fpMatch(x, fps, isGeneric);
        if (m && m.key !== key) return;
      }
      if (x.t === "text" && (x.txt ?? "").trim())
        out.push({ txt: x.txt, font: ff });
      for (const k of x.kids ?? []) walk(k, ff);
    };
    walk(n, n.font);
    return out;
  }
  async function fpInstance(ctx, rc, n, key, set, fps, isGeneric) {
    const fp = fps[key];
    const f = figmaApi();
    const tally = {};
    const vote = (x, d, font) => {
      if (d > MAX_DEPTH) return;
      const ff = x.font ?? font;
      const big = ff && ff.size >= 20 ? 2 : 0;
      for (const c of fpSet(x.cls)) {
        const cv = fp.cond?.[c];
        if (cv) {
          const k = `${cv[0]}=${cv[1]}`;
          tally[k] = (tally[k] ?? 0) + (d === 0 ? 3 : 1) + big;
        }
      }
      for (const k of x.kids ?? []) vote(k, d + 1, ff);
    };
    vote(n, 0, n.font);
    const votes = {};
    for (const [kv] of Object.entries(tally).sort((a, b) => b[1] - a[1])) {
      const [pk, pv] = kv.split("=");
      if (!(pk in votes)) votes[pk] = pv;
    }
    const defs = set.componentPropertyDefinitions;
    const want = {};
    const strong = /* @__PURE__ */ new Set();
    for (const [fk, def] of Object.entries(defs)) {
      if (def.type !== "VARIANT") continue;
      const als = Object.entries(fp.alias ?? {}).filter(
        ([, name]) => norm(name) === norm(fk)
      );
      const on = als.find(
        ([c]) => votes[c] === "true" && options(def).includes(c)
      );
      if (on) {
        want[fk] = on[0];
        strong.add(fk);
        continue;
      }
      const al = als[0];
      const codeKey = al ? al[0] : Object.keys({ ...fp.defaults, ...votes }).find(
        (c) => norm(c) === norm(fk)
      );
      if (!codeKey) continue;
      const v = String(
        votes[codeKey] ?? fp.defaults?.[codeKey] ?? ""
      ).toLowerCase();
      const opt = options(def).find((o) => o.toLowerCase() === v);
      if (opt) want[fk] = opt;
    }
    const freeT = ownTextsAll(n);
    const hasTextProps = Object.values(defs).some((d) => d.type === "TEXT");
    if (!hasTextProps) {
      for (const [fk, def] of Object.entries(defs)) {
        if (def.type !== "VARIANT" || !options(def).every((o) => /^\d+$/.test(o)))
          continue;
        const cnt = String(freeT.filter((t) => !SEPARATOR.test(t)).length);
        if (options(def).includes(cnt)) {
          want[fk] = cnt;
          strong.add(fk);
        }
      }
    }
    for (const [fk, def] of Object.entries(defs)) {
      if (def.type === "VARIANT" && options(def).includes(CLOSED) && freeT.length <= 1) {
        want[fk] = CLOSED;
        strong.add(fk);
      }
    }
    let comp = null;
    let best = -1;
    for (const c of set.children) {
      if (c.type !== "COMPONENT") continue;
      const vp = propsOfVariant(c);
      let sc = 0;
      for (const [k, v] of Object.entries(want))
        if (vp[k] === v) sc += strong.has(k) ? 10 : 1;
      if (sc > best) {
        best = sc;
        comp = c;
      }
    }
    if (!comp) return null;
    const inst = comp.createInstance();
    await ensureFonts(inst);
    const upd = {};
    const owner = (x, key2) => {
      for (let p = x.parent; p; p = p.parent) {
        if (p.type === "INSTANCE" && p.componentProperties && key2 in p.componentProperties)
          return p;
        if (p === inst) break;
      }
      return null;
    };
    const L = textsIn(inst).filter(
      (x) => x.visible && refsOf2(x)["characters"] !== void 0 && owner(x, refsOf2(x)["characters"])
    );
    const nested = /* @__PURE__ */ new Map();
    const subs = /* @__PURE__ */ new Set();
    const findSubs = (x) => {
      for (const k of x.kids ?? []) {
        const m2 = k.tag ? fpMatch(k, fps, isGeneric) : null;
        if (m2 && m2.key !== key)
          subs.add(fps[m2.key].title.toLowerCase());
        else findSubs(k);
      }
    };
    findSubs(n);
    const T = ownTexts(n, key, fps, isGeneric);
    const weights = ctx.plan.map.fonts.styles;
    const sim = (l, t) => {
      const fs = t.font?.size;
      const fw = t.font ? weights[t.font.weight] : void 0;
      let sc = l.characters.trim() === t.txt.trim() ? 3 : 0;
      if (fs && typeof l.fontSize === "number" && Math.abs(l.fontSize - fs) <= 1)
        sc += 2;
      if (fs && typeof l.fontSize === "number" && Math.abs(l.fontSize - fs) > 6)
        return -3;
      const fn = l.fontName;
      if (fw && fn !== f.mixed && fn.style === fw) sc += 1;
      return sc ? sc : -0.5;
    };
    const NEG = -1e9;
    const D = Array.from(
      { length: L.length + 1 },
      () => Array(T.length + 1).fill(NEG)
    );
    D[0][0] = 0;
    const at2 = (i, j) => D[i][j];
    for (let i = 0; i <= L.length; i++) {
      for (let j = 0; j <= T.length; j++) {
        const row = D[i];
        if (i && at2(i - 1, j) > NEG) row[j] = Math.max(at2(i, j), at2(i - 1, j));
        if (j && at2(i, j - 1) > NEG)
          row[j] = Math.max(at2(i, j), at2(i, j - 1) - 1);
        if (i && j && at2(i - 1, j - 1) > NEG)
          row[j] = Math.max(
            at2(i, j),
            at2(i - 1, j - 1) + sim(L[i - 1], T[j - 1])
          );
      }
    }
    const pair = /* @__PURE__ */ new Map();
    for (let i = L.length, j = T.length; i > 0 && j > 0; ) {
      if (at2(i, j) === at2(i - 1, j - 1) + sim(L[i - 1], T[j - 1])) {
        pair.set(L[i - 1], T[j - 1]);
        i--;
        j--;
      } else if (at2(i, j) === at2(i - 1, j)) i--;
      else j--;
    }
    for (const l of L) {
      const key2 = refsOf2(l)["characters"];
      const t = pair.get(l);
      const o = owner(l, key2);
      if (t && o !== inst && o !== null) {
        if (!nested.has(o)) nested.set(o, {});
        nested.get(o)[key2] = t.txt;
        continue;
      }
      if (o !== inst) continue;
      if (t) upd[key2] = t.txt;
      else {
        let a = l;
        while (a && a !== inst) {
          const vref = refsOf2(a)["visible"];
          if (vref && defs[vref]) {
            upd[vref] = false;
            break;
          }
          a = a.parent;
        }
      }
    }
    const paired = new Set(pair.keys());
    const hasIcon = rc.findSvg(n) !== void 0;
    for (const node of descendantsOfType(inst, LINKABLE_TYPES)) {
      const vref = refsOf2(node)["visible"];
      if (!vref || !defs[vref]) continue;
      if (vref in upd) continue;
      const gotText = textsIn(node).some((t) => paired.has(t));
      const isIcon = ICON_LAYER.test(node.name);
      if (HELP_LAYER.test(node.name) && subs.has("tooltip")) continue;
      if (!gotText && !(isIcon && hasIcon)) upd[vref] = false;
    }
    const sv = rc.findSvg(n);
    const ic = sv?.key === void 0 ? void 0 : rc.iconOf(sv.key);
    const swap = Object.entries(defs).find(
      ([k, d]) => d.type === "INSTANCE_SWAP" && ICON_SWAP.test(k)
    );
    const iconId = ic === void 0 ? void 0 : rc.icon(ic);
    if (iconId !== void 0 && swap) upd[swap[0]] = iconId;
    try {
      inst.setProperties(upd);
    } catch (e) {
      ctx.warn(
        "FP_PROPS",
        `${fp.title}: ${e instanceof Error ? e.message : String(e)}`
      );
    }
    if (!hasTextProps) {
      const tl = textsIn(inst).filter((x) => x.visible);
      if (tl.length === freeT.length) {
        for (const [i, t] of tl.entries()) {
          if (t.characters === freeT[i]) continue;
          await ensureFonts(t);
          t.characters = freeT[i];
        }
      } else {
        ctx.warn(
          "FP_TEXTS",
          `${fp.title}: ${tl.length} capas de texto y ${freeT.length} textos.`
        );
      }
    }
    if (sv?.color) {
      for (const icon of iconInstances(ctx, inst).slice(0, 1))
        recolorIcon(ctx, icon, sv.color, [sv.cls ?? "", n.cls ?? ""]);
    }
    for (const [o, u] of nested) {
      try {
        o.setProperties(u);
      } catch (e) {
        ctx.warn(
          "FP_NESTED",
          `${fp.title}: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }
    const own = propsOfVariant(comp);
    for (const [fk, v] of Object.entries(want)) {
      if (!COLOR_PROP.test(fk) || own[fk] === v) continue;
      const donor = set.children.find(
        (c) => c.type === "COMPONENT" && propsOfVariant(c)[fk] === v
      );
      if (!donor) continue;
      for (const dl of textsIn(donor)) {
        const ref = refsOf2(dl)["characters"];
        if (!ref) continue;
        const same = (x) => refsOf2(x)["characters"] === ref;
        const il = textsIn(inst).find(same);
        const base = textsIn(comp).find(same);
        if (il && base && dl.fills !== f.mixed && JSON.stringify(base.fills) !== JSON.stringify(dl.fills))
          setPaints(il, "fills", dl.fills, { track: false });
      }
    }
    const hFull = fpSet(n.cls).has("h-full") && n.h > inst.height;
    if (Math.abs(inst.width - n.w) > WIDTH_TOLERANCE && n.w > 0 || hFull) {
      try {
        inst.resize(n.w || inst.width, hFull ? n.h : inst.height);
      } catch (e) {
        ctx.warn(
          "FP_RESIZE",
          `${fp.title}: ${e instanceof Error ? e.message : String(e)}`
        );
      }
    }
    return inst;
  }
  function ownTextsAll(n) {
    const out = [];
    const walk = (x) => {
      if (x.t === "text" && (x.txt ?? "").trim())
        out.push(x.txt.trim());
      for (const k of x.kids ?? []) walk(k);
    };
    walk(n);
    return out;
  }

  // kits/figma/recognize/rules.ts
  var WIDTH_TOLERANCE2 = 1.5;
  var FIT_TOLERANCE = 2;
  var SAME_TOLERANCE = 1;
  var ZERO44 = [0, 0, 0, 0];
  var PROP_SEPARATOR = "#";
  var findSvg = (n) => n.t === "svg" ? n : (n.kids ?? []).map(findSvg).find((x) => x !== void 0);
  var errorText = (e) => e instanceof Error ? e.message : String(e);
  var isKitFail = (e) => e instanceof Error && e.message.startsWith(FAIL_MARKER);
  var px2 = (value) => ({ unit: "PIXELS", value });
  var matches = (set, wanted) => set.children.find((c) => {
    if (c.type !== "COMPONENT") return false;
    const props2 = propsOfVariant(c);
    return typeof wanted === "function" ? wanted({ name: c.name, variantProperties: props2 }) : Object.entries(wanted).every(([k, v]) => props2[k] === v);
  });
  async function createRecognizer(ctx, module) {
    const fps = ctx.plan.fingerprints;
    const hasFingerprints = fps !== void 0 && Object.keys(fps).length > 0;
    if (module === null && !hasFingerprints) return null;
    const only = ctx.plan.rules === void 0 ? null : new Set(ctx.plan.rules);
    const rules = Object.entries(module?.rules ?? {}).filter(
      ([name]) => only === null || only.has(name)
    );
    const titles = hasFingerprints ? Object.values(fps).map((fp) => fp.title) : [];
    const catalog = await loadCatalog(
      rules.map(([name]) => name),
      titles
    );
    const isGeneric = genericMatcher(
      ctx.plan.map.components?.genericClasses ?? []
    );
    const deferred = [];
    const rc = ruleCtx(
      ctx,
      catalog,
      deferred,
      (n) => hasFingerprints ? fpMatch(n, fps, isGeneric) : null
    );
    const hooks = new Map(
      Object.entries(module?.after ?? {}).map(([k, v]) => [
        k.trim().toLowerCase(),
        v
      ])
    );
    const count2 = (set, node, by) => {
      ctx.counters.nodes++;
      ctx.counters.components[set] = (ctx.counters.components[set] ?? 0) + 1;
      ctx.counters.matches.push({ node: node.id, set, by });
    };
    const border = (inst, n) => {
      const bw = n.bw ?? ZERO44;
      const strokes = inst.strokes ?? [];
      if (!bw.some((b) => b > 0) || !n.bc || strokes.length > 0) return;
      const node = inst;
      setPaints(
        node,
        "strokes",
        [ctx.paint.paint(n.bc, [n.cls ?? ""], "stroke")],
        {
          track: false
        }
      );
      node.strokeAlign = "INSIDE";
      [
        node.strokeTopWeight,
        node.strokeRightWeight,
        node.strokeBottomWeight,
        node.strokeLeftWeight
      ] = bw;
    };
    const boxAround = (inst, n, fit) => {
      const pad = n.pad ?? ZERO44;
      if (fit === "height") {
        if (Math.abs(inst.height - n.h) > SAME_TOLERANCE)
          inst.resize(inst.width, n.h);
        return inst;
      }
      const fitsW = Math.abs(inst.width + (pad[1] ?? 0) + (pad[3] ?? 0) - n.w) < FIT_TOLERANCE;
      const fitsH = Math.abs(inst.height + (pad[0] ?? 0) + (pad[2] ?? 0) - n.h) < FIT_TOLERANCE;
      if (!pad.some((x) => x > 0) || !(fitsW || fitsH) || Math.abs(inst.width - n.w) < SAME_TOLERANCE && Math.abs(inst.height - n.h) < SAME_TOLERANCE)
        return inst;
      const w = figmaApi().createFrame();
      ctx.counters.nodes++;
      w.name = inst.name;
      setPaints(
        w,
        "fills",
        n.bg ? [ctx.paint.paint(n.bg, [n.cls ?? ""], "fill")] : [],
        { track: false }
      );
      w.clipsContent = false;
      w.layoutMode = "HORIZONTAL";
      w.primaryAxisSizingMode = "AUTO";
      w.counterAxisSizingMode = "AUTO";
      w.counterAxisAlignItems = "CENTER";
      [w.paddingTop, w.paddingRight, w.paddingBottom, w.paddingLeft] = pad;
      [
        w.topLeftRadius,
        w.topRightRadius,
        w.bottomRightRadius,
        w.bottomLeftRadius
      ] = n.rad ?? ZERO44;
      w.appendChild(inst);
      return w;
    };
    const retouch = async (inst, n) => {
      const svgs = [];
      const rec = (x) => {
        for (const k of x.kids ?? []) {
          if (k.t === "svg" && k.color) svgs.push(k);
          else if (k.t === "frame") rec(k);
        }
      };
      rec(n);
      for (const [i, icon] of iconInstances(ctx, inst).entries()) {
        const sv = svgs[i];
        if (sv?.color)
          recolorIcon(ctx, icon, sv.color, [sv.cls ?? "", n.cls ?? ""]);
      }
      const lists = mergedLists(n);
      const rich = descendantsOfType(inst, ["TEXT"]).filter(
        (x) => x.name === "texto enriquecido"
      );
      for (let i = 0; i < Math.min(lists.length, rich.length); i++) {
        await ensureFonts(rich[i]);
        applySegs(ctx, rich[i], lists[i], [n.cls ?? ""]);
      }
      if (Math.abs(inst.width - n.w) > WIDTH_TOLERANCE2)
        inst.resize(n.w, inst.height);
    };
    const afterSet = async (name, inst, n) => {
      const hook = hooks.get(name.trim().toLowerCase());
      if (hook !== void 0) await hook(inst, n, rc);
    };
    const byRule = async (name, rule, set, n, cls) => {
      let inst = null;
      try {
        if (!rule.match(n, cls, rc)) return null;
        const r = rule.props(n, cls, rc);
        const comp = matches(set, r.variant);
        if (comp === void 0) {
          ctx.warn(
            "VARIANT_NOT_FOUND",
            `«${name}» no tiene la variante ${typeof r.variant === "function" ? "pedida" : JSON.stringify(r.variant)}: el nodo se prueba con otra regla o se pinta.`
          );
          return null;
        }
        inst = comp.createInstance();
        await ensureFonts(inst);
        const defs = set.componentPropertyDefinitions;
        const upd = {};
        for (const [k, v] of Object.entries(r.set ?? {})) {
          const key = Object.keys(defs).find(
            (x) => x.split(PROP_SEPARATOR)[0] === k
          );
          if (key === void 0) {
            ctx.warn(
              "PROP_NOT_FOUND",
              `«${name}» no tiene una propiedad «${k}».`
            );
          } else if (v !== void 0) upd[key] = v;
        }
        inst.setProperties(upd);
        if (r.after) await r.after(inst);
        await afterSet(name, inst, n);
        if (r.fit !== "none") await retouch(inst, n);
        count2(name, n, `rule:${name}`);
        if (r.fit === "none") return inst;
        border(inst, n);
        return boxAround(inst, n, r.fit);
      } catch (e) {
        inst?.remove();
        if (isKitFail(e)) throw e;
        ctx.warn(
          "RULE_ERROR",
          `La regla «${name}» falló en el nodo ${n.id} (${n.tag ?? n.t}): ${errorText(e)}. Se prueba con otra o se pinta.`,
          n.id
        );
        return null;
      }
    };
    const byFingerprint = async (n) => {
      if (!hasFingerprints || n.t !== "frame") return null;
      const m = fpMatch(n, fps, isGeneric);
      if (m === null) return null;
      if (m.title.toLowerCase() === ctx.ownTitle?.toLowerCase()) return null;
      const set = catalog.set(m.title);
      if (set === void 0) return null;
      let inst = null;
      try {
        inst = await fpInstance(ctx, rc, n, m.key, set, fps, isGeneric);
        if (inst === null) return null;
        await afterSet(set.name.trim(), inst, n);
        count2(set.name.trim(), n, "fingerprint");
        border(inst, n);
        return boxAround(inst, n, void 0);
      } catch (e) {
        inst?.remove();
        if (isKitFail(e)) throw e;
        ctx.warn(
          "RULE_ERROR",
          `La huella «${m.title}» falló en el nodo ${n.id} (${n.tag ?? n.t}): ${errorText(e)}. Se pinta el nodo.`,
          n.id
        );
        return null;
      }
    };
    const missing = /* @__PURE__ */ new Set();
    return {
      async recognize(n) {
        const cls = new Set((n.cls ?? "").split(" "));
        for (const [name, rule] of rules) {
          const set = catalog.set(name);
          if (set === void 0) {
            if (!missing.has(name)) {
              missing.add(name);
              ctx.warn(
                "SET_NOT_FOUND",
                `No hay un set «${name}» en el archivo: su regla no se prueba.`
              );
            }
            continue;
          }
          const made = await byRule(name, rule, set, n, cls);
          if (made !== null) return made;
        }
        return byFingerprint(n);
      },
      flush() {
        for (const { instance, frame } of deferred.splice(0)) {
          const slot = instance.findAllWithCriteria({ types: ["SLOT"] })[0];
          if (slot === void 0) {
            ctx.warn(
              "SLOT_MISSING",
              `La instancia «${instance.name}» no tiene hueco para el contenido aparte.`,
              instance.id
            );
            frame.remove();
            continue;
          }
          const clone = frame.clone();
          slot.appendChild(clone);
          frame.remove();
          try {
            clone.layoutSizingHorizontal = "FILL";
          } catch (e) {
            ctx.warn(
              "LAYOUT_PROP",
              `El contenido de «${instance.name}» no pudo ocupar todo el ancho del hueco: ${errorText(e)}`,
              clone.id
            );
          }
        }
      }
    };
  }
  var hasKit = () => globalThis[KIT_GLOBAL];
  function ruleCtx(ctx, catalog, deferred, fingerprintOf2) {
    const solid = (color) => ({
      type: "SOLID",
      color: { r: color[0] / 255, g: color[1] / 255, b: color[2] / 255 },
      opacity: color[3]
    });
    const rc = {
      allText,
      findSvg,
      // la pantalla de una hoja cambia de raíces y de props entre una variante y otra: se leen en cada llamada
      get roots() {
        return ctx.plan.root;
      },
      fingerprintOf: (n) => {
        const m = fingerprintOf2(n);
        return m === null ? null : { key: m.key, title: m.title };
      },
      icon: (name) => ctx.icons.get(name)?.id,
      iconOf: (key) => ctx.plan.icons[key],
      get screenProps() {
        return ctx.plan.props;
      },
      set: (name) => catalog.set(name),
      async defer(instance, node, chain = []) {
        const frame = await paintNode(ctx, node, chain);
        frame.name = "contenido de la celda";
        figmaApi().currentPage.appendChild(frame);
        deferred.push({ instance, frame });
      },
      paint(node, field, color, chain, kind = "fill") {
        setPaints(node, field, [ctx.paint.paint(color, chain, kind)], {
          track: false
        });
      },
      solid(node, field, color) {
        setPaints(node, field, [solid(color)], { track: false });
      },
      textStyleOf(font) {
        const name = ctx.text.fontName(font);
        const base = ctx.text.style(font.weight);
        return ctx.text.isStrict(name.family) ? ctx.text.strictStyle(name.family, font, base) : ctx.text.textStyle(name.family, font.size, base);
      },
      isStrictFamily: (font) => ctx.text.isStrict(ctx.text.fontName(font).family),
      async styleLike(t, f, chain) {
        const name = ctx.text.fontName(f);
        const base = ctx.text.style(f.weight);
        const cur = t.fontName;
        if (cur === figmaApi().mixed || cur.family !== name.family || cur.style !== name.style || t.fontSize !== f.size) {
          const strict = ctx.text.isStrict(name.family);
          const ts = strict ? void 0 : ctx.text.textStyle(name.family, f.size, base);
          if (ts && f.fs !== "italic") await t.setTextStyleIdAsync(ts.id);
          else {
            await t.setTextStyleIdAsync("");
            t.fontName = name;
            t.fontSize = f.size;
          }
          const lh = Number.parseFloat(f.lh);
          if (!Number.isNaN(lh) && !(ts !== void 0 && ts.lineHeight.unit === "PIXELS" && Math.abs(ts.lineHeight.value - lh) < 0.01))
            t.lineHeight = px2(lh);
        }
        if (f.ls !== "normal" && Number.parseFloat(f.ls))
          t.letterSpacing = px2(Number.parseFloat(f.ls));
        if (f.color) {
          const fills = t.fills;
          const first = Array.isArray(fills) ? fills[0] : void 0;
          const c = f.color;
          const color = first && "color" in first ? first.color : void 0;
          if (!color || Math.abs(color.r * 255 - c[0]) > 1 || Math.abs(color.g * 255 - c[1]) > 1 || Math.abs(color.b * 255 - c[2]) > 1)
            setPaints(t, "fills", [ctx.paint.paint(c, chain, "text")], {
              track: false
            });
        }
      },
      warn: (code, message, nodeId) => ctx.warn(code, message, nodeId),
      get kit() {
        return hasKit();
      }
    };
    return rc;
  }

  // kits/figma/tokens.ts
  var MAX_ALIAS_DEPTH = 10;
  async function loadTokens(names) {
    const f = figmaApi();
    const all = await f.variables.getLocalVariableCollectionsAsync();
    const chosen = names === void 0 ? all : names.map((name) => all.find((c) => c.name === name));
    const missing = names?.filter((_, i) => chosen[i] === void 0) ?? [];
    if (missing.length > 0) {
      fail(
        "COLLECTION_NOT_FOUND",
        `No hay colecciones de variables llamadas ${missing.map((m) => `«${m}»`).join(", ")}.`,
        "Mira las colecciones con figma_variables y corrige el nombre."
      );
    }
    const modeOf = new Map(all.map((c) => [c.id, c.defaultModeId]));
    const variables = /* @__PURE__ */ new Map();
    const values = /* @__PURE__ */ new Map();
    const entries = [];
    const resolve2 = async (variable, modeId) => {
      let current2 = variable;
      let mode = modeId;
      for (let depth = 0; depth < MAX_ALIAS_DEPTH; depth++) {
        const raw = current2.valuesByMode[mode];
        const alias = raw;
        if (alias?.type !== "VARIABLE_ALIAS" || alias.id === void 0)
          return raw;
        const target = await f.variables.getVariableByIdAsync(alias.id);
        if (target === null) return void 0;
        current2 = target;
        mode = modeOf.get(target.variableCollectionId) ?? mode;
      }
      return void 0;
    };
    for (const collection of chosen) {
      if (collection === void 0) continue;
      if (collection.modes.length > 1) {
        note.warn(
          "MULTI_MODE",
          `La colección «${collection.name}» tiene ${collection.modes.length} modos; se lee el de por defecto.`
        );
      }
      for (const id of collection.variableIds) {
        const variable = await f.variables.getVariableByIdAsync(id);
        if (variable === null) continue;
        const value = await resolve2(variable, collection.defaultModeId);
        entries.push({
          name: variable.name,
          collection: collection.name,
          variable,
          value
        });
        for (const name of [
          variable.name,
          `${collection.name}/${variable.name}`
        ]) {
          if (!variables.has(name)) {
            variables.set(name, variable);
            values.set(name, value);
          }
        }
      }
    }
    return Object.freeze({
      collections: chosen.flatMap((c) => c === void 0 ? [] : [c.name]),
      variable: (name) => variables.get(name),
      value: (name) => values.get(name),
      names: () => [...variables.keys()],
      entries: () => [...entries]
    });
  }

  // kits/figma/screen/color.ts
  var hex2 = (r, g, b) => [r, g, b].map((x) => Math.round(x).toString(16).padStart(2, "0")).join("");
  var colorOf = (entry) => {
    if (entry.variable.resolvedType !== "COLOR") return null;
    const c = entry.value;
    return c === void 0 ? null : hex2(c.r * 255, c.g * 255, c.b * 255);
  };
  function createPaintResolver(tokens, config, onUntokenized) {
    const rules = config.classToVariable.map((r) => ({
      pattern: new RegExp(r.from),
      to: r.to
    }));
    const hexOf = /* @__PURE__ */ new Map();
    const fallback = /* @__PURE__ */ new Map();
    const numbers = [];
    for (const entry of tokens.entries()) {
      const color = colorOf(entry);
      if (color !== null) {
        hexOf.set(entry.variable, color);
        if (config.fallback !== void 0 && entry.collection === config.fallback.collection && !fallback.has(color))
          fallback.set(color, entry.variable);
      } else if (entry.variable.resolvedType === "FLOAT" && typeof entry.value === "number") {
        numbers.push({
          name: entry.name,
          value: entry.value,
          variable: entry.variable
        });
      }
    }
    const classVar = (token) => {
      for (const rule of rules) {
        const m = rule.pattern.exec(token);
        if (m === null) continue;
        const name = rule.to.replace(
          /\$(\d+)/g,
          (_, i) => m[Number(i)] ?? ""
        );
        const found = tokens.variable(name);
        if (found !== void 0) return found;
      }
      return void 0;
    };
    const prefixesOf = (kind) => {
      const p = config.classPrefixes;
      return kind === "svg" ? [...p.svg ?? [...p.text, ...p.stroke, ...p.fill]] : p[kind];
    };
    const pick = (color, chain, kind) => {
      const wanted = hex2(color[0], color[1], color[2]);
      const prefixes = prefixesOf(kind);
      for (const classes of chain) {
        for (const c of classes.split(" ")) {
          if (c === "" || c.includes(":")) continue;
          for (const prefix of prefixes) {
            if (!c.startsWith(prefix)) continue;
            const v = classVar(c.slice(prefix.length).split("/")[0] ?? "");
            if (v !== void 0 && hexOf.get(v) === wanted) return v;
          }
        }
      }
      return fallback.get(wanted) ?? null;
    };
    return {
      paint(color, chain, kind) {
        const variable = pick(color, chain, kind);
        if (variable !== null) return { bind: variable, opacity: color[3] };
        onUntokenized(hex2(color[0], color[1], color[2]));
        return {
          type: "SOLID",
          color: { r: color[0] / 255, g: color[1] / 255, b: color[2] / 255 },
          opacity: color[3]
        };
      },
      numVar(kind, value) {
        const prefix = config.numbers?.[kind]?.prefix;
        if (prefix === void 0) return null;
        const hit = numbers.find(
          (n) => n.name.startsWith(prefix) && Math.abs(n.value - value) < 0.01
        );
        return hit?.variable ?? null;
      },
      fullRadius() {
        const name = config.numbers?.radius?.full;
        return name === void 0 ? null : tokens.variable(name) ?? null;
      },
      byName: (name) => tokens.variable(name)
    };
  }

  // kits/figma/screen/fonts.ts
  var round2 = (n) => Math.round(n * 100) / 100;
  function fontsIn(nodes, out = []) {
    for (const n of nodes) {
      if (n.font !== void 0) out.push(n.font);
      if (n.kids !== void 0) fontsIn(n.kids, out);
    }
    return out;
  }
  async function createTextKit(config, plan) {
    const families = config.families.map((f) => ({
      pattern: new RegExp(f.match, "i"),
      family: f.family
    }));
    const strict = new Set(config.strict ?? []);
    const substitute = /* @__PURE__ */ new Map();
    const unavailableItalic = /* @__PURE__ */ new Set();
    const style = (weight) => config.styles[weight] ?? "Regular";
    const italic = (base) => base === "Regular" ? config.italic.suffix : `${base} ${config.italic.suffix}`;
    const familyOf = (css) => {
      const found = families.find((f) => f.pattern.test(css ?? ""));
      const chosen = found?.family ?? config.default;
      return substitute.get(chosen) ?? chosen;
    };
    const wanted = /* @__PURE__ */ new Map();
    const need = (family, base, isItalic) => wanted.set(`${family}\0${base}\0${isItalic}`, {
      family,
      style: isItalic ? italic(base) : base,
      italic: isItalic
    });
    for (const font of fontsIn(plan.root)) {
      const family = (families.find((f) => f.pattern.test(font.fam ?? "")) ?? {
        family: config.default
      }).family;
      const base = style(font.weight);
      need(family, base, false);
      if (font.fs === "italic") need(family, base, true);
    }
    const regular = [...wanted.values()].filter((w) => !w.italic);
    try {
      await loadFonts(regular);
    } catch (e) {
      const fallback = config.fallback;
      if (fallback === void 0) throw e;
      for (const w of regular) {
        try {
          await loadFonts([{ family: w.family, style: w.style }]);
        } catch {
          try {
            await loadFonts([{ family: fallback, style: w.style }]);
          } catch {
            return fail(
              "FONT_MISSING",
              `No se pudo cargar ${w.family} ${w.style} ni la familia de respaldo ${fallback}.`,
              "Instala la fuente en Figma o cambia `fonts.fallback` de map@1 y repite el paso."
            );
          }
          substitute.set(w.family, fallback);
          note.warn(
            "FONT_FALLBACK",
            `${w.family} ${w.style} no está en Figma: se usa ${fallback}.`
          );
        }
      }
    }
    const italics = [...wanted.values()].filter((w) => w.italic);
    for (const w of italics) {
      const missing = await loadFonts(
        [{ family: substitute.get(w.family) ?? w.family, style: w.style }],
        { optional: true }
      );
      if (missing.length > 0) {
        unavailableItalic.add(`${w.family}\0${w.style}`);
        note.warn(
          "FONT_ITALIC_MISSING",
          `${w.family} ${w.style} no está en Figma: el texto en cursiva se pinta recto.`
        );
      }
    }
    const normal = /* @__PURE__ */ new Map();
    const exact = /* @__PURE__ */ new Map();
    for (const s of await figmaApi().getLocalTextStylesAsync()) {
      const family = s.fontName.family;
      if (strict.has(family)) {
        if (s.lineHeight.unit === "PIXELS") {
          exact.set(
            [
              family,
              s.fontSize,
              s.fontName.style,
              Math.round(s.lineHeight.value),
              round2(s.letterSpacing.value),
              s.textCase
            ].join("|"),
            s
          );
        }
      } else normal.set(`${family}|${s.fontSize}|${s.fontName.style}`, s);
    }
    return {
      family: familyOf,
      style,
      isStrict: (family) => strict.has(family),
      fontName(font) {
        const family = familyOf(font.fam);
        const base = style(font.weight);
        if (font.fs !== "italic") return { family, style: base };
        const name = italic(base);
        const original = families.find((f) => f.pattern.test(font.fam ?? ""))?.family ?? config.default;
        return unavailableItalic.has(`${original}\0${name}`) ? { family, style: base } : { family, style: name };
      },
      textStyle: (family, size, base) => normal.get(`${family}|${size}|${base}`),
      strictStyle: (family, font, base) => exact.get(
        [
          family,
          font.size,
          base,
          Math.round(Number.parseFloat(font.lh) || 0),
          round2(Number.parseFloat(font.ls) || 0),
          font.tt === "uppercase" ? "UPPER" : "ORIGINAL"
        ].join("|")
      )
    };
  }

  // kits/figma/screen/ctx.ts
  async function createCtx(plan, assets, recognize = null) {
    const module = recognize === null ? null : checkRecognize(recognize);
    const counters = {
      nodes: 0,
      images: 0,
      icons: 0,
      components: {},
      moved: [],
      wrapped: [],
      untokenized: /* @__PURE__ */ new Map(),
      matches: []
    };
    const tokens = await loadTokens(plan.map.tokens.collections);
    const paint = createPaintResolver(
      tokens,
      plan.map.tokens,
      (color) => counters.untokenized.set(color, (counters.untokenized.get(color) ?? 0) + 1)
    );
    const text = await createTextKit(plan.map.fonts, plan);
    const effects = /* @__PURE__ */ new Map();
    if (plan.map.effects !== void 0) {
      for (const s of await figmaApi().getLocalEffectStylesAsync())
        effects.set(s.name, s);
    }
    const icons = /* @__PURE__ */ new Map();
    const pages = new RegExp(plan.map.icons.pages);
    for (const page of figmaApi().root.children) {
      if (!pages.test(page.name)) continue;
      await page.loadAsync();
      for (const c of page.findAllWithCriteria({ types: ["COMPONENT"] })) {
        icons.set(c.name.replace(plan.map.icons.prefix, ""), c);
      }
    }
    const warned = /* @__PURE__ */ new Set();
    const ctx = {
      plan,
      assets,
      km: /* @__PURE__ */ new Map(),
      clip: 0,
      counters,
      paint,
      text,
      effects,
      effectPattern: plan.map.effects === void 0 ? null : new RegExp(plan.map.effects.classPattern),
      icons,
      hashes: /* @__PURE__ */ new Map(),
      warn(code, message, nodeId) {
        const key = `${code}\0${message}`;
        if (warned.has(key)) return;
        warned.add(key);
        note.warn(code, message, nodeId);
      },
      recognizer: null,
      layerNames: [],
      ownTitle: null
    };
    ctx.recognizer = await createRecognizer(ctx, module);
    return ctx;
  }

  // kits/figma/screen/roots.ts
  var WIDTH_TOLERANCE3 = 1;
  var STACK_TOLERANCE = 1.5;
  function scrolls(ctx, c, n) {
    const wanted = n.pos === "fixed" ? "FIXED" : "STICKY_SCROLLS";
    const node = c;
    try {
      node.scrollBehavior = wanted;
    } catch (e) {
      ctx.warn(
        "SCROLL_BEHAVIOR",
        `No se pudo fijar el desplazamiento de «${c.name}»: ${e instanceof Error ? e.message : String(e)}`,
        c.id
      );
      return;
    }
    if (node.scrollBehavior !== wanted) {
      ctx.warn(
        "SCROLL_BEHAVIOR",
        `«${c.name}» no conservó el desplazamiento ${wanted} (se lee ${node.scrollBehavior}).`,
        c.id
      );
    }
  }
  var isStack = (flow) => {
    const sorted2 = [...flow].sort((a, b) => a.y - b.y);
    const first = sorted2[0];
    return sorted2.length > 1 && sorted2.every((n, i) => {
      if (Math.abs(n.x) >= WIDTH_TOLERANCE3) return false;
      if (Math.abs(n.w - first.w) >= WIDTH_TOLERANCE3) return false;
      const prev = sorted2[i - 1];
      return prev === void 0 ? Math.abs(n.y) < WIDTH_TOLERANCE3 : Math.abs(n.y - (prev.y + prev.h)) < STACK_TOLERANCE;
    });
  };
  async function paintRoots(ctx) {
    const nodes = ctx.plan.root;
    const only = nodes[0];
    if (nodes.length === 1 && only !== void 0 && only.t === "frame") {
      return paintNode(ctx, only, []);
    }
    const f = figmaApi();
    const root = f.createFrame();
    ctx.counters.nodes++;
    if (nodes.length === 1 && only !== void 0) {
      root.fills = [];
      root.layoutMode = "HORIZONTAL";
      root.primaryAxisSizingMode = "AUTO";
      root.counterAxisSizingMode = "AUTO";
      root.appendChild(
        only.t === "svg" ? paintSvg(ctx, only, [only.cls ?? ""]) : paintImage(ctx, only)
      );
      return root;
    }
    const flow = nodes.filter((n) => n.pos !== "fixed");
    if (flow.length > 0 && isStack(flow)) {
      const background = ctx.plan.map.screen?.background;
      const variable = background === void 0 ? void 0 : ctx.paint.byName(background);
      if (background !== void 0 && variable === void 0) {
        ctx.warn(
          "BACKGROUND_NOT_FOUND",
          `La variable de fondo «${background}» no existe: el marco queda sin relleno.`
        );
      }
      setPaints(
        root,
        "fills",
        variable === void 0 ? [] : [{ bind: variable, opacity: 1 }],
        { track: false }
      );
      root.clipsContent = true;
      root.layoutMode = "VERTICAL";
      root.primaryAxisSizingMode = "AUTO";
      root.counterAxisSizingMode = "FIXED";
      root.resize(nodes[0].w, 100);
      for (const n of [...flow].sort(
        (a, b) => a.y - b.y
      )) {
        const c = await paintNode(ctx, n, []);
        root.appendChild(c);
        c.layoutAlign = "STRETCH";
        if (n.pos === "sticky" || n.pos === "fixed") scrolls(ctx, c, n);
      }
      for (const n of nodes.filter((x) => x.pos === "fixed")) {
        const c = await paintNode(ctx, n, []);
        root.appendChild(c);
        c.layoutPositioning = "ABSOLUTE";
        c.x = n.x;
        c.y = n.y;
      }
      return root;
    }
    root.fills = [];
    root.clipsContent = false;
    const x0 = Math.min(...nodes.map((n) => n.x));
    const y0 = Math.min(...nodes.map((n) => n.y));
    const x1 = Math.max(...nodes.map((n) => n.x + n.w));
    const y1 = Math.max(...nodes.map((n) => n.y + n.h));
    root.resize(x1 - x0, y1 - y0);
    for (const n of nodes) {
      const c = await paintNode(ctx, n, []);
      root.appendChild(c);
      c.x = n.x - x0;
      c.y = n.y - y0;
    }
    return root;
  }

  // kits/figma/screen/index.ts
  async function paintScreen(plan, assets, recognize) {
    const ctx = await createCtx(plan, assets, recognize ?? null);
    const root = await paintRoots(ctx);
    ctx.recognizer?.flush();
    return { root, ctx };
  }

  // kits/figma/sheet/page.ts
  var INDENTED = /^\s/;
  var byKey = async (key) => {
    for (const page of figmaApi().root.children) {
      await page.loadAsync();
      if (page.getSharedPluginData(NS, KEY) === key) return page;
    }
    return null;
  };
  function indexFor(target) {
    const kids = figmaApi().root.children;
    const { after, section } = target;
    if (after !== void 0) {
      const at2 = kids.findIndex((p) => p.name.trim() === after.trim());
      if (at2 >= 0) return at2 + 1;
    }
    if (section !== void 0) {
      let at2 = kids.findIndex((p) => p.name === section);
      if (at2 >= 0) {
        while (at2 + 1 < kids.length && INDENTED.test(kids[at2 + 1]?.name ?? ""))
          at2++;
        return at2 + 1;
      }
    }
    if (after !== void 0 || section !== void 0) {
      note.warn(
        "PAGE_AFTER_NOT_FOUND",
        `No hay página «${after ?? section ?? ""}»: «${target.name}» queda al final.`
      );
    }
    return kids.length;
  }
  var isScratch = (plan) => plan.target.page.key.startsWith(SHEET_SCRATCH_KEY_PREFIX);
  async function findSheetPage(plan) {
    const page = await byKey(plan.target.page.key);
    if (page !== null) return { page, adopted: false };
    const named = await findPage(plan.target.page.name);
    return { page: named, adopted: named !== null };
  }
  async function sheetPage(plan, found, hasSet) {
    const f = figmaApi();
    const target = plan.target.page;
    const scratch = isScratch(plan);
    let { page } = found;
    if (page !== null && !scratch && !hasSet && page.children.length > 0) {
      fail(
        "SHEET_EXISTS",
        `La página «${page.name}» ya tiene contenido y ninguno de sus sets es el de la hoja «${plan.sheet.key}»: no se repinta encima.`,
        "Pinta la hoja en la página aparte (scratch) o vacía esa página a mano."
      );
    }
    if (page === null) {
      page = f.createPage();
      page.name = target.name;
      f.root.insertChild(indexFor(target), page);
      tagNode(page, target.key);
      note.created(page);
    } else if (found.adopted) {
      tagNode(page, target.key);
      note.warn(
        "ADOPTED",
        `La página «${page.name}» no tenía clave: se adopta como la de la hoja.`,
        page.id
      );
    }
    if (scratch) {
      const old = [...page.children];
      note.removed(old);
      for (const child of old) child.remove();
    }
    await f.setCurrentPageAsync(page);
    return page;
  }

  // kits/figma/sheet/properties.ts
  var baseName2 = (key) => key.split("#")[0] ?? key;
  var slotKeyOf = (node) => node.componentPropertyReferences?.slotContentId ?? "";
  var ownLayer = (node, root) => {
    for (let p = node.parent; p !== null && p.id !== root.id; p = p.parent) {
      if (p.type === "INSTANCE") return false;
    }
    return true;
  };
  function declaredProperties(sheet) {
    const out = [];
    for (const t of sheet.texts ?? []) out.push({ name: t.name, type: "TEXT" });
    for (const o of sheet.icons ?? []) {
      if (o.boolean !== void 0) out.push({ name: o.boolean, type: "BOOLEAN" });
      if (o.swap !== void 0) out.push({ name: o.swap, type: "INSTANCE_SWAP" });
    }
    for (const b of sheet.booleans ?? [])
      out.push({ name: b.name, type: "BOOLEAN" });
    for (const s of sheet.slots ?? []) {
      out.push({ name: s.name, type: "SLOT" });
      if (s.boolean !== void 0) out.push({ name: s.boolean, type: "BOOLEAN" });
    }
    return out;
  }
  var handMadeKeys = (set) => Object.keys(set.componentPropertyDefinitions).filter(
    (k) => set.componentPropertyDefinitions[k]?.type !== "VARIANT"
  );
  function settleHidden(layers) {
    for (const layer of layers) {
      if (layer.visible) continue;
      layer.visible = true;
      layer.visible = false;
    }
  }
  var sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function addProperties(ctx, plan, set, variants) {
    const { sheet } = plan;
    const keys = /* @__PURE__ */ new Map();
    const updated = [];
    const existing = /* @__PURE__ */ new Map();
    for (const k of handMadeKeys(set)) existing.set(baseName2(k), k);
    const add = (id, name, type, value, options2) => {
      if (keys.has(id)) return;
      const found = existing.get(name);
      if (found !== void 0) {
        const def = set.componentPropertyDefinitions[found];
        if (def?.type !== type) {
          fail(
            "SHEET_PROPERTY_TYPE",
            `La propiedad «${name}» del set es de tipo ${String(def?.type)} y los datos la piden ${type}: Figma no cambia el tipo de una propiedad.`,
            "Quita o renombra esa propiedad a mano en Figma, o cambia su nombre en sheets.json, y repite el paso."
          );
        }
        const change = {};
        if (def.defaultValue !== value) change.defaultValue = value;
        if (options2 !== void 0 && !sameJson(
          (def.preferredValues ?? []).map((p) => p.key).sort(),
          options2.preferredValues.map((p) => p.key).sort()
        ))
          change.preferredValues = options2.preferredValues;
        if (Object.keys(change).length === 0) {
          keys.set(id, found);
          return;
        }
        keys.set(id, set.editComponentProperty(found, change));
        updated.push(name);
        return;
      }
      keys.set(
        id,
        options2 === void 0 ? set.addComponentProperty(name, type, value) : set.addComponentProperty(name, type, value, options2)
      );
    };
    for (const t of sheet.texts ?? []) add(`T${t.name}`, t.name, "TEXT", t.match);
    const preferred = [...ctx.icons.values()].map((c) => ({
      type: "COMPONENT",
      key: c.key
    }));
    for (const o of sheet.icons ?? []) {
      if (o.boolean !== void 0)
        add(`B${o.boolean}`, o.boolean, "BOOLEAN", o.on === true);
      if (o.swap !== void 0) {
        const icon = ctx.icons.get(o.icon);
        if (icon === void 0) {
          note.warn(
            "ICON_NOT_FOUND",
            `El icono «${o.icon}» de la propiedad «${o.swap}» no está en el catálogo de iconos: esa propiedad no se crea.`
          );
          continue;
        }
        add(`S${o.swap}`, o.swap, "INSTANCE_SWAP", icon.id, {
          preferredValues: preferred
        });
      }
    }
    for (const b of sheet.booleans ?? [])
      add(`B${b.name}`, b.name, "BOOLEAN", b.on === true);
    for (const s of sheet.slots ?? [])
      if (s.boolean !== void 0)
        add(`B${s.boolean}`, s.boolean, "BOOLEAN", true);
    const mixed = figmaApi().mixed;
    const visibleRefs = [];
    const prefix = plan.map.icons.prefix;
    for (const v of variants) {
      const c = v.component;
      for (const t of sheet.texts ?? []) {
        const key = keys.get(`T${t.name}`);
        if (key === void 0) continue;
        const targets = c.findAllWithCriteria({ types: ["TEXT"] }).filter(
          (x) => x.characters.trim() === t.match && x.fontName !== mixed && ownLayer(x, c)
        );
        for (const x of targets)
          x.componentPropertyReferences = { characters: key };
      }
      const icons = c.findAllWithCriteria({ types: ["INSTANCE"] }).filter((x) => x.name.startsWith(prefix) && ownLayer(x, c));
      for (const x of icons) {
        const o = (sheet.icons ?? []).find(
          (i) => i.icon === x.name.slice(prefix.length)
        );
        if (o === void 0) continue;
        const refs = {};
        const swap = o.swap === void 0 ? void 0 : keys.get(`S${o.swap}`);
        if (swap !== void 0) refs["mainComponent"] = swap;
        const skip = Object.entries(o.noBooleanWhen ?? {}).length > 0 && Object.entries(o.noBooleanWhen ?? {}).every(
          ([k, val]) => v.props[k] === val
        );
        const bool = o.boolean === void 0 ? void 0 : keys.get(`B${o.boolean}`);
        if (bool !== void 0 && !skip) refs["visible"] = bool;
        x.componentPropertyReferences = refs;
        if (refs["visible"] !== void 0) visibleRefs.push(x);
      }
      for (const b of sheet.booleans ?? []) {
        const key = keys.get(`B${b.name}`);
        if (key === void 0) continue;
        const targets = c.findAll((n) => n.name === b.layer && ownLayer(n, c));
        for (const x of targets) {
          x.componentPropertyReferences = {
            ...x.componentPropertyReferences ?? {},
            visible: key
          };
          visibleRefs.push(x);
        }
      }
      for (const s of sheet.slots ?? []) {
        const key = s.boolean === void 0 ? void 0 : keys.get(`B${s.boolean}`);
        if (key === void 0) continue;
        const targets = c.findAllWithCriteria({ types: ["SLOT"] }).filter((n) => ownLayer(n, c) && baseName2(slotKeyOf(n)) === s.name);
        for (const x of targets) {
          x.componentPropertyReferences = {
            ...x.componentPropertyReferences ?? {},
            visible: key
          };
          visibleRefs.push(x);
        }
      }
    }
    settleHidden(visibleRefs);
    return { keys, updated };
  }

  // kits/figma/sheet/overrides.ts
  var KEPT = {
    characters: (node) => node.type === "TEXT",
    visible: () => true,
    componentProperties: (node) => node.type === "INSTANCE"
  };
  var DERIVED = {
    styledTextSegments: "characters",
    name: "componentProperties"
  };
  var MAX_VALUE = 60;
  var UNKNOWN = "?";
  var ORPHAN = " (sin capa antes de rehacer)";
  var CHANGED = " (la capa cambió)";
  var childrenOf = (n) => n.children ?? [];
  var show = (path) => path.map((s) => s.nth > 0 ? `${s.name}[${s.nth}]` : s.name).join(" > ");
  async function changedProperties(node) {
    const main = await node.getMainComponentAsync();
    const owner = main?.parent?.type === "COMPONENT_SET" ? main.parent : main;
    const defs = owner?.componentPropertyDefinitions ?? {};
    const out = {};
    for (const [key, prop] of Object.entries(node.componentProperties)) {
      if (prop.type === "SLOT") continue;
      if (prop.value !== defs[key]?.defaultValue) out[key] = prop.value;
    }
    return out;
  }
  async function signature(node) {
    if (node.type === "INSTANCE") {
      const main = await node.getMainComponentAsync();
      const owner = main?.parent?.type === "COMPONENT_SET" ? main.parent : main;
      return `INSTANCE:${owner?.id ?? ""}`;
    }
    if (node.type === "TEXT") return "TEXT";
    return `${node.type}:${childrenOf(node).map((c) => c.name).join("|")}`;
  }
  var clip = (text) => text.length > MAX_VALUE ? `${text.slice(0, MAX_VALUE)}…` : text;
  var hex3 = (c) => `#${[c.r, c.g, c.b].map(
    (x) => Math.round(x * 255).toString(16).padStart(2, "0")
  ).join("")}`;
  var paintOf = (p) => {
    const paint = p;
    return paint.type === "SOLID" && paint.color !== void 0 ? hex3(paint.color) : paint.type ?? UNKNOWN;
  };
  var PAINTS = ["fills", "strokes"];
  function showValue(field, value) {
    if (value === void 0) return UNKNOWN;
    if (typeof value === "symbol") return "mezclado";
    if (typeof value === "string") return `"${clip(value)}"`;
    if (typeof value !== "object" || value === null) return String(value);
    if (Array.isArray(value))
      return PAINTS.includes(field) ? value.length === 0 ? "ninguno" : clip(value.map(paintOf).join(",")) : `${value.length} elementos`;
    return clip(JSON.stringify(value));
  }
  var fieldsOf = (node, fields) => fields.map(
    (f) => `${f}=${node === null ? UNKNOWN : showValue(f, node[f])}`
  );
  function droppedFields(node, changed) {
    const kept = (f) => KEPT[f]?.(node) ?? false;
    return changed.filter((f) => {
      const partner = DERIVED[f];
      return !kept(f) && !(partner !== void 0 && changed.includes(partner) && kept(partner));
    });
  }
  function pathFrom(node) {
    const steps2 = [];
    let n = node;
    while (n.parent !== null && n.parent.type !== "PAGE") {
      const parent = n.parent;
      const nth = childrenOf(parent).filter((c) => c.name === n.name).indexOf(n);
      steps2.unshift({ name: n.name, nth: Math.max(0, nth) });
      if (parent.type === "COMPONENT" || parent.type === "INSTANCE" || parent.type === "COMPONENT_SET")
        break;
      n = parent;
    }
    return steps2;
  }
  async function orphan(instance, id, fields) {
    const source = id.split(";").at(-1) ?? id;
    const origin = await figmaApi().getNodeByIdAsync(
      source
    );
    const path = origin === null ? null : pathFrom(origin);
    const here = path === null ? null : resolve(instance, path);
    return {
      instance,
      path: path === null ? id : show(path),
      reason: ORPHAN,
      values: fieldsOf(here, fields)
    };
  }
  async function readInstance(instance) {
    const fields = /* @__PURE__ */ new Map();
    for (const o of instance.overrides)
      if (o.id !== instance.id) fields.set(o.id, o.overriddenFields);
    const saved = [];
    const dropped = [];
    const seen = /* @__PURE__ */ new Set();
    const walk = async (node, path) => {
      const names = /* @__PURE__ */ new Map();
      for (const child of childrenOf(node)) {
        const nth = names.get(child.name) ?? 0;
        names.set(child.name, nth + 1);
        const here = [...path, { name: child.name, nth }];
        const changed = fields.get(child.id);
        if (changed !== void 0) {
          seen.add(child.id);
          const lost = droppedFields(child, changed);
          if (lost.length > 0)
            dropped.push({
              instance,
              path: show(here),
              reason: "",
              values: fieldsOf(child, lost)
            });
          const entry = {
            instance,
            path: here,
            sig: await signature(child)
          };
          if (changed.includes("characters") && child.type === "TEXT")
            entry.characters = child.characters;
          if (changed.includes("visible")) entry.visible = child.visible;
          if (changed.includes("componentProperties") && child.type === "INSTANCE") {
            const properties = await changedProperties(child);
            if (Object.keys(properties).length > 0) entry.properties = properties;
          }
          if (entry.characters !== void 0 || entry.visible !== void 0 || entry.properties !== void 0)
            saved.push(entry);
        }
        await walk(child, here);
      }
    };
    await walk(instance, []);
    for (const [id, changed] of fields)
      if (!seen.has(id)) dropped.push(await orphan(instance, id, changed));
    return { saved, dropped };
  }
  async function captureOverrides(variant, page) {
    const out = { saved: [], dropped: [] };
    for (const inst of await variant.getInstancesAsync()) {
      if (pageOf(inst)?.id === page.id) continue;
      const read = await readInstance(inst);
      out.saved.push(...read.saved);
      out.dropped.push(...read.dropped);
    }
    return out;
  }
  function resolve(instance, path) {
    let node = instance;
    for (const step of path) {
      const next = childrenOf(node).filter(
        (c) => c.name === step.name
      )[step.nth];
      if (next === void 0) return null;
      node = next;
    }
    return node;
  }
  var valuesOf = (s) => [
    ...s.characters === void 0 ? [] : [`characters=${showValue("characters", s.characters)}`],
    ...s.visible === void 0 ? [] : [`visible=${s.visible}`],
    ...Object.entries(s.properties ?? {}).map(
      ([k, v]) => `${k}=${showValue(k, v)}`
    )
  ];
  async function apply(saved, node) {
    let ok = true;
    if (saved.properties !== void 0 && node.type === "INSTANCE") {
      const inst = node;
      for (const [key, value] of Object.entries(saved.properties)) {
        if (inst.componentProperties[key]?.value === value) continue;
        try {
          inst.setProperties({ [key]: value });
        } catch {
          ok = false;
        }
      }
    }
    if (saved.characters !== void 0 && node.type === "TEXT") {
      const text = node;
      if (text.characters !== saved.characters) {
        try {
          if (typeof text.fontName !== "symbol")
            await figmaApi().loadFontAsync(text.fontName);
          text.characters = saved.characters;
        } catch {
          ok = false;
        }
      }
    }
    if (saved.visible !== void 0 && node.visible !== saved.visible) {
      try {
        node.visible = saved.visible;
      } catch {
        ok = false;
      }
    }
    return ok;
  }
  async function reapplyOverrides(captured) {
    const lost = /* @__PURE__ */ new Map();
    const add = (d) => {
      lost.set(d.instance, [...lost.get(d.instance) ?? [], d]);
    };
    for (const d of captured.dropped) add(d);
    for (const s of captured.saved) {
      const node = resolve(s.instance, s.path);
      const reason = node === null ? "" : await signature(node) !== s.sig ? CHANGED : await apply(s, node) ? null : "";
      if (reason !== null)
        add({
          instance: s.instance,
          path: show(s.path),
          reason,
          values: valuesOf(s)
        });
      else if (node !== null) note.mutated(node);
    }
    for (const [inst, drops] of lost) {
      const page = pageOf(inst)?.name ?? "";
      const count2 = drops.reduce((n, d) => n + d.values.length, 0);
      note.warn(
        "OVERRIDES_LOST",
        `La instancia «${inst.name}» (página «${page}», marco «${topFrameName(inst)}») perdió ${count2 === 1 ? "un cambio" : `${count2} cambios`} al rehacer la hoja: la capa ya no existe, cambió de papel, no admite el valor o es un campo que el kit no reaplica. Cambios: ${drops.map((d) => `${d.path}${d.reason}: ${d.values.join(", ")}`).join("; ")}.`,
        inst.id
      );
    }
  }

  // kits/figma/sheet/flow-icons.ts
  function flowIcons(n) {
    for (const k of n.kids ?? []) flowIcons(k);
    const kids = n.kids ?? [];
    const inp = kids.find((k) => k.tag === "input");
    if (inp === void 0) return;
    const svgOf = (h) => (h.kids ?? []).find((c) => c.t === "svg");
    const inside = (h) => {
      const sv = svgOf(h);
      if (sv === void 0) return false;
      const ix = h.x + sv.x;
      return ix >= inp.x && ix + sv.w <= inp.x + inp.w;
    };
    const holders = kids.filter(
      (k) => k.pos === "absolute" && (k.kids ?? []).some((c) => c.t === "svg") && inside(k)
    );
    if (holders.length === 0) return;
    const text = (inp.kids ?? []).find((k) => k.t === "text");
    if (text !== void 0) text.grow = true;
    const pad = inp.pad ?? [0, 0, 0, 0];
    inp.pad = pad;
    inp.kids = inp.kids ?? [];
    let gap = 0;
    for (const h of holders) {
      const sv = svgOf(h);
      const ix = h.x + sv.x;
      sv.pos = "static";
      sv.noPos = true;
      const left = ix < inp.x + inp.w / 2;
      if (left) {
        gap = Math.max(gap, inp.x + pad[3] - (ix + sv.w));
        pad[3] = ix - inp.x;
        inp.kids.unshift(sv);
      } else {
        gap = Math.max(
          gap,
          ix - (inp.x + inp.w - pad[1])
        );
        pad[1] = inp.x + inp.w - (ix + sv.w);
        inp.kids.push(sv);
      }
    }
    n.kids = kids.filter((k) => !holders.includes(k));
    Object.assign(inp, {
      disp: "flex",
      dir: "row",
      ai: "center",
      jc: "normal",
      gap: Math.round(gap)
    });
  }

  // kits/figma/sheet/variants.ts
  function screenView(plan) {
    const own = plan.sheet.title.toLowerCase();
    return {
      contract: "screen@1",
      screen: plan.sheet.screen,
      title: plan.sheet.title,
      variant: 0,
      props: {},
      sources: {
        capture: plan.sources.capture,
        map: plan.sources.map,
        ...plan.sources.recognize !== void 0 && {
          recognize: plan.sources.recognize
        }
      },
      target: {
        page: { name: plan.target.page.name, key: plan.target.page.key },
        frame: { name: plan.target.set.name, key: plan.target.set.key }
      },
      root: plan.variants.flatMap((v) => v.root),
      images: plan.images,
      icons: plan.icons,
      map: plan.map,
      ...plan.fingerprints !== void 0 && {
        fingerprints: plan.fingerprints
      },
      ...plan.rules !== void 0 && {
        rules: plan.rules.filter((r) => r.toLowerCase() !== own)
      },
      warnings: plan.warnings
    };
  }
  async function createSheetCtx(plan, assets, recognize) {
    const ctx = await createCtx(screenView(plan), assets, recognize ?? null);
    ctx.layerNames = plan.sheet.names ?? [];
    ctx.ownTitle = plan.sheet.title;
    if (plan.sheet.flowIcons === true) {
      for (const v of plan.variants) for (const n of v.root) flowIcons(n);
    }
    return ctx;
  }
  var variantName = (props2) => Object.entries(props2).map(([k, v]) => `${k}=${v}`).join(", ");
  async function paintVariants(ctx, plan, page) {
    const f = figmaApi();
    const out = [];
    for (const variant of plan.variants) {
      ctx.plan.root = variant.root;
      ctx.plan.props = variant.props;
      const root = await paintRoots(ctx);
      page.appendChild(root);
      const component = f.createComponentFromNode(root);
      component.name = variantName(variant.props);
      out.push({ props: variant.props, component });
    }
    return out;
  }
  async function refuseForeignVariants(plan, painted, alsoRemove) {
    const own = plan.sheet.title.trim().toLowerCase();
    const iconPages = new RegExp(plan.map.icons.pages);
    const bad = [];
    for (const p of painted) {
      const kids = p.component.children.filter((c) => c.visible);
      const only = kids[0];
      if (kids.length !== 1 || only === void 0 || only.type !== "INSTANCE")
        continue;
      const main = await only.getMainComponentAsync();
      if (main === null || iconPages.test(pageOf(main)?.name ?? "")) continue;
      const name = main.parent?.type === "COMPONENT_SET" ? main.parent.name : main.name;
      if (name.trim().toLowerCase() === own) continue;
      bad.push(`«${p.component.name}» es solo una instancia de «${name.trim()}»`);
    }
    if (bad.length === 0) return;
    for (const n of [...painted.map((p) => p.component), ...alsoRemove]) {
      note.removed(n);
      if (!n.removed) n.remove();
    }
    fail(
      "SHEET_ROOT_IS_OTHER",
      `La hoja «${plan.sheet.key}» no se escribe: ${bad.join("; ")}. La captura se reconoció como otro componente.`,
      "Revisa las huellas (fingerprints) y `rules` de la hoja, o la captura de la pantalla, y repite el paso."
    );
  }

  // kits/figma/sheet/set.ts
  function exposeNamed(component, names) {
    const failed = [];
    for (const x of component.findAllWithCriteria({ types: ["INSTANCE"] })) {
      if (!names.includes(x.name)) continue;
      try {
        x.isExposedInstance = true;
      } catch (e) {
        failed.push({
          id: x.id,
          message: e instanceof Error ? e.message : String(e)
        });
      }
    }
    return failed;
  }
  function finishSet(plan, set, variants, created, fresh) {
    const { sheet } = plan;
    for (const v of variants) {
      for (const f of exposeNamed(v.component, sheet.exposed ?? [])) {
        note.warn(
          "EXPOSE_FAILED",
          `No se pudo exponer «${f.id}» en «${v.component.name}»: ${f.message}`,
          f.id
        );
      }
      tagNode(
        v.component,
        `${SHEET_VARIANT_KEY_PREFIX}${sheet.key}:${v.component.name}`
      );
    }
    note.created(created);
    set.name = plan.target.set.name;
    const bug = sheet.bug === void 0 ? "" : `${plan.style.bug?.setPrefix ?? ""}${sheet.bug}

`;
    set.description = `${bug}${sheet.description}${sheet.tag === void 0 ? "" : `
${sheet.tag}`}`;
    tagNode(set, plan.target.set.key);
    if (fresh) note.created(set);
  }
  function buildSet(plan, painted, matrix) {
    const set = figmaApi().combineAsVariants(
      painted.map((p) => p.component),
      matrix
    );
    const queue = /* @__PURE__ */ new Map();
    for (const child of set.children) {
      if (child.type !== "COMPONENT") continue;
      queue.set(child.name, [...queue.get(child.name) ?? [], child]);
    }
    const variants = [];
    for (const [index, p] of painted.entries()) {
      const found = queue.get(variantName(p.props))?.shift();
      if (found === void 0) continue;
      variants.push({ index, props: p.props, component: found });
    }
    finishSet(
      plan,
      set,
      variants,
      variants.map((v) => v.component),
      true
    );
    return { set, variants };
  }

  // kits/figma/sheet/rebuild.ts
  var messageOf3 = (e) => e instanceof Error ? e.message : String(e);
  var APPEARANCE = [
    "layoutWrap",
    "counterAxisSpacing",
    "strokesIncludedInLayout",
    "topLeftRadius",
    "topRightRadius",
    "bottomLeftRadius",
    "bottomRightRadius",
    "strokes",
    "strokeAlign",
    "strokeTopWeight",
    "strokeRightWeight",
    "strokeBottomWeight",
    "strokeLeftWeight",
    "effects",
    "opacity"
  ];
  function copyProps(from, to, props2, name, nodeId) {
    const source = from;
    const target = to;
    for (const prop of props2) {
      if (source[prop] === void 0) continue;
      try {
        target[prop] = source[prop];
      } catch (e) {
        note.warn(
          "LAYOUT_PROP",
          `No se pudo copiar «${prop}» a «${name}»: ${messageOf3(e)}`,
          nodeId
        );
      }
    }
  }
  var propsKey = (props2) => JSON.stringify(Object.entries(props2).sort(([a], [b]) => a.localeCompare(b)));
  async function locateSet(plan, page) {
    const setKey = plan.target.set.key;
    const found = [];
    for (const p of figmaApi().root.children) {
      if (p.getSharedPluginData(NS, KEY).startsWith(SHEET_SCRATCH_KEY_PREFIX))
        continue;
      await p.loadAsync();
      for (const node of p.findAllWithCriteria({
        types: ["COMPONENT_SET"],
        sharedPluginData: { namespace: NS, keys: [KEY] }
      })) {
        if (node.getSharedPluginData(NS, KEY) === setKey) found.push(node);
      }
    }
    if (found.length > 1) {
      note.warn(
        "KEY_DUPLICATED",
        `La clave «${setKey}» está en ${found.length} sets; se usa el primero.`,
        found[0]?.id
      );
    }
    const byKey2 = found[0];
    if (byKey2 !== void 0) return { set: byKey2, adopted: false };
    if (page === null) return { set: null, adopted: false };
    const wanted = plan.target.set.name.trim();
    const byName = page.findAllWithCriteria({ types: ["COMPONENT_SET"] }).find((n) => n.name.trim() === wanted);
    return { set: byName ?? null, adopted: byName !== void 0 };
  }
  function handMadeNames(plan, set) {
    const names = new Set(declaredProperties(plan.sheet).map((d) => d.name));
    const keep = new Set(plan.sheet.keep ?? []);
    return handMadeKeys(set).map(baseName2).filter((n) => !names.has(n) && !keep.has(n));
  }
  function checkRebuild(plan, set) {
    const declared = declaredProperties(plan.sheet);
    const defs = set.componentPropertyDefinitions;
    const hand = handMadeNames(plan, set);
    if (hand.length > 0) {
      fail(
        "SHEET_HAND_EDITS",
        `El set «${set.name}» tiene propiedades que los datos de la hoja no declaran: ${hand.map((n) => `«${n}»`).join(", ")}. Repintar las dejaría sin capas.`,
        "Añade su nombre a `keep` de la hoja en sheets.json (se conservan tal cual) o declara su capa con texts, booleans, icons o slots, y repite el paso."
      );
    }
    const wrong = [];
    for (const key of handMadeKeys(set)) {
      const want = declared.find((d) => d.name === baseName2(key));
      if (want !== void 0 && defs[key]?.type !== want.type)
        wrong.push(
          `«${baseName2(key)}» es ${String(defs[key]?.type)} y los datos piden ${want.type}`
        );
    }
    if (wrong.length > 0) {
      fail(
        "SHEET_PROPERTY_TYPE",
        `Hay propiedades del set de «${plan.sheet.key}» con otro tipo del que piden los datos: ${wrong.join("; ")}. Figma no cambia el tipo de una propiedad.`,
        "Quita o renombra esa propiedad a mano en Figma, o cambia su nombre en sheets.json, y repite el paso."
      );
    }
  }
  async function outsideInstances(set, page) {
    const out = { count: 0, overrides: 0 };
    for (const v of set.children) {
      if (v.type !== "COMPONENT") continue;
      for (const inst of await v.getInstancesAsync()) {
        if (pageOf(inst)?.id === page.id) continue;
        out.count += 1;
        out.overrides += inst.overrides.length;
      }
    }
    return out;
  }
  function oldFrames(set, page, plan) {
    const old = [];
    let top = set;
    while (top.parent !== null && top.parent.type !== "PAGE")
      top = top.parent;
    if (top !== set && top.type === "FRAME" && top.name.trim() === plan.sheet.title.trim())
      old.push(top);
    else if (top !== set) {
      note.warn(
        "OLD_CARD_KEPT",
        `El set no estaba en una tarjeta «${plan.sheet.title}»: se deja lo que lo rodeaba.`
      );
    }
    const pages = /* @__PURE__ */ new Set([page]);
    const home = pageOf(set);
    if (home !== null) pages.add(home);
    for (const p of pages)
      for (const child of p.children)
        if (child.type === "FRAME" && child.name === "Header") old.push(child);
    return old;
  }
  function removeOld(frames) {
    note.removed(frames);
    for (const frame of frames) if (!frame.removed) frame.remove();
  }
  var isAlias = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && "id" in v;
  async function copyBindings(from, to) {
    const wanted = from.boundVariables;
    const had = to.boundVariables;
    const link = (field, variable) => {
      try {
        to.setBoundVariable(field, variable);
      } catch (e) {
        note.warn(
          "BINDING_FAILED",
          `No se pudo ligar «${field}» de «${to.name}»: ${messageOf3(e)}`,
          to.id
        );
      }
    };
    for (const field of Object.keys(had ?? {})) {
      if (isAlias(had?.[field]) && !isAlias(wanted?.[field])) link(field, null);
    }
    for (const [field, alias] of Object.entries(wanted ?? {})) {
      if (!isAlias(alias)) continue;
      const variable = await figmaApi().variables.getVariableByIdAsync(alias.id);
      if (variable !== null) link(field, variable);
    }
  }
  async function refill(target, donor, page) {
    const captured = await captureOverrides(target, page);
    target.resize(donor.width, donor.height);
    await replaceContent(target, donor, {
      copyLayout: true
    });
    copyProps(donor, target, APPEARANCE, target.name, target.id);
    await copyBindings(donor, target);
    donor.remove();
    await reapplyOverrides(captured);
  }
  var plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  async function rebuildSet(plan, set, adopted, painted, matrix, page) {
    matrix.appendChild(set);
    if (adopted) {
      note.warn(
        "ADOPTED",
        `El set «${set.name}» no tenía clave: se adopta como el de la hoja.`,
        set.id
      );
    }
    const pool = /* @__PURE__ */ new Map();
    for (const c of set.children) {
      if (c.type !== "COMPONENT") continue;
      const key = propsKey(propsOfVariant(c));
      pool.set(key, [...pool.get(key) ?? [], c]);
    }
    const variants = [];
    const made = [];
    for (const [index, p] of painted.entries()) {
      const match = pool.get(propsKey(p.props))?.shift();
      if (match !== void 0) {
        await refill(match, p.component, page);
        variants.push({ index, props: p.props, component: match });
        continue;
      }
      set.appendChild(p.component);
      made.push(p.component);
      variants.push({ index, props: p.props, component: p.component });
    }
    const mine = new Set(variants.map((v) => v.component.id));
    let kept = 0;
    for (const c of set.children) {
      if (c.type !== "COMPONENT" || mine.has(c.id)) continue;
      kept += 1;
      const outside = (await c.getInstancesAsync()).filter(
        (i) => pageOf(i)?.id !== page.id
      );
      note.warn(
        "VARIANT_NOT_CAPTURED",
        `La variante «${c.name}» está en el set y no en la captura: se queda tal cual (${plural(outside.length, "instancia fuera de la página", "instancias fuera de la página")}).`,
        c.id
      );
    }
    finishSet(plan, set, variants, made, false);
    return {
      variants,
      counts: {
        created: made.length,
        updated: variants.length - made.length,
        kept
      }
    };
  }
  function usedKeys(set) {
    const used = /* @__PURE__ */ new Set();
    for (const v of set.children) {
      if (v.type !== "COMPONENT") continue;
      for (const n of v.findAllWithCriteria({
        types: [...LINKABLE_TYPES, "SLOT"]
      })) {
        if (!ownLayer(n, v)) continue;
        for (const key of Object.values(n.componentPropertyReferences ?? {}))
          if (key !== void 0) used.add(key);
      }
    }
    return used;
  }
  function keptProperties(plan, set) {
    const declared = new Set(declaredProperties(plan.sheet).map((d) => d.name));
    const keep = (plan.sheet.keep ?? []).filter((n) => !declared.has(n));
    if (keep.length === 0) return 0;
    const used = usedKeys(set);
    let kept = 0;
    for (const key of handMadeKeys(set)) {
      const name = baseName2(key);
      if (!keep.includes(name)) continue;
      kept += 1;
      if (!used.has(key)) {
        note.warn(
          "PROPERTY_KEPT",
          `La propiedad «${name}» se conserva, pero ninguna capa de las variantes la usa ya.`
        );
      }
    }
    return kept;
  }

  // kits/figma/sheet/drift.ts
  var sorted = (xs) => [...xs].sort();
  function fingerprintOf(set, layers) {
    const defs = set.componentPropertyDefinitions;
    const variantProps = {};
    for (const key of Object.keys(defs).sort()) {
      const def = defs[key];
      if (def?.type === "VARIANT")
        variantProps[key] = sorted(def.variantOptions ?? []);
    }
    return {
      variantProps,
      variants: sorted(
        set.children.filter((c) => c.type === "COMPONENT").map((c) => c.name)
      ),
      properties: sorted(handMadeKeys(set).map(baseName2)),
      layers: [...layers]
    };
  }
  var childrenOf2 = (n) => n.children ?? [];
  var mainName = (main) => main.parent?.type === "COMPONENT_SET" ? main.parent.name : main.name;
  async function findHandMade(plan, set) {
    const defs = set.componentPropertyDefinitions;
    const declared = new Set(declaredProperties(plan.sheet).map((d) => d.name));
    const nests = new Set((plan.rules ?? []).map((r) => r.trim().toLowerCase()));
    const iconPages = new RegExp(plan.map.icons.pages);
    const found = [];
    const walk = async (variant, node, path) => {
      for (const [i, layer] of childrenOf2(node).entries()) {
        const at2 = [...path, i];
        const refs = Object.values(layer.componentPropertyReferences ?? {}).filter((k) => k !== void 0).filter((k) => defs[k] !== void 0);
        const keys = refs.filter((k) => !declared.has(baseName2(k)));
        let main = null;
        if (layer.type === "INSTANCE")
          main = await layer.getMainComponentAsync();
        const lostInstance = layer.type === "INSTANCE" && refs.length === 0 && (main === null || !iconPages.test(pageOf(main)?.name ?? "") && !nests.has(mainName(main).trim().toLowerCase()));
        if (keys.length > 0 || lostInstance)
          found.push({ variant, layer, path: at2, keys, main: main?.id ?? null });
        if (layer.type !== "INSTANCE" && layer.type !== "SLOT")
          await walk(variant, layer, at2);
      }
    };
    for (const v of set.children)
      if (v.type === "COMPONENT") await walk(v, v, []);
    return found;
  }
  function groupLayers(found) {
    const groups = /* @__PURE__ */ new Map();
    for (const f of found) {
      const properties = sorted([...new Set(f.keys.map(baseName2))]);
      const id = JSON.stringify([f.layer.name, f.layer.type, properties]);
      const g = groups.get(id) ?? {
        name: f.layer.name,
        type: f.layer.type,
        properties,
        variants: []
      };
      if (!g.variants.includes(f.variant.name)) g.variants.push(f.variant.name);
      groups.set(id, g);
    }
    return [...groups.values()].map((g) => ({ ...g, variants: sorted(g.variants) })).sort(
      (a, b) => a.name === b.name ? a.type.localeCompare(b.type) : a.name.localeCompare(b.name)
    );
  }
  var sameFingerprint = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function grouper() {
    const pages = /* @__PURE__ */ new Map();
    let total = 0;
    return {
      add(page, inst) {
        total += 1;
        const frame = topFrameName(inst);
        const frames = pages.get(page.name) ?? /* @__PURE__ */ new Map();
        frames.set(frame, (frames.get(frame) ?? 0) + 1);
        pages.set(page.name, frames);
      },
      done() {
        return {
          total,
          pages: [...pages].map(([page, frames]) => ({
            page,
            count: [...frames.values()].reduce((a, b) => a + b, 0),
            frames: [...frames].map(([name, count2]) => ({ name, count: count2 }))
          }))
        };
      }
    };
  }
  function sublayer(inst, path) {
    let node = inst;
    for (const i of path) node = childrenOf2(node)[i];
    return node ?? null;
  }
  var subtreeIds = (node) => {
    const ids = /* @__PURE__ */ new Set([node.id]);
    const add = (n) => {
      for (const c of childrenOf2(n)) {
        ids.add(c.id);
        add(c);
      }
    };
    add(node);
    return ids;
  };
  async function contentIn(set, inst, layers) {
    const defs = set.componentPropertyDefinitions;
    const out = {
      properties: false,
      overrides: false,
      swaps: false,
      slots: false
    };
    const overridden = new Set(inst.overrides.map((o) => o.id));
    for (const f of layers) {
      for (const k of f.keys) {
        const def = defs[k];
        const value = inst.componentProperties[k]?.value;
        if (def?.type !== "SLOT" && value !== void 0 && value !== def?.defaultValue)
          out.properties = true;
      }
      const sub = sublayer(inst, f.path);
      if (sub === null || sub.type !== f.layer.type) continue;
      for (const id of subtreeIds(sub))
        if (overridden.has(id)) out.overrides = true;
      if (sub.type === "INSTANCE" && f.main !== null) {
        const now = await sub.getMainComponentAsync();
        if (now !== null && now.id !== f.main) out.swaps = true;
      }
      if (sub.type === "SLOT" && childrenOf2(sub).length !== childrenOf2(f.layer).length)
        out.slots = true;
    }
    return out;
  }
  async function usageOf(set, home, found) {
    const all = grouper();
    const withContent = grouper();
    const kinds = { properties: 0, overrides: 0, swaps: 0, slots: 0 };
    for (const variant of set.children) {
      if (variant.type !== "COMPONENT") continue;
      const layers = found.filter((f) => f.variant.id === variant.id);
      for (const inst of await variant.getInstancesAsync()) {
        const page = pageOf(inst);
        if (page === null || page.id === home?.id) continue;
        all.add(page, inst);
        if (layers.length === 0) continue;
        const has2 = await contentIn(set, inst, layers);
        for (const k of Object.keys(kinds))
          if (has2[k]) kinds[k] += 1;
        if (Object.values(has2).some(Boolean)) withContent.add(page, inst);
      }
    }
    return {
      usage: all.done(),
      handMadeUsage: { ...withContent.done(), kinds }
    };
  }
  async function overridesAtRisk(set, home) {
    const affected = [];
    for (const variant of set.children) {
      if (variant.type !== "COMPONENT") continue;
      for (const inst of await variant.getInstancesAsync()) {
        const page = pageOf(inst);
        if (page === null || page.id === home?.id) continue;
        const layers = new Set(
          inst.overrides.map((o) => o.id).filter((id) => id !== inst.id)
        ).size;
        if (layers > 0)
          affected.push({
            id: inst.id,
            page: page.name,
            frame: topFrameName(inst),
            layers
          });
      }
    }
    return { total: affected.length, affected };
  }
  async function assessSheet(plan, set) {
    if (set === null) return { kind: "paint" };
    const web = plan.variants.map((v) => v.props);
    const webKeys = new Set(web.map(propsKey));
    const webProps = new Set(web.flatMap((p) => Object.keys(p)));
    const figma = set.children.filter((c) => c.type === "COMPONENT");
    const figmaKeys = new Set(figma.map((c) => propsKey(propsOfVariant(c))));
    const found = await findHandMade(plan, set);
    const handMadeLayers = groupLayers(found);
    const fingerprint = fingerprintOf(set, handMadeLayers);
    const figmaOnlyProps = {};
    for (const [prop, values] of Object.entries(fingerprint.variantProps))
      if (!webProps.has(prop)) figmaOnlyProps[prop] = values;
    const figmaOnlyVariants = figma.filter((c) => !webKeys.has(propsKey(propsOfVariant(c)))).map((c) => c.name);
    const real = Object.keys(figmaOnlyProps).length > 0 || figmaOnlyVariants.length > 0 || handMadeLayers.length > 0;
    const decision = plan.sheet.drift;
    let risk;
    const atRisk = () => risk ??= overridesAtRisk(set, pageOf(set));
    const blocked = async (reason) => ({
      kind: "blocked",
      report: {
        sheet: plan.sheet.key,
        set: { id: set.id, name: set.name, page: pageOf(set)?.name ?? "" },
        reason,
        ...decision !== void 0 && { decision: decision.decision },
        figmaOnlyProps,
        figmaOnlyVariants,
        webOnlyVariants: plan.variants.filter((v) => !figmaKeys.has(propsKey(v.props))).map((v) => variantName(v.props)),
        handMadeProperties: handMadeNames(plan, set),
        ...await usageOf(set, pageOf(set), found),
        handMadeLayers,
        overridesAtRisk: await atRisk(),
        fingerprint
      }
    });
    if (decision === void 0) {
      if (real) return blocked("drift");
      return (await atRisk()).total > 0 ? blocked("overrides-at-risk") : { kind: "paint" };
    }
    if (!sameFingerprint(decision.fingerprint, fingerprint))
      return blocked("fingerprint-changed");
    if (decision.decision === "figma") return { kind: "figma-wins" };
    if (decision.decision !== "map") return { kind: "paint" };
    const wanted = Object.keys(figmaOnlyProps).sort();
    const given = Object.keys(decision.values).sort();
    if (JSON.stringify(wanted) !== JSON.stringify(given))
      return blocked("map-incomplete");
    return { kind: "paint", mapValues: decision.values };
  }
  var MAX_AT_RISK_SHOWN = 8;
  var plural2 = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  function driftSummary(r) {
    const parts = [];
    const props2 = Object.entries(r.figmaOnlyProps).map(
      ([k, v]) => `${k} (${v.join(", ")})`
    );
    if (props2.length > 0)
      parts.push(`props de variante solo en Figma: ${props2.join("; ")}`);
    if (r.figmaOnlyVariants.length > 0)
      parts.push(
        plural2(
          r.figmaOnlyVariants.length,
          "variante de Figma sin pareja",
          "variantes de Figma sin pareja"
        )
      );
    if (r.webOnlyVariants.length > 0)
      parts.push(
        plural2(
          r.webOnlyVariants.length,
          "variante de la web que Figma no tiene",
          "variantes de la web que Figma no tiene"
        )
      );
    if (r.handMadeProperties.length > 0)
      parts.push(`propiedades a mano: ${r.handMadeProperties.join(", ")}`);
    if (r.handMadeLayers.length > 0)
      parts.push(
        `capas a mano: ${r.handMadeLayers.map((l) => `${l.name} (${l.type})`).join(", ")}; ${plural2(r.handMadeUsage.total, "instancia con contenido en ellas", "instancias con contenido en ellas")}, que el repintado perdería`
      );
    if (r.overridesAtRisk.total > 0)
      parts.push(
        `${plural2(r.overridesAtRisk.total, "instancia", "instancias")} con cambios en capas de dentro, que el repintado reaplica por ruta; los que ya no tengan capa se perderían: ${r.overridesAtRisk.affected.slice(0, MAX_AT_RISK_SHOWN).map(
          (i) => `${i.page} / ${i.frame} (${plural2(i.layers, "capa", "capas")})`
        ).join(
          "; "
        )}${r.overridesAtRisk.affected.length > MAX_AT_RISK_SHOWN ? "; …" : ""}`
      );
    parts.push(
      `${plural2(r.usage.total, "instancia", "instancias")} en ${plural2(r.usage.pages.length, "página", "páginas")}`
    );
    const why = r.reason === "fingerprint-changed" ? `Figma cambió desde que se decidió (decisión «${r.decision ?? ""}»)` : r.reason === "map-incomplete" ? "los valores de `map` no cubren las props solo en Figma" : r.reason === "overrides-at-risk" ? "rehacerla podría perder cambios de instancias en otras pantallas (se reaplican por ruta; los de capas que ya no existen se pierden)" : "Figma va por delante de la web";
    return `La hoja «${r.sheet}» NO se ha escrito: ${why}. ${parts.join(". ")}. Decide en el \`drift\` de la hoja en sheets.json con la huella del informe.`;
  }
  async function assessPlan(plan) {
    const found = await findSheetPage(plan);
    const existing = isScratch(plan) ? { set: null, adopted: false } : await locateSet(plan, found.page);
    return { existing, verdict: await assessSheet(plan, existing.set) };
  }

  // kits/figma/sheet/header.ts
  var DEFAULT_STYLE = {
    "400": "Regular",
    "500": "Medium",
    "600": "SemiBold"
  };
  var styleOf = (plan, weight) => plan.map.fonts.styles[weight] ?? DEFAULT_STYLE[weight] ?? "Regular";
  function resolveStyle(ctx, plan) {
    const { style } = plan;
    const names = [
      style.header.fill,
      style.header.text,
      style.card.fill,
      style.texts.description,
      style.texts.bug,
      style.texts.tag,
      style.texts.rowLabel,
      style.texts.colLabel,
      style.matrix.stroke
    ];
    const missing = [...new Set(names)].filter(
      (name) => ctx.paint.byName(name) === void 0
    );
    if (missing.length > 0) {
      fail(
        "VARIABLE_NOT_FOUND",
        `Faltan las variables de la hoja: ${missing.map((m) => `«${m}»`).join(", ")}.`,
        "Mira las variables con figma_variables y corrige `style` en sheets.json."
      );
    }
    const variable = (name) => ctx.paint.byName(name);
    return {
      headerFill: variable(style.header.fill),
      headerText: variable(style.header.text),
      cardFill: variable(style.card.fill),
      description: variable(style.texts.description),
      bug: variable(style.texts.bug),
      tag: variable(style.texts.tag),
      rowLabel: variable(style.texts.rowLabel),
      colLabel: variable(style.texts.colLabel),
      stroke: variable(style.matrix.stroke)
    };
  }
  async function loadSheetFonts(plan) {
    const family = plan.map.fonts.default;
    await loadFonts(
      ["400", "500", "600"].map((w) => ({
        family,
        style: styleOf(plan, w)
      }))
    );
  }
  function sheetText(plan, chars, size, weight, variable) {
    const t = figmaApi().createText();
    t.fontName = {
      family: plan.map.fonts.default,
      style: styleOf(plan, weight)
    };
    t.characters = chars;
    t.fontSize = size;
    setPaints(t, "fills", [{ bind: variable, opacity: 1 }], { track: false });
    return t;
  }
  function paintHeader(plan, vars, page) {
    const f = figmaApi();
    const { sheet, style } = plan;
    const head = f.createFrame();
    head.name = "Header";
    head.resize(1480, 218);
    head.cornerRadius = 24;
    setPaints(head, "fills", [{ bind: vars.headerFill, opacity: 1 }], {
      track: false
    });
    head.layoutMode = "HORIZONTAL";
    head.primaryAxisSizingMode = "FIXED";
    head.counterAxisSizingMode = "FIXED";
    head.counterAxisAlignItems = "CENTER";
    head.paddingLeft = 80;
    head.appendChild(sheetText(plan, sheet.title, 80, "600", vars.headerText));
    page.appendChild(head);
    const card = f.createFrame();
    card.name = sheet.title;
    card.layoutMode = "VERTICAL";
    card.itemSpacing = 32;
    card.y = 266;
    card.cornerRadius = 24;
    setPaints(card, "fills", [{ bind: vars.cardFill, opacity: 1 }], {
      track: false
    });
    card.paddingTop = 80;
    card.paddingBottom = 80;
    card.paddingLeft = 80;
    card.paddingRight = 80;
    card.counterAxisSizingMode = "FIXED";
    card.resize(1480, 100);
    card.primaryAxisSizingMode = "AUTO";
    page.appendChild(card);
    const lines = [
      [sheet.description, 16, "400", vars.description]
    ];
    if (sheet.bug !== void 0)
      lines.push([`${style.bug?.prefix ?? ""}${sheet.bug}`, 14, "600", vars.bug]);
    if (sheet.tag !== void 0) lines.push([sheet.tag, 14, "500", vars.tag]);
    for (const [chars, size, weight, variable] of lines) {
      const t = sheetText(plan, chars, size, weight, variable);
      card.appendChild(t);
      t.layoutAlign = "STRETCH";
      t.textAutoResize = "HEIGHT";
    }
    note.created([head, card]);
    return { head, card };
  }

  // kits/figma/sheet/matrix.ts
  var GAP = 32;
  var PAD = 40;
  var LABEL_GAP = 16;
  var EMPTY_COLUMN = "—";
  var DASH = [6, 4];
  function createMatrixFrame(plan, card) {
    const matrix = figmaApi().createFrame();
    matrix.name = `${plan.sheet.title} — matriz`;
    matrix.fills = [];
    matrix.clipsContent = false;
    card.appendChild(matrix);
    return matrix;
  }
  function layOutMatrix(plan, vars, input) {
    const { matrix, variants, card, head } = input;
    const set = input.set;
    const top = plan.sheet.matrix?.align === "top";
    const byIndex = new Map(variants.map((v) => [v.index, v.component]));
    const grid = plan.matrix.cells.map(
      (row) => row.flatMap((i) => {
        const c = byIndex.get(i);
        return c === void 0 ? [] : [c];
      })
    );
    const ncol = Math.max(0, ...grid.map((r) => r.length));
    const label2 = (s, size, weight, v) => {
      const t = sheetText(plan, s, size, weight, v);
      matrix.appendChild(t);
      return t;
    };
    const colL = plan.matrix.columns.map(
      (s) => label2(s === "" ? EMPTY_COLUMN : s, 11, "500", vars.colLabel)
    );
    const rowL = plan.matrix.rows.map(
      (s) => label2(s, 12, "600", vars.rowLabel)
    );
    const colW = Array.from(
      { length: ncol },
      (_, j) => Math.max(...grid.map((r) => r[j]?.width ?? 0), colL[j]?.width ?? 0)
    );
    const rowH = grid.map((r) => Math.max(0, ...r.map((c) => c.height)));
    let y = PAD;
    for (const [i, row] of grid.entries()) {
      let x = PAD;
      for (const [j, c] of row.entries()) {
        c.x = x + ((colW[j] ?? 0) - c.width) / 2;
        c.y = y + (top ? 0 : ((rowH[i] ?? 0) - c.height) / 2);
        x += (colW[j] ?? 0) + GAP;
      }
      y += (rowH[i] ?? 0) + GAP;
    }
    set.resizeWithoutConstraints(
      PAD * 2 + colW.reduce((a, b) => a + b, 0) + GAP * (ncol - 1),
      y - GAP + PAD
    );
    set.cornerRadius = 16;
    setPaints(set, "strokes", [{ bind: vars.stroke, opacity: 1 }], {
      track: false
    });
    set.dashPattern = DASH;
    const offX = Math.max(0, ...rowL.map((t) => t.width)) + LABEL_GAP;
    const offY = colL.length > 0 ? Math.max(...colL.map((t) => t.height)) + LABEL_GAP : 0;
    set.x = offX;
    set.y = offY;
    let cx = offX + PAD;
    for (const [j, t] of colL.entries()) {
      t.x = cx + ((colW[j] ?? 0) - t.width) / 2;
      t.y = 0;
      cx += (colW[j] ?? 0) + GAP;
    }
    let ry = offY + PAD;
    for (const [i, t] of rowL.entries()) {
      t.x = 0;
      t.y = ry + (top ? 0 : ((rowH[i] ?? 0) - t.height) / 2);
      ry += (rowH[i] ?? 0) + GAP;
    }
    matrix.resizeWithoutConstraints(offX + set.width, offY + set.height);
    const need = matrix.width + card.paddingLeft + card.paddingRight;
    if (need > card.width) {
      card.resize(need, card.height);
      head.resize(need, head.height);
    }
  }

  // kits/figma/slots.ts
  var slotRef = (slot) => slot.componentPropertyReferences?.slotContentId;
  var slotsIn = (node) => node.findAllWithCriteria({ types: ["SLOT"] });
  function fillSlot(instance, content, options2 = {}) {
    const slots = slotsIn(instance);
    const slot = options2.slot === void 0 ? slots[0] : slots.find((s) => s.name === options2.slot);
    if (slot === void 0) {
      return fail(
        "SLOT_NOT_FOUND",
        `La instancia «${instance.name}» no tiene ${options2.slot === void 0 ? "ningún slot" : `el slot «${options2.slot}»`}.`,
        "Mira las propiedades SLOT del componente con figma_components."
      );
    }
    const copy = content.clone();
    slot.appendChild(copy);
    note.created(copy);
    note.mutated(instance);
    return copy;
  }
  function shareSlot(variants, key, options2 = {}) {
    const first = variants[0];
    const set = first?.parent;
    if (first === void 0 || set?.type !== "COMPONENT_SET") {
      return fail(
        "SLOT_SHARE_SET",
        "Las variantes de un slot común tienen que ser de un mismo set de componentes.",
        "Pasa las variantes (COMPONENT) de un set."
      );
    }
    const slots = variants.map((variant) => {
      const own = slotsIn(variant);
      const existing = options2.layer === void 0 ? own[0] : own.find((slot) => slot.name === options2.layer);
      if (existing !== void 0) return existing;
      return note.created(variant.createSlot());
    });
    const definitions = set.componentPropertyDefinitions;
    let common = Object.keys(definitions).find(
      (name) => definitions[name]?.type === "SLOT" && name.split("#")[0] === key
    );
    if (common === void 0) {
      const own = slotRef(slots[0]);
      if (own === void 0) {
        return fail(
          "SLOT_NO_PROPERTY",
          "El slot recién creado no tiene propiedad.",
          "Comprueba el slot en el componente."
        );
      }
      common = set.editComponentProperty(own, {
        name: key
      });
    }
    for (const slot of slots) {
      const old = slotRef(slot);
      if (old === common) continue;
      slot.componentPropertyReferences = {
        slotContentId: common
      };
      const stillUsed = slots.some((s) => slotRef(s) === old);
      if (old !== void 0 && !stillUsed) {
        set.deleteComponentProperty(old);
      }
      note.mutated(slot);
    }
    return common;
  }

  // kits/figma/sheet/slots.ts
  var SLOT_PROPS = [...LAYOUT_PROPS, "layoutGrow", "layoutAlign"];
  function addSlots(plan, variants) {
    for (const s of plan.sheet.slots ?? []) {
      const made = [];
      for (const v of variants) {
        const c = v.component;
        const layer = c.findAll((n) => n.name === s.layer && n.type !== "SLOT").find((n) => ownLayer(n, c));
        const parent = layer?.parent;
        if (layer === void 0 || parent === null || parent === void 0)
          continue;
        const slot = c.createSlot();
        parent.insertChild(parent.children.indexOf(layer), slot);
        slot.resize(layer.width, layer.height);
        copyProps(layer, slot, SLOT_PROPS, s.layer, slot.id);
        if (layer.type !== "INSTANCE" && "children" in layer) {
          for (const kid of [...layer.children]) slot.appendChild(kid);
        }
        note.removed(layer);
        layer.remove();
        slot.name = s.layer;
        note.created(slot);
        made.push(c);
      }
      if (made.length === 0) {
        note.warn(
          "SLOT_LAYER_NOT_FOUND",
          `Ninguna variante tiene la capa «${s.layer}» del hueco «${s.name}»: el hueco no se crea.`
        );
        continue;
      }
      shareSlot(made, s.name, { layer: s.layer });
    }
  }

  // kits/figma/sheet/index.ts
  function withMapped(painted, values) {
    if (values === void 0) return painted;
    return painted.map((p) => {
      const props2 = { ...p.props, ...values };
      p.component.name = variantName(props2);
      return { props: props2, component: p.component };
    });
  }
  var NONE = { count: 0, overrides: 0 };
  async function withoutLeftovers(pages, paint) {
    const seen = new Set(pages.flatMap((p) => p.children.map((c) => c.id)));
    try {
      return await paint();
    } catch (e) {
      for (const p of new Set(pages))
        for (const c of [...p.children])
          if (!seen.has(c.id) && !c.removed) c.remove();
      throw e;
    }
  }
  async function paintSheet(plan, assets, recognize, options2 = {}) {
    const ctx = await createSheetCtx(plan, assets, recognize);
    await loadSheetFonts(plan);
    const vars = resolveStyle(ctx, plan);
    const found = await findSheetPage(plan);
    const existing = options2.existing ?? (isScratch(plan) ? { set: null, adopted: false } : await locateSet(plan, found.page));
    if (existing.set !== null) checkRebuild(plan, existing.set);
    const old = existing.set;
    const page = await sheetPage(plan, found, old !== null);
    const before = old === null ? NONE : await outsideInstances(old, page);
    const beforeKeys = new Set(old === null ? [] : handMadeKeys(old));
    const leftovers = old === null ? [] : oldFrames(old, page, plan);
    const { head, card, raw } = await withoutLeftovers(
      [page, figmaApi().currentPage],
      async () => ({
        ...paintHeader(plan, vars, page),
        raw: await paintVariants(ctx, plan, page)
      })
    );
    await refuseForeignVariants(plan, raw, [head, card]);
    const painted = withMapped(raw, options2.mapValues);
    const matrixFrame = createMatrixFrame(plan, card);
    let set;
    let variants;
    let variantCounts;
    if (old === null) {
      ({ set, variants } = buildSet(plan, painted, matrixFrame));
      variantCounts = { created: variants.length, updated: 0, kept: 0 };
    } else {
      set = old;
      ({ variants, counts: variantCounts } = await rebuildSet(
        plan,
        old,
        existing.adopted,
        painted,
        matrixFrame,
        page
      ));
      removeOld(leftovers);
    }
    addSlots(plan, variants);
    layOutMatrix(plan, vars, { matrix: matrixFrame, set, variants, card, head });
    const { updated } = addProperties(ctx, plan, set, variants);
    const keptCount = keptProperties(plan, set);
    ctx.recognizer?.flush();
    note.created(matrixFrame);
    figmaApi().viewport.scrollAndZoomIntoView([head, card]);
    const created = handMadeKeys(set).filter((k) => !beforeKeys.has(k)).map(baseName2);
    const after = old === null ? NONE : await outsideInstances(set, page);
    return {
      page,
      head,
      card,
      matrixFrame,
      set,
      variants,
      properties: created,
      rebuilt: old !== null,
      counts: {
        variants: variantCounts,
        properties: {
          created: created.length,
          updated: updated.length,
          kept: keptCount
        },
        outside: { before: before.count, after: after.count },
        overrides: { before: before.overrides, after: after.overrides }
      },
      ctx
    };
  }

  // kits/figma/steps/build-component.ts
  var MAX_UNTOKENIZED_WARNINGS = 20;
  var MAX_MOVED_SHOWN = 12;
  var MAX_WRAPPED_SHOWN = 6;
  function readPlan(assets, sheet) {
    const bytes = assets["plan"];
    if (bytes === void 0) {
      return fail(
        "PLAN_MISSING",
        "El paso no recibió el asset `plan`.",
        "Lanza el paso con figma_build (el servidor arma el plan); no lo llames a mano sin `plan`."
      );
    }
    const plan = readJson(bytes);
    if (plan.contract !== "component@1" || plan.sheet.key !== sheet) {
      return fail(
        "PLAN_INVALID",
        `El plan no es un component@1 de «${sheet}» (trae ${String(plan.contract)} de «${String(plan.sheet?.key)}»).`,
        "Repite el paso con figma_build: el servidor vuelve a armar el plan desde la última captura."
      );
    }
    if (plan.variants.length === 0) {
      return fail(
        "PLAN_EMPTY",
        `La captura de «${sheet}» no tiene variantes que pintar.`,
        "Captura la pantalla otra vez con figma_capture."
      );
    }
    const empty = plan.variants.filter((v) => v.root.length === 0);
    if (empty.length > 0) {
      return fail(
        "PLAN_VARIANT_EMPTY",
        `La captura de «${sheet}» tiene ${empty.length} variante(s) sin nada que pintar (${empty.map((v) => variantName(v.props)).join("; ")}).`,
        "Abre la URL de la pantalla en el navegador (¿responde la página? ¿encuentra el `pick`?) y captúrala otra vez con figma_capture."
      );
    }
    return plan;
  }
  async function buildComponent(params, assets, recognize) {
    const tracker = startTracking();
    const plan = readPlan(assets, params.sheet);
    for (const w of plan.warnings) {
      note.warn(
        w.code,
        w.nodeId === void 0 ? w.message : `${w.message} (nodo ${w.nodeId} de la captura)`
      );
    }
    const { existing, verdict } = await assessPlan(plan);
    if (verdict.kind === "blocked") {
      note.warn(
        "SHEET_DRIFT",
        driftSummary(verdict.report),
        verdict.report.set.id
      );
      return tracker.done({
        sheet: params.sheet,
        skipped: "drift",
        drift: verdict.report
      });
    }
    if (verdict.kind === "figma-wins") {
      note.warn(
        "DRIFT_FIGMA_WINS",
        `La hoja «${params.sheet}» no se escribe: la decisión de sheets.json es que manda Figma.`
      );
      return tracker.done({ sheet: params.sheet, skipped: "figma" });
    }
    const painted = await paintSheet(plan, assets, recognize ?? null, {
      existing,
      ...verdict.mapValues !== void 0 && { mapValues: verdict.mapValues }
    });
    const { counters } = painted.ctx;
    for (const [color, times] of [...counters.untokenized].slice(
      0,
      MAX_UNTOKENIZED_WARNINGS
    )) {
      note.warn(
        "TOKEN_UNTOKENIZED",
        `El color #${color} (${times} ${times === 1 ? "vez" : "veces"}) no tiene variable: se pinta suelto.`
      );
    }
    return tracker.done({
      sheet: params.sheet,
      page: painted.page.name,
      setId: painted.set.id,
      variants: painted.counts.variants,
      properties: painted.counts.properties,
      instances: painted.counts.outside,
      overrides: painted.counts.overrides,
      matches: counters.matches,
      moved: [...new Set(counters.moved)].slice(0, MAX_MOVED_SHOWN),
      wrapped: [...new Set(counters.wrapped)].slice(0, MAX_WRAPPED_SHOWN),
      untokenized: [...counters.untokenized.values()].reduce((a, b) => a + b, 0)
    });
  }

  // kits/figma/steps/build-screen.ts
  var MAX_UNTOKENIZED_WARNINGS2 = 20;
  var MAX_MOVED_SHOWN2 = 12;
  var MAX_WRAPPED_SHOWN2 = 6;
  function readPlan2(assets, screen) {
    const bytes = assets["plan"];
    if (bytes === void 0) {
      return fail(
        "PLAN_MISSING",
        "El paso no recibió el asset `plan`.",
        "Lanza el paso con figma_build (el servidor arma el plan); no lo llames a mano sin `plan`."
      );
    }
    const plan = readJson(bytes);
    if (plan.contract !== "screen@1" || plan.screen !== screen) {
      return fail(
        "PLAN_INVALID",
        `El plan no es un screen@1 de «${screen}» (trae ${String(plan.contract)} de «${String(plan.screen)}»).`,
        "Repite el paso con figma_build: el servidor vuelve a armar el plan desde la última captura."
      );
    }
    if (plan.root.length === 0) {
      return fail(
        "PLAN_EMPTY",
        `La variante ${plan.variant} de «${screen}» no tiene nodos que pintar.`,
        "Captura la pantalla otra vez con figma_capture o elige otra variante."
      );
    }
    return plan;
  }
  async function pageFor(plan) {
    const f = figmaApi();
    const before = f.root.children.length;
    const page = await ensurePage({
      key: plan.target.page.key,
      name: plan.target.page.name
    });
    const after = plan.target.page.after;
    if (f.root.children.length > before && after !== void 0) {
      const index = f.root.children.findIndex(
        (p) => p.name.trim() === after.trim()
      );
      if (index >= 0) f.root.insertChild(index + 1, page);
      else {
        note.warn(
          "PAGE_AFTER_NOT_FOUND",
          `No hay página «${after}»: «${page.name}» queda al final.`,
          page.id
        );
      }
    }
    await f.setCurrentPageAsync(page);
    const old = page.children.filter(
      (c) => c.type !== "COMPONENT_SET" && c.type !== "COMPONENT"
    );
    note.removed(old);
    for (const child of old) child.remove();
    return page;
  }
  async function buildScreen(params, assets, recognize) {
    const tracker = startTracking();
    const plan = readPlan2(assets, params.screen);
    for (const w of plan.warnings) {
      note.warn(
        w.code,
        w.nodeId === void 0 ? w.message : `${w.message} (nodo ${w.nodeId} de la captura)`
      );
    }
    const ctx = await createCtx(plan, assets, recognize ?? null);
    const page = await pageFor(plan);
    const root = await paintRoots(ctx);
    ctx.recognizer?.flush();
    page.appendChild(root);
    root.name = plan.target.frame.name;
    note.created(root);
    tagNode(root, plan.target.frame.key);
    const total = (list) => list.length;
    for (const [color, times] of [...ctx.counters.untokenized].slice(
      0,
      MAX_UNTOKENIZED_WARNINGS2
    )) {
      note.warn(
        "TOKEN_UNTOKENIZED",
        `El color #${color} (${times} ${times === 1 ? "vez" : "veces"}) no tiene variable: se pinta suelto.`
      );
    }
    const { counters } = ctx;
    return tracker.done({
      screen: params.screen,
      page: page.name,
      frameId: root.id,
      nodes: counters.nodes,
      images: counters.images,
      icons: counters.icons,
      instances: counters.components,
      matches: counters.matches,
      moved: [...new Set(counters.moved)].slice(0, MAX_MOVED_SHOWN2),
      movedCount: total(counters.moved),
      wrapped: [...new Set(counters.wrapped)].slice(0, MAX_WRAPPED_SHOWN2),
      wrappedCount: total(counters.wrapped),
      untokenized: [...counters.untokenized.values()].reduce((a, b) => a + b, 0)
    });
  }

  // kits/figma/compose/paint.ts
  var PADDING_FIELDS = [
    "paddingTop",
    "paddingRight",
    "paddingBottom",
    "paddingLeft"
  ];
  var RADIUS_FIELDS = [
    "topLeftRadius",
    "topRightRadius",
    "bottomRightRadius",
    "bottomLeftRadius"
  ];
  var FLOAT_FIELDS = [
    "itemSpacing",
    ...PADDING_FIELDS,
    ...RADIUS_FIELDS
  ];
  function paddingSides(padding) {
    const p = typeof padding === "string" ? [padding] : padding;
    const [a = "", b = a, c = a, d = b] = p;
    return p.length === 1 ? [a, a, a, a] : p.length === 2 ? [a, b, a, b] : p.length === 3 ? [a, b, c, b] : [a, b, c, d];
  }
  var variableOf = (ctx, name) => ctx.tokens.variable(name);
  function applyStack(frame, block, ctx) {
    frame.layoutMode = block.stack;
    for (const field of FLOAT_FIELDS) frame.setBoundVariable(field, null);
    if (block.gap !== void 0) {
      frame.setBoundVariable("itemSpacing", variableOf(ctx, block.gap));
    } else {
      frame.itemSpacing = 0;
    }
    if (block.padding !== void 0) {
      const sides = paddingSides(block.padding);
      PADDING_FIELDS.forEach((field, i) => {
        frame.setBoundVariable(field, variableOf(ctx, sides[i]));
      });
    } else {
      for (const field of PADDING_FIELDS) frame[field] = 0;
    }
    if (block.radius !== void 0) {
      const radius = variableOf(ctx, block.radius);
      for (const field of RADIUS_FIELDS) frame.setBoundVariable(field, radius);
    } else {
      frame.cornerRadius = 0;
    }
    frame.fills = [];
    if (block.fill !== void 0) {
      setPaints(frame, "fills", [{ bind: variableOf(ctx, block.fill) }]);
    }
  }
  function paintStack(block, parent, ctx) {
    const frame = note.created(figmaApi().createFrame());
    frame.name = block.name ?? "Stack";
    applyStack(frame, block, ctx);
    frame.primaryAxisSizingMode = "AUTO";
    frame.counterAxisSizingMode = "AUTO";
    parent.appendChild(frame);
    if (block.sizing !== void 0) {
      frame.layoutSizingHorizontal = block.sizing.h;
      frame.layoutSizingVertical = block.sizing.v;
    }
    ctx.frames += 1;
    return frame;
  }
  async function paintText2(block, parent, ctx) {
    const style = ctx.textStyles.get(block.style);
    const text = note.created(figmaApi().createText());
    if (style !== void 0) {
      await loadFonts([style.fontName]);
      await text.setTextStyleIdAsync(style.id);
    }
    text.characters = block.text;
    if (block.name !== void 0) text.name = block.name;
    parent.appendChild(text);
    if (block.color !== void 0) {
      setPaints(text, "fills", [{ bind: variableOf(ctx, block.color) }]);
    } else {
      note.warn(
        "TEXT_WITHOUT_COLOR",
        `El texto «${block.text}» no lleva \`color\`: se queda con el relleno por defecto de Figma, que no es de ninguna variable.`,
        text.id
      );
    }
    if (parent.layoutMode === "VERTICAL") {
      text.textAutoResize = "HEIGHT";
      text.layoutSizingHorizontal = "FILL";
    }
    ctx.texts += 1;
    return text;
  }
  async function paintUse(block, parent, ctx) {
    const sheet = block.use;
    const set = ctx.sets.get(sheet);
    if (set === void 0) throw new Error(`Sin set para la hoja «${sheet}»`);
    const texts = {};
    const visible = {};
    for (const [key, def] of Object.entries(set.componentPropertyDefinitions)) {
      if (def.type === "BOOLEAN") {
        visible[key.split("#")[0] ?? key] = def.defaultValue;
      }
    }
    for (const [name, value] of Object.entries(block.props ?? {})) {
      if (typeof value === "string") texts[name] = value;
      else visible[name] = value;
    }
    const instance = await createInstance(set, {
      variant: block.variant ?? {},
      texts,
      visible
    });
    if (block.name !== void 0) instance.name = block.name;
    parent.appendChild(instance);
    ctx.used[sheet] = (ctx.used[sheet] ?? 0) + 1;
    for (const [slot, children] of Object.entries(block.slots ?? {})) {
      for (const child of children) {
        const content = await paintBlock(child, ctx.root, ctx);
        fillSlot(instance, content, { slot });
        note.removed([content, ...descendantsOfType(content, LINKABLE_TYPES)]);
        content.remove();
        ctx.slots += 1;
      }
    }
    return instance;
  }
  async function paintBlock(block, parent, ctx) {
    if ("stack" in block) {
      const frame = paintStack(block, parent, ctx);
      for (const child of block.children) await paintBlock(child, frame, ctx);
      return frame;
    }
    if ("text" in block) return paintText2(block, parent, ctx);
    if ("use" in block) return paintUse(block, parent, ctx);
    throw new Error("Un bloque `image` o `icon` no lo pinta kit/compose@1");
  }

  // kits/figma/compose/resolve.ts
  function collect(block, needs) {
    if ("stack" in block) {
      for (const token of [block.gap, block.fill, block.radius]) {
        if (token !== void 0) needs.variables.add(token);
      }
      const padding = typeof block.padding === "string" ? [block.padding] : block.padding;
      for (const token of padding ?? []) needs.variables.add(token);
      for (const child of block.children) collect(child, needs);
    } else if ("text" in block) {
      needs.styles.add(block.style);
      if (block.color !== void 0) needs.variables.add(block.color);
    } else if ("use" in block) {
      if (typeof block.use === "string") needs.sheets.add(block.use);
      for (const children of Object.values(block.slots ?? {})) {
        for (const child of children) collect(child, needs);
      }
    }
  }
  var norm2 = (text) => text.toLowerCase().replace(/\s+/g, "");
  async function findSet(sheet) {
    const byKey2 = await nodeByKey(`${SHEET_KEY_PREFIX}${sheet.key}`);
    if (byKey2 !== null && (byKey2.type === "COMPONENT_SET" || byKey2.type === "COMPONENT")) {
      return { set: byKey2 };
    }
    const wanted = norm2(sheet.title);
    const found = [];
    for (const page of figmaApi().root.children) {
      await page.loadAsync();
      for (const node of page.findAllWithCriteria({
        types: ["COMPONENT_SET", "COMPONENT"]
      })) {
        if (node.parent?.type === "COMPONENT_SET") continue;
        if (norm2(node.name) === wanted) found.push(node);
      }
    }
    if (found.length === 1 && found[0] !== void 0) return { set: found[0] };
    return {
      problem: found.length === 0 ? `el set de la hoja «${sheet.key}» (por la clave ${SHEET_KEY_PREFIX}${sheet.key} ni por el título «${sheet.title}»)` : `un solo set de la hoja «${sheet.key}» (hay ${found.length} llamados «${sheet.title}»)`
    };
  }
  async function resolveNeeds(params) {
    const needs = {
      variables: /* @__PURE__ */ new Set(),
      styles: /* @__PURE__ */ new Set(),
      sheets: /* @__PURE__ */ new Set()
    };
    collect(params.compose.root, needs);
    const missing = [];
    const tokens = await loadTokens();
    const absent = [...needs.variables].filter(
      (n) => tokens.variable(n) === void 0
    );
    if (absent.length > 0) {
      missing.push(`las variables ${absent.map((n) => `«${n}»`).join(", ")}`);
    }
    const styles = /* @__PURE__ */ new Map();
    for (const style of await figmaApi().getLocalTextStylesAsync()) {
      if (!styles.has(style.name)) styles.set(style.name, style);
    }
    const noStyle = [...needs.styles].filter((n) => !styles.has(n));
    if (noStyle.length > 0) {
      missing.push(
        `los estilos de texto ${noStyle.map((n) => `«${n}»`).join(", ")}`
      );
    }
    const sets = /* @__PURE__ */ new Map();
    for (const key of needs.sheets) {
      const sheet = params.sheets.find((s) => s.key === key) ?? {
        key,
        title: key
      };
      const found = await findSet(sheet);
      if (found.set !== void 0) sets.set(key, found.set);
      else if (found.problem !== void 0) missing.push(found.problem);
    }
    if (missing.length > 0) {
      fail(
        "COMPOSE_NOT_FOUND",
        `En Figma falta: ${missing.join("; ")}.`,
        "Crea lo que falta (o corrige el compose) y repite el paso: no se ha tocado nada. Los sets se crean con kit/build-component@1."
      );
    }
    return { tokens, textStyles: styles, sets };
  }

  // kits/figma/steps/compose.ts
  var INITIAL_HEIGHT = 100;
  var FRAME_GAP = 80;
  async function pageFor2(name, key) {
    const found = await findPage(name);
    if (found !== null) return { page: found, created: false };
    const page = figmaApi().createPage();
    page.name = name;
    tagNode(page, key);
    note.created(page);
    return { page, created: true };
  }
  var nextFree = (page) => page.children.reduce(
    (edge, c) => Math.max(edge, c.x + c.width + FRAME_GAP),
    0
  );
  async function frameFor(page, key, width) {
    const existing = await nodeByKey(key, { page });
    if (existing !== null) {
      if (existing.type === "FRAME") return { frame: existing, existing: true };
      return fail(
        "KEY_NOT_FRAME",
        `La clave «${key}» ya la tiene un nodo de tipo ${existing.type}, no un marco.`,
        "Quita la clave del otro nodo o usa otra clave de compose."
      );
    }
    const frame = figmaApi().createFrame();
    frame.layoutMode = "VERTICAL";
    frame.resize(width, INITIAL_HEIGHT);
    frame.x = nextFree(page);
    frame.y = 0;
    page.appendChild(frame);
    tagNode(frame, key);
    note.created(frame);
    return { frame, existing: false };
  }
  var asStack = (root) => "stack" in root ? root : { stack: "VERTICAL", children: [root] };
  async function compose(params) {
    const tracker = startTracking();
    const { compose: data } = params;
    const resolved = await resolveNeeds(params);
    const { page, created: pageCreated } = await pageFor2(
      data.target.page,
      composePageKey(data.key)
    );
    const { frame, existing } = await frameFor(
      page,
      composeKey(data.key),
      data.target.width
    );
    try {
      const removed = [...frame.children];
      note.removed(removed);
      for (const child of removed) child.remove();
      const root = asStack(data.root);
      if ("stack" in data.root && data.root.sizing !== void 0) {
        note.warn(
          "ROOT_SIZING_IGNORED",
          "El `sizing` del stack raíz no vale: el ancho lo manda `target.width` y el alto, `target.height` (o el contenido).",
          frame.id
        );
      }
      frame.name = data.target.frame ?? data.title;
      const ctx = {
        ...resolved,
        root: frame,
        used: {},
        texts: 0,
        frames: 0,
        slots: 0
      };
      applyStack(frame, root, ctx);
      const heightMode = data.target.height === void 0 ? "AUTO" : "FIXED";
      const vertical = root.stack === "VERTICAL";
      frame.resize(data.target.width, data.target.height ?? frame.height);
      frame.primaryAxisSizingMode = vertical ? heightMode : "FIXED";
      frame.counterAxisSizingMode = vertical ? "FIXED" : heightMode;
      for (const child of root.children) await paintBlock(child, frame, ctx);
      note.mutated(frame);
      return tracker.done({
        compose: data.key,
        page: page.name,
        pageId: page.id,
        frameId: frame.id,
        rebuilt: existing,
        frames: ctx.frames,
        texts: ctx.texts,
        instances: ctx.used,
        slots: ctx.slots
      });
    } catch (e) {
      if (!existing) {
        note.removed(frame);
        frame.remove();
        if (pageCreated) {
          note.removed(page);
          page.remove();
        }
      }
      throw e;
    }
  }

  // kits/figma/images.ts
  var MAX_IMAGE_SIDE = 4096;
  function imageInfo(bytes) {
    const u16 = (i) => (bytes[i] ?? 0) << 8 | (bytes[i + 1] ?? 0);
    const u32 = (i) => u16(i) * 65536 + u16(i + 2) >>> 0;
    if (bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78) {
      return { type: "png", width: u32(16), height: u32(20) };
    }
    if (bytes[0] === 71 && bytes[1] === 73 && bytes[2] === 70) {
      const le = (i) => (bytes[i] ?? 0) | (bytes[i + 1] ?? 0) << 8;
      return { type: "gif", width: le(6), height: le(8) };
    }
    if (bytes[0] === 255 && bytes[1] === 216) {
      for (let i = 2; i + 9 < bytes.length; ) {
        if (bytes[i] !== 255) return null;
        const marker = bytes[i + 1] ?? 0;
        if (marker >= 192 && marker <= 195) {
          return { type: "jpeg", height: u16(i + 5), width: u16(i + 7) };
        }
        i += 2 + u16(i + 2);
      }
    }
    return null;
  }

  // kits/figma/steps/common.ts
  var areaFrameKey = (area, frame) => `${AREA_KEY_PREFIX}${area}/${frame}`;
  var sharedGroupKey = (name) => `${SHARED_KEY_PREFIX}${name}`;
  var messageOf4 = (e) => e instanceof Error ? e.message : String(e);
  function notFound(missing) {
    return fail(
      "AREA_NOT_FOUND",
      `En Figma falta: ${missing.join("; ")}.`,
      "Crea o renombra lo que falta en Figma (o corrige areas@1) y repite el paso: no se ha tocado nada."
    );
  }
  async function requirePage(area) {
    const page = await findPage(area.page);
    if (page === null) notFound([`la página «${area.page}»`]);
    return page;
  }
  async function findAreaFrame(area, page, name) {
    const key = areaFrameKey(area.name, name);
    const byKey2 = await nodeByKey(key, { page });
    if (byKey2 !== null && byKey2.type === "FRAME") return byKey2;
    const byName = page.children.find(
      (c) => c.type === "FRAME" && c.name === name
    );
    if (byName === void 0 || byName.type !== "FRAME") return null;
    tagNode(byName, key);
    note.warn(
      "ADOPTED",
      `El frame «${name}» no tenía clave: se ha adoptado por su nombre.`,
      byName.id
    );
    return byName;
  }

  // kits/figma/steps/fill-image.ts
  function targetOf(frame, text, minSize) {
    const label2 = descendantsOfType(frame, ["TEXT"]).find(
      (t) => t.characters.trim() === text
    );
    let node = label2 ?? null;
    while (node !== null && node.id !== frame.id) {
      if (node.width >= minSize[0] && node.height >= minSize[1]) return node;
      node = node.parent;
    }
    return null;
  }
  async function fillImage(params, assets) {
    const area = params.area;
    const tracker = startTracking();
    const page = await requirePage(area);
    const fills = area.fills ?? [];
    const frames = /* @__PURE__ */ new Map();
    const missing = [];
    for (const fill of fills) {
      if (frames.has(fill.frame)) continue;
      const frame = await findAreaFrame(area, page, fill.frame);
      if (frame === null)
        missing.push(`el frame «${fill.frame}» de la página «${area.page}»`);
      else frames.set(fill.frame, frame);
    }
    if (missing.length > 0) notFound(missing);
    for (const fill of fills) {
      const bytes = assets[fill.asset];
      if (bytes === void 0) {
        fail(
          "ASSET_MISSING",
          `El paso no recibió los bytes de «${fill.asset}».`,
          "Comprueba que el fichero existe junto a areas.json y repite la llamada."
        );
      }
      const info = imageInfo(bytes);
      if (info === null) {
        fail(
          "IMAGE_UNSUPPORTED",
          `«${fill.asset}» no es un PNG, un JPEG ni un GIF.`,
          "Convierte la imagen a PNG o JPEG y repite el paso."
        );
      }
      if (info.width > MAX_IMAGE_SIDE || info.height > MAX_IMAGE_SIDE) {
        fail(
          "IMAGE_UNSUPPORTED",
          `«${fill.asset}» mide ${info.width} × ${info.height} px y Figma admite hasta ${MAX_IMAGE_SIDE} por lado.`,
          "Reduce la imagen y repite el paso."
        );
      }
    }
    const report = [];
    for (const fill of fills) {
      const frame = frames.get(fill.frame);
      const node = targetOf(frame, fill.find.text, fill.find.minSize);
      if (node === null) {
        note.warn(
          "FILL_TARGET_NOT_FOUND",
          `En «${fill.frame}» no hay un nodo de al menos ${fill.find.minSize[0]} × ${fill.find.minSize[1]} con el texto «${fill.find.text}».`,
          frame.id
        );
        continue;
      }
      const image = figmaApi().createImage(assets[fill.asset]);
      const target = node;
      const fills2 = target["fills"] ?? [];
      report.push({
        frame: fill.frame,
        nodeId: node.id,
        size: [Math.round(node.width), Math.round(node.height)],
        hash: image.hash
      });
      if (fills2.some((f) => f.type === "IMAGE" && f.imageHash === image.hash))
        continue;
      target["fills"] = [
        { type: "IMAGE", imageHash: image.hash, scaleMode: "FILL" }
      ];
      if ("clipsContent" in target) target["clipsContent"] = true;
      if (fill.name !== void 0) node.name = fill.name;
      note.mutated(node);
    }
    return tracker.done({ fills: report });
  }

  // kits/figma/steps/layout-check.ts
  var overlap = (a, b) => [
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x),
    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  ];
  function intersect(a, b) {
    const x = Math.max(a.x, b.x);
    const y = Math.max(a.y, b.y);
    return {
      x,
      y,
      width: Math.min(a.x + a.width, b.x + b.width) - x,
      height: Math.min(a.y + a.height, b.y + b.height) - y
    };
  }
  function collect2(frame) {
    const items = [];
    const walk = (node, clip2) => {
      if (!node.visible || "opacity" in node && node.opacity === 0) return;
      if (node.type === "TEXT") {
        if (node.characters.trim() === "") return;
        const cut = (box) => {
          if (box === null) return null;
          if (clip2 === null) return box;
          const r = intersect(box, clip2);
          return r.width > 0 && r.height > 0 ? r : null;
        };
        const bb = cut(node.absoluteBoundingBox);
        const rb = cut(node.absoluteRenderBounds);
        if (bb !== null && rb !== null) items.push({ text: node, bb, rb });
        return;
      }
      if (!("children" in node)) return;
      let next = clip2;
      if (node !== frame && "clipsContent" in node && node.clipsContent) {
        const box = node.absoluteBoundingBox;
        if (box !== null) {
          next = clip2 === null ? box : intersect(clip2, box);
          if (next.width <= 0 || next.height <= 0) return;
        }
      }
      for (const child of node.children) walk(child, next);
    };
    walk(frame, null);
    return items;
  }
  var label = (item) => item.text.characters.trim().slice(0, 20);
  function overlaps(items) {
    items.sort((a, b) => a.bb.y - b.bb.y);
    const bad = [];
    for (let i = 0; i < items.length; i++) {
      const a = items[i];
      for (let j = i + 1; j < items.length && items[j].bb.y < a.bb.y + a.bb.height; j++) {
        const b = items[j];
        const [bx, by] = overlap(a.bb, b.bb);
        if (bx <= 2 || by <= 4) continue;
        const [rx, ry] = overlap(a.rb, b.rb);
        if (rx <= 0 || ry <= 0) continue;
        bad.push(`${label(a)} ✕ ${label(b)}`);
      }
    }
    return bad;
  }
  function collapsed(frame) {
    return descendantsOfType(frame, ["FRAME", "INSTANCE"]).filter(
      (n) => "children" in n && n.width <= 4 && n.children.some((k) => k.width > 40)
    ).length;
  }
  function misalignedRows(frame, rowNames, bodyNames) {
    let count2 = 0;
    for (const body of descendantsOfType(frame, ["FRAME"])) {
      if (!bodyNames.includes(body.name) || !("children" in body)) continue;
      const rows2 = body.children.filter(
        (r) => rowNames.includes(r.name) && r.visible && "children" in r
      );
      if (rows2.length < 2) continue;
      const xsOf = (row) => "children" in row ? row.children.map((c) => Math.round(c.x)) : [];
      const ref = xsOf(rows2[0]);
      for (const row of rows2.slice(1)) {
        const xs = xsOf(row);
        if (xs.length !== ref.length || xs.some((x, i) => Math.abs(x - ref[i]) > 1))
          count2 += 1;
      }
    }
    return count2;
  }
  async function layoutCheck(params) {
    const area = params.area;
    const tracker = startTracking();
    const page = await requirePage(area);
    const { row, body } = params.linkRules.rows;
    const layout = [];
    for (const frame of page.children) {
      if (frame.type !== "FRAME") continue;
      const bad = overlaps(collect2(frame));
      layout.push({
        area: area.name,
        frame: frame.name,
        frameId: frame.id,
        overlaps: bad.length,
        samples: bad.slice(0, 4),
        collapsed: collapsed(frame),
        misalignedRows: misalignedRows(frame, row, body)
      });
    }
    return tracker.done({ layout });
  }

  // kits/figma/steps/links.ts
  async function links(params) {
    const area = params.area;
    const tracker = startTracking();
    const page = await requirePage(area);
    const wanted = /* @__PURE__ */ new Set();
    for (const link of area.links ?? []) {
      if (link.from === link.to) continue;
      wanted.add(link.from);
      wanted.add(link.to);
    }
    if (area.flowStart !== void 0) wanted.add(area.flowStart.frame);
    const frames = /* @__PURE__ */ new Map();
    const missing = [];
    for (const name of wanted) {
      const frame = await findAreaFrame(area, page, name);
      if (frame === null)
        missing.push(`el frame «${name}» de la página «${area.page}»`);
      else frames.set(name, frame);
    }
    if (missing.length > 0) notFound(missing);
    const clickable = area.clickable ?? params.linkRules.clickable;
    const report = [];
    for (const link of area.links ?? []) {
      if (link.from === link.to) continue;
      const from = frames.get(link.from);
      const to = frames.get(link.to);
      const nodes = "rows" in link ? rows(from, params.linkRules.rows) : await byText(from, link.text, {
        match: link.match,
        clickable,
        skipInside: area.shell?.set
      });
      let unchanged = 0;
      for (const node of nodes) {
        const done = await linkTo(node, to, {
          transition: params.linkRules.transition
        });
        if (!done.changed) unchanged += 1;
      }
      const label2 = "rows" in link ? "filas" : link.text;
      if (nodes.length === 0) {
        note.warn("LINK_ZERO", `${link.from}: ${label2} → ${link.to} ×0`);
      }
      report.push({
        area: area.name,
        from: link.from,
        ..."rows" in link ? { rows: true } : { text: link.text },
        to: link.to,
        count: nodes.length,
        unchanged
      });
    }
    if (area.flowStart !== void 0) {
      startFlow(
        page,
        frames.get(area.flowStart.frame),
        area.flowStart.name
      );
    }
    if (area.frame.clip === true) {
      for (const screen of area.screens) {
        const frame = frames.get(screen.frame) ?? await findAreaFrame(area, page, screen.frame);
        if (frame === null) continue;
        if (frame.clipsContent) continue;
        frame.clipsContent = true;
        note.mutated(frame);
      }
    }
    return tracker.done({ links: report });
  }

  // kits/figma/steps/place.ts
  var props = (node) => node;
  var STROKE_WEIGHTS = [
    "strokeTopWeight",
    "strokeRightWeight",
    "strokeBottomWeight",
    "strokeLeftWeight"
  ];
  var STROKE_TYPES3 = [
    "FRAME",
    "RECTANGLE",
    "VECTOR",
    "ELLIPSE",
    "LINE",
    "POLYGON",
    "STAR"
  ];
  async function preflight(area) {
    const missing = [];
    const page = await findPage(area.page);
    if (page === null) missing.push(`la página «${area.page}»`);
    let shell = null;
    if (area.shell !== void 0) {
      const found = await findComponent(area.shell.set);
      if (found === null)
        missing.push(`el componente «${area.shell.set}» (el shell)`);
      else if (found.type === "COMPONENT_SET") {
        shell = found;
        for (const screen of area.screens) {
          const value = screen.shell ?? area.shell.default;
          const has2 = found.children.some(
            (v) => v.type === "COMPONENT" && propsOfVariant(v)[area.shell?.variantProp ?? ""] === value
          );
          if (!has2)
            missing.push(
              `la variante «${area.shell.variantProp}=${value}» de «${area.shell.set}»`
            );
        }
      }
    }
    let fill;
    if (area.frame.fill !== void 0) {
      fill = (await loadTokens()).variable(area.frame.fill);
      if (fill === void 0)
        missing.push(`la variable de color «${area.frame.fill}»`);
    }
    if (missing.length > 0 || page === null) notFound([...new Set(missing)]);
    return { page, shell, fill };
  }
  function tempPageFor(area, frame) {
    const wanted = `${area.place.source.pagePrefix}${frame}`;
    const pages = figmaApi().root.children;
    return pages.find((p) => p.name === wanted) ?? pages.find((p) => p.name.trim() === wanted.trim()) ?? null;
  }
  function originIn(page, take) {
    if (take === "first-frame")
      return page.children.find((c) => c.type === "FRAME") ?? null;
    if (take === "first-component")
      return descendantsOfType(page, ["COMPONENT"])[0] ?? null;
    const set = descendantsOfType(page, [
      "COMPONENT_SET"
    ])[0];
    return set?.children[0] ?? null;
  }
  function scaledWeight(width, scale) {
    const r = width / scale;
    return width > 0 && Math.abs(r - Math.round(r)) < 0.02 && Math.abs(width - Math.round(width)) > 0.05 ? Math.round(r) : width;
  }
  function scaleStrokes(frame, scale) {
    for (const node of descendantsOfType(frame, STROKE_TYPES3)) {
      const strokes = props(node)["strokes"];
      if (!Array.isArray(strokes) || strokes.length === 0 || insideInstance(node))
        continue;
      for (const weight of STROKE_WEIGHTS) {
        const current2 = props(node)[weight];
        if (typeof current2 !== "number") continue;
        const next = scaledWeight(current2, scale);
        if (next !== current2) {
          props(node)[weight] = next;
          note.mutated(node);
        }
      }
    }
  }
  var copyFrom = (from, to, frame) => {
    for (const prop of LAYOUT_PROPS) {
      if (prop === "fills") continue;
      try {
        props(to)[prop] = props(from)[prop];
      } catch (e) {
        note.warn(
          "LAYOUT_PROP",
          `No se pudo copiar «${prop}» a «${frame.name}»: ${messageOf4(e)}`,
          frame.id
        );
      }
    }
  };
  function unwrap(frame, holding) {
    if (frame.children.some((k) => holding.includes(k.name))) return;
    const wrap = frame.children.find(
      (k) => k.type === "FRAME" && k.children.some((c) => holding.includes(c.name))
    );
    if (wrap === void 0 || wrap.type !== "FRAME") return;
    copyFrom(wrap, frame, frame);
    for (const child of [...wrap.children]) {
      frame.insertChild(frame.children.indexOf(wrap), child);
    }
    note.removed(wrap);
    wrap.remove();
    for (const k of [...frame.children]) {
      if (k.type === "FRAME" && k.width < 1 && k.height < 1) {
        note.removed(k);
        k.remove();
      }
    }
  }
  function fixWidth(frame, width) {
    if (frame.layoutMode === "HORIZONTAL") {
      frame.primaryAxisSizingMode = "FIXED";
      frame.counterAxisSizingMode = "AUTO";
    } else if (frame.layoutMode === "VERTICAL") {
      frame.counterAxisSizingMode = "FIXED";
      frame.primaryAxisSizingMode = "AUTO";
    }
    frame.resize(width, frame.height);
    frame.counterAxisAlignItems = "MIN";
  }
  function ensureMinHeight(frame, width, minHeight) {
    if (frame.height >= minHeight) return;
    if (frame.layoutMode === "HORIZONTAL") frame.counterAxisSizingMode = "FIXED";
    else if (frame.layoutMode === "VERTICAL")
      frame.primaryAxisSizingMode = "FIXED";
    frame.resize(width, minHeight);
  }
  function placeShell(area, shell, frame, value) {
    const spec = area.shell;
    if (spec === void 0) return;
    const aside = frame.children.find((k) => spec.in.includes(k.name));
    const side = aside?.type === "FRAME" ? aside.children[0] : void 0;
    if (aside === void 0 || aside.type !== "FRAME" || side === void 0)
      return;
    const variant = pickVariant(
      shell,
      { [spec.variantProp]: value },
      { strong: [spec.variantProp] }
    );
    const instance = variant.createInstance();
    aside.insertChild(aside.children.indexOf(side), instance);
    note.removed(side);
    side.remove();
    note.created(instance);
    instance.layoutAlign = "STRETCH";
    instance.layoutGrow = 1;
    if (spec.fixed === void 0) return;
    const width = aside.width;
    aside.layoutPositioning = "ABSOLUTE";
    aside.x = 0;
    aside.y = 0;
    aside.layoutMode = "VERTICAL";
    aside.resize(width, spec.fixed.height);
    frame.paddingLeft = width;
    frame.appendChild(aside);
    note.mutated(aside);
  }
  function fixShell(frame) {
    try {
      frame.numberOfFixedChildren = 1;
    } catch (e) {
      note.warn(
        "FIXED_FAILED",
        `«${frame.name}» no queda fijo al hacer scroll: ${messageOf4(e)}`,
        frame.id
      );
      return;
    }
    if (frame.numberOfFixedChildren !== 1) {
      note.warn(
        "FIXED_FAILED",
        `«${frame.name}» no queda fijo al hacer scroll: Figma dejó ${frame.numberOfFixedChildren} hijos fijos (solo fija los últimos hijos que están fuera del flujo).`,
        frame.id
      );
    }
  }
  async function placeReplace(area, frame, origin, shell, value, fill) {
    await replaceContent(frame, origin, { copyLayout: true });
    if (area.place.unwrap !== void 0) unwrap(frame, area.place.unwrap.holding);
    fixWidth(frame, area.frame.width);
    const main = frame.children.find((k) => area.main?.includes(k.name));
    if (main !== void 0 && "layoutGrow" in main) main.layoutGrow = 1;
    if (shell !== null) placeShell(area, shell, frame, value);
    ensureMinHeight(frame, area.frame.width, area.frame.minHeight);
    if (area.shell?.fixed !== void 0) fixShell(frame);
    if (area.place.strokeScale !== void 0)
      scaleStrokes(frame, area.place.strokeScale);
    if (fill !== void 0 && fill !== null && frame.fills.length === 0) {
      setPaints(frame, "fills", [{ bind: fill }]);
    }
    note.mutated(frame);
  }
  async function placeTransplant(area, clickable, frame, origin) {
    const keep = new Set(area.place.keep ?? []);
    const old = [];
    for (const child of frame.children) {
      const kept = child.type === "INSTANCE" && keep.has(await setNameOf(child) ?? "");
      if (!kept) old.push(child);
    }
    if (old.length === 0) {
      note.warn(
        "NO_CONTENT",
        `«${frame.name}» no tiene contenido propio que sustituir.`,
        frame.id
      );
      return null;
    }
    const drop = area.place.drop ?? [];
    const kids = [...origin.children];
    const mid = kids.filter(
      (k, i) => !((i === 0 || i === kids.length - 1) && drop.includes(k.name))
    );
    const saved = old.flatMap((o) => capture(o));
    const at2 = frame.children.indexOf(old[0]);
    note.removed(old);
    for (const o of old) o.remove();
    mid.forEach((k, i) => {
      frame.insertChild(at2 + i, k);
      props(k)["layoutAlign"] = "STRETCH";
    });
    const placed = frame.children.slice(at2, at2 + mid.length);
    note.created(placed);
    note.mutated(frame);
    return restore(placed, saved, { clickable });
  }
  async function removeTemps(page, temps) {
    const alive = temps.filter((p) => !p.removed);
    if (alive.length === 0) return;
    const open = figmaApi().currentPage;
    if (alive.some((p) => p.id === open.id))
      await figmaApi().setCurrentPageAsync(page);
    for (const temp of alive) await removePage(temp);
  }
  async function place(params) {
    const area = params.area;
    const tracker = startTracking();
    const { page, shell, fill } = await preflight(area);
    const frames = [];
    const relinked = [];
    const consumed = [];
    try {
      for (const screen of area.screens) {
        let frame = await findAreaFrame(area, page, screen.frame);
        const temp = tempPageFor(area, screen.frame);
        if (temp === null) {
          note.warn(
            "NO_SOURCE",
            `No hay página temporal para «${screen.frame}»: se deja como está.`,
            frame?.id
          );
          continue;
        }
        const origin = originIn(temp, area.place.source.take);
        if (origin === null) {
          note.warn(
            "NO_SOURCE",
            `La página «${temp.name}» no tiene ${area.place.source.take}: «${screen.frame}» se deja como está.`,
            frame?.id
          );
          continue;
        }
        frame ??= await ensureFrame({
          key: areaFrameKey(area.name, screen.frame),
          page,
          name: screen.frame,
          width: area.frame.width,
          minHeight: area.frame.minHeight
        });
        const value = screen.shell ?? area.shell?.default ?? "";
        if (area.place.mode === "transplant") {
          const done = await placeTransplant(
            area,
            area.clickable ?? params.linkRules.clickable,
            frame,
            origin
          );
          if (done !== null) relinked.push({ frame: screen.frame, ...done });
        } else {
          await placeReplace(area, frame, origin, shell, value, fill);
        }
        consumed.push(temp);
        frames.push({
          frame: screen.frame,
          id: frame.id,
          height: Math.round(frame.height),
          ...area.shell !== void 0 && area.place.mode === "replace-content" && { shell: value }
        });
      }
    } catch (e) {
      if (area.place.source.remove !== false)
        await removeTemps(
          page,
          area.screens.map((screen) => tempPageFor(area, screen.frame)).filter((p) => p !== null)
        );
      throw e;
    }
    if (area.place.source.remove !== false) await removeTemps(page, consumed);
    return tracker.done({
      frames,
      ...area.place.mode === "transplant" && { relinked }
    });
  }

  // kits/figma/steps/share.ts
  var loose = (node) => node;
  async function groupPage(group) {
    const f = figmaApi();
    const before = new Set(f.root.children.map((p) => p.id));
    const page = await ensurePage({
      key: sharedGroupKey(group.name),
      name: group.page.name
    });
    if (!before.has(page.id) && group.page.after !== void 0) {
      const after = await findPage(group.page.after);
      if (after !== null)
        f.root.insertChild(f.root.children.indexOf(after) + 1, page);
    }
    await page.loadAsync();
    return page;
  }
  async function groupSet(group, page) {
    const byKey2 = await nodeByKey(sharedGroupKey(group.name), { page });
    if (byKey2 !== null && byKey2.type === "COMPONENT_SET") return byKey2;
    const byName = page.children.find(
      (c) => c.type === "COMPONENT_SET" && c.name === group.set
    );
    if (byName === void 0 || byName.type !== "COMPONENT_SET") return null;
    tagNode(byName, sharedGroupKey(group.name));
    return byName;
  }
  async function clearReactions(part) {
    for (const node of [part, ...descendantsOfType(part, LINKABLE_TYPES)]) {
      const reactions = loose(node)["reactions"];
      if (!Array.isArray(reactions) || reactions.length === 0) continue;
      await node.setReactionsAsync([]);
      note.mutated(node);
    }
  }
  async function share(params) {
    const area = params.area;
    const tracker = startTracking();
    const areaPage = await requirePage(area);
    const report = [];
    for (const group of params.shared) {
      const mine = group.from.filter((entry) => entry.area === area.name);
      if (mine.length === 0) continue;
      const page = await groupPage(group);
      let set = await groupSet(group, page);
      const entries = [];
      for (const from of mine) {
        const frame = await findAreaFrame(area, areaPage, from.frame);
        if (frame === null) {
          note.warn(
            "ALREADY_SHARED",
            `El frame «${from.frame}» no existe en «${area.page}»: no se comparte.`
          );
          continue;
        }
        const part = frame.children.find((k) => group.part.includes(k.name));
        if (part === void 0) {
          note.warn(
            "ALREADY_SHARED",
            `«${from.frame}» ya no tiene la capa a compartir: ya está compartido.`,
            frame.id
          );
          continue;
        }
        const index = frame.children.indexOf(part);
        const width = part.width;
        await clearReactions(part);
        page.appendChild(part);
        const mover = loose(part);
        mover["layoutGrow"] = 0;
        mover["layoutSizingHorizontal"] = "FIXED";
        part.resize(width, part.height);
        mover["layoutSizingVertical"] = "HUG";
        const name = `${group.variantProp}=${from.value}`;
        const component = figmaApi().createComponentFromNode(part);
        component.name = name;
        entries.push({ frame, index, component, name });
      }
      if (entries.length === 0) continue;
      const refilled = /* @__PURE__ */ new Set();
      if (set !== null) {
        for (const entry of entries) {
          const old = set.children.find((c) => c.name === entry.name);
          if (old !== void 0 && old.type === "COMPONENT") {
            await refill(old, entry.component, page);
            note.mutated(old);
            refilled.add(entry.name);
            continue;
          }
          set.appendChild(entry.component);
        }
      } else {
        set = figmaApi().combineAsVariants(
          entries.map((e) => e.component),
          page
        );
        set.name = group.set;
        if (group.sheet !== void 0) {
          set.layoutMode = "HORIZONTAL";
          set.itemSpacing = group.sheet.gap;
          set.paddingTop = group.sheet.padding;
          set.paddingBottom = group.sheet.padding;
          set.paddingLeft = group.sheet.padding;
          set.paddingRight = group.sheet.padding;
          set.counterAxisSizingMode = "AUTO";
          set.primaryAxisSizingMode = "AUTO";
          set.fills = [{ type: "SOLID", color: { r: 0.98, g: 0.98, b: 0.98 } }];
        }
        set.description = `Contenido de «${group.name}» común a varias áreas (una variante por ${group.variantProp}). Las pantallas de cada área usan una instancia.`;
        tagNode(set, sharedGroupKey(group.name));
      }
      const names = new Set(
        entries.map((e) => e.name).filter((n) => !refilled.has(n))
      );
      note.created(set.children.filter((c) => names.has(c.name)));
      for (const entry of entries) {
        const variant = set.children.find((c) => c.name === entry.name);
        if (variant === void 0 || variant.type !== "COMPONENT") {
          fail(
            "VARIANT_NOT_FOUND",
            `El set «${group.set}» no tiene la variante «${entry.name}» tras compartir.`,
            "Mira el set en Figma y repite el paso."
          );
        }
        const instance = variant.createInstance();
        entry.frame.insertChild(entry.index, instance);
        instance.layoutGrow = 1;
        instance.layoutAlign = "INHERIT";
        note.created(instance);
        note.mutated(entry.frame);
        report.push({
          group: group.name,
          area: area.name,
          frame: entry.frame.name,
          variant: entry.name
        });
      }
    }
    return tracker.done({ shared: report });
  }

  // kits/figma/steps/index.ts
  var steps = Object.freeze({
    buildComponent: (params, assets, recognize) => buildComponent(params, assets, recognize),
    buildScreen: (params, assets, recognize) => buildScreen(params, assets, recognize),
    compose: (params, _assets) => compose(params),
    place: (params, _assets) => place(params),
    share: (params, _assets) => share(params),
    links: (params, _assets) => links(params),
    layoutCheck: (params, _assets) => layoutCheck(params),
    fillImage: (params, assets) => fillImage(params, assets)
  });

  // kits/figma/kit.ts
  function createKit() {
    const sha = globalThis[KIT_SHA_GLOBAL];
    return Object.freeze({
      version: KIT_VERSION,
      sha256: typeof sha === "string" ? sha : null,
      track: startTracking,
      fail,
      page: Object.freeze({
        find: findPage,
        ensure: ensurePage,
        remove: removePage
      }),
      node: Object.freeze({ get: getNode, tag: tagNode, byKey: nodeByKey }),
      frame: Object.freeze({ ensure: ensureFrame, replaceContent }),
      links: Object.freeze({ capture, restore, to: linkTo, byText, rows }),
      flow: Object.freeze({ start: startFlow }),
      component: Object.freeze({
        find: findComponent,
        setNameOf,
        variant: pickVariant,
        cloneVariant
      }),
      instance: Object.freeze({ create: createInstance }),
      slot: Object.freeze({ fill: fillSlot, share: shareSlot }),
      fonts: Object.freeze({ ensure: ensureFonts, load: loadFonts }),
      tokens: Object.freeze({
        load: loadTokens,
        resolver: createPaintResolver,
        // El relleno o borde de un color: ligado a su variable si la hay (la de la clase del nodo o de sus antecesores)
        paint: (resolver, color, chain, kind = "fill") => resolver.paint(color, chain, kind)
      }),
      layers: Object.freeze({ role: layerRole }),
      screen: Object.freeze({ paint: paintScreen }),
      sheet: Object.freeze({ paint: paintSheet, assess: assessPlan }),
      paints: Object.freeze({ set: setPaints }),
      icons: Object.freeze({ fromSvg: iconFromSvg }),
      json: readJson,
      steps
    });
  }

  // kits/figma/index.ts
  globalThis[KIT_GLOBAL] = createKit();
})();
//# sourceURL=figma-kit@1.js
