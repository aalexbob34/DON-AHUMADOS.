// Datos iniciales (solo se cargan la primera vez, cuando la base está vacía) y creación del administrador.
import { slugify, hashPassword } from './lib.js';

const CATEGORIAS = [
  ['Ahumados artesanales', 'Cortes ahumados lentamente con leña y especias.'],
  ['Empacados al vacío', 'Listos para tu cocina, frescos y sellados al vacío.'],
  ['Productos artesanales', 'Preparaciones de la casa para acompañar tus asados.'],
  ['Salsas', 'Salsas de la casa para darle otra vuelta a tu plato.'],
];

// Productos de EJEMPLO: reemplázalos desde el panel por los reales (nombres, precios y fotos).
const PRODUCTOS = [
  { n: 'Tocineta artesanal ahumada', c: 0, short: 'Tocineta de cerdo ahumada lentamente, empacada al vacío.', price: 32000, stock: 40, w: 500, feat: 1, nw: 1,
    desc: 'Tocineta de cerdo curada y ahumada de forma artesanal. Sabor profundo, textura firme y el punto justo de sal. Empacada al vacío para conservar frescura y aroma.',
    f: ['Ahumado lento con leña', 'Empacada al vacío', 'Sin colorantes artificiales', 'Producto artesanal de Cali'], b: ['Sabor intenso desde el primer corte', 'Rinde y se conserva más tiempo', 'Lista para freír, hornear o asar'],
    specs: [['Peso aproximado', '500 g'], ['Conservación', 'Refrigerada entre 0 y 4 °C'], ['Empaque', 'Sellado al vacío']],
    usage: 'Sácala del empaque, córtala al grosor que prefieras y fríela a fuego medio sin aceite hasta que quede dorada. También funciona al horno a 190 °C por 15 a 20 minutos.',
    faqs: [['¿Cuánto dura?', 'Sellada y refrigerada, varias semanas. Una vez abierta, consúmela en pocos días.'], ['¿Se puede congelar?', 'Sí, en porciones, dentro de su empaque al vacío.']],
    rec: 'Acompáñala con huevos, arepa o sobre una hamburguesa.', variants: [['500 g', 32000, 25], ['1 kg', 60000, 15]] },
  { n: 'Costillas de cerdo ahumadas', c: 0, short: 'Costillar ahumado, tierno, que se desprende del hueso.', price: 48000, stock: 30, w: 1000, feat: 1, nw: 0,
    desc: 'Costillas de cerdo ahumadas durante horas hasta quedar jugosas. Solo necesitas calentarlas y servirlas.',
    f: ['Cocción lenta y ahumado en leña', 'Carne tierna y jugosa', 'Empacadas al vacío'], b: ['Plato principal sin esfuerzo', 'Ideal para reuniones y celebraciones'],
    specs: [['Peso aproximado', '1 kg'], ['Conservación', 'Refrigeradas']], usage: 'Calienta en horno a 160 °C por 20 minutos, bañadas con tu salsa favorita.',
    faqs: [['¿Vienen listas para comer?', 'Sí, solo requieren calentarse.']], rec: 'Perfectas con papas criollas y ensalada fresca.', variants: [['500 g', 26000, 15], ['1 kg', 48000, 15]] },
  { n: 'Chorizo ahumado artesanal', c: 0, short: 'Chorizo de la casa con especias y toque de humo.', price: 24000, stock: 50, w: 400, feat: 1, nw: 0,
    desc: 'Chorizo artesanal elaborado con carne seleccionada, especias y ahumado suave.', f: ['Receta de la casa', 'Ahumado suave'], b: ['Sabor casero', 'Listo para la parrilla'],
    specs: [['Presentación', 'Paquete de 4 unidades'], ['Conservación', 'Refrigerado']], usage: 'Asa a fuego medio, 8 a 10 minutos, volteando.', faqs: [], rec: 'Con arepa, limón y ají.', variants: [] },
  { n: 'Lomo de cerdo ahumado al vacío', c: 1, short: 'Lomo ahumado en pieza, cortado y sellado al vacío.', price: 38000, stock: 20, w: 700, feat: 0, nw: 1,
    desc: 'Lomo de cerdo marinado y ahumado, listo para rebanar en frío o calentar.', f: ['Marinado y ahumado', 'Empacado al vacío'], b: ['Versátil para sándwiches y platos fuertes'],
    specs: [['Peso aproximado', '700 g']], usage: 'Rebana fino para sándwiches o calienta en sartén con un poco de mantequilla.', faqs: [], rec: 'Con pan artesanal y mostaza.', variants: [] },
  { n: 'Salsa BBQ de la casa', c: 3, short: 'Salsa ahumada dulce y picante para tus asados.', price: 16000, stock: 60, w: 350, feat: 0, nw: 0,
    desc: 'Nuestra salsa BBQ artesanal, perfecta para costillas, pollo y hamburguesas.', f: ['Receta propia', 'Dulce con toque ahumado'], b: ['Realza cualquier asado'],
    specs: [['Contenido', '350 ml']], usage: 'Úsala para bañar durante los últimos minutos de cocción o como salsa de mesa.', faqs: [], rec: 'Con costillas o alitas.', variants: [] },
  { n: 'Ají ahumado', c: 3, short: 'Ají picante con base de pimientos ahumados.', price: 9000, stock: 40, w: 250, feat: 0, nw: 0, desc: 'Ají de la casa con un toque de humo. Picante medio, ideal para chorizo y costillas.', f: ['Receta propia'], b: ['Picante con carácter'], specs: [['Contenido', '250 ml']], usage: 'Sírvelo en la mesa.', faqs: [], rec: 'Con chorizo y arepa.', variants: [] },
  { n: 'Chimichurri de la casa', c: 3, short: 'Hierbas frescas, ajo y limón.', price: 9000, stock: 40, w: 250, feat: 0, nw: 0, desc: 'Chimichurri fresco para acompañar carnes ahumadas.', f: ['Hierbas frescas'], b: ['Fresco y cítrico'], specs: [['Contenido', '250 ml']], usage: 'Refrigerar y servir frío.', faqs: [], rec: 'Con lomo o costillas.', variants: [] },
  { n: 'Mostaza miel', c: 3, short: 'Dulce, suave y con un toque ácido.', price: 9000, stock: 40, w: 250, feat: 0, nw: 0, desc: 'Mostaza con miel, perfecta para sándwiches y tocineta.', f: ['Dulce y suave'], b: ['Combina con todo'], specs: [['Contenido', '250 ml']], usage: 'Sírvela fría.', faqs: [], rec: 'Con tocineta y lomo.', variants: [] },
];

