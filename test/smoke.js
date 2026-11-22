'use strict';
// Prueba de humo de extremo a extremo contra el Worker en ejecución (npm test lo levanta con wrangler dev).
const crypto = require('crypto');
const BASE_URL = process.env.BASE_URL || 'http://127.0.0.1:8787';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ✔', m); } else { fail++; console.log('  ✘ FALLA:', m); } };

(async () => {
  const base = BASE_URL;
  const jar = () => { let c = ''; return { async f(url, o = {}) { const r = await fetch(base + url, { ...o, headers: { ...(o.headers || {}), ...(o.body && !(o.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), cookie: c }, body: o.body && !(o.body instanceof FormData) ? JSON.stringify(o.body) : o.body }); const sc = r.headers.getSetCookie(); if (sc.length) { const v = sc.map((x) => x.split(';')[0]).find((x) => x.startsWith('sid=')); if (v) c = v.endsWith('=') ? '' : v; } let d = null; const t = await r.text(); try { d = JSON.parse(t); } catch { d = t; } return { s: r.status, d }; } }; };
  const anon = jar(), cust = jar(), adm = jar();

  console.log('Público');
  let r = await anon.f('/api/products'); ok(r.s === 200 && r.d.length >= 8, 'catálogo con productos');
  const toc = r.d.find((p) => p.slug === 'tocineta-artesanal-ahumada'); ok(!!toc && toc.variants.length === 2, 'producto con presentaciones');
  r = await anon.f('/api/products?q=lomo'); ok(r.d.length === 1, 'buscador');
  r = await anon.f('/api/products?category=salsas'); ok(r.d.length === 4, 'filtro por categoría (Salsas)');
  r = await anon.f('/api/products?sort=price_asc'); ok(r.d[0].price <= r.d[1].price, 'orden por precio ascendente');
  r = await anon.f('/api/products?sort=popular'); ok(r.d[0].sales_count >= r.d[1].sales_count, 'orden por popularidad');
  r = await anon.f('/api/products/tocineta-artesanal-ahumada'); ok(r.d.related.length > 0 && r.d.faqs.length > 0, 'ficha completa con relacionados y FAQ');
  r = await anon.f('/api/products/no-existe'); ok(r.s === 404, 'producto inexistente devuelve 404');
  r = await anon.f('/producto/tocineta-artesanal-ahumada'); ok(r.s === 200 && r.d.includes('application/ld+json') && r.d.includes('og:title'), 'página de producto con SEO y datos estructurados');
  r = await anon.f('/sitemap.xml'); ok(r.d.includes('/producto/chorizo-ahumado-artesanal'), 'sitemap.xml');
  r = await anon.f('/robots.txt'); ok(r.d.includes('Disallow: /admin'), 'robots.txt');

  console.log('Cuentas');
  r = await cust.f('/api/auth/register', { method: 'POST', body: { name: 'Cliente Prueba', email: 'cliente@prueba.co', password: 'corta' } }); ok(r.s === 400, 'rechaza contraseña corta');
  r = await cust.f('/api/auth/register', { method: 'POST', body: { name: 'Cliente Prueba', email: 'cliente@prueba.co', password: 'clave-segura-1', city: 'Cali', phone: '3001234567' } }); ok(r.s === 200, 'registro');
  r = await cust.f('/api/me'); ok(r.d.user && r.d.user.email === 'cliente@prueba.co' && r.d.user.role === 'customer', 'sesión iniciada');
  r = await anon.f('/api/auth/register', { method: 'POST', body: { name: 'X Y', email: 'cliente@prueba.co', password: 'clave-segura-1' } }); ok(r.s === 409, 'correo duplicado rechazado');
  r = await anon.f('/api/auth/login', { method: 'POST', body: { email: 'cliente@prueba.co', password: 'mala' } }); ok(r.s === 401, 'login con clave incorrecta rechazado');
  r = await cust.f('/api/admin/stats'); ok(r.s === 403, 'un cliente NO accede al panel admin');
  r = await anon.f('/api/admin/products'); ok(r.s === 403, 'un visitante NO accede al panel admin');

  console.log('Compra');
  const v500 = toc.variants.find((v) => v.name === '500 g');
  r = await anon.f('/api/cart/quote', { method: 'POST', body: { items: [{ productId: toc.id, variantId: v500.id, qty: 2 }], city: 'Cali', coupon: 'BIENVENIDO10' } });
  ok(r.d.subtotal === 64000 && r.d.discount === 6400 && r.d.shipping === 8000 && r.d.total === 65600, `cotización: subtotal, cupón 10% y envío Cali (total ${r.d.total})`);
  r = await anon.f('/api/cart/quote', { method: 'POST', body: { items: [{ productId: toc.id, variantId: v500.id, qty: 2 }], city: 'Bogotá' } }); ok(r.d.shipping === 22000 && r.d.shipping_zone === 'Resto de Colombia', 'envío nacional');
  r = await anon.f('/api/cart/quote', { method: 'POST', body: { items: [{ productId: toc.id, variantId: v500.id, qty: 5 }], city: 'Cali' } }); ok(r.d.shipping === 0, 'envío gratis sobre el umbral');
  r = await anon.f('/api/cart/quote', { method: 'POST', body: { items: [{ productId: toc.id, variantId: v500.id, qty: 1 }], coupon: 'BIENVENIDO10' } }); ok(r.s === 400, 'cupón con compra mínima no cumplida rechazado');
  r = await anon.f('/api/cart/quote', { method: 'POST', body: { items: [{ productId: toc.id, variantId: v500.id, qty: 1 }], coupon: 'INVENTADO' } }); ok(r.s === 400, 'cupón inexistente rechazado');
  r = await anon.f('/api/cart/quote', { method: 'POST', body: { items: [{ productId: toc.id, qty: 1 }] } }); ok(r.s === 400, 'exige elegir presentación');
  r = await anon.f('/api/cart/quote', { method: 'POST', body: { items: [{ productId: toc.id, variantId: v500.id, qty: 9999 }] } }); ok(r.s === 409, 'no vende más que el inventario');
  const bad = { name: 'A', phone: '1', address: '', city: '', items: [] }; r = await anon.f('/api/orders', { method: 'POST', body: bad }); ok(r.s === 400, 'validación del formulario de pedido');
  const body = { name: 'Cliente Prueba', phone: '3001234567', email: 'cliente@prueba.co', address: 'Calle 5 # 10-20', city: 'Cali', payment_method: 'transferencia', coupon: 'BIENVENIDO10', items: [{ productId: toc.id, variantId: v500.id, qty: 2, price: 1 }] };
  r = await cust.f('/api/orders', { method: 'POST', body }); ok(r.s === 200 && r.d.total === 65600 && r.d.bank_info && r.d.whatsapp_url.startsWith('https://wa.me/573117382868'), 'pedido creado con precio calculado por el servidor (ignora el precio del cliente)');
  const code = r.d.code;
  r = await anon.f('/api/products/tocineta-artesanal-ahumada'); ok(r.d.variants.find((v) => v.id === v500.id).stock === 23, 'inventario descontado (25 → 23)');
  r = await cust.f('/api/orders/mine'); ok(r.d.length === 1 && r.d[0].code === code, 'historial de compras del cliente');
  r = await anon.f(`/api/orders/track?code=${code}`); ok(r.s === 403, 'seguimiento sin datos de verificación rechazado');
  r = await anon.f(`/api/orders/track?code=${code}&email=otro@x.co`); ok(r.s === 403, 'seguimiento con correo ajeno rechazado');
  r = await anon.f(`/api/orders/track?code=${code}&email=cliente@prueba.co`); ok(r.s === 200 && r.d.status === 'pendiente', 'seguimiento con correo correcto');
  r = await anon.f('/api/orders', { method: 'POST', body: { ...body, payment_method: 'contraentrega', city: 'Bogotá' } }); ok(r.s === 400, 'contra entrega no disponible fuera de las ciudades permitidas');
  r = await anon.f('/api/orders', { method: 'POST', body: { ...body, payment_method: 'wompi', coupon: '' } }); ok(r.s === 200 && r.d.payment_url && r.d.payment_url.includes('signature%3Aintegrity='), 'pago en línea genera enlace Wompi con firma de integridad');
  const wcode = r.d.code, wtotal = r.d.total;

  r = await anon.f('/api/orders', { method: 'POST', body: { name: 'Retira Local', phone: '3009998877', delivery_type: 'retiro', schedule: 'Hoy 7:00 pm', payment_method: 'whatsapp', notes: 'Sin cuchillería', items: [{ productId: toc.id, variantId: v500.id, qty: 1, note: 'Cortada en tiras' }] } });
  ok(r.s === 200 && r.d.total === 32000 && r.d.whatsapp_url.includes('Retiro'), 'pedido de retiro: sin dirección, sin envío, con hora y nota');
  const rcode = r.d.code; r = await anon.f(`/api/orders/track?code=${rcode}&phone=3009998877`); ok(r.d.delivery_type === 'retiro' && r.d.schedule === 'Hoy 7:00 pm' && r.d.items[0].note === 'Cortada en tiras', 'el pedido guarda tipo de entrega, hora y nota por producto');
  r = await anon.f('/api/orders', { method: 'POST', body: { name: 'Sin Dir', phone: '3009998877', delivery_type: 'delivery', city: 'Cali', address: '', payment_method: 'whatsapp', items: [{ productId: toc.id, variantId: v500.id, qty: 1 }] } }); ok(r.s === 400, 'delivery exige dirección');
  r = await anon.f('/api/cart/quote', { method: 'POST', body: { items: [{ productId: toc.id, variantId: v500.id, qty: 1 }], city: 'Cali', delivery_type: 'retiro' } }); ok(r.d.shipping === 0, 'cotización de retiro sin envío');
  console.log('Pago Wompi (webhook)');
  const mk = (status, amount) => { const data = { transaction: { id: 't1', reference: wcode, status, amount_in_cents: amount } }; const ts = 1700000000; const props = ['transaction.id', 'transaction.status', 'transaction.amount_in_cents']; const checksum = crypto.createHash('sha256').update('t1' + status + amount + ts + 'events_x').digest('hex'); return { event: 'transaction.updated', data, timestamp: ts, signature: { properties: props, checksum } }; };
  r = await anon.f('/api/payments/wompi', { method: 'POST', body: { ...mk('APPROVED', wtotal * 100), signature: { properties: ['transaction.id'], checksum: 'falso' } } }); ok(r.s === 401, 'webhook con firma falsa rechazado');
  r = await anon.f('/api/payments/wompi', { method: 'POST', body: mk('APPROVED', 100) }); const o1 = await anon.f(`/api/orders/track?code=${wcode}&phone=3001234567`); ok(o1.d.payment_status === 'pendiente', 'webhook con monto distinto no confirma el pago');
  r = await anon.f('/api/payments/wompi', { method: 'POST', body: mk('APPROVED', wtotal * 100) }); const o2 = await anon.f(`/api/orders/track?code=${wcode}&phone=3001234567`); ok(r.s === 200 && o2.d.payment_status === 'pagado' && o2.d.status === 'confirmado', 'webhook aprobado marca pagado y confirmado');

  console.log('Administrador');
  r = await adm.f('/api/auth/login', { method: 'POST', body: { email: 'alex', password: 'clave-de-prueba-123' } }); ok(r.s === 200 && r.d.role === 'admin', 'login del administrador');
  r = await adm.f('/api/admin/stats'); ok(r.d.orders === 3 && r.d.revenue > 0 && r.d.unread >= 3, 'estadísticas y notificaciones de pedidos');
  r = await adm.f('/api/admin/products', { method: 'POST', body: { name: 'Pollo ahumado entero', category_id: 1, price: 42000, stock: 10, short_desc: 'Pollo', features: ['Jugoso'], specs: [{ k: 'Peso', v: '1.5 kg' }], faqs: [{ q: '¿?', a: 'Sí' }], images: ['/uploads/x.jpg', 'http://malo.com/x.js'], featured: true, active: true, variants: [] } });
  ok(r.s === 200 && r.d.slug === 'pollo-ahumado-entero' && r.d.images.length === 1, 'crear producto (rechaza imágenes con URL insegura)'); const nid = r.d.id;
  r = await anon.f('/api/products/pollo-ahumado-entero'); ok(r.s === 200 && r.d.price === 42000, 'el producto nuevo aparece en la tienda pública automáticamente');
  r = await adm.f('/api/admin/products/' + nid, { method: 'PUT', body: { name: 'Pollo ahumado entero', price: 45000, stock: 7, active: true, variants: [] } }); ok(r.d.price === 45000, 'editar precio');
  r = await anon.f('/api/products/pollo-ahumado-entero'); ok(r.d.price === 45000 && r.d.stock === 7, 'el cambio de precio e inventario se refleja en la tienda');
  r = await adm.f('/api/admin/products/' + nid, { method: 'PUT', body: { name: 'Pollo ahumado entero', price: 45000, stock: 7, active: false } }); r = await anon.f('/api/products/pollo-ahumado-entero'); ok(r.s === 404, 'ocultar producto lo retira de la tienda');
  r = await adm.f('/api/admin/products/' + nid, { method: 'DELETE' }); ok(r.s === 200, 'eliminar producto');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  let f = new FormData(); f.append('files', new Blob([png], { type: 'image/png' }), 'a.png'); r = await adm.f('/api/admin/upload', { method: 'POST', body: f }); ok(r.s === 200 && /^\/uploads\/.+\.png$/.test(r.d.urls[0]), 'subir fotografía');
  const up = await anon.f(r.d.urls[0]); ok(up.s === 200, 'la fotografía subida se sirve públicamente');
  f = new FormData(); f.append('files', new Blob(['<script>alert(1)</script>'], { type: 'text/html' }), 'a.html'); r = await adm.f('/api/admin/upload', { method: 'POST', body: f }); ok(r.s === 400, 'rechaza archivos que no son imágenes');
  r = await adm.f('/api/admin/categories', { method: 'POST', body: { name: 'Bebidas' } }); ok(r.s === 200 && r.d.slug === 'bebidas', 'crear categoría');
  r = await anon.f('/api/categories'); ok(r.d.some((c) => c.slug === 'bebidas'), 'la categoría aparece en la tienda');
  r = await adm.f('/api/admin/promotions', { method: 'POST', body: { code: 'verano15', title: 'Verano', type: 'percent', value: 15, min_amount: 0, show_banner: true } }); ok(r.s === 200, 'crear promoción');
  r = await anon.f('/api/cart/quote', { method: 'POST', body: { items: [{ productId: toc.id, variantId: v500.id, qty: 1 }], coupon: 'VERANO15' } }); ok(r.d.discount === 4800, 'el cupón nuevo funciona en la compra');
  r = await adm.f('/api/admin/promotions', { method: 'POST', body: { code: 'MALO', type: 'percent', value: 500 } }); ok(r.s === 400, 'porcentaje mayor a 100 rechazado');
  r = await adm.f('/api/admin/settings', { method: 'PUT', body: { hero_title: 'Nuevo título', whatsapp: '573000000000', logo: 'javascript:alert(1)' } }); ok(r.s === 200, 'editar textos del sitio');
  r = await anon.f('/api/settings'); ok(r.d.hero_title === 'Nuevo título' && r.d.whatsapp === '573000000000' && r.d.logo === '/assets/logo.webp' && !('bank_info' in r.d) && r.d.banner && r.d.banner.code, 'cambios publicados; logo inseguro rechazado; datos bancarios no expuestos; banner activo');
  r = await adm.f('/api/admin/settings', { method: 'PUT', body: { bg_color: '#123456', accent_color: 'rojo', bg_dim: '250', watermark_mode: 'tile', watermark_size: '9999', watermark_opacity: '7.5', bg_image: 'https://x.com/a.jpg"onload=alert(1)', watermark: '/assets/logo-mark.webp' } });
  r = await anon.f('/api/settings'); ok(r.d.bg_color === '#123456' && r.d.accent_color === '#E8772E' && r.d.bg_dim === '100' && r.d.watermark_size === '600' && r.d.watermark_opacity === '7.5' && r.d.bg_image === '' && r.d.watermark === '/assets/logo-mark.webp', 'apariencia: guarda valores válidos y rechaza color, imagen insegura y rangos fuera de límite');
  r = await anon.f('/carta'); ok(String(r.d).includes('--bg:#123456'), 'el color de fondo elegido llega en el primer render (sin parpadeo)');
  r = await anon.f('/js/theme.js'); ok(r.s === 200, 'se sirve el módulo de tema');
  r = await adm.f('/api/admin/testimonials', { method: 'POST', body: { name: 'María', text: 'Excelente', rating: 5 } }); r = await anon.f('/api/testimonials'); ok(r.d.length === 1, 'testimonios');
  r = await adm.f('/api/admin/shipping/2', { method: 'PUT', body: { name: 'Resto de Colombia', cities: '*', fee: 25000, free_over: 0, eta: '3 días' } }); r = await anon.f('/api/cart/quote', { method: 'POST', body: { items: [{ productId: toc.id, variantId: v500.id, qty: 1 }], city: 'Medellín' } }); ok(r.d.shipping === 25000, 'tarifas de envío editables');
  const orders = await adm.f('/api/admin/orders'); const oid = orders.d.find((o) => o.code === code).id;
  r = await adm.f('/api/admin/orders/' + oid, { method: 'PUT', body: { status: 'enviado', payment_status: 'pagado' } }); r = await anon.f(`/api/orders/track?code=${code}&email=cliente@prueba.co`); ok(r.d.status === 'enviado' && r.d.payment_status === 'pagado', 'actualizar estado del pedido (el cliente lo ve)');
  r = await adm.f('/api/admin/orders/' + oid, { method: 'PUT', body: { status: 'cancelado' } }); r = await anon.f('/api/products/tocineta-artesanal-ahumada');   const st = r.d.variants.find((v) => v.id === v500.id).stock; ok(st === 25 - 2 - 1, `cancelar devuelve el inventario (stock ${st}, esperado 22: 25 − 2 Wompi − 1 retiro)`);
  r = await adm.f('/api/admin/orders/' + oid, { method: 'PUT', body: { status: 'pendiente' } }); ok(r.s === 400, 'no se reactiva un pedido cancelado');
  r = await adm.f('/api/admin/customers'); ok(r.d.length === 1 && r.d[0].orders >= 1, 'lista de clientes con pedidos');
  r = await adm.f('/api/admin/admins', { method: 'POST', body: { name: 'Ayudante', email: 'ayudante', password: 'otra-clave-123' } }); ok(r.s === 200, 'agregar otro administrador');
  const h = await anon.f('/admin'); ok(h.s === 200 && String(h.d).includes('Panel administrativo'), 'página del panel admin se sirve');
  r = await anon.f('/api/auth/logout', { method: 'POST' }); ok(r.s === 200, 'cerrar sesión');

    console.log(`\n${pass} pruebas correctas, ${fail} fallidas`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
