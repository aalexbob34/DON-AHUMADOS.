// Tienda Don Ahumados en Cloudflare Workers: API + páginas con SEO. Base de datos D1, fotos en R2, archivos estáticos en Assets.
import { Hono } from 'hono';
import DATheme from '../public/js/theme.js';
import { HttpError, J, str, int, isEmail, escHtml, slugify, randomHex, sha256Hex, hashPassword, verifyPassword, sniffImage } from './lib.js';
import { seedIfEmpty, ensureAdmin } from './seed.js';

const app = new Hono();
const STATUSES = ['pendiente', 'confirmado', 'preparando', 'enviado', 'entregado', 'cancelado'];
const PAY_METHODS = ['wompi', 'transferencia', 'contraentrega', 'whatsapp'];
const CSP = "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self'; frame-ancestors 'self'; form-action 'self' https://checkout.wompi.co";

// ---------- acceso a datos ----------
const all = async (c, sql, ...a) => (await c.env.DB.prepare(sql).bind(...a).all()).results;
const one = (c, sql, ...a) => c.env.DB.prepare(sql).bind(...a).first();
const exec = (c, sql, ...a) => c.env.DB.prepare(sql).bind(...a).run();
const st = (c, sql, ...a) => c.env.DB.prepare(sql).bind(...a);
const batch = (c, list) => c.env.DB.batch(list);
const body = async (c) => { try { return (await c.req.json()) || {}; } catch { return {}; } };
async function settingsMap(c) { const s = {}; (await all(c, 'SELECT key,value FROM settings')).forEach((r) => { s[r.key] = r.value; }); return s; }
const getSetting = async (c, k, d = '') => { const r = await one(c, 'SELECT value FROM settings WHERE key=?', k); return r ? r.value : d; };
const wompiOn = (env) => !!(env.WOMPI_PUBLIC_KEY && env.WOMPI_INTEGRITY_SECRET);
const siteUrl = (c) => String(c.env.SITE_URL || new URL(c.req.url).origin).replace(/\/$/, '');

// ---------- inicio: tablas, datos de ejemplo y administrador (una vez por instancia) ----------
let readyP = null;
const ready = (env) => (readyP ||= (async () => { await seedIfEmpty(env); await ensureAdmin(env); })().catch((e) => { readyP = null; throw e; }));

app.use('*', async (c, next) => {
  await ready(c.env);
  await next();
  const r = new Response(c.res.body, c.res); // copia para poder agregar cabeceras
  r.headers.set('Content-Security-Policy', CSP); r.headers.set('X-Content-Type-Options', 'nosniff'); r.headers.set('X-Frame-Options', 'SAMEORIGIN'); r.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  c.res = r;
});

