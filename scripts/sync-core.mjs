// Logica de sincronizacion del catalogo (reutilizada por el script CLI y por el servidor).
function stripHtml(s) {
  return (s || "").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

async function pool(items, limit, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}

// cfg: { url, consumer_key, consumer_secret }. log: opcional (msg) => void
export async function syncCatalogo(cfg, log = () => {}) {
  const auth = "Basic " + Buffer.from(`${cfg.consumer_key}:${cfg.consumer_secret}`).toString("base64");
  const PER_PAGE = 100;
  const FIELDS = "id,name,sku,type,price,regular_price,stock_quantity,stock_status,categories,permalink,variations,description,short_description,images,attributes";
  const VFIELDS = "id,sku,price,stock_quantity,stock_status,attributes";

  async function apiGet(path) {
    const res = await fetch(`${cfg.url}/wp-json/wc/v3/${path}`, { headers: { Authorization: auth } });
    if (!res.ok) throw new Error(`HTTP ${res.status} en ${path}: ${await res.text()}`);
    return { data: await res.json(), totalPages: Number(res.headers.get("x-wp-totalpages") || "1") };
  }

  log(`Sincronizando catalogo desde ${cfg.url} ...\n`);
  const first = await apiGet(`products?per_page=${PER_PAGE}&page=1&_fields=${FIELDS}&status=publish`);
  let raw = first.data;
  for (let p = 2; p <= first.totalPages; p++) {
    log(`\r  Productos: pagina ${p}/${first.totalPages}`);
    raw = raw.concat((await apiGet(`products?per_page=${PER_PAGE}&page=${p}&_fields=${FIELDS}&status=publish`)).data);
  }
  log("\n");

  const variables = raw.filter((p) => p.type === "variable" && (p.variations || []).length);
  log(`  Variaciones: ${variables.length} productos variables…\n`);
  const varMap = new Map();
  let done = 0;
  await pool(variables, 6, async (p) => {
    const { data } = await apiGet(`products/${p.id}/variations?per_page=100&_fields=${VFIELDS}`);
    varMap.set(p.id, data);
    log(`\r  Variaciones: ${++done}/${variables.length}`);
  });
  log("\n");

  const variacionLabel = (attrs) => (attrs || []).map((a) => a.option).filter(Boolean).join(" · ");
  const marcaDe = (attrs) => { const a = (attrs || []).find((x) => x.slug === "pa_marca" || /(^|\b)marca\b/i.test(x.name || "")); return (a && a.options && a.options[0]) || ""; };

  const productos = raw.map((p) => {
    const descLarga = stripHtml(p.description);
    const descCorta = stripHtml(p.short_description);
    const base = {
      id: p.id, sku: p.sku, nombre: stripHtml(p.name), tipo: p.type,
      precio: Number(p.price || p.regular_price || 0),
      stock: p.stock_quantity, stock_status: p.stock_status,
      categorias: (p.categories || []).map((c) => c.name),
      marca: marcaDe(p.attributes),
      descripcion: descLarga,
      descripcion_corta: descCorta && descCorta !== String(p.sku) ? descCorta : "",
      imagen: (p.images && p.images[0] && p.images[0].src) || "",
      imagenes: (p.images || []).map((i) => i.src).filter(Boolean),
      url: p.permalink,
    };
    if (p.type === "variable") {
      const vars = (varMap.get(p.id) || []).map((v) => ({
        id: v.id, sku: v.sku, label: variacionLabel(v.attributes) || ("#" + v.id),
        atributos: Object.fromEntries((v.attributes || []).map((a) => [a.name, a.option])),
        precio: Number(v.price || 0), stock: v.stock_quantity, stock_status: v.stock_status,
      }));
      base.variaciones = vars;
      base.stock = vars.reduce((n, v) => n + (v.stock || 0), 0);
      base.stock_status = vars.some((v) => v.stock_status === "instock" && v.stock !== 0) ? "instock" : "outofstock";
    }
    return base;
  });

  const categorias = [...new Set(productos.flatMap((p) => p.categorias))].sort();
  const totalVars = productos.reduce((n, p) => n + (p.variaciones ? p.variaciones.length : 0), 0);

  return { sincronizado: new Date().toISOString(), total: productos.length, total_variaciones: totalVars, categorias, productos };
}
