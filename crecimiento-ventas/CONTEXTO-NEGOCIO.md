# 🏷️ Contexto del negocio — El Pasaje Dental

> **Este es el ÚNICO archivo que cambiás al reusar la skill en otro proyecto.**
> Los playbooks y plantillas leen de acá (placeholders `{{...}}`).

## Identidad
- **Negocio:** El Pasaje Dental — insumos odontológicos.
- **Tipo:** e-commerce + local físico (Tucumán, Argentina). Envíos a todo el país.
- **Web/tienda:** `{{TIENDA_URL}}` = https://elpasajedental.com
- **Instagram:** @elpasajedental
- **WhatsApp:** 381 208 5383
- **Marca/tono:** profesional pero cálido, español rioplatense, mobile-first. Rosa/fucsia/vino
  (`--rose-500 #DE3667`). Mascota: **Denti** 🦷.

## Público
- **Primario:** odontólogos/as y consultorios (compran consumibles recurrentes: bioseguridad,
  operatoria, endodoncia, impresión, etc.).
- **Secundario:** estudiantes de odontología (kits de facultad, instrumental, merch).
- **Comportamiento:** compran por necesidad y recurrencia; valoran stock real, rapidez y precio.
  Muchos cierran por WhatsApp.

## Activos que ya tenemos (lo que usamos para vender)
- **~469 clientes** con email + WhatsApp normalizado (+549...) e historial de compra (WooCommerce).
- **Base de prospectos B2B:** directorio de **~650 odontólogos/consultorios de Tucumán** que todavía
  no compran. Web: https://clientespasaje.netlify.app/ — cada registro tiene **nombre, dirección,
  teléfono/WhatsApp, email, especialidad** (general, ortodoncia, endodoncia, implantes, cirugía…) y
  estado de contacto. Aprox: **68 con email, 165+ con teléfono, 170+ solo dirección.** Filtros por
  tipo de dato y por especialidad; exporta emails a CSV / copia emails. → ver `playbooks/prospeccion.md`.
- **Tienda online** con catálogo sincronizado, cupones, carrito.
- **Email transaccional/masivo:** Resend (pestaña 📣 **Campañas** con redactor IA).
- **WhatsApp:** links wa.me con teléfonos normalizados (botón "Avisar" en pedidos/encargos).
- **Instagram:** posteos + reels (pestaña 📸 **Redes** genera imágenes/captions). Ya hicieron sorteos.
- **Chatbot Denti** en la web (responde dudas de producto con IA).
- **Panel interno** con finanzas, stock por ubicación, pedidos, cuenta corriente.

## Canales prioritarios (según el dueño)
Instagram · WhatsApp · Google (búsqueda) · Boca a boca / facultad.

## Reglas del negocio para campañas
- **Categorías fuertes:** Instrumental, Operatoria, Endodoncia, Facultad, Prótesis, Descartables,
  Bioseguridad. (62 categorías en total.)
- **Estacionalidad:** inicio de clases (kits estudiantes), fin de año, reposición de bioseguridad.
- **Promos:** se cargan como **cupones** en la tienda (sirven además para medir atribución).
- **Presupuesto ads:** chico — priorizar **retargeting** (a quien ya visitó) y **catálogo en Instagram**.
- **No prometer** lo que no hay: stock y precios salen del catálogo real.

## Objetivo actual
Vender más en **dos frentes a la vez**: (a) exprimir la base de clientes (reactivar/recomprar/referir)
y (b) atraer nuevos (Instagram/Google/boca a boca + base de prospectos), con ads de presupuesto chico.
