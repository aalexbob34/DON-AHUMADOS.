// Utilidades compartidas del Worker.
export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

export const J = (s, d = []) => { try { return JSON.parse(s); } catch { return d; } };
export const str = (v, max = 500) => String(v ?? '').trim().slice(0, max);
export const int = (v, d = 0) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? n : d; };
export const isEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
export const escHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const slugify = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'item';

const toHex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (h) => new Uint8Array(h.match(/.{2}/g).map((x) => parseInt(x, 16)));
export const randomHex = (bytes) => toHex(crypto.getRandomValues(new Uint8Array(bytes)));
export async function sha256Hex(text) { return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))); }

// Contraseñas con PBKDF2-SHA256 (WebCrypto). Cloudflare limita las iteraciones a 100.000.
export async function hashPassword(password, saltHex, iterations) {
  const it = Math.min(100000, Math.max(1000, Number(iterations) || 100000));
  const salt = saltHex ? fromHex(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: it }, key, 256);
  return { hash: `pbkdf2$${it}$${toHex(new Uint8Array(bits))}`, salt: toHex(salt) };
}
export async function verifyPassword(password, stored, saltHex) {
  const [, it, hex] = String(stored).split('$');
  const { hash } = await hashPassword(password, saltHex, it);
  const a = hash.split('$')[2], b = hex || '';
  if (a.length !== b.length) return false;
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Reconoce el tipo real de imagen por sus primeros bytes (no confía en el nombre ni en el tipo declarado).
export function sniffImage(u8) {
  if (u8.length > 3 && u8[0] === 0xff && u8[1] === 0xd8 && u8[2] === 0xff) return { type: 'image/jpeg', ext: 'jpg' };
  if (u8.length > 8 && u8[0] === 0x89 && u8[1] === 0x50 && u8[2] === 0x4e && u8[3] === 0x47) return { type: 'image/png', ext: 'png' };
  if (u8.length > 12 && String.fromCharCode(...u8.slice(0, 4)) === 'RIFF' && String.fromCharCode(...u8.slice(8, 12)) === 'WEBP') return { type: 'image/webp', ext: 'webp' };
  return null;
}