const AJUSTES = {
  store_name: 'Don Ahumados', tagline: 'El sabor del humo, hecho a mano',
  splash_title: 'Ahumados artesanales, *listos para pedir.*', hero_kicker: 'Cali · Retiro y delivery',
  hero_title: 'Humo, leña y *mucho sabor.*',
  hero_subtitle: 'Cortes ahumados lentamente y empacados al vacío. Elige tus productos, arma tu pedido y envíalo al WhatsApp de Don Ahumados.',
  footer_note: 'Retiro y delivery. Consulta horarios y cobertura al pedir.',
  hero_image: '/assets/seed/hero.svg', logo: '/assets/logo.webp', watermark: '/assets/logo-mark.webp',
  watermark_mode: 'tile', watermark_size: '240', watermark_opacity: '4', bg_color: '#0B1F25', accent_color: '#E8772E', bg_image: '', bg_dim: '80',
  announcement: 'Pedidos en Cali y envíos a todo el país', whatsapp: '573117382868', instagram: 'donahumadoscali', email: '', address: 'Cali, Valle del Cauca, Colombia',
  about: 'Don Ahumados nació del asado al barril: carne seleccionada, humo de leña y paciencia. Hoy llevamos esa tradición a tu casa en productos artesanales empacados al vacío.',
  benefits: JSON.stringify([
    { t: 'Ahumado artesanal', d: 'Procesos lentos con leña, sin atajos.' }, { t: 'Empacado al vacío', d: 'Frescura y conservación garantizadas.' },
    { t: 'Envíos seguros', d: 'Cadena de frío en toda la ruta.' }, { t: 'Atención directa', d: 'Escríbenos por WhatsApp, respondemos rápido.' }]),
  bank_info: 'Configura aquí los datos para pagar por transferencia (banco, tipo y número de cuenta, titular).',
  cod_cities: 'Cali',
  seo_description: 'Don Ahumados: ahumados artesanales y productos empacados al vacío. Compra en línea con envío a todo Colombia.',
};

