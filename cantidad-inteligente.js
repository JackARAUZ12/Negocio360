/* ============================================================
   CANTIDAD INTELIGENTE — Negocio360
   Ayuda a escribir cantidades fraccionadas de forma natural:
     · fracciones y operaciones: 1/4, 3/4, 1 1/2, 1/2/2 (la mitad de la
       mitad), 1/2 de 1/2, 300/3, "media", "un cuarto", "tres cuartos"…
     · "pedir en otra unidad": si el producto trae su contenido
       (1 rollo = 300 m), 100 m se convierte en 100/300 de rollo.
   Solo calcula números; nunca guarda ni cambia nada por sí mismo.
   ============================================================ */
(function () {
  const UNICODE = { '¼': ' 1/4', '½': ' 1/2', '¾': ' 3/4', '⅓': ' 1/3', '⅔': ' 2/3', '⅛': ' 1/8', '⅜': ' 3/8', '⅝': ' 5/8', '⅞': ' 7/8' };

  function normalizar(texto) {
    let t = String(texto == null ? '' : texto).toLowerCase().trim();
    if (!t) return '';
    t = t.normalize('NFC');
    Object.keys(UNICODE).forEach(k => { t = t.split(k).join(UNICODE[k]); });
    t = t.replace(/,/g, '.');
    // palabras habituales
    t = t.replace(/\btres cuartos\b/g, '3/4').replace(/\bdos tercios\b/g, '2/3')
         .replace(/\b(un|una)\s+(cuarto|cuarta)\b/g, '1/4').replace(/\b(cuarto|cuarta)\b/g, '1/4')
         .replace(/\b(un|una)\s+tercio\b/g, '1/3').replace(/\btercio\b/g, '1/3')
         .replace(/\b(un|una)\s+octavo\b/g, '1/8').replace(/\boctavo\b/g, '1/8')
         .replace(/\b(media|medio)\b/g, '1/2')
         .replace(/\s+y\s+/g, ' ')            // "1 y 1/2"
         .replace(/\bde\b/g, '*')             // "1/2 de 1/2"
         .replace(/[x×]/g, '*');
    return t.trim();
  }

  // Evalúa una cadena de números unidos por * y / (de izquierda a derecha).
  function cadena(str) {
    const tokens = str.match(/\d+(?:\.\d+)?|\.\d+|[*\/]/g);
    if (!tokens) return null;
    if (tokens.join('').replace(/\s/g, '') !== str.replace(/\s/g, '')) return null;
    let acc = null, op = null;
    for (const tk of tokens) {
      if (tk === '*' || tk === '/') { if (acc === null || op) return null; op = tk; continue; }
      const n = parseFloat(tk);
      if (acc === null) acc = n;
      else if (op === '*') acc *= n;
      else if (op === '/') { if (n === 0) return null; acc /= n; }
      else return null;
      op = null;
    }
    return op ? null : acc;
  }

  function termino(str) {
    str = str.trim();
    if (!str) return null;
    // número mixto: "1 1/2"
    const m = str.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);
    if (m) { const d = parseFloat(m[3]); return d === 0 ? null : parseFloat(m[1]) + parseFloat(m[2]) / d; }
    return cadena(str.replace(/\s+/g, ''));
  }

  // Devuelve un número > 0 (máx. 6 decimales) o null si no se entiende.
  function parse(texto) {
    const t = normalizar(texto);
    if (!t) return null;
    if (!/^[\d\s.\/*+]+$/.test(t)) return null;
    let total = 0;
    for (const parte of t.split('+')) {
      const v = termino(parte);
      if (v === null || !isFinite(v)) return null;
      total += v;
    }
    if (!(total > 0) || total > 1e9) return null;
    return Math.round(total * 1e6) / 1e6;
  }

  function redondear(n, dec) { const f = Math.pow(10, dec == null ? 6 : dec); return Math.round((Number(n) || 0) * f) / f; }

  // 0.25 -> "¼", 1.5 -> "1½"; si no es una fracción común devuelve el decimal.
  function bonito(n) {
    const f = { 0.25: '¼', 0.5: '½', 0.75: '¾', 0.333: '⅓', 0.667: '⅔', 0.125: '⅛' };
    const x = Number(n) || 0, ent = Math.floor(x + 1e-9), dec = Math.round((x - ent) * 1000) / 1000;
    if (dec === 0) return String(ent);
    const sim = f[dec] || f[Math.round(dec * 1000) / 1000];
    if (sim) return (ent ? ent : '') + sim;
    return String(redondear(x, 3));
  }

  // Cantidad de venta (en la unidad del producto) a partir de lo que pide el cliente en la unidad del contenido.
  function desdePedido(pedido, contenido) {
    const p = Number(pedido), c = Number(contenido);
    if (!(p > 0) || !(c > 0)) return null;
    return redondear(p / c, 6);
  }

  window.N360Cant = { parse, bonito, redondear, desdePedido };
})();
