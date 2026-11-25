async () => {
  // Revisión estructural: textos que se pisan (caja de línea + glifos, recortadas por sus contenedores con clip),
  // contenedores colapsados y columnas de tabla desalineadas. Cajas calculadas una vez; barrido por y.
  const AREAS = window.__CHK_AREAS || ['Web', 'Registro', 'App', 'Admin', 'Soporte'];
  const ov = (A, B) => [Math.min(A.x + A.width, B.x + B.width) - Math.max(A.x, B.x), Math.min(A.y + A.height, B.y + B.height) - Math.max(A.y, B.y)];
  const out = {};
  for (const pn of AREAS) {
    const P = figma.root.children.find(p => p.name.trim() === pn); await P.loadAsync();
    for (const f of P.children.filter(x => x.type === 'FRAME')) {
      const items = [];
      const walk = (n, clip) => {
        if (!n.visible || n.opacity === 0) return;
        if (n.type === 'TEXT') { if (!n.characters.trim()) return; const cut = b => { if (!b) return null; if (!clip) return b; const x = Math.max(b.x, clip.x), y = Math.max(b.y, clip.y); const r = { x, y, width: Math.min(b.x + b.width, clip.x + clip.width) - x, height: Math.min(b.y + b.height, clip.y + clip.height) - y }; return r.width > 0 && r.height > 0 ? r : null; }; const bb = cut(n.absoluteBoundingBox), rb = cut(n.absoluteRenderBounds); if (bb && rb) items.push({ n, bb, rb }); return; }
        if (!('children' in n)) return;
        let c = clip; if (n !== f && n.clipsContent) { const b = n.absoluteBoundingBox; if (!c) c = b; else { const x = Math.max(c.x, b.x), y = Math.max(c.y, b.y); c = { x, y, width: Math.min(c.x + c.width, b.x + b.width) - x, height: Math.min(c.y + c.height, b.y + b.height) - y }; if (c.width <= 0 || c.height <= 0) return; } }
        for (const k of n.children) walk(k, c);
      };
      walk(f, null);
      items.sort((a, b) => a.bb.y - b.bb.y);
      const bad = [];
      for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length && items[j].bb.y < items[i].bb.y + items[i].bb.height; j++) {
        const [bx, by] = ov(items[i].bb, items[j].bb); if (bx <= 2 || by <= 4) continue;
        const [rx, ry] = ov(items[i].rb, items[j].rb); if (rx <= 0 || ry <= 0) continue;
        bad.push(items[i].n.characters.trim().slice(0, 20) + ' ✕ ' + items[j].n.characters.trim().slice(0, 20));
      }
      const narrow = f.findAll(n => (n.type === 'FRAME' || n.type === 'INSTANCE') && n.width <= 4 && n.children && n.children.some(k => k.width > 40)).length;
      let cols = 0; for (const tb of f.findAll(n => n.type === 'FRAME' && (n.name === 'tbody' || n.name === 'cuerpo de tabla'))) { const rows = tb.children.filter(r => (r.name === 'tr' || r.name === 'fila de tabla') && r.visible); if (rows.length < 2) continue; const ref = rows[0].children.map(c => Math.round(c.x)); for (const r of rows.slice(1)) { const xs = r.children.map(c => Math.round(c.x)); if (xs.length !== ref.length || xs.some((x, i) => Math.abs(x - ref[i]) > 1)) cols++; } }
      if (bad.length || narrow || cols) out[pn + ' / ' + f.name] = `solapes=${bad.length} colapsos=${narrow} filas-desalineadas=${cols} ` + bad.slice(0, 4).join(' | ');
    }
  }
  return out;
}
