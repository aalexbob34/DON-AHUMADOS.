# Don Ahumados — Tienda en Cloudflare (Workers + D1 + R2)

Tienda completa: catálogo, carrito, cuentas, pedidos, envíos, cupones, WhatsApp, Wompi (opcional) y panel de administración (`/admin`).
Todo corre en Cloudflare: **Workers** (código), **D1** (base de datos), **R2** (fotos) y **Assets** (archivos estáticos).

## Publicar (una sola vez)

Necesitas Node 20+ y una cuenta de Cloudflare. En esta carpeta:

```bash
npm install
npx wrangler login

# 1) Base de datos
npx wrangler d1 create don-ahumados-db
#    Copia el "database_id" que muestra y pégalo en wrangler.jsonc (campo database_id)

# 2) Bucket de fotos (R2 pide tener un método de pago en la cuenta; el plan gratuito de R2 alcanza de sobra)
npx wrangler r2 bucket create don-ahumados-fotos

# 3) Crear las tablas en la base real
npx wrangler d1 migrations apply DB --remote

# 4) Contraseña del administrador (te la pide por pantalla)
npx wrangler secret put ADMIN_PASSWORD

# 5) Publicar
npx wrangler deploy
```

Al terminar te da una dirección `https://don-ahumados.<tu-usuario>.workers.dev`. Entra a `/admin` con el usuario `alex` (cámbialo en `wrangler.jsonc` → `ADMIN_USER`, antes del primer despliegue) y la contraseña del paso 4.

La primera visita carga automáticamente los productos de ejemplo y el administrador. Desde el panel reemplaza productos, fotos, precios, textos, logo y fondo.

## Dominio propio
En el panel de Cloudflare: Workers & Pages → don-ahumados → Settings → Domains & Routes → Add → Custom domain. Luego pon esa dirección (con https://) en `wrangler.jsonc` → `SITE_URL` (vacío = usa la dirección con la que entra el visitante) y vuelve a ejecutar `npx wrangler deploy` (se usa en SEO, sitemap y enlaces de pago).

## Pagos Wompi (opcional)
```bash
npx wrangler secret put WOMPI_PUBLIC_KEY
npx wrangler secret put WOMPI_INTEGRITY_SECRET
npx wrangler secret put WOMPI_EVENTS_SECRET
```
En Wompi, configura la URL de eventos: `https://TU-DOMINIO/api/payments/wompi`. Sin estas llaves, la tienda funciona con WhatsApp, transferencia y contra entrega.

## Pruebas locales
```bash
npm test        # levanta wrangler dev con D1/R2 locales y corre 71 comprobaciones
npm run dev     # tienda local en http://localhost:8787  (crea .dev.vars con ADMIN_PASSWORD=tu-clave)
```

## Notas importantes
- **Contraseñas:** se protegen con PBKDF2 (100.000 iteraciones, el máximo de Cloudflare). En el plan gratuito de Workers (10 ms de CPU) el inicio de sesión puede fallar con error 1102; si ocurre, pasa a Workers Paid (US$5/mes) o baja `PBKDF2_ITERATIONS` (ej. 20000) en `vars`.
- **Límite de intentos** (login, registro, pedidos): es por instancia del Worker; frena abusos básicos. Para protección fuerte activa las reglas de Rate Limiting / WAF de Cloudflare sobre `/api/auth/*`.
- **Inventario:** el descuento de stock es atómico; si dos clientes compran la última unidad, solo uno lo logra.
- Las imágenes de ejemplo (`public/assets/seed`) son ilustraciones; sube tus fotos reales desde Productos.
- Copias de seguridad: `npx wrangler d1 export don-ahumados-db --remote --output respaldo.sql`.
