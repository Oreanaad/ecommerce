# Subir El Pasaje Dental a Railway

El proyecto ya está preparado para Railway: lee las claves de forma segura (variables de
entorno), guarda los datos en un volumen (no se borran), pide **contraseña** para entrar y
sincroniza el catálogo solo. Seguí estos pasos una vez.

> Costo aproximado: el plan **Hobby de Railway** arranca en ~USD 5/mes (incluye uso). Esta app
> consume muy poco. Sumale el crédito de Claude (centavos por consulta).

---

## Paso 1 — Crear cuenta en Railway

1. Entrá a **https://railway.app** → *Login* (podés usar tu email o GitHub).
2. En *Account → Plans*, activá el plan **Hobby** (necesita una tarjeta).

## Paso 2 — Instalar la herramienta de Railway (CLI)

En una terminal (ya tenés Node instalado):

```bash
npm install -g @railway/cli
```

## Paso 3 — Subir el proyecto

Parado en esta carpeta (`kit-skill-creator`):

```bash
railway login      # abre el navegador para confirmar
railway init       # crea el proyecto (poné un nombre, ej: pasaje-dental)
railway up         # sube el código y lo despliega
```

## Paso 4 — Cargar las variables (claves) en el panel

En **https://railway.app** → tu proyecto → pestaña **Variables** → *New Variable*, y agregá
una por una (los valores secretos están en tus archivos de `config/`):

| Variable | Valor |
|---|---|
| `WC_URL` | `https://elpasajedental.com` |
| `WC_KEY` | el `consumer_key` de `config/woocommerce.json` |
| `WC_SECRET` | el `consumer_secret` de `config/woocommerce.json` |
| `ANTHROPIC_API_KEY` | el `api_key` de `config/anthropic.json` |
| `ANTHROPIC_MODEL` | `claude-opus-4-8` |
| `APP_PASSWORD` | una contraseña que elijas (la que usarán tus empleados para entrar) |
| `DATA_DIR` | `/data` |

## Paso 5 — Agregar el volumen (para que no se borren los datos)

En el proyecto → botón **+ New** (o sobre el servicio, *Add Volume*) → **Volume**:
- **Mount path:** `/data`  (igual que `DATA_DIR`)

Esto guarda ubicaciones, mapa y catálogo de forma permanente.

## Paso 6 — Generar la dirección pública

En el servicio → **Settings → Networking → Generate Domain**. Te da una URL tipo
`https://pasaje-dental-production.up.railway.app`.

## Paso 7 — Entrar

Abrí esa URL → te pide la contraseña (`APP_PASSWORD`) → ¡listo! Ya funciona desde cualquier
celular o computadora, sin depender de tu máquina.

> La primera vez, el catálogo puede tardar ~1 minuto en sincronizar. Si entrás y ves pocos
> productos, esperá un momento y tocá **↻ Actualizar stock** (arriba a la derecha).

---

## Para actualizar el sistema más adelante

Cada vez que cambiemos algo en el código, subís la nueva versión con:

```bash
railway up
```

Los datos (ubicaciones, mapa) se mantienen porque viven en el volumen.

## Notas

- Las claves NO se suben con el código (están en `config/`, que está ignorado). Viven solo
  como variables en Railway.
- El botón **↻ Actualizar stock** trae precios y stock frescos de WooCommerce cuando quieras.
- Si querés cambiar la contraseña, editás `APP_PASSWORD` en *Variables* y listo.
