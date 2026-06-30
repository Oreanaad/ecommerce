// Servidor del sistema de ubicaciones. Sin dependencias. Sirve local y en la nube (Railway).
// Uso: node app/server.mjs
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { gzipSync, gzip } from "node:zlib";
import { promisify } from "node:util";
const gzipAsync = promisify(gzip);
import { fileURLToPath } from "node:url";
import { dirname, join, extname } from "node:path";
import { dataDir, loadAnthropic, loadResend, duenos } from "../scripts/lib.mjs";
import {
  initDb, getCatalogo, getProducto, upsertProducto, upsertVariacion,
  setStock, setPrecio, adjustStock, getCategorias, upsertCategoria,
  crearPedido, getPedido, getPedidos, updatePedidoStatus, updatePedido,
  getCliente, upsertCliente, getClientes, buscarClientes, actualizarCliente,
  getCupones, getCupon, crearCupon, borrarCupon, incrementarUsoCupon,
  getEstructuraCompleta, listArticulos, getArticuloDetalle,
  crearArticulo, actualizarArticulo, setArticuloAtributos, setArticuloModelos,
} from "./db.mjs";
import { crearAuth } from "./auth.mjs";
import { crearML } from "./ml.mjs";
import { crearMP } from "./mp.mjs";
import { crearNave } from "./nave.mjs";
import { crearTwilioWA } from "./twilio-wa.mjs";
import { randomBytes } from "node:crypto";
import { crearFinanzas } from "./finanzas.mjs";
import { crearAFIP } from "./afip.mjs";
import { calcularEnvio } from "./envio.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, "app/public");
const DATA = dataDir(ROOT);
const MUEBLES_PATH = join(ROOT, "data/muebles.json");
const CAT_PATH = join(DATA, "catalogo.json");
const UBIC_PATH = join(DATA, "ubicaciones.json");
const PLANO_PATH = join(DATA, "plano.json");
const PEDIDOS_PATH = join(DATA, "pedidos.json");
const AJUSTES_PATH = join(DATA, "ajustes.json");
const VENC_PATH = join(DATA, "vencimientos.json");
const INV_BACKUP_PATH = join(DATA, "inventario-backup.json"); // respaldo de ubicaciones antes de reiniciar el conteo
const SNAP_PATH = join(DATA, "snapshot-pruebas.json"); // snapshot manual de ubicaciones + vencimientos (para probar y restaurar)
const COMBOS_PATH = join(DATA, "combos.json"); // combos: producto-combo → componentes [{productId, variationId|null, cantidad}]
const PROSPECTOS_PATH = join(DATA, "prospectos.json");
const DESC_PATH = join(DATA, "descripciones.json"); // overlay de descripciones generadas con IA (no toca WooCommerce)
const PRESUP_PATH = join(DATA, "presupuestos.json"); // ventas guardadas (cotizaciones) sin confirmar
const qrSesiones = {}; // token -> { fotos:[url], ts } para subir fotos de factura desde el celular
const RECIBIR_ALIAS_PATH = join(DATA, "recibir-alias.json"); // aprende: nombre en la factura -> productId
const SOLIC_PATH = join(DATA, "solicitudes.json"); // solicitudes/pedidos de mejora del equipo
const ENCARGOS_PATH = join(DATA, "encargos.json"); // encargos de clientes: avisar cuando llega la mercadería
const AJUSTES_DEFAULT = { recargo_otros: 10, envio_tuc_fijo: 0, envio_tuc_gratis_desde: 0, venc_dias_aviso: 60, afip: { ambiente: "produccion", emisores: [{ cuit: "27181849032", razon: "Nancy Maria Zarate", punto_venta: 8, condicion_iva: "monotributo" }, { cuit: "20349100860", razon: "Maximiliano Espeche", punto_venta: 2, condicion_iva: "monotributo" }] } }; // recargo %, envío Tucumán, facturación ARCA (multi-emisor)
// Subtotal del carrito calculado en el server (anti-manipulación)
function subtotalItems(items, productos) {
  const byId = new Map((productos || []).map((p) => [p.id, p]));
  let s = 0;
  for (const it of items || []) {
    const p = byId.get(Number(it.id)); if (!p) continue;
    let precio = p.precio;
    if (it.variationId && Array.isArray(p.variaciones)) { const v = p.variaciones.find((x) => x.id === Number(it.variationId)); if (v) precio = v.precio; }
    s += (Number(precio) || 0) * Math.max(1, Number(it.qty) || 1);
  }
  return s;
}
// Tarifa de envío para Tucumán según ajustes (fijo, gratis a partir de un monto)
function tarifaTucuman(subtotal, aj) {
  const fijo = Number(aj.envio_tuc_fijo) || 0;
  const gratisDesde = Number(aj.envio_tuc_gratis_desde) || 0;
  if (gratisDesde > 0 && subtotal >= gratisDesde) return { rate_id: "tuc_gratis", method_id: "tuc_local", name: "Envío gratis (Tucumán)", price: 0 };
  return { rate_id: "tuc_fijo", method_id: "tuc_local", name: "Envío en Tucumán", price: fijo };
}
const PORT = Number(process.env.PORT || 4321);

// Contrasena de acceso (opcional). Si APP_PASSWORD no esta seteada, no pide login (modo local).
const PASSWORD = process.env.APP_PASSWORD || "";
const TOKEN = PASSWORD ? createHash("sha256").update("pasaje:" + PASSWORD).digest("hex") : "";
function autenticado(req) {
  if (!PASSWORD) return true;
  const cookie = req.headers.cookie || "";
  return cookie.split(";").some((p) => p.trim() === "sesion=" + TOKEN);
}
const LOGIN_HTML = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>El Pasaje Dental · Panel interno</title><style>body{font-family:-apple-system,system-ui,sans-serif;background:#f6f7f9;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
.box{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:28px;width:320px;box-shadow:0 1px 3px rgba(16,24,40,.08);text-align:center}
h1{color:#de3667;font-size:18px;margin:0 0 4px}p{color:#6b7280;font-size:13px;margin:0 0 16px}
input{width:100%;box-sizing:border-box;padding:12px;border:1px solid #e5e7eb;border-radius:10px;font-size:16px;margin-bottom:10px}
button{width:100%;padding:12px;background:#de3667;color:#fff;border:none;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer}
.err{color:#e0245e;font-size:13px;margin-bottom:10px;min-height:0}</style></head>
<body><form class="box" id="f"><h1>El Pasaje Dental</h1><p>Panel interno — ingresá con tu email y contraseña</p>
<div class="err" id="err"></div>
<input id="email" type="email" placeholder="Email" autocomplete="username" autofocus>
<input id="pass" type="password" placeholder="Contraseña" autocomplete="current-password">
<button>Entrar</button></form>
<script>
document.getElementById('f').onsubmit=async(e)=>{e.preventDefault();var err=document.getElementById('err');err.textContent='Verificando…';
try{var r=await fetch('/api/auth/login-clave',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:document.getElementById('email').value.trim(),password:document.getElementById('pass').value})});var d=await r.json();
if(d.ok&&(d.rol==='dueno'||d.rol==='empleado')){location.href='/admin';}
else if(d.ok){err.textContent='Tu cuenta no tiene acceso al panel.';}
else{err.textContent=d.error||'Email o contraseña incorrectos';}}catch(x){err.textContent='No se pudo conectar.';}};
</script></body></html>`;

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".ico": "image/x-icon" };

let CATS_CACHE = null, CATS_TS = 0;
const AUTH = crearAuth(ROOT);
const ML = crearML(ROOT);
const MP = crearMP();
const NAVE = crearNave();
const TWA = crearTwilioWA();
// Serializa las escrituras de stock por producto/variación: si llegan 2 sumas casi a la vez
// (ej. el mismo producto en 2 líneas de una factura), no se pisan (evita el lost-update).
const _stockLocks = new Map();
function conLockStock(key, fn) {
  const prev = _stockLocks.get(key) || Promise.resolve();
  const next = prev.then(fn, fn);
  _stockLocks.set(key, next.then(() => {}, () => {}));
  return next;
}
const FIN = crearFinanzas(ROOT);
const AFIP = crearAFIP(ROOT);
// Es personal autorizado (dueño/empleado): por sesión de email o por la clave legacy.
async function esStaff(req) {
  const email = AUTH.leerSesion(req.headers.cookie);
  if (!email) return false;
  const rol = await AUTH.rolDe(email);
  return rol === "dueno" || rol === "empleado";
}

// Es dueño (acceso total). Solo por sesión de email con rol "dueno".
async function esDueno(req) {
  const email = AUTH.leerSesion(req.headers.cookie);
  if (!email) return false;
  return (await AUTH.rolDe(email)) === "dueno";
}
async function readJson(p, fallback) {
  try { return JSON.parse(await readFile(p, "utf8")); } catch { return fallback; }
}
function send(res, code, body, type = "application/json") {
  res.writeHead(code, { "Content-Type": type });
  if (Buffer.isBuffer(body) || typeof body === "string") res.end(body);
  else res.end(JSON.stringify(body));
}
// JSON con gzip si el cliente lo acepta (para respuestas grandes como el catálogo)
function sendJsonGz(req, res, obj) {
  const body = JSON.stringify(obj);
  if ((req.headers["accept-encoding"] || "").includes("gzip") && body.length > 1024) {
    const gz = gzipSync(body);
    res.writeHead(200, { "Content-Type": "application/json", "Content-Encoding": "gzip" });
    return res.end(gz);
  }
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(body);
}
// Caché en memoria del catálogo público: evita re-leer+parsear+gzipear ~944KB en CADA visita
// (eso saturaba el event loop de un solo hilo). Se arma en SEGUNDO PLANO (arranque + sync + cada 60s),
// así NINGUNA visita dispara el trabajo pesado: todas reciben el buffer ya comprimido al instante.
let CAT_CACHE = { gz: null, ts: 0 };
let CAT_REBUILDING = false;
async function buildCatCache() {
  if (CAT_REBUILDING) return;
  CAT_REBUILDING = true;
  try {
    const cat = await getCatalogo();
    const combos = await readJson(COMBOS_PATH, {});
    const strip = (s) => (s || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim();
    const tieneStock = (p) => p && ((p.stock_status === "instock" && p.stock !== 0) || ((p.tipo === "variable" || (p.variaciones || []).length) && (p.variaciones || []).some((v) => v.stock_status === "instock" && v.stock !== 0)));
    const comboDisponible = (componentes) => (componentes || []).every((c) => {
      const cp = (cat.productos || []).find((x) => x.id === c.productId); if (!cp) return false;
      if (c.variationId) { const v = (cp.variaciones || []).find((x) => x.id === c.variationId); return !!(v && v.stock_status === "instock" && v.stock !== 0); }
      return tieneStock(cp);
    });
    const enStock = (cat.productos || []).filter((p) =>
      combos[String(p.id)] ? comboDisponible(combos[String(p.id)].componentes) :
      ((p.stock_status === "instock" && p.stock !== 0) ||
      (p.tipo === "variable" && (p.variaciones || []).some((v) => v.stock_status === "instock" && v.stock !== 0))))
      .map((p) => ({
        id: p.id, sku: p.sku, nombre: p.nombre, tipo: p.tipo, precio: p.precio,
        stock: p.stock, stock_status: p.stock_status, categorias: p.categorias || [], imagen: p.imagen,
        descripcion: strip(p.descripcion).slice(0, 600), descripcion_corta: strip(p.descripcion_corta).slice(0, 300),
        variaciones: (p.variaciones || []).map((v) => ({ id: v.id, label: v.label, precio: v.precio, stock: v.stock, stock_status: v.stock_status, sku: v.sku, imagen: v.imagen })),
      }));
    const categorias = [...new Set(enStock.flatMap((p) => p.categorias))].sort();
    const aj = await readJson(AJUSTES_PATH, AJUSTES_DEFAULT);
    const body = JSON.stringify({ productos: enStock, categorias, total: enStock.length, recargo: Number(aj.recargo_otros) || 0, envio_tuc_fijo: Number(aj.envio_tuc_fijo) || 0, envio_tuc_gratis_desde: Number(aj.envio_tuc_gratis_desde) || 0, mp: MP.configurado(), nave: NAVE.configurado() });
    const gz = await gzipAsync(body);
    CAT_CACHE = { gz, body, ts: Date.now() };
  } catch (e) { console.log("[cat-cache] error:", e.message); }
  finally { CAT_REBUILDING = false; }
}
// Sirve una página HTML siempre revalidada (evita quedar con versiones viejas en caché)
async function htmlPage(res, file) {
  try {
    const body = await readFile(join(PUBLIC, file));
    res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-cache, must-revalidate" });
    return res.end(body);
  } catch { return send(res, 404, "No encontrado", "text/plain"); }
}
// SEO: escape para atributos HTML
const escAttr = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const esc = escAttr; // alias para HTML/texto en vistas y emails server-side
// Datos estructurados del negocio (LocalBusiness/Store) para Google
function negocioLD(host) {
  return {
    "@context": "https://schema.org", "@type": "Store", "@id": `https://${host}/#store`,
    name: "El Pasaje Dental", image: `https://${host}/assets/logo.png`, logo: `https://${host}/assets/logo.png`,
    url: `https://${host}/`, telephone: "+5493812085383", email: "elpasajedental@gmail.com",
    priceRange: "$$", currenciesAccepted: "ARS", paymentAccepted: "Efectivo, Transferencia, Mercado Pago, Tarjetas",
    description: "Insumos y materiales odontológicos en Tucumán con stock real y envíos a todo el país.",
    address: { "@type": "PostalAddress", streetAddress: "Molina 1433, alt. Av. Mitre 50", addressLocality: "San Miguel de Tucumán", addressRegion: "Tucumán", postalCode: "4000", addressCountry: "AR" },
    openingHoursSpecification: [
      { "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], opens: "09:00", closes: "19:30" },
      { "@type": "OpeningHoursSpecification", dayOfWeek: ["Saturday"], opens: "10:00", closes: "13:30" },
    ],
    sameAs: ["https://www.instagram.com/elpasajedentalok"],
    areaServed: { "@type": "Country", name: "Argentina" },
    hasMap: "https://www.google.com/maps/search/?api=1&query=Molina+1433+San+Miguel+de+Tucum%C3%A1n",
  };
}
// Sirve una página inyectando título, descripción, canonical, Open Graph y JSON-LD por página (SEO)
async function htmlPageSEO(res, file, seo = {}) {
  try {
    let body = (await readFile(join(PUBLIC, file))).toString();
    const rep = (re, val) => { body = body.replace(re, (m, a, b) => a + escAttr(val) + b); };
    if (seo.title) { rep(/(<title>)[\s\S]*?(<\/title>)/, seo.title); rep(/(<meta property="og:title" content=")[^"]*(">)/, seo.title); }
    if (seo.description) { rep(/(<meta name="description" content=")[^"]*(">)/, seo.description); rep(/(<meta property="og:description" content=")[^"]*(">)/, seo.description); }
    rep(/(<meta property="og:image" content=")[^"]*(">)/, seo.image || `https://${seo.host || "elpasajedental.com"}/assets/logo.png`);
    let extra = "";
    if (seo.canonical) extra += `<link rel="canonical" href="${escAttr(seo.canonical)}"><meta property="og:url" content="${escAttr(seo.canonical)}">`;
    for (const ld of (seo.jsonld || [])) extra += `<script type="application/ld+json">${JSON.stringify(ld)}</script>`;
    // Google Search Console (verificación) y Google Analytics — por variables de entorno, sin tocar código
    if (process.env.GSC_VERIFICATION) extra += `<meta name="google-site-verification" content="${escAttr(process.env.GSC_VERIFICATION)}">`;
    if (process.env.GA_ID) extra += `<script async src="https://www.googletagmanager.com/gtag/js?id=${escAttr(process.env.GA_ID)}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${escAttr(process.env.GA_ID)}');</script>`;
    if (extra) body = body.replace("</head>", extra + "</head>");
    res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-cache, must-revalidate" });
    return res.end(body);
  } catch { return send(res, 404, "No encontrado", "text/plain"); }
}
function readBody(req) {
  return new Promise((resolve) => {
    let d = "";
    req.on("data", (c) => (d += c));
    req.on("end", () => { try { resolve(JSON.parse(d || "{}")); } catch { resolve({}); } });
  });
}

const norm = (s) => (s || "").toString().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// Recupera los productos mas relevantes para la pregunta (para no mandar las 1051 fichas a Claude)
function recuperar(catalogo, muebles, ubic, pregunta, limite = 35) {
  const slotIndex = new Map();
  for (const m of muebles.muebles || [])
    for (const sec of m.secciones)
      for (const sl of sec.slots) slotIndex.set(sl.id, `${m.nombre} · ${sl.label}`);
  const ubicDe = (id) => (ubic.asignaciones || []).filter((a) => a.productId === id).map((a) => slotIndex.get(a.slotId) || a.slotId);

  const terms = norm(pregunta).split(/\s+/).filter((t) => t.length > 2);
  const scored = (catalogo.productos || []).map((p) => {
    const nom = norm(p.nombre), cat = norm(p.categorias.join(" ")), desc = norm(p.descripcion || "");
    let score = 0;
    for (const t of terms) {
      if (nom.includes(t)) score += 3;
      if (cat.includes(t)) score += 2;
      if (desc.includes(t)) score += 1;
    }
    return { p, score };
  }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limite);

  return scored.map(({ p }) => {
    const u = ubicDe(p.id);
    const stock = p.stock_status === "instock" && p.stock !== 0 ? `stock ${p.stock}` : "SIN STOCK";
    const desc = (p.descripcion || "").slice(0, 160);
    return `- [#${p.sku || p.id}] ${p.nombre} | $${p.precio} | ${stock} | ${p.categorias.join(", ")}` +
      (u.length ? ` | Ubicacion: ${u.join(" ; ")}` : " | sin ubicacion asignada") +
      (desc ? ` | ${desc}` : "");
  }).join("\n");
}

function toolWebSearch(model) {
  return model.includes("haiku") || model.includes("sonnet-4-5")
    ? { type: "web_search_20250305", name: "web_search" }
    : { type: "web_search_20260209", name: "web_search" };
}

async function preguntarClaude(pregunta, cliente = false) {
  const cfg = await loadAnthropic(ROOT);
  if (!cfg || !cfg.api_key || cfg.api_key.startsWith("sk-ant-...")) {
    return { error: "Falta configurar la API key de Claude (config/anthropic.json o variable ANTHROPIC_API_KEY)" };
  }
  const model = cfg.model || "claude-opus-4-8";
  const [catalogo, muebles, ubic] = await Promise.all([
    getCatalogo(),
    readJson(MUEBLES_PATH, { muebles: [] }),
    readJson(UBIC_PATH, { asignaciones: [] }),
  ]);
  const contexto = recuperar(catalogo, muebles, ubic, pregunta);
  const system = cliente ? `Sos "Denti", la mascota (un diente 🦷) asistente de la tienda online El Pasaje Dental (insumos odontológicos, Tucumán, Argentina). Hablás con CLIENTES (odontólogos, estudiantes y consultorios).
Reglas:
- Español rioplatense, simpático, claro y BREVE (2-4 frases). Podés usar 1 emoji.
- Explicás para qué sirve un material/producto (ej. "qué es el alginato"), respondés dudas de productos y odontológicas generales.
- Si tenemos productos relevantes EN STOCK, recomendalos por nombre y precio e invitá a verlos en la tienda. NO menciones ubicaciones internas, códigos internos ni cantidades exactas de stock.
- No inventes precios: usá solo los de la lista. Si no sabés algo puntual, sugerí escribir por WhatsApp.
- No des indicaciones clínicas/médicas riesgosas; para diagnósticos o tratamientos, que consulte a un profesional.

PRODUCTOS DISPONIBLES (nombre, precio, categorías, descripción):
${contexto || "(sin coincidencias; respondé de forma general)"}`
    : `Sos el asistente del local de insumos odontologicos El Pasaje Dental. Ayudas a los empleados a encontrar productos, recomendar segun el stock disponible y explicar para que sirve cada cosa.
Reglas:
- Responde en espanol rioplatense, claro y breve, pensando que lo lee un empleado frente a un cliente.
- Recomenda SOLO productos con stock disponible (los marcados SIN STOCK no se ofrecen, salvo que pregunten explicitamente).
- Cuando un producto este en la lista, deci DONDE esta (su ubicacion) para que el empleado lo agarre.
- Para explicar que es o para que sirve un producto, usa la descripcion. Si no alcanza, busca en internet y aclara que esa info es de fuentes externas.
- No inventes ubicaciones, precios ni stock: usa solo lo que figura abajo.

PRODUCTOS RELEVANTES DEL STOCK (codigo, precio, stock, categorias, ubicacion, descripcion):
${contexto || "(no se encontraron coincidencias directas; podes buscar en internet si es una pregunta general)"}`;

  let messages = [{ role: "user", content: pregunta }];
  let data;
  for (let i = 0; i < 6; i++) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": cfg.api_key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: 1500, system, tools: [toolWebSearch(model)], messages }),
    });
    data = await res.json();
    if (data.type === "error") return { error: data.error?.message || "Error de la API de Claude" };
    if (data.stop_reason === "pause_turn") { messages.push({ role: "assistant", content: data.content }); continue; }
    break;
  }
  const texto = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  return { texto: texto || "(sin respuesta)" };
}

// Skill de marketing: redacta una campaña de email (asunto + cuerpo) para El Pasaje Dental con Claude.
async function redactarCampana(brief) {
  const cfg = await loadAnthropic(ROOT);
  if (!cfg || !cfg.api_key || cfg.api_key.startsWith("sk-ant-...")) return { error: "Falta configurar la API key de Claude" };
  const model = cfg.model || "claude-opus-4-8";
  const system = `Sos un copywriter experto en email marketing para El Pasaje Dental, una tienda de insumos odontológicos en Tucumán, Argentina. El público son odontólogos, estudiantes de odontología y consultorios.
Escribís campañas que se ABREN y se LEEN, en español rioplatense, cálido y profesional.
Reglas:
- ASUNTO: corto (máx ~50 caracteres), atractivo, sin MAYÚSCULAS gritonas ni palabras tipo "spam". Como mucho 1 emoji y solo si suma.
- CUERPO: breve y escaneable: saludo, un gancho, 2 a 4 líneas o bullets cortos, y un cierre con una llamada a la acción clara hacia la tienda online (elpasajedental.com). Pensado para leerse en el celular.
- TONO: cercano pero profesional, enfocado en el beneficio para el profesional (stock real, ahorro de tiempo, envíos a todo el país, buenos precios, facilidades de pago).
- NO inventes precios, porcentajes de descuento, cuotas ni fechas: usá SOLO lo que el usuario te dé en el pedido. Si no hay un descuento puntual, vendé el valor general.
- Nada de promesas falsas ni superlativos vacíos ("el mejor del mundo", "garantizado").
- Cerrá firmando como "El equipo de El Pasaje Dental".
Devolvé EXCLUSIVAMENTE un JSON válido, sin texto adicional, con la forma: {"asunto":"...","cuerpo":"..."}. En el cuerpo usá saltos de línea reales (\\n) entre párrafos.`;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": cfg.api_key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: 1200, system, messages: [{ role: "user", content: `Pedido para la campaña: ${brief}` }] }),
    });
    const data = await r.json();
    if (data.type === "error") return { error: data.error?.message || "Error de la API de Claude" };
    const texto = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    const m = texto.match(/\{[\s\S]*\}/);
    if (m) { try { const o = JSON.parse(m[0]); if (o.asunto || o.cuerpo) return { ok: true, asunto: o.asunto || "", cuerpo: o.cuerpo || "" }; } catch {} }
    return { ok: true, asunto: "", cuerpo: texto };
  } catch (e) { return { error: e.message }; }
}

// Genera descripciones para un lote de productos en una sola llamada a Claude. Devuelve { descripciones: {id: texto} }.
async function generarDescripciones(productos) {
  const cfg = await loadAnthropic(ROOT);
  if (!cfg || !cfg.api_key || cfg.api_key.startsWith("sk-ant-...")) return { error: "Falta configurar la API key de Claude" };
  const model = cfg.model || "claude-opus-4-8";
  const lista = productos.map((p) => `${p.id} | ${p.nombre} | ${(p.categorias || []).join(", ")}`).join("\n");
  const system = `Sos redactor de fichas de producto para El Pasaje Dental, tienda de insumos odontológicos en Argentina. Para CADA producto escribís una descripción breve (40 a 60 palabras), clara y profesional, en español neutro-rioplatense, útil para la ficha de la tienda y para SEO.
Reglas:
- Describí QUÉ es el producto y PARA QUÉ se usa, según su nombre y categoría.
- NO inventes medidas, composición, material, marca, cantidades ni datos técnicos que no estén explícitos en el nombre.
- Nada de superlativos vacíos ("el mejor", "increíble") ni precios.
- Si el nombre es ambiguo, hacé una descripción general y correcta sin inventar.
Devolvé EXCLUSIVAMENTE un JSON válido con la forma {"ID":"descripción", ...} usando exactamente los IDs que te paso.`;
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": cfg.api_key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: 3000, system, messages: [{ role: "user", content: `Productos (ID | nombre | categorías):\n${lista}` }] }),
    });
    const data = await r.json();
    if (data.type === "error") return { error: data.error?.message || "Error de la API de Claude" };
    const texto = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    const m = texto.match(/\{[\s\S]*\}/);
    if (m) { try { return { descripciones: JSON.parse(m[0]) }; } catch {} }
    return { error: "No se pudo interpretar la respuesta de la IA" };
  } catch (e) { return { error: e.message }; }
}

// Avisa por email del pedido: al dueño (siempre) y confirmación al cliente. Fire-and-forget.
async function notificarPedido(o, { metodoPago, pagado } = {}) {
  try {
    const resend = await loadResend(ROOT);
    if (!resend || !resend.api_key) return;
    const dueno = process.env.MAIL_TO || "elpasajedental@gmail.com";
    const nombre = `${o.billing?.first_name || ""} ${o.billing?.last_name || ""}`.trim();
    const cliente = o.billing?.email;
    const fmt = (n) => "$" + Number(n || 0).toLocaleString("es-AR");
    const filas = (o.line_items || []).map((li) => `<tr><td style="padding:4px 0">${esc(li.name)}</td><td style="text-align:center">x${li.quantity}</td><td style="text-align:right">${fmt(li.total)}</td></tr>`).join("");
    const resumen = `<table style="width:100%;border-collapse:collapse;font-size:14px;margin-top:8px">${filas}<tr><td colspan="2" style="padding-top:8px"><b>Total</b></td><td style="text-align:right;padding-top:8px"><b>${fmt(o.total)}</b></td></tr></table>`;
    const envio = (o.shipping_lines || []).map((s) => s.method_title).join(", ");
    const dir = [o.shipping?.address_1, o.shipping?.city, o.shipping?.state].filter(Boolean).join(", ");
    const pagoTxt = metodoPago === "mp" ? (pagado ? "Mercado Pago — PAGADO ✅" : "Mercado Pago (pendiente)") : metodoPago === "transferencia" ? "Transferencia" : metodoPago === "efectivo" ? "Efectivo" : "-";
    const enviar = (to, subject, html) => fetch("https://api.resend.com/emails", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + resend.api_key }, body: JSON.stringify({ from: resend.from, to: [to], subject, html }) }).catch(() => {});
    await enviar(dueno, `🛒 Nuevo pedido #${o.number} — ${fmt(o.total)}`, `<div style="font-family:sans-serif"><h2>🛒 Nuevo pedido #${o.number}</h2><p><b>Cliente:</b> ${esc(nombre)} (${esc(cliente || "")})<br><b>Tel:</b> ${esc(o.billing?.phone || "-")}<br><b>Pago:</b> ${pagoTxt}<br><b>Envío:</b> ${esc(envio || "-")}${dir ? " — " + esc(dir) : ""}</p>${resumen}</div>`);
    if (cliente) await enviar(cliente, `Recibimos tu pedido #${o.number} · El Pasaje Dental`, `<div style="font-family:sans-serif;max-width:520px;color:#334155"><h2 style="color:#DE3667">¡Gracias por tu compra! 🦷</h2><p>Hola ${esc(nombre.split(" ")[0] || "")}, recibimos tu pedido <b>#${o.number}</b> y ya lo estamos viendo.</p>${resumen}<p style="margin-top:12px"><b>Forma de pago:</b> ${pagoTxt}</p>${metodoPago === "transferencia" ? "<p>En breve te pasamos los datos para la transferencia.</p>" : metodoPago === "efectivo" ? "<p>Coordinamos el pago en efectivo.</p>" : ""}<p style="color:#94a3b8;font-size:13px;margin-top:16px">Cualquier duda respondé este email o escribinos por WhatsApp.<br>El Pasaje Dental · Insumos odontológicos · Tucumán.</p></div>`);
  } catch { /* no romper el flujo del pedido por un email */ }
}

