'use strict';
// Colores de la tienda a partir del fondo y el acento elegidos en el panel. Se usa en el navegador, en el panel y en el servidor.
(function (root) {
  const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const toHex = (a) => '#' + a.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, t) => { const A = hex(a), B = hex(b); return toHex(A.map((v, i) => v + (B[i] - v) * t)); };
  const lum = (h) => { const [r, g, b] = hex(h).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ok = (v, d) => (/^#[0-9a-f]{6}$/i.test(v || '') ? v : d);
  function themeVars(bg, accent) {
    bg = ok(bg, '#0B1F25'); accent = ok(accent, '#E8772E');
    if (lum(bg) < 0.4) {
      const base = bg.toLowerCase() === '#0b1f25';
      return { '--bg': bg, '--bg2': base ? '#07161A' : mix(bg, '#000000', 0.35), '--surface': base ? '#112C34' : mix(bg, '#ffffff', 0.07), '--surface2': base ? '#173A44' : mix(bg, '#ffffff', 0.14),
        '--line': 'rgba(243,237,226,.12)', '--text': '#F3EDE2', '--muted': '#9DB3B8', '--soft': '#CBD9DC', '--accent': accent, '--accent2': mix(accent, '#ffffff', 0.16), '--ink': '#1B120A' };
    }
    return { '--bg': bg, '--bg2': mix(bg, '#000000', 0.05), '--surface': mix(bg, '#ffffff', 0.6), '--surface2': mix(bg, '#000000', 0.07),
      '--line': 'rgba(27,18,10,.14)', '--text': '#1B120A', '--muted': '#5E6E72', '--soft': '#3E4E52', '--accent': accent, '--accent2': mix(accent, '#000000', 0.14), '--ink': '#1B120A' };
  }
  const api = { themeVars, mix, lum, ok };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.DATheme = api;
})(typeof window !== 'undefined' ? window : globalThis);
