# El Pasaje Dental — guía para trabajar con Claude

Sistema de e-commerce + gestión interna para **El Pasaje Dental** (insumos odontológicos, Tucumán, Argentina). Tienda pública + panel interno, sobre un **servidor Node sin dependencias** que usa **WooCommerce** como backend de datos. En producción en **Railway**, dominio **elpasajedental.com**.

> Este archivo lo lee Claude Code automáticamente. Respetá estas convenciones para que el proyecto siga creciendo de forma consistente, lo trabaje quien lo trabaje (Maxi, Enrique, Nancy).

## Arquitectura

- **`app/server.mjs`** — servidor HTTP (`node:http`, zero-dep salvo `bcryptjs`). Enruta TODO: API + archivos estáticos. Un solo archivo grande con `if (u.pathname === ...)`.
- **Módulos `app/*.mjs`**: `auth.mjs` (usuarios/sesiones), `finanzas.mjs` (caja/costos/equilibrio), `afip.mjs` (facturación ARCA WSAA/WSFE), `ml.mjs` (MercadoLibre), `mp.mjs` (Mercado Pago), `envio.mjs` (Andreani), `wp-pass.mjs`.
- **`scripts/`**: `lib.mjs` (config: lee de env o `config/*.json`), `sync-core.mjs` (`syncCatalogo`: trae productos de WooCommerce al overlay).
- **Frontend** en `app/public/`: `tienda.*` (tienda pública), `admin.html`+`app.js`+`style.css` (panel interno), `index.html`+`home.*` (portada), `ingresar.html`, `micuenta.html`.
- **Datos**: WooCommerce es la fuente de verdad de productos/pedidos/cupones. Los datos propios viven en un **volumen** (`DATA_DIR=/data` en Railway): `catalogo.json` (overlay/caché de WC), `ubicaciones.json`, `usuarios.json`, `finanzas.json`, `vencimientos.json`, `ajustes.json`, etc.

## Convenciones (IMPORTANTE — seguir siempre)

- **Zero-dependencias**: no agregar paquetes npm salvo necesidad real y acordada. Usar `fetch`, `node:*`, canvas/print en el browser, etc.
- **Cache-busting**: cada vez que tocás `app.js`, `style.css`, `tienda.js/css`, `home.js/css` → **subí el `?v=N`** en el HTML que lo referencia (`admin.html`, `tienda.html`, `index.html`). Si no, el navegador sirve la versión vieja.
- **HTML sin caché**: las páginas se sirven no-cache; los `.js/.css` se cachean → por eso el `?v=`.
- **Helpers**: server usa `send(res, code, body)`; frontend usa `api(url, body)` (POST JSON) y `$ / $$`. Para respuestas grandes (catálogo) hay `sendJsonGz` (gzip).
- **Auth / muro**: el panel `/admin` y `/api/admin/*` requieren **sesión de email** con rol `dueno`/`empleado` (`esStaff`/`esDueno` en server.mjs; `AUTH.leerSesion` lee la cookie `cli=`). La clave compartida legacy está deshabilitada. Login por email+contraseña (`/login` → `/api/auth/login-clave`) o por código (`/api/auth/verificar`). Dueños = lista `duenos()` en `scripts/lib.mjs` (o env `DUENOS`).
- **Roles**: `dueno` (todo), `empleado` (sin finanzas/estadísticas/ajustes/campañas), `cliente`. Gates en server (`esStaff`/`esDueno`) y en el front (`ROL_ADMIN`, `FIN_OCULTO_EMP`).
- **Menú del panel**: `nav.tabs` con grupos desplegables (`.tabgroup` → `.tabg-menu`); cada opción es un `.tab[data-tab=...]`. `activarTab(name)` cambia de pestaña y usa el hash (`/admin#pedidos`). Loaders por pestaña en el objeto `loaders`.
- **Estilo**: precios en fuente **Inter** (no Syne); diseño mobile-first; libertad creativa pero respetando la identidad (rosa/fucsia/vino, `--rose-500 #DE3667`). No romper lo que ya se ve bien.
- **Productos variables**: un producto está "en stock" si **alguna variación** tiene stock; al editar stock de una variación se recalcula el padre. En la tienda solo se ofrecen las variaciones con stock.

## Deploy (Railway)

```bash
npx --yes @railway/cli up --service Elpasajedental --detach
```
Flujo recomendado por cambio: **editar → `node --check` de los .mjs/.js tocados → subir `?v=` → deploy → verificar en vivo** (esperar ~90s y hacer fetch a elpasajedental.com). Si Railway devuelve 500 al subir (les pasa a veces), reintentar; no es el código.

Para verificar endpoints `/api/admin/*` desde scripts: loguearse por email (`POST /api/auth/login-clave` con un dueño) y usar la cookie `cli=` del `Set-Cookie` (la clave compartida ya no autentica).

## Seguridad (NO romper)

- **Nunca** commitear secretos ni datos de clientes. Ya están en `.gitignore`: `config/woocommerce.json`, `config/anthropic.json`, `config/resend.json`, `config/afip/` (certs `.key/.crt`), y los `data/*.json` con PII (`usuarios.json`, `finanzas.json`, etc.).
- Las credenciales van por **variables de entorno** en Railway: `WC_URL/WC_KEY/WC_SECRET`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`+`MAIL_FROM`, `AFIP_CERT_<cuit>`/`AFIP_KEY_<cuit>` (base64), `MP_*`, `ML_*`, `DUENOS`, `GA_ID`, `GSC_VERIFICATION`.
- Acciones de riesgo (emitir facturas AFIP reales, crear pedidos reales en WC, rotar tokens): confirmá con el dueño antes.

## Roadmap de datos (a futuro)

- **Hoy (híbrido):** WooCommerce (MySQL vía su REST API) = productos, pedidos, clientes, cupones. **JSON en el volumen** (`DATA_DIR`) = datos operativos propios (ubicaciones, finanzas, costos, equilibrio, vencimientos, proveedores, encargos, solicitudes, ajustes).
- **Regla:** NUNCA escribir directo en la DB de WooCommerce — siempre por su REST API (escribir directo saltea la lógica de Woo y corrompe stock/pedidos). Acceso directo a su MySQL, como mucho, solo lectura para reportes.
- **Próximo paso cuando JSON quede corto** (más escrituras concurrentes, reportes pesados, archivos grandes): migrar **solo nuestros datos** a una base propia sin cambiar la lógica (cambiar la capa de guardado): **SQLite** (un archivo en el volumen, con SQL/transacciones/concurrencia — bajo riesgo, alto beneficio) o **Postgres en Railway** (más pro/analítica). WooCommerce sigue por REST.
- **Backup:** botón en Ajustes (`/api/admin/backup`) + **backup diario automático por email** al dueño (`enviarBackupDiario`/`chequearBackupDiario`, ~3 AM ARG, vía Resend). Incluye los JSON propios (no WooCommerce). Hay endpoint `/api/admin/backup/enviar` para forzarlo.

## Cómo trabajar (estilo de las sesiones)

- Comunicación a nivel técnico (los dueños son ingenieros) pero clara; respuestas accionables.
- Cambios chicos y verificados: tocar lo justo, no reescribir lo que funciona.
- Al terminar, resumen claro de lo hecho y deployado.