// Envío de email genérico (Resend). No rompe el flujo si falla. attachments: [{filename, content(base64)}].
async function enviarEmail(to, subject, html, attachments) {
  try {
    const resend = await loadResend(ROOT);
    if (!resend || !resend.api_key || !to) return;
    const body = { from: resend.from, to: [to], subject, html };
    if (attachments && attachments.length) body.attachments = attachments;
    await fetch("https://api.resend.com/emails", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + resend.api_key }, body: JSON.stringify(body) });
  } catch { /* noop */ }
}
// Arma el backup de los datos propios (no-WooCommerce) en un JSON
async function construirBackup() {
  const archivos = ["ubicaciones.json", "plano.json", "muebles.json", "usuarios.json", "pedidos.json", "ajustes.json", "vencimientos.json", "prospectos.json", "descripciones.json", "finanzas.json", "facturas.json", "encargos.json", "solicitudes.json", "recibir-alias.json"];
  const bundle = { _generado: new Date().toISOString(), _negocio: "El Pasaje Dental" };
  for (const f of archivos) bundle[f] = await readJson(join(DATA, f), null);
  const stamp = new Date().toISOString().slice(0, 10);
  return { filename: `backup-pasaje-${stamp}.json`, contenido: JSON.stringify(bundle, null, 2), stamp };
}
// Backup diario automático por email (1 vez al día)
const BACKUP_ESTADO = join(DATA, "backup-estado.json");
async function enviarBackupDiario() {
  const dest = process.env.MAIL_TO || (process.env.DUENOS || "maximilianoespeche@gmail.com").split(",")[0].trim();
  const b = await construirBackup();
  const content = Buffer.from(b.contenido).toString("base64");
  await enviarEmail(dest, `🔐 Backup El Pasaje Dental — ${b.stamp}`,
    `<div style="font-family:sans-serif;max-width:520px;color:#334155"><h2 style="color:#DE3667">Backup automático 🔐</h2>
     <p>Adjunto el backup de los datos del <b>${b.stamp}</b>: ubicaciones, muebles, clientes, finanzas, facturas, vencimientos, encargos, solicitudes y ajustes.</p>
     <p>Guardalo en un lugar seguro (no incluye productos/pedidos: esos están en WooCommerce).</p>
     <p style="color:#94a3b8;font-size:13px;margin-top:14px">El Pasaje Dental · backup diario</p></div>`,
    [{ filename: b.filename, content }]);
}
async function chequearBackupDiario() {
  try {
    const now = new Date(); const hoy = now.toISOString().slice(0, 10);
    if (now.getUTCHours() < 6) return; // ~3 AM Argentina
    let ultimo = ""; try { ultimo = (JSON.parse(await readFile(BACKUP_ESTADO, "utf8"))).fecha || ""; } catch {}
    if (ultimo === hoy) return;
    await writeFile(BACKUP_ESTADO, JSON.stringify({ fecha: hoy })).catch(() => {});
    await enviarBackupDiario();
    console.log("[backup] enviado por email", hoy);
  } catch (e) { console.log("[backup] error:", e.message); }
}

// Aviso por email a los dueños el DÍA ANTERIOR a que entren cheques a cubrir (emitidos sin pagar).
const CHEQUE_AVISO = join(DATA, "cheque-aviso-estado.json");
async function chequearChequesProximos(force, soloA) {
  try {
    const now = new Date();
    if (!force && now.getUTCHours() < 11) return; // ~8 AM Argentina (UTC-3)
    const arg = new Date(now.getTime() - 3 * 3600 * 1000);
    const hoyArg = arg.toISOString().slice(0, 10);
    let ultimo = ""; try { ultimo = (JSON.parse(await readFile(CHEQUE_AVISO, "utf8"))).fecha || ""; } catch {}
    if (!force && ultimo === hoyArg) return; // ya avisamos hoy
    const fin = await FIN.todo();
    const porCubrir = (fin.cheques || []).filter((c) => c.tipo === "emitido" && !["pagado", "rechazado", "cobrado"].includes(c.estado) && (c.vencimiento || "").slice(0, 10) === hoyArg);
    const porCobrar = (fin.cheques || []).filter((c) => c.tipo === "recibido" && !["cobrado", "rechazado"].includes(c.estado) && (c.vencimiento || "").slice(0, 10) === hoyArg);
    if (!porCubrir.length && !porCobrar.length) return { ok: true, enviados: 0, hoy: hoyArg }; // no marca el día: si cargás cheques más tarde, los agarra
    const fmt = (n) => "$" + Number(n || 0).toLocaleString("es-AR");
    const fechaTit = hoyArg.split("-").reverse().join("/");
    const td = "padding:7px 10px;border-bottom:1px solid #eee", th = "padding:7px 10px;border-bottom:2px solid #DE3667";
    let html = `<div style="font-family:sans-serif;max-width:640px;color:#334155">`;
    const subj = [];
    if (porCubrir.length) {
      const total = porCubrir.reduce((s, c) => s + (Number(c.monto) || 0), 0);
      const totalImp = porCubrir.reduce((s, c) => s + (Number(c.monto_con_impuestos) || Number(c.monto) || 0), 0);
      const filas = porCubrir.map((c) => `<tr><td style="${td}">${esc(c.tercero || "")}</td><td style="${td}">${esc(c.numero || "")}</td><td style="${td};text-align:right"><b>${fmt(c.monto)}</b></td><td style="${td};text-align:right">${c.monto_con_impuestos ? fmt(c.monto_con_impuestos) : "—"}</td></tr>`).join("");
      html += `<h2 style="color:#7a1040">⚠️ Cheques a CUBRIR hoy (${fechaTit})</h2>
        <p>Hoy entran <b>${porCubrir.length} cheque(s)</b> a proveedores. Asegurá los fondos:</p>
        <p style="font-size:22px;background:#fff4e6;border:1px solid #f5c98a;border-radius:10px;padding:14px 18px;color:#9a5b00">💰 A transferir (con impuesto): <b>${fmt(totalImp)}</b>${totalImp !== total ? ` <span style="font-size:14px;color:#9a8a93">· neto ${fmt(total)}</span>` : ""}</p>
        <table style="border-collapse:collapse;width:100%;font-size:14px"><thead><tr><th style="text-align:left;${th}">Proveedor</th><th style="text-align:left;${th}">N° cheque</th><th style="text-align:right;${th}">Monto</th><th style="text-align:right;${th}">Con imp.</th></tr></thead><tbody>${filas}</tbody></table>`;
      subj.push(`cubrir ${fmt(totalImp)}`);
    }
    if (porCobrar.length) {
      const totalC = porCobrar.reduce((s, c) => s + (Number(c.monto) || 0), 0);
      const filasC = porCobrar.map((c) => `<tr><td style="${td}">${esc(c.banco || "—")}</td><td style="${td}">${esc(c.tercero || "—")}</td><td style="${td};text-align:right"><b>${fmt(c.monto)}</b></td></tr>`).join("");
      html += `<h2 style="color:#15803d">🟢 Cheques a COBRAR / depositar hoy (${fechaTit})</h2>
        <p>Hoy podés <b>depositar/cobrar ${porCobrar.length} cheque(s)</b> de clientes por <b style="color:#15803d">${fmt(totalC)}</b>:</p>
        <table style="border-collapse:collapse;width:100%;font-size:14px"><thead><tr><th style="text-align:left;${th}">Banco</th><th style="text-align:left;${th}">De</th><th style="text-align:right;${th}">Monto</th></tr></thead><tbody>${filasC}</tbody></table>`;
      subj.push(`cobrar ${fmt(totalC)}`);
    }
    html += `<p style="margin-top:14px;font-size:12px;color:#999">El Pasaje Dental · aviso automático de cheques 🏦</p></div>`;
    const dest = soloA ? [soloA] : duenos();
    for (const d of dest) { try { await enviarEmail(d, `🏦 Cheques hoy — ${subj.join(" · ")}`, html); } catch {} }
    if (!soloA) await writeFile(CHEQUE_AVISO, JSON.stringify({ fecha: hoyArg })).catch(() => {});
    console.log(`[cheques-aviso] ${hoyArg} · cubrir ${porCubrir.length} · cobrar ${porCobrar.length}${soloA ? " (preview " + soloA + ")" : ""}`);
    return { ok: true, enviados: dest.length, hoy: hoyArg, cubrir: porCubrir.length, cobrar: porCobrar.length, dest };
  } catch (e) { console.log("[cheques-aviso] error:", e.message); return { error: e.message }; }
}

// Guarda/quita de forma persistente que un pedido es "para reparto" (se sigue viendo en Reparto aunque cambie de estado).
async function marcarReparto(id, on) {
  try {
    const d = await readJson(PEDIDOS_PATH, { preparados: {} });
    if (!d.reparto) d.reparto = {};
    if (on) d.reparto[String(id)] = { fecha: new Date().toISOString() };
    else delete d.reparto[String(id)];
    await writeFile(PEDIDOS_PATH, JSON.stringify(d, null, 2));
  } catch { /* noop */ }
}

// Descuenta `qty` del/los slot(s) recomendado(s) de un producto en ubicaciones (muta `ubic`).
// Devuelve la lista de descuentos [{slotId, cant}] para poder revertirlos si el pedido se cancela.
// Mismo criterio que la recomendación de pickeo: guardado > exhibición > depósito; entre iguales, el que más tiene.
function descontarUbic(ubic, muebles, productId, variationId, qty) {
  qty = Math.round(Number(qty) || 0);
  if (qty <= 0) return [];
  const rolRank = { guardado: 0, exhibicion: 1, deposito: 2 };
  const slotRol = new Map();
  // "Vidrio superior" (de los mostradores) y "Depósito reposición" → última alternativa: solo se sacan si no hay en otro lado
  const ultimaSlots = new Set();
  for (const m of muebles.muebles || []) for (const sec of m.secciones || []) for (const sl of sec.slots || []) {
    slotRol.set(sl.id, m.rol || "guardado");
    if (m.id === "deposito-reposicion" || /vidrio\s+superior/i.test(sl.label || "")) ultimaSlots.add(sl.id);
  }
  const vId = variationId || null;
  // candidatos: asignaciones de ese producto/variación con cantidad numérica > 0 (las "sin cantidad" no se tocan)
  const cand = (ubic.asignaciones || []).filter((a) => a.productId === productId && ((a.variationId || null) === vId || a.variationId == null) && a.cantidad != null && Number(a.cantidad) > 0);
  if (!cand.length) return [];
  cand.sort((a, b) => {
    const ua = ultimaSlots.has(a.slotId) ? 1 : 0, ub = ultimaSlots.has(b.slotId) ? 1 : 0;
    if (ua !== ub) return ua - ub; // las "última alternativa" van al final
    const ra = rolRank[slotRol.get(a.slotId)] ?? 0, rb = rolRank[slotRol.get(b.slotId)] ?? 0;
    if (ra !== rb) return ra - rb;
    return (Number(b.cantidad) || 0) - (Number(a.cantidad) || 0);
  });
  let resto = qty; const tomados = [];
  for (const a of cand) {
    if (resto <= 0) break;
    const tomar = Math.min(Number(a.cantidad) || 0, resto);
    if (tomar > 0) { a.cantidad = (Number(a.cantidad) || 0) - tomar; resto -= tomar; tomados.push({ slotId: a.slotId, cant: tomar }); }
  }
  return tomados;
}

// Revierte (suma de nuevo) en ubicaciones lo que un pedido había descontado. `desc` = [{productId, variationId, slotId, cant}].
function restaurarUbic(ubic, desc) {
  if (!Array.isArray(desc) || !desc.length) return false;
  if (!Array.isArray(ubic.asignaciones)) ubic.asignaciones = [];
  for (const d of desc) {
    const vId = d.variationId || null;
    const a = ubic.asignaciones.find((x) => x.productId === d.productId && (x.variationId || null) === vId && x.slotId === d.slotId);
    if (a) a.cantidad = (Number(a.cantidad) || 0) + Number(d.cant);
    else ubic.asignaciones.push({ productId: d.productId, variationId: vId, slotId: d.slotId, nota: "", cantidad: Number(d.cant) });
  }
  return true;
}

// Ajusta el stock en la DB sumando `delta` (negativo = baja). Atómico en Postgres, sin locks JS.
async function ajustarStockDB(productId, variationId, delta) {
  try { await adjustStock(Number(productId), variationId ? Number(variationId) : null, delta); }
  catch (e) { console.log("[ajustarStockDB]", e.message); }
}
// Devuelve `amount` a las ubicaciones desde lo que el pedido había descontado (reduce el registro `desc`).
function restaurarDesdeDesc(ubic, desc, productId, variationId, amount) {
  amount = Math.round(Number(amount) || 0); if (amount <= 0) return;
  const vId = variationId || null;
  if (!Array.isArray(ubic.asignaciones)) ubic.asignaciones = [];
  for (const d of desc) {
    if (amount <= 0) break;
    if (d.productId !== productId || (d.variationId || null) !== vId) continue;
    const dev = Math.min(Number(d.cant) || 0, amount);
    if (dev <= 0) continue;
    const a = ubic.asignaciones.find((x) => x.productId === productId && (x.variationId || null) === vId && x.slotId === d.slotId);
    if (a) a.cantidad = (Number(a.cantidad) || 0) + dev; else ubic.asignaciones.push({ productId, variationId: vId, slotId: d.slotId, nota: "", cantidad: dev });
    d.cant = (Number(d.cant) || 0) - dev; amount -= dev;
  }
}

// Carga en la caja el ingreso de una venta WEB pagada (MP/Nave), si no existe ya (idempotente por ref "venta:id").
async function ingresoVentaCaja(o, cuenta) {
  if (!o || !o.id) return;
  const ref = "venta:" + o.id;
  try {
    const data = await FIN.todo();
    if ((data.movimientos || []).some((m) => m.ref === ref)) return; // ya está cargado (no duplicar)
    const nombre = `${o.billing?.first_name || ""} ${o.billing?.last_name || ""}`.trim();
    await FIN.agregar("movimientos", { tipo: "ingreso", cuenta, monto: Math.round(Number(o.total) || 0), categoria: "Ventas", detalle: `Venta web #${o.number || o.id}${nombre ? " · " + nombre : ""}`, fecha: new Date().toISOString().slice(0, 10), ref });
    console.log(`[caja] ingreso venta web ${ref} → ${cuenta} $${o.total}`);
  } catch (e) { console.log("[ingresoVentaCaja]", e.message); }
}

