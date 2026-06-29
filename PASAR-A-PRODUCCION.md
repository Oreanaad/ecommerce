# 🚀 Pasar a producción — El Pasaje Dental

**Objetivo:** que `elpasajedental.com` muestre la **app nueva** (Railway), dejando **WordPress/WooCommerce andando** en `wp.elpasajedental.com` como motor de **pagos (Mercado Pago), Andreani y emails**.

**Regla de oro:** mudamos WordPress primero y probamos todo en la URL de prueba. **El DNS del dominio principal se cambia AL FINAL** (único paso visible). Si algo falla antes de eso, la tienda actual sigue intacta.

---

## FASE 0 — Antes de empezar (5 min)
- [ ] **Backup de WordPress** (Hostinger → Backups, o plugin). Por las dudas.
- [ ] Tené a mano los accesos: **hPanel de Hostinger**, **wp-admin**, y avisame para la parte de **Railway**.
- [ ] **Anotá el valor actual del registro de la raíz** (`@`) en la Zona DNS de Hostinger (es el A o CNAME que hoy apunta a WordPress). Sirve para volver atrás si hace falta.

---

## FASE 1 — Mover WordPress a `wp.elpasajedental.com`
*(la tienda actual sigue funcionando, no se toca todavía)*

1. **Hostinger → Subdominios:** crear `wp` (queda `wp.elpasajedental.com`) apuntando a la **misma carpeta** donde está instalado WordPress hoy (normalmente `public_html`).
2. Esperar a que el subdominio tenga **SSL** (Hostinger lo emite solo, unos minutos). Verificá que `https://wp.elpasajedental.com` abra (puede redirigir a elpasajedental.com todavía — es normal).
3. **Cambiar la dirección de WordPress:** wp-admin → **Ajustes → Generales** →
   - *Dirección de WordPress (URL)* = `https://wp.elpasajedental.com`
   - *Dirección del sitio (URL)* = `https://wp.elpasajedental.com`
   - Guardar. ⚠️ Te va a **desloguear** y mandar a `wp.elpasajedental.com/wp-admin`. Entrá de nuevo ahí.
   - 🔧 Si quedás afuera: en `wp-config.php` agregá
     ```php
     define('WP_HOME','https://wp.elpasajedental.com');
     define('WP_SITEURL','https://wp.elpasajedental.com');
     ```
4. **Probar que WooCommerce anda en el subdominio:**
   - [ ] `https://wp.elpasajedental.com` → carga la tienda WP.
   - [ ] `https://wp.elpasajedental.com/wp-json/` → responde (JSON).
   - [ ] **Avisame cuando esto esté** → yo sigo con la Fase 2.

---

## FASE 2 — Apuntar la app al WordPress nuevo *(lo hago yo)*
5. Cambio la variable **`WC_URL`** a `https://wp.elpasajedental.com` en Railway y **redeploy**.
6. Pruebo en la **URL de prueba** (`elpasajedental-production.up.railway.app`) que la app trae **productos, stock y pedidos** desde el WP nuevo.
7. **Re-sincronizo el catálogo** (botón *↻ Actualizar stock* del panel) para que las **URLs de las imágenes** pasen de `elpasajedental.com/wp-content/...` a `wp.elpasajedental.com/wp-content/...`. ⚠️ **Importante:** si no se re-sincroniza, al cambiar el dominio las fotos de los productos se rompen (quedarían apuntando a la app nueva, que no tiene `/wp-content`).
   - Todo esto **sin tocar el dominio principal** → la tienda actual sigue intacta. ✅

---

## FASE 3 — Cambiar el dominio a la app nueva, vía CLOUDFLARE *(el paso visible)*
*(Hostinger no deja CNAME en la raíz; Cloudflare sí, con "CNAME flattening". El dominio ya está dado de alta en Railway.)*

**A. Crear Cloudflare + agregar el dominio:**
7. Crear cuenta gratis en **cloudflare.com** → **Add a site** → `elpasajedental.com` → plan **Free**.
8. Cloudflare **escanea e importa** los registros actuales automáticamente (email, wp, etc.).

