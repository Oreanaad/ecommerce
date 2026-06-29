# El Pasaje Dental 🦷

Plataforma de **e-commerce + gestión interna** para El Pasaje Dental (insumos odontológicos · Tucumán, Argentina).
Tienda online pública + panel de administración, construidos sobre un **servidor Node.js sin dependencias** que usa **WooCommerce** como backend de datos. En producción: **[elpasajedental.com](https://elpasajedental.com)** (Railway).

---

## ✨ Qué hace

### 🛍️ Tienda pública (`/tienda`)
- Catálogo con **stock real** (sincronizado con WooCommerce), búsqueda en vivo con preview, categorías y subcategorías.
- Carrito + **"Ver carrito"** (resumen con fotos para confirmar) y checkout propio.
- **Medios de pago**: transferencia, efectivo, **Mercado Pago** (con recargo configurable). Doble precio (transferencia/efectivo vs. otros medios).
- **Envíos**: retiro en local, cadete en Tucumán (fijo/gratis por monto) y **Andreani** a todo el país (tarifas en vivo).
- **Cupones de descuento** (de WooCommerce) aplicables en el checkout.
- **Banner promocional** activable por momentos puntuales (se controla desde el panel).
- Productos variables: solo se ofrecen las medidas con stock. Reintento automático de fotos. Mobile-first + SEO (meta tags, JSON-LD, sitemap, canonicals).

### 🔐 Panel interno (`/admin`)
Login por **email + contraseña** (o código por email), con roles **dueño** / **empleado**.

- **📊 Estadísticas** — ventas del mes y gráfico.
- **💰 Finanzas** — caja, cuentas corrientes, cheques, acreditaciones, compras, **proveedores** (con reglas de IVA), **costos**, **punto de equilibrio** mensual, **extracto bancario por IA** (separa gastos bancarios → costos variables) y **facturación electrónica AFIP/ARCA** (Factura C, CAE + PDF con QR, multi-CUIT).
- **🛒 Ventas** — Pedidos (ver/editar cantidades, agregar/quitar productos, imprimir factura, marcar reparto), **Nueva venta (POS)** con alta de cliente, Reparto del cadete (filtro por fecha, ruta en Maps), Preguntar (asistente IA sobre el stock).
- **👥 Clientes** — alta/edición (datos, condición IVA), **Solicitudes** (pedidos de mejora del equipo) y **Encargos** (avisar al cliente cuando llega lo que pidió).
- **📦 Catálogo** — editor de productos, **carga rápida** (código + cantidad + vencimiento), **recibir mercadería por foto/PDF con IA** (lee la factura, matchea productos, calcula costos), vencimientos, muebles/ubicaciones, mapa del local.
- **📣 Marketing** — **cupones**, **generador de imágenes para redes** (placas para IG/WhatsApp y **catálogo PDF**), campañas por email, MercadoLibre.
- **⚙️ Ajustes** — recargos, envíos, vencimientos, emisores AFIP, banner promocional, backup.

---

## 🧱 Stack

- **Backend**: Node.js (`node:http`), sin frameworks. Única dependencia: `bcryptjs`.
- **Datos**: WooCommerce REST API (fuente de verdad) + overlays en un volumen (`DATA_DIR`).
- **IA**: API de Claude (lectura de facturas/extractos, descripciones, asistente).
- **Integraciones**: Mercado Pago, Andreani, AFIP/ARCA (WSAA/WSFE), MercadoLibre, Resend (emails).
- **Hosting**: Railway. **Dominio/DNS**: Cloudflare.

## 📂 Estructura

```
app/
  server.mjs        # servidor + ruteo (API y estáticos)
  auth.mjs finanzas.mjs afip.mjs ml.mjs mp.mjs envio.mjs wp-pass.mjs
  public/           # tienda, panel y portada (html/js/css)
scripts/
  lib.mjs           # config (env o config/*.json)
  sync-core.mjs     # sincroniza catálogo desde WooCommerce
config/             # credenciales (NO versionadas)
data/               # overlays/runtime (PII NO versionada)
```

## ⚙️ Configuración (variables de entorno)

Las credenciales se cargan por **variables de entorno** (en Railway) o, en local, por archivos en `config/` (que están en `.gitignore`):

| Variable | Para |
|---|---|
| `WC_URL`, `WC_KEY`, `WC_SECRET` | WooCommerce |
| `ANTHROPIC_API_KEY` | IA (Claude) |
| `RESEND_API_KEY`, `MAIL_FROM` | Emails |
| `MP_ACCESS_TOKEN` … | Mercado Pago |
| `ML_CLIENT_ID`, `ML_CLIENT_SECRET`, `ML_REDIRECT` | MercadoLibre |
| `AFIP_CERT_<cuit>`, `AFIP_KEY_<cuit>` | Facturación (base64) |
| `DUENOS` | Emails con acceso total |
| `GA_ID`, `GSC_VERIFICATION` | Analytics / Search Console |
| `DATA_DIR` | Carpeta de datos (volumen) |

## ▶️ Correr / deployar

```bash
# Local
npm install
node app/server.mjs        # requiere config/ o variables de entorno

# Deploy (Railway)
npx @railway/cli up --service Elpasajedental --detach
```

> **Importante:** nunca subir secretos ni datos de clientes al repo (ya están excluidos en `.gitignore`). Ver **`CLAUDE.md`** para las convenciones de desarrollo (cache-busting `?v=`, auth, deploy, seguridad).

---

Hecho con ❤️ para El Pasaje Dental.
