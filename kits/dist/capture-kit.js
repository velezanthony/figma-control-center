"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // kits/capture/parse.ts
  var px = (v) => parseFloat(v) || 0;
  var luminance = (c) => {
    const f = (x) => {
      x /= 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
  };
  var shadows = (v, color) => !v || v === "none" ? [] : v.split(/,(?![^(]*\))/).map((part) => {
    const m = /([a-z-]+\([^)]*\)|#[0-9a-f]+)/i.exec(part);
    if (!m) return null;
    const c = color(m[1]);
    if (!c) return null;
    const n = (part.replace(m[1], "").match(/-?[\d.]+px/g) || []).map(parseFloat).concat([0, 0, 0, 0]);
    return {
      c,
      x: n[0],
      y: n[1],
      b: n[2],
      s: n[3],
      inset: /inset/.test(part)
    };
  }).filter((s) => s !== null);
  function splitTop(str) {
    const out = [];
    let d = 0;
    let cur = "";
    for (const ch of str) {
      if (ch === "(") d++;
      if (ch === ")") d--;
      if (ch === "," && d === 0) {
        out.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  function gradient(bgi, w, h, color) {
    const rad = /^radial-gradient\((.*)\)$/.exec((bgi || "").trim());
    if (rad) {
      const parts2 = splitTop(rad[1]);
      if (/^(circle|ellipse|closest|farthest|at )/.test(parts2[0] ?? ""))
        parts2.shift();
      const st2 = parts2.map((st) => {
        const pm = /\s(-?[\d.]+)%$/.exec(st);
        const raw = pm ? st.slice(0, pm.index) : st;
        return {
          c: color(raw) || [0, 0, 0, 0],
          p: pm ? parseFloat(pm[1]) / 100 : null
        };
      });
      st2.forEach((x, i) => {
        if (x.p == null) x.p = i / Math.max(1, st2.length - 1);
      });
      st2.forEach((x, i) => {
        if (x.c[3] === 0) {
          const nb = st2[i - 1] || st2[i + 1];
          if (nb) x.c = [nb.c[0], nb.c[1], nb.c[2], 0];
        }
      });
      return st2.length >= 2 ? { radial: true, stops: st2 } : null;
    }
    const m = /^linear-gradient\((.*)\)$/.exec((bgi || "").trim());
    if (!m) return null;
    const parts = splitTop(m[1]);
    let angle = 180;
    const head = (parts[0] ?? "").replace(/\bin [a-z]+( (shorter|longer|increasing|decreasing) hue)?/, "").trim();
    if (/deg$/.test(head)) {
      angle = parseFloat(head);
      parts.shift();
    } else if (/^to /.test(head)) {
      const k = head.slice(3).split(/\s+/);
      const sx = k.includes("right") ? 1 : k.includes("left") ? -1 : 0;
      const sy = k.includes("bottom") ? 1 : k.includes("top") ? -1 : 0;
      const dx = sx && sy ? sx * h : sx;
      const dy = sx && sy ? sy * w : sy;
      angle = Math.atan2(dx, -dy) * 180 / Math.PI;
      parts.shift();
    } else if (head === "") parts.shift();
    const stops = parts.map((st) => {
      const pm = /\s(-?[\d.]+)%$/.exec(st);
      return {
        c: color(pm ? st.slice(0, pm.index) : st),
        p: pm ? parseFloat(pm[1]) / 100 : null
      };
    }).filter((x) => x.c);
    if (stops.length < 2) return null;
    stops.forEach((x, i) => {
      if (x.p == null) x.p = i / (stops.length - 1);
    });
    return { angle, stops };
  }

  // kits/capture/pieces.ts
  var pieces_exports = {};
  __export(pieces_exports, {
    FRAME0: () => FRAME0,
    SKIPPED_TAGS: () => SKIPPED_TAGS,
    appearance: () => appearance,
    backgroundImage: () => backgroundImage,
    box: () => box,
    classOf: () => classOf,
    contentsBox: () => contentsBox,
    control: () => control,
    cssTriangle: () => cssTriangle,
    image: () => image,
    isRendered: () => isRendered,
    isVisible: () => isVisible,
    layout: () => layout,
    marker: () => marker,
    nativeControl: () => nativeControl,
    onTop: () => onTop,
    pseudo: () => pseudo,
    svg: () => svg,
    text: () => text
  });
  var SKIPPED_TAGS = ["SCRIPT", "STYLE", "TEMPLATE", "LINK"];
  var FRAME0 = () => ({
    t: "frame",
    disp: "block",
    dir: "row",
    wrap: "nowrap",
    jc: "normal",
    ai: "normal",
    gap: 0,
    rgap: 0,
    pad: [0, 0, 0, 0],
    bg: null,
    bw: [0, 0, 0, 0],
    bc: null,
    bcb: null,
    rad: [0, 0, 0, 0],
    sh: "",
    ov: "visible",
    ml: 0,
    cls: "",
    op: 1,
    pos: "static",
    w: 0,
    h: 0,
    kids: []
  });
  var radii = (cs) => [
    px(cs.borderTopLeftRadius),
    px(cs.borderTopRightRadius),
    px(cs.borderBottomRightRadius),
    px(cs.borderBottomLeftRadius)
  ];
  var isRendered = (cs) => !(cs.display === "none" || cs.visibility === "hidden");
  function isVisible(el, cs, r, env) {
    if (!isRendered(cs)) return false;
    const pd = el.parentElement;
    if (pd && pd.tagName === "DETAILS" && !pd.open && el.tagName !== "SUMMARY")
      return false;
    if (cs.position === "absolute" && r.width <= 1 && r.height <= 1) return false;
    if ((cs.position === "fixed" || cs.position === "absolute") && r.width > 0 && (r.right <= 0 || r.left >= env.win.innerWidth))
      return false;
    return true;
  }
  function contentsBox(el) {
    const ch = [...el.children].filter((c) => !SKIPPED_TAGS.includes(c.tagName));
    const rs = ch.map((c) => c.getBoundingClientRect()).filter((q) => q.width || q.height);
    if (!rs.length) return null;
    const L = Math.min(...rs.map((q) => q.left));
    const T = Math.min(...rs.map((q) => q.top));
    const R = Math.max(...rs.map((q) => q.right));
    const B = Math.max(...rs.map((q) => q.bottom));
    return {
      children: ch,
      box: { left: L, top: T, width: R - L, height: B - T }
    };
  }
  var classOf = (el) => typeof el.className === "string" ? el.className.replace(/\s+/g, " ").trim() : el.getAttribute("class") || "";
  function box(el, cs, r, parentRect) {
    return {
      t: "frame",
      tag: el.tagName.toLowerCase(),
      cls: classOf(el),
      x: r.left - (parentRect ? parentRect.left : 0),
      y: r.top - (parentRect ? parentRect.top : 0),
      w: r.width,
      h: r.height,
      pos: cs.position,
      op: parseFloat(cs.opacity)
    };
  }
  function onTop(el, cs, r, env) {
    if (!(cs.position === "absolute" && r.width > 2 && r.height > 2))
      return false;
    const hit = env.doc.elementFromPoint(
      r.left + r.width / 2,
      r.top + r.height / 2
    );
    return !!(hit && (hit === el || el.contains(hit)));
  }
  function layout(cs) {
    return {
      disp: cs.display,
      dir: cs.flexDirection,
      wrap: cs.flexWrap,
      jc: cs.justifyContent,
      ai: cs.alignItems,
      gap: px(cs.columnGap) || 0,
      rgap: px(cs.rowGap) || 0,
      pad: [
        px(cs.paddingTop),
        px(cs.paddingRight),
        px(cs.paddingBottom),
        px(cs.paddingLeft)
      ],
      fl: cs.cssFloat,
      ov: cs.overflow,
      ml: px(cs.marginLeft),
      va: cs.verticalAlign,
      fg: parseFloat(cs.flexGrow) || 0
    };
  }
  function appearance(cs, r, env) {
    const { color, font } = env.v;
    return {
      bg: color(cs.backgroundColor),
      bw: [
        px(cs.borderTopWidth),
        px(cs.borderRightWidth),
        px(cs.borderBottomWidth),
        px(cs.borderLeftWidth)
      ],
      bc: color(cs.borderTopColor),
      bcb: color(cs.borderBottomColor),
      rad: radii(cs),
      sh: cs.boxShadow !== "none" ? cs.boxShadow : "",
      shs: shadows(cs.boxShadow, color),
      font: font(cs),
      grad: gradient(cs.backgroundImage, r.width, r.height, color)
    };
  }
  function nativeControl(el, cs, base, env) {
    const { color, font } = env.v;
    const radio = el.type === "radio";
    const s = base.w;
    const dis = el.disabled;
    const acc = color(
      cs.accentColor === "auto" ? "rgb(0,117,255)" : cs.accentColor
    );
    const ink = 1.05 / (luminance(acc) + 0.05) < 3 ? [59, 59, 59, 1] : [255, 255, 255, 1];
    const R = radio ? [s / 2, s / 2, s / 2, s / 2] : [2.5, 2.5, 2.5, 2.5];
    const f = {
      ...FRAME0(),
      ...base,
      t: "frame",
      tag: radio ? "radio" : "checkbox",
      rad: R,
      font: font(cs),
      kids: []
    };
    if (!el.checked)
      return {
        ...f,
        bg: [255, 255, 255, 1],
        bw: [1, 1, 1, 1],
        bc: dis ? [118, 118, 118, 0.3] : [118, 118, 118, 1],
        bcb: dis ? [118, 118, 118, 0.3] : [118, 118, 118, 1]
      };
    if (!radio) {
      const col = dis ? "rgb(255,255,255)" : `rgb(${ink.slice(0, 3)})`;
      return {
        ...f,
        bg: dis ? [232, 232, 232, 1] : acc,
        kids: [
          {
            t: "svg",
            tag: "svg",
            cls: "",
            op: 1,
            pos: "absolute",
            x: 0,
            y: 0,
            w: s,
            h: s,
            key: "",
            color: ink,
            svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="none"><path d="M3.5 8.2 6.6 11.2 12.6 4.6" stroke="${col}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
          }
        ]
      };
    }
    const dot = (d, c) => ({
      ...FRAME0(),
      tag: "span",
      pos: "absolute",
      x: (s - d) / 2,
      y: (s - d) / 2,
      w: d,
      h: d,
      bg: c,
      rad: [d / 2, d / 2, d / 2, d / 2],
      font: f.font,
      kids: []
    });
    return {
      ...f,
      bg: dis ? [232, 232, 232, 1] : acc,
      kids: [
        dot(s * 0.8, dis ? [255, 255, 255, 1] : ink),
        dot(s * 0.56, dis ? [232, 232, 232, 1] : acc)
      ]
    };
  }
  function control(el, cs, tag, env) {
    const { color, font, measureText, lineHeight } = env.v;
    let txt = "";
    let c = color(cs.color);
    const input = el;
    if (tag === "select") {
      const sel = el;
      const o = sel.options[sel.selectedIndex];
      txt = o ? o.text : "";
    } else if (input.type === "date" || input.type === "month") {
      const v = input.value;
      txt = v ? v.split("-").reverse().join("/") : input.type === "date" ? "dd/mm/aaaa" : "-------- de ----";
    } else if (input.value)
      txt = input.type === "password" ? "•".repeat(input.value.length) : input.value;
    else if (input.placeholder) {
      txt = input.placeholder;
      c = color(env.win.getComputedStyle(el, "::placeholder").color);
    }
    if (!txt) return [];
    const inner = el.clientWidth - px(cs.paddingLeft) - px(cs.paddingRight);
    const w = tag === "textarea" ? inner : Math.min(measureText(txt, cs), inner);
    const k = [
      {
        t: "text",
        txt,
        w,
        h: lineHeight(cs),
        lines: tag === "textarea" ? 2 : 1,
        font: font(cs, c)
      }
    ];
    if (input.type === "date" || input.type === "month")
      k.push({
        t: "icon",
        name: "calendar",
        w: 16,
        h: 16,
        color: color(cs.color)
      });
    return k;
  }
  function pseudo(el, which, env) {
    const { win } = env;
    const { font, measureText, lineHeight } = env.v;
    const p = win.getComputedStyle(el, which);
    const c = p.content;
    if (!c || c === "none" || c === "normal" || !/^".*"$/.test(c)) return null;
    if (/awesome/i.test(p.fontFamily)) {
      const g = c.slice(1, -1);
      const cs2 = win.document.createElement("canvas");
      const x = cs2.getContext("2d");
      const f = `${p.fontWeight} ${p.fontSize} ${p.fontFamily}`;
      x.font = f;
      const w = Math.ceil(x.measureText(g).width) || px(p.fontSize);
      const h = Math.ceil(lineHeight(p));
      cs2.width = w * 3;
      cs2.height = h * 3;
      const y = cs2.getContext("2d");
      y.scale(3, 3);
      y.font = f;
      y.fillStyle = p.color;
      y.globalAlpha = parseFloat(win.getComputedStyle(el).opacity) || 1;
      y.textBaseline = "middle";
      y.fillText(g, 0, h / 2);
      return {
        t: "img",
        tag: "fa",
        cls: el.className || "",
        op: 1,
        pos: "static",
        w,
        h,
        data: cs2.toDataURL("image/png"),
        fit: "fill",
        rad: [0, 0, 0, 0],
        glyph: g.codePointAt(0).toString(16)
      };
    }
    const txt = c.slice(1, -1).replace(/\\"/g, '"');
    if (!txt.trim()) return null;
    return {
      t: "text",
      txt,
      w: measureText(txt, p),
      h: lineHeight(p),
      lines: 1,
      font: font(p),
      ml: px(p.marginLeft),
      mr: px(p.marginRight)
    };
  }
  function marker(el, cs, r, tag, env) {
    const { win } = env;
    const { font, measureText, lineHeight } = env.v;
    let first = null;
    let last = null;
    if (cs.display === "list-item" && cs.listStyleType !== "none" && tag === "li") {
      const mk = win.getComputedStyle(el, "::marker");
      const parent = el.parentElement;
      const ol = parent && parent.tagName === "OL";
      const i = [...parent.children].filter((c) => c.tagName === "LI").indexOf(el) + (ol ? parseInt(parent.getAttribute("start")) || 1 : 1);
      const txt = ol || /decimal/.test(cs.listStyleType) ? `${i}.` : cs.listStyleType === "circle" ? "◦" : cs.listStyleType === "square" ? "▪" : "•";
      const f = font(mk);
      const w = measureText(txt, mk);
      first = {
        t: "text",
        txt,
        pos: "absolute",
        x: -(w + px(mk.fontSize) * 0.5),
        y: px(cs.paddingTop),
        w,
        h: lineHeight(cs),
        lines: 1,
        font: { ...f, lh: cs.lineHeight }
      };
    }
    if (tag === "summary" && cs.display === "list-item") {
      const parent = el.parentElement;
      const mk = parent && parent.open ? "▾ " : "▸ ";
      last = {
        t: "text",
        txt: mk,
        x: 0,
        y: 0,
        w: measureText(mk, cs),
        h: px(cs.lineHeight) || r.height,
        lines: 1
      };
    }
    return { first, last };
  }
  function image(el, cs, r, base, tag, env) {
    const { win } = env;
    if (tag === "canvas") {
      const cv = el;
      let data;
      try {
        data = cv.toDataURL("image/png");
      } catch {
        return null;
      }
      if (!cv.width || !cv.height) return null;
      return {
        ...base,
        t: "img",
        tag: "canvas",
        src: "",
        data,
        fit: "fill",
        rad: [0, 0, 0, 0]
      };
    }
    if (tag === "video") {
      const vd = el;
      if (vd.readyState < 2) return null;
      const c2 = win.document.createElement("canvas");
      const k = Math.min(
        1,
        2 * Math.max(r.width, r.height) / Math.max(vd.videoWidth, vd.videoHeight, 1)
      );
      c2.width = Math.max(1, Math.round(vd.videoWidth * k));
      c2.height = Math.max(1, Math.round(vd.videoHeight * k));
      let data;
      try {
        c2.getContext("2d").drawImage(
          vd,
          0,
          0,
          c2.width,
          c2.height
        );
        data = c2.toDataURL("image/png");
      } catch {
        return null;
      }
      return {
        ...base,
        t: "img",
        tag: "video",
        src: vd.currentSrc || "",
        data,
        fit: cs.objectFit,
        rad: radii(cs)
      };
    }
    if (tag === "img") {
      const im = el;
      if (!im.complete || !im.naturalWidth) return null;
      const lim = env.imgHi ? 2 * Math.max(r.width, r.height, 1) : 256;
      const c2 = win.document.createElement("canvas");
      const k = Math.min(1, lim / Math.max(im.naturalWidth, im.naturalHeight, 1));
      c2.width = Math.max(1, Math.round(im.naturalWidth * k));
      c2.height = Math.max(1, Math.round(im.naturalHeight * k));
      const g2 = c2.getContext("2d");
      let data;
      try {
        g2.drawImage(im, 0, 0, c2.width, c2.height);
        let opaque = false;
        if (env.imgHi && c2.width * c2.height > 16e4) {
          const a = g2.getImageData(0, 0, c2.width, c2.height).data;
          opaque = true;
          for (let i = 3; i < a.length; i += 4 * 97)
            if (a[i] < 255) {
              opaque = false;
              break;
            }
        }
        data = opaque ? c2.toDataURL("image/jpeg", 0.85) : c2.toDataURL("image/png");
      } catch {
        return null;
      }
      return {
        ...base,
        t: "img",
        src: im.getAttribute("src") || "",
        data,
        fit: cs.objectFit,
        rad: radii(cs)
      };
    }
    return void 0;
  }
  function svg(el, cs, r, base, cls, env) {
    const { win } = env;
    const color = env.v.color(cs.color);
    const keys = [...el.querySelectorAll("path")].map((p) => p.getAttribute("d")).join("|");
    const cl = el.cloneNode(true);
    const src = [el, ...el.querySelectorAll("*")];
    const dst = [cl, ...cl.querySelectorAll("*")];
    src.forEach((o, i) => {
      const c2 = win.getComputedStyle(o);
      if (o === el) return;
      for (const [a, v] of [
        ["stroke", c2.stroke],
        ["fill", c2.fill],
        ["stroke-width", c2.strokeWidth],
        ["stroke-linecap", c2.strokeLinecap],
        ["stroke-linejoin", c2.strokeLinejoin],
        ["opacity", c2.opacity]
      ])
        if (v && v !== "normal") dst[i].setAttribute(a, v);
    });
    const out = cl.outerHTML.replace(/currentColor/g, cs.color);
    const sw = parseFloat(cs.width) || r.width;
    const sh = parseFloat(cs.height) || r.height;
    return {
      ...base,
      x: base.x + (r.width - sw) / 2,
      y: base.y + (r.height - sh) / 2,
      w: sw,
      h: sh,
      t: "svg",
      svg: out,
      key: keys,
      color,
      spin: /animate-spin/.test(cls)
    };
  }
  function cssTriangle(el, cs, r, base, env) {
    const { color } = env.v;
    const bwT = px(cs.borderTopWidth);
    const bwB = px(cs.borderBottomWidth);
    const bwL = px(cs.borderLeftWidth);
    const bwR = px(cs.borderRightWidth);
    if (!el.children.length && !el.textContent.trim() && Math.abs(r.width - bwL - bwR) < 0.5 && (bwT || bwB) && !color(cs.borderLeftColor) && !color(cs.borderRightColor)) {
      const down = !!color(cs.borderTopColor) && bwT > 0;
      const c = down ? cs.borderTopColor : cs.borderBottomColor;
      const W = r.width;
      const Hh = r.height;
      const pts = down ? `0,0 ${W},0 ${W / 2},${Hh}` : `0,${Hh} ${W},${Hh} ${W / 2},0`;
      return {
        ...base,
        t: "svg",
        key: "",
        color: color(c),
        svg: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${Hh}" viewBox="0 0 ${W} ${Hh}"><polygon points="${pts}" fill="${c}"/></svg>`
      };
    }
    return null;
  }
  var splitPos = (v) => v.match(/calc\([^)]*\)|\S+/g) || [];
  var posAxis = (tok, L, sz) => {
    if (!tok) return 0;
    const m = /^calc\(([\d.]+)% ([-+]) ([\d.]+)px\)$/.exec(tok);
    if (m)
      return (L - sz) * Number(m[1]) / 100 + (m[2] === "-" ? -1 : 1) * Number(m[3]);
    if (tok.endsWith("%")) return (L - sz) * parseFloat(tok) / 100;
    return {
      left: 0,
      top: 0,
      center: (L - sz) / 2,
      right: L - sz,
      bottom: L - sz
    }[tok] ?? px(tok);
  };
  function backgroundImage(_el, cs, img, w, h, env) {
    const { doc } = env;
    const S = 2;
    const c = doc.createElement("canvas");
    c.width = Math.max(1, Math.round(w * S));
    c.height = Math.max(1, Math.round(h * S));
    const ctx = c.getContext("2d");
    ctx.scale(S, S);
    const bl = px(cs.borderLeftWidth);
    const bt = px(cs.borderTopWidth);
    const L = w - bl - px(cs.borderRightWidth);
    const H = h - bt - px(cs.borderBottomWidth);
    const nw = img.naturalWidth || L;
    const nh = img.naturalHeight || H;
    let sw = nw;
    let sh = nh;
    const bs = cs.backgroundSize.split(" ");
    if (bs[0] === "contain" || bs[0] === "cover") {
      const k = (bs[0] === "contain" ? Math.min : Math.max)(L / nw, H / nh);
      sw = nw * k;
      sh = nh * k;
    } else {
      const a = bs[0];
      const b = bs[1] || "auto";
      sw = a === "auto" ? null : a.endsWith("%") ? L * parseFloat(a) / 100 : px(a);
      sh = b === "auto" ? null : b.endsWith("%") ? H * parseFloat(b) / 100 : px(b);
      if (sw == null && sh == null) {
        sw = nw;
        sh = nh;
      } else if (sw == null) sw = nw * sh / nh;
      else if (sh == null) sh = nh * sw / nw;
    }
    const fw = sw;
    const fh = sh;
    const [px1, py1] = splitPos(cs.backgroundPosition);
    const ix = bl + posAxis(px1, L, fw);
    const iy = bt + posAxis(py1 || "center", H, fh);
    if (/no-repeat/.test(cs.backgroundRepeat) && (fw < L - 1 || fh < H - 1)) {
      const c2 = doc.createElement("canvas");
      c2.width = Math.max(1, Math.round(fw * S));
      c2.height = Math.max(1, Math.round(fh * S));
      try {
        c2.getContext("2d").drawImage(
          img,
          0,
          0,
          c2.width,
          c2.height
        );
      } catch {
        return null;
      }
      return {
        t: "img",
        tag: "bg",
        cls: "",
        op: 1,
        pos: "absolute",
        x: ix,
        y: iy,
        w: fw,
        h: fh,
        data: c2.toDataURL("image/png"),
        fit: "fill",
        rad: [0, 0, 0, 0]
      };
    }
    try {
      ctx.drawImage(img, ix, iy, fw, fh);
      c.toDataURL();
    } catch {
      return null;
    }
    return {
      t: "img",
      tag: "bg",
      cls: "",
      op: 1,
      pos: "absolute",
      x: 0,
      y: 0,
      w,
      h,
      data: c.toDataURL("image/png"),
      fit: "fill",
      rad: radii(cs)
    };
  }
  function text(el, r, cs, env) {
    const sig = [...el.childNodes].filter(
      (c) => c.nodeType === 1 || c.nodeType === 3 && c.textContent.trim()
    );
    const inlineFlow = !/flex|grid/.test(cs.display);
    return (ch) => {
      let txt = ch.textContent.replace(/\s+/g, " ");
      if (!txt.trim()) return null;
      if (!inlineFlow || ch === sig[0]) txt = txt.trimStart();
      if (!inlineFlow || ch === sig[sig.length - 1]) txt = txt.trimEnd();
      const rg = env.doc.createRange();
      rg.selectNodeContents(ch);
      const tr = rg.getBoundingClientRect();
      if (tr.width === 0) return null;
      return {
        t: "text",
        txt,
        x: tr.left - r.left,
        y: tr.top - r.top,
        w: tr.width,
        h: tr.height,
        lines: rg.getClientRects().length
      };
    };
  }

  // kits/capture/settle.ts
  var SETTLE_MS = 300;
  var POLL_MS = 50;
  var NO_MOTION = "*,*::before,*::after{transition:none!important;animation:none!important}";
  var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function waitImages(doc, timeoutMs) {
    const pending = [...doc.images].filter((im) => !im.complete);
    await Promise.race([
      Promise.all(
        pending.map(
          (im) => new Promise((r) => {
            im.onload = im.onerror = r;
          })
        )
      ),
      sleep(timeoutMs)
    ]);
    return [...doc.images].filter((im) => !im.complete).length;
  }
  async function settle(env, options) {
    const { doc } = env;
    for (const im of doc.querySelectorAll("img[loading=lazy]"))
      im.loading = "eager";
    await doc.fonts.ready;
    await sleep(SETTLE_MS);
    const st = doc.createElement("style");
    st.textContent = NO_MOTION;
    doc.head.appendChild(st);
    await waitImages(doc, options.imgTimeoutMs);
    for (const v of [...doc.querySelectorAll("video[poster]")]) {
      const im = doc.createElement("img");
      im.className = v.className;
      im.setAttribute("style", v.getAttribute("style") || "");
      im.alt = "";
      im.src = v.poster;
      v.replaceWith(im);
    }
    return { pendingImages: await waitImages(doc, options.imgTimeoutMs) };
  }
  function strip(doc, selectors, hideScrollbar) {
    let removed = 0;
    for (const sel of selectors)
      for (const n of doc.querySelectorAll(sel)) {
        n.remove();
        removed++;
      }
    if (hideScrollbar) doc.documentElement.style.scrollbarWidth = "none";
    return removed;
  }
  async function backgrounds(env) {
    const { win, doc, bg } = env;
    bg.clear();
    for (const el of doc.body.querySelectorAll("*")) {
      const m = /url\((["']?)(.*?)\1\)/.exec(
        win.getComputedStyle(el).backgroundImage
      );
      if (!m) continue;
      const im = new Image();
      im.src = new URL(m[2], win.location.href).href;
      try {
        await im.decode();
        bg.set(el, im);
      } catch {
      }
    }
  }
  async function until(check, timeoutMs) {
    const t0 = performance.now();
    for (; ; ) {
      if (await check()) return true;
      if (performance.now() - t0 >= timeoutMs) return false;
      await sleep(POLL_MS);
    }
  }

  // kits/capture/values.ts
  function createValues(doc) {
    const cv = doc.createElement("canvas");
    cv.width = cv.height = 1;
    const cx = cv.getContext("2d", {
      willReadFrequently: true
    });
    const color = (c) => {
      if (!c || c === "transparent" || c === "rgba(0, 0, 0, 0)") return null;
      cx.clearRect(0, 0, 1, 1);
      cx.fillStyle = "#000";
      cx.fillStyle = c;
      cx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = cx.getImageData(0, 0, 1, 1).data;
      if (a === 0) return null;
      let alpha = 1;
      const inner = (/\(([^)]*)\)\s*$/.exec(c) || [])[1] || "";
      let am = null;
      if (inner.includes("/")) am = inner.split("/").pop().trim();
      else if (inner.split(",").length === 4)
        am = inner.split(",").pop().trim();
      if (am) alpha = am.endsWith("%") ? parseFloat(am) / 100 : parseFloat(am);
      if (alpha < 1) {
        const o = inner.includes("/") ? c.replace(/\/\s*[\d.]+%?\s*\)$/, ")") : c.replace(/^rgba\((.*),[^,]*\)$/, "rgb($1)");
        cx.clearRect(0, 0, 1, 1);
        cx.fillStyle = "#000";
        cx.fillStyle = o;
        cx.fillRect(0, 0, 1, 1);
        const d = cx.getImageData(0, 0, 1, 1).data;
        return [d[0], d[1], d[2], alpha];
      }
      return [r, g, b, alpha];
    };
    const font = (cs, c) => ({
      fam: cs.fontFamily,
      size: px(cs.fontSize),
      weight: cs.fontWeight,
      lh: cs.lineHeight,
      ls: cs.letterSpacing,
      tt: cs.textTransform,
      td: cs.textDecorationLine,
      fs: cs.fontStyle,
      ta: cs.textAlign,
      ws: cs.whiteSpace,
      color: c === void 0 ? color(cs.color) : c
    });
    const mctx = doc.createElement("canvas").getContext("2d");
    const measureText = (txt, cs) => {
      mctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
      mctx.letterSpacing = cs.letterSpacing === "normal" ? "0px" : cs.letterSpacing;
      return mctx.measureText(txt).width;
    };
    const lineHeight = (cs) => cs.lineHeight === "normal" ? px(cs.fontSize) * 1.25 : px(cs.lineHeight);
    return { color, font, measureText, lineHeight };
  }

  // kits/capture/walk.ts
  function makeNode(env, ignore) {
    const { win } = env;
    const node = (el, parentRect) => {
      if (ignore(el)) return null;
      const cs = win.getComputedStyle(el);
      if (!isRendered(cs)) return null;
      if (cs.display === "contents") {
        const c = contentsBox(el);
        if (!c) return null;
        const { box: b, children } = c;
        const className = el.className;
        return {
          ...FRAME0(),
          tag: el.tagName.toLowerCase(),
          cls: typeof className === "string" ? className : "",
          x: b.left - (parentRect ? parentRect.left : 0),
          y: b.top - (parentRect ? parentRect.top : 0),
          w: b.width,
          h: b.height,
          font: env.v.font(cs),
          kids: children.map((ch) => node(ch, b)).filter((k) => k !== null)
        };
      }
      const r = el.getBoundingClientRect();
      if (!isVisible(el, cs, r, env)) return null;
      const tag = el.tagName.toLowerCase();
      const base = box(el, cs, r, parentRect);
      if (onTop(el, cs, r, env)) base.top = true;
      const input = el;
      if (tag === "input" && (input.type === "checkbox" || input.type === "radio"))
        return nativeControl(input, cs, base, env);
      const img = image(el, cs, r, base, tag, env);
      if (img !== void 0) return img;
      if (tag === "svg") return svg(el, cs, r, base, base.cls, env);
      const tri = cssTriangle(el, cs, r, base, env);
      if (tri) return tri;
      const n = {
        ...base,
        t: "frame",
        ...layout(cs),
        ...appearance(cs, r, env),
        kids: []
      };
      const kids = n.kids;
      const bgImg = env.bg.get(el);
      if (bgImg) {
        const raster = backgroundImage(el, cs, bgImg, r.width, r.height, env);
        if (raster) kids.push(raster);
      }
      const bef = pseudo(el, "::before", env);
      if (bef) kids.push(bef);
      const marks = marker(el, cs, r, tag, env);
      if (marks.first) kids.unshift(marks.first);
      if (marks.last) kids.push(marks.last);
      if (tag === "input" || tag === "textarea" || tag === "select") {
        kids.push(...control(el, cs, tag, env));
        if (tag === "textarea") n.va = "top";
        if (input.type === "date" || input.type === "month")
          Object.assign(n, {
            disp: "flex",
            dir: "row",
            jc: "space-between",
            ai: "center"
          });
        return n;
      }
      const textOf = text(el, r, cs, env);
      for (const ch of el.childNodes) {
        if (ch.nodeType === 3) {
          const t = textOf(ch);
          if (t) kids.push(t);
        } else if (ch.nodeType === 1 && !SKIPPED_TAGS.includes(ch.tagName.toUpperCase())) {
          const k = node(ch, r);
          if (k) kids.push(k);
        }
      }
      const aft = pseudo(el, "::after", env);
      if (aft) kids.push(aft);
      return n;
    };
    return node;
  }
  function roots(doc, pick) {
    if (pick) {
      const el = doc.querySelector(pick);
      return el ? [el] : [];
    }
    return [...doc.body.children].filter(
      (e) => !SKIPPED_TAGS.includes(e.tagName)
    );
  }
  function paths(nodes, prefix = "") {
    const seen = /* @__PURE__ */ new Map();
    for (const n of nodes) {
      const key = n.t === "text" ? "#text" : n.tag ?? n.t;
      const i = seen.get(key) ?? 0;
      seen.set(key, i + 1);
      n.path = prefix ? `${prefix}/${key}[${i}]` : `${key}[${i}]`;
      if (n.kids) paths(n.kids, n.path);
    }
    return nodes;
  }
  function walk(elements, node) {
    return paths(
      elements.map((e) => node(e, null)).filter((n) => n !== null)
    );
  }

  // kits/capture/capturer.ts
  var CAPTURE_KIT = "capture-kit@1";
  var HOOKS_CONTRACT = "capture@1";
  var KIT_PIECES = {
    px,
    luminance,
    shadows,
    gradient,
    splitTop,
    ...pieces_exports,
    settle,
    backgrounds,
    strip,
    until,
    sleep,
    makeNode,
    roots,
    walk,
    paths,
    createValues
  };
  var HOOK_NAMES = ["prepare", "ready", "ignore"];
  function createCapturer(win) {
    const doc = win.document;
    const values = createValues(doc);
    let hooks = {};
    const evaluateInPage = (expression) => {
      const attr = `data-capture-kit-${Math.random().toString(36).slice(2)}`;
      const s = doc.createElement("script");
      s.textContent = `document.documentElement.setAttribute(${JSON.stringify(attr)}, JSON.stringify((() => (${expression}))() ?? null))`;
      doc.documentElement.appendChild(s);
      s.remove();
      const raw = doc.documentElement.getAttribute(attr);
      doc.documentElement.removeAttribute(attr);
      return raw === null ? void 0 : JSON.parse(raw);
    };
    const ctxFor = (t) => ({
      kit: KIT_PIECES,
      page: {
        document: doc,
        window: win,
        url: win.location.href,
        ...t.allowPageWorld ? { evaluateInPage } : {}
      },
      screen: t.screen,
      variant: t.variant
    });
    return {
      contract: CAPTURE_KIT,
      pieces: KIT_PIECES,
      // El módulo de ganchos del proyecto: { contract: "capture@1", hooks: { prepare?, ready?, ignore? } }
      useHooks(module) {
        const m = module;
        if (!m || typeof m !== "object" || m.contract !== HOOKS_CONTRACT)
          return `el módulo de ganchos no es { contract: "${HOOKS_CONTRACT}", hooks }`;
        const h = m.hooks ?? {};
        const unknownHook = Object.keys(h).find(
          (k) => !HOOK_NAMES.includes(k) || typeof h[k] !== "function"
        );
        if (unknownHook !== void 0)
          return `gancho desconocido o que no es una función: «${unknownHook}» (valen ${HOOK_NAMES.join(", ")})`;
        hooks = h;
        return null;
      },
      // Una vez por captura, en la primera página y tras el login
      async prepare(t) {
        await hooks.prepare?.(ctxFor(t));
      },
      // Tras cargar cada variante: settle → ready → strip
      async ready(o) {
        const env = { win, doc, v: values, bg: /* @__PURE__ */ new Map(), imgHi: true };
        const { pendingImages } = await settle(env, {
          imgTimeoutMs: o.imgTimeoutMs
        });
        await hooks.ready?.(ctxFor(o));
        strip(doc, o.strip, o.hideScrollbar);
        const warnings = [];
        if (pendingImages > 0)
          warnings.push({
            message: `${pendingImages} imágenes sin cargar al acabar la espera`
          });
        return { warnings };
      },
      // Un clic en el DOM (llega a la app aunque se lance desde el mundo aislado)
      click(selector) {
        const el = doc.querySelector(selector);
        if (!el) return false;
        el.click();
        return true;
      },
      async capture(o) {
        const env = {
          win,
          doc,
          v: values,
          bg: /* @__PURE__ */ new Map(),
          imgHi: o.imgHi
        };
        await backgrounds(env);
        win.scrollTo(0, 0);
        const ctx = ctxFor(o);
        const ignore = hooks.ignore;
        const node = makeNode(
          env,
          ignore ? (el) => !!ignore(el, ctx) : () => false
        );
        const elements = roots(doc, o.pick);
        const warnings = [];
        if (o.pick && elements.length === 0)
          warnings.push({
            message: `pick «${o.pick}» no encuentra ningún elemento`
          });
        return { nodes: walk(elements, node), warnings };
      }
    };
  }

  // kits/capture/index.ts
  var KIT_GLOBAL = "__figmaCaptureKit";
  var scope = globalThis;
  if (scope[KIT_GLOBAL] === void 0) scope[KIT_GLOBAL] = createCapturer(window);
})();