**B. Verificar que estén estos registros importados (CHECKLIST — que no falte ninguno):**
| Tipo | Nombre | Valor | Nube |
|------|--------|-------|------|
| MX | `@` | `mx1.hostinger.com` (prio 5) | — |
| MX | `@` | `mx2.hostinger.com` (prio 10) | — |
| TXT | `@` | `v=spf1 include:_spf.mail.hostinger.com ~all` | — |
| TXT | `resend._domainkey` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC7QZVXVLt+1IbH7nDkTBYGj4ksduxTyRd6v9BqT5VxLd6gHFUaRqjNspwUQ1lxb8v1fIU5gQs/yqGgaAMXQhmBvAl1KP1UqPkPpzbvHFfA4BJQ5uTW3GtGspF4IZ6HMLDXIvOlYQIM0P1mH83TB+GoP9A3EbDG7PH162Iie76cjQIDAQAB` | — |
| MX | `send` | `feedback-smtp.sa-east-1.amazonses.com` (prio 10) | — |
| TXT | `send` | `v=spf1 include:amazonses.com ~all` | — |
| TXT | `_dmarc` | `v=DMARC1; p=none` | — |
| A | `wp` | `185.249.224.170` | 🔘 DNS only |
| A | `wp` | `77.37.85.162` | 🔘 DNS only |
| A | `ftp` | `82.180.156.185` | 🔘 DNS only |

**C. Agregar/ajustar para apuntar a la app nueva:**
| Tipo | Nombre | Valor | Nube |
|------|--------|-------|------|
| CNAME | `@` | `l61xsa3z.up.railway.app` | 🔘 **DNS only (gris)** |
| TXT | `_railway-verify` | `railway-verify=1860d16b104c4dca3e67a7fe3f9eb65fce6d587c8bdb334d3b00712dbb5bfae0` | — |
| CNAME | `www` | `l61xsa3z.up.railway.app` | 🔘 DNS only |
   - Si hubiera registros **A en la raíz (@)** importados que apuntan a Hostinger, **borralos** (los reemplaza el CNAME @ → Railway).
   - ⚠️ Las nubes de `@`, `www` y `wp` en **GRIS (DNS only)**, no naranja, para que el SSL de Railway y WordPress funcionen directo.

**D. Cambiar los nameservers en Hostinger:**
9. Cloudflare te da **2 nameservers** (ej. `xxx.ns.cloudflare.com`). En **Hostinger → Dominios → `elpasajedental.com` → Nameservers/DNS** → cambiar a "usar nameservers personalizados" y poner los 2 de Cloudflare.
10. **Esperar propagación** (suele ser 15 min a unas horas). Railway verifica el dominio y emite el **SSL** solo.
11. **Verificar:** `https://elpasajedental.com` abre la **TIENDA NUEVA**. ✅

---

## FASE 4 — Pruebas finales y seguridad
11. **Checkout completo** en `elpasajedental.com`: agregar al carrito → pagar con Mercado Pago → confirmar que **vuelve bien** y que el **pedido queda en WooCommerce**.
12. 🔐 **Rotar el token de producción de Mercado Pago** (el que pasaste en el chat conviene cambiarlo). Generás uno nuevo en MP → me lo pasás o lo cargás en Railway (`MP_ACCESS_TOKEN`).
13. Revisar que lleguen los **emails** (Resend) y que Google ya pueda **indexar** (el robots se activa solo en el dominio real).
14. **Andreani:** sigue dentro de WooCommerce, **no se toca**.
15. **Analytics + Search Console:** crear las cuentas y cargar en Railway las variables `GA_ID` (ej. `G-XXXX`) y `GSC_VERIFICATION`. En Search Console, dar de alta `elpasajedental.com` y **subir el sitemap** `https://elpasajedental.com/sitemap.xml`.
16. **Datos legales:** en `/legales` confirmar/ajustar la **razón social y el CUIT del titular** del comercio (hoy está como placeholder con el de Nancy 27-18184903-2).
17. **Avisos de pedido:** verificar que lleguen los emails (al dueño y al cliente) — depende de que Resend esté con el dominio verificado. Opcional: setear `MAIL_TO` si querés que el aviso al dueño vaya a otra casilla.

---

## 🔙 Si algo sale mal (rollback)
Volvé el registro de la raíz (`@`) al valor que anotaste en la Fase 0 → la tienda vieja vuelve a estar online. Nada se pierde.

---

### Resumen de quién hace qué
- **Vos (Hostinger + WP):** subdominio `wp`, cambiar URL de WordPress, DNS de la raíz, redirect de www, backup.
- **Yo (Railway + app):** `WC_URL` al subdominio, pruebas, ajustes finos.
- **Juntos:** pruebas del checkout y rotación del token de MP.

**Valores que vas a necesitar (Railway / DNS):**
- App (servicio Railway): `Elpasajedental` · URL de prueba: `elpasajedental-production.up.railway.app`
- CNAME raíz `@` → `l61xsa3z.up.railway.app`
- TXT `_railway-verify` → `railway-verify=1860d16b104c4dca3e67a7fe3f9eb65fce6d587c8bdb334d3b00712dbb5bfae0`
- WordPress nuevo: `https://wp.elpasajedental.com`
