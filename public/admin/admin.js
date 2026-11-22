// Las fotos se guardan en la base de datos (límite ~1,4 MB): se reducen y comprimen aquí antes de subirlas.
async function prep(file) {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size <= 700 * 1024) return file;
  try {
    const bmp = await createImageBitmap(file); const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const cv = document.createElement('canvas'); cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k); cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    const toBlob = (t, q) => new Promise((r) => cv.toBlob(r, t, q));
    for (const q of [0.85, 0.7, 0.55, 0.4]) { const b = await toBlob('image/webp', q); if (b && b.type === 'image/webp' && b.size < 1300 * 1024) return new File([b], 'foto.webp', { type: 'image/webp' }); }
    for (const q of [0.8, 0.6, 0.4]) { const b = await toBlob('image/jpeg', q); if (b && b.size < 1300 * 1024) return new File([b], 'foto.jpg', { type: 'image/jpeg' }); }
  } catch {}
  return file;
}
'use strict';
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n || 0);
  const root = $('#root');
  let ME = null, TAB = 'resumen', CATS = [];

  async function api(url, opts = {}) {
    const o = { method: opts.method || 'GET', headers: {}, credentials: 'same-origin' };
    if (opts.form) o.body = opts.form;
    else if (opts.body !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(opts.body); }
    const r = await fetch(url, o); let d = {}; try { d = await r.json(); } catch (_) {}
    if (!r.ok) throw new Error(d.error || 'Error');
    return d;
  }
  const toast = (m) => { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600); };
  const guard = (fn) => async (...a) => { try { await fn(...a); } catch (e) { toast(e.message); } };
  const fdate = (s) => String(s || '').slice(0, 16).replace('T', ' ');

  // ---------- acceso ----------
  function loginView(msg) {
    root.innerHTML = `<div class="login"><div class="panel"><h2>Panel administrativo</h2><form id="lf"><label class="f" for="u">Usuario</label><input class="input" id="u" autocomplete="username" required>
      <label class="f" for="p" style="margin-top:.8rem">Contraseña</label><input class="input" id="p" type="password" autocomplete="current-password" required>${msg ? `<div class="msg err">${esc(msg)}</div>` : ''}
      <button class="btn block" style="margin-top:1rem">Ingresar</button></form><p style="margin:1rem 0 0"><a href="/">← Volver a la tienda</a></p></div></div>`;
    $('#lf').onsubmit = async (e) => { e.preventDefault(); try { const r = await api('/api/auth/login', { method: 'POST', body: { email: $('#u').value, password: $('#p').value } }); if (r.role !== 'admin') { await api('/api/auth/logout', { method: 'POST' }); return loginView('Esta cuenta no tiene permisos de administrador.'); } start(); } catch (er) { loginView(er.message); } };
  }

  const TABS = [['resumen', 'Resumen'], ['productos', 'Productos'], ['categorias', 'Categorías'], ['pedidos', 'Pedidos'], ['clientes', 'Clientes'], ['promos', 'Promociones'], ['envios', 'Envíos'], ['contenido', 'Contenido del sitio'], ['apariencia', 'Apariencia'], ['usuarios', 'Administradores']];
  async function shell() {
    let unread = 0; try { unread = (await api('/api/admin/stats')).unread; } catch (_) {}
    root.innerHTML = `<div class="shell"><nav class="side" aria-label="Administración"><h2>Don Ahumados</h2>
      ${TABS.map(([k, l]) => `<button data-t="${k}" class="${TAB === k ? 'on' : ''}">${l}${k === 'resumen' && unread ? `<span class="n">${unread}</span>` : ''}</button>`).join('')}
      <div class="bottom"><button id="seeSite">Ver tienda ↗</button><button id="out">Cerrar sesión</button></div></nav><div class="mainc" id="main"></div></div>`;
    $$('[data-t]').forEach((b) => b.onclick = () => { TAB = b.dataset.t; shell(); });
    $('#seeSite').onclick = () => window.open('/', '_blank');
    $('#out').onclick = async () => { await api('/api/auth/logout', { method: 'POST' }); loginView(); };
    VIEWS[TAB]().catch((e) => { $('#main').innerHTML = `<div class="msg err">${esc(e.message)}</div>`; });
  }
  const main = () => $('#main');
  const refresh = () => VIEWS[TAB]();

  // ---------- resumen ----------
  async function resumen() {
    const [s, notes] = await Promise.all([api('/api/admin/stats'), api('/api/admin/notifications')]);
    const max = Math.max(1, ...s.daily.map((d) => d.v));
    main().innerHTML = `<h1>Resumen</h1><div class="kpis">
      <div class="kpi"><small>Ventas totales</small><b>${money(s.revenue)}</b></div><div class="kpi"><small>Últimos 30 días</small><b>${money(s.revenue_30)}</b></div>
      <div class="kpi"><small>Pedidos</small><b>${s.orders}</b></div><div class="kpi"><small>Pendientes</small><b>${s.pending}</b></div>
      <div class="kpi"><small>Ticket promedio</small><b>${money(s.avg_ticket)}</b></div><div class="kpi"><small>Clientes registrados</small><b>${s.customers}</b></div></div>
      <div class="box"><h3>Ventas de los últimos 14 días</h3>${s.daily.length ? `<div class="bars" style="margin-bottom:1.4rem">${s.daily.map((d) => `<div style="height:${Math.max(3, d.v / max * 100)}%" title="${esc(d.d)}: ${money(d.v)} (${d.n} pedidos)"><span>${esc(d.d.slice(5))}</span></div>`).join('')}</div>` : '<p class="hint">Aún no hay ventas registradas.</p>'}</div>
      <div class="fg"><div class="box" style="margin:0"><h3>Más vendidos</h3>${s.top.length ? `<table class="t"><tr><th>Producto</th><th>Uds.</th><th>Total</th></tr>${s.top.map((t) => `<tr><td>${esc(t.name)}</td><td>${t.qty}</td><td>${money(t.total)}</td></tr>`).join('')}</table>` : '<p class="hint">Sin datos todavía.</p>'}</div>
      <div class="box" style="margin:0"><h3>Inventario bajo</h3>${s.low_stock.length ? `<table class="t">${s.low_stock.map((t) => `<tr><td>${esc(t.name)}</td><td><b>${t.stock}</b> uds.</td></tr>`).join('')}</table>` : '<p class="hint">Todo el inventario está en buen nivel.</p>'}</div></div>
      <div class="box" style="margin-top:1.2rem"><div class="bar" style="margin:0 0 .6rem"><h3 style="margin:0">Notificaciones</h3><button class="btn tiny dark" id="mr">Marcar como leídas</button></div>
      ${notes.length ? `<table class="t">${notes.map((n) => `<tr style="${n.read ? 'opacity:.6' : 'font-weight:600'}"><td>${esc(fdate(n.created_at))}</td><td>${esc(n.message)}</td></tr>`).join('')}</table>` : '<p class="hint">Sin notificaciones.</p>'}</div>`;
    $('#mr').onclick = guard(async () => { await api('/api/admin/notifications/read', { method: 'POST' }); shell(); });
  }

  // ---------- productos ----------
  async function productos() {
    const [list, cats] = await Promise.all([api('/api/admin/products'), api('/api/admin/categories')]); CATS = cats;
    main().innerHTML = `<div class="bar"><h1>Productos</h1><button class="btn" id="np">+ Nuevo producto</button></div><div class="box"><table class="t"><tr><th></th><th>Producto</th><th>Categoría</th><th>Precio</th><th>Stock</th><th>Estado</th><th></th></tr>
      ${list.map((p) => `<tr><td>${p.images[0] ? `<img src="${esc(p.images[0])}" alt="">` : ''}</td><td><b>${esc(p.name)}</b></td><td>${esc(p.category)}</td><td>${money(p.price)}${p.variants.length ? ' <small>(desde)</small>' : ''}</td><td>${p.stock}</td><td>${p.active ? '<span class="status confirmado">Publicado</span>' : '<span class="status">Oculto</span>'}</td>
      <td><div class="row-actions"><button class="btn tiny dark" data-e="${p.id}">Editar</button><button class="btn tiny danger" data-d="${p.id}">Eliminar</button></div></td></tr>`).join('') || '<tr><td colspan="7">No hay productos. Crea el primero.</td></tr>'}</table></div>`;
    $('#np').onclick = () => productForm(null);
    $$('[data-e]').forEach((b) => b.onclick = () => productForm(list.find((p) => p.id === +b.dataset.e)));
    $$('[data-d]').forEach((b) => b.onclick = guard(async () => { if (!confirm('¿Eliminar este producto? No se puede deshacer.')) return; await api('/api/admin/products/' + b.dataset.d, { method: 'DELETE' }); toast('Producto eliminado'); refresh(); }));
  }
  function productForm(p) {
    const d = p || { name: '', category_id: CATS[0] ? CATS[0].id : '', short_desc: '', description: '', price: 0, compare_price: 0, stock: 0, weight_g: 500, featured: false, is_new: false, active: true, features: [], benefits: [], specs: [], faqs: [], usage: '', recommendations: '', variants: [], images: [] };
    let images = [...d.images];
    const m = document.createElement('div'); m.className = 'modal';
    m.innerHTML = `<div class="dlg" role="dialog" aria-modal="true" aria-label="Producto"><div class="bar"><h2 style="margin:0">${p ? 'Editar' : 'Nuevo'} producto</h2><button class="btn tiny ghost" id="x">Cerrar</button></div>
    <form id="pf"><div class="fg"><div class="full"><label class="f">Nombre comercial</label><input class="input" name="name" value="${esc(d.name)}" required></div>
      <div><label class="f">Categoría</label><select class="input" name="category_id"><option value="">Sin categoría</option>${CATS.map((c) => `<option value="${c.id}" ${c.id === d.category_id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div><label class="f">Precio (COP)</label><input class="input" type="number" min="0" name="price" value="${d.price}"></div>
      <div><label class="f">Precio anterior (tachado, opcional)</label><input class="input" type="number" min="0" name="compare_price" value="${d.compare_price || 0}"></div>
      <div><label class="f">Inventario (unidades)</label><input class="input" type="number" min="0" name="stock" value="${d.stock}"></div>
      <div><label class="f">Peso (gramos)</label><input class="input" type="number" min="0" name="weight_g" value="${d.weight_g || 500}"></div>
      <div class="full"><label class="f">Descripción corta</label><input class="input" name="short_desc" value="${esc(d.short_desc)}"></div>
      <div class="full"><label class="f">Descripción completa</label><textarea class="input" name="description" rows="4">${esc(d.description)}</textarea></div></div>
    <div class="checks"><label><input type="checkbox" name="featured" ${d.featured ? 'checked' : ''}> Destacado en inicio</label><label><input type="checkbox" name="is_new" ${d.is_new ? 'checked' : ''}> Marcar como nuevo</label><label><input type="checkbox" name="active" ${d.active ? 'checked' : ''}> Publicado</label></div>
    <label class="f">Fotografías (la primera es la principal)</label><div class="imgs" id="imgs"></div><input type="file" id="up" accept="image/jpeg,image/png,image/webp" multiple><p class="hint">JPG, PNG o WebP. Se comprimen solas (máx. 1,4 MB cada una). Puedes subir varias a la vez.</p>
    <div style="display:flex;gap:.5rem;flex-wrap:wrap"><input class="input" id="imgurl" type="url" placeholder="…o pega el enlace de una foto (https://…)" style="flex:1;min-width:200px"><button type="button" class="btn tiny ghost" id="addurl">Agregar enlace</button></div>
    <label class="f" style="margin-top:.8rem">Presentaciones (opcional: si agregas, el precio e inventario salen de aquí)</label><div id="vs"></div><button type="button" class="btn tiny ghost" id="av">+ Agregar presentación</button>
    <div class="fg" style="margin-top:1rem"><div><label class="f">Características (una por línea)</label><textarea class="input" name="features" rows="4">${esc(d.features.join('\n'))}</textarea></div>
      <div><label class="f">Beneficios (uno por línea)</label><textarea class="input" name="benefits" rows="4">${esc(d.benefits.join('\n'))}</textarea></div>
      <div><label class="f">Especificaciones (formato: Nombre: valor)</label><textarea class="input" name="specs" rows="4">${esc(d.specs.map((s) => s.k + ': ' + s.v).join('\n'))}</textarea></div>
      <div><label class="f">Preguntas frecuentes (formato: Pregunta | Respuesta)</label><textarea class="input" name="faqs" rows="4">${esc(d.faqs.map((s) => s.q + ' | ' + s.a).join('\n'))}</textarea></div>
      <div><label class="f">Instrucciones de uso</label><textarea class="input" name="usage" rows="3">${esc(d.usage)}</textarea></div>
      <div><label class="f">Recomendaciones</label><textarea class="input" name="recommendations" rows="3">${esc(d.recommendations)}</textarea></div></div>
    <div id="pe"></div><div style="display:flex;gap:.6rem;justify-content:flex-end"><button type="button" class="btn ghost" id="c2">Cancelar</button><button class="btn">Guardar producto</button></div></form></div>`;
    document.body.appendChild(m);
    const close = () => m.remove(); $('#x', m).onclick = close; $('#c2', m).onclick = close;
    const drawImgs = () => { $('#imgs', m).innerHTML = images.map((u, i) => `<div class="im ${i ? '' : 'first'}"><img src="${esc(u)}" alt=""><button type="button" data-rm="${i}" aria-label="Quitar">×</button>${i ? `<button type="button" data-mk="${i}" style="top:auto;bottom:3px;right:3px;width:auto;border-radius:6px;padding:0 5px;font-size:.65rem">Principal</button>` : '<em>Principal</em>'}</div>`).join('');
      $$('[data-rm]', m).forEach((b) => b.onclick = () => { images.splice(+b.dataset.rm, 1); drawImgs(); });
      $$('[data-mk]', m).forEach((b) => b.onclick = () => { const [u] = images.splice(+b.dataset.mk, 1); images.unshift(u); drawImgs(); }); };
    drawImgs();
    $('#addurl', m).onclick = () => { const u = $('#imgurl', m).value.trim(); if (!/^https:\/\/[^\s"'()\\]+$/.test(u)) return toast('Escribe un enlace válido que empiece por https://'); images.push(u); $('#imgurl', m).value = ''; drawImgs(); };
    $('#up', m).onchange = guard(async (e) => { const f = new FormData(); for (const x of e.target.files) f.append('files', await prep(x)); const r = await api('/api/admin/upload', { method: 'POST', form: f }); images.push(...r.urls); drawImgs(); toast('Fotos subidas'); });
    const vs = $('#vs', m);
    const addV = (v = { id: '', name: '', price: '', stock: '' }) => { const r = document.createElement('div'); r.className = 'vrow'; r.dataset.id = v.id || '';
      r.innerHTML = `<input class="input" placeholder="Ej. 500 g" value="${esc(v.name)}" aria-label="Nombre"><input class="input" type="number" min="0" placeholder="Precio" value="${esc(v.price)}" aria-label="Precio"><input class="input" type="number" min="0" placeholder="Stock" value="${esc(v.stock)}" aria-label="Stock"><button type="button" class="btn tiny danger">×</button>`;
      $('button', r).onclick = () => r.remove(); vs.appendChild(r); };
    d.variants.forEach(addV); $('#av', m).onclick = () => addV();
    $('#pf', m).onsubmit = guard(async (e) => {
      e.preventDefault(); const f = e.target; const lines = (t) => t.split('\n').map((x) => x.trim()).filter(Boolean);
      const body = { name: f.name.value, category_id: f.category_id.value, price: f.price.value, compare_price: f.compare_price.value, stock: f.stock.value, weight_g: f.weight_g.value, short_desc: f.short_desc.value, description: f.description.value,
        featured: f.featured.checked, is_new: f.is_new.checked, active: f.active.checked, images, usage: f.usage.value, recommendations: f.recommendations.value,
        features: lines(f.features.value), benefits: lines(f.benefits.value),
        specs: lines(f.specs.value).map((l) => { const i = l.indexOf(':'); return i > 0 ? { k: l.slice(0, i), v: l.slice(i + 1) } : null; }).filter(Boolean),
        faqs: lines(f.faqs.value).map((l) => { const i = l.indexOf('|'); return i > 0 ? { q: l.slice(0, i), a: l.slice(i + 1) } : null; }).filter(Boolean),
        variants: $$('.vrow', m).map((r) => { const [n, pr, st] = $$('input', r); return { id: r.dataset.id, name: n.value, price: pr.value, stock: st.value }; }).filter((v) => v.name) };
      try { await api(p ? '/api/admin/products/' + p.id : '/api/admin/products', { method: p ? 'PUT' : 'POST', body }); close(); toast('Producto guardado'); refresh(); }
      catch (er) { $('#pe', m).innerHTML = `<div class="msg err">${esc(er.message)}</div>`; }
    });
  }

  // ---------- categorías ----------
  async function categorias() {
    const cats = await api('/api/admin/categories'); CATS = cats;
    main().innerHTML = `<h1>Categorías</h1><div class="box"><table class="t"><tr><th>Nombre</th><th>Descripción</th><th>Orden</th><th></th></tr>
      ${cats.map((c) => `<tr data-id="${c.id}"><td><input class="input" value="${esc(c.name)}" data-f="name"></td><td><input class="input" value="${esc(c.description)}" data-f="description"></td><td><input class="input" type="number" style="width:80px" value="${c.sort}" data-f="sort"></td>
      <td><div class="row-actions"><button class="btn tiny dark" data-s="${c.id}">Guardar</button><button class="btn tiny danger" data-d="${c.id}">Eliminar</button></div></td></tr>`).join('')}</table></div>
      <div class="box"><h3>Nueva categoría</h3><form id="cf" class="fg"><input class="input" name="name" placeholder="Nombre" required><input class="input" name="description" placeholder="Descripción corta"><button class="btn">Agregar</button></form></div>`;
    $$('[data-s]').forEach((b) => b.onclick = guard(async () => { const tr = b.closest('tr'); const g = (k) => $(`[data-f=${k}]`, tr).value; await api('/api/admin/categories/' + b.dataset.s, { method: 'PUT', body: { name: g('name'), description: g('description'), sort: g('sort') } }); toast('Guardado'); }));
    $$('[data-d]').forEach((b) => b.onclick = guard(async () => { if (!confirm('¿Eliminar la categoría? Los productos quedarán sin categoría.')) return; await api('/api/admin/categories/' + b.dataset.d, { method: 'DELETE' }); refresh(); }));
    $('#cf').onsubmit = guard(async (e) => { e.preventDefault(); await api('/api/admin/categories', { method: 'POST', body: { name: e.target.name.value, description: e.target.description.value } }); toast('Categoría creada'); refresh(); });
  }

  // ---------- pedidos ----------
  const STAT = ['pendiente', 'confirmado', 'preparando', 'enviado', 'entregado', 'cancelado'], PAY = ['pendiente', 'pagado', 'rechazado', 'reembolsado'];
  async function pedidos() {
    const filter = pedidos.f || '';
    const list = await api('/api/admin/orders' + (filter ? '?status=' + filter : ''));
    main().innerHTML = `<div class="bar"><h1>Pedidos</h1><select class="input" id="fs" style="width:auto"><option value="">Todos los estados</option>${STAT.map((s) => `<option ${s === filter ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      ${list.map((o) => `<div class="box"><div class="bar" style="margin-bottom:.4rem"><div><b>${esc(o.code)}</b> · ${esc(fdate(o.created_at))}<br><span style="color:var(--muted)">${esc(o.name)} · ${esc(o.phone)} · ${esc(o.email)}<br>${o.delivery_type === 'retiro' ? '<b>Retiro en el local</b>' : esc(o.address) + ', ' + esc(o.city)}${o.schedule ? '<br>Para: ' + esc(o.schedule) : ''}${o.notes ? '<br><i>Nota: ' + esc(o.notes) + '</i>' : ''}</span></div>
        <div style="text-align:right"><b style="font-size:1.2rem">${money(o.total)}</b><br><small>${esc(o.payment_method)}${o.coupon ? ' · cupón ' + esc(o.coupon) : ''}</small></div></div>
        <div>${o.items.map((i) => `${i.qty} × ${esc(i.name)}${i.variant_name ? ' (' + esc(i.variant_name) + ')' : ''}${i.note ? ' <i>[' + esc(i.note) + ']</i>' : ''}`).join(' · ')}</div>
        <div class="row-actions" style="margin-top:.8rem" data-o="${o.id}"><select class="input" style="width:auto" data-k="status">${STAT.map((s) => `<option ${s === o.status ? 'selected' : ''}>${s}</option>`).join('')}</select>
        <select class="input" style="width:auto" data-k="payment_status">${PAY.map((s) => `<option ${s === o.payment_status ? 'selected' : ''}>${s}</option>`).join('')}</select><button class="btn tiny dark" data-save>Actualizar</button>
        <a class="btn tiny wa" target="_blank" rel="noopener" href="https://wa.me/${esc(o.phone.replace(/\D/g, '').replace(/^(\d{10})$/, '57$1'))}?text=${encodeURIComponent('Hola ' + o.name + ', te escribimos de Don Ahumados sobre tu pedido ' + o.code)}">WhatsApp al cliente</a></div></div>`).join('') || '<div class="box">No hay pedidos.</div>'}`;
    $('#fs').onchange = (e) => { pedidos.f = e.target.value; refresh(); };
    $$('[data-save]').forEach((b) => b.onclick = guard(async () => { const w = b.closest('[data-o]'); await api('/api/admin/orders/' + w.dataset.o, { method: 'PUT', body: { status: $('[data-k=status]', w).value, payment_status: $('[data-k=payment_status]', w).value } }); toast('Pedido actualizado'); refresh(); }));
  }

  // ---------- clientes ----------
  async function clientes() {
    const list = await api('/api/admin/customers');
    main().innerHTML = `<h1>Clientes</h1><div class="box"><table class="t"><tr><th>Nombre</th><th>Correo</th><th>Teléfono</th><th>Ciudad</th><th>Pedidos</th><th>Total comprado</th><th>Registro</th></tr>
      ${list.map((c) => `<tr><td>${esc(c.name)}</td><td>${esc(c.email)}</td><td>${esc(c.phone)}</td><td>${esc(c.city)}</td><td>${c.orders}</td><td>${money(c.spent)}</td><td>${esc(String(c.created_at).slice(0, 10))}</td></tr>`).join('') || '<tr><td colspan="7">Aún no hay clientes registrados.</td></tr>'}</table></div>`;
  }

  // ---------- promociones ----------
  async function promos() {
    const list = await api('/api/admin/promotions');
    main().innerHTML = `<h1>Promociones y cupones</h1><div class="box"><table class="t"><tr><th>Código</th><th>Título</th><th>Descuento</th><th>Compra mínima</th><th>Vigencia</th><th>Banner</th><th>Activo</th><th></th></tr>
      ${list.map((p) => `<tr data-id="${p.id}"><td><b>${esc(p.code)}</b></td><td><input class="input" data-f="title" value="${esc(p.title)}"></td><td>${p.type === 'percent' ? p.value + '%' : money(p.value)}</td><td><input class="input" type="number" data-f="min_amount" style="width:110px" value="${p.min_amount}"></td>
      <td><input class="input" type="date" data-f="starts" value="${esc(p.starts)}"><input class="input" type="date" data-f="ends" value="${esc(p.ends)}" style="margin-top:.3rem"></td><td><input type="checkbox" data-f="show_banner" ${p.show_banner ? 'checked' : ''}></td><td><input type="checkbox" data-f="active" ${p.active ? 'checked' : ''}></td>
      <td><div class="row-actions"><button class="btn tiny dark" data-s="${p.id}">Guardar</button><button class="btn tiny danger" data-d="${p.id}">Eliminar</button></div></td></tr>`).join('') || '<tr><td colspan="8">No hay promociones.</td></tr>'}</table><p class="hint">Si marcas "Banner", el cupón aparece en el aviso superior de la tienda. Solo se muestra un banner a la vez.</p></div>
      <div class="box"><h3>Nueva promoción</h3><form id="pf" class="fg"><input class="input" name="code" placeholder="Código (ej. VERANO15)" required><input class="input" name="title" placeholder="Título (ej. Promo de verano)">
      <select class="input" name="type"><option value="percent">Porcentaje (%)</option><option value="fixed">Valor fijo (COP)</option></select><input class="input" type="number" min="1" name="value" placeholder="Valor" required><input class="input" type="number" min="0" name="min_amount" placeholder="Compra mínima (COP)">
      <input class="input" type="date" name="starts" aria-label="Inicio"><input class="input" type="date" name="ends" aria-label="Fin"><label class="checks"><input type="checkbox" name="show_banner"> Mostrar en banner</label><button class="btn">Crear</button></form></div>`;
    $$('[data-s]').forEach((b) => b.onclick = guard(async () => { const tr = b.closest('tr'); const g = (k) => $(`[data-f=${k}]`, tr); await api('/api/admin/promotions/' + b.dataset.s, { method: 'PUT', body: { title: g('title').value, min_amount: g('min_amount').value, starts: g('starts').value, ends: g('ends').value, show_banner: g('show_banner').checked, active: g('active').checked } }); toast('Guardado'); }));
    $$('[data-d]').forEach((b) => b.onclick = guard(async () => { if (!confirm('¿Eliminar la promoción?')) return; await api('/api/admin/promotions/' + b.dataset.d, { method: 'DELETE' }); refresh(); }));
    $('#pf').onsubmit = guard(async (e) => { e.preventDefault(); const f = e.target; await api('/api/admin/promotions', { method: 'POST', body: { code: f.code.value, title: f.title.value, type: f.type.value, value: f.value.value, min_amount: f.min_amount.value, starts: f.starts.value, ends: f.ends.value, show_banner: f.show_banner.checked } }); toast('Promoción creada'); refresh(); });
  }

  // ---------- envíos ----------
  async function envios() {
    const z = await api('/api/admin/shipping');
    main().innerHTML = `<h1>Zonas de envío</h1><div class="box"><p class="hint">Escribe las ciudades separadas por coma. Usa * para "resto del país". Si la compra supera el valor de envío gratis, el envío no se cobra (0 = nunca gratis).</p><table class="t"><tr><th>Zona</th><th>Ciudades</th><th>Costo</th><th>Gratis desde</th><th>Tiempo</th><th></th></tr>
      ${z.map((r) => `<tr data-id="${r.id}"><td><input class="input" data-f="name" value="${esc(r.name)}"></td><td><input class="input" data-f="cities" value="${esc(r.cities)}"></td><td><input class="input" type="number" data-f="fee" style="width:100px" value="${r.fee}"></td><td><input class="input" type="number" data-f="free_over" style="width:110px" value="${r.free_over}"></td><td><input class="input" data-f="eta" value="${esc(r.eta)}"></td>
      <td><div class="row-actions"><button class="btn tiny dark" data-s="${r.id}">Guardar</button><button class="btn tiny danger" data-d="${r.id}">Eliminar</button></div></td></tr>`).join('')}</table><button class="btn tiny" id="nz" style="margin-top:.8rem">+ Nueva zona</button></div>`;
    $$('[data-s]').forEach((b) => b.onclick = guard(async () => { const tr = b.closest('tr'); const g = (k) => $(`[data-f=${k}]`, tr).value; await api('/api/admin/shipping/' + b.dataset.s, { method: 'PUT', body: { name: g('name'), cities: g('cities'), fee: g('fee'), free_over: g('free_over'), eta: g('eta') } }); toast('Guardado'); }));
    $$('[data-d]').forEach((b) => b.onclick = guard(async () => { if (!confirm('¿Eliminar la zona?')) return; await api('/api/admin/shipping/' + b.dataset.d, { method: 'DELETE' }); refresh(); }));
    $('#nz').onclick = guard(async () => { await api('/api/admin/shipping', { method: 'POST', body: { name: 'Nueva zona', cities: 'Ciudad', fee: 15000 } }); refresh(); });
  }

  // ---------- contenido ----------
  async function contenido() {
    const [s, t] = await Promise.all([api('/api/admin/settings'), api('/api/admin/testimonials')]);
    const field = (k, label, big) => `<div class="${big ? 'full' : ''}"><label class="f">${label}</label>${big ? `<textarea class="input" name="${k}" rows="3">${esc(s[k])}</textarea>` : `<input class="input" name="${k}" value="${esc(s[k])}">`}</div>`;
    main().innerHTML = `<h1>Contenido del sitio</h1><form id="sf" class="box"><div class="fg">${field('store_name', 'Nombre de la tienda')}${field('tagline', 'Frase comercial')}${field('splash_title', 'Frase de la pantalla de inicio (usa *asteriscos* para la parte en cursiva)', 1)}${field('hero_kicker', 'Línea sobre el título de portada')}${field('footer_note', 'Nota del pie de página')}${field('announcement', 'Aviso superior')}${field('hero_title', 'Título de portada', 1)}${field('hero_subtitle', 'Subtítulo de portada', 1)}
      ${field('about', 'Texto "Nosotros"', 1)}${field('whatsapp', 'WhatsApp (con indicativo, solo números: 573117382868)')}${field('instagram', 'Usuario de Instagram (sin @)')}${field('email', 'Correo de contacto')}${field('address', 'Ubicación')}${field('cod_cities', 'Ciudades con pago contra entrega (separadas por coma)')}${field('seo_description', 'Descripción para buscadores (SEO)', 1)}${field('bank_info', 'Datos para pagos por transferencia', 1)}</div>
      <label class="f">Imagen de portada</label><div style="display:flex;gap:.8rem;align-items:center;flex-wrap:wrap;margin-bottom:1rem">${s.hero_image ? `<img id="hp" src="${esc(s.hero_image)}" alt="" style="height:70px;border-radius:10px">` : ''}<input type="file" id="hu" accept="image/*"></div>
      <label class="f">Logotipo (también se usa como marca de agua translúcida)</label><div style="display:flex;gap:.8rem;align-items:center;flex-wrap:wrap;margin-bottom:1rem">${s.logo ? `<img id="lp" src="${esc(s.logo)}" alt="" style="height:50px">` : ''}<input type="file" id="lu" accept="image/*"><button type="button" class="btn tiny ghost" id="lc">Quitar logo</button></div>
      <h3 style="margin-top:1rem">Beneficios de comprar en la tienda</h3><div id="bn"></div><button type="button" class="btn tiny ghost" id="ab">+ Agregar beneficio</button>
      <div style="text-align:right;margin-top:1rem"><button class="btn">Guardar cambios</button></div></form>
      <div class="box"><h3>Testimonios de clientes</h3>${t.map((x) => `<div class="bar" style="margin-bottom:.5rem"><span>${'★'.repeat(x.rating)} <b>${esc(x.name)}</b>: ${esc(x.text)}</span><button class="btn tiny danger" data-dt="${x.id}">Eliminar</button></div>`).join('')}
      <form id="tf" class="fg" style="margin-top:1rem"><input class="input" name="name" placeholder="Nombre del cliente" required><input class="input" name="text" placeholder="Comentario" required><select class="input" name="rating"><option>5</option><option>4</option><option>3</option></select><button class="btn">Agregar</button></form><p class="hint">Agrega únicamente testimonios reales de clientes que te hayan dado su autorización.</p></div>`;
    let hero = s.hero_image, logo = s.logo;
    const up = async (file) => { const f = new FormData(); f.append('files', await prep(file)); return (await api('/api/admin/upload', { method: 'POST', form: f })).urls[0]; };
    $('#hu').onchange = guard(async (e) => { hero = await up(e.target.files[0]); toast('Imagen cargada: recuerda guardar'); });
    $('#lu').onchange = guard(async (e) => { logo = await up(e.target.files[0]); toast('Logo cargado: recuerda guardar'); });
    $('#lc').onclick = () => { logo = ''; toast('Logo quitado: recuerda guardar'); };
    const bn = $('#bn'); const addB = (b = { t: '', d: '' }) => { const r = document.createElement('div'); r.className = 'vrow'; r.style.gridTemplateColumns = '1fr 2fr auto'; r.innerHTML = `<input class="input" placeholder="Título" value="${esc(b.t)}"><input class="input" placeholder="Descripción" value="${esc(b.d)}"><button type="button" class="btn tiny danger">×</button>`; $('button', r).onclick = () => r.remove(); bn.appendChild(r); };
    (s.benefits || []).forEach(addB); $('#ab').onclick = () => addB();
    $('#sf').onsubmit = guard(async (e) => { e.preventDefault(); const f = e.target; const body = { hero_image: hero, logo, benefits: $$('.vrow', bn).map((r) => { const [a, b] = $$('input', r); return { t: a.value, d: b.value }; }) };
      ['store_name', 'tagline', 'splash_title', 'hero_kicker', 'footer_note', 'announcement', 'hero_title', 'hero_subtitle', 'about', 'whatsapp', 'instagram', 'email', 'address', 'cod_cities', 'seo_description', 'bank_info'].forEach((k) => { body[k] = f[k].value; });
      await api('/api/admin/settings', { method: 'PUT', body }); toast('Cambios publicados en la tienda'); });
    $$('[data-dt]').forEach((b) => b.onclick = guard(async () => { await api('/api/admin/testimonials/' + b.dataset.dt, { method: 'DELETE' }); refresh(); }));
    $('#tf').onsubmit = guard(async (e) => { e.preventDefault(); const f = e.target; await api('/api/admin/testimonials', { method: 'POST', body: { name: f.name.value, text: f.text.value, rating: f.rating.value } }); refresh(); });
  }

  // ---------- apariencia: colores, fondo y logo translúcido ----------
  async function apariencia() {
    const s = await api('/api/admin/settings'); const T = DATheme;
    const st = { bg_color: T.ok(s.bg_color, '#0B1F25'), accent_color: T.ok(s.accent_color, '#E8772E'), bg_image: s.bg_image || '', bg_dim: Number(s.bg_dim ?? 80), watermark: s.watermark || '', watermark_mode: s.watermark_mode || 'tile', watermark_size: Number(s.watermark_size || 240), watermark_opacity: s.watermark_opacity === '' || s.watermark_opacity == null ? 4 : Number(s.watermark_opacity) };
    const thumb = (u) => (u ? `<img src="${esc(u)}" alt="" style="height:64px;max-width:160px;object-fit:cover;border-radius:10px;border:1px solid var(--line);background:#8884">` : '<span class="hint">Sin imagen</span>');
    main().innerHTML = `<h1>Apariencia</h1><div class="ap"><form id="apf" class="box">
      <h3>Colores</h3><div class="fg"><div><label class="f" for="bgc">Color de fondo</label><input class="input" type="color" id="bgc" style="height:48px;padding:.25rem"></div><div><label class="f" for="acc">Color de acento (botones y detalles)</label><input class="input" type="color" id="acc" style="height:48px;padding:.25rem"></div></div>
      <p class="hint">Si eliges un fondo claro, la tienda cambia sola a letras oscuras.</p>
      <h3 style="margin-top:1.4rem">Imagen de fondo de la página</h3><div style="display:flex;gap:.8rem;align-items:center;flex-wrap:wrap;margin-bottom:.6rem"><span id="bgp"></span><input type="file" id="bgu" accept="image/*"><button type="button" class="btn tiny ghost" id="bgx">Quitar imagen</button></div>
      <label class="f" for="bgd">Oscurecer la imagen: <b id="bgdv"></b>%</label><input type="range" id="bgd" min="0" max="100" step="5" style="width:100%">
      <h3 style="margin-top:1.4rem">Logo translúcido en el fondo</h3><div style="display:flex;gap:.8rem;align-items:center;flex-wrap:wrap;margin-bottom:.6rem"><span id="wmp"></span><input type="file" id="wmu" accept="image/png,image/webp"><button type="button" class="btn tiny dark" id="wmd">Usar el logo de Don Ahumados</button><button type="button" class="btn tiny ghost" id="wmx">Quitar</button></div>
      <p class="hint">Si subes otro logo, usa un PNG o WebP con fondo transparente.</p>
      <label class="f" for="wmm">Distribución</label><select class="input" id="wmm"><option value="tile">Repetido en todo el fondo</option><option value="center">Uno grande al centro</option></select>
      <label class="f" for="wms" style="margin-top:.8rem">Tamaño de cada logo (si se repite): <b id="wmsv"></b> px</label><input type="range" id="wms" min="80" max="400" step="10" style="width:100%">
      <label class="f" for="wmo" style="margin-top:.8rem">Qué tan visible es: <b id="wmov"></b>%</label><input type="range" id="wmo" min="0" max="20" step="0.5" style="width:100%">
      <div id="ape"></div><div style="text-align:right;margin-top:1.2rem"><button class="btn">Guardar y publicar</button></div></form>
      <div class="sticky"><div class="box"><h3>Vista previa</h3><div id="pvw" style="position:relative;overflow:hidden;border-radius:14px;min-height:420px;border:1px solid var(--line)"></div><p class="hint" style="margin-top:.6rem">Así se verá la tienda. Al guardar se publica al instante.</p></div></div></div>`;
    const $i = (id) => $('#' + id);
    const paint = () => {
      const v = T.themeVars(st.bg_color, st.accent_color); const pv = $i('pvw');
      Object.entries(v).forEach(([k, x]) => pv.style.setProperty(k, x));
      const veil = `color-mix(in srgb, var(--bg) ${st.bg_dim}%, transparent)`;
      const wm = st.watermark ? `<div style="position:absolute;inset:0;pointer-events:none;opacity:${st.watermark_opacity / 100};background:url(${JSON.stringify(st.watermark)}) center / ${st.watermark_mode === 'center' ? '70% auto' : Math.round(st.watermark_size * 0.55) + 'px auto'} ${st.watermark_mode === 'center' ? 'no-repeat' : 'space'}"></div>` : '';
      pv.innerHTML = `<div style="position:absolute;inset:0;background:${st.bg_image ? `linear-gradient(${veil},${veil}),url(${JSON.stringify(st.bg_image)}) center / cover` : 'var(--bg)'}"></div>
        <div style="position:relative;padding:1.2rem;color:var(--text);font-family:var(--sans)"><div style="font:600 .62rem var(--sans);letter-spacing:.18em;color:var(--accent);text-transform:uppercase">Cali · Retiro y delivery</div>
        <div style="font:500 1.7rem/1.1 var(--serif);margin:.4rem 0 .8rem">Humo, leña y <em style="color:var(--accent)">mucho sabor.</em></div>
        <span style="display:inline-block;background:var(--accent);color:var(--ink);font:600 .8rem var(--sans);padding:.5rem 1rem;border-radius:99px">Elegir mi comida →</span>
        <div style="margin-top:1.2rem;background:var(--surface);border-radius:14px;padding:.9rem"><div style="font:500 1rem var(--serif)">Tocineta artesanal ahumada</div><div style="color:var(--muted);font-size:.8rem">Ahumada lentamente, empacada al vacío.</div><div style="margin-top:.5rem;font-weight:600">$ 32.000</div></div>
        <div style="margin-top:.7rem;background:var(--surface);border-radius:14px;padding:.9rem"><div style="font:500 1rem var(--serif)">Costillas de cerdo ahumadas</div><div style="color:var(--muted);font-size:.8rem">Tiernas, se desprenden del hueso.</div><div style="margin-top:.5rem;font-weight:600">$ 26.000</div></div></div>${wm}`;
      $i('bgp').innerHTML = thumb(st.bg_image); $i('wmp').innerHTML = thumb(st.watermark);
      $i('bgdv').textContent = st.bg_dim; $i('wmsv').textContent = st.watermark_size; $i('wmov').textContent = st.watermark_opacity;
    };
    $i('bgc').value = st.bg_color; $i('acc').value = st.accent_color; $i('bgd').value = st.bg_dim; $i('wmm').value = st.watermark_mode; $i('wms').value = st.watermark_size; $i('wmo').value = st.watermark_opacity;
    const bind = (id, key, num) => $i(id).oninput = (e) => { st[key] = num ? Number(e.target.value) : e.target.value; paint(); };
    bind('bgc', 'bg_color'); bind('acc', 'accent_color'); bind('bgd', 'bg_dim', 1); bind('wmm', 'watermark_mode'); bind('wms', 'watermark_size', 1); bind('wmo', 'watermark_opacity', 1);
    const up = async (file) => { const f = new FormData(); f.append('files', await prep(file)); return (await api('/api/admin/upload', { method: 'POST', form: f })).urls[0]; };
    $i('bgu').onchange = guard(async (e) => { st.bg_image = await up(e.target.files[0]); paint(); });
    $i('wmu').onchange = guard(async (e) => { st.watermark = await up(e.target.files[0]); paint(); });
    $i('bgx').onclick = () => { st.bg_image = ''; paint(); };
    $i('wmx').onclick = () => { st.watermark = ''; paint(); };
    $i('wmd').onclick = () => { st.watermark = '/assets/logo-mark.webp'; paint(); };
    $i('apf').onsubmit = guard(async (e) => { e.preventDefault(); try { await api('/api/admin/settings', { method: 'PUT', body: Object.fromEntries(Object.entries(st).map(([k, v]) => [k, String(v)])) }); toast('Apariencia publicada en la tienda'); } catch (er) { $i('ape').innerHTML = `<div class="msg err">${esc(er.message)}</div>`; } });
    paint();
  }

  // ---------- administradores ----------
  async function usuarios() {
    const list = await api('/api/admin/admins');
    main().innerHTML = `<h1>Administradores</h1><div class="box"><table class="t"><tr><th>Nombre</th><th>Usuario</th><th></th></tr>${list.map((a) => `<tr><td>${esc(a.name)}</td><td>${esc(a.email)}</td><td>${a.email === ME.email ? '<small>(tú)</small>' : `<button class="btn tiny danger" data-d="${a.id}">Eliminar</button>`}</td></tr>`).join('')}</table></div>
      <div class="box"><h3>Agregar administrador</h3><form id="af" class="fg"><input class="input" name="name" placeholder="Nombre" required><input class="input" name="email" placeholder="Usuario" autocomplete="off" required><input class="input" name="password" type="password" placeholder="Contraseña (mín. 8)" minlength="8" autocomplete="new-password" required><button class="btn">Crear</button></form>
      <p class="hint">Para cambiar tu propia contraseña, entra a "Mi cuenta" en la tienda.</p></div>`;
    $$('[data-d]').forEach((b) => b.onclick = guard(async () => { if (!confirm('¿Eliminar este administrador?')) return; await api('/api/admin/admins/' + b.dataset.d, { method: 'DELETE' }); refresh(); }));
    $('#af').onsubmit = guard(async (e) => { e.preventDefault(); const f = e.target; await api('/api/admin/admins', { method: 'POST', body: { name: f.name.value, email: f.email.value, password: f.password.value } }); toast('Administrador creado'); refresh(); });
  }

  const VIEWS = { resumen, productos, categorias, pedidos, clientes, promos, envios, contenido, apariencia, usuarios };

  async function start() {
    try { ME = (await api('/api/me')).user; } catch { ME = null; }
    if (!ME) return loginView();
    if (ME.role !== 'admin') return loginView('Esta cuenta no tiene permisos de administrador.');
    shell();
  }
  start();
})();
