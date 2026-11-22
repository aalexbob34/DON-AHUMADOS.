'use strict';
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (s) => esc(s).replace(/\*(.+?)\*/g, '<em>$1</em>'); // *texto* -> cursiva con acento
  const money = (n) => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n || 0);
  const store = { get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} } };
  const app = $('#app');
  let S = {}, CATS = [], PRODS = [];

  async function api(url, opts = {}) {
    const o = { method: opts.method || 'GET', headers: {}, credentials: 'same-origin' };
    if (opts.body !== undefined) { o.headers['Content-Type'] = 'application/json'; o.body = JSON.stringify(opts.body); }
    const r = await fetch(url, o); let d = {}; try { d = await r.json(); } catch (_) {}
    if (!r.ok) throw new Error(d.error || 'Ocurrió un error. Inténtalo de nuevo.');
    return d;
  }
  function toast(m) { const t = $('#toast'); t.textContent = m; t.classList.add('show'); clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2400); }
  const waNumber = () => (S.whatsapp || '').replace(/\D/g, '');
  const waUrl = (text) => `https://wa.me/${waNumber()}?text=${encodeURIComponent(text)}`;
  const ico = { flame: '<svg width="22" height="22" viewBox="0 0 64 64" aria-hidden="true"><path d="M32 8c7 11 16 16 16 29a16 16 0 0 1-32 0c0-7 3-11 7-15 1 6 5 8 7 9-2-9 0-16 2-23z" fill="#E8772E"/></svg>' };

  // ---------- pedido (carrito) ----------
  const Cart = {
    get() { return store.get('da_cart', []); },
    set(c) { store.set('da_cart', c); badge(); },
    count() { return this.get().reduce((a, i) => a + i.qty, 0); },
    add(it) {
      const c = this.get(); const f = c.find((i) => i.productId === it.productId && (i.variantId || 0) === (it.variantId || 0) && (i.note || '') === (it.note || ''));
      if (f) f.qty = Math.min(99, f.qty + it.qty); else c.push(it); this.set(c);
    },
    setQty(i, q) { const c = this.get(); if (q < 1) c.splice(i, 1); else c[i].qty = Math.min(99, q); this.set(c); },
    clear() { this.set([]); },
  };
  const badge = () => { const n = $('#cartN'); if (n) n.textContent = Cart.count(); };
  const form = Object.assign({ delivery_type: 'delivery', name: '', phone: '', city: 'Cali', address: '', reference: '', when: 'asap', time: '', pay: 'whatsapp', notes: '', coupon: '' }, store.get('da_form', {}));
  const saveForm = () => store.set('da_form', { ...form, coupon: '' });

  // ---------- tema: colores, imagen de fondo y logo translúcido (se configuran en /admin > Apariencia) ----------
  function applyTheme() {
    const root = document.documentElement.style;
    Object.entries(window.DATheme.themeVars(S.bg_color, S.accent_color)).forEach(([k, v]) => root.setProperty(k, v));
    const layer = (id, cls) => { let el = document.getElementById(id); if (!el) { el = document.createElement('div'); el.id = id; el.className = cls; el.setAttribute('aria-hidden', 'true'); document.body.prepend(el); } return el; };
    const old = (id) => { const el = document.getElementById(id); if (el) el.remove(); };
    if (S.bg_image) {
      const dim = Math.max(0, Math.min(100, Number(S.bg_dim ?? 80)));
      const veil = `color-mix(in srgb, var(--bg) ${dim}%, transparent)`;
      layer('bgimg', 'bgimg').style.background = `linear-gradient(${veil}, ${veil}), url(${JSON.stringify(S.bg_image)}) center / cover no-repeat`;
    } else old('bgimg');
    if (S.watermark) {
      const w = layer('wm', 'watermark'); const size = Math.max(80, Math.min(600, Number(S.watermark_size || 240)));
      const o = Number(S.watermark_opacity); w.style.opacity = String((Number.isFinite(o) && S.watermark_opacity !== '' && S.watermark_opacity != null ? o : 4) / 100);
      w.style.backgroundImage = `url(${JSON.stringify(S.watermark)})`; w.style.backgroundPosition = 'center';
      if (S.watermark_mode === 'center') { w.style.backgroundRepeat = 'no-repeat'; w.style.backgroundSize = 'min(560px, 72vw) auto'; }
      else { w.style.backgroundRepeat = 'space'; w.style.backgroundSize = `${size}px auto`; }
    } else old('wm');
  }

  // ---------- estructura común ----------
  function brandHtml() {
    const n = esc(S.store_name || 'Don Ahumados');
    return `${S.logo ? `<img class="badge" src="${esc(S.logo)}" alt="">` : `<span class="mark">${ico.flame}</span>`}<b>${n}</b>`;
  }
  function chrome() {
    const h = $('#header'); h.hidden = false;
    h.innerHTML = `<div class="wrap"><a class="brand" href="/carta" data-link aria-label="${esc(S.store_name)}, la carta">${brandHtml()}</a>
      <nav class="nav" aria-label="Principal"><a href="/carta#carta" data-link>La carta</a><a href="/carta#salsas" data-link>Salsas</a><a href="/carta#como-pedir" data-link>Cómo pedir</a></nav>
      <button class="cart-btn" id="openCart" aria-label="Abrir mi pedido">Mi pedido <span class="n" id="cartN">0</span></button></div>`;
    $('#openCart').onclick = () => openDrawer();
    const a = $('#announce'), b = S.banner;
    const msg = b ? `${b.title || 'Promoción'}: cupón ${b.code} (${b.type === 'percent' ? b.value + '% de descuento' : money(b.value) + ' de descuento'}${b.min_amount ? ' desde ' + money(b.min_amount) : ''})` : S.announcement;
    a.hidden = !msg; a.textContent = msg || '';
    const f = $('#footer'); f.hidden = false;
    f.innerHTML = `<div class="wrap"><a class="brand" href="/carta" data-link>${brandHtml()}</a><h3>Nos encontramos por <em>WhatsApp</em></h3>
      <div class="links"><a href="${esc(waUrl('Hola, quiero hacer un pedido'))}" target="_blank" rel="noopener">WhatsApp</a>${S.instagram ? `<a href="https://instagram.com/${esc(S.instagram)}" target="_blank" rel="noopener">Instagram @${esc(S.instagram)}</a>` : ''}${S.email ? `<a href="mailto:${esc(S.email)}">${esc(S.email)}</a>` : ''}<a href="/seguimiento" data-link>Seguir mi pedido</a><a href="/admin">Administrador</a></div>
      <small>${esc(S.footer_note)}</small></div>`;
    badge();
  }
  const lock = (on) => document.body.classList.toggle('lock', on);
  function closeAll() { $('#modal').classList.remove('on'); $('#drawer').classList.remove('on'); $('#scrim').classList.remove('on'); lock(false); if (location.pathname.startsWith('/producto/')) { history.replaceState(null, '', '/carta'); document.title = `La carta | ${S.store_name}`; } }
  $('#scrim').onclick = closeAll;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeAll(); });

  // ---------- tarjetas ----------
  const tagOf = (p) => (!p.available ? '<span class="tag dim">Agotado</span>' : p.is_new ? '<span class="tag">Nuevo</span>' : p.compare_price > p.price ? '<span class="tag">Oferta</span>' : '');
  const priceHtml = (p) => `${p.variants.length ? 'Desde ' : ''}${money(p.price)}${p.compare_price > p.price ? `<small>${money(p.compare_price)}</small>` : ''}`;
  const pcard = (p) => `<button class="pcard ${p.available ? '' : 'off'}" data-open="${esc(p.slug)}" aria-label="${esc(p.name)}, ${money(p.price)}"><div class="ph">${p.images[0] ? `<img src="${esc(p.images[0])}" alt="" loading="lazy">` : ''}${tagOf(p)}</div>
    <div class="bd"><h4>${esc(p.name)}</h4><p>${esc(p.short_desc)}</p><div class="pl"><span class="price">${priceHtml(p)}</span><span class="plus" aria-hidden="true">+</span></div></div></button>`;
  const feat = (p) => `<button class="feat" data-open="${esc(p.slug)}"><div class="ph">${p.images[0] ? `<img src="${esc(p.images[0])}" alt="" loading="lazy">` : ''}<span class="tag">Los favoritos de la casa</span></div>
    <div class="bd"><h3>${esc(p.name)}</h3><p>${esc(p.short_desc)}</p><div class="pl"><span class="price">${priceHtml(p)}</span><span class="plus" aria-hidden="true">+</span></div></div></button>`;
  const arrows = (id) => `<div class="arrows"><button class="arrow" data-car="${id}" data-dir="-1" aria-label="Anterior">‹</button><button class="arrow" data-car="${id}" data-dir="1" aria-label="Siguiente">›</button></div>`;

  // ---------- páginas ----------
  function splash() {
    document.title = `${S.store_name} | ${S.tagline}`;
    $('#header').hidden = true; $('#footer').hidden = true; $('#announce').hidden = true;
    app.innerHTML = `<section class="splash"><div class="wrap fade"><div class="logo ${S.logo ? 'img' : ''}">${S.logo ? `<img src="${esc(S.logo)}" alt="${esc(S.store_name)}">` : ico.flame.replace('width="22" height="22"', 'width="46" height="46"')}</div>
      <p class="kicker">${esc(S.hero_kicker)}</p><h1>${fmt(S.splash_title || S.tagline)}</h1><a class="btn" href="/carta" data-link>Comenzar →</a><p class="hint">Toca para ver la carta</p>
      <div class="links"><a href="${esc(waUrl('Hola, quiero hacer un pedido'))}" target="_blank" rel="noopener">WhatsApp</a>${S.instagram ? `<a href="https://instagram.com/${esc(S.instagram)}" target="_blank" rel="noopener">@${esc(S.instagram)}</a>` : ''}</div></div></section>`;
  }

  async function carta(openSlug) {
    chrome(); document.title = `La carta | ${S.store_name}`;
    if (!PRODS.length) PRODS = await api('/api/products?limit=100');
    const sauces = PRODS.filter((p) => p.category_slug === 'salsas');
    const menuCats = CATS.filter((c) => c.slug !== 'salsas' && PRODS.some((p) => p.category_slug === c.slug));
    const favs = PRODS.filter((p) => p.featured && p.available); const fav = favs.length ? favs : PRODS.filter((p) => p.available).slice(0, 4);
    const uncategorized = PRODS.filter((p) => !p.category_slug);
    app.innerHTML = `
    <section class="hero">${S.hero_image ? `<img class="hero-img" src="${esc(S.hero_image)}" alt="">` : ''}<div class="wrap fade"><p class="kicker">${esc(S.hero_kicker)}</p><h1>${fmt(S.hero_title)}</h1><p class="lead">${esc(S.hero_subtitle)}</p>
      <div class="row"><a class="btn" href="#carta">Elegir mi comida →</a><a class="btn ghost" href="#antojo">Ver los favoritos</a></div></div></section>
    ${fav.length ? `<section class="section" id="antojo" style="padding-bottom:1rem"><div class="wrap"><div class="sec-head"><div><p class="kicker">El antojo de hoy</p><h2>Los favoritos <em>de la casa</em></h2></div>${arrows('c1')}</div><div class="car"><div class="track" id="c1">${fav.map(feat).join('')}</div></div></div></section>` : ''}
    <section class="section" style="padding-bottom:0"><div class="wrap"><div class="sec-head"><div><p class="kicker">Encuentra tu favorito</p><h2>¿Qué se te antoja hoy?</h2></div>${arrows('c2')}</div>
      <div class="car"><div class="track chips" id="c2">${menuCats.concat(sauces.length ? [{ slug: 'salsas', name: 'Salsas' }] : []).map((c) => `<a class="chip" href="#${c.slug === 'salsas' ? 'salsas' : 'cat-' + esc(c.slug)}">${esc(c.name)}</a>`).join('')}</div></div></div></section>
    <section class="section" id="carta"><div class="wrap"><div class="sec-head"><div><p class="kicker">Pequeños detalles · grandes antojos</p><h2>La carta</h2></div></div><p class="note">Imágenes referenciales. Precios en pesos colombianos.</p>
      ${menuCats.map((c) => { const l = PRODS.filter((p) => p.category_slug === c.slug); return `<div class="cat" id="cat-${esc(c.slug)}"><h3>${esc(c.name)} <span>${l.length} ${l.length === 1 ? 'producto' : 'productos'}</span></h3>${c.description ? `<p class="sub">${esc(c.description)}</p>` : ''}<div class="pgrid">${l.map(pcard).join('')}</div></div>`; }).join('')}
      ${uncategorized.length ? `<div class="cat"><h3>Más productos</h3><div class="pgrid">${uncategorized.map(pcard).join('')}</div></div>` : ''}</div></section>
    ${sauces.length ? `<section class="section sauces" id="salsas"><div class="wrap"><div class="sec-head"><div><p class="kicker">Salsas</p><h2>El sabor da <em>otra vuelta.</em></h2><p class="sub">${sauces.length === 1 ? 'Una salsa' : sauces.length + ' salsas'} de la casa. Agrégalas a tu pedido en un toque.</p></div><div style="display:flex;gap:1rem;align-items:center"><span class="counter" id="cnt">01 / ${String(sauces.length).padStart(2, '0')}</span>${arrows('c3')}</div></div>
      <div class="car"><div class="track" id="c3">${sauces.map((p) => `<div class="scard"><h3>${esc(p.name)}</h3><p>${esc(p.short_desc)}</p>${p.available ? `<button class="btn" data-quick="${p.id}">Agregar salsa · ${money(p.price)}</button><span class="legend">Simple y rápido</span>` : '<span class="tag dim" style="align-self:flex-start">Agotado</span>'}</div>`).join('')}</div></div></div></section>` : ''}
    <section class="section" id="como-pedir"><div class="wrap"><div class="sec-head"><div><p class="kicker">Cómo pedir</p><h2>Tres pasos, <em>sin complicaciones.</em></h2></div></div>
      <div class="steps"><div class="step"><b>1</b><h3>Elige y arma</h3><p>Escoge tus productos, la presentación y escribe una nota si quieres algo especial.</p></div>
      <div class="step"><b>2</b><h3>Revisa tu pedido</h3><p>Ajusta cantidades y elige retiro en el local o delivery.</p></div>
      <div class="step"><b>3</b><h3>Envía por WhatsApp</h3><p>Revisas la comanda y la envías. El local confirma disponibilidad, tiempo y total.</p></div></div></div></section>`;
    // carruseles
    $$('[data-car]').forEach((b) => b.onclick = () => { const t = $('#' + b.dataset.car); t.scrollBy({ left: b.dataset.dir * t.clientWidth * 0.8, behavior: 'smooth' }); });
    const c3 = $('#c3'); if (c3) c3.addEventListener('scroll', () => { const w = c3.firstElementChild.offsetWidth + 16; $('#cnt').textContent = `${String(Math.min(sauces.length, Math.round(c3.scrollLeft / w) + 1)).padStart(2, '0')} / ${String(sauces.length).padStart(2, '0')}`; }, { passive: true });
    $$('[data-open]').forEach((b) => b.onclick = () => openProduct(b.dataset.open));
    $$('[data-quick]').forEach((b) => b.onclick = () => { const p = PRODS.find((x) => x.id === +b.dataset.quick); Cart.add({ productId: p.id, variantId: null, qty: 1, name: p.name, image: p.images[0] || '', variantName: '', note: '', price: p.price }); toast(`${p.name} agregada a tu pedido`); });
    if (openSlug) openProduct(openSlug); else if (location.hash) setTimeout(() => { const el = $(location.hash); el && el.scrollIntoView(); }, 50);
  }

  // ---------- modal "A tu gusto" ----------
  async function openProduct(slug) {
    let p; try { p = await api('/api/products/' + encodeURIComponent(slug)); } catch (e) { return toast(e.message); }
    document.title = `${p.name} | ${S.store_name}`; history.replaceState(null, '', '/producto/' + p.slug);
    let vi = p.variants.length ? Math.max(0, p.variants.findIndex((v) => v.stock > 0)) : -1, qty = 1, note = '';
    const m = $('#modal');
    const draw = () => {
      const v = vi >= 0 ? p.variants[vi] : null, price = v ? v.price : p.price, stock = v ? v.stock : p.stock;
      m.innerHTML = `<button class="x" aria-label="Cerrar" id="mx">✕</button><div class="ph">${p.images[0] ? `<img src="${esc(p.images[0])}" alt="${esc(p.name)}">` : ''}</div><div class="in">
        <p class="kicker" style="margin-bottom:.4rem">A tu gusto</p><h3>${esc(p.name)}</h3><p class="sub">${esc(p.short_desc)}</p>
        <div class="price" style="font-size:1.3rem;margin-top:.6rem">${money(price)}${p.compare_price > price ? `<small>${money(p.compare_price)}</small>` : ''}</div>
        ${p.variants.length ? `<span class="lbl">Presentación</span><div class="opts" role="radiogroup" aria-label="Presentación">${p.variants.map((x, i) => `<button class="opt ${i === vi ? 'on' : ''}" role="radio" aria-checked="${i === vi}" data-v="${i}" ${x.stock < 1 ? 'disabled' : ''}>${esc(x.name)} · ${money(x.price)}</button>`).join('')}</div>` : ''}
        <label class="lbl" for="pnote">Nota para este producto (opcional)</label><textarea class="input" id="pnote" rows="2" maxlength="200" placeholder="Ej. cortado en tiras, poca sal…">${esc(note)}</textarea>
        <div class="addrow"><div class="qty"><button data-q="-1" aria-label="Menos">−</button><span aria-live="polite">${qty}</span><button data-q="1" aria-label="Más">+</button></div>
          <button class="btn" id="madd" ${stock < 1 ? 'disabled' : ''}>${stock < 1 ? 'Agotado' : `Agregar · ${money(price * qty)}`}</button></div>
        <p class="fine">${stock > 0 ? (stock <= 5 ? `Quedan solo ${stock}. ` : '') + 'Ya casi está: revisas todo antes de enviar.' : 'Escríbenos por WhatsApp para consultar disponibilidad.'}</p>
        <details class="more"><summary>Ver detalles del producto</summary>
          ${p.description ? `<h4>Descripción</h4><p>${esc(p.description)}</p>` : ''}
          ${p.features.length ? `<h4>Características</h4><ul>${p.features.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
          ${p.benefits.length ? `<h4>Beneficios</h4><ul>${p.benefits.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
          ${p.specs.length ? `<h4>Especificaciones</h4>${p.specs.map((x) => `<p><b>${esc(x.k)}:</b> ${esc(x.v)}</p>`).join('')}` : ''}
          ${p.usage ? `<h4>Instrucciones de uso</h4><p>${esc(p.usage)}</p>` : ''}
          ${p.recommendations ? `<h4>Recomendaciones</h4><p>${esc(p.recommendations)}</p>` : ''}
          ${p.faqs.length ? `<h4>Preguntas frecuentes</h4>${p.faqs.map((f) => `<p><b>${esc(f.q)}</b><br>${esc(f.a)}</p>`).join('')}` : ''}
          <p style="margin-top:1rem"><a href="${esc(waUrl('Hola, quiero consultar por: ' + p.name))}" target="_blank" rel="noopener" style="color:var(--accent2)">Consultar por WhatsApp</a></p></details></div>`;
      $('#mx').onclick = closeAll;
      $$('[data-v]', m).forEach((b) => b.onclick = () => { note = $('#pnote').value; vi = +b.dataset.v; qty = 1; draw(); });
      $$('[data-q]', m).forEach((b) => b.onclick = () => { note = $('#pnote').value; qty = Math.max(1, Math.min(stock || 1, qty + +b.dataset.q)); draw(); });
      $('#madd').onclick = () => { Cart.add({ productId: p.id, variantId: v ? v.id : null, qty, name: p.name, image: p.images[0] || '', variantName: v ? v.name : '', note: $('#pnote').value.trim(), price }); closeAll(); toast('Agregado a tu pedido'); };
    };
    draw(); m.classList.add('on'); $('#scrim').classList.add('on'); lock(true); m.scrollTop = 0; $('#mx').focus();
  }

  // ---------- panel "Tu pedido" ----------
  let QUOTE = null;
  const lineOf = (i) => { const p = PRODS.find((x) => x.id === i.productId); const v = p && p.variants.find((x) => x.id === i.variantId); return (v ? v.price : p ? p.price : i.price) * i.qty; };
  async function getQuote() {
    const items = Cart.get().map((i) => ({ productId: i.productId, variantId: i.variantId, qty: i.qty, note: i.note }));
    if (!items.length) return null;
    return api('/api/cart/quote', { method: 'POST', body: { items, city: form.city, coupon: form.coupon, delivery_type: form.delivery_type } });
  }
  function message(code) {
    const c = Cart.get(); const q = QUOTE;
    const L = [`Hola ${S.store_name}, quiero hacer este pedido${code ? ' (' + code + ')' : ''}:`, ''];
    c.forEach((i) => { L.push(`• ${i.qty} x ${i.name}${i.variantName ? ' (' + i.variantName + ')' : ''} — ${money(lineOf(i))}`); if (i.note) L.push(`   Nota: ${i.note}`); });
    L.push('', form.delivery_type === 'retiro' ? 'Entrega: Retiro en el local' : `Entrega: Delivery — ${form.address}, ${form.city}${form.reference ? ' (' + form.reference + ')' : ''}`);
    L.push(`Para cuándo: ${form.when === 'asap' ? 'Lo antes posible' : form.time ? form.time.replace('T', ' ') : 'Por coordinar'}`);
    L.push(`Pago: ${{ whatsapp: 'Se coordina con el local', transferencia: 'Transferencia', contraentrega: 'Contra entrega', wompi: 'En línea' }[form.pay]}`);
    if (q) { L.push('', `Subtotal: ${money(q.subtotal)}`); if (q.discount) L.push(`Descuento: -${money(q.discount)}`); if (form.delivery_type === 'delivery') L.push(`Envío: ${q.shipping ? money(q.shipping) : 'Gratis'}`); L.push(`Total: ${money(q.total)}`); }
    L.push('', `Nombre: ${form.name}`, `Teléfono: ${form.phone}`); if (form.notes) L.push(`Notas: ${form.notes}`);
    return L.join('\n');
  }
  function openDrawer(step = 'form') {
    const d = $('#drawer'); d.classList.add('on'); $('#scrim').classList.add('on'); lock(true); drawStep(step);
  }
  async function drawStep(step, err) {
    const d = $('#drawer'); const c = Cart.get();
    if (!c.length) { d.innerHTML = `<div class="dh"><h3>Tu pedido</h3><button class="x" style="position:static" aria-label="Cerrar" id="dx">✕</button></div><div class="db"><div class="empty"><p>Tu pedido está vacío.</p><button class="btn" id="dgo">Ver la carta</button></div></div>`; $('#dx').onclick = closeAll; $('#dgo').onclick = () => { closeAll(); if (location.pathname !== '/carta') navigate('/carta'); }; return; }
    try { QUOTE = await getQuote(); } catch (e) { QUOTE = null; err = err || e.message; if (/cup/i.test(e.message)) form.coupon = ''; }
    if (step === 'review') return review(err);
    const del = form.delivery_type === 'delivery';
    const cod = (S.cod_cities || '').split(',').some((x) => x.trim().toLowerCase() === form.city.trim().toLowerCase()) && del;
    const pays = [['whatsapp', 'Coordinar con el local'], ['transferencia', 'Transferencia']].concat(cod ? [['contraentrega', 'Contra entrega']] : [], S.payments && S.payments.wompi ? [['wompi', 'Pagar en línea']] : []);
    if (!pays.some((p) => p[0] === form.pay)) form.pay = 'whatsapp';
    d.innerHTML = `<div class="dh"><h3>Tu pedido</h3><button class="x" style="position:static" aria-label="Cerrar" id="dx">✕</button></div>
    <div class="db">${c.map((i, idx) => `<div class="item"><img src="${esc(i.image)}" alt=""><div><b>${esc(i.name)}</b>${i.variantName ? `<small>${esc(i.variantName)}</small>` : ''}${i.note ? `<small>Nota: ${esc(i.note)}</small>` : ''}<div class="qty"><button data-m="${idx}" aria-label="Menos">−</button><span>${i.qty}</span><button data-p="${idx}" aria-label="Más">+</button></div></div><div style="text-align:right"><b>${money(lineOf(i))}</b><br><button class="rm" data-r="${idx}">Quitar</button></div></div>`).join('')}
      <span class="lbl">¿Cómo lo recibes?</span><div class="opts"><button class="opt ${del ? '' : 'on'}" data-dt="retiro">Retiro en el local</button><button class="opt ${del ? 'on' : ''}" data-dt="delivery">Delivery</button></div>
      <span class="lbl">Tus datos</span><div class="row2"><div><label class="lbl" style="margin:0 0 .3rem" for="f-name">Nombre</label><input class="input" id="f-name" autocomplete="name" value="${esc(form.name)}"></div><div><label class="lbl" style="margin:0 0 .3rem" for="f-phone">Teléfono</label><input class="input" id="f-phone" type="tel" autocomplete="tel" value="${esc(form.phone)}"></div></div>
      ${del ? `<div class="row2" style="margin-top:.7rem"><div><label class="lbl" style="margin:0 0 .3rem" for="f-address">Dirección</label><input class="input" id="f-address" autocomplete="street-address" value="${esc(form.address)}"></div><div><label class="lbl" style="margin:0 0 .3rem" for="f-city">Ciudad</label><input class="input" id="f-city" autocomplete="address-level2" value="${esc(form.city)}"></div></div>
      <label class="lbl" for="f-ref">Referencia de entrega (opcional)</label><input class="input" id="f-ref" value="${esc(form.reference)}">` : ''}
      <span class="lbl">¿Para cuándo?</span><div class="opts"><button class="opt ${form.when === 'asap' ? 'on' : ''}" data-when="asap">Lo antes posible</button><button class="opt ${form.when === 'later' ? 'on' : ''}" data-when="later">Programar hora</button></div>
      ${form.when === 'later' ? `<input class="input" id="f-time" type="datetime-local" aria-label="Fecha y hora" style="margin-top:.6rem" value="${esc(form.time)}">` : ''}
      <span class="lbl">Forma de pago <span style="text-transform:none;letter-spacing:0;font-weight:400">(se coordina con el local)</span></span><div class="opts">${pays.map(([k, l]) => `<button class="opt ${form.pay === k ? 'on' : ''}" data-pay="${k}">${l}</button>`).join('')}</div>
      <label class="lbl" for="f-notes">Nota general del pedido (opcional)</label><textarea class="input" id="f-notes" rows="2" maxlength="400">${esc(form.notes)}</textarea>
      <div style="display:flex;gap:.5rem;margin-top:1rem"><input class="input" id="f-coupon" placeholder="Cupón de descuento" aria-label="Cupón" value="${esc(form.coupon)}"><button class="btn ghost small" id="f-cb">Aplicar</button></div>
      <div class="sum">${QUOTE ? `<div><span>Subtotal</span><span>${money(QUOTE.subtotal)}</span></div>${QUOTE.discount ? `<div><span>Descuento (${esc(QUOTE.coupon)})</span><span class="g">−${money(QUOTE.discount)}</span></div>` : ''}${del ? `<div><span>Envío · ${esc(QUOTE.shipping_zone)}</span><span>${QUOTE.shipping ? money(QUOTE.shipping) : '<span class="g">Gratis</span>'}</span></div>` : ''}<div class="t"><span>Total</span><span>${money(QUOTE.total)}</span></div>` : '<div>No se pudo calcular el total.</div>'}</div>
      ${err ? `<div class="msg err" role="alert">${esc(err)}</div>` : ''}</div>
    <div class="df"><button class="btn block" id="drev">Revisar pedido →</button><div class="row2" style="gap:.5rem"><button class="btn ghost small" id="dcopy">Copiar mensaje</button><button class="btn ghost small" id="dclear">Vaciar pedido</button></div></div>`;
    const read = () => { const g = (id) => { const e = $(id, d); return e ? e.value : null; }; form.name = g('#f-name') ?? form.name; form.phone = g('#f-phone') ?? form.phone; form.address = g('#f-address') ?? form.address; form.city = g('#f-city') ?? form.city; form.reference = g('#f-ref') ?? form.reference; form.time = g('#f-time') ?? form.time; form.notes = g('#f-notes') ?? form.notes; form.coupon = g('#f-coupon') ?? form.coupon; saveForm(); };
    const redo = () => { read(); drawStep('form'); };
    $('#dx').onclick = closeAll;
    $$('[data-m]', d).forEach((b) => b.onclick = () => { read(); Cart.setQty(+b.dataset.m, c[+b.dataset.m].qty - 1); drawStep('form'); });
    $$('[data-p]', d).forEach((b) => b.onclick = () => { read(); Cart.setQty(+b.dataset.p, c[+b.dataset.p].qty + 1); drawStep('form'); });
    $$('[data-r]', d).forEach((b) => b.onclick = () => { read(); Cart.setQty(+b.dataset.r, 0); drawStep('form'); });
    $$('[data-dt]', d).forEach((b) => b.onclick = () => { read(); form.delivery_type = b.dataset.dt; redo(); });
    $$('[data-when]', d).forEach((b) => b.onclick = () => { read(); form.when = b.dataset.when; redo(); });
    $$('[data-pay]', d).forEach((b) => b.onclick = () => { read(); form.pay = b.dataset.pay; saveForm(); redo(); });
    $('#f-cb').onclick = redo; const fc = $('#f-city'); if (fc) fc.onchange = redo;
    $('#dclear').onclick = () => { Cart.clear(); drawStep('form'); };
    $('#dcopy').onclick = async () => { read(); const t = message(); try { await navigator.clipboard.writeText(t); toast('Mensaje copiado'); } catch { toast('No se pudo copiar. Usa "Revisar pedido" y copia el texto.'); } };
    $('#drev').onclick = () => {
      read(); const need = [];
      if (form.name.trim().length < 2) need.push('tu nombre'); if (form.phone.replace(/\D/g, '').length < 7) need.push('un teléfono válido');
      if (del && form.address.trim().length < 5) need.push('la dirección'); if (del && form.city.trim().length < 2) need.push('la ciudad');
      if (form.when === 'later' && !form.time) need.push('la hora');
      if (need.length) return drawStep('form', 'Falta: ' + need.join(', ') + '.');
      drawStep('review');
    };
  }
  function review(err) {
    const d = $('#drawer');
    d.innerHTML = `<div class="dh"><h3>Revisa tu pedido</h3><button class="x" style="position:static" aria-label="Cerrar" id="dx">✕</button></div>
    <div class="db"><p class="sub" style="margin-bottom:1rem">Esta es la comanda que se enviará al WhatsApp del local. Ellos confirman disponibilidad, tiempo y total.</p><pre class="preview">${esc(message())}</pre>${err ? `<div class="msg err" role="alert">${esc(err)}</div>` : ''}</div>
    <div class="df"><button class="btn wa block" id="dsend">Enviar por WhatsApp</button><button class="btn ghost block" id="dback">Volver a editar</button></div>`;
    $('#dx').onclick = closeAll; $('#dback').onclick = () => drawStep('form');
    $('#dsend').onclick = async () => {
      const b = $('#dsend'); b.disabled = true; b.textContent = 'Enviando…';
      try {
        const body = { delivery_type: form.delivery_type, name: form.name, phone: form.phone, address: form.address + (form.reference ? ' (' + form.reference + ')' : ''), city: form.city, schedule: form.when === 'asap' ? 'Lo antes posible' : form.time.replace('T', ' '),
          notes: form.notes, payment_method: form.pay, coupon: form.coupon, items: Cart.get().map((i) => ({ productId: i.productId, variantId: i.variantId, qty: i.qty, note: i.note })) };
        const r = await api('/api/orders', { method: 'POST', body });
        try { sessionStorage.setItem('da_last', JSON.stringify({ code: r.code, phone: form.phone })); } catch (_) {}
        Cart.clear(); closeAll();
        if (r.payment_url) { location.href = r.payment_url; return; }
        window.open(r.whatsapp_url, '_blank', 'noopener'); navigate('/pedido/' + r.code);
      } catch (e) { drawStep('form', e.message); }
    };
  }

  // ---------- pedido confirmado y seguimiento ----------
  const FLOW = ['pendiente', 'confirmado', 'preparando', 'enviado', 'entregado'];
  const trackForm = (code = '') => `<form id="tf" class="box"><label class="lbl" for="tc" style="margin-top:0">Código del pedido</label><input class="input" id="tc" value="${esc(code)}" placeholder="DA-XXXXXXXX" required>
    <label class="lbl" for="tm">Teléfono o correo del pedido</label><input class="input" id="tm" required><button class="btn block" style="margin-top:1.2rem">Consultar</button></form>`;
  function bindTrack() {
    const f = $('#tf'); if (!f) return;
    f.onsubmit = (e) => { e.preventDefault(); const m = $('#tm').value.trim(); try { sessionStorage.setItem('da_last', JSON.stringify({ code: $('#tc').value.trim().toUpperCase(), email: m.includes('@') ? m : '', phone: m.includes('@') ? '' : m })); } catch (_) {} navigate('/pedido/' + encodeURIComponent($('#tc').value.trim().toUpperCase())); };
  }
  async function orderPage(code) {
    chrome(); document.title = `Pedido ${code} | ${S.store_name}`;
    let last = {}; try { last = JSON.parse(sessionStorage.getItem('da_last') || '{}'); } catch (_) {}
    const qs = new URLSearchParams({ code }); if (last.code === code) { if (last.email) qs.set('email', last.email); if (last.phone) qs.set('phone', last.phone); }
    let o; try { o = await api('/api/orders/track?' + qs); } catch (e) { app.innerHTML = `<div class="wrapn"><h1 style="font-size:2rem">Pedido ${esc(code)}</h1><div class="msg err">${esc(e.message)}</div>${trackForm(code)}</div>`; bindTrack(); return; }
    const idx = FLOW.indexOf(o.status);
    app.innerHTML = `<div class="wrapn"><p class="kicker">¡Gracias por tu pedido!</p><h1 style="font-size:2.4rem">Recibimos tu <em>pedido</em></h1><p>Tu código es <b>${esc(o.code)}</b>. Si no se abrió WhatsApp, envíanos la comanda con el botón de abajo para que el local la confirme.</p>
      <div class="box"><div style="display:flex;justify-content:space-between;gap:1rem;flex-wrap:wrap"><span class="status ${esc(o.status)}">${esc(o.status)}</span><span class="status ${esc(o.payment_status)}">pago ${esc(o.payment_status)}</span></div>
      ${o.status === 'cancelado' ? '' : `<div class="bar" aria-label="Progreso">${FLOW.map((_, i) => `<i class="${i <= idx ? 'on' : ''}"></i>`).join('')}</div>`}
      <p class="sub">${o.delivery_type === 'retiro' ? 'Retiro en el local' : 'Delivery'}${o.schedule ? ' · ' + esc(o.schedule) : ''}</p>
      ${o.items.map((i) => `<div class="pl" style="padding:.3rem 0"><span>${i.qty} × ${esc(i.name)}${i.variant_name ? ' (' + esc(i.variant_name) + ')' : ''}${i.note ? `<br><small style="color:var(--muted)">Nota: ${esc(i.note)}</small>` : ''}</span><span>${money(i.price * i.qty)}</span></div>`).join('')}
      <div class="pl" style="border-top:1px solid var(--line);margin-top:.6rem;padding-top:.7rem;font-weight:600;font-size:1.15rem"><span>Total</span><span>${money(o.total)}</span></div></div>
      ${o.bank_info ? `<div class="box"><h3>Datos para la transferencia</h3><p style="white-space:pre-line;margin:0">${esc(o.bank_info)}</p></div>` : ''}
      <div style="display:flex;gap:.8rem;flex-wrap:wrap"><a class="btn wa" target="_blank" rel="noopener" href="${esc(o.whatsapp_url)}">Enviar comanda por WhatsApp</a><a class="btn ghost" href="/carta" data-link>Volver a la carta</a></div></div>`;
  }
  const trackPage = () => { chrome(); document.title = `Seguir pedido | ${S.store_name}`; app.innerHTML = `<div class="wrapn"><p class="kicker">Seguimiento</p><h1 style="font-size:2.2rem">Sigue tu <em>pedido</em></h1>${trackForm()}</div>`; bindTrack(); };
  const notFound = () => { chrome(); document.title = 'No encontrado'; app.innerHTML = `<div class="wrapn empty"><h1 style="font-size:2rem">Página no encontrada</h1><p>El enlace no existe.</p><a class="btn" href="/carta" data-link>Ir a la carta</a></div>`; };

  // ---------- router ----------
  let lastPath = null;
  async function route() {
    const p = location.pathname.replace(/\/+$/, '') || '/';
    $('#modal').classList.remove('on'); $('#drawer').classList.remove('on'); $('#scrim').classList.remove('on'); lock(false);
    try {
      if (p === '/') { lastPath = p; splash(); }
      else if (p === '/carta' || p === '/tienda' || p.startsWith('/producto/')) { const slug = p.startsWith('/producto/') ? decodeURIComponent(p.slice(10)) : null; if (lastPath === '/carta' && slug === null) { return; } await carta(slug); lastPath = '/carta'; }
      else if (p.startsWith('/pedido/')) { lastPath = p; await orderPage(decodeURIComponent(p.slice(8))); }
      else if (p === '/seguimiento') { lastPath = p; trackPage(); }
      else { lastPath = p; notFound(); }
    } catch (e) { app.innerHTML = `<div class="wrapn empty"><h2>No pudimos cargar la página</h2><p>${esc(e.message)}</p><button class="btn" onclick="location.reload()">Reintentar</button></div>`; }
    if (!location.hash) window.scrollTo(0, 0);
  }
  function navigate(url) { history.pushState(null, '', url); lastPath = null; route(); }
  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-link]'); if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault(); const href = a.getAttribute('href');
    if (href.startsWith('/carta#') && location.pathname === '/carta') { const el = $(href.slice(5)); el && el.scrollIntoView({ behavior: 'smooth' }); return; }
    navigate(href);
  });
  window.addEventListener('popstate', () => { lastPath = null; route(); });

  (async function init() {
    try { [S, CATS] = await Promise.all([api('/api/settings'), api('/api/categories')]); }
    catch { app.innerHTML = '<div class="wrapn empty"><h2>No pudimos conectar con la tienda</h2><p>Inténtalo de nuevo en unos minutos.</p></div>'; return; }
    applyTheme();
    route();
  })();
})();