const server = createServer(async (req, res) => {
  const u = new URL(req.url, `http://localhost:${PORT}`);

  // ---- Login ----
  if (u.pathname === "/login") {
    return send(res, 200, LOGIN_HTML, "text/html");
  }

  // ---- Tienda publica: un producto por id (incluye sin stock, para links directos) ----
  // ¿la sesión actual es staff? (para vender a nombre de un cliente desde el checkout público)
  if (u.pathname === "/api/tienda/soy-staff") {
    return send(res, 200, { staff: await esStaff(req) });
  }
  if (u.pathname === "/api/tienda/producto") {
    const id = Number(u.searchParams.get("id"));
    const p = await getProducto(id);
    if (!p) return send(res, 404, { error: "Producto no encontrado" });
    const aj = await readJson(AJUSTES_PATH, AJUSTES_DEFAULT);
    let prod = p;
    if (!(p.descripcion || "").trim() && !(p.descripcion_corta || "").trim()) {
      const ov = await readJson(DESC_PATH, { descripciones: {} });
      const d = (ov.descripciones || {})[p.id];
      if (d) prod = { ...p, descripcion: d, descripcion_ia: true };
    }
    return send(res, 200, { producto: prod, recargo: Number(aj.recargo_otros) || 0 });
  }

  // ---- Tienda publica: jerarquia de categorias (con cache 10 min) ----
  if (u.pathname === "/api/tienda/categorias") {
    if (!CATS_CACHE || Date.now() - CATS_TS > 600000) {
      try {
        const cats = await getCategorias();
        CATS_CACHE = cats.filter((c) => c.parent_id === 0).sort((a, b) => (b.count || 0) - (a.count || 0))
          .map((p) => ({ id: p.id, name: p.nombre, slug: p.slug, count: p.count || 0,
            hijas: cats.filter((c) => c.parent_id === p.id).sort((a, b) => (b.count || 0) - (a.count || 0))
              .map((h) => ({ id: h.id, name: h.nombre, slug: h.slug, count: h.count || 0, parent: p.id })) }));
        CATS_TS = Date.now();
      } catch { CATS_CACHE = []; }
    }
    return send(res, 200, { categorias: CATS_CACHE });
  }

  // ---- Tienda publica (clientes, sin login) — SOLO productos con stock ----
  if (u.pathname === "/api/tienda/catalogo") {
    if (!CAT_CACHE.gz) await buildCatCache(ROOT); // solo la primerísima vez (arranque en frío)
    const acceptsGz = (req.headers["accept-encoding"] || "").includes("gzip");
    if (acceptsGz && CAT_CACHE.gz) {
      res.writeHead(200, { "Content-Type": "application/json", "Content-Encoding": "gzip", "Cache-Control": "public, max-age=60" });
      return res.end(CAT_CACHE.gz);
    }
    res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" });
    return res.end(CAT_CACHE.body || "{\"productos\":[],\"categorias\":[],\"total\":0}");
  }

  // ---- Tarifas de envío en vivo (Store API de WooCommerce: incluye Andreani) ----
  if (u.pathname === "/api/tienda/envio" && req.method === "POST") {
    const body = await readBody(req);
    const items = Array.isArray(body.items) ? body.items : [];
    const a = body.address || {};
    if (!items.length) return send(res, 400, { error: "El carrito está vacío." });
    if (!a.postcode || !a.state) return send(res, 400, { error: "Indicá provincia y código postal." });
    const aj = await readJson(AJUSTES_PATH, AJUSTES_DEFAULT);
    if ((a.state || "").toUpperCase() === "T") {
      const cat = await getCatalogo();
      return send(res, 200, { ok: true, rates: [tarifaTucuman(subtotalItems(items, cat.productos), aj)] });
    }
    // Otras provincias: tarifa fija configurable (aj.envio_nacional_fijo) hasta integrar Andreani directo
    const fijo = Number(aj.envio_nacional_fijo) || 0;
    return send(res, 200, { ok: true, rates: [{ rate_id: "nacional_fijo", method_id: "flat_rate", name: "Envío a domicilio", price: fijo }] });
  }

  // ---- Checkout: crea el pedido en WooCommerce y devuelve la URL de pago nativa (Mercado Pago / Andreani corren en WC) ----
  // ---- Promo pública (banner en home/tienda) ----
  if (u.pathname === "/api/tienda/promo") {
    const aj = await readJson(AJUSTES_PATH, AJUSTES_DEFAULT);
    const p = aj.promo || {};
    let activo = !!p.activo;
    if (activo && p.hasta) { try { if (new Date(p.hasta + "T23:59:59") < new Date()) activo = false; } catch {} }
    return send(res, 200, activo ? { activo: true, texto: p.texto || "", codigo: p.codigo || "", hasta: p.hasta || "" } : { activo: false });
  }
  // ---- Tienda: mascota "Denti" responde dudas de clientes (IA) ----
  if (u.pathname === "/api/tienda/preguntar" && req.method === "POST") {
    const { pregunta } = await readBody(req);
    if (!pregunta || !pregunta.trim()) return send(res, 400, { error: "Escribí tu pregunta" });
    if (String(pregunta).length > 500) return send(res, 400, { error: "La pregunta es muy larga" });
    try { return send(res, 200, await preguntarClaude(pregunta.trim(), true)); }
    catch (e) { return send(res, 500, { error: "No se pudo consultar ahora, probá de nuevo." }); }
  }
  // ---- Tienda: validar un cupón de descuento (de WooCommerce) ----
  if (u.pathname === "/api/tienda/cupon") {
    const code = (u.searchParams.get("code") || "").trim();
    const subtotal = Number(u.searchParams.get("subtotal")) || 0;
    if (!code) return send(res, 400, { error: "Falta el código" });
    try {
      const c = await getCupon(code);
      if (!c) return send(res, 200, { ok: false, error: "El cupón no existe o no es válido." });
      if (c.fecha_expiracion && new Date(c.fecha_expiracion) < new Date()) return send(res, 200, { ok: false, error: "El cupón está vencido." });
      if (c.uso_limite > 0 && c.usos >= c.uso_limite) return send(res, 200, { ok: false, error: "El cupón ya alcanzó su límite de usos." });
      if (c.min_monto > 0 && subtotal < Number(c.min_monto)) return send(res, 200, { ok: false, error: `Requiere una compra mínima de $${Math.round(Number(c.min_monto)).toLocaleString("es-AR")}.` });
      const amount = Number(c.valor) || 0;
      let descuento = c.tipo_descuento === "percent" ? Math.round(subtotal * amount / 100) : Math.round(amount);
      if (descuento > subtotal) descuento = subtotal;
      return send(res, 200, { ok: true, code: c.codigo, tipo: c.tipo_descuento, monto: amount, descuento });
    } catch (e) { return send(res, 502, { error: "No se pudo validar el cupón." }); }
  }
  if (u.pathname === "/api/tienda/checkout" && req.method === "POST") {
    const body = await readBody(req);
    const items = Array.isArray(body.items) ? body.items : [];
    if (!items.length) return send(res, 400, { error: "El carrito está vacío." });
    const cli = body.cliente || {}, env = body.envio || {};
    const sesEmail = AUTH.leerSesion(req.headers.cookie);
    const email = (sesEmail || cli.email || "").toLowerCase().trim();
    if (!email || !email.includes("@")) return send(res, 400, { error: "Necesitamos un email válido para el pedido." });
    const nombre = (cli.nombre || "").trim();

    // Validar stock contra la DB
    const cat = await getCatalogo();
    const byId = new Map((cat.productos || []).map((p) => [p.id, p]));
    const combosCO = await readJson(COMBOS_PATH, {});
    const tieneStockP = (p) => p && ((p.stock_status === "instock" && p.stock !== 0) || ((p.tipo === "variable" || (p.variaciones || []).length) && (p.variaciones || []).some((v) => v.stock_status === "instock" && v.stock !== 0)));
    for (const it of items) {
      const p = byId.get(Number(it.id)); if (!p) continue;
      const combo = combosCO[String(p.id)];
      if (combo) {
        for (const c of (combo.componentes || [])) {
          const cp = byId.get(c.productId);
          const ok = c.variationId ? (() => { const v = cp && (cp.variaciones || []).find((x) => x.id === c.variationId); return !!(v && v.stock_status === "instock" && v.stock !== 0); })() : tieneStockP(cp);
          if (!ok) return send(res, 400, { error: `"${p.nombre}" no está disponible ahora (un componente del combo se quedó sin stock).` });
        }
        continue;
      }
      if (it.variationId && Array.isArray(p.variaciones)) {
        const v = p.variaciones.find((x) => x.id === Number(it.variationId));
        if (v && (v.stock_status !== "instock" || v.stock === 0)) return send(res, 400, { error: `"${p.nombre}" (esa medida) se quedó sin stock. Elegí otra o quitalo del carrito.` });
      } else if (p.stock_status !== "instock" || p.stock === 0) return send(res, 400, { error: `"${p.nombre}" se quedó sin stock. Quitalo del carrito para continuar.` });
    }

    await AUTH.asegurarCliente(email, nombre);
    const partes = nombre.split(/\s+/);
    const billing = {
      first_name: partes[0] || "", last_name: partes.slice(1).join(" ") || "", email,
      phone: cli.telefono || "", address_1: env.calle || "", city: env.ciudad || "",
      state: env.provincia || "", postcode: env.cp || "", country: "AR",
    };
    const retiro = env.metodo === "retiro";
    const local = env.metodo === "local";
    const shipping = retiro ? {} : {
      first_name: partes[0] || "", last_name: partes.slice(1).join(" ") || "",
      address_1: env.calle || "", city: env.ciudad || "", state: local ? "Tucumán" : (env.provincia || ""), postcode: env.cp || "", country: "AR",
    };

    // Calcular envío en el server (anti-manipulación)
    const aj = await readJson(AJUSTES_PATH, AJUSTES_DEFAULT);
    let shippingTotal = 0, shippingTitle = "Retiro en el local", shippingMethod = "local_pickup";
    if (local) {
      if (!env.calle) return send(res, 400, { error: "Falta la dirección para el envío con cadete." });
      const t = tarifaTucuman(subtotalItems(items, cat.productos), aj);
      shippingTotal = t.price; shippingTitle = t.name; shippingMethod = "tuc_cadete";
    } else if (!retiro) {
      if (!env.cp || !env.provincia) return send(res, 400, { error: "Falta la dirección de envío." });
      if ((env.provincia || "").toUpperCase() === "T") {
        const t = tarifaTucuman(subtotalItems(items, cat.productos), aj);
        shippingTotal = t.price; shippingTitle = t.name; shippingMethod = t.method_id;
      } else {
        shippingTotal = Number(aj.envio_nacional_fijo) || 0;
        shippingTitle = "Envío a domicilio"; shippingMethod = "flat_rate";
      }
    }

    const metodoPago = ["mp", "nave", "transferencia", "efectivo"].includes(body.metodo_pago) ? body.metodo_pago : "mp";
    const online = metodoPago === "mp" || metodoPago === "nave";
    const recargoPct = Number(aj.recargo_otros) || 0;
    const subtotal = subtotalItems(items, cat.productos);

    // Aplicar cupón
    let descuentoTotal = 0, cuponCode = null;
    if (body.cupon) {
      try {
        const c = await getCupon(String(body.cupon).trim());
        if (c && c.activo && (!c.fecha_expiracion || new Date(c.fecha_expiracion) >= new Date()) && (c.uso_limite <= 0 || c.usos < c.uso_limite)) {
          const amt = Number(c.valor) || 0;
          descuentoTotal = c.tipo_descuento === "percent" ? Math.round(subtotal * amt / 100) : Math.round(amt);
          if (descuentoTotal > subtotal) descuentoTotal = subtotal;
          cuponCode = c.codigo;
        }
      } catch { /* continua sin cupón */ }
    }

    const recargo = online ? Math.round((subtotal - descuentoTotal) * recargoPct / 100) : 0;
    const total = subtotal - descuentoTotal + shippingTotal + recargo;
    const naveSecret = metodoPago === "nave" ? randomBytes(32).toString("hex") : "";

    // Construir line_items con precios reales
    const lineItems = items.map((it) => {
      const p = byId.get(Number(it.id)); if (!p) return null;
      let precio = Number(p.precio) || 0, varId = null, varLabel = "";
      if (it.variationId && Array.isArray(p.variaciones)) {
        const v = p.variaciones.find((x) => x.id === Number(it.variationId));
        if (v) { precio = Number(v.precio) || 0; varId = v.id; varLabel = v.label || ""; }
      }
      const qty = Math.max(1, Number(it.qty) || 1);
      return { product_id: p.id, variation_id: varId, nombre: p.nombre + (varLabel ? " - " + varLabel : ""), sku: p.sku || "", cantidad: qty, precio, subtotal: precio * qty, total: precio * qty };
    }).filter(Boolean);

    try {
      const o = await crearPedido({
        status: online ? "pending" : "on-hold",
        total, subtotal, shipping_total: shippingTotal, descuento_total: descuentoTotal,
        metodo_pago: metodoPago,
        metodo_pago_titulo: metodoPago === "transferencia" ? "Transferencia bancaria" : metodoPago === "efectivo" ? "Efectivo (retiro)" : metodoPago === "nave" ? "Nave (Naranja X)" : "Mercado Pago",
        cliente_email: email,
        billing, shipping,
        shipping_lines: [{ method_id: shippingMethod, method_title: shippingTitle, total: shippingTotal.toFixed(2) }],
        fee_lines: recargo > 0 ? [{ name: `Recargo ${metodoPago === "nave" ? "Nave" : "Mercado Pago"} (${recargoPct}%)`, total: String(recargo) }] : [],
        coupon_lines: cuponCode ? [{ code: cuponCode }] : [],
        notas: (env.notas || "") + (env.dni ? ` · DNI: ${String(env.dni).replace(/\D/g, "")}` : ""),
        meta: { ...(env.dni ? { billing_dni: String(env.dni).replace(/\D/g, "") } : {}), ...(naveSecret ? { _nave_secret: naveSecret } : {}) },
        items: lineItems,
      });

      if (cuponCode) await incrementarUsoCupon(cuponCode).catch(() => {});

      const origin = "https://" + req.headers.host;
      if (metodoPago === "mp") {
        if (!MP.configurado()) return send(res, 400, { error: "Mercado Pago no está configurado." });
        const mpItems = cuponCode
          ? [{ title: `Pedido #${o.id} · El Pasaje Dental`, quantity: 1, unit_price: Math.round(total) }]
          : [...lineItems.map((li) => ({ title: li.nombre, quantity: li.cantidad, unit_price: li.precio })),
             ...(shippingTotal > 0 ? [{ title: "Envío - " + shippingTitle, quantity: 1, unit_price: shippingTotal }] : []),
             ...(recargo > 0 ? [{ title: `Recargo (${recargoPct}%)`, quantity: 1, unit_price: recargo }] : [])];
        const pref = await MP.crearPreferencia({
          items: mpItems, externalRef: o.id, payer: { email, name: nombre },
          urls: { success: `${origin}/pago/exito?order=${o.id}`, failure: `${origin}/pago/error?order=${o.id}`, pending: `${origin}/pago/pendiente?order=${o.id}`, webhook: `${origin}/api/mp/webhook` },
        });
        if (pref.error) { console.log("[checkout/mp]", pref.error); return send(res, 502, { error: "No se pudo iniciar el pago en Mercado Pago." }); }
        return send(res, 200, { ok: true, order_id: o.id, pay_url: pref.init_point });
      }

      if (metodoPago === "nave") {
        if (!NAVE.configurado()) return send(res, 400, { error: "Nave no está configurado." });
        const naveItems = cuponCode
          ? [{ title: `Pedido #${o.id} · El Pasaje Dental`, quantity: 1, unit_price: Math.round(total) }]
          : [...lineItems.map((li) => ({ title: li.nombre, description: li.nombre, quantity: li.cantidad, unit_price: li.precio })),
             ...(shippingTotal > 0 ? [{ title: "Envío - " + shippingTitle, quantity: 1, unit_price: shippingTotal }] : []),
             ...(recargo > 0 ? [{ title: `Recargo (${recargoPct}%)`, quantity: 1, unit_price: recargo }] : [])];
        const pago = await NAVE.crearPago({
          items: naveItems, total, externalRef: o.id,
          buyer: { userId: email, name: nombre, email, phone: billing.phone || "", dni: (env.dni || "").replace(/\D/g, ""), calle: env.calle || "", ciudad: env.ciudad || "", region: env.provincia || "", cp: env.cp || "" },
          urls: { callback: `${origin}/pago/exito?order=${o.id}`, webhook: `${origin}/api/nave/webhook?order_id=${o.id}&secret=${naveSecret}` },
        });
        if (pago.error) { console.log("[checkout/nave]", pago.error); return send(res, 502, { error: "No se pudo iniciar el pago en Nave." }); }
        return send(res, 200, { ok: true, order_id: o.id, pay_url: pago.checkout_url });
      }

      notificarPedido(o, { metodoPago });
      return send(res, 200, { ok: true, order_id: o.id, total, pay_url: `${origin}/pago/recibido?order=${o.id}&m=${metodoPago}` });
    } catch (e) { console.log("[checkout] excepción", e.message); return send(res, 502, { error: "Error al crear el pedido. Intentá de nuevo." }); }
  }

  // ---- Webhook de Mercado Pago ----
  if (u.pathname === "/api/mp/webhook") {
    res.writeHead(200); res.end("ok");
    try {
      const tipo = u.searchParams.get("type") || u.searchParams.get("topic");
      const pid = u.searchParams.get("data.id") || u.searchParams.get("id");
      if (tipo !== "payment" || !pid) return;
      const pago = await MP.obtenerPago(pid);
      if (!pago || !pago.external_reference) return;
      if (pago.status === "approved") {
        const o = await updatePedidoStatus(Number(pago.external_reference), "processing", { transaction_id: String(pago.id) });
        if (o) { notificarPedido(o, { metodoPago: "mp", pagado: true }); await ingresoVentaCaja(o, "mp"); }
        console.log(`[mp/webhook] pedido ${pago.external_reference} PAGADO (payment ${pago.id})`);
      } else console.log(`[mp/webhook] pago ${pago.id} ${pago.status} para pedido ${pago.external_reference}`);
    } catch (e) { console.log("[mp/webhook] error", e.message); }
    return;
  }

  // ---- Webhook de Nave ----
  if (u.pathname === "/api/nave/webhook" && req.method === "POST") {
    const body = await readBody(req).catch(() => ({}));
    const order_id = u.searchParams.get("order_id") || body.external_payment_id || "";
    const secret = u.searchParams.get("secret") || "";
    res.writeHead(200); res.end("ok");
    try {
      if (!order_id) return;
      const ord = await getPedido(Number(order_id));
      if (!ord) { console.log(`[nave/webhook] pedido ${order_id} no encontrado`); return; }
      const storedSecret = (ord.meta && ord.meta._nave_secret) || "";
      if (secret && storedSecret && storedSecret !== secret) { console.log(`[nave/webhook] secret inválido pedido ${order_id}`); return; }
      if (["processing", "completed"].includes(ord.status)) return; // idempotente
      const pago = body.payment_check_url ? await NAVE.estadoPorUrl(body.payment_check_url) : (body.payment_id ? await NAVE.estadoPago(body.payment_id) : null);
      const st = String((pago && pago.status && (pago.status.name || pago.status)) || "").toUpperCase();
      if (st === "APPROVED") {
        const montoPago = Number((pago.amount && (pago.amount.value || pago.amount)) || pago.total || 0) || 0;
        if (montoPago && Math.abs(Math.round(montoPago) - Math.round(Number(ord.total) || 0)) > 1) { console.log(`[nave/webhook] monto no coincide pedido ${order_id}: ${montoPago} vs ${ord.total}`); return; }
        const o2 = await updatePedidoStatus(Number(order_id), "processing", { transaction_id: String((pago && pago.payment_code) || body.payment_id || "") });
        if (o2) { notificarPedido(o2, { metodoPago: "nave", pagado: true }); await ingresoVentaCaja(o2, "nave"); }
        console.log(`[nave/webhook] pedido ${order_id} PAGADO`);
      } else console.log(`[nave/webhook] pedido ${order_id} estado ${st || "?"}`);
    } catch (e) { console.log("[nave/webhook] error", e.message); }
    return;
  }

  // ---- Autenticacion por codigo al email (publico) ----
  if (u.pathname === "/api/auth/solicitar" && req.method === "POST") {
    const { email } = await readBody(req);
    return send(res, 200, await AUTH.solicitarCodigo(email));
  }
  if (u.pathname === "/api/auth/verificar" && req.method === "POST") {
    const { email, codigo } = await readBody(req);
    const r = await AUTH.verificarCodigo(email, codigo);
    if (r.ok) { res.writeHead(200, { "Content-Type": "application/json", "Set-Cookie": r.cookie }); return res.end(JSON.stringify({ ok: true, email: r.email, rol: r.rol, nombre: r.nombre, tiene_clave: r.tiene_clave })); }
    return send(res, 400, r);
  }
  if (u.pathname === "/api/auth/yo") {
    const email = AUTH.leerSesion(req.headers.cookie);
    if (!email) return send(res, 200, { autenticado: false });
    const uu = await AUTH.usuarioDe(email);
    return send(res, 200, { autenticado: true, email, rol: await AUTH.rolDe(email), nombre: (uu && uu.nombre) || "" });
  }
  if (u.pathname === "/api/auth/salir" && req.method === "POST") {
    res.writeHead(200, { "Content-Type": "application/json", "Set-Cookie": [AUTH.cookieClear(), "sesion=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax"] });
    return res.end(JSON.stringify({ ok: true }));
  }
  if (u.pathname === "/api/auth/login-clave" && req.method === "POST") {
    const { email, password } = await readBody(req);
    const r = await AUTH.loginClave(email, password);
    if (r.ok) { res.writeHead(200, { "Content-Type": "application/json", "Set-Cookie": r.cookie }); return res.end(JSON.stringify({ ok: true, email: r.email, rol: r.rol, nombre: r.nombre })); }
    return send(res, 400, r);
  }
  if (u.pathname === "/api/auth/set-clave" && req.method === "POST") {
    const email = AUTH.leerSesion(req.headers.cookie);
    if (!email) return send(res, 401, { error: "Tenés que iniciar sesión primero" });
    const { password } = await readBody(req);
    return send(res, 200, await AUTH.setClave(email, password));
  }

  // ---- Muro: panel interno (dueño/empleado) ----
  const esInterno = u.pathname.startsWith("/admin") || (u.pathname.startsWith("/api/") && !/^\/api\/(tienda|auth|cuenta|recibir)\//.test(u.pathname));
  if (esInterno && !(await esStaff(req))) {
    if (u.pathname.startsWith("/api/")) return send(res, 401, { error: "No autorizado" });
    res.writeHead(302, { Location: "/login" }); return res.end();
  }
  // ---- Muro: cuenta del cliente (logueado) ----
  if ((u.pathname === "/mi-cuenta" || u.pathname === "/mi-cuenta/" || u.pathname.startsWith("/api/cuenta/")) && !AUTH.leerSesion(req.headers.cookie)) {
    if (u.pathname.startsWith("/api/")) return send(res, 401, { error: "No autorizado" });
    res.writeHead(302, { Location: "/ingresar" }); return res.end();
  }

  // ---- Importar clientes de WooCommerce (staff) ----
  if (u.pathname === "/api/admin/importar-clientes" && req.method === "POST") {
    return send(res, 200, await AUTH.importarClientes());
  }
  // ---- Importar usuarios + claves de WordPress (staff) ----
  if (u.pathname === "/api/admin/importar-wp" && req.method === "POST") {
    return send(res, 200, await AUTH.importarSeedWP());
  }
  // ---- Purgar cuentas bot/spam (staff) ----
  if (u.pathname === "/api/admin/purgar-spam" && req.method === "POST") {
    return send(res, 200, await AUTH.purgarSpam());
  }
  // ---- Normalizar teléfonos de clientes a +549<área><número> (solo dueño). GET=preview, POST=aplica ----
  if (u.pathname === "/api/admin/clientes/normalizar-tel") {
    if (!(await esDueno(req))) return send(res, 403, { error: "Solo el dueño" });
    return send(res, 200, await AUTH.normalizarTelefonos({ apply: req.method === "POST" }));
  }
  // ---- (push-tel-wc ya no aplica: sin WooCommerce) ----
  if (u.pathname === "/api/admin/clientes/push-tel-wc") {
    return send(res, 200, { ok: true, mensaje: "WooCommerce eliminado. Los teléfonos se guardan en la base de datos propia." });
  }
  // ---- Actualizar precio de un producto/variación en la DB ----
  if (u.pathname === "/api/admin/precio" && req.method === "POST") {
    if (!(await esDueno(req))) return send(res, 403, { error: "Solo el dueño" });
    const { productId, variationId, precio } = await readBody(req);
    if (!productId || precio == null || precio === "") return send(res, 400, { error: "Faltan datos" });
    const p = Math.max(0, Math.round(Number(precio)) || 0);
    try {
      await setPrecio(Number(productId), variationId ? Number(variationId) : null, p);
      await buildCatCache();
      return send(res, 200, { ok: true, precio: p });
    } catch (e) { return send(res, 500, { error: e.message }); }
  }
  // ---- Actualizar stock de un producto/variación en la DB ----
  if (u.pathname === "/api/admin/stock" && req.method === "POST") {
    if (!(await esStaff(req))) return send(res, 401, { error: "No autorizado" });
    const { productId, variationId, stock, sumar } = await readBody(req);
    if (!productId || stock == null || stock === "") return send(res, 400, { error: "Faltan datos" });
    try {
      const delta = sumar ? Math.round(Number(stock) || 0) : null;
      if (delta !== null) {
        await adjustStock(Number(productId), variationId ? Number(variationId) : null, delta);
      } else {
        await setStock(Number(productId), variationId ? Number(variationId) : null, Math.max(0, Math.round(Number(stock)) || 0));
      }
      const prod = await getProducto(Number(productId));
      let nuevo = 0, estado = "outofstock";
      if (prod) {
        if (variationId) { const v = (prod.variaciones || []).find((x) => x.id === Number(variationId)); nuevo = v ? Number(v.stock) : 0; estado = v ? v.stock_status : "outofstock"; }
        else { nuevo = Number(prod.stock) || 0; estado = prod.stock_status || "outofstock"; }
      }
      await buildCatCache();
      return send(res, 200, { ok: true, stock: nuevo, stock_status: estado });
    } catch (e) { return send(res, 500, { error: e.message }); }
  }
  // ---- Modo Inventario: reconciliación de lo CONTADO (ubicaciones) vs el stock en la DB ----
  if (u.pathname === "/api/admin/inventario") {
    if (!(await esStaff(req))) return send(res, 401, { error: "No autorizado" });
    const cat = await getCatalogo();
    const ubic = await readJson(UBIC_PATH, { asignaciones: [] });
    // suma de lo contado por producto+variación (solo asignaciones con cantidad cargada)
    const contado = new Map(); // key `${productId}:${variationId||""}` -> { cant, slots }
    for (const a of ubic.asignaciones || []) {
      if (a.cantidad == null) continue;
      const key = `${a.productId}:${a.variationId || ""}`;
      const e = contado.get(key) || { cant: 0, slots: 0 };
      e.cant += Number(a.cantidad) || 0; e.slots += 1;
      contado.set(key, e);
    }
    const items = [];
    for (const p of cat.productos || []) {
      if (p.tipo === "variable" && (p.variaciones || []).length) {
        for (const v of p.variaciones) {
          const c = contado.get(`${p.id}:${v.id}`); if (!c) continue;
          items.push({ productId: p.id, variationId: v.id, nombre: p.nombre, sku: v.sku || p.sku || "", label: v.label || "", contado: c.cant, wc: Number(v.stock) || 0, slots: c.slots });
        }
      } else {
        const c = contado.get(`${p.id}:`); if (!c) continue;
        items.push({ productId: p.id, variationId: null, nombre: p.nombre, sku: p.sku || "", label: "", contado: c.cant, wc: Number(p.stock) || 0, slots: c.slots });
      }
    }
    items.sort((a, b) => Math.abs(b.contado - b.wc) - Math.abs(a.contado - a.wc));
    const totalSku = (cat.productos || []).reduce((n, p) => n + (p.tipo === "variable" && (p.variaciones || []).length ? p.variaciones.length : 1), 0);
    const conDif = items.filter((i) => i.contado !== i.wc).length;
    return send(res, 200, { items, contados: items.length, conDif, totalSku });
  }
  // ---- Inventario: reiniciar conteo (pone en blanco las cantidades por ubicación; NO toca el stock de WooCommerce) ----
  // Antes de limpiar, GUARDA un backup de las ubicaciones tal cual están (para poder restaurar si algo falla).
  if (u.pathname === "/api/admin/inventario/reset" && req.method === "POST") {
    if (!(await esStaff(req))) return send(res, 401, { error: "No autorizado" });
    const ubic = await readJson(UBIC_PATH, { asignaciones: [] });
    const backup = { fecha: new Date().toISOString(), asignaciones: JSON.parse(JSON.stringify(ubic.asignaciones || [])) };
    await writeFile(INV_BACKUP_PATH, JSON.stringify(backup, null, 2)); // respaldo ANTES de borrar
    let n = 0;
    for (const a of ubic.asignaciones || []) if (a.cantidad != null) { a.cantidad = null; n++; }
    await writeFile(UBIC_PATH, JSON.stringify(ubic, null, 2));
    return send(res, 200, { ok: true, limpiados: n, backup_fecha: backup.fecha });
  }
  // ---- Inventario: restaurar el conteo desde el último backup (deshacer el reset) ----
  if (u.pathname === "/api/admin/inventario/restaurar" && req.method === "POST") {
    if (!(await esStaff(req))) return send(res, 401, { error: "No autorizado" });
    const backup = await readJson(INV_BACKUP_PATH, null);
    if (!backup || !Array.isArray(backup.asignaciones)) return send(res, 400, { error: "No hay backup para restaurar" });
    await writeFile(UBIC_PATH, JSON.stringify({ asignaciones: backup.asignaciones }, null, 2));
    return send(res, 200, { ok: true, restauradas: backup.asignaciones.length, backup_fecha: backup.fecha || "" });
  }
  // ---- Inventario: descargar/ver el backup actual ----
  if (u.pathname === "/api/admin/inventario/backup") {
    if (!(await esStaff(req))) return send(res, 401, { error: "No autorizado" });
    const backup = await readJson(INV_BACKUP_PATH, null);
    return send(res, 200, backup || { existe: false });
  }
  // ---- Snapshot manual (ubicaciones + vencimientos) para hacer pruebas y poder restaurar (solo dueño) ----
  if (u.pathname === "/api/admin/snapshot" && req.method === "POST") {
    if (!(await esDueno(req))) return send(res, 403, { error: "Solo el dueño" });
    const ubic = await readJson(UBIC_PATH, { asignaciones: [] });
    const venc = await readJson(VENC_PATH, { items: [], dias_aviso: 60 });
    const snap = { fecha: new Date().toISOString(), ubicaciones: ubic, vencimientos: venc };
    await writeFile(SNAP_PATH, JSON.stringify(snap, null, 2));
    return send(res, 200, { ok: true, fecha: snap.fecha, asignaciones: (ubic.asignaciones || []).length, vencimientos: (venc.items || []).length });
  }
  if (u.pathname === "/api/admin/snapshot/restaurar" && req.method === "POST") {
    if (!(await esDueno(req))) return send(res, 403, { error: "Solo el dueño" });
    const snap = await readJson(SNAP_PATH, null);
    if (!snap || !snap.ubicaciones || !snap.vencimientos) return send(res, 400, { error: "No hay snapshot para restaurar" });
    await writeFile(UBIC_PATH, JSON.stringify(snap.ubicaciones, null, 2));
    await writeFile(VENC_PATH, JSON.stringify(snap.vencimientos, null, 2));
    return send(res, 200, { ok: true, fecha: snap.fecha, asignaciones: (snap.ubicaciones.asignaciones || []).length, vencimientos: (snap.vencimientos.items || []).length });
  }
  if (u.pathname === "/api/admin/snapshot" && req.method === "GET") {
    if (!(await esDueno(req))) return send(res, 403, { error: "Solo el dueño" });
    const snap = await readJson(SNAP_PATH, null);
    return send(res, 200, snap ? { existe: true, fecha: snap.fecha, asignaciones: (snap.ubicaciones.asignaciones || []).length, vencimientos: (snap.vencimientos.items || []).length } : { existe: false });
  }
  // ---- POS: buscar cliente por teléfono / email / nombre (staff) ----
  if (u.pathname === "/api/admin/clientes/buscar") {
    if (!(await esStaff(req))) return send(res, 401, { error: "No autorizado" });
    const q = (u.searchParams.get("q") || "").toLowerCase().trim();
    if (q.length < 3) return send(res, 200, { clientes: [] });
    const qd = q.replace(/\D/g, "");
    const us = (await AUTH.leerUsuarios()).usuarios || [];
    const match = us.filter((x) => {
      if (x.spam) return false;
      const em = (x.email || "").toLowerCase(), nom = (x.nombre || "").toLowerCase(), tel = (x.telefono || "").replace(/\D/g, "");
      return em.includes(q) || nom.includes(q) || (qd.length >= 4 && tel.includes(qd));
    }).slice(0, 8).map((x) => ({ email: x.email, nombre: x.nombre || "", telefono: x.telefono || "", doc: x.doc || "", entrega: x.entrega || null }));
    return send(res, 200, { clientes: match });
  }
  // ---- POS: registrar una venta a nombre de un cliente (staff) ----
  if (u.pathname === "/api/admin/venta" && req.method === "POST") {
    if (!(await esStaff(req))) return send(res, 401, { error: "No autorizado" });
    const b = await readBody(req);
    if (!b.items || !b.items.length) return send(res, 400, { error: "Agregá al menos un producto" });
    const pagoTitle = { efectivo: "Efectivo", transferencia: "Transferencia", mp: "Mercado Pago", ctacte: "Cuenta corriente" }[b.pago] || "Efectivo";
    const nombre = (b.cliente?.nombre || "").trim() || "Consumidor final";
    const partes = nombre.split(/\s+/); const fn = partes[0] || nombre; const ln = partes.slice(1).join(" ");
    const email = (b.cliente?.email || "").trim().toLowerCase();
    const docCli = String(b.cliente?.doc || "").replace(/\D/g, "");
    const billing = { first_name: fn, last_name: ln, email, phone: b.cliente?.telefono || "" };
    const e = b.cliente?.entrega || {};
    const reparto = !!b.reparto;
    const conEnvio = (b.envio && b.envio.tipo && b.envio.tipo !== "retiro") || reparto;
    const ctacte = b.pago === "ctacte";
    if (email && email.includes("@")) {
      try { await AUTH.asegurarCliente(email, nombre); } catch {}
      try {
        const campos = {};
        if (nombre) campos.nombre = nombre;
        if (b.cliente?.telefono) campos.telefono = b.cliente.telefono;
        if (e && (e.calle || e.ciudad)) campos.entrega = { calle: e.calle || "", ciudad: e.ciudad || "", provincia: e.provincia || "", cp: e.cp || "" };
        if (docCli) campos.doc = docCli;
        if (Object.keys(campos).length) await AUTH.actualizarCliente(email, campos);
      } catch {}
    }
    const shippingCosto = conEnvio ? Math.round(Number(b.envio?.costo) || 0) : 0;
    const lineItems = b.items.map((it) => {
      const qty = Math.max(1, Number(it.qty) || 1);
      const precio = it.precio != null && it.precio !== "" ? Math.round(Number(it.precio)) : 0;
      return { product_id: Number(it.id), variation_id: it.variationId ? Number(it.variationId) : null, nombre: it.nombre || "", sku: it.sku || "", cantidad: qty, precio, subtotal: precio * qty, total: precio * qty };
    });
    const subtotalVenta = lineItems.reduce((s, li) => s + li.total, 0);
    try {
      const o = await crearPedido({
        status: ctacte ? "on-hold" : (reparto ? "processing" : "completed"),
        total: subtotalVenta + shippingCosto, subtotal: subtotalVenta, shipping_total: shippingCosto, descuento_total: 0,
        metodo_pago: b.pago || "pos", metodo_pago_titulo: pagoTitle, cliente_email: email,
        billing, shipping: conEnvio ? { first_name: fn, last_name: ln, address_1: e.calle || "", city: e.ciudad || "", state: e.provincia || "", postcode: e.cp || "" } : {},
        shipping_lines: conEnvio ? [{ method_id: "flat_rate", method_title: b.envio?.metodo_title || "Envío", total: String(shippingCosto) }] : [],
        fee_lines: [], coupon_lines: [],
        notas: (b.nota || "") + (reparto ? " · PARA REPARTO" : "") + (docCli ? ` · DNI/CUIT: ${docCli}` : ""),
        meta: docCli ? { billing_dni: docCli } : {},
        items: lineItems,
      });
      if (reparto && o.id) await marcarReparto(o.id, true);
      let descontado = [];
      try {
        const [ubic, muebles] = await Promise.all([readJson(UBIC_PATH, { asignaciones: [] }), readJson(MUEBLES_PATH, { muebles: [] })]);
        const desc = [];
        for (const it of (b.items || [])) {
          const pid = Number(it.id), vid = it.variationId ? Number(it.variationId) : null;
          for (const t of descontarUbic(ubic, muebles, pid, vid, it.qty)) desc.push({ productId: pid, variationId: vid, slotId: t.slotId, cant: t.cant });
        }
        descontado = desc;
        if (desc.length) {
          await writeFile(UBIC_PATH, JSON.stringify(ubic, null, 2));
          const dp = await readJson(PEDIDOS_PATH, { preparados: {} }); if (!dp.ubicDesc) dp.ubicDesc = {}; dp.ubicDesc[String(o.id)] = desc;
          await writeFile(PEDIDOS_PATH, JSON.stringify(dp, null, 2));
        }
      } catch (e) { console.log("[venta ubic]", e.message); }
      if (ctacte) await FIN.agregar("ctacte", { tipo: "deuda", cliente: nombre, email, monto: subtotalVenta + shippingCosto, pedido: o.id, nota: "Venta en cuenta corriente (mostrador)" });
      if (!ctacte) {
        const cuentaMov = b.pago === "efectivo" ? "efectivo" : b.pago === "mp" ? "mp" : "banco";
        try { await FIN.agregar("movimientos", { tipo: "ingreso", cuenta: cuentaMov, monto: subtotalVenta + shippingCosto, categoria: "Ventas", detalle: `Venta #${o.id} · ${nombre}`, fecha: new Date().toISOString().slice(0, 10), ref: "venta:" + o.id }); } catch {}
      }
      notificarPedido(o, { metodoPago: b.pago, pagado: !ctacte });
      return send(res, 200, { ok: true, order_id: o.id, number: o.id, total: subtotalVenta + shippingCosto, estado: o.status, descontado });
    } catch (e2) { return send(res, 500, { error: e2.message }); }
  }
  // ---- Venta: mover un descuento de ubicación a otra (corrección rápida desde la venta) ----
  if (u.pathname === "/api/admin/venta/mover-ubic" && req.method === "POST") {
    if (!(await esStaff(req))) return send(res, 401, { error: "No autorizado" });
    const { order_id, productId, variationId, fromSlot, toSlot, cant } = await readBody(req);
    const pid = Number(productId), vid = variationId ? Number(variationId) : null, c = Math.round(Number(cant) || 0);
    if (!order_id || !pid || !fromSlot || !toSlot || c <= 0 || fromSlot === toSlot) return send(res, 400, { error: "Datos inválidos" });
    const ubic = await readJson(UBIC_PATH, { asignaciones: [] });
    if (!Array.isArray(ubic.asignaciones)) ubic.asignaciones = [];
    const find = (slot) => ubic.asignaciones.find((x) => x.productId === pid && (x.variationId || null) === vid && x.slotId === slot);
    const aFrom = find(fromSlot); if (aFrom) aFrom.cantidad = (Number(aFrom.cantidad) || 0) + c; else ubic.asignaciones.push({ productId: pid, variationId: vid, slotId: fromSlot, nota: "", cantidad: c }); // devuelve a donde había sacado mal
    const aTo = find(toSlot); if (aTo) aTo.cantidad = Math.max(0, (Number(aTo.cantidad) || 0) - c); else ubic.asignaciones.push({ productId: pid, variationId: vid, slotId: toSlot, nota: "", cantidad: 0 }); // saca del lugar correcto
    await writeFile(UBIC_PATH, JSON.stringify(ubic, null, 2));
    // mover también en el registro del pedido (para que cancelar reponga al lugar correcto)
    try {
      const dp = await readJson(PEDIDOS_PATH, { preparados: {} });
      const desc = (dp.ubicDesc || {})[String(order_id)];
      if (desc) {
        let resto = c;
        for (const d of desc) { if (resto <= 0) break; if (d.productId === pid && (d.variationId || null) === vid && d.slotId === fromSlot) { const mv = Math.min(Number(d.cant) || 0, resto); d.cant = (Number(d.cant) || 0) - mv; resto -= mv; } }
        const movido = c - resto;
        const exTo = desc.find((d) => d.productId === pid && (d.variationId || null) === vid && d.slotId === toSlot);
        if (exTo) exTo.cant = (Number(exTo.cant) || 0) + movido; else desc.push({ productId: pid, variationId: vid, slotId: toSlot, cant: movido });
        dp.ubicDesc[String(order_id)] = desc.filter((d) => (Number(d.cant) || 0) > 0);
        await writeFile(PEDIDOS_PATH, JSON.stringify(dp, null, 2));
      }
    } catch (e) { console.log("[mover-ubic]", e.message); }
    return send(res, 200, { ok: true, asignaciones: ubic.asignaciones });
  }
  // ---- Pedido: elegir/cambiar de qué ubicación se saca un producto ----
  // Si el ítem AÚN no se descontó (pedido no completado) → guarda el "plan" (de dónde sacar al completar), sin tocar stock.
  // Si YA se descontó (pedido completado) → mueve el descuento al slot elegido (restaura el viejo, descuenta el nuevo).
  if (u.pathname === "/api/admin/pedido/sacar-de" && req.method === "POST") {
    if (!(await esStaff(req))) return send(res, 401, { error: "No autorizado" });
    const { order_id, productId, variationId, cant, toSlot } = await readBody(req);
    const pid = Number(productId), vid = variationId ? Number(variationId) : null, c = Math.round(Number(cant) || 0);
    if (!order_id || !pid || !toSlot || c <= 0) return send(res, 400, { error: "Datos inválidos" });
    const key = String(order_id), ikey = pid + ":" + (vid || "");
    const dp = await readJson(PEDIDOS_PATH, { preparados: {} });
    if (!dp.ubicDesc) dp.ubicDesc = {};
    const desc = dp.ubicDesc[key] || [];
    const yaDesc = desc.some((d) => d.productId === pid && (d.variationId || null) === vid);
    if (!yaDesc) { // todavía no se completó → solo anoto el plan (se descuenta al completar)
      if (!dp.ubicPlan) dp.ubicPlan = {};
      if (!dp.ubicPlan[key]) dp.ubicPlan[key] = {};
      dp.ubicPlan[key][ikey] = toSlot;
      await writeFile(PEDIDOS_PATH, JSON.stringify(dp, null, 2));
      return send(res, 200, { ok: true, plan: true });
    }
    // ya descontado → mover
    const ubic = await readJson(UBIC_PATH, { asignaciones: [] });
    if (!Array.isArray(ubic.asignaciones)) ubic.asignaciones = [];
    const find = (slot) => ubic.asignaciones.find((x) => x.productId === pid && (x.variationId || null) === vid && x.slotId === slot);
    for (const d of desc) if (d.productId === pid && (d.variationId || null) === vid) { const a = find(d.slotId); if (a) a.cantidad = (Number(a.cantidad) || 0) + (Number(d.cant) || 0); else ubic.asignaciones.push({ productId: pid, variationId: vid, slotId: d.slotId, nota: "", cantidad: Number(d.cant) || 0 }); }
    dp.ubicDesc[key] = desc.filter((d) => !(d.productId === pid && (d.variationId || null) === vid));
    const aTo = find(toSlot); if (aTo) aTo.cantidad = Math.max(0, (Number(aTo.cantidad) || 0) - c); else ubic.asignaciones.push({ productId: pid, variationId: vid, slotId: toSlot, nota: "", cantidad: 0 });
    dp.ubicDesc[key].push({ productId: pid, variationId: vid, slotId: toSlot, cant: c });
    await writeFile(UBIC_PATH, JSON.stringify(ubic, null, 2));
    await writeFile(PEDIDOS_PATH, JSON.stringify(dp, null, 2));
    return send(res, 200, { ok: true, movido: true, asignaciones: ubic.asignaciones });
  }
  // ---- Combo: guardar de qué medida/ubicación se saca cada componente de un combo del pedido ----
  if (u.pathname === "/api/admin/pedido/combo-pick" && req.method === "POST") {
    if (!(await esStaff(req))) return send(res, 401, { error: "No autorizado" });
    const { order_id, comboProductId, componentes } = await readBody(req);
    if (!order_id || !comboProductId) return send(res, 400, { error: "Faltan datos" });
    const dp = await readJson(PEDIDOS_PATH, { preparados: {} });
    if (!dp.comboPick) dp.comboPick = {};
    const key = String(order_id);
    if (!dp.comboPick[key]) dp.comboPick[key] = {};
    dp.comboPick[key][String(comboProductId)] = (Array.isArray(componentes) ? componentes : [])
      .map((c) => ({ productId: Number(c.productId), variationId: c.variationId ? Number(c.variationId) : null, slotId: c.slotId || "", cant: Math.max(0, Math.round(Number(c.cant) || 0)) }))
      .filter((c) => c.productId && c.cant > 0);
    await writeFile(PEDIDOS_PATH, JSON.stringify(dp, null, 2));
    return send(res, 200, { ok: true });
  }
  // ---- Presupuestos / cotizaciones (guardar venta para confirmar después) ----
  if (u.pathname === "/api/admin/presupuestos" && req.method === "GET") {
    if (!(await esStaff(req))) return send(res, 401, { error: "No autorizado" });
    const d = await readJson(PRESUP_PATH, { presupuestos: [] });
    return send(res, 200, { presupuestos: d.presupuestos || [] });
  }
  if (u.pathname === "/api/admin/presupuesto" && req.method === "POST") {
    if (!(await esStaff(req))) return send(res, 401, { error: "No autorizado" });
    const b = await readBody(req);
    if (!b.items || !b.items.length) return send(res, 400, { error: "Agregá productos al presupuesto" });
    const d = await readJson(PRESUP_PATH, { presupuestos: [] });
    if (!d.presupuestos) d.presupuestos = [];
    const reg = { id: Math.random().toString(36).slice(2, 9), fecha: new Date().toISOString(), items: b.items, cliente: b.cliente || null, envio: b.envio || null, pago: b.pago || "transferencia", total: Math.round(Number(b.total) || 0), nota: b.nota || "" };
    d.presupuestos.unshift(reg);
    await writeFile(PRESUP_PATH, JSON.stringify(d, null, 2));
    return send(res, 200, { ok: true, id: reg.id });
  }
  if (u.pathname === "/api/admin/presupuesto/borrar" && req.method === "POST") {
    if (!(await esStaff(req))) return send(res, 401, { error: "No autorizado" });
    const { id } = await readBody(req);
    const d = await readJson(PRESUP_PATH, { presupuestos: [] });
    d.presupuestos = (d.presupuestos || []).filter((x) => x.id !== id);
    await writeFile(PRESUP_PATH, JSON.stringify(d, null, 2));
    return send(res, 200, { ok: true });
  }
  // ---- Cambio / Devolución sobre un pedido: net → caja (medio) o ctacte (saldo a favor) ----
  if (u.pathname === "/api/admin/cambio" && req.method === "POST") {
    if (!(await esStaff(req))) return send(res, 401, { error: "No autorizado" });
    const b = await readBody(req);
    const devuelto = Math.max(0, Math.round(Number(b.devuelto) || 0));
    const llevado = Math.max(0, Math.round(Number(b.llevado) || 0));
    const net = llevado - devuelto; // >0 el cliente paga; <0 saldo a favor del cliente
    const medio = b.medio || "efectivo";
    try {
      if (net > 0) {
        if (medio === "efectivo" || medio === "transferencia") {
          const fin = await FIN.todo();
          const campo = medio === "efectivo" ? "saldo_efectivo" : "saldo_banco";
          await FIN.guardarConfig({ [campo]: (Number(fin.config[campo]) || 0) + net });
        } else if (medio === "mp") {
          await FIN.agregar("acreditaciones", { plataforma: "Mercado Pago", bruto: net, cargo_pct: 0, neto: net, estado: "pendiente", nota: `Diferencia de cambio pedido #${b.pedido || ""}` });
        }
      } else if (net < 0) {
        await FIN.agregar("ctacte", { tipo: "cobro", cliente: b.cliente || "", email: b.email || "", monto: -net, nota: `Saldo a favor por cambio pedido #${b.pedido || ""}` });
      }
      await FIN.agregar("movimientos", { tipo: "cambio", pedido: b.pedido || "", cliente: b.cliente || "", devuelto, llevado, net, medio: net > 0 ? medio : "", nota: b.nota || "" });
      return send(res, 200, { ok: true, net });
    } catch (e) { return send(res, 500, { error: e.message }); }
  }
  // ---- Crear/actualizar un empleado con clave (solo dueño) ----
  if (u.pathname === "/api/admin/crear-empleado" && req.method === "POST") {
    if (!(await esDueno(req))) return send(res, 403, { error: "Solo el dueño" });
    const { email, clave, nombre } = await readBody(req);
    if (!email || !clave) return send(res, 400, { error: "Faltan email o clave" });
    const sc = await AUTH.setClave(email, clave);
    if (sc.error) return send(res, 400, sc);
    const rol = (await AUTH.rolDe(email)) === "dueno" ? "dueno" : "empleado";
    await AUTH.actualizarCliente(email, { rol, ...(nombre ? { nombre } : {}) });
    return send(res, 200, { ok: true, rol });
  }
  // ---- Definir rol de un usuario: empleado o cliente (solo dueño) ----
  if (u.pathname === "/api/admin/cliente-rol" && req.method === "POST") {
    if (!(await esDueno(req))) return send(res, 403, { error: "Solo el dueño" });
    const { email, rol } = await readBody(req);
    if (!["empleado", "cliente"].includes(rol)) return send(res, 400, { error: "Rol inválido" });
    return send(res, 200, await AUTH.actualizarCliente(email, { rol }));
  }
  // ---- Subir una imagen (base64) y devolver su URL pública (para fotos de productos) ----
  if (u.pathname === "/api/admin/subir-imagen" && req.method === "POST") {
    if (!(await esStaff(req))) return send(res, 401, { error: "No autorizado" });
    const { data } = await readBody(req);
    if (!data) return send(res, 400, { error: "Falta la imagen" });
    const m = String(data).match(/^data:image\/([\w+]+);base64,(.+)$/);
    const ext = m ? (m[1] === "jpeg" ? "jpg" : m[1].replace("+xml", "")) : "jpg";
    const buf = Buffer.from(m ? m[2] : String(data), "base64");
    if (buf.length > 6 * 1024 * 1024) return send(res, 400, { error: "La imagen es muy grande (máx 6MB)" });
    const name = Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + "." + ext;
    await mkdir(join(DATA, "uploads"), { recursive: true });
    await writeFile(join(DATA, "uploads", name), buf);
    const host = req.headers.host || "elpasajedental.com";
    return send(res, 200, { ok: true, url: `https://${host}/uploads/${name}` });
  }
  // ---- Traer un producto completo (con variaciones e imágenes) para editar ----
  if (u.pathname === "/api/admin/producto-edit") {
    if (!(await esStaff(req))) return send(res, 401, { error: "No autorizado" });
    const id = u.searchParams.get("id");
    if (!id) return send(res, 400, { error: "Faltan datos" });
    try {
      const p = await getProducto(Number(id));
      if (!p) return send(res, 404, { error: "Producto no encontrado" });
      const costo = Number((await FIN.getCostos())[id]) || 0;
      const proveedorId = (await FIN.getProvProd())[id] || "";
      const proveedores = ((await FIN.todo()).proveedores || []).map((pp) => ({ id: pp.id, nombre: pp.nombre }));
      const vd = await readJson(VENC_PATH, { items: [] });
      const vFicha = (vd.items || []).find((x) => x.origen === "ficha" && String(x.productId) === String(id));
      const combo = (await readJson(COMBOS_PATH, {}))[String(id)] || null;
      const imagenes = Array.isArray(p.imagenes) ? p.imagenes : (p.imagen ? [{ src: p.imagen }] : []);
      return send(res, 200, { id: p.id, tipo: p.tipo, nombre: p.nombre, sku: p.sku || "", descripcion: p.descripcion || "", descripcion_corta: p.descripcion_corta || "", images: imagenes, variaciones: (p.variaciones || []).map((v) => ({ id: v.id, label: v.label || "", precio: Number(v.precio) || 0, stock: v.stock, imagen: v.imagen || "" })), precio: Number(p.precio) || 0, stock: p.stock, peso: p.peso || "", slug: p.slug || "", categorias: (p.categorias || []).map((nombre) => ({ id: null, name: nombre })), dimensiones: p.dimensiones || { length: "", width: "", height: "" }, costo, proveedorId, proveedores, vencimiento: vFicha ? vFicha.fecha : "", combo });
    } catch (e) { return send(res, 500, { error: e.message }); }
  }
  // ---- Combo: definir los componentes de un producto-combo (staff) ----
  if (u.pathname === "/api/admin/combo-set" && req.method === "POST") {
    if (!(await esStaff(req))) return send(res, 401, { error: "No autorizado" });
    const b = await readBody(req);
    const pid = String(b.productId || ""); if (!pid) return send(res, 400, { error: "Falta el producto" });
    const combos = await readJson(COMBOS_PATH, {});
    const comps = (Array.isArray(b.componentes) ? b.componentes : [])
      .map((c) => ({ productId: Number(c.productId), variationId: c.variationId ? Number(c.variationId) : null, cantidad: Math.max(1, Math.round(Number(c.cantidad) || 1)) }))
      .filter((c) => c.productId);
    if (comps.length) combos[pid] = { componentes: comps }; else delete combos[pid];
    await writeFile(COMBOS_PATH, JSON.stringify(combos, null, 2));
    return send(res, 200, { ok: true, combo: combos[pid] || null });
  }
  // ---- Actualizar info de un producto en la DB ----
  if (u.pathname === "/api/admin/producto" && req.method === "POST") {
    if (!(await esStaff(req))) return send(res, 401, { error: "No autorizado" });
    const b = await readBody(req);
    if (!b.id) return send(res, 400, { error: "Faltan datos" });
    const campos = {};
    if (b.nombre != null) campos.nombre = b.nombre;
    if (b.descripcion != null) campos.descripcion = b.descripcion;
    if (b.descripcion_corta != null) campos.descripcion_corta = b.descripcion_corta;
    if (Array.isArray(b.images)) { campos.imagenes = b.images; campos.imagen = b.images[0] ? b.images[0].src : ""; }
    if (b.precio != null && b.precio !== "") campos.precio = Math.max(0, Math.round(Number(b.precio)) || 0);
    if (b.stock != null && b.stock !== "") { const q = Math.max(0, Math.round(Number(b.stock)) || 0); campos.stock = q; campos.stock_status = q > 0 ? "instock" : "outofstock"; }
    if (b.peso != null && b.peso !== "") campos.peso = String(b.peso);
    if (b.dimensiones) campos.dimensiones = b.dimensiones;
    if (b.slug != null && b.slug !== "") campos.slug = String(b.slug).trim();
    if (b.sku != null) campos.sku = String(b.sku).trim();
    if (Array.isArray(b.categorias)) campos.categorias = b.categorias;
    try {
      await upsertProducto({ id: Number(b.id), ...campos });
      if (b.costo != null && b.costo !== "") { try { await FIN.setCostos({ [b.id]: Number(b.costo) }); } catch {} }
      if (b.proveedorId !== undefined) { try { await FIN.setProvProd(Number(b.id), b.proveedorId || ""); } catch {} }
      await buildCatCache();
      return send(res, 200, { ok: true, imagen: campos.imagen || "" });
    } catch (e) { return send(res, 500, { error: e.message }); }
  }
  // ---- Actualizar una variación (precio, stock, foto) en la DB ----
  if (u.pathname === "/api/admin/producto/variacion" && req.method === "POST") {
    if (!(await esStaff(req))) return send(res, 401, { error: "No autorizado" });
    const b = await readBody(req);
    if (!b.productId || !b.variationId) return send(res, 400, { error: "Faltan datos" });
    const campos = {};
    if (b.precio != null && b.precio !== "") campos.precio = Math.max(0, Math.round(Number(b.precio)) || 0);
    if (b.stock != null && b.stock !== "") { const q = Math.max(0, Math.round(Number(b.stock)) || 0); campos.stock = q; campos.stock_status = q > 0 ? "instock" : "outofstock"; }
    if (b.image && b.image.src) campos.imagen = b.image.src;
    if (b.sku != null) campos.sku = String(b.sku).trim();
    try {
      await upsertVariacion({ id: Number(b.variationId), producto_id: Number(b.productId), ...campos });
      await buildCatCache();
      return send(res, 200, { ok: true, precio: campos.precio, stock: campos.stock, imagen: campos.imagen || "" });
    } catch (e) { return send(res, 500, { error: e.message }); }
  }
  // ---- Lista de categorías (para el editor/alta) ----
  if (u.pathname === "/api/admin/categorias-wc") {
    if (!(await esStaff(req))) return send(res, 401, { error: "No autorizado" });
    try {
      const cats = await getCategorias();
      return send(res, 200, { categorias: cats.map((c) => ({ id: c.id, name: c.nombre, parent: c.parent_id || 0 })) });
    } catch { return send(res, 200, { categorias: [] }); }
  }
  // ---- Alta de producto nuevo en la DB ----
  if (u.pathname === "/api/admin/producto-nuevo" && req.method === "POST") {
    if (!(await esStaff(req))) return send(res, 401, { error: "No autorizado" });
    const b = await readBody(req);
    if (!b.nombre) return send(res, 400, { error: "Falta el nombre del producto" });
    const stock = b.stock != null && b.stock !== "" ? Math.max(0, Math.round(Number(b.stock)) || 0) : 0;
    try {
      const id = Date.now(); // ID temporal único hasta tener sequence propio en el form
      await upsertProducto({ id, sku: b.sku ? String(b.sku).trim() : "", nombre: b.nombre, tipo: "simple", precio: b.precio != null && b.precio !== "" ? Math.max(0, Math.round(Number(b.precio)) || 0) : 0, stock, stock_status: stock > 0 ? "instock" : "outofstock", categorias: Array.isArray(b.categorias) ? b.categorias : [], descripcion: b.descripcion || "", descripcion_corta: b.descripcion_corta || "", imagen: Array.isArray(b.images) && b.images[0] ? b.images[0].src : "", imagenes: Array.isArray(b.images) ? b.images : [], peso: b.peso ? String(b.peso) : "", activo: true });
      await buildCatCache();
      return send(res, 200, { ok: true, id });
    } catch (e) { return send(res, 500, { error: e.message }); }
  }
  // ---- Recibir: crear sesión QR para subir fotos desde el celular (staff) ----
  if (u.pathname === "/api/admin/recibir/qr-nuevo" && req.method === "POST") {
    if (!(await esStaff(req))) return send(res, 401, { error: "No autorizado" });
    const token = Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
    qrSesiones[token] = { fotos: [], ts: Date.now() };
    const host = req.headers.host || "elpasajedental.com";
    return send(res, 200, { ok: true, token, url: `https://${host}/subir/${token}` });
  }
  // ---- Recibir: el celular sube una foto (público, protegido por el token) ----
  if (u.pathname === "/api/recibir/subir" && req.method === "POST") {
    const { token, data } = await readBody(req);
    const ses = token && qrSesiones[token];
    if (!ses) return send(res, 400, { error: "Sesión inválida o vencida. Volvé a escanear el QR." });
    if (ses.fotos.length >= 20) return send(res, 400, { error: "Demasiadas fotos" });
    const m = String(data || "").match(/^data:(image\/[\w.+-]+|application\/pdf);base64,(.+)$/);
    if (!m) return send(res, 400, { error: "Archivo inválido" });
    const buf = Buffer.from(m[2], "base64");
    if (buf.length > 8 * 1024 * 1024) return send(res, 400, { error: "El archivo es muy grande (máx 8MB)" });
    const ext = m[1] === "application/pdf" ? "pdf" : (m[1].split("/")[1] === "jpeg" ? "jpg" : m[1].split("/")[1]);
    const name = Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + "." + ext;
    await mkdir(join(DATA, "uploads"), { recursive: true });
    await writeFile(join(DATA, "uploads", name), buf);
    const host = req.headers.host || "elpasajedental.com";
    ses.fotos.push(`https://${host}/uploads/${name}`);
    return send(res, 200, { ok: true, total: ses.fotos.length });
  }
  // ---- Recibir: la PC consulta las fotos subidas desde el celular (staff) ----
  if (u.pathname === "/api/admin/recibir/fotos") {
    if (!(await esStaff(req))) return send(res, 401, { error: "No autorizado" });
    const ses = qrSesiones[u.searchParams.get("token") || ""];
    return send(res, 200, { fotos: ses ? ses.fotos : [] });
  }
  // ---- Encargos de clientes (avisar cuando llega la mercadería pedida) ----
  if (u.pathname === "/api/admin/encargos" && req.method === "GET") {
    const d = await readJson(ENCARGOS_PATH, { encargos: [] });
    return send(res, 200, { encargos: d.encargos || [] });
  }
  if (u.pathname === "/api/admin/encargos/nueva" && req.method === "POST") {
    const { cliente, telefono, producto, nota } = await readBody(req);
    if (!cliente || !producto) return send(res, 400, { error: "Falta cliente o producto" });
    const d = await readJson(ENCARGOS_PATH, { encargos: [] });
    if (!Array.isArray(d.encargos)) d.encargos = [];
    const reg = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), cliente: String(cliente).slice(0, 120), telefono: String(telefono || "").slice(0, 40), producto: String(producto).slice(0, 300), nota: String(nota || "").slice(0, 500), estado: "pendiente", creado: new Date().toISOString() };
    d.encargos.unshift(reg);
    await writeFile(ENCARGOS_PATH, JSON.stringify(d, null, 2));
    return send(res, 200, { ok: true, registro: reg });
  }
  if (u.pathname === "/api/admin/encargos/estado" && req.method === "POST") {
    const { id, estado } = await readBody(req);
    if (!["pendiente", "llego", "avisado"].includes(estado)) return send(res, 400, { error: "Estado inválido" });
    const d = await readJson(ENCARGOS_PATH, { encargos: [] });
    const e = (d.encargos || []).find((x) => x.id === id); if (!e) return send(res, 404, { error: "No encontrado" });
    e.estado = estado; e.actualizado = new Date().toISOString();
    await writeFile(ENCARGOS_PATH, JSON.stringify(d, null, 2));
    return send(res, 200, { ok: true });
  }
  if (u.pathname === "/api/admin/encargos/borrar" && req.method === "POST") {
    const { id } = await readBody(req);
    const d = await readJson(ENCARGOS_PATH, { encargos: [] });
    d.encargos = (d.encargos || []).filter((x) => x.id !== id);
    await writeFile(ENCARGOS_PATH, JSON.stringify(d, null, 2));
    return send(res, 200, { ok: true });
  }
  // ---- Solicitudes del equipo (mejoras / pedidos) ----
  if (u.pathname === "/api/solicitudes" && req.method === "GET") {
    const email = AUTH.leerSesion(req.headers.cookie) || "";
    const dueno = await esDueno(req);
    const d = await readJson(SOLIC_PATH, { solicitudes: [] });
    const list = dueno ? d.solicitudes : d.solicitudes.filter((s) => s.de === email);
    return send(res, 200, { solicitudes: list, dueno, yo: email });
  }
  if (u.pathname === "/api/solicitudes/nueva" && req.method === "POST") {
    const email = AUTH.leerSesion(req.headers.cookie) || "";
    const { titulo, detalle } = await readBody(req);
    if (!titulo || !String(titulo).trim()) return send(res, 400, { error: "Escribí un título" });
    let nombre = ""; try { const us = await AUTH.usuarioDe(email); nombre = (us && us.nombre) || ""; } catch {}
    const d = await readJson(SOLIC_PATH, { solicitudes: [] });
    const reg = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), de: email, nombre, titulo: String(titulo).slice(0, 200), detalle: String(detalle || "").slice(0, 4000), estado: "pendiente", creado: new Date().toISOString(), actualizado: new Date().toISOString(), nota: "" };
    d.solicitudes.unshift(reg);
    await writeFile(SOLIC_PATH, JSON.stringify(d, null, 2));
    return send(res, 200, { ok: true, registro: reg });
  }
  if (u.pathname === "/api/solicitudes/estado" && req.method === "POST") {
    if (!(await esDueno(req))) return send(res, 403, { error: "Solo el dueño aprueba o rechaza" });
    const { id, estado, nota } = await readBody(req);
    const ok = ["pendiente", "aprobada", "en_curso", "lista", "confirmada", "rechazada"];
    if (!ok.includes(estado)) return send(res, 400, { error: "Estado inválido" });
    const d = await readJson(SOLIC_PATH, { solicitudes: [] });
    const s = d.solicitudes.find((x) => x.id === id); if (!s) return send(res, 404, { error: "No encontrada" });
    s.estado = estado; if (nota != null) s.nota = String(nota).slice(0, 2000); s.actualizado = new Date().toISOString();
    await writeFile(SOLIC_PATH, JSON.stringify(d, null, 2));
    // Avisar por email a quien la pidió cuando queda lista para probar (con la explicación de cómo probarla)
    if (estado === "lista" && s.de && s.de.includes("@")) {
      enviarEmail(s.de, `✅ Lista para probar: ${s.titulo}`, `<div style="font-family:sans-serif;max-width:560px;color:#334155">
        <h2 style="color:#DE3667">¡Tu solicitud está lista para probar! 🚀</h2>
        <p>Hola${s.nombre ? " " + esc(s.nombre) : ""}, ya implementamos lo que pediste:</p>
        <p style="font-size:16px"><b>${esc(s.titulo)}</b></p>
        ${s.detalle ? `<p style="color:#64748b;font-size:14px">${esc(s.detalle)}</p>` : ""}
        ${s.nota ? `<div style="background:#f6f7f9;border-radius:10px;padding:14px;margin:14px 0"><b>📋 Cómo probarlo:</b><br>${esc(s.nota).replace(/\n/g, "<br>")}</div>` : ""}
        <p>Cuando lo pruebes, entrá al panel → <b>📨 Solicitudes</b> y tocá <b>"✅ Confirmar que está OK"</b>.</p>
        <p style="color:#94a3b8;font-size:13px;margin-top:16px">El Pasaje Dental · Panel interno</p></div>`);
    }
    return send(res, 200, { ok: true });
  }
  if (u.pathname === "/api/solicitudes/confirmar" && req.method === "POST") {
    const email = AUTH.leerSesion(req.headers.cookie) || "";
    const { id } = await readBody(req);
    const d = await readJson(SOLIC_PATH, { solicitudes: [] });
    const s = d.solicitudes.find((x) => x.id === id); if (!s) return send(res, 404, { error: "No encontrada" });
    if (s.de !== email && !(await esDueno(req))) return send(res, 403, { error: "No es tu solicitud" });
    s.estado = "confirmada"; s.actualizado = new Date().toISOString();
    await writeFile(SOLIC_PATH, JSON.stringify(d, null, 2));
    return send(res, 200, { ok: true });
  }
  if (u.pathname === "/api/solicitudes/borrar" && req.method === "POST") {
    if (!(await esDueno(req))) return send(res, 403, { error: "Solo el dueño" });
    const { id } = await readBody(req);
    const d = await readJson(SOLIC_PATH, { solicitudes: [] });
    d.solicitudes = d.solicitudes.filter((x) => x.id !== id);
    await writeFile(SOLIC_PATH, JSON.stringify(d, null, 2));
    return send(res, 200, { ok: true });
  }
  // ---- Recibir: aprender el nombre de la factura -> producto (para la próxima) ----
  if (u.pathname === "/api/admin/recibir/aprender" && req.method === "POST") {
    if (!(await esStaff(req))) return send(res, 401, { error: "No autorizado" });
    const { descripcion, productId } = await readBody(req);
    if (!descripcion || !productId) return send(res, 400, { error: "Faltan datos" });
    const d = await readJson(RECIBIR_ALIAS_PATH, { alias: {} });
    if (!d.alias) d.alias = {};
    const key = String(descripcion).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();
    d.alias[key] = Number(productId);
    await writeFile(RECIBIR_ALIAS_PATH, JSON.stringify(d, null, 2));
    return send(res, 200, { ok: true });
  }
  // ---- Recibir mercadería: analizar fotos de factura con IA (Claude vision) ----
  if (u.pathname === "/api/admin/recibir/analizar" && req.method === "POST") {
    if (!(await esStaff(req))) return send(res, 401, { error: "No autorizado" });
    const { images } = await readBody(req);
    if (!images || !images.length) return send(res, 400, { error: "Subí al menos una foto de la factura" });
    const cfg = await loadAnthropic(ROOT);
    if (!cfg || !cfg.api_key || cfg.api_key.startsWith("sk-ant-...")) return send(res, 400, { error: "Falta configurar la API key de Claude" });
    const model = cfg.model || "claude-opus-4-8";
    const content = [];
    for (let src of images.slice(0, 10)) {
      src = String(src);
      // si viene como URL (fotos subidas desde el celu), la bajo y la convierto a base64
      if (/^https?:\/\//.test(src)) {
        try { const rr = await fetch(src); const ct = rr.headers.get("content-type") || "image/jpeg"; src = `data:${ct};base64,${Buffer.from(await rr.arrayBuffer()).toString("base64")}`; } catch { continue; }
      }
      if (/^data:application\/pdf;base64,/.test(src)) { content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: src.split(",")[1] } }); continue; }
      const m = src.match(/^data:(image\/[\w.+-]+);base64,(.+)$/);
      if (m) content.push({ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } });
    }
    if (!content.length) return send(res, 400, { error: "No pude leer los archivos. Probá con fotos o un PDF." });
    content.push({ type: "text", text: `Estas son fotos de una factura o remito de compra de un proveedor de insumos odontológicos (pueden ser varias páginas de la misma factura). Extraé los datos y devolvé SOLO un JSON válido, sin texto extra:
{"proveedor":"nombre del proveedor o empresa","fecha":"YYYY-MM-DD o vacío","total":number,"items":[{"descripcion":"detalle del artículo","codigo":"código/SKU si aparece o vacío","cantidad":number,"precio_unitario":number}]}
Reglas: cantidades y precios SOLO numéricos (sin $ ni puntos de miles). Juntá los ítems de todas las páginas. Si un dato no está, poné "" o 0.` });
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": cfg.api_key, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model, max_tokens: 4000, messages: [{ role: "user", content }] }) });
      const data = await r.json();
      if (data.type === "error") return send(res, 200, { error: data.error?.message || "Error de la IA" });
      const txt = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
      const mm = txt.match(/\{[\s\S]*\}/);
      if (!mm) return send(res, 200, { error: "No se pudieron leer los datos. Probá con fotos más nítidas." });
      let parsed; try { parsed = JSON.parse(mm[0]); } catch { return send(res, 200, { error: "No se pudo interpretar la factura." }); }
      const cat = await getCatalogo();
      const nrm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      const STOP = new Set(["de", "la", "el", "x", "para", "con", "por", "un", "una", "del", "los", "las", "y", "o"]);
      const toks = (s) => nrm(s).replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
      const prods = (cat.productos || []).map((p) => ({ p, t: toks(p.nombre) }));
      const alias = (await readJson(RECIBIR_ALIAS_PATH, { alias: {} })).alias || {};
      const aliasKey = (s) => nrm(s).replace(/\s+/g, " ").trim();
      for (const it of (parsed.items || [])) {
        let match = null;
        if (it.codigo) match = (cat.productos || []).find((p) => String(p.sku) === String(it.codigo));
        if (!match && it.descripcion && alias[aliasKey(it.descripcion)]) match = (cat.productos || []).find((p) => p.id === alias[aliasKey(it.descripcion)]);
        if (!match && it.descripcion) {
          const qt = toks(it.descripcion);
          if (qt.length) {
            let best = null, bestScore = 0;
            for (const { p, t } of prods) {
              if (!t.length) continue;
              const shared = qt.filter((w) => t.includes(w)).length;
              if (!shared) continue;
              const score = shared / Math.max(qt.length, t.length); // solapamiento de palabras
              if (score > bestScore) { bestScore = score; best = p; }
            }
            if (best && bestScore >= 0.3) match = best;
          }
        }
        it.match = match ? { id: match.id, nombre: match.nombre, sku: match.sku, stock: match.stock || 0 } : null;
      }
      return send(res, 200, { ok: true, proveedor: parsed.proveedor || "", fecha: parsed.fecha || "", total: Number(parsed.total) || 0, items: parsed.items || [] });
    } catch (e) { return send(res, 500, { error: e.message }); }
  }
  // ---- Duplicar un producto (con sus variaciones) ----
  if (u.pathname === "/api/admin/producto-duplicar" && req.method === "POST") {
    if (!(await esStaff(req))) return send(res, 401, { error: "No autorizado" });
    const { id } = await readBody(req);
    if (!id) return send(res, 400, { error: "Faltan datos" });
    try {
      const p = await getProducto(Number(id));
      if (!p) return send(res, 404, { error: "Producto no encontrado" });
      const nuevoId = Date.now();
      await upsertProducto({ ...p, id: nuevoId, nombre: p.nombre + " (copia)", sku: (p.sku || "") + "-copia", stock: 0, stock_status: "outofstock" });
      for (const v of (p.variaciones || [])) {
        await upsertVariacion({ ...v, id: Date.now() + Math.round(Math.random() * 10000), producto_id: nuevoId, stock: 0, stock_status: "outofstock" });
      }
      await buildCatCache();
      return send(res, 200, { ok: true, id: nuevoId });
    } catch (e) { return send(res, 500, { error: e.message }); }
  }
  // ---- Editar datos de un cliente/usuario (nombre, tel, dirección, doc) ----
  if (u.pathname === "/api/admin/cliente-editar" && req.method === "POST") {
    const b = await readBody(req);
    if (!b.email) return send(res, 400, { error: "Falta el email" });
    const campos = {};
    if (b.nombre != null) campos.nombre = b.nombre;
    if (b.telefono != null) campos.telefono = b.telefono;
    if (b.doc != null) campos.doc = String(b.doc).replace(/\D/g, "");
    if (b.cond_iva != null) campos.cond_iva = Number(b.cond_iva) || null;
    if (b.entrega) campos.entrega = b.entrega;
    return send(res, 200, await AUTH.actualizarCliente(b.email, campos));
  }
  // ---- Guardar CUIT/DNI de un cliente (para facturar) ----
  if (u.pathname === "/api/admin/cliente-doc" && req.method === "POST") {
    const { email, doc } = await readBody(req);
    return send(res, 200, await AUTH.actualizarCliente(email, { doc: String(doc || "").replace(/\D/g, "") }));
  }
  // ---- Prospectos (lista para campañas) — solo dueño ----
  if (u.pathname === "/api/admin/prospectos" && req.method === "GET") {
    if (!(await esDueno(req))) return send(res, 403, { error: "Solo el dueño" });
    const d = await readJson(PROSPECTOS_PATH, { prospectos: [] });
    return send(res, 200, { prospectos: d.prospectos || [] });
  }
  if (u.pathname === "/api/admin/prospectos/importar" && req.method === "POST") {
    if (!(await esDueno(req))) return send(res, 403, { error: "Solo el dueño" });
    const { texto } = await readBody(req);
    const d = await readJson(PROSPECTOS_PATH, { prospectos: [] });
    const existentes = new Set((d.prospectos || []).map((p) => p.email));
    let nuevos = 0;
    // Parseo flexible: detecta emails y toma como nombre lo que esté antes en la línea/columna
    for (const linea of String(texto || "").split(/[\n\r]+/)) {
      const em = (linea.match(/[\w.+-]+@[\w.-]+\.\w+/) || [])[0];
      if (!em) continue;
      const email = em.toLowerCase();
      if (existentes.has(email)) continue;
      const nombre = linea.replace(em, "").replace(/[,;\t|]+/g, " ").trim();
      d.prospectos = d.prospectos || [];
      d.prospectos.push({ email, nombre, creado: new Date().toISOString() });
      existentes.add(email); nuevos++;
    }
    await writeFile(PROSPECTOS_PATH, JSON.stringify(d, null, 2));
    return send(res, 200, { ok: true, nuevos, total: (d.prospectos || []).length });
  }
  if (u.pathname === "/api/admin/prospectos/borrar" && req.method === "POST") {
    if (!(await esDueno(req))) return send(res, 403, { error: "Solo el dueño" });
    const { email } = await readBody(req);
    const d = await readJson(PROSPECTOS_PATH, { prospectos: [] });
    d.prospectos = (d.prospectos || []).filter((p) => p.email !== (email || "").toLowerCase());
    await writeFile(PROSPECTOS_PATH, JSON.stringify(d, null, 2));
    return send(res, 200, { ok: true });
  }
  // ---- Conteo de destinatarios para campañas ----
  if (u.pathname === "/api/admin/campana/destinatarios" && req.method === "GET") {
    if (!(await esDueno(req))) return send(res, 403, { error: "Solo el dueño" });
    const usuarios = await AUTH.leerUsuarios();
    const clientes = (usuarios.usuarios || []).filter((x) => x.email && x.email.includes("@") && !x.spam).length;
    const prospectos = (await readJson(PROSPECTOS_PATH, { prospectos: [] })).prospectos.length;
    return send(res, 200, { clientes, prospectos });
  }
  // ---- Redactar campaña con IA (skill de marketing) — solo dueño ----
  if (u.pathname === "/api/admin/campana/redactar" && req.method === "POST") {
    if (!(await esDueno(req))) return send(res, 403, { error: "Solo el dueño" });
    const { brief } = await readBody(req);
    if (!brief || !brief.trim()) return send(res, 400, { error: "Contame de qué es la campaña" });
    return send(res, 200, await redactarCampana(brief.trim()));
  }
  // ---- Enviar campaña por email (Resend) — solo dueño ----
  if (u.pathname === "/api/admin/campana/enviar" && req.method === "POST") {
    if (!(await esDueno(req))) return send(res, 403, { error: "Solo el dueño" });
    const { asunto, mensaje, destino } = await readBody(req);
    if (!asunto || !mensaje) return send(res, 400, { error: "Falta el asunto o el mensaje" });
    const resend = await loadResend(ROOT);
    if (!resend || !resend.api_key) return send(res, 400, { error: "Resend no está configurado" });
    // Armar lista de destinatarios según destino
    const set = new Map();
    if (destino === "clientes" || destino === "todos") {
      for (const x of (await AUTH.leerUsuarios()).usuarios || []) if (x.email && x.email.includes("@") && !x.spam) set.set(x.email.toLowerCase(), x.nombre || "");
    }
    if (destino === "prospectos" || destino === "todos") {
      for (const p of (await readJson(PROSPECTOS_PATH, { prospectos: [] })).prospectos) set.set(p.email, p.nombre || "");
    }
    const lista = [...set.keys()];
    if (!lista.length) return send(res, 400, { error: "No hay destinatarios" });
    const cuerpo = String(mensaje).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>");
    const html = `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:560px;margin:auto;color:#334155"><h2 style="color:#DE3667">El Pasaje Dental</h2><div style="font-size:15px;line-height:1.6">${cuerpo}</div><hr style="border:none;border-top:1px solid #eee;margin:22px 0"><p style="color:#94a3b8;font-size:12px">El Pasaje Dental · Insumos odontológicos · Tucumán</p></div>`;
    let enviados = 0, fallidos = 0;
    // Resend batch: hasta 100 por request, cada uno individual (privacidad)
    for (let i = 0; i < lista.length; i += 100) {
      const chunk = lista.slice(i, i + 100).map((to) => ({ from: resend.from, to: [to], subject: asunto, html }));
      try {
        const r = await fetch("https://api.resend.com/emails/batch", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + resend.api_key }, body: JSON.stringify(chunk) });
        if (r.ok) enviados += chunk.length; else fallidos += chunk.length;
      } catch { fallidos += chunk.length; }
    }
    return send(res, 200, { ok: true, enviados, fallidos, total: lista.length });
  }
  // ---- Backup descargable de los datos del panel (solo dueño) ----
  if (u.pathname === "/api/admin/backup") {
    if (!(await esDueno(req))) return send(res, 403, { error: "Solo el dueño" });
    const b = await construirBackup();
    res.writeHead(200, { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${b.filename}"` });
    return res.end(b.contenido);
  }
  // Forzar el envío del backup por email ahora (solo dueño) — para probarlo
  if (u.pathname === "/api/admin/backup/enviar" && req.method === "POST") {
    if (!(await esDueno(req))) return send(res, 403, { error: "Solo el dueño" });
    try { await enviarBackupDiario(); return send(res, 200, { ok: true }); }
    catch (e) { return send(res, 500, { error: e.message }); }
  }
  // Backup de productos en la DB propia
  if (u.pathname === "/api/admin/backup/wc-productos" && req.method === "POST") {
    if (!(await esDueno(req))) return send(res, 403, { error: "Solo el dueño" });
    try {
      const cat = await getCatalogo();
      const stamp = new Date().toISOString().slice(0, 10);
      const bundle = { _generado: new Date().toISOString(), _negocio: "El Pasaje Dental", _fuente: "db-propia", _tipo: "productos", total: cat.total, productos: cat.productos };
      const json = JSON.stringify(bundle);
      const gz = gzipSync(Buffer.from(json));
      const dest = process.env.MAIL_TO || (process.env.DUENOS || "maximilianoespeche@gmail.com").split(",")[0].trim();
      await enviarEmail(dest, `Backup productos — ${stamp}`,
        `<div style="font-family:sans-serif;max-width:520px;color:#334155"><h2 style="color:#DE3667">Backup de productos</h2><p>${cat.total} productos de la base de datos propia. Adjunto JSON comprimido.</p></div>`,
        [{ filename: `productos-${stamp}.json.gz`, content: gz.toString("base64") }]);
      return send(res, 200, { ok: true, productos: cat.total, bytes_gz: gz.length, enviado_a: dest });
    } catch (e) { return send(res, 500, { error: e.message }); }
  }
  // RECONCILIAR STOCK: pisa el stock de la DB con nuestros totales por ubicación
  if (u.pathname === "/api/admin/reconciliar-stock" && req.method === "POST") {
    if (!(await esDueno(req))) return send(res, 403, { error: "Solo el dueño" });
    const body = await readBody(req);
    const dry = body.dry !== false;
    const cat = await getCatalogo();
    const ubic = await readJson(UBIC_PATH, { asignaciones: [] });
    const prods = cat.productos || [];
    const sumProd = new Map(), sumVar = new Map();
    for (const a of (ubic.asignaciones || [])) {
      const c = Number(a.cantidad) || 0; if (!c) continue;
      if (a.variationId) { const k = a.productId + ":" + a.variationId; sumVar.set(k, (sumVar.get(k) || 0) + c); }
      else sumProd.set(a.productId, (sumProd.get(a.productId) || 0) + c);
    }
    let uSimples = 0, uVars = 0, simplesConStock = 0, varsConStock = 0, cambian0 = 0, padres = 0, nSimples = 0;
    const plan_items = [];
    for (const p of prods) {
      const esVar = p.tipo === "variable" || (p.variaciones && p.variaciones.length);
      if (esVar) {
        padres++;
        for (const v of (p.variaciones || [])) {
          const t = sumVar.get(p.id + ":" + v.id) || 0; uVars += t; if (t > 0) varsConStock++;
          if ((Number(v.stock) || 0) > 0 && t === 0) cambian0++;
          plan_items.push({ tipo: "variacion", productId: p.id, variationId: v.id, nuevo_stock: t });
        }
      } else {
        nSimples++;
        const t = sumProd.get(p.id) || 0; uSimples += t; if (t > 0) simplesConStock++;
        if ((Number(p.stock) || 0) > 0 && t === 0) cambian0++;
        plan_items.push({ tipo: "simple", productId: p.id, variationId: null, nuevo_stock: t });
      }
    }
    const plan = { simples: nSimples, simplesConStock, variablesPadres: padres, variaciones: plan_items.filter((x) => x.tipo === "variacion").length, variacionesConStock: varsConStock, totalUnidades: uSimples + uVars, vanA0_conStockHoy: cambian0 };
    if (dry) return send(res, 200, { dry: true, plan });
    if (body.ejecutar !== "CONFIRMO") return send(res, 400, { error: "Para ejecutar mandá { dry:false, ejecutar:'CONFIRMO' }", plan });
    try {
      for (const it of plan_items) await setStock(it.productId, it.variationId, it.nuevo_stock).catch(() => {});
      await buildCatCache();
      console.log(`[reconciliar] OK · ${plan.totalUnidades} u · ${plan.simples} simples + ${plan.variaciones} variaciones`);
      return send(res, 200, { ok: true, ejecutado: plan });
    } catch (e) { return send(res, 500, { error: e.message, plan }); }
  }
  // ---- Descripciones con IA: estado (cuántas faltan) ----
  if (u.pathname === "/api/admin/descripciones/estado" && req.method === "GET") {
    if (!(await esDueno(req))) return send(res, 403, { error: "Solo el dueño" });
    const cat = await getCatalogo();
    const ov = await readJson(DESC_PATH, { descripciones: {} });
    const total = (cat.productos || []).length;
    const faltan = (cat.productos || []).filter((p) => !(p.descripcion || "").trim() && !(p.descripcion_corta || "").trim() && !ov.descripciones[p.id]).length;
    return send(res, 200, { total, faltan, generadas: Object.keys(ov.descripciones || {}).length });
  }
  // ---- Descripciones con IA: generar un lote ----
  if (u.pathname === "/api/admin/descripciones/generar" && req.method === "POST") {
    if (!(await esDueno(req))) return send(res, 403, { error: "Solo el dueño" });
    const { limite } = await readBody(req);
    const n = Math.min(Math.max(Number(limite) || 10, 1), 15);
    const cat = await getCatalogo();
    const ov = await readJson(DESC_PATH, { descripciones: {} });
    if (!ov.descripciones) ov.descripciones = {};
    const faltan = (cat.productos || []).filter((p) => !(p.descripcion || "").trim() && !(p.descripcion_corta || "").trim() && !ov.descripciones[p.id]);
    const lote = faltan.slice(0, n);
    if (!lote.length) return send(res, 200, { ok: true, generadas: 0, restantes: 0 });
    const gen = await generarDescripciones(lote.map((p) => ({ id: p.id, nombre: p.nombre, categorias: p.categorias })));
    if (gen.error) return send(res, 200, { error: gen.error });
    let count = 0;
    for (const p of lote) { const d = gen.descripciones[p.id] || gen.descripciones[String(p.id)]; if (d && String(d).trim()) { ov.descripciones[p.id] = String(d).trim(); count++; } }
    await writeFile(DESC_PATH, JSON.stringify(ov, null, 2));
    return send(res, 200, { ok: true, generadas: count, restantes: faltan.length - count });
  }

  // ---- Vencimientos de productos (control de stock por lote/fecha) ----
  if (u.pathname === "/api/admin/vencimientos" && req.method === "GET") {
    const d = await readJson(VENC_PATH, { items: [], dias_aviso: 60 });
    const aj = await readJson(AJUSTES_PATH, AJUSTES_DEFAULT);
    const hoy = new Date().toISOString().slice(0, 10);
    const aviso = Number(aj.venc_dias_aviso) || Number(d.dias_aviso) || 60;
    const items = (d.items || []).map((it) => {
      const dias = Math.ceil((new Date(it.fecha) - new Date(hoy)) / 86400000);
      const estado = dias < 0 ? "vencido" : dias <= aviso ? "por_vencer" : "ok";
      return { ...it, dias, estado };
    }).sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
    return send(res, 200, { items, dias_aviso: aviso, vencidos: items.filter((x) => x.estado === "vencido").length, por_vencer: items.filter((x) => x.estado === "por_vencer").length });
  }
  if (u.pathname === "/api/admin/vencimiento" && req.method === "POST") {
    const b = await readBody(req);
    if (!b.fecha) return send(res, 400, { error: "Falta la fecha de vencimiento" });
    const d = await readJson(VENC_PATH, { items: [], dias_aviso: 60 });
    if (!d.items) d.items = [];
    d.items.push({ id: Math.random().toString(36).slice(2, 9), productId: b.productId || null, variationId: b.variationId || null, nombre: b.nombre || "", codigo: b.codigo || "", lote: b.lote || "", fecha: b.fecha, cantidad: Number(b.cantidad) || null, ubicacion: b.ubicacion || "", nota: b.nota || "", creado: new Date().toISOString() });
    await writeFile(VENC_PATH, JSON.stringify(d, null, 2));
    return send(res, 200, { ok: true });
  }
  if (u.pathname === "/api/admin/vencimiento-set" && req.method === "POST") {
    if (!(await esStaff(req))) return send(res, 401, { error: "No autorizado" });
    const b = await readBody(req);
    if (!b.productId) return send(res, 400, { error: "Falta el producto" });
    const vid = b.variationId || null;
    const d = await readJson(VENC_PATH, { items: [], dias_aviso: 60 });
    if (!d.items) d.items = [];
    d.items = d.items.filter((x) => !(x.origen === "ficha" && String(x.productId) === String(b.productId) && String(x.variationId || "") === String(vid || ""))); // reemplaza la vencimiento de ficha previa (de ese producto/variación)
    if (b.fecha) d.items.push({ id: Math.random().toString(36).slice(2, 9), productId: b.productId, variationId: vid, nombre: b.nombre || "", codigo: b.codigo || "", lote: "", fecha: b.fecha, cantidad: null, ubicacion: "", nota: "", origen: "ficha", creado: new Date().toISOString() });
    await writeFile(VENC_PATH, JSON.stringify(d, null, 2));
    return send(res, 200, { ok: true });
  }
  if (u.pathname === "/api/admin/vencimiento-sumar" && req.method === "POST") {
    if (!(await esStaff(req))) return send(res, 401, { error: "No autorizado" });
    const b = await readBody(req);
    if (!b.fecha) return send(res, 400, { error: "Falta la fecha de vencimiento" });
    const d = await readJson(VENC_PATH, { items: [], dias_aviso: 60 });
    if (!d.items) d.items = [];
    const cant = Number(b.cantidad) || null;
    // misma combinación producto + variación + ubicación + fecha → suma la cantidad; si no, agrega
    const ex = d.items.find((x) => String(x.productId) === String(b.productId) && String(x.variationId || "") === String(b.variationId || "") && (x.ubicacion || "") === (b.ubicacion || "") && x.fecha === b.fecha);
    if (ex) {
      if (cant != null) ex.cantidad = (Number(ex.cantidad) || 0) + cant;
      if (b.nombre) ex.nombre = b.nombre;
      if (b.codigo) ex.codigo = b.codigo;
    } else {
      d.items.push({ id: Math.random().toString(36).slice(2, 9), productId: b.productId || null, variationId: b.variationId || null, nombre: b.nombre || "", codigo: b.codigo || "", lote: b.lote || "", fecha: b.fecha, cantidad: cant, ubicacion: b.ubicacion || "", nota: b.nota || "", origen: "factura", creado: new Date().toISOString() });
    }
    await writeFile(VENC_PATH, JSON.stringify(d, null, 2));
    return send(res, 200, { ok: true });
  }
  if (u.pathname === "/api/admin/vencimiento-borrar" && req.method === "POST") {
    const { id } = await readBody(req);
    const d = await readJson(VENC_PATH, { items: [], dias_aviso: 60 });
    d.items = (d.items || []).filter((x) => x.id !== id);
    await writeFile(VENC_PATH, JSON.stringify(d, null, 2));
    return send(res, 200, { ok: true });
  }
  if (u.pathname === "/api/admin/vencimientos-config" && req.method === "POST") {
    const { dias_aviso } = await readBody(req);
    const d = await readJson(VENC_PATH, { items: [], dias_aviso: 60 });
    d.dias_aviso = Math.max(1, Number(dias_aviso) || 60);
    await writeFile(VENC_PATH, JSON.stringify(d, null, 2));
    return send(res, 200, { ok: true, dias_aviso: d.dias_aviso });
  }
  // ---- Finanzas / Caja (staff). El empleado NO ve la caja ni los resultados. ----
  if (u.pathname === "/api/admin/finanzas" && req.method === "GET") {
    const d = await FIN.todo();
    if (!(await esDueno(req))) { delete d.resumen; delete d.config; } // empleado: sin caja ni saldos
    return send(res, 200, d);
  }
  if (u.pathname === "/api/admin/finanzas/agregar" && req.method === "POST") {
    const { coleccion, registro } = await readBody(req);
    return send(res, 200, await FIN.agregar(coleccion, registro || {}));
  }
  if (u.pathname === "/api/admin/finanzas/borrar" && req.method === "POST") {
    const { coleccion, id } = await readBody(req);
    return send(res, 200, await FIN.borrar(coleccion, id));
  }
  if (u.pathname === "/api/admin/cheques/avisar-ahora" && req.method === "POST") {
    if (!(await esDueno(req))) return send(res, 403, { error: "Solo el dueño" });
    const b = await readBody(req);
    return send(res, 200, (await chequearChequesProximos(true, b.test)) || { ok: true, enviados: 0 });
  }
  if (u.pathname === "/api/admin/finanzas/actualizar" && req.method === "POST") {
    const { coleccion, id, cambios } = await readBody(req);
    return send(res, 200, await FIN.actualizar(coleccion, id, cambios || {}));
  }
  if (u.pathname === "/api/admin/finanzas/config" && req.method === "POST") {
    const { config } = await readBody(req);
    return send(res, 200, await FIN.guardarConfig(config || {}));
  }
  // ---- Facturación AFIP: estado/conexión por CUIT ----
  if (u.pathname === "/api/admin/afip/estado") {
    const aj = await readJson(AJUSTES_PATH, AJUSTES_DEFAULT);
    const f = aj.afip || {};
    const cuit = (u.searchParams.get("cuit") || f.cuit || "").replace(/\D/g, "");
    const pv = Number(u.searchParams.get("pv") || f.punto_venta || 1);
    if (!cuit) return send(res, 400, { error: "Falta CUIT" });
    return send(res, 200, await AFIP.estado(cuit, pv, 11));
  }
  // ---- Facturación AFIP: emitir Factura C ----
  if (u.pathname === "/api/admin/afip/puntos") {
    const aj = await readJson(AJUSTES_PATH, AJUSTES_DEFAULT);
    const f = aj.afip || {};
    const cuit = (u.searchParams.get("cuit") || f.cuit || "").replace(/\D/g, "");
    if (!cuit) return send(res, 400, { error: "Falta CUIT" });
    try { return send(res, 200, await AFIP.puntosVenta(cuit)); }
    catch (e) { console.log("[afip/puntos]", e.message); return send(res, 502, { error: e.message }); }
  }
  // Trae el nombre/razón social oficial de AFIP (Padrón A5) para un CUIT — para que el comprobante salga con ese nombre.
  if (u.pathname === "/api/admin/afip/padron") {
    if (!(await esDueno(req))) return send(res, 403, { error: "Solo el dueño" });
    const cuitConsulta = (u.searchParams.get("cuit") || "").replace(/\D/g, "");
    const aj = await readJson(AJUSTES_PATH, AJUSTES_DEFAULT);
    const emisores = (aj.afip && aj.afip.emisores) || [];
    const emisor = (u.searchParams.get("emisor") || "").replace(/\D/g, "") || (emisores[0] && String(emisores[0].cuit)) || "";
    if (cuitConsulta.length !== 11) return send(res, 400, { error: "Poné un CUIT válido (11 dígitos)" });
    if (!emisor) return send(res, 400, { error: "No hay emisor AFIP configurado" });
    try {
      const debug = !!u.searchParams.get("debug");
      const out = await AFIP.padronNombre(emisor, cuitConsulta, debug);
      if (debug) return send(res, 200, { emisor, consulta: cuitConsulta, resultado: out });
      return send(res, 200, out ? { ok: true, nombre: out } : { error: "No se obtuvo el nombre. ¿Habilitaste en AFIP el WS 'Consulta de Constancia de Inscripción' (ws_sr_constancia_inscripcion) para el CUIT emisor?" });
    } catch (e) { return send(res, 502, { error: e.message }); }
  }
  if (u.pathname === "/api/admin/afip/emitir" && req.method === "POST") {
    const b = await readBody(req);
    const aj = await readJson(AJUSTES_PATH, AJUSTES_DEFAULT);
    const f = aj.afip || {};
    const cuit = (b.cuit || f.cuit || "").replace(/\D/g, "");
    const pv = Number(b.pv || f.punto_venta || 1);
    if (!cuit || !(Number(b.importe) > 0)) return send(res, 400, { error: "Falta CUIT o importe" });
    // si viene de un pedido, traer el detalle de productos para que salga en la factura
    if (b.pedido && !(Array.isArray(b.items) && b.items.length)) {
      try {
        const pid = Number(String(b.pedido).replace(/\D/g, ""));
        const o = pid ? await getPedido(pid) : null;
        if (o) {
          b.items = (o.items || []).map((li) => ({ nombre: `${li.cantidad} × ${li.nombre}`, importe: Math.round(Number(li.total) || 0) }));
          if (Number(o.shipping_total) > 0) b.items.push({ nombre: "Envío", importe: Math.round(Number(o.shipping_total)) });
        }
      } catch {}
    }
    try { return send(res, 200, await AFIP.emitir(cuit, { ...b, pv })); }
    catch (e) { console.log("[afip/emitir]", e.message); return send(res, 502, { error: e.message }); }
  }
  // ---- Completar el detalle de productos de una factura ya emitida (desde su pedido) ----
  if (u.pathname === "/api/admin/afip/factura-detalle" && req.method === "POST") {
    const { id } = await readBody(req);
    const fd = await AFIP.leerFacturas();
    const fx = (fd.facturas || []).find((x) => x.id === id);
    if (!fx) return send(res, 404, { error: "Factura no encontrada" });
    if (!fx.pedido) return send(res, 400, { error: "La factura no tiene pedido asociado" });
    try {
      const pid = Number(String(fx.pedido).replace(/\D/g, ""));
      const o = await getPedido(pid);
      if (!o) return send(res, 404, { error: "No se encontró el pedido" });
      const items = (o.items || []).map((li) => ({ nombre: `${li.cantidad} × ${li.nombre}`, importe: Math.round(Number(li.total) || 0) }));
      if (Number(o.shipping_total) > 0) items.push({ nombre: "Envío", importe: Math.round(Number(o.shipping_total)) });
      return send(res, 200, await AFIP.setItems(id, items));
    } catch (e) { return send(res, 502, { error: e.message }); }
  }
  // ---- Vincular una factura a un pedido (y traer su detalle) ----
  if (u.pathname === "/api/admin/afip/factura-pedido" && req.method === "POST") {
    const { id, numero, pedido } = await readBody(req);
    const ped = String(pedido || "").replace(/\D/g, "");
    if (!ped || (!id && numero == null)) return send(res, 400, { error: "Faltan datos (id/numero + pedido)" });
    const campos = { pedido: ped };
    try {
      const pid = Number(ped);
      const o = pid ? await getPedido(pid) : null;
      if (o) {
        campos.items = (o.items || []).map((li) => ({ nombre: `${li.cantidad} × ${li.nombre}`, importe: Math.round(Number(li.total) || 0) }));
        if (Number(o.shipping_total) > 0) campos.items.push({ nombre: "Envío", importe: Math.round(Number(o.shipping_total)) });
        const billing = o.billing || {};
        const nom = `${billing.first_name || ""} ${billing.last_name || ""}`.trim();
        if (nom) campos.cliente = nom;
      }
    } catch {}
    return send(res, 200, await AFIP.actualizar({ id, numero }, campos));
  }
  // ---- Facturación: emisores configurados (multi-CUIT) ----
  if (u.pathname === "/api/admin/afip/emisores") {
    const aj = await readJson(AJUSTES_PATH, AJUSTES_DEFAULT);
    const f = aj.afip || {};
    const emisores = Array.isArray(f.emisores) && f.emisores.length ? f.emisores : [
      { cuit: "27181849032", razon: "Nancy Maria Zarate", punto_venta: 8 },
      { cuit: "20349100860", razon: "Maximiliano Espeche", punto_venta: 2 },
    ];
    return send(res, 200, { emisores, ambiente: f.ambiente || "produccion" });
  }
  // ---- Facturación: listado (reporte) ----
  if (u.pathname === "/api/admin/facturas") {
    const d = await AFIP.leerFacturas();
    return send(res, 200, d);
  }

  // ---- Cta. cte: traer un pedido por número (para registrar deuda) ----
  if (u.pathname === "/api/admin/ctacte/pedido") {
    const n = Number((u.searchParams.get("n") || "").trim().replace(/[^\d]/g, ""));
    if (!n) return send(res, 400, { error: "Indicá el N° de pedido" });
    try {
      const o = await getPedido(n);
      if (!o) return send(res, 404, { error: "No se encontró el pedido #" + n });
      const billing = o.billing || {};
      const nombre = `${billing.first_name || ""} ${billing.last_name || ""}`.trim();
      const email = (o.cliente_email || "").toLowerCase();
      let doc = "", cond_iva = null;
      if (email) { try { const us = await AUTH.usuarioDe(email); if (us) { if (us.cond_iva) cond_iva = us.cond_iva; if (us.doc) doc = String(us.doc).replace(/\D/g, ""); } } catch {} }
      return send(res, 200, { ok: true, pedido: o.id, cliente: nombre || email, email, total: Math.round(Number(o.total) || 0), estado: o.status, doc, cond_iva });
    } catch (e) { return send(res, 502, { error: e.message || "Error al consultar el pedido" }); }
  }

  // ---- Promo (banner) — administrar (staff) ----
  if (u.pathname === "/api/admin/promo" && req.method === "GET") {
    const aj = await readJson(AJUSTES_PATH, AJUSTES_DEFAULT);
    return send(res, 200, aj.promo || { activo: false, texto: "", codigo: "", hasta: "" });
  }
  if (u.pathname === "/api/admin/promo" && req.method === "POST") {
    const b = await readBody(req);
    const aj = await readJson(AJUSTES_PATH, AJUSTES_DEFAULT);
    aj.promo = { activo: !!b.activo, texto: String(b.texto || "").slice(0, 200), codigo: String(b.codigo || "").slice(0, 40), hasta: b.hasta || "" };
    await writeFile(AJUSTES_PATH, JSON.stringify(aj, null, 2));
    return send(res, 200, { ok: true });
  }
  // ---- Cupones de descuento (WooCommerce) — administrar (staff) ----
  if (u.pathname === "/api/admin/cupones" && req.method === "GET") {
    try {
      const arr = await getCupones();
      return send(res, 200, { cupones: arr.map((c) => ({ id: c.id, code: c.codigo, tipo: c.tipo_descuento, monto: c.valor, vence: c.fecha_expiracion ? String(c.fecha_expiracion).slice(0, 10) : "", min: c.min_monto, usados: c.usos, limite: c.uso_limite })) });
    } catch (e) { return send(res, 500, { error: e.message }); }
  }
  if (u.pathname === "/api/admin/cupones" && req.method === "POST") {
    const b = await readBody(req); if (!b.code) return send(res, 400, { error: "Falta el código" });
    try {
      const c = await crearCupon({ codigo: String(b.code).trim(), tipo_descuento: b.tipo || "percent", valor: Number(b.monto) || 0, fecha_expiracion: b.vence || null, uso_limite: Number(b.limite) || 0, min_monto: Number(b.min) || 0, activo: true });
      return send(res, 200, { ok: true, id: c.id });
    } catch (e) { return send(res, 500, { error: e.message }); }
  }
  if (u.pathname === "/api/admin/cupones/borrar" && req.method === "POST") {
    const { id } = await readBody(req); if (!id) return send(res, 400, { error: "Falta id" });
    try { await borrarCupon(Number(id)); return send(res, 200, { ok: true }); }
    catch (e) { return send(res, 500, { error: e.message }); }
  }
  // ---- Proxy de imágenes (mismo origen) para poder dibujarlas en canvas y exportar ----
  if (u.pathname === "/api/admin/img-proxy") {
    const url = u.searchParams.get("url");
    if (!url || !/^https?:\/\//.test(url)) return send(res, 400, "url inválida", "text/plain");
    try {
      const rr = await fetch(url);
      if (!rr.ok) return send(res, 502, "no", "text/plain");
      const ct = rr.headers.get("content-type") || "image/jpeg";
      const buf = Buffer.from(await rr.arrayBuffer());
      res.writeHead(200, { "Content-Type": ct, "Cache-Control": "public, max-age=86400" });
      return res.end(buf);
    } catch { return send(res, 502, "err", "text/plain"); }
  }
  // ---- Extracto bancario: leer con IA y separar los gastos del banco (solo dueño) ----
  if (u.pathname === "/api/admin/banco/analizar" && req.method === "POST") {
    if (!(await esDueno(req))) return send(res, 403, { error: "Solo el dueño" });
    const { data } = await readBody(req);
    if (!data) return send(res, 400, { error: "Subí el extracto (PDF)" });
    const cfg = await loadAnthropic(ROOT);
    if (!cfg || !cfg.api_key || cfg.api_key.startsWith("sk-ant-...")) return send(res, 400, { error: "Falta configurar la API key de Claude" });
    const model = cfg.model || "claude-opus-4-8";
    const content = [];
    if (/^data:application\/pdf;base64,/.test(data)) content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: data.split(",")[1] } });
    else { const m = String(data).match(/^data:(image\/[\w.+-]+);base64,(.+)$/); if (m) content.push({ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } }); }
    if (!content.length) return send(res, 400, { error: "Subí un PDF o imagen del extracto." });
    content.push({ type: "text", text: `Este es un extracto de cuenta corriente bancaria (Argentina). Extraé SOLO los CARGOS DEL BANCO (gastos, impuestos, comisiones y retenciones) — montos negativos. NO incluyas cheques pagados (CHEQUE P/CAMARA, CHEQUE CANJE INTERNO), transferencias (TRANSF, ING TRANSF) ni acreditaciones/depósitos.
Categorizá cada cargo en: "impuesto_cheque" (Impuesto Ley 25413 a débitos y créditos, líneas "DBCR 25413 ... TASA GRAL" o "IMPDBCR 25413"), "iibb" (retención Ingresos Brutos, "RET IIBB"), "comisiones" ("COMISION ...", administración de valores al cobro), "iva" ("DEBITO FISCAL IVA"), "otros" (otro gasto/impuesto bancario).
Devolvé SOLO un JSON válido: {"periodo":"texto del período","items":[{"fecha":"DD/MM/AAAA","descripcion":"...","categoria":"impuesto_cheque|iibb|comisiones|iva|otros","importe":number}],"totales":{"impuesto_cheque":number,"iibb":number,"comisiones":number,"iva":number,"otros":number,"total":number}}
Importes en POSITIVO y solo numéricos (sin $ ni separadores de miles). "total" = suma de todos los cargos del banco.` });
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST", headers: { "content-type": "application/json", "x-api-key": cfg.api_key, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model, max_tokens: 8000, messages: [{ role: "user", content }] }) });
      const dr = await r.json();
      if (dr.type === "error") return send(res, 200, { error: dr.error?.message || "Error de la IA" });
      const txt = (dr.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
      const mm = txt.match(/\{[\s\S]*\}/);
      if (!mm) return send(res, 200, { error: "No se pudo leer el extracto." });
      let parsed; try { parsed = JSON.parse(mm[0]); } catch { return send(res, 200, { error: "No se pudo interpretar el extracto." }); }
      return send(res, 200, { ok: true, ...parsed });
    } catch (e) { return send(res, 502, { error: e.message }); }
  }
  // ---- Informes / analítica (ranking clientes, recompra, top productos, Curva ABC) — solo dueño ----
  if (u.pathname === "/api/admin/informes") {
    if (!(await esDueno(req))) return send(res, 403, { error: "Solo el dueño" });
    const meses = Math.min(24, Math.max(1, Number(u.searchParams.get("meses")) || 3));
    const desde = new Date(Date.now() - meses * 30 * 24 * 3600 * 1000);
    try {
      const allOrders = await getPedidos({ status: ["completed", "processing"], limit: 4000 });
      const orders = allOrders.filter((o) => new Date(o.fecha_creado) >= desde);
      const clientes = {}, prods = {};
      for (const o of orders) {
        const email = (o.cliente_email || "").toLowerCase();
        const billing = o.billing || {};
        const nombre = `${billing.first_name || ""} ${billing.last_name || ""}`.trim();
        if (email) { const c = clientes[email] || (clientes[email] = { nombre, email, total: 0, pedidos: 0, prod: {} }); c.total += Number(o.total) || 0; c.pedidos++; if (nombre && !c.nombre) c.nombre = nombre; }
        for (const li of (o.items || [])) {
          const key = String(li.product_id || li.nombre);
          const p = prods[key] || (prods[key] = { nombre: li.nombre, sku: li.sku || "", product_id: li.product_id, unidades: 0, importe: 0, pedidos: new Set(), clientes: new Set() });
          p.unidades += Number(li.cantidad) || 0; p.importe += Number(li.total) || 0; p.pedidos.add(o.id); if (email) p.clientes.add(email);
          if (email && clientes[email]) { const cp = clientes[email].prod[key] || (clientes[email].prod[key] = { nombre: li.nombre, qty: 0, pedidos: new Set() }); cp.qty += Number(li.cantidad) || 0; cp.pedidos.add(o.id); }
        }
      }
      const cat = await getCatalogo();
      const catById = new Map((cat.productos || []).map((p) => [p.id, p]));
      const esDescartable = (p) => { const c = catById.get(p.product_id); const cats = ((c && c.categorias) || []).join(" ").toLowerCase(); const n = (p.nombre || "").toLowerCase(); return /descartab/.test(cats) || /(vaso|servilleta|babero|eyector|rollo de algod|gasa|barbijo|cofia|campo descart|film|bolsa|guantes? )/.test(n); };
      const rankingClientes = Object.values(clientes).sort((x, y) => y.total - x.total).slice(0, 40).map((c) => {
        const recompro = Object.values(c.prod).filter((p) => p.pedidos.size > 1).sort((a2, b2) => b2.pedidos.size - a2.pedidos.size).slice(0, 5).map((p) => ({ nombre: p.nombre, veces: p.pedidos.size, unidades: p.qty }));
        return { nombre: c.nombre || c.email, email: c.email, total: Math.round(c.total), pedidos: c.pedidos, recompro };
      });
      const recompra = Object.values(prods).filter((p) => p.pedidos.size > 1).map((p) => ({ nombre: p.nombre, sku: p.sku, unidades: p.unidades, veces: p.pedidos.size, clientes: p.clientes.size })).sort((x, y) => y.veces - x.veces).slice(0, 60);
      const topProductos = Object.values(prods).filter((p) => !esDescartable(p)).map((p) => ({ nombre: p.nombre, sku: p.sku, unidades: p.unidades, importe: Math.round(p.importe), clientes: p.clientes.size, product_id: p.product_id })).sort((x, y) => y.unidades - x.unidades).slice(0, 40);
      for (const tp of topProductos) {
        const key = String(tp.product_id || tp.nombre);
        tp.topClientes = Object.values(clientes).map((c) => ({ nombre: c.nombre || c.email, qty: (c.prod[key] || {}).qty || 0 })).filter((x) => x.qty > 0).sort((a2, b2) => b2.qty - a2.qty).slice(0, 3);
      }
      const prodArr = Object.values(prods).map((p) => ({ nombre: p.nombre, sku: p.sku, key: (p.sku || "") + "|" + p.nombre, unidades: p.unidades, importe: Math.round(p.importe) }));
      function abc(items, campo) {
        const arr = items.slice().sort((x, y) => y[campo] - x[campo]);
        const tot = arr.reduce((s, x) => s + x[campo], 0) || 1; let acum = 0;
        return arr.map((x) => { acum += x[campo]; const pct = acum / tot * 100; return { ...x, acum_pct: Math.round(pct * 10) / 10, clase: pct <= 80 ? "A" : pct <= 95 ? "B" : "C" }; });
      }
      const abcImporte = abc(prodArr, "importe"), abcCantidad = abc(prodArr, "unidades");
      const ci = new Map(abcImporte.map((x) => [x.key, x.clase])), cc = new Map(abcCantidad.map((x) => [x.key, x.clase]));
      const cruce = { A: { A: 0, B: 0, C: 0 }, B: { A: 0, B: 0, C: 0 }, C: { A: 0, B: 0, C: 0 } };
      for (const p of prodArr) { const i = ci.get(p.key), c = cc.get(p.key); if (i && c) cruce[i][c]++; }
      const resumenABC = (arr) => ({ A: arr.filter((x) => x.clase === "A").length, B: arr.filter((x) => x.clase === "B").length, C: arr.filter((x) => x.clase === "C").length });
      const vd = await readJson(VENC_PATH, { items: [] });
      const porVencer = (vd.items || []).map((it) => ({ nombre: it.nombre || it.codigo, fecha: it.fecha, dias: Math.ceil((new Date(it.fecha) - new Date()) / 86400000), cantidad: it.cantidad })).filter((x) => x.dias <= 90).sort((a2, b2) => a2.dias - b2.dias).slice(0, 50);
      return send(res, 200, { meses, pedidos: orders.length, productos: prodArr.length, rankingClientes, recompra, topProductos, abcImporte: abcImporte.slice(0, 300), abcCantidad: abcCantidad.slice(0, 300), cruce, resumenImporte: resumenABC(abcImporte), resumenCantidad: resumenABC(abcCantidad), porVencer });
    } catch (e) { return send(res, 500, { error: e.message }); }
  }
  // ---- Punto de equilibrio mensual (solo dueño) ----
  if (u.pathname === "/api/admin/equilibrio" && req.method === "GET") {
    if (!(await esDueno(req))) return send(res, 403, { error: "Solo el dueño" });
    const mes = (u.searchParams.get("mes") || "").slice(0, 7);
    if (!mes) return send(res, 400, { error: "Falta el mes" });
    return send(res, 200, await FIN.getEquilibrio(mes));
  }
  if (u.pathname === "/api/admin/equilibrio" && req.method === "POST") {
    if (!(await esDueno(req))) return send(res, 403, { error: "Solo el dueño" });
    const b = await readBody(req);
    if (!b.mes) return send(res, 400, { error: "Falta el mes" });
    return send(res, 200, await FIN.setEquilibrio(b.mes.slice(0, 7), b));
  }
  // ---- Costos por producto + utilidad (solo dueño) ----
  if (u.pathname === "/api/admin/costos" && req.method === "GET") {
    if (!(await esDueno(req))) return send(res, 403, { error: "Solo el dueño" });
    const cat = await getCatalogo();
    const costos = await FIN.getCostos();
    const prodprov = await FIN.getProvProd();
    const finData = await FIN.todo();
    const provName = Object.fromEntries((finData.proveedores || []).map((p) => [String(p.id), p.nombre]));
    const provIva = Object.fromEntries((finData.proveedores || []).map((p) => [String(p.id), Number(p.iva)]));
    const provForma = Object.fromEntries((finData.proveedores || []).map((p) => [String(p.id), p.forma || ""]));
    const venc = await readJson(VENC_PATH, { items: [] });
    const vencFicha = {}; // vencimiento "de ficha" por producto/variación (la editable desde la grilla)
    for (const it of (venc.items || [])) if (it.origen === "ficha" && it.productId != null) vencFicha[String(it.variationId || it.productId)] = it.fecha;
    const todos = u.searchParams.get("todos") === "1"; // todos=1 incluye también los sin stock (para fijar precios ML)
    const productos = [];
    for (const p of (cat.productos || [])) {
      if (!(todos || (p.stock_status === "instock" && p.stock !== 0))) continue;
      const provKey = String(prodprov[p.id]);
      const proveedor = provName[provKey] || "";
      const ivaProv = (prodprov[p.id] != null && provIva[provKey] != null && !isNaN(provIva[provKey])) ? provIva[provKey] : 21;
      const formaProv = provForma[provKey] || "";
      // una fila por producto simple, o una por cada variación (cada variación tiene su costo/precio propio)
      const fila = (id, variationId, nombre, precioRaw) => {
        const precio = Number(precioRaw) || 0, costo = Number(costos[id]) || 0;
        const utilidad = costo > 0 ? precio - costo : null;
        return { id, productId: p.id, variationId: variationId || null, nombre, marca: p.marca || "", proveedor, ivaProv, formaProv, precio, costo, utilidad, margen: (costo > 0 && precio > 0) ? Math.round((utilidad / precio) * 100) : null, vencimiento: vencFicha[String(id)] || "" };
      };
      if ((p.variaciones || []).length) {
        for (const v of p.variaciones) productos.push(fila(v.id, v.id, `${p.nombre} — ${v.label || ("#" + v.id)}`, v.precio));
      } else {
        productos.push(fila(p.id, null, p.nombre, p.precio));
      }
    }
    return send(res, 200, { productos });
  }
  if (u.pathname === "/api/admin/costos" && req.method === "POST") {
    const { cambios } = await readBody(req);
    return send(res, 200, await FIN.setCostos(cambios || {}));
  }
  if (u.pathname === "/api/admin/prov-prod-bulk" && req.method === "POST") {
    if (!(await esDueno(req))) return send(res, 403, { error: "Solo el dueño" });
    const { mapa } = await readBody(req);
    return send(res, 200, await FIN.setProvProdBulk(mapa || {}));
  }
  // ---- WhatsApp por Twilio: estado y envío (staff). Gateado por credenciales TWILIO_* ----
  if (u.pathname === "/api/admin/wa/estado") {
    if (!(await esStaff(req))) return send(res, 401, { error: "No autorizado" });
    return send(res, 200, { configurado: TWA.configurado() });
  }
  if (u.pathname === "/api/admin/wa/enviar" && req.method === "POST") {
    if (!(await esStaff(req))) return send(res, 401, { error: "No autorizado" });
    const { to, body, contentSid, contentVariables } = await readBody(req);
    if (!to || (!body && !contentSid)) return send(res, 400, { error: "Faltan datos (to + body o plantilla)" });
    return send(res, 200, await TWA.enviar({ to, body, contentSid, contentVariables }));
  }
  // ---- Pagar varias compras del mismo proveedor con cheques (emite los cheques en cartera y marca las compras pagadas) ----
  if (u.pathname === "/api/admin/compras/pagar-cheques" && req.method === "POST") {
    if (!(await esDueno(req))) return send(res, 403, { error: "Solo el dueño" });
    const { compraIds, proveedor, cuit, cheques } = await readBody(req);
    if (!Array.isArray(compraIds) || !compraIds.length || !Array.isArray(cheques) || !cheques.length) return send(res, 400, { error: "Faltan datos" });
    // Crea los cheques EMITIDOS en cartera, SIN número (se completa al emitirlos). El egreso del banco lo harán al cobrarse.
    for (const ch of cheques) {
      await FIN.agregar("cheques", { tipo: "emitido", estado: "en cartera", numero: "", tercero: proveedor || "", cuit: cuit || "", monto: Math.round(Number(ch.monto) || 0), vencimiento: (ch.fecha || ch.vencimiento || "").slice(0, 10), fecha_emision: new Date().toISOString().slice(0, 10), nota: `Pago de ${compraIds.length} factura(s) · ${proveedor || ""}` });
    }
    // Marca las compras como pagadas SIN impactar la caja (la plata sale cuando se cobran los cheques, no ahora)
    for (const id of compraIds) { try { await FIN.actualizar("compras", id, { estado: "pagada", sin_caja: true }); } catch {} }
    return send(res, 200, { ok: true, cheques: cheques.length, compras: compraIds.length });
  }

  // ---- Estadísticas por mes (pedidos/día y facturación/día) — solo dueño ----
  if (u.pathname === "/api/admin/estadisticas") {
    if (!(await esDueno(req))) return send(res, 403, { error: "Solo el dueño" });
    const mes = u.searchParams.get("mes") || "";
    const [y, m] = mes.split("-").map(Number);
    if (!y || !m || m < 1 || m > 12) return send(res, 400, { error: "Mes inválido (YYYY-MM)" });
    const desde = `${y}-${String(m).padStart(2, "0")}-01`;
    const ndias = new Date(y, m, 0).getDate();
    const hasta = `${y}-${String(m).padStart(2, "0")}-${String(ndias).padStart(2, "0")}`;
    const ventas = new Set(["processing", "completed", "on-hold"]);
    const porDia = {};
    try {
      const arr = await getPedidos({ desde, hasta, limit: 5000 });
      for (const o of arr) {
        if (!ventas.has(o.status)) continue;
        const dia = (o.fecha_creado || "").slice(0, 10);
        if (!porDia[dia]) porDia[dia] = { pedidos: 0, facturado: 0 };
        porDia[dia].pedidos++; porDia[dia].facturado += Number(o.total) || 0;
      }
    } catch (e) { console.log("[estadisticas]", e.message); return send(res, 502, { error: "No se pudieron leer los pedidos" }); }
    const datos = [];
    for (let d = 1; d <= ndias; d++) {
      const key = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      datos.push({ dia: d, pedidos: (porDia[key] && porDia[key].pedidos) || 0, facturado: Math.round((porDia[key] && porDia[key].facturado) || 0) });
    }
    const total_pedidos = datos.reduce((s, x) => s + x.pedidos, 0);
    const total_facturado = datos.reduce((s, x) => s + x.facturado, 0);
    return send(res, 200, { mes, datos, total_pedidos, total_facturado, ticket: total_pedidos ? Math.round(total_facturado / total_pedidos) : 0 });
  }

  // ---- Ajustes del negocio (staff) ----
  if (u.pathname === "/api/admin/ajustes" && req.method === "GET") {
    return send(res, 200, await readJson(AJUSTES_PATH, AJUSTES_DEFAULT));
  }
  if (u.pathname === "/api/admin/ajustes" && req.method === "POST") {
    const body = await readBody(req);
    const actual = await readJson(AJUSTES_PATH, AJUSTES_DEFAULT);
    const num = (v, def, max = 1e12) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.min(n, max) : def; };
    const aj = {
      ...actual,
      recargo_otros: num(body.recargo_otros, actual.recargo_otros, 100),
      envio_tuc_fijo: num(body.envio_tuc_fijo, actual.envio_tuc_fijo || 0),
      envio_tuc_gratis_desde: num(body.envio_tuc_gratis_desde, actual.envio_tuc_gratis_desde || 0),
      venc_dias_aviso: Math.max(1, num(body.venc_dias_aviso, actual.venc_dias_aviso || 60)),
      afip: body.afip ? { ...(actual.afip || AJUSTES_DEFAULT.afip), ...body.afip } : (actual.afip || AJUSTES_DEFAULT.afip),
    };
    await writeFile(AJUSTES_PATH, JSON.stringify(aj, null, 2));
    return send(res, 200, { ok: true, ajustes: aj });
  }
  // ---- Usuarios (staff): listar ----
  if (u.pathname === "/api/admin/usuarios") {
    const d = await AUTH.leerUsuarios();
    return send(res, 200, { total: d.usuarios.length, usuarios: d.usuarios.slice(0, 1000) });
  }

  // ---- Pedidos: lista (staff) ----
  if (u.pathname === "/api/admin/pedidos") {
    const estado = u.searchParams.get("estado") || "any";
    const page = Number(u.searchParams.get("page") || "1");
    const q = (u.searchParams.get("q") || "").trim();
    const desde = u.searchParams.get("desde") || "";
    const hasta = u.searchParams.get("hasta") || "";
    try {
      const todos = await getPedidos({ status: estado === "any" ? null : [estado], q: q || null, desde: desde || null, hasta: hasta || null, limit: 1000 });
      const local = await readJson(PEDIDOS_PATH, { preparados: {} });
      const PER_PAGE = 20;
      const start = (page - 1) * PER_PAGE;
      const arr = todos.slice(start, start + PER_PAGE);
      const totalPaginas = Math.max(1, Math.ceil(todos.length / PER_PAGE));
      const pedidos = arr.map((p) => ({
        id: p.id, number: p.id, status: p.status, date_created: p.fecha_creado, total: p.total,
        cliente: `${(p.billing?.first_name || "")} ${(p.billing?.last_name || "")}`.trim() || p.cliente_email || "—",
        items: (p.items || []).reduce((n, li) => n + (Number(li.cantidad) || 0), 0),
        pago: p.metodo_pago_titulo || "",
        preparado: !!(local.preparados || {})[p.id],
      }));
      return send(res, 200, { pedidos, page, totalPaginas });
    } catch (e) { return send(res, 500, { error: "No se pudieron traer los pedidos: " + (e.message || e) }); }
  }

  // ---- Pedido: detalle con ubicaciones (lista de pickeo) ----
  if (u.pathname === "/api/admin/pedido") {
    const id = u.searchParams.get("id");
    if (!id) return send(res, 400, { error: "Faltan datos" });
    try {
      const ped = await getPedido(Number(id));
      if (!ped) return send(res, 404, { error: "Pedido no encontrado" });
      const [muebles, ubic, local] = await Promise.all([
        readJson(MUEBLES_PATH, { muebles: [] }), readJson(UBIC_PATH, { asignaciones: [] }), readJson(PEDIDOS_PATH, { preparados: {} }),
      ]);
      const slotIndex = new Map();
      const ultimaSlots = new Set();
      for (const m of muebles.muebles || []) { const multi = (m.secciones || []).length > 1; for (const sec of m.secciones) for (const sl of sec.slots) { slotIndex.set(sl.id, { label: `${m.nombre} · ${multi ? sec.nombre + " · " : ""}${sl.label}`, rol: m.rol || "guardado" }); if (m.id === "deposito-reposicion" || /vidrio\s+superior/i.test(sl.label || "")) ultimaSlots.add(sl.id); } }
      const rolRank = { guardado: 0, exhibicion: 1, deposito: 2 };
      const ubicDe = (pid, vid) => {
        const arr = (ubic.asignaciones || [])
          .filter((x) => x.productId === pid && (vid ? ((x.variationId || null) === vid || x.variationId == null) : true))
          .map((x) => { const m = slotIndex.get(x.slotId) || { label: x.slotId, rol: "guardado" }; return { slotId: x.slotId, label: m.label, rol: m.rol, cantidad: x.cantidad != null ? x.cantidad : null, ultima: ultimaSlots.has(x.slotId) }; });
        if (arr.length) {
          const ranked = [...arr].sort((a, b) => { const aHay = (a.cantidad == null || a.cantidad > 0) ? 0 : 1, bHay = (b.cantidad == null || b.cantidad > 0) ? 0 : 1; if (aHay !== bHay) return aHay - bHay; const aUlt = a.ultima ? 1 : 0, bUlt = b.ultima ? 1 : 0; if (aUlt !== bUlt) return aUlt - bUlt; if (rolRank[a.rol] !== rolRank[b.rol]) return rolRank[a.rol] - rolRank[b.rol]; return (b.cantidad || 0) - (a.cantidad || 0); });
          const best = ranked[0];
          for (const it of arr) it.recomendado = it.slotId === best.slotId;
        }
        return arr;
      };
      const items = (ped.items || []).map((li) => ({
        line_item_id: li.id, product_id: li.product_id, variation_id: li.variation_id || null,
        nombre: li.nombre, sku: li.sku, cantidad: li.cantidad, total: li.total,
        precio_unit: Math.round(Number(li.precio) || 0),
        ubicaciones: ubicDe(li.product_id, li.variation_id || null),
      }));
      const billing = ped.billing || {};
      const shipping = ped.shipping || {};
      const emailPed = (ped.cliente_email || "").toLowerCase();
      let direccion = [shipping.address_1, shipping.city, shipping.state].filter(Boolean).join(", ") || [billing.address_1, billing.city, billing.state].filter(Boolean).join(", ");
      let telefono = billing.phone || "";
      if ((!direccion || !telefono) && emailPed) {
        try { const us = await AUTH.usuarioDe(emailPed); if (us) { if (!telefono && us.telefono) telefono = us.telefono; const e = us.entrega || {}; if (!direccion && (e.calle || e.ciudad)) direccion = [e.calle, e.ciudad, e.provincia, e.cp].filter(Boolean).join(", "); } } catch {}
      }
      let factura = null;
      try { const fd = await AFIP.leerFacturas(); const fx = (fd.facturas || []).find((x) => String(x.pedido) === String(ped.id)); if (fx) factura = { id: fx.id, numero: `${String(fx.pv).padStart(4, "0")}-${String(fx.numero).padStart(8, "0")}`, cae: fx.cae }; } catch {}
      const shipTuc = !!(shipping.address_1 && /tucum|^t$/i.test((shipping.state || "") + " " + (shipping.city || "")));
      const reparto = !!(local.reparto || {})[String(ped.id)] || (["processing", "on-hold"].includes(ped.status) && shipTuc);
      const shippingLines = Array.isArray(ped.shipping_lines) ? ped.shipping_lines : [];
      return send(res, 200, {
        id: ped.id, number: ped.id, status: ped.status, date_created: ped.fecha_creado, total: ped.total,
        pago: ped.metodo_pago_titulo, envio: shippingLines.map((s) => s.method_title).join(", "),
        envio_costo: Math.round(Number(ped.shipping_total) || 0), envio_titulo: shippingLines[0] ? shippingLines[0].method_title : "",
        cliente: { nombre: `${billing.first_name || ""} ${billing.last_name || ""}`.trim(), email: ped.cliente_email, telefono, direccion },
        items, preparado: !!(local.preparados || {})[id], factura, reparto,
        nota: ped.notas || "",
        cupones: Array.isArray(ped.coupon_lines) ? ped.coupon_lines.map((c) => ({ code: c.code })) : [],
        descuento_total: Math.round(Number(ped.descuento_total) || 0),
      });
    } catch (e) { return send(res, 500, { error: "Error: " + (e.message || e) }); }
  }

  // ---- Marcar / desmarcar un pedido para reparto (cadete) ----
  if (u.pathname === "/api/admin/pedido/reparto" && req.method === "POST") {
    const { id, reparto } = await readBody(req);
    if (!id) return send(res, 400, { error: "Falta el pedido" });
    try {
      if (reparto) {
        await updatePedido(Number(id), { status: "processing" });
        await marcarReparto(id, true);
        return send(res, 200, { ok: true, reparto: true });
      }
      await updatePedido(Number(id), { status: "completed" });
      await marcarReparto(id, false);
      return send(res, 200, { ok: true, reparto: false });
    } catch (e) { return send(res, 500, { error: e.message }); }
  }
  // ---- Editar un pedido: actualizar campos (nota, envío, total_final) ----
  if (u.pathname === "/api/admin/pedido/editar" && req.method === "POST") {
    const { id, envio, total_final, nota } = await readBody(req);
    if (!id) return send(res, 400, { error: "Falta el pedido" });
    try {
      const ped = await getPedido(Number(id));
      if (!ped) return send(res, 404, { error: "Pedido no encontrado" });
      const cambios = {};
      if (nota != null) cambios.notas = nota;
      if (envio != null && envio !== "") {
        const costo = Math.max(0, Math.round(Number(envio) || 0));
        const sl = Array.isArray(ped.shipping_lines) ? [...ped.shipping_lines] : [];
        if (sl[0]) sl[0] = { ...sl[0], total: String(costo) }; else sl.push({ method_id: "flat_rate", method_title: "Envío", total: String(costo) });
        cambios.shipping_lines = sl;
        cambios.shipping_total = costo;
        cambios.total = (Number(ped.subtotal) || 0) + costo + (Number(ped.descuento_total) || 0) * -1;
      }
      if (total_final != null && total_final !== "") {
        if (!(await esDueno(req))) return send(res, 403, { error: "Solo el dueño puede modificar el total" });
        cambios.total = Math.round(Number(total_final));
      }
      if (!Object.keys(cambios).length) return send(res, 400, { error: "No hay cambios para guardar" });
      const o = await updatePedido(Number(id), cambios);
      return send(res, 200, { ok: true, total: o.total });
    } catch (e) { return send(res, 500, { error: "Error: " + (e.message || e) }); }
  }

  // ---- MercadoLibre: OAuth + estado (staff) ----
  if (u.pathname === "/api/ml/estado") {
    return send(res, 200, await ML.estado());
  }
  if (u.pathname === "/api/ml/conectar") {
    const url = ML.urlAutorizar();
    if (!url) return send(res, 400, { error: "Faltan ML_CLIENT_ID y ML_REDIRECT en las variables" });
    res.writeHead(302, { Location: url }); return res.end();
  }
  if (u.pathname === "/api/ml/callback") {
    const code = u.searchParams.get("code");
    if (!code) { res.writeHead(302, { Location: "/admin#ml" }); return res.end(); }
    const r = await ML.intercambiarCodigo(code);
    res.writeHead(302, { Location: r.ok ? "/admin#ml-ok" : "/admin#ml-error" }); return res.end();
  }
  if (u.pathname === "/api/ml/productos") {
    const cat = await getCatalogo();
    return send(res, 200, { productos: await ML.listaGestor(cat.productos || []) });
  }
  if (u.pathname === "/api/ml/seleccion" && req.method === "POST") {
    const { cambios } = await readBody(req);
    return send(res, 200, await ML.guardarSeleccion(cambios || []));
  }
  if (u.pathname === "/api/ml/publicar" && req.method === "POST") {
    const cat = await getCatalogo();
    return send(res, 200, await ML.publicarCatalogo(cat.productos || [], { limit: 20 }));
  }
  if (u.pathname === "/api/ml/borrar" && req.method === "POST") {
    const { id } = await readBody(req);
    return send(res, 200, await ML.despublicar(id));
  }
  if (u.pathname === "/api/ml/sincronizar" && req.method === "POST") {
    const cat = await getCatalogo();
    return send(res, 200, await ML.sincronizarStock(cat.productos || []));
  }

  // ---- Marcar pedido preparado (local, no toca WooCommerce) ----
  if (u.pathname === "/api/admin/pedido-preparado" && req.method === "POST") {
    const { id, preparado } = await readBody(req);
    const email = AUTH.leerSesion(req.headers.cookie) || "staff";
    const d = await readJson(PEDIDOS_PATH, { preparados: {} });
    if (!d.preparados) d.preparados = {};
    if (preparado) d.preparados[id] = { por: email, fecha: new Date().toISOString() };
    else delete d.preparados[id];
    await writeFile(PEDIDOS_PATH, JSON.stringify(d, null, 2));
    return send(res, 200, { ok: true });
  }
  // ---- Reparto del día: envíos a domicilio en Tucumán a entregar (staff) ----
  if (u.pathname === "/api/admin/reparto") {
    try {
      const arr = await getPedidos({ limit: 200 });
      const local = await readJson(PEDIDOS_PATH, { preparados: {}, reparto: {} });
      const marcados = local.reparto || {};
      const esTuc = (s) => s && s.address_1 && /tucum|^t$/i.test(((s.state || "") + " " + (s.city || "")).trim());
      const lista = arr.filter((o) =>
        marcados[String(o.id)] ||
        (esTuc(o.shipping) && ["processing", "on-hold"].includes(o.status))
      ).map((o) => {
        const billing = o.billing || {}, shipping = o.shipping || {};
        return {
          id: o.id, number: o.id, status: o.status, total: Math.round(Number(o.total) || 0),
          cliente: `${billing.first_name || ""} ${billing.last_name || ""}`.trim(),
          telefono: billing.phone || "",
          direccion: [shipping.address_1, shipping.city].filter(Boolean).join(", ") || [billing.address_1, billing.city].filter(Boolean).join(", "),
          items: (o.items || []).reduce((n, li) => n + (Number(li.cantidad) || 0), 0),
          fecha: o.fecha_creado,
          marcado: !!marcados[String(o.id)],
          entregado: o.status === "completed",
          preparado: !!(local.preparados || {})[String(o.id)],
        };
      });
      // Mandados manuales (trámites del cadete que no son pedidos)
      for (const m of (local.mandados || [])) lista.push({
        id: m.id, number: "Mandado", mandado: true, cliente: m.detalle || "Mandado",
        direccion: m.direccion || "", telefono: m.telefono || "", items: 0, total: 0,
        fecha: m.fecha, marcado: true, entregado: !!m.entregado, preparado: false,
      });
      // pendientes primero, después los entregados; dentro de cada grupo, los más viejos primero
      lista.sort((x, y) => (x.entregado ? 1 : 0) - (y.entregado ? 1 : 0) || String(x.fecha).localeCompare(String(y.fecha)));
      return send(res, 200, { lista });
    } catch (e) { return send(res, 500, { error: e.message }); }
  }
  // ---- Mandados del cadete (trámites que no son pedidos): agregar / entregar / borrar ----
  if (u.pathname === "/api/admin/reparto/mandado" && req.method === "POST") {
    if (!(await esStaff(req))) return send(res, 401, { error: "No autorizado" });
    const b = await readBody(req);
    const detalle = String(b.detalle || "").trim().slice(0, 200);
    if (!detalle) return send(res, 400, { error: "Poné qué tiene que hacer el cadete." });
    const d = await readJson(PEDIDOS_PATH, { preparados: {}, reparto: {} });
    if (!Array.isArray(d.mandados)) d.mandados = [];
    const reg = { id: "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), detalle, direccion: String(b.direccion || "").trim().slice(0, 200), telefono: String(b.telefono || "").trim().slice(0, 40), fecha: new Date().toISOString(), entregado: false };
    d.mandados.unshift(reg);
    await writeFile(PEDIDOS_PATH, JSON.stringify(d, null, 2));
    return send(res, 200, { ok: true, mandado: reg });
  }
  if ((u.pathname === "/api/admin/reparto/mandado/entregar" || u.pathname === "/api/admin/reparto/mandado/borrar") && req.method === "POST") {
    if (!(await esStaff(req))) return send(res, 401, { error: "No autorizado" });
    const { id } = await readBody(req);
    const d = await readJson(PEDIDOS_PATH, { preparados: {}, reparto: {} });
    if (!Array.isArray(d.mandados)) d.mandados = [];
    if (u.pathname.endsWith("/borrar")) d.mandados = d.mandados.filter((x) => x.id !== id);
    else { const m = d.mandados.find((x) => x.id === id); if (!m) return send(res, 404, { error: "No encontrado" }); m.entregado = true; }
    await writeFile(PEDIDOS_PATH, JSON.stringify(d, null, 2));
    return send(res, 200, { ok: true });
  }
  // ---- Cambiar estado de un pedido (staff) ----
  if (u.pathname === "/api/admin/pedido-estado" && req.method === "POST") {
    const { id, estado } = await readBody(req);
    if (!id || !estado) return send(res, 400, { error: "Faltan datos" });
    const estadosValidos = ["pending", "processing", "on-hold", "completed", "cancelled", "refunded"];
    if (!estadosValidos.includes(estado)) return send(res, 400, { error: "Estado inválido" });
    try {
      const o = await updatePedidoStatus(Number(id), estado);
      if (!o) return send(res, 404, { error: "Pedido no encontrado" });
      let descontado = [], restaurado = [];
      if (estado === "completed") {
        try {
          const dp = await readJson(PEDIDOS_PATH, { preparados: {} });
          if (!dp.ubicDesc) dp.ubicDesc = {};
          const key = String(id), desc = dp.ubicDesc[key] || [];
          const yaPorItem = new Map();
          for (const d of desc) { const k = d.productId + ":" + (d.variationId || ""); yaPorItem.set(k, (yaPorItem.get(k) || 0) + (Number(d.cant) || 0)); }
          const [ubic, muebles] = await Promise.all([readJson(UBIC_PATH, { asignaciones: [] }), readJson(MUEBLES_PATH, { muebles: [] })]);
          const plan = (dp.ubicPlan || {})[key] || {};
          const combos = await readJson(COMBOS_PATH, {});
          const comboPick = (dp.comboPick || {})[key] || {};
          let cambios = false;
          for (const li of (o.items || [])) {
            const pid = li.product_id, vid = li.variation_id || null, qty = Number(li.cantidad) || 0;
            if (combos[String(pid)]) {
              if (desc.some((d) => String(d.combo) === String(pid))) continue;
              for (const c of (comboPick[String(pid)] || [])) {
                if (!c.slotId || !c.cant) continue;
                const cv = c.variationId || null;
                const aa = ubic.asignaciones.find((x) => x.productId === c.productId && (x.variationId || null) === cv && x.slotId === c.slotId);
                if (aa) aa.cantidad = Math.max(0, (Number(aa.cantidad) || 0) - c.cant); else ubic.asignaciones.push({ productId: c.productId, variationId: cv, slotId: c.slotId, nota: "", cantidad: 0 });
                desc.push({ productId: c.productId, variationId: cv, slotId: c.slotId, cant: c.cant, combo: pid });
                descontado.push({ productId: c.productId, variationId: cv, slotId: c.slotId, cant: c.cant, combo: pid });
                await ajustarStockDB(c.productId, cv, -c.cant);
                cambios = true;
              }
              continue;
            }
            const k = pid + ":" + (vid || ""), falta = qty - (yaPorItem.get(k) || 0);
            if (falta <= 0) continue;
            if (plan[k]) {
              const aa = ubic.asignaciones.find((x) => x.productId === pid && (x.variationId || null) === vid && x.slotId === plan[k]);
              if (aa) aa.cantidad = Math.max(0, (Number(aa.cantidad) || 0) - falta); else ubic.asignaciones.push({ productId: pid, variationId: vid, slotId: plan[k], nota: "", cantidad: 0 });
              desc.push({ productId: pid, variationId: vid, slotId: plan[k], cant: falta }); descontado.push({ productId: pid, variationId: vid, slotId: plan[k], cant: falta }); cambios = true;
            } else {
              for (const t of descontarUbic(ubic, muebles, pid, vid, falta)) { desc.push({ productId: pid, variationId: vid, slotId: t.slotId, cant: t.cant }); descontado.push({ productId: pid, variationId: vid, slotId: t.slotId, cant: t.cant }); cambios = true; }
            }
          }
          if (cambios) { dp.ubicDesc[key] = desc; if (dp.ubicPlan) delete dp.ubicPlan[key]; await writeFile(UBIC_PATH, JSON.stringify(ubic, null, 2)); await writeFile(PEDIDOS_PATH, JSON.stringify(dp, null, 2)); }
        } catch (e) { console.log("[completar ubic]", e.message); }
        try {
          const titulo = (o.metodo_pago_titulo || o.metodo_pago || "").toLowerCase();
          if (!/corriente|ctacte/.test(titulo)) {
            const cuenta = /efectivo/.test(titulo) ? "efectivo" : /mercado|\bmp\b/.test(titulo) ? "mp" : /nave/.test(titulo) ? "nave" : "banco";
            await ingresoVentaCaja(o, cuenta);
          }
        } catch (e) { console.log("[completar caja]", e.message); }
      }
      if (estado === "cancelled") {
        try { await FIN.borrarMovPorRef("venta:" + id); } catch (e) { console.log("[cancel caja]", e.message); }
        try {
          const dp = await readJson(PEDIDOS_PATH, { preparados: {} });
          const desc = (dp.ubicDesc || {})[String(id)];
          if (desc && desc.length) {
            restaurado = desc.map((d) => ({ ...d }));
            const ubic = await readJson(UBIC_PATH, { asignaciones: [] });
            if (restaurarUbic(ubic, desc)) await writeFile(UBIC_PATH, JSON.stringify(ubic, null, 2));
            for (const d of desc) if (d.combo) await ajustarStockDB(d.productId, d.variationId || null, Number(d.cant) || 0).catch(() => {});
            delete dp.ubicDesc[String(id)];
            if (dp.comboPick) delete dp.comboPick[String(id)];
            await writeFile(PEDIDOS_PATH, JSON.stringify(dp, null, 2));
          }
        } catch (e) { console.log("[cancel ubic]", e.message); }
      }
      return send(res, 200, { ok: true, status: o.status, restaurado, descontado });
    } catch (e) { return send(res, 500, { error: e.message }); }
  }
  // ---- Cambiar la forma de pago de un pedido y reflejarla en la Caja (staff) ----
  if (u.pathname === "/api/admin/pedido/pago" && req.method === "POST") {
    if (!(await esStaff(req))) return send(res, 401, { error: "No autorizado" });
    const { id, pago } = await readBody(req);
    if (!id || !pago) return send(res, 400, { error: "Faltan datos" });
    const titulos = { efectivo: "Efectivo", transferencia: "Transferencia", mp: "Mercado Pago", nave: "Nave" };
    const cuenta = pago === "efectivo" ? "efectivo" : pago === "mp" ? "mp" : pago === "nave" ? "nave" : "banco";
    try {
      const og = await getPedido(Number(id));
      if (!og) return send(res, 404, { error: "Pedido no encontrado" });
      const aj = await readJson(AJUSTES_PATH, AJUSTES_DEFAULT);
      const recargoPct = Number(aj.recargo_otros) || 0;
      const subtotal = Number(og.subtotal) || 0;
      const necesita = (pago === "mp" || pago === "nave") && recargoPct > 0;
      const recargo = necesita ? Math.round(subtotal * recargoPct / 100) : 0;
      const feeLines = necesita ? [{ name: `Recargo ${pago === "nave" ? "Nave" : "Mercado Pago"} (${recargoPct}%)`, total: String(recargo) }] : [];
      const nuevoTotal = subtotal + (Number(og.shipping_total) || 0) + recargo;
      const o2 = await updatePedido(Number(id), { metodo_pago: pago, metodo_pago_titulo: titulos[pago] || pago, fee_lines: feeLines, total: nuevoTotal });
      let caja = 0;
      try { const rc = await FIN.actualizarMovPorRef("venta:" + id, { cuenta, monto: nuevoTotal }); caja = rc.actualizados || 0; } catch {}
      return send(res, 200, { ok: true, caja, total: nuevoTotal, recargo });
    } catch (e) { return send(res, 500, { error: e.message }); }
  }

  // ---- Pedidos del cliente (su cuenta) ----
  if (u.pathname === "/api/cuenta/pedidos") {
    const email = AUTH.leerSesion(req.headers.cookie);
    if (!email) return send(res, 200, { pedidos: [] });
    try {
      const todos = await getPedidos({ email: email.toLowerCase(), limit: 20 });
      const pedidos = todos.map((p) => ({ id: p.id, number: p.id, status: p.status, date_created: p.fecha_creado, total: p.total, line_items: (p.items || []).map((li) => ({ name: li.nombre, quantity: li.cantidad })) }));
      return send(res, 200, { email, pedidos });
    } catch { return send(res, 200, { pedidos: [] }); }
  }
  // ---- Metas / insignias del cliente (gamificación) ----
  if (u.pathname === "/api/cuenta/metas") {
    const email = (AUTH.leerSesion(req.headers.cookie) || "").toLowerCase();
    if (!email) return send(res, 200, { compras: 0, total: 0, insignias: [], proxima: null, premios: 0 });
    try {
      const mios = await getPedidos({ email, status: ["completed", "processing", "on-hold"], limit: 100 });
      const compras = mios.length;
      const total = Math.round(mios.reduce((s, o) => s + (Number(o.total) || 0), 0));
      const NIVELES = [
        { n: 1, icono: "🦷", nombre: "Primera compra" },
        { n: 3, icono: "😁", nombre: "Cliente fiel" },
        { n: 6, icono: "⭐", nombre: "Cliente estrella" },
        { n: 12, icono: "🏆", nombre: "Cliente PRO" },
        { n: 24, icono: "👑", nombre: "Leyenda del Pasaje" },
      ];
      const insignias = NIVELES.map((x) => ({ ...x, lograda: compras >= x.n }));
      const proxima = NIVELES.find((x) => compras < x.n) || null;
      const premios = Math.floor(compras / 5); // 1 premio (10% OFF / obsequio) cada 5 compras
      return send(res, 200, { compras, total, insignias, proxima, premios });
    } catch { return send(res, 200, { compras: 0, total: 0, insignias: [], proxima: null, premios: 0 }); }
  }

  // ---- Paginas ----
  // ---- Favicon (logo) para todas las páginas ----
  if (u.pathname === "/favicon.ico") {
    try { const b = await readFile(join(PUBLIC, "assets/favicon.png")); res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "max-age=86400" }); return res.end(b); }
    catch { return send(res, 404, "", "text/plain"); }
  }
  // Imágenes subidas (fotos de productos cargadas desde el panel)
  if (u.pathname.startsWith("/uploads/")) {
    const f = u.pathname.slice(9).replace(/[^a-zA-Z0-9._-]/g, "");
    try {
      const b = await readFile(join(DATA, "uploads", f));
      const ext = (f.split(".").pop() || "").toLowerCase();
      const ct = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml" }[ext] || "application/octet-stream";
      res.writeHead(200, { "Content-Type": ct, "Cache-Control": "public, max-age=31536000" });
      return res.end(b);
    } catch { return send(res, 404, "", "text/plain"); }
  }
  // ---- SEO: robots.txt (solo indexa en el dominio real, el de test queda fuera de Google) ----
  if (u.pathname === "/robots.txt") {
    const host = req.headers.host || "";
    const esReal = /(^|\.)elpasajedental\.com$/i.test(host);
    const body = esReal
      ? `User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nSitemap: https://${host}/sitemap.xml\n`
      : `User-agent: *\nDisallow: /\n`;
    return send(res, 200, body, "text/plain");
  }
  // ---- SEO: sitemap.xml con home, tienda, categorías y productos ----
  if (u.pathname === "/sitemap.xml") {
    const host = req.headers.host || "elpasajedental.com";
    const b = "https://" + host;
    const cat = await getCatalogo();
    const enStock = (cat.productos || []).filter((p) =>
      (p.stock_status === "instock" && p.stock !== 0) ||
      (p.tipo === "variable" && (p.variaciones || []).some((v) => v.stock_status === "instock" && v.stock !== 0)));
    const cats = [...new Set(enStock.flatMap((p) => p.categorias || []))];
    const urls = [`${b}/`, `${b}/tienda`, `${b}/faq`, `${b}/legales`]
      .concat(cats.map((c) => `${b}/tienda?cat=${encodeURIComponent(c)}`))
      .concat(enStock.map((p) => `${b}/producto/${p.id}`));
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
      urls.map((x) => `  <url><loc>${x.replace(/&/g, "&amp;")}</loc></url>`).join("\n") + `\n</urlset>\n`;
    return send(res, 200, xml, "application/xml");
  }
  // ---- Comprobante imprimible de una factura (CAE + QR de AFIP) ----
  if (u.pathname.startsWith("/factura/")) {
    if (!(await esStaff(req))) { res.writeHead(302, { Location: "/ingresar" }); return res.end(); }
    const id = u.pathname.split("/")[2];
    const d = await AFIP.leerFacturas();
    const f = (d.facturas || []).find((x) => x.id === id);
    if (!f) return send(res, 404, "Factura no encontrada", "text/plain");
    const aj = await readJson(AJUSTES_PATH, AJUSTES_DEFAULT);
    const emis = (aj.afip && aj.afip.emisores) || [{ cuit: "27181849032", razon: "Nancy Maria Zarate" }, { cuit: "20349100860", razon: "Maximiliano Espeche" }];
    const em = emis.find((e) => String(e.cuit) === String(f.cuit)) || { cuit: f.cuit, razon: "" };
    const fIso = (f.fecha || "").replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3");
    const qr = { ver: 1, fecha: fIso, cuit: Number(f.cuit), ptoVta: f.pv, tipoCmp: f.tipo, nroCmp: f.numero, importe: f.importe, moneda: "PES", ctz: 1, tipoDocRec: f.doc_tipo || 99, nroDocRec: Number(f.doc_nro) || 0, tipoCodAut: "E", codAut: Number(f.cae) };
    const qrUrl = "https://www.afip.gob.ar/fe/qr/?p=" + Buffer.from(JSON.stringify(qr)).toString("base64");
    const qrImg = "https://api.qrserver.com/v1/create-qr-code/?size=130x130&data=" + encodeURIComponent(qrUrl);
    const num = `${String(f.pv).padStart(4, "0")}-${String(f.numero).padStart(8, "0")}`;
    const fAr = (f.fecha || "").replace(/(\d{4})(\d{2})(\d{2})/, "$3/$2/$1");
    const docTxt = f.doc_nro && f.doc_nro != 0 ? `${f.doc_tipo === 80 ? "CUIT" : "DNI"} ${f.doc_nro}` : "Consumidor Final";
    const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Factura C ${num}</title>
<style>body{font-family:-apple-system,system-ui,Arial,sans-serif;color:#1f2733;max-width:720px;margin:0 auto;padding:24px}
.cab{display:flex;justify-content:space-between;border:2px solid #1f2733;border-radius:8px;overflow:hidden}
.cab>div{padding:16px 20px;flex:1}.cab .mid{flex:0 0 70px;display:flex;align-items:center;justify-content:center;border-left:1px solid #ccc;border-right:1px solid #ccc;font-size:42px;font-weight:800}
h1{font-size:18px;margin:0 0 4px}.muted{color:#64748b;font-size:13px}.r{text-align:right}
table{width:100%;border-collapse:collapse;margin:18px 0}td,th{padding:8px;border-bottom:1px solid #eee;font-size:14px;text-align:left}
.tot{font-size:22px;font-weight:800;text-align:right;margin:8px 0}
.cae{display:flex;gap:16px;align-items:center;border-top:2px solid #1f2733;padding-top:14px;margin-top:18px}
.btn{background:#DE3667;color:#fff;border:none;padding:10px 18px;border-radius:8px;font-size:14px;font-weight:700;cursor:pointer;margin:14px 0}
.logo{height:52px;display:block;margin:0 auto 16px}
@media print{.btn{display:none}}</style></head><body>
<button class="btn" onclick="window.print()">🖨️ Imprimir / Guardar PDF</button>
<img src="/assets/logo.png" alt="El Pasaje Dental" class="logo">
<div class="cab"><div><h1>${esc(em.razon || "")}</h1><div class="muted">CUIT ${f.cuit} · Monotributo<br>Punto de venta: ${String(f.pv).padStart(4, "0")}</div></div>
<div class="mid">C</div>
<div class="r"><h1>FACTURA</h1><div class="muted">N° ${num}<br>Fecha: ${fAr}<br>Cód. 011</div></div></div>
<p class="muted" style="margin-top:16px"><b>Cliente:</b> ${esc(f.cliente || "Consumidor Final")} · ${docTxt}</p>
<table><thead><tr><th>Detalle</th><th class="r">Importe</th></tr></thead><tbody>
${(f.items && f.items.length ? f.items : [{ nombre: f.cliente ? "Venta" : "Productos/servicios", importe: f.importe }]).map((it) => `<tr><td>${esc(it.nombre || it.concepto || "Item")}</td><td class="r">${"$" + Number(it.importe || it.monto || f.importe).toLocaleString("es-AR")}</td></tr>`).join("")}
</tbody></table>
<div class="tot">Total: $${Number(f.importe).toLocaleString("es-AR")}</div>
<div class="cae"><img src="${qrImg}" alt="QR AFIP" width="120" height="120"><div><b>CAE:</b> ${f.cae}<br><b>Vto. CAE:</b> ${(f.cae_vto || "").replace(/(\d{4})(\d{2})(\d{2})/, "$3/$2/$1")}<br><span class="muted">Comprobante autorizado por AFIP/ARCA</span></div></div>
</body></html>`;
    res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-cache" });
    return res.end(html);
  }
  if (u.pathname === "/pago" || u.pathname.startsWith("/pago/")) {
    return htmlPage(res, "pago.html");
  }
  if (u.pathname === "/tienda" || u.pathname === "/tienda/" || u.pathname === "/producto" || u.pathname.startsWith("/producto/")) {
    const host = req.headers.host || "elpasajedental.com";
    // Página de producto: meta + JSON-LD propios (rich results de Google)
    if (u.pathname.startsWith("/producto/")) {
      const id = decodeURIComponent(u.pathname.split("/")[2] || "");
      const cat = await getCatalogo();
      const p = (cat.productos || []).find((x) => String(x.id) === id || String(x.sku) === id);
      if (p) {
        const limpia = (s) => String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        let descIA = "";
        if (!limpia(p.descripcion) && !limpia(p.descripcion_corta)) { const ov = await readJson(DESC_PATH, { descripciones: {} }); descIA = limpia((ov.descripciones || {})[p.id]); }
        const desc = (limpia(p.descripcion_corta) || limpia(p.descripcion) || descIA || `${p.nombre}. Insumo odontológico con stock real en El Pasaje Dental, Tucumán. Envíos a todo el país.`).slice(0, 165);
        const canonical = `https://${host}/producto/${p.id}`;
        const prodLD = {
          "@context": "https://schema.org", "@type": "Product", name: p.nombre,
          image: p.imagen ? [p.imagen] : undefined, description: desc, sku: String(p.sku || p.id),
          brand: { "@type": "Brand", name: "El Pasaje Dental" },
          category: (p.categorias || []).join(" > ") || undefined,
          offers: {
            "@type": "Offer", url: canonical, priceCurrency: "ARS", price: Math.round(p.precio || 0),
            availability: p.stock_status === "instock" ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
            seller: { "@type": "Organization", name: "El Pasaje Dental" },
          },
        };
        const cat0 = (p.categorias || [])[0];
        const crumbs = [{ "@type": "ListItem", position: 1, name: "Inicio", item: `https://${host}/` }, { "@type": "ListItem", position: 2, name: "Tienda", item: `https://${host}/tienda` }];
        if (cat0) crumbs.push({ "@type": "ListItem", position: 3, name: cat0, item: `https://${host}/tienda?cat=${encodeURIComponent(cat0)}` });
        crumbs.push({ "@type": "ListItem", position: crumbs.length + 1, name: p.nombre, item: canonical });
        const breadcrumbLD = { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: crumbs };
        return htmlPageSEO(res, "tienda.html", { host, title: `${p.nombre} · El Pasaje Dental`, description: desc, image: p.imagen, canonical, jsonld: [prodLD, breadcrumbLD] });
      }
    }
    // Listado / categoría
    const catParam = u.searchParams.get("cat");
    const title = catParam ? `${catParam} · Tienda · El Pasaje Dental` : "Tienda · El Pasaje Dental · Insumos Odontológicos Tucumán";
    const canonical = `https://${host}/tienda${catParam ? "?cat=" + encodeURIComponent(catParam) : ""}`;
    return htmlPageSEO(res, "tienda.html", { host, title, canonical, jsonld: [negocioLD(host)] });
  }
  if (u.pathname === "/ingresar" || u.pathname === "/ingresar/") {
    return htmlPage(res, "ingresar.html");
  }
  if (u.pathname === "/mi-cuenta" || u.pathname === "/mi-cuenta/") {
    return htmlPage(res, "micuenta.html");
  }
  if (u.pathname === "/admin" || u.pathname === "/admin/") {
    return htmlPage(res, "admin.html");
  }
  if (u.pathname === "/legales" || u.pathname === "/legales/") {
    return htmlPage(res, "legales.html");
  }
  // Página móvil para subir fotos/PDF de factura (se abre escaneando el QR del panel)
  if (u.pathname.startsWith("/subir/")) {
    const token = (u.pathname.split("/")[2] || "").replace(/[^a-z0-9]/gi, "");
    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Subir factura · El Pasaje Dental</title><link rel="icon" href="/assets/favicon.png"><style>
body{font-family:-apple-system,system-ui,sans-serif;background:#fff0f7;margin:0;color:#1f2733;min-height:100vh;display:flex;flex-direction:column;align-items:center;padding:24px}
img.logo{height:46px;margin:10px 0 4px} h1{font-size:20px;color:#7a1040;text-align:center;margin:6px 0} p{color:#64748b;font-size:14px;text-align:center;max-width:340px}
label.btn{display:block;width:100%;max-width:360px;background:#DE3667;color:#fff;text-align:center;padding:18px;border-radius:14px;font-size:17px;font-weight:700;margin-top:18px;cursor:pointer}
.lista{width:100%;max-width:360px;margin-top:16px;display:flex;flex-direction:column;gap:8px}
.it{background:#fff;border:1px solid #f5d5e8;border-radius:10px;padding:10px 12px;font-size:14px;display:flex;justify-content:space-between}
.ok{color:#16a34a;font-weight:700;margin-top:14px;text-align:center}
</style></head><body>
<img class="logo" src="/assets/logo.png" alt="El Pasaje Dental">
<h1>Subir fotos de la factura</h1>
<p>Sacale una foto a cada página de la factura (o elegí un PDF). Aparecen automáticamente en la computadora.</p>
<label class="btn">📷 Tomar foto / elegir archivo<input id="f" type="file" accept="image/*,application/pdf" multiple capture="environment" hidden></label>
<div class="lista" id="lista"></div>
<div class="ok" id="ok"></div>
<script>
const TOKEN=${JSON.stringify(token)};let n=0;
const lista=document.getElementById("lista"),okd=document.getElementById("ok");
document.getElementById("f").addEventListener("change",async e=>{
  for(const file of e.target.files){
    const row=document.createElement("div");row.className="it";row.innerHTML="<span>"+file.name.slice(0,28)+"</span><span>subiendo…</span>";lista.appendChild(row);
    try{
      const data=await new Promise(r=>{const fr=new FileReader();fr.onload=()=>r(fr.result);fr.readAsDataURL(file)});
      const res=await (await fetch("/api/recibir/subir",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token:TOKEN,data})})).json();
      if(res.ok){row.lastChild.textContent="✓";n++;okd.textContent="✅ "+n+" archivo(s) enviados. Ya aparecen en la compu.";}
      else row.lastChild.textContent="error: "+(res.error||"");
    }catch{row.lastChild.textContent="error";}
  }
  e.target.value="";
});
</script></body></html>`;
    res.writeHead(200, { "Content-Type": "text/html", "Cache-Control": "no-cache" });
    return res.end(html);
  }
  if (u.pathname === "/faq" || u.pathname === "/faq/" || u.pathname === "/ayuda") {
    const host = req.headers.host || "elpasajedental.com";
    const faqLD = {
      "@context": "https://schema.org", "@type": "FAQPage", itemListElement: [
        ["¿Qué medios de pago aceptan?", "Transferencia y efectivo sin recargo; Mercado Pago y tarjetas (con un posible recargo que se muestra antes de pagar)."],
        ["¿Hacen envíos? ¿A dónde?", "Sí, a todo el país por Andreani, con entrega a domicilio o retiro en sucursal. En Tucumán hay envío local y retiro en el local."],
        ["¿Emiten factura?", "Sí, todas las compras se facturan electrónicamente según ARCA/AFIP."],
        ["¿Puedo cambiar o devolver un producto?", "Sí, tenés 10 días corridos para arrepentirte de tu compra, además de la política de cambios y devoluciones."],
      ].map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
    };
    return htmlPageSEO(res, "faq.html", { host, canonical: `https://${host}/faq`, jsonld: [faqLD] });
  }
  if (u.pathname === "/arrepentimiento" || u.pathname === "/arrepentimiento/") {
    return htmlPage(res, "arrepentimiento.html");
  }
  // Solicitud del Botón de Arrepentimiento → avisa al comercio por email
  if (u.pathname === "/api/arrepentimiento" && req.method === "POST") {
    const b = await readBody(req);
    if (!b.nombre || !b.email) return send(res, 400, { error: "Faltan datos" });
    const resend = await loadResend(ROOT);
    const dest = process.env.MAIL_TO || "elpasajedental@gmail.com";
    if (resend && resend.api_key) {
      try {
        await fetch("https://api.resend.com/emails", {
          method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + resend.api_key },
          body: JSON.stringify({ from: resend.from, to: [dest], reply_to: b.email,
            subject: `⚠️ Botón de arrepentimiento — pedido ${b.pedido || "(sin nº)"}`,
            html: `<h2>Solicitud de arrepentimiento</h2><p><b>Nombre:</b> ${esc(b.nombre)}</p><p><b>Email:</b> ${esc(b.email)}</p><p><b>Pedido:</b> ${esc(b.pedido || "-")}</p><p><b>Comentario:</b> ${esc(b.motivo || "-")}</p><p>Recibido el ${new Date().toLocaleString("es-AR")}.</p>` }),
        });
      } catch { /* igual confirmamos al cliente */ }
    }
    return send(res, 200, { ok: true });
  }
  if (u.pathname === "/" || u.pathname === "/index.html") {
    const host = req.headers.host || "elpasajedental.com";
    const website = { "@context": "https://schema.org", "@type": "WebSite", name: "El Pasaje Dental", url: `https://${host}/` };
    return htmlPageSEO(res, "index.html", { host, canonical: `https://${host}/`, jsonld: [negocioLD(host), website] });
  }

  // ---- API ----
  if (u.pathname === "/api/data") {
    const [catalogo, muebles, ubicaciones, plano, combos] = await Promise.all([
      getCatalogo(),
      readJson(MUEBLES_PATH, { muebles: [] }),
      readJson(UBIC_PATH, { asignaciones: [] }),
      readJson(PLANO_PATH, { asignacion: {} }),
      readJson(COMBOS_PATH, {}),
    ]);
    return send(res, 200, { catalogo, muebles, ubicaciones, plano, combos });
  }

  if (u.pathname === "/api/sync" && req.method === "POST") {
    try {
      await buildCatCache();
      const cat = await getCatalogo();
      return send(res, 200, { ok: true, total: cat.total || (cat.productos || []).length });
    } catch (e) {
      return send(res, 500, { error: "No se pudo sincronizar: " + (e.message || e) });
    }
  }

  if (u.pathname === "/api/asignar" && req.method === "POST") {
    const { productId, slotId, nota, variationId, cantidad, sumar } = await readBody(req);
    if (!productId || !slotId) return send(res, 400, { error: "Faltan datos" });
    const vId = variationId || null;
    const ubic = await readJson(UBIC_PATH, { asignaciones: [] });
    const ya = ubic.asignaciones.find((a) => a.productId === productId && a.slotId === slotId && (a.variationId || null) === vId);
    if (ya) {
      if (nota !== undefined) ya.nota = nota;
      if (cantidad != null) { const c = Math.max(0, Math.round(Number(cantidad)) || 0); ya.cantidad = sumar ? (Number(ya.cantidad) || 0) + c : c; } // sumar=acumula (carga rápida); si no, pisa
    }
    else ubic.asignaciones.push({ productId, variationId: vId, slotId, nota: nota || "", cantidad: cantidad != null ? Math.max(0, Math.round(Number(cantidad)) || 0) : null });
    await writeFile(UBIC_PATH, JSON.stringify(ubic, null, 2));
    return send(res, 200, { ok: true, asignaciones: ubic.asignaciones });
  }
  // ---- Cantidad por ubicación: setear (cantidad) o sacar/reponer (delta) ----
  if (u.pathname === "/api/ubicacion-cantidad" && req.method === "POST") {
    const { productId, slotId, variationId, cantidad, delta } = await readBody(req);
    const vId = variationId || null;
    const ubic = await readJson(UBIC_PATH, { asignaciones: [] });
    const a = ubic.asignaciones.find((x) => x.productId === productId && x.slotId === slotId && (x.variationId || null) === vId);
    if (!a) return send(res, 404, { error: "Esa ubicación no existe" });
    let n = a.cantidad != null ? a.cantidad : 0;
    if (cantidad != null && cantidad !== "") n = Number(cantidad);
    else if (delta != null) n = n + Number(delta);
    a.cantidad = Math.max(0, Math.round(n) || 0);
    await writeFile(UBIC_PATH, JSON.stringify(ubic, null, 2));
    return send(res, 200, { ok: true, asignaciones: ubic.asignaciones });
  }

  if (u.pathname === "/api/desasignar" && req.method === "POST") {
    const { productId, slotId, variationId } = await readBody(req);
    const vId = variationId || null;
    const ubic = await readJson(UBIC_PATH, { asignaciones: [] });
    ubic.asignaciones = ubic.asignaciones.filter((a) => !(a.productId === productId && a.slotId === slotId && (a.variationId || null) === vId));
    await writeFile(UBIC_PATH, JSON.stringify(ubic, null, 2));
    return send(res, 200, { ok: true, asignaciones: ubic.asignaciones });
  }

  if (u.pathname === "/api/plano" && req.method === "POST") {
    const { zonaId, muebleId } = await readBody(req);
    if (!zonaId) return send(res, 400, { error: "Falta zonaId" });
    const plano = await readJson(PLANO_PATH, { asignacion: {} });
    if (!plano.asignacion) plano.asignacion = {};
    if (muebleId) plano.asignacion[zonaId] = muebleId;
    else delete plano.asignacion[zonaId];
    await writeFile(PLANO_PATH, JSON.stringify(plano, null, 2));
    return send(res, 200, { ok: true, asignacion: plano.asignacion });
  }

  if (u.pathname === "/api/preguntar" && req.method === "POST") {
    const { pregunta } = await readBody(req);
    if (!pregunta || !pregunta.trim()) return send(res, 400, { error: "Falta la pregunta" });
    try {
      return send(res, 200, await preguntarClaude(pregunta.trim()));
    } catch (e) {
      return send(res, 500, { error: "No se pudo consultar: " + (e && e.message ? e.message : e) });
    }
  }

  // ─── Artículos / clasificación ───────────────────────────────────────────────
  if (u.pathname === "/api/admin/param/estructura" && esStaff) {
    try { return send(res, 200, await getEstructuraCompleta()); }
    catch (e) { return send(res, 500, { error: e.message }); }
  }
  if (u.pathname === "/api/admin/articulos" && req.method === "GET" && esStaff) {
    try {
      const q = u.searchParams.get("q") || "";
      const grupo_id = u.searchParams.get("grupo") || null;
      const page = Number(u.searchParams.get("page") || 1);
      return send(res, 200, await listArticulos({ q, grupo_id, page }));
    } catch (e) { return send(res, 500, { error: e.message }); }
  }
  if (u.pathname === "/api/admin/articulos" && req.method === "POST" && esStaff) {
    try {
      const b = await readBody(req);
      const art = await crearArticulo(b);
      if (b.atributos?.length) await setArticuloAtributos(art.id, b.atributos);
      if (b.modelos?.length)   await setArticuloModelos(art.id, b.modelos);
      return send(res, 200, { ok: true, id: art.id });
    } catch (e) { return send(res, 500, { error: e.message }); }
  }
  if (u.pathname.startsWith("/api/admin/articulos/") && req.method === "PUT" && esStaff) {
    try {
      const id = Number(u.pathname.split("/")[4]);
      const b = await readBody(req);
      await actualizarArticulo(id, b);
      if (b.atributos !== undefined) await setArticuloAtributos(id, b.atributos || []);
      if (b.modelos !== undefined)   await setArticuloModelos(id, b.modelos || []);
      return send(res, 200, { ok: true });
    } catch (e) { return send(res, 500, { error: e.message }); }
  }
  if (u.pathname.startsWith("/api/admin/articulos/") && req.method === "GET" && esStaff) {
    try {
      const id = Number(u.pathname.split("/")[4]);
      const art = await getArticuloDetalle(id);
      if (!art) return send(res, 404, { error: "No encontrado" });
      return send(res, 200, art);
    } catch (e) { return send(res, 500, { error: e.message }); }
  }

  // ---- Estaticos ----
  let path = u.pathname === "/" ? "/index.html" : u.pathname;
  try {
    const file = join(PUBLIC, path);
    if (!file.startsWith(PUBLIC)) return send(res, 403, "Prohibido", "text/plain");
    const data = await readFile(file);
    const ext = extname(file);
    // JS/CSS/HTML siempre se revalidan (evita quedar con versiones viejas tras un deploy)
    const headers = { "Content-Type": MIME[ext] || "application/octet-stream" };
    if ([".js", ".css", ".html"].includes(ext)) headers["Cache-Control"] = "no-cache, must-revalidate";
    res.writeHead(200, headers);
    return res.end(data);
  } catch {
    return send(res, 404, "No encontrado", "text/plain");
  }
});

// Prepara la carpeta de datos: copia los archivos editables si faltan y sincroniza el catalogo si no existe.
async function prepararDatos() {
  if (DATA !== join(ROOT, "data")) {
    await mkdir(DATA, { recursive: true });
    for (const f of ["ubicaciones.json", "plano.json", "usuarios.json", "pedidos.json"]) {
      const dst = join(DATA, f);
      if (!existsSync(dst)) {
        try { await copyFile(join(ROOT, "data", f), dst); }
        catch { await writeFile(dst, f.startsWith("ubic") ? '{"asignaciones":[]}' : f.startsWith("usu") ? '{"usuarios":[]}' : f.startsWith("ped") ? '{"preparados":{}}' : '{"asignacion":{}}'); }
      }
    }
  }
  // Inicializar tablas en Postgres (idempotente)
  try { await initDb(); console.log("[db] tablas Postgres listas"); }
  catch (e) { console.log("[db] error al inicializar:", e.message); }
  // Mergea usuarios + claves de WordPress (idempotente: solo rellena huecos, no pisa contraseñas propias)
  try { const r = await AUTH.importarSeedWP(); if (r.ok) console.log(`[wp] usuarios merge: +${r.nuevos} nuevos, +${r.claves} claves, total ${r.total}`); }
  catch (e) { console.log("[wp] no se pudo mergear el seed:", e.message); }
  // Seed del admin por defecto (solo si el usuario no tiene clave establecida)
  if (process.env.ADMIN_SEED_EMAIL && process.env.ADMIN_SEED_PASS) {
    try {
      const usuarios = await AUTH.leerUsuarios();
      const ya = (usuarios.usuarios || []).find(u => (u.email||"").toLowerCase() === process.env.ADMIN_SEED_EMAIL.toLowerCase());
      if (!ya || !ya.clave) {
        await AUTH.setClave(process.env.ADMIN_SEED_EMAIL, process.env.ADMIN_SEED_PASS);
        console.log("[auth] admin seedeado:", process.env.ADMIN_SEED_EMAIL);
      }
    } catch (e) { console.log("[auth] seed error:", e.message); }
  }
}

await prepararDatos();
console.log(`[datos] DATA_DIR=${DATA} | plano=${existsSync(PLANO_PATH)} ubicaciones=${existsSync(UBIC_PATH)} usuarios=${existsSync(join(DATA, "usuarios.json"))}`);
server.listen(PORT, "0.0.0.0", () => console.log(`Sistema de ubicaciones escuchando en puerto ${PORT}` + (PASSWORD ? " (con login)" : "")));

// Caché del catálogo público siempre caliente: se arma al arrancar y se refresca cada 5 min desde Postgres.
buildCatCache().then(() => console.log("[cat-cache] catálogo público pre-comprimido y listo")).catch((e) => console.log("[cat-cache] primer build:", e.message));
setInterval(() => buildCatCache().catch((e) => console.log("[cat-cache]", e.message)), 5 * 60 * 1000);
// Backup diario por email (chequea cada 30 min; manda 1 vez al día a partir de las 6 UTC ≈ 3 AM ARG)
chequearBackupDiario(); chequearChequesProximos();
setInterval(() => { chequearBackupDiario(); chequearChequesProximos(); }, 30 * 60 * 1000);
