// MercadoLibre: OAuth 2.0, almacenamiento de tokens con auto-refresh, estado. (Publicación/sync: Fase E con credenciales.)
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { dataDir } from "../scripts/lib.mjs";

export function loadMLConfig(ROOT) {
  return {
    client_id: process.env.ML_CLIENT_ID || "",
    client_secret: process.env.ML_CLIENT_SECRET || "",
    markup: Number(process.env.ML_MARKUP || "1.20"),
    redirect: process.env.ML_REDIRECT || "",
    site: process.env.ML_SITE || "MLA",
    auth_host: process.env.ML_AUTH_HOST || "https://auth.mercadolibre.com.ar",
    category_id: process.env.ML_CATEGORY_ID || "",
    brand: process.env.ML_BRAND || "Genérico",
    listing_type: process.env.ML_LISTING_TYPE || "gold_special",
  };
}

export function crearML(ROOT) {
  const TOK_PATH = join(dataDir(ROOT), "ml-tokens.json");
  const leerTok = async () => { try { return JSON.parse(await readFile(TOK_PATH, "utf8")); } catch { return null; } };
  const guardarTok = async (t) => { await mkdir(dataDir(ROOT), { recursive: true }); await writeFile(TOK_PATH, JSON.stringify(t, null, 2)); };

  function urlAutorizar() {
    const c = loadMLConfig(ROOT);
    if (!c.client_id || !c.redirect) return null;
    return `${c.auth_host}/authorization?response_type=code&client_id=${c.client_id}&redirect_uri=${encodeURIComponent(c.redirect)}`;
  }
  async function oauthToken(params) {
    const r = await fetch("https://api.mercadolibre.com/oauth/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(params),
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, j };
  }
  async function intercambiarCodigo(code) {
    const c = loadMLConfig(ROOT);
    const { ok, j } = await oauthToken({ grant_type: "authorization_code", client_id: c.client_id, client_secret: c.client_secret, code, redirect_uri: c.redirect });
    if (!ok) return { error: j.message || j.error_description || j.error || "Error en OAuth" };
    await guardarTok({ access_token: j.access_token, refresh_token: j.refresh_token, user_id: j.user_id, exp: Date.now() + (j.expires_in || 21600) * 1000, obtenido: new Date().toISOString() });
    return { ok: true };
  }
  async function refrescar() {
    const c = loadMLConfig(ROOT); const t = await leerTok();
    if (!t || !t.refresh_token) return null;
    const { ok, j } = await oauthToken({ grant_type: "refresh_token", client_id: c.client_id, client_secret: c.client_secret, refresh_token: t.refresh_token });
    if (!ok) return null;
    const nt = { access_token: j.access_token, refresh_token: j.refresh_token || t.refresh_token, user_id: j.user_id || t.user_id, exp: Date.now() + (j.expires_in || 21600) * 1000, obtenido: new Date().toISOString() };
    await guardarTok(nt); return nt;
  }
  async function token() {
    let t = await leerTok(); if (!t) return null;
    if (Date.now() > t.exp - 60000) t = (await refrescar()) || t;
    return t && t.access_token ? t.access_token : null;
  }
  async function estado() {
    const c = loadMLConfig(ROOT);
    const t = await leerTok();
    let user = null;
    if (t) { const tk = await token(); if (tk) { try { const r = await fetch("https://api.mercadolibre.com/users/me", { headers: { Authorization: "Bearer " + tk } }); if (r.ok) user = await r.json(); } catch {} } }
    const map = await leerMap();
    return { configurado: !!(c.client_id && c.client_secret && c.redirect), conectado: !!(t && user), nickname: user && user.nickname, user_id: user && user.id, markup: c.markup, redirect: c.redirect, category_id: c.category_id, publicados: Object.keys(map).length };
  }

  // ---------- Publicación y sincronización de stock ----------
  const MAP_PATH = join(dataDir(ROOT), "ml-items.json");
  const CFG_PATH = join(dataDir(ROOT), "ml-config.json");
  const leerMap = async () => { try { return JSON.parse(await readFile(MAP_PATH, "utf8")); } catch { return {}; } };
  const guardarMap = async (m) => { await mkdir(dataDir(ROOT), { recursive: true }); await writeFile(MAP_PATH, JSON.stringify(m, null, 2)); };
  // Config por producto: { items: { "<id>": { subir: bool, precio: number|null } } }
  const leerCfg = async () => { try { return JSON.parse(await readFile(CFG_PATH, "utf8")); } catch { return { items: {} }; } };
  const guardarCfg = async (c) => { await mkdir(dataDir(ROOT), { recursive: true }); await writeFile(CFG_PATH, JSON.stringify(c, null, 2)); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function mlFetch(path, opts = {}) {
    const tk = await token();
    if (!tk) return { ok: false, status: 401, j: { message: "Sin token de MercadoLibre" } };
    const r = await fetch("https://api.mercadolibre.com" + path, {
      ...opts, headers: { Authorization: "Bearer " + tk, "Content-Type": "application/json", ...(opts.headers || {}) },
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, j };
  }

  const precioAuto = (p, c) => Math.max(1, Math.round(Number(p.precio || 0) * (c.markup || 1.2)));
  // precio final: override fijo del producto si existe, si no el automático (+markup)
  const precioFinal = (p, c, cfg) => {
    const ov = cfg && cfg.items && cfg.items[p.id] && cfg.items[p.id].precio;
    return (typeof ov === "number" && ov > 0) ? Math.round(ov) : precioAuto(p, c);
  };
  // marca final: la elegida por el usuario (config) > la del catálogo (pa_marca) > default
  const marcaFinal = (p, c, cfg) => {
    const ov = cfg && cfg.items && cfg.items[p.id] && cfg.items[p.id].marca;
    return (ov && ov.trim()) || (p.marca && p.marca.trim()) || c.brand;
  };
  const cantML = (p) => (typeof p.stock === "number" && p.stock > 0) ? p.stock : 1;
  const limpiarHTML = (s) => (s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  // ML no soporta AVIF; esas imágenes (o cualquier formato raro) se pasan por un proxy que las entrega en JPG.
  // ML descarga la foto una sola vez al publicar y la guarda en sus servidores.
  const imagenML = (url) => {
    if (!url) return null;
    if (/\.(jpg|jpeg|png|webp|gif)(\?|$)/i.test(url)) return url;
    return "https://images.weserv.nl/?url=" + encodeURIComponent(url.replace(/^https?:\/\//, "")) + "&output=jpg";
  };
  const fotosML = (p) => {
    const urls = (p.imagenes && p.imagenes.length) ? p.imagenes : (p.imagen ? [p.imagen] : []);
    return urls.map(imagenML).filter(Boolean).slice(0, 10).map((source) => ({ source }));
  };

  // Predice la categoría de ML a partir del título (si no hay ML_CATEGORY_ID fijo)
  async function categoriaDe(titulo, c) {
    if (c.category_id) return c.category_id;
    const r = await mlFetch(`/sites/${c.site}/domain_discovery/search?limit=1&q=${encodeURIComponent(titulo)}`);
    if (r.ok && Array.isArray(r.j) && r.j[0] && r.j[0].category_id) return r.j[0].category_id;
    return null;
  }

  // Construye el payload de un ítem de ML desde un producto del catálogo
  async function mapearItem(p, c, precio, marca) {
    const category_id = await categoriaDe(p.nombre, c);
    if (!category_id) return { error: "No se pudo determinar la categoría de ML" };
    const item = {
      title: (p.nombre || "").slice(0, 60),
      category_id,
      price: precio,
      currency_id: "ARS",
      available_quantity: cantML(p),
      buying_mode: "buy_it_now",
      condition: "new",
      listing_type_id: c.listing_type || "gold_special",
      pictures: fotosML(p),
      description: { plain_text: limpiarHTML(p.descripcion) || (p.nombre || "") },
      attributes: [
        { id: "BRAND", value_name: marca || c.brand },
        { id: "MODEL", value_name: (p.sku || "Estándar").toString().slice(0, 60) },
      ],
      shipping: { mode: "me2", local_pick_up: true, free_shipping: false },
    };
    return { item };
  }

  // Publica un producto (o lo actualiza si ya estaba mapeado). Devuelve {ok, ml_id} o {error}
  async function publicarUno(p, c, cfg, map) {
    if (map[p.id] && map[p.id].ml_id) return { ok: true, ml_id: map[p.id].ml_id, ya: true };
    const precio = precioFinal(p, c, cfg);
    const { item, error } = await mapearItem(p, c, precio, marcaFinal(p, c, cfg));
    if (error) return { error };
    const r = await mlFetch("/items", { method: "POST", body: JSON.stringify(item) });
    if (!r.ok) {
      console.log("[ml/publicar] rechazo", p.id, JSON.stringify(r.j).slice(0, 800));
      const causes = (r.j && Array.isArray(r.j.cause)) ? r.j.cause.map((c) => c.message || c.code).filter(Boolean) : [];
      return { error: causes.length ? causes.join(" · ") : ((r.j && r.j.message) || ("ML " + r.status)) };
    }
    map[p.id] = { ml_id: r.j.id, permalink: r.j.permalink, precio: item.price, stock: item.available_quantity, sync: new Date().toISOString() };
    return { ok: true, ml_id: r.j.id };
  }

  // Publica SOLO los productos marcados "subir" en la config, en stock y simples. limit para tandas.
  async function publicarCatalogo(productos, { limit = 20 } = {}) {
    const c = loadMLConfig(ROOT);
    const tk = await token();
    if (!tk) return { error: "Conectá MercadoLibre primero" };
    const cfg = await leerCfg();
    const map = await leerMap();
    const elegidos = productos.filter((p) => cfg.items[p.id] && cfg.items[p.id].subir);
    const enStock = elegidos.filter((p) => p.stock_status === "instock" && p.stock !== 0);
    const variables = enStock.filter((p) => p.tipo === "variable").length;
    const simples = enStock.filter((p) => p.tipo !== "variable");
    const pendientes = simples.filter((p) => !(map[p.id] && map[p.id].ml_id)).slice(0, limit);
    if (!elegidos.length) return { error: "No marcaste ningún producto para subir. Usá 'Elegir productos' primero." };
    let ok = 0; const errores = [];
    for (const p of pendientes) {
      const r = await publicarUno(p, c, cfg, map);
      if (r.ok && !r.ya) ok++; else if (r.error) errores.push({ id: p.id, nombre: p.nombre, error: r.error });
      await guardarMap(map);
      await sleep(350); // respeto rate-limit de ML
    }
    const yaPublicados = simples.filter((p) => map[p.id]).length;
    return { ok: true, publicados: ok, errores, restantes: simples.length - yaPublicados, variables_omitidos: variables, total_mapeados: Object.keys(map).length };
  }

  // Despublica (cierra y elimina) el ítem de ML de un producto y lo saca del mapeo para poder republicar
  async function despublicar(productId) {
    const tk = await token();
    if (!tk) return { error: "Conectá MercadoLibre primero" };
    const map = await leerMap();
    const info = map[String(productId)] || map[productId];
    if (!info || !info.ml_id) return { error: "Ese producto no figura publicado" };
    const cerrar = await mlFetch(`/items/${info.ml_id}`, { method: "PUT", body: JSON.stringify({ status: "closed" }) });
    const borrar = await mlFetch(`/items/${info.ml_id}`, { method: "PUT", body: JSON.stringify({ deleted: "true" }) });
    delete map[String(productId)]; delete map[productId];
    await guardarMap(map);
    return { ok: true, ml_id: info.ml_id, cerrado: cerrar.ok, eliminado: borrar.ok };
  }

  // Devuelve la lista de productos para el gestor (merge catálogo + config + estado de publicación)
  async function listaGestor(productos) {
    const c = loadMLConfig(ROOT);
    const cfg = await leerCfg();
    const map = await leerMap();
    return productos
      .filter((p) => p.stock_status === "instock" && p.stock !== 0)
      .map((p) => ({
        id: p.id, nombre: p.nombre, imagen: p.imagen, tipo: p.tipo,
        precio_web: p.precio, precio_auto: precioAuto(p, c),
        subir: !!(cfg.items[p.id] && cfg.items[p.id].subir),
        precio: (cfg.items[p.id] && cfg.items[p.id].precio) || null,
        marca: (cfg.items[p.id] && cfg.items[p.id].marca) || p.marca || "",
        marca_catalogo: p.marca || "",
        publicado: !!(map[p.id] && map[p.id].ml_id),
        permalink: (map[p.id] && map[p.id].permalink) || null,
      }));
  }

  // Guarda la selección/precios. cambios = [{id, subir, precio|null}]
  async function guardarSeleccion(cambios) {
    const cfg = await leerCfg();
    if (!cfg.items) cfg.items = {};
    for (const ch of cambios || []) {
      const id = String(ch.id);
      cfg.items[id] = {
        subir: !!ch.subir,
        precio: (typeof ch.precio === "number" && ch.precio > 0) ? ch.precio : null,
        marca: (ch.marca && String(ch.marca).trim()) || null,
      };
    }
    await guardarCfg(cfg);
    const subir = Object.values(cfg.items).filter((x) => x.subir).length;
    return { ok: true, marcados: subir };
  }

  // Sincroniza stock y precio de lo ya publicado contra el catálogo actual
  async function sincronizarStock(productos) {
    const c = loadMLConfig(ROOT);
    const tk = await token();
    if (!tk) return { error: "Conectá MercadoLibre primero" };
    const cfg = await leerCfg();
    const map = await leerMap();
    const byId = new Map(productos.map((p) => [p.id, p]));
    let actualizados = 0, pausados = 0; const errores = [];
    for (const [pid, info] of Object.entries(map)) {
      const p = byId.get(Number(pid));
      if (!p) continue;
      const enStock = p.stock_status === "instock" && p.stock !== 0;
      const qty = enStock ? cantML(p) : 0;
      const price = precioFinal(p, c, cfg);
      const body = { available_quantity: qty, price };
      if (!enStock) body.status = "paused"; // sin stock -> pausar en ML
      const r = await mlFetch(`/items/${info.ml_id}`, { method: "PUT", body: JSON.stringify(body) });
      if (r.ok) { info.precio = price; info.stock = qty; info.sync = new Date().toISOString(); actualizados++; if (!enStock) pausados++; }
      else errores.push({ id: pid, error: (r.j && r.j.message) || ("ML " + r.status) });
      await guardarMap(map);
      await sleep(300);
    }
    return { ok: true, actualizados, pausados, errores };
  }

  return { urlAutorizar, intercambiarCodigo, refrescar, token, estado, publicarCatalogo, sincronizarStock, leerMap, listaGestor, guardarSeleccion, despublicar };
}