export async function seedIfEmpty(env) {
  const DB = env.DB;
  const n = await DB.prepare('SELECT COUNT(*) c FROM categories').first();
  if (n.c > 0) return;
  const q = [];
  const p = (sql, ...a) => q.push(DB.prepare(sql).bind(...a));
  CATEGORIAS.forEach(([name, d], i) => p('INSERT INTO categories(name,slug,description,sort) VALUES(?,?,?,?)', name, slugify(name), d, i));
  PRODUCTOS.forEach((x, i) => {
    const slug = slugify(x.n);
    p(`INSERT INTO products(slug,name,category_id,short_desc,description,price,features,benefits,specs,usage,faqs,recommendations,stock,weight_g,featured,is_new,sales_count)
       VALUES(?,?,(SELECT id FROM categories WHERE slug=?),?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    slug, x.n, slugify(CATEGORIAS[x.c][0]), x.short, x.desc, x.price, JSON.stringify(x.f), JSON.stringify(x.b), JSON.stringify(x.specs.map(([k, v]) => ({ k, v }))),
    x.usage, JSON.stringify(x.faqs.map(([qq, a]) => ({ q: qq, a }))), x.rec, x.stock, x.w, x.feat, x.nw, 10 - i);
    p('INSERT INTO product_images(product_id,url,sort) VALUES((SELECT id FROM products WHERE slug=?),?,0)', slug, `/assets/seed/${slug}.svg`);
    x.variants.forEach(([vn, vp, vs]) => p('INSERT INTO variants(product_id,name,price,stock) VALUES((SELECT id FROM products WHERE slug=?),?,?,?)', slug, vn, vp, vs));
    if (x.variants.length) p('UPDATE products SET stock=(SELECT SUM(stock) FROM variants WHERE product_id=products.id), price=(SELECT MIN(price) FROM variants WHERE product_id=products.id) WHERE slug=?', slug);
  });
  Object.entries(AJUSTES).forEach(([k, v]) => p('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO NOTHING', k, v));
  p('INSERT INTO shipping_zones(name,cities,fee,free_over,eta) VALUES(?,?,?,?,?)', 'Cali y área metropolitana', 'Cali,Jamundí,Yumbo,Palmira', 8000, 120000, 'Mismo día o día siguiente');
  p('INSERT INTO shipping_zones(name,cities,fee,free_over,eta) VALUES(?,?,?,?,?)', 'Resto de Colombia', '*', 22000, 250000, '2 a 4 días hábiles');
  p('INSERT INTO promotions(code,title,type,value,min_amount,active,show_banner) VALUES(?,?,?,?,?,?,?)', 'BIENVENIDO10', 'Descuento de bienvenida', 'percent', 10, 60000, 1, 1);
  await DB.batch(q);
}

// Crea el administrador inicial con el secreto ADMIN_PASSWORD (si no existe ninguno).
export async function ensureAdmin(env) {
  const has = await env.DB.prepare("SELECT COUNT(*) c FROM users WHERE role='admin'").first();
  if (has.c > 0) return;
  if (!env.ADMIN_PASSWORD) { console.warn('Falta el secreto ADMIN_PASSWORD: no se creó el administrador.'); return; }
  const login = String(env.ADMIN_USER || 'alex').toLowerCase();
  const { hash, salt } = await hashPassword(env.ADMIN_PASSWORD, null, env.PBKDF2_ITERATIONS);
  await env.DB.prepare("INSERT INTO users(name,email,pass_hash,salt,role) VALUES('Alex',?,?,?, 'admin')").bind(login, hash, salt).run();
}