// ---------- sesiones ----------
const cookies = (c) => Object.fromEntries((c.req.header('cookie') || '').split(';').map((p) => { const i = p.indexOf('='); return i > 0 ? [p.slice(0, i).trim(), decodeURIComponent(p.slice(i + 1).trim())] : null; }).filter(Boolean));
async function createSession(c, userId) {
  const token = randomHex(32); const days = 14;
  await exec(c, 'INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)', token, userId, Date.now() + days * 864e5);
  const secure = new URL(c.req.url).protocol === 'https:' ? '; Secure' : '';
  c.header('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${days * 86400}${secure}`, { append: true });
}
app.use('/api/*', async (c, next) => {
  const t = cookies(c).sid; let user = null;
  if (t) {
    const s = await one(c, 'SELECT s.expires, u.id, u.name, u.email, u.phone, u.address, u.city, u.role FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?', t);
    if (s && s.expires > Date.now()) user = { id: s.id, name: s.name, email: s.email, phone: s.phone, address: s.address, city: s.city, role: s.role };
  }
  c.set('user', user); await next();
});
const requireUser = async (c, next) => (c.get('user') ? next() : c.json({ error: 'Debes iniciar sesión.' }, 401));
const requireAdmin = async (c, next) => (c.get('user') && c.get('user').role === 'admin' ? next() : c.json({ error: 'Acceso restringido al administrador.' }, 403));

// límite de intentos (por instancia del Worker; frena abusos básicos)
const hits = new Map();
const rateLimit = (max, windowMs) => async (c, next) => {
  const k = (c.req.header('cf-connecting-ip') || 'local') + new URL(c.req.url).pathname; const now = Date.now();
  const arr = (hits.get(k) || []).filter((t) => now - t < windowMs);
  if (arr.length >= max) return c.json({ error: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.' }, 429);
  arr.push(now); hits.set(k, arr); if (hits.size > 5000) hits.clear(); await next();
};

// ---------- productos ----------
const PROD_SELECT = 'SELECT p.*, c.name category_name, c.slug category_slug FROM products p LEFT JOIN categories c ON c.id=p.category_id';
async function hydrateMany(c, rows, full = false) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id); const ph = ids.map(() => '?').join(',');
  const imgs = await all(c, `SELECT product_id,url FROM product_images WHERE product_id IN (${ph}) ORDER BY sort,id`, ...ids);
  const vars = await all(c, `SELECT id,product_id,name,price,stock FROM variants WHERE product_id IN (${ph}) ORDER BY price,id`, ...ids);
  return rows.map((p) => {
    const images = imgs.filter((i) => i.product_id === p.id).map((i) => i.url);
    const variants = vars.filter((v) => v.product_id === p.id).map(({ id, name, price, stock }) => ({ id, name, price, stock }));
    const stock = variants.length ? variants.reduce((a, v) => a + v.stock, 0) : p.stock;
    const out = { id: p.id, slug: p.slug, name: p.name, category_id: p.category_id, category: p.category_name || '', category_slug: p.category_slug || '', short_desc: p.short_desc,
      price: variants.length ? Math.min(...variants.map((v) => v.price)) : p.price, compare_price: p.compare_price, images, variants, stock, available: stock > 0, featured: !!p.featured, is_new: !!p.is_new, sales_count: p.sales_count };
    if (full) Object.assign(out, { description: p.description, features: J(p.features), benefits: J(p.benefits), specs: J(p.specs), usage: p.usage, faqs: J(p.faqs), recommendations: p.recommendations, weight_g: p.weight_g, active: !!p.active });
    return out;
  });
}

app.get('/api/settings', async (c) => {
  const s = await settingsMap(c); delete s.bank_info; s.benefits = J(s.benefits); s.payments = { wompi: wompiOn(c.env) };
  s.banner = (await one(c, "SELECT code,title,type,value,min_amount FROM promotions WHERE active=1 AND show_banner=1 AND (starts='' OR starts<=date('now')) AND (ends='' OR ends>=date('now')) LIMIT 1")) || null;
  return c.json(s);
});
app.get('/api/categories', async (c) => c.json(await all(c, 'SELECT c.id,c.name,c.slug,c.description,c.image,(SELECT COUNT(*) FROM products p WHERE p.category_id=c.id AND p.active=1) count FROM categories c ORDER BY sort,id')));
app.get('/api/testimonials', async (c) => c.json(await all(c, 'SELECT name,text,rating FROM testimonials WHERE active=1 ORDER BY id DESC')));

app.get('/api/products', async (c) => {
  const where = ['p.active=1']; const args = []; const qs = c.req.query();
  const q = str(qs.q, 80);
  if (q) { where.push('(p.name LIKE ? OR p.short_desc LIKE ? OR p.description LIKE ?)'); args.push(`%${q}%`, `%${q}%`, `%${q}%`); }
  if (qs.category) { where.push('c.slug=?'); args.push(str(qs.category, 80)); }
  if (qs.featured) where.push('p.featured=1');
  if (qs.new) where.push('p.is_new=1');
  const order = { price_asc: 'p.price ASC', price_desc: 'p.price DESC', popular: 'p.sales_count DESC, p.id DESC', new: 'p.id DESC' }[qs.sort] || 'p.featured DESC, p.id DESC';
  const limit = Math.min(Math.max(int(qs.limit, 60), 1), 90);
  return c.json(await hydrateMany(c, await all(c, `${PROD_SELECT} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ${limit}`, ...args)));
});
app.get('/api/products/:slug', async (c) => {
  const p = await one(c, `${PROD_SELECT} WHERE p.slug=? AND p.active=1`, c.req.param('slug'));
  if (!p) return c.json({ error: 'Producto no encontrado.' }, 404);
  const [out] = await hydrateMany(c, [p], true);
  out.related = await hydrateMany(c, await all(c, `${PROD_SELECT} WHERE p.active=1 AND p.id<>? ORDER BY (p.category_id=?) DESC, p.sales_count DESC LIMIT 4`, p.id, p.category_id ?? -1));
  return c.json(out);
});

// ---------- cuentas ----------
app.post('/api/auth/register', rateLimit(10, 3600000), async (c) => {
  const b = await body(c); const name = str(b.name, 80), email = str(b.email, 120).toLowerCase(), pass = String(b.password || '');
  if (name.length < 2) return c.json({ error: 'Escribe tu nombre.' }, 400);
  if (!isEmail(email)) return c.json({ error: 'Correo no válido.' }, 400);
  if (pass.length < 8) return c.json({ error: 'La contraseña debe tener al menos 8 caracteres.' }, 400);
  if (await one(c, 'SELECT 1 x FROM users WHERE email=?', email)) return c.json({ error: 'Ya existe una cuenta con ese correo.' }, 409);
  const { hash, salt } = await hashPassword(pass, null, c.env.PBKDF2_ITERATIONS);
  const r = await exec(c, 'INSERT INTO users(name,email,phone,city,address,pass_hash,salt) VALUES(?,?,?,?,?,?,?)', name, email, str(b.phone, 30), str(b.city, 60), str(b.address, 200), hash, salt);
  await createSession(c, r.meta.last_row_id); return c.json({ ok: true });
});
app.post('/api/auth/login', rateLimit(10, 600000), async (c) => {
  const b = await body(c); const u = await one(c, 'SELECT * FROM users WHERE email=?', str(b.email, 120).toLowerCase());
  if (!u || !(await verifyPassword(String(b.password || ''), u.pass_hash, u.salt))) return c.json({ error: 'Credenciales incorrectas.' }, 401);
  await createSession(c, u.id); return c.json({ ok: true, role: u.role });
});
app.post('/api/auth/logout', async (c) => {
  const t = cookies(c).sid; if (t) await exec(c, 'DELETE FROM sessions WHERE token=?', t);
  c.header('Set-Cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0', { append: true }); return c.json({ ok: true });
});
app.get('/api/me', (c) => c.json({ user: c.get('user') }));
app.put('/api/me', requireUser, async (c) => {
  const b = await body(c); const u = c.get('user');
  await exec(c, 'UPDATE users SET name=?,phone=?,city=?,address=? WHERE id=?', str(b.name, 80) || u.name, str(b.phone, 30), str(b.city, 60), str(b.address, 200), u.id);
  if (b.password) {
    if (String(b.password).length < 8) return c.json({ error: 'La contraseña debe tener al menos 8 caracteres.' }, 400);
    const { hash, salt } = await hashPassword(String(b.password), null, c.env.PBKDF2_ITERATIONS);
    await exec(c, 'UPDATE users SET pass_hash=?,salt=? WHERE id=?', hash, salt, u.id);
  }
  return c.json({ ok: true });
});

// ---------- carrito, envío y cupones ----------
async function resolveItems(c, items) {
  if (!Array.isArray(items) || !items.length) throw new HttpError(400, 'Tu carrito está vacío.');
  if (items.length > 40) throw new HttpError(400, 'Demasiados productos.');
  const out = [];
  for (const it of items) {
    const p = await one(c, 'SELECT * FROM products WHERE id=? AND active=1', int(it.productId));
    if (!p) throw new HttpError(400, 'Un producto de tu carrito ya no está disponible.');
    const qty = Math.max(1, Math.min(int(it.qty, 1), 99));
    const hasVar = (await one(c, 'SELECT COUNT(*) c FROM variants WHERE product_id=?', p.id)).c > 0;
    let price = p.price, stock = p.stock, vname = '', vid = null, weight = p.weight_g;
    if (hasVar) {
      const v = await one(c, 'SELECT * FROM variants WHERE id=? AND product_id=?', int(it.variantId), p.id);
      if (!v) throw new HttpError(400, `Elige una presentación para ${p.name}.`);
      price = v.price; stock = v.stock; vname = v.name; vid = v.id; weight = v.weight_g || p.weight_g;
    }
    if (stock < qty) throw new HttpError(409, `Solo quedan ${stock} unidades de ${p.name}${vname ? ' (' + vname + ')' : ''}.`);
    out.push({ product_id: p.id, variant_id: vid, name: p.name, variant_name: vname, price, qty, weight, note: str(it.note, 200) });
  }
  return out;
}
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
async function shippingFor(c, city, subtotal) {
  const zones = await all(c, 'SELECT * FROM shipping_zones ORDER BY id');
  let zone = zones.find((z) => z.cities !== '*' && z.cities.split(',').some((x) => norm(x) === norm(city))) || zones.find((z) => z.cities === '*') || zones[0];
  if (!zone) return { fee: 0, zone: 'Envío', eta: '' };
  const free = zone.free_over > 0 && subtotal >= zone.free_over;
  return { fee: free ? 0 : zone.fee, zone: zone.name, eta: zone.eta, free };
}
async function applyCoupon(c, code, subtotal) {
  code = str(code, 40).toUpperCase(); if (!code) return { discount: 0, code: '' };
  const p = await one(c, "SELECT * FROM promotions WHERE code=? AND active=1 AND (starts='' OR starts<=date('now')) AND (ends='' OR ends>=date('now'))", code);
  if (!p) throw new HttpError(400, 'El cupón no es válido o ya venció.');
  if (subtotal < p.min_amount) throw new HttpError(400, `Este cupón aplica para compras desde $${p.min_amount.toLocaleString('es-CO')}.`);
  return { discount: p.type === 'percent' ? Math.round(subtotal * p.value / 100) : Math.min(p.value, subtotal), code: p.code, title: p.title };
}
app.post('/api/cart/quote', async (c) => {
  const b = await body(c); const items = await resolveItems(c, b.items);
  const subtotal = items.reduce((a, i) => a + i.price * i.qty, 0);
  const coupon = b.coupon ? await applyCoupon(c, b.coupon, subtotal) : { discount: 0, code: '' };
  const ship = b.delivery_type === 'retiro' ? { fee: 0, zone: 'Retiro en el local', eta: 'Te avisamos cuando esté listo' } : await shippingFor(c, b.city, subtotal - coupon.discount);
  return c.json({ items, subtotal, discount: coupon.discount, coupon: coupon.code, shipping: ship.fee, shipping_zone: ship.zone, eta: ship.eta, total: subtotal - coupon.discount + ship.fee });
});

// ---------- pedidos ----------
const orderCode = () => 'DA-' + randomHex(4).toUpperCase();
async function orderFull(c, o) { o.items = await all(c, 'SELECT name,variant_name,note,price,qty FROM order_items WHERE order_id=?', o.id); return o; }
function waLink(number, order) {
  const lines = order.items.map((i) => `• ${i.qty} x ${i.name}${i.variant_name ? ' (' + i.variant_name + ')' : ''}${i.note ? '\n   Nota: ' + i.note : ''}`).join('\n');
  const entrega = order.delivery_type === 'retiro' ? 'Retiro en el local' : `Delivery: ${order.address}, ${order.city}`;
  const text = `Hola Don Ahumados, hice el pedido ${order.code}.\n${lines}\nEntrega: ${entrega}${order.schedule ? '\nPara: ' + order.schedule : ''}\nTotal: $${order.total.toLocaleString('es-CO')}\nNombre: ${order.name}${order.notes ? '\nNotas: ' + order.notes : ''}`;
  return `https://wa.me/${String(number).replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
}
async function wompiUrl(c, order) {
  const cents = order.total * 100; const sig = await sha256Hex(`${order.code}${cents}COP${c.env.WOMPI_INTEGRITY_SECRET}`);
  const p = new URLSearchParams({ 'public-key': c.env.WOMPI_PUBLIC_KEY, currency: 'COP', 'amount-in-cents': String(cents), reference: order.code, 'signature:integrity': sig, 'redirect-url': `${siteUrl(c)}/pedido/${order.code}`,
    'customer-data:email': order.email || '', 'customer-data:full-name': order.name, 'customer-data:phone-number': order.phone.replace(/\D/g, '').slice(-10) });
  return `https://checkout.wompi.co/p/?${p.toString()}`;
}

app.post('/api/orders', rateLimit(20, 3600000), async (c) => {
  const b = await body(c);
  const dtype = b.delivery_type === 'retiro' ? 'retiro' : 'delivery';
  const name = str(b.name, 80), phone = str(b.phone, 30);
  const address = dtype === 'delivery' ? str(b.address, 200) : '', city = dtype === 'delivery' ? str(b.city, 60) : 'Retiro en el local';
  const schedule = str(b.schedule, 60), email = str(b.email, 120).toLowerCase();
  if (name.length < 2) return c.json({ error: 'Escribe tu nombre completo.' }, 400);
  if (phone.replace(/\D/g, '').length < 7) return c.json({ error: 'Escribe un teléfono válido.' }, 400);
  if (dtype === 'delivery' && address.length < 5) return c.json({ error: 'Escribe la dirección de entrega.' }, 400);
  if (dtype === 'delivery' && city.length < 2) return c.json({ error: 'Escribe la ciudad.' }, 400);
  if (email && !isEmail(email)) return c.json({ error: 'Correo no válido.' }, 400);
  const method = PAY_METHODS.includes(b.payment_method) ? b.payment_method : 'whatsapp';
  if (method === 'wompi' && !wompiOn(c.env)) return c.json({ error: 'El pago en línea aún no está activado.' }, 400);
  if (method === 'contraentrega') {
    const ok = dtype === 'delivery' && (await getSetting(c, 'cod_cities')).split(',').some((x) => x.trim().toLowerCase() === city.toLowerCase());
    if (!ok) return c.json({ error: 'El pago contra entrega no está disponible en tu ciudad.' }, 400);
  }
  const items = await resolveItems(c, b.items);
  const subtotal = items.reduce((a, i) => a + i.price * i.qty, 0);
  const coupon = b.coupon ? await applyCoupon(c, b.coupon, subtotal) : { discount: 0, code: '' };
  const ship = dtype === 'retiro' ? { fee: 0 } : await shippingFor(c, city, subtotal - coupon.discount);
  const total = subtotal - coupon.discount + ship.fee; const code = orderCode(); const user = c.get('user');
  const stmts = [st(c, `INSERT INTO orders(code,user_id,name,email,phone,address,city,notes,subtotal,shipping,discount,total,coupon,payment_method,delivery_type,schedule)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, code, user ? user.id : null, name, email, phone, address, city, str(b.notes, 400), subtotal, ship.fee, coupon.discount, total, coupon.code, method, dtype, schedule)];
  for (const i of items) {
    stmts.push(st(c, 'INSERT INTO order_items(order_id,product_id,variant_id,name,variant_name,note,price,qty) VALUES((SELECT id FROM orders WHERE code=?),?,?,?,?,?,?,?)', code, i.product_id, i.variant_id, i.name, i.variant_name, i.note, i.price, i.qty));
    stmts.push(i.variant_id ? st(c, 'UPDATE variants SET stock=stock-? WHERE id=?', i.qty, i.variant_id) : st(c, 'UPDATE products SET stock=stock-? WHERE id=?', i.qty, i.product_id));
    stmts.push(st(c, 'UPDATE products SET sales_count=sales_count+? WHERE id=?', i.qty, i.product_id));
  }
  stmts.push(st(c, 'INSERT INTO notifications(type,message,order_id) VALUES(?,?,(SELECT id FROM orders WHERE code=?))', 'pedido', `Nuevo pedido ${code} de ${name} por $${total.toLocaleString('es-CO')} (${method})`, code));
  try { await batch(c, stmts); } // transacción: si el inventario no alcanza (CHECK stock>=0), se deshace todo
  catch (e) { if (/CHECK|constraint/i.test(String(e.message))) return c.json({ error: 'Un producto se agotó mientras hacías el pedido. Revisa tu carrito.' }, 409); throw e; }
  const order = await orderFull(c, await one(c, 'SELECT * FROM orders WHERE code=?', code));
  return c.json({ code, total, whatsapp_url: waLink(await getSetting(c, 'whatsapp'), order), payment_url: method === 'wompi' ? await wompiUrl(c, order) : null, bank_info: method === 'transferencia' ? await getSetting(c, 'bank_info') : null });
});

app.get('/api/orders/mine', requireUser, async (c) => {
  const rows = await all(c, 'SELECT * FROM orders WHERE user_id=? ORDER BY id DESC', c.get('user').id);
  return c.json(await Promise.all(rows.map((o) => orderFull(c, o))));
});
app.get('/api/orders/track', rateLimit(30, 600000), async (c) => {
  const q = c.req.query(); const o = await one(c, 'SELECT * FROM orders WHERE code=?', str(q.code, 20).toUpperCase());
  if (!o) return c.json({ error: 'Pedido no encontrado.' }, 404);
  const user = c.get('user'); const mine = user && o.user_id === user.id;
  const emailOk = o.email && str(q.email, 120).toLowerCase() === o.email;
  const phoneOk = str(q.phone, 30).length >= 7 && str(q.phone, 30).replace(/\D/g, '').slice(-7) === o.phone.replace(/\D/g, '').slice(-7);
  if (!mine && !emailOk && !phoneOk) return c.json({ error: 'Para ver el pedido, escribe el correo o el teléfono con el que lo hiciste.' }, 403);
  const f = await orderFull(c, o);
  return c.json({ code: f.code, delivery_type: f.delivery_type, schedule: f.schedule, status: f.status, payment_status: f.payment_status, payment_method: f.payment_method, total: f.total, shipping: f.shipping, discount: f.discount, subtotal: f.subtotal, created_at: f.created_at, items: f.items,
    whatsapp_url: waLink(await getSetting(c, 'whatsapp'), f), bank_info: f.payment_method === 'transferencia' ? await getSetting(c, 'bank_info') : null });
});

// Webhook de Wompi: confirma el pago automáticamente
app.post('/api/payments/wompi', async (c) => {
  try {
    const ev = await body(c); if (!c.env.WOMPI_EVENTS_SECRET) return c.body(null, 503);
    const props = (ev.signature && ev.signature.properties) || [];
    const vals = props.map((p) => p.split('.').reduce((o, k) => (o ? o[k] : ''), ev.data)).join('');
    if ((await sha256Hex(vals + ev.timestamp + c.env.WOMPI_EVENTS_SECRET)) !== (ev.signature && ev.signature.checksum)) return c.body(null, 401);
    if (ev.event === 'transaction.updated') {
      const t = ev.data.transaction; const o = await one(c, 'SELECT * FROM orders WHERE code=?', t.reference);
      if (o && t.amount_in_cents === o.total * 100) {
        if (t.status === 'APPROVED') {
          await batch(c, [st(c, "UPDATE orders SET payment_status='pagado', status=CASE WHEN status='pendiente' THEN 'confirmado' ELSE status END WHERE id=?", o.id),
            st(c, 'INSERT INTO notifications(type,message,order_id) VALUES(?,?,?)', 'pago', `Pago aprobado del pedido ${o.code}`, o.id)]);
        } else if (['DECLINED', 'VOIDED', 'ERROR'].includes(t.status)) await exec(c, "UPDATE orders SET payment_status='rechazado' WHERE id=?", o.id);
      }
    }
    return c.json({ ok: true });
  } catch { return c.body(null, 400); }
});

// ================= ADMINISTRACIÓN =================
const admin = new Hono();
admin.use('*', requireAdmin);

admin.get('/stats', async (c) => {
  const v = "status<>'cancelado'"; const n = async (sql, ...a) => (await one(c, sql, ...a)).v;
  return c.json({
    revenue: await n(`SELECT COALESCE(SUM(total),0) v FROM orders WHERE ${v}`), revenue_30: await n(`SELECT COALESCE(SUM(total),0) v FROM orders WHERE ${v} AND created_at>=datetime('now','-30 day')`),
    orders: await n('SELECT COUNT(*) v FROM orders'), pending: await n("SELECT COUNT(*) v FROM orders WHERE status='pendiente'"), customers: await n("SELECT COUNT(*) v FROM users WHERE role='customer'"), products: await n('SELECT COUNT(*) v FROM products'),
    avg_ticket: Math.round(await n(`SELECT COALESCE(AVG(total),0) v FROM orders WHERE ${v}`)),
    by_status: await all(c, 'SELECT status, COUNT(*) n FROM orders GROUP BY status'),
    daily: await all(c, `SELECT date(created_at) d, SUM(total) v, COUNT(*) n FROM orders WHERE ${v} AND created_at>=datetime('now','-14 day') GROUP BY d ORDER BY d`),
    top: await all(c, "SELECT oi.name name, SUM(oi.qty) qty, SUM(oi.qty*oi.price) total FROM order_items oi JOIN orders o ON o.id=oi.order_id WHERE o.status<>'cancelado' GROUP BY oi.name ORDER BY qty DESC LIMIT 5"),
    low_stock: await all(c, 'SELECT id,name,stock FROM products WHERE active=1 AND stock<=5 ORDER BY stock LIMIT 10'), unread: await n('SELECT COUNT(*) v FROM notifications WHERE read=0'),
  });
});
admin.get('/notifications', async (c) => c.json(await all(c, 'SELECT * FROM notifications ORDER BY id DESC LIMIT 50')));
admin.post('/notifications/read', async (c) => { await exec(c, 'UPDATE notifications SET read=1'); return c.json({ ok: true }); });

// ----- productos
admin.get('/products', async (c) => c.json(await hydrateMany(c, await all(c, `${PROD_SELECT} ORDER BY p.id DESC LIMIT 90`), true)));
async function saveProduct(c, id, b) {
  const name = str(b.name, 120); if (!name) throw new HttpError(400, 'El producto necesita un nombre.');
  const arr = (v) => (Array.isArray(v) ? v.map((x) => str(x, 300)).filter(Boolean) : []);
  const specs = (Array.isArray(b.specs) ? b.specs : []).map((s) => ({ k: str(s.k, 80), v: str(s.v, 200) })).filter((s) => s.k && s.v);
  const faqs = (Array.isArray(b.faqs) ? b.faqs : []).map((s) => ({ q: str(s.q, 200), a: str(s.a, 800) })).filter((s) => s.q && s.a);
  const variants = (Array.isArray(b.variants) ? b.variants : []).map((v) => ({ id: int(v.id) || null, name: str(v.name, 60), price: Math.max(0, int(v.price)), stock: Math.max(0, int(v.stock)) })).filter((v) => v.name);
  const images = (Array.isArray(b.images) ? b.images : []).map((u) => str(u, 300)).filter((u) => /^(\/uploads\/|\/assets\/|https:\/\/)[^\s"'()\\]+$/.test(u));
  let price = Math.max(0, int(b.price)), stock = Math.max(0, int(b.stock));
  if (variants.length) { price = Math.min(...variants.map((v) => v.price)); stock = variants.reduce((a, v) => a + v.stock, 0); }
  let slug = null;
  if (!id) { slug = slugify(name); let n = 1; while (await one(c, 'SELECT 1 x FROM products WHERE slug=?', slug)) slug = `${slugify(name)}-${++n}`; }
  const P = id ? ['?', id] : ['(SELECT id FROM products WHERE slug=?)', slug];
  const existing = id ? (await all(c, 'SELECT id FROM variants WHERE product_id=?', id)).map((r) => r.id) : [];
  const s = [];
  if (!id) s.push(st(c, 'INSERT INTO products(slug,name) VALUES(?,?)', slug, name));
  s.push(st(c, `UPDATE products SET name=?,category_id=?,short_desc=?,description=?,price=?,compare_price=?,features=?,benefits=?,specs=?,usage=?,faqs=?,recommendations=?,stock=?,weight_g=?,featured=?,is_new=?,active=? WHERE id=${P[0]}`,
    name, int(b.category_id) || null, str(b.short_desc, 300), str(b.description, 5000), price, Math.max(0, int(b.compare_price)), JSON.stringify(arr(b.features)), JSON.stringify(arr(b.benefits)),
    JSON.stringify(specs), str(b.usage, 2000), JSON.stringify(faqs), str(b.recommendations, 1000), stock, Math.max(0, int(b.weight_g, 500)), b.featured ? 1 : 0, b.is_new ? 1 : 0, b.active === false ? 0 : 1, P[1]));
  const keep = variants.filter((v) => v.id && existing.includes(v.id)).map((v) => v.id);
  s.push(keep.length ? st(c, `DELETE FROM variants WHERE product_id=${P[0]} AND id NOT IN (${keep.map(() => '?').join(',')})`, P[1], ...keep) : st(c, `DELETE FROM variants WHERE product_id=${P[0]}`, P[1]));
  variants.forEach((v) => s.push(v.id && existing.includes(v.id) ? st(c, 'UPDATE variants SET name=?,price=?,stock=? WHERE id=?', v.name, v.price, v.stock, v.id) : st(c, `INSERT INTO variants(product_id,name,price,stock) VALUES(${P[0]},?,?,?)`, P[1], v.name, v.price, v.stock)));
  s.push(st(c, `DELETE FROM product_images WHERE product_id=${P[0]}`, P[1]));
  images.forEach((u, i) => s.push(st(c, `INSERT INTO product_images(product_id,url,sort) VALUES(${P[0]},?,?)`, P[1], u, i)));
  await batch(c, s);
  return id || (await one(c, 'SELECT id FROM products WHERE slug=?', slug)).id;
}
const productOut = async (c, id) => (await hydrateMany(c, [await one(c, `${PROD_SELECT} WHERE p.id=?`, id)], true))[0];
admin.post('/products', async (c) => c.json(await productOut(c, await saveProduct(c, null, await body(c)))));
admin.put('/products/:id', async (c) => {
  const id = int(c.req.param('id')); if (!(await one(c, 'SELECT 1 x FROM products WHERE id=?', id))) return c.json({ error: 'No existe.' }, 404);
  return c.json(await productOut(c, await saveProduct(c, id, await body(c))));
});
admin.delete('/products/:id', async (c) => { await exec(c, 'DELETE FROM products WHERE id=?', int(c.req.param('id'))); return c.json({ ok: true }); });

// ----- fotos (R2)
admin.post('/upload', async (c) => {
  const form = await c.req.formData(); const files = form.getAll('files').filter((f) => typeof f !== 'string').slice(0, 10); const urls = [];
  for (const f of files) {
    if (f.size > 6 * 1024 * 1024) return c.json({ error: 'La imagen supera 6 MB.' }, 400);
    const buf = new Uint8Array(await f.arrayBuffer()); const kind = sniffImage(buf);
    if (!kind) return c.json({ error: 'Solo se permiten imágenes JPG, PNG o WebP.' }, 400);
    const key = `${Date.now()}-${randomHex(4)}.${kind.ext}`;
    await c.env.BUCKET.put('uploads/' + key, buf, { httpMetadata: { contentType: kind.type } }); urls.push('/uploads/' + key);
  }
  return c.json({ urls });
});

// ----- categorías
admin.get('/categories', async (c) => c.json(await all(c, 'SELECT * FROM categories ORDER BY sort,id')));
admin.post('/categories', async (c) => {
  const b = await body(c); const name = str(b.name, 80); if (!name) return c.json({ error: 'Escribe un nombre.' }, 400);
  let slug = slugify(name), n = 1; while (await one(c, 'SELECT 1 x FROM categories WHERE slug=?', slug)) slug = `${slugify(name)}-${++n}`;
  const r = await exec(c, 'INSERT INTO categories(name,slug,description,image,sort) VALUES(?,?,?,?,?)', name, slug, str(b.description, 300), str(b.image, 300), int(b.sort));
  return c.json(await one(c, 'SELECT * FROM categories WHERE id=?', r.meta.last_row_id));
});
admin.put('/categories/:id', async (c) => { const b = await body(c); await exec(c, 'UPDATE categories SET name=?,description=?,image=?,sort=? WHERE id=?', str(b.name, 80), str(b.description, 300), str(b.image, 300), int(b.sort), int(c.req.param('id'))); return c.json({ ok: true }); });
admin.delete('/categories/:id', async (c) => { await exec(c, 'DELETE FROM categories WHERE id=?', int(c.req.param('id'))); return c.json({ ok: true }); });

// ----- pedidos
admin.get('/orders', async (c) => {
  const s = str(c.req.query('status'), 20);
  const rows = s ? await all(c, 'SELECT * FROM orders WHERE status=? ORDER BY id DESC LIMIT 100', s) : await all(c, 'SELECT * FROM orders ORDER BY id DESC LIMIT 100');
  if (!rows.length) return c.json([]);
  const items = await all(c, `SELECT order_id,name,variant_name,note,price,qty FROM order_items WHERE order_id IN (${rows.map(() => '?').join(',')})`, ...rows.map((r) => r.id));
  return c.json(rows.map((o) => ({ ...o, items: items.filter((i) => i.order_id === o.id) })));
});
admin.put('/orders/:id', async (c) => {
  const b = await body(c); const o = await one(c, 'SELECT * FROM orders WHERE id=?', int(c.req.param('id')));
  if (!o) return c.json({ error: 'No existe.' }, 404);
  const status = b.status && STATUSES.includes(b.status) ? b.status : o.status;
  const pay = ['pendiente', 'pagado', 'rechazado', 'reembolsado'].includes(b.payment_status) ? b.payment_status : o.payment_status;
  if (o.status === 'cancelado' && status !== 'cancelado') return c.json({ error: 'Un pedido cancelado no se puede reactivar. Crea uno nuevo.' }, 400);
  const s = [];
  if (status === 'cancelado' && o.status !== 'cancelado') {
    (await all(c, 'SELECT * FROM order_items WHERE order_id=?', o.id)).forEach((i) => {
      if (i.variant_id) s.push(st(c, 'UPDATE variants SET stock=stock+? WHERE id=?', i.qty, i.variant_id)); else if (i.product_id) s.push(st(c, 'UPDATE products SET stock=stock+? WHERE id=?', i.qty, i.product_id));
    });
  }
  s.push(st(c, 'UPDATE orders SET status=?, payment_status=? WHERE id=?', status, pay, o.id));
  await batch(c, s); return c.json({ ok: true });
});

// ----- clientes y administradores
admin.get('/customers', async (c) => c.json(await all(c, `SELECT u.id,u.name,u.email,u.phone,u.city,u.created_at, COUNT(o.id) orders, COALESCE(SUM(CASE WHEN o.status<>'cancelado' THEN o.total END),0) spent
  FROM users u LEFT JOIN orders o ON o.user_id=u.id WHERE u.role='customer' GROUP BY u.id ORDER BY u.id DESC LIMIT 200`)));
admin.get('/admins', async (c) => c.json(await all(c, "SELECT id,name,email FROM users WHERE role='admin'")));
admin.post('/admins', async (c) => {
  const b = await body(c); const login = str(b.email, 120).toLowerCase(), name = str(b.name, 80), pass = String(b.password || '');
  if (!login || !name || pass.length < 8) return c.json({ error: 'Completa nombre, usuario y una contraseña de 8 o más caracteres.' }, 400);
  if (await one(c, 'SELECT 1 x FROM users WHERE email=?', login)) return c.json({ error: 'Ese usuario ya existe.' }, 409);
  const { hash, salt } = await hashPassword(pass, null, c.env.PBKDF2_ITERATIONS);
  await exec(c, "INSERT INTO users(name,email,pass_hash,salt,role) VALUES(?,?,?,?, 'admin')", name, login, hash, salt); return c.json({ ok: true });
});
admin.delete('/admins/:id', async (c) => {
  if (int(c.req.param('id')) === c.get('user').id) return c.json({ error: 'No puedes eliminar tu propio usuario.' }, 400);
  await exec(c, "DELETE FROM users WHERE id=? AND role='admin'", int(c.req.param('id'))); return c.json({ ok: true });
});

// ----- promociones
admin.get('/promotions', async (c) => c.json(await all(c, 'SELECT * FROM promotions ORDER BY id DESC')));
admin.post('/promotions', async (c) => {
  const b = await body(c); const code = str(b.code, 40).toUpperCase().replace(/[^A-Z0-9_-]/g, ''); if (!code) return c.json({ error: 'Escribe un código.' }, 400);
  if (await one(c, 'SELECT 1 x FROM promotions WHERE code=?', code)) return c.json({ error: 'Ese código ya existe.' }, 409);
  const type = b.type === 'fixed' ? 'fixed' : 'percent'; const value = Math.max(1, int(b.value));
  if (type === 'percent' && value > 100) return c.json({ error: 'El porcentaje no puede superar 100.' }, 400);
  await exec(c, 'INSERT INTO promotions(code,title,type,value,min_amount,active,starts,ends,show_banner) VALUES(?,?,?,?,?,?,?,?,?)', code, str(b.title, 100), type, value, Math.max(0, int(b.min_amount)), b.active === false ? 0 : 1, str(b.starts, 10), str(b.ends, 10), b.show_banner ? 1 : 0);
  return c.json({ ok: true });
});
admin.put('/promotions/:id', async (c) => { const b = await body(c); await exec(c, 'UPDATE promotions SET title=?,active=?,starts=?,ends=?,show_banner=?,min_amount=? WHERE id=?', str(b.title, 100), b.active ? 1 : 0, str(b.starts, 10), str(b.ends, 10), b.show_banner ? 1 : 0, Math.max(0, int(b.min_amount)), int(c.req.param('id'))); return c.json({ ok: true }); });
admin.delete('/promotions/:id', async (c) => { await exec(c, 'DELETE FROM promotions WHERE id=?', int(c.req.param('id'))); return c.json({ ok: true }); });

// ----- envíos
admin.get('/shipping', async (c) => c.json(await all(c, 'SELECT * FROM shipping_zones ORDER BY id')));
admin.post('/shipping', async (c) => { const b = await body(c); const r = await exec(c, 'INSERT INTO shipping_zones(name,cities,fee,free_over,eta) VALUES(?,?,?,?,?)', str(b.name, 80) || 'Zona', str(b.cities, 400) || '*', Math.max(0, int(b.fee)), Math.max(0, int(b.free_over)), str(b.eta, 80)); return c.json({ id: r.meta.last_row_id }); });
admin.put('/shipping/:id', async (c) => { const b = await body(c); await exec(c, 'UPDATE shipping_zones SET name=?,cities=?,fee=?,free_over=?,eta=? WHERE id=?', str(b.name, 80), str(b.cities, 400) || '*', Math.max(0, int(b.fee)), Math.max(0, int(b.free_over)), str(b.eta, 80), int(c.req.param('id'))); return c.json({ ok: true }); });
admin.delete('/shipping/:id', async (c) => { await exec(c, 'DELETE FROM shipping_zones WHERE id=?', int(c.req.param('id'))); return c.json({ ok: true }); });

// ----- contenido y apariencia
const SETTING_KEYS = ['bg_color', 'accent_color', 'bg_image', 'bg_dim', 'watermark', 'watermark_mode', 'watermark_size', 'watermark_opacity', 'store_name', 'tagline', 'splash_title', 'hero_kicker', 'footer_note', 'hero_title', 'hero_subtitle', 'hero_image', 'logo', 'announcement', 'whatsapp', 'instagram', 'email', 'address', 'about', 'benefits', 'bank_info', 'cod_cities', 'seo_description'];
admin.get('/settings', async (c) => { const s = await settingsMap(c); s.benefits = J(s.benefits); return c.json(s); });
admin.put('/settings', async (c) => {
  const b = await body(c); const s = [];
  for (const k of SETTING_KEYS) {
    if (!(k in b)) continue;
    let v = b[k];
    if (k === 'benefits') v = JSON.stringify((Array.isArray(v) ? v : []).map((x) => ({ t: str(x.t, 60), d: str(x.d, 200) })).filter((x) => x.t));
    else v = str(v, k === 'about' || k === 'bank_info' ? 2000 : 400);
    if (['hero_image', 'logo', 'bg_image', 'watermark'].includes(k) && v && !/^(\/uploads\/|\/assets\/|https:\/\/)[^\s"'()\\]+$/.test(v)) continue;
    if ((k === 'bg_color' || k === 'accent_color') && !/^#[0-9a-f]{6}$/i.test(v)) continue;
    if (k === 'watermark_mode' && !['tile', 'center'].includes(v)) continue;
    if (k === 'bg_dim') v = String(Math.max(0, Math.min(100, int(v, 80))));
    if (k === 'watermark_opacity') v = String(Math.max(0, Math.min(30, Number(v) || 0)));
    if (k === 'watermark_size') v = String(Math.max(80, Math.min(600, int(v, 240))));
    s.push(st(c, 'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', k, String(v ?? '')));
  }
  if (s.length) await batch(c, s); return c.json({ ok: true });
});
admin.get('/testimonials', async (c) => c.json(await all(c, 'SELECT * FROM testimonials ORDER BY id DESC')));
admin.post('/testimonials', async (c) => {
  const b = await body(c); const name = str(b.name, 60), text = str(b.text, 400); if (!name || !text) return c.json({ error: 'Completa nombre y comentario.' }, 400);
  await exec(c, 'INSERT INTO testimonials(name,text,rating,active) VALUES(?,?,?,1)', name, text, Math.min(5, Math.max(1, int(b.rating, 5)))); return c.json({ ok: true });
});
admin.delete('/testimonials/:id', async (c) => { await exec(c, 'DELETE FROM testimonials WHERE id=?', int(c.req.param('id'))); return c.json({ ok: true }); });

app.route('/api/admin', admin);
app.all('/api/*', (c) => c.json({ error: 'No encontrado.' }, 404));

// ---------- fotos subidas (R2) ----------
app.get('/uploads/:name', async (c) => {
  const name = c.req.param('name'); if (!/^[\w.-]+$/.test(name)) return c.notFound();
  const obj = await c.env.BUCKET.get('uploads/' + name); if (!obj) return c.notFound();
  const h = new Headers(); obj.writeHttpMetadata(h); h.set('etag', obj.httpEtag); h.set('Cache-Control', 'public, max-age=2592000, immutable');
  return new Response(obj.body, { headers: h });
});

// ---------- páginas con SEO ----------
let SHELL = null;
async function shellHtml(c) { return (SHELL ||= await (await c.env.ASSETS.fetch(new Request(new URL('/', c.req.url)))).text()); }
async function renderShell(c, meta) {
  const s = await settingsMap(c); const store = s.store_name || 'Don Ahumados';
  const title = meta.title ? `${meta.title} | ${store}` : `${store} | ${s.tagline}`; const desc = meta.desc || s.seo_description || '';
  const base = siteUrl(c); const img = meta.image ? (/^(https?:|data:)/.test(meta.image) ? meta.image : base + meta.image) : '';
  const head = `<title>${escHtml(title)}</title>
<meta name="description" content="${escHtml(desc)}">
<link rel="canonical" href="${escHtml(base + (meta.path || '/'))}">
<meta property="og:type" content="${meta.product ? 'product' : 'website'}"><meta property="og:title" content="${escHtml(title)}"><meta property="og:description" content="${escHtml(desc)}">${img ? `<meta property="og:image" content="${escHtml(img)}">` : ''}
${meta.jsonld ? `<script type="application/ld+json">${JSON.stringify(meta.jsonld).replace(/</g, '\\u003c')}</script>` : ''}`;
  const tv = DATheme.themeVars(s.bg_color, s.accent_color);
  const themeCss = `<style>:root{${Object.entries(tv).map(([k, x]) => `${k}:${x}`).join(';')}}</style>`;
  return (await shellHtml(c)).replace('<!--SEO-->', head).replace('</head>', themeCss + '</head>');
}
const htmlRes = (c, html, status = 200) => c.html(html, status, { 'Cache-Control': 'no-cache' });
const TITLES = { '/carta': 'La carta', '/tienda': 'Tienda', '/carrito': 'Carrito', '/checkout': 'Finalizar compra', '/cuenta': 'Mi cuenta', '/ingresar': 'Ingresar', '/seguimiento': 'Seguimiento de pedido', '/nosotros': 'Nosotros' };
for (const p of ['/', '/carta', '/tienda', '/carrito', '/checkout', '/cuenta', '/ingresar', '/seguimiento', '/nosotros', '/pedido/:code']) {
  app.get(p, async (c) => htmlRes(c, await renderShell(c, { title: TITLES[new URL(c.req.url).pathname] || '', path: new URL(c.req.url).pathname })));
}
app.get('/producto/:slug', async (c) => {
  const path = new URL(c.req.url).pathname;
  const row = await one(c, `${PROD_SELECT} WHERE p.slug=? AND p.active=1`, c.req.param('slug'));
  if (!row) return htmlRes(c, await renderShell(c, { title: 'Producto no encontrado', path }), 404);
  const [h] = await hydrateMany(c, [row], true); const base = siteUrl(c);
  return htmlRes(c, await renderShell(c, { title: h.name, desc: h.short_desc || h.description.slice(0, 160), image: h.images[0], path, product: true,
    jsonld: { '@context': 'https://schema.org', '@type': 'Product', name: h.name, description: h.short_desc || h.description, image: h.images.map((u) => (u.startsWith('http') ? u : base + u)),
      offers: { '@type': 'Offer', priceCurrency: 'COP', price: h.price, availability: h.available ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock', url: base + path } } }));
});
app.get('/robots.txt', (c) => c.text(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nSitemap: ${siteUrl(c)}/sitemap.xml\n`));
app.get('/sitemap.xml', async (c) => {
  const urls = ['/', '/carta', ...(await all(c, 'SELECT slug FROM products WHERE active=1')).map((p) => '/producto/' + p.slug)];
  return c.body(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map((u) => `<url><loc>${siteUrl(c)}${u}</loc></url>`).join('')}</urlset>`, 200, { 'Content-Type': 'application/xml' });
});
app.get('/admin', (c) => c.env.ASSETS.fetch(new Request(new URL('/admin/', c.req.url))));
app.get('/admin/', (c) => c.env.ASSETS.fetch(new Request(new URL('/admin/', c.req.url))));

app.notFound(async (c) => (new URL(c.req.url).pathname.startsWith('/api/') ? c.json({ error: 'No encontrado.' }, 404) : c.text('No encontrado', 404)));
app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
  console.error(err);
  if (/no such table/i.test(String(err.message))) return c.json({ error: 'Falta crear las tablas. Ejecuta: npx wrangler d1 migrations apply DB --remote' }, 503);
  return c.json({ error: 'Error interno.' }, 500);
});

export default app;
