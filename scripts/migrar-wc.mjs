// Migración única: exporta todo WooCommerce + usuarios.json a Postgres.
// Idempotente: se puede volver a correr sin duplicar datos (usa upsert en todo).
//
// Uso:
//   DATABASE_URL=postgres://... node scripts/migrar-wc.mjs
//   (en Railway: ya tiene DATABASE_URL; localmente ponela en el entorno o en un .env)
//
// Requiere: WooCommerce configurado (config/woocommerce.json o env WC_*)

import { readFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { loadWoo, dataDir } from "./lib.mjs";
import {
  initDb,
  upsertCategoria, upsertProducto, upsertVariacion,
  upsertCliente, crearPedido, crearCupon,
} from "../app/db.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Ejecuta fn en paralelo con un máximo de `limit` corrutinas simultáneas
async function pool(items, limit, fn) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); }
  }));
  return out;
}

function stripHtml(s) {
  return (s || "").replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function log(label, n) { console.log(`   ✓ ${label}: ${n}`); }

// ─── Categorías ──────────────────────────────────────────────────────────────

async function migrarCategorias(apiGet) {
  process.stdout.write("  Categorías... ");
  const { data } = await apiGet("products/categories?per_page=100&_fields=id,name,slug,parent,count");
  for (const c of data) {
    await upsertCategoria({ id: c.id, nombre: c.name, slug: c.slug || "", parent_id: c.parent || 0, count: c.count || 0 });
  }
  log("categorías migradas", data.length);
}

// ─── Productos + variaciones ─────────────────────────────────────────────────

async function migrarProductos(apiGet) {
  process.stdout.write("  Productos (esto puede tardar)...\n");
  const FIELDS = "id,name,sku,type,price,regular_price,stock_quantity,stock_status,categories,permalink,slug,variations,description,short_description,images,attributes,weight,dimensions";
  const first = await apiGet(`products?per_page=100&page=1&_fields=${FIELDS}&status=publish`);
  let raw = first.data;
  for (let p = 2; p <= first.totalPages; p++) {
    process.stdout.write(`\r  Productos: página ${p}/${first.totalPages}...`);
    raw = raw.concat((await apiGet(`products?per_page=100&page=${p}&_fields=${FIELDS}&status=publish`)).data);
  }
  process.stdout.write("\n");

  // Traer variaciones en paralelo (6 a la vez)
  const variables = raw.filter(p => p.type === "variable" && (p.variations || []).length);
  const VFIELDS = "id,sku,price,regular_price,stock_quantity,stock_status,attributes,image";
  const varMap = new Map();
  let done = 0;
  await pool(variables, 6, async (p) => {
    const { data } = await apiGet(`products/${p.id}/variations?per_page=100&_fields=${VFIELDS}`);
    varMap.set(p.id, data);
    process.stdout.write(`\r  Variaciones: ${++done}/${variables.length}`);
  });
  process.stdout.write("\n");

  const varLabel = attrs => (attrs || []).map(a => a.option).filter(Boolean).join(" · ");
  const marcaDe  = attrs => { const a = (attrs || []).find(x => x.slug === "pa_marca" || /(^|\b)marca\b/i.test(x.name || "")); return (a && a.options && a.options[0]) || ""; };

  let totalVars = 0;
  for (const p of raw) {
    const vars = varMap.get(p.id) || [];
    const tieneVars = vars.length > 0;
    await upsertProducto({
      id: p.id, sku: p.sku || "", nombre: stripHtml(p.name), tipo: p.type,
      precio: Number(p.price || p.regular_price || 0),
      precio_regular: Number(p.regular_price || p.price || 0),
      stock: tieneVars ? vars.reduce((n, v) => n + (v.stock_quantity || 0), 0) : p.stock_quantity,
      stock_status: tieneVars
        ? (vars.some(v => v.stock_status === "instock" && v.stock_quantity !== 0) ? "instock" : "outofstock")
        : (p.stock_status || "instock"),
      categorias: (p.categories || []).map(c => c.name),
      marca: marcaDe(p.attributes),
      descripcion: stripHtml(p.description),
      descripcion_corta: (() => { const s = stripHtml(p.short_description); return s && s !== String(p.sku) ? s : ""; })(),
      imagen: (p.images && p.images[0] && p.images[0].src) || "",
      imagenes: (p.images || []).map(i => i.src).filter(Boolean),
      url: p.permalink || "", slug: p.slug || "",
      peso: p.weight || "", dimensiones: p.dimensions || {}, activo: true,
    });
    for (const v of vars) {
      await upsertVariacion({
        id: v.id, sku: v.sku || "",
        label: varLabel(v.attributes) || ("#" + v.id),
        atributos: Object.fromEntries((v.attributes || []).map(a => [a.name, a.option])),
        precio: Number(v.price || 0),
        precio_regular: Number(v.regular_price || v.price || 0),
        stock: v.stock_quantity, stock_status: v.stock_status || "instock",
        imagen: (v.image && v.image.src) || "", activo: true,
      }, p.id);
      totalVars++;
    }
  }
  log("productos migrados", raw.length);
  log("variaciones migradas", totalVars);
}

// ─── Clientes desde WooCommerce ──────────────────────────────────────────────

async function migrarClientesWC(apiGet) {
  process.stdout.write("  Clientes WooCommerce...\n");
  let page = 1, total = 0;
  for (;;) {
    const r = await apiGet(`customers?per_page=100&page=${page}&_fields=id,email,first_name,last_name,billing,shipping`);
    if (!r.data.length) break;
    for (const c of r.data) {
      if (!c.email) continue;
      const nombre = `${c.first_name || ""} ${c.last_name || ""}`.trim();
      await upsertCliente({
        wc_id: c.id,
        email: c.email.toLowerCase(),
        nombre: nombre.split(/\s+/)[0] || "",
        apellido: nombre.split(/\s+/).slice(1).join(" ") || "",
        telefono: (c.billing && c.billing.phone) || "",
        billing: c.billing || null,
        shipping: c.shipping || null,
        entrega: c.shipping && c.shipping.address_1
          ? { calle: c.shipping.address_1, ciudad: c.shipping.city, provincia: c.shipping.state, cp: c.shipping.postcode, pais: c.shipping.country || "AR" }
          : null,
        origen: "woocommerce",
      });
      total++;
    }
    if (page >= r.totalPages) break;
    page++;
    process.stdout.write(`\r  Clientes WC: página ${page}/${r.totalPages}...`);
  }
  process.stdout.write("\n");
  log("clientes WC migrados", total);
}

// ─── Clientes desde usuarios.json (datos propios: tel, entrega, clave) ───────

async function migrarClientesLocales() {
  process.stdout.write("  Clientes locales (usuarios.json)... ");
  let data;
  try {
    data = JSON.parse(await readFile(join(dataDir(ROOT), "usuarios.json"), "utf8"));
  } catch {
    console.log("(no encontrado, se omite)");
    return;
  }
  let n = 0;
  for (const u of data.usuarios || []) {
    if (!u.email) continue;
    const partes = (u.nombre || "").trim().split(/\s+/);
    await upsertCliente({
      email: u.email.toLowerCase(),
      wc_id: u.wc_id || null,
      nombre: partes[0] || "",
      apellido: partes.slice(1).join(" ") || "",
      telefono: u.telefono || "",
      doc: u.doc || "",
      entrega: u.entrega || null,
      rol: u.rol || "cliente",
      clave: u.clave || null,
      wp_pass: u.wp_pass || null,
      spam: u.spam || false,
      origen: u.origen || "local",
    });
    n++;
  }
  log("clientes locales migrados", n);
}

// ─── Pedidos ─────────────────────────────────────────────────────────────────

async function migrarPedidos(apiGet) {
  process.stdout.write("  Pedidos (puede tardar varios minutos)...\n");
  const FIELDS = "id,number,status,total,subtotal,shipping_total,discount_total,payment_method,payment_method_title,billing,shipping,line_items,shipping_lines,fee_lines,coupon_lines,date_created,customer_note,meta_data";
  let page = 1, total = 0, omitidos = 0;
  for (;;) {
    const r = await apiGet(`orders?per_page=100&page=${page}&orderby=date&order=asc&_fields=${FIELDS}`);
    if (!r.data.length) break;
    for (const o of r.data) {
      const items = (o.line_items || []).map(li => ({
        product_id: li.product_id || null,
        variation_id: li.variation_id || null,
        nombre: li.name || "", sku: li.sku || "",
        cantidad: li.quantity || 1,
        precio: Number(li.price || 0),
        subtotal: Number(li.subtotal || 0),
        total: Number(li.total || 0),
      }));
      try {
        await crearPedido({
          id: o.id,
          numero: o.number || String(o.id),
          status: o.status,
          total: Number(o.total || 0),
          subtotal: Number(o.subtotal || 0),
          shipping_total: Number(o.shipping_total || 0),
          descuento_total: Number(o.discount_total || 0),
          metodo_pago: o.payment_method || "",
          metodo_pago_titulo: o.payment_method_title || "",
          cliente_email: (o.billing && o.billing.email || "").toLowerCase(),
          billing: o.billing || {},
          shipping: o.shipping || {},
          shipping_lines: o.shipping_lines || [],
          fee_lines: o.fee_lines || [],
          coupon_lines: o.coupon_lines || [],
          notas: o.customer_note || "",
          meta: Object.fromEntries((o.meta_data || []).map(m => [m.key, m.value])),
          fecha_creado: o.date_created,
          items,
        });
        total++;
      } catch (e) {
        if (e.code === "23505") { omitidos++; } // ya existe (re-run)
        else throw e;
      }
    }
    process.stdout.write(`\r  Pedidos: página ${page}/${r.totalPages}...`);
    if (page >= r.totalPages) break;
    page++;
  }
  process.stdout.write("\n");
  log("pedidos migrados", total);
  if (omitidos) log("pedidos ya existían (omitidos)", omitidos);
}

// ─── Cupones ─────────────────────────────────────────────────────────────────

async function migrarCupones(apiGet) {
  process.stdout.write("  Cupones... ");
  try {
    let page = 1, total = 0;
    for (;;) {
      const r = await apiGet(`coupons?per_page=100&page=${page}`);
      if (!r.data.length) break;
      for (const c of r.data) {
        await crearCupon({
          codigo: c.code, tipo_descuento: c.discount_type || "percent",
          valor: Number(c.amount || 0),
          fecha_expiracion: c.date_expires || null,
          uso_limite: c.usage_limit || null,
          usos: c.usage_count || 0,
          min_monto: Number(c.minimum_amount || 0) || null,
          max_monto: Number(c.maximum_amount || 0) || null,
          solo_un_uso: c.individual_use || false,
        });
        total++;
      }
      if (page >= r.totalPages) break;
      page++;
    }
    log("cupones migrados", total);
  } catch (e) {
    console.log(`Error: ${e.message}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n══════════════════════════════════════════");
  console.log("  Migración WooCommerce → Postgres");
  console.log("══════════════════════════════════════════\n");

  const woo = await loadWoo(ROOT);
  if (!woo) {
    console.error("✗  WooCommerce no configurado.");
    console.error("   Seteá WC_URL, WC_KEY y WC_SECRET, o creá config/woocommerce.json");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("✗  Falta DATABASE_URL");
    console.error("   Ejemplo: DATABASE_URL=postgresql://user:pass@host:5432/db node scripts/migrar-wc.mjs");
    process.exit(1);
  }

  const dbUrl = process.env.DATABASE_URL.replace(/:([^:@/]+)@/, ":***@");
  console.log(`WooCommerce : ${woo.url}`);
  console.log(`PostgreSQL  : ${dbUrl}\n`);

  const auth = "Basic " + Buffer.from(`${woo.consumer_key}:${woo.consumer_secret}`).toString("base64");
  async function apiGet(path) {
    const sep = path.includes("?") ? "&" : "?";
    const r = await fetch(`${woo.url}/wp-json/wc/v3/${path}${sep}`, { headers: { Authorization: auth } });
    if (!r.ok) throw new Error(`HTTP ${r.status} en ${path}: ${(await r.text()).slice(0, 200)}`);
    return { data: await r.json(), totalPages: Number(r.headers.get("x-wp-totalpages") || "1") };
  }

  console.log("1. Creando tablas...");
  await initDb();
  console.log("   ✓ Tablas listas\n");

  console.log("2. Catálogo...");
  await migrarCategorias(apiGet);
  await migrarProductos(apiGet);
  console.log();

  console.log("3. Clientes...");
  await migrarClientesWC(apiGet);
  await migrarClientesLocales();
  console.log();

  console.log("4. Pedidos...");
  await migrarPedidos(apiGet);
  console.log();

  console.log("5. Cupones...");
  await migrarCupones(apiGet);
  console.log();

  console.log("══════════════════════════════════════════");
  console.log("  ✓ Migración completada");
  console.log("══════════════════════════════════════════\n");
  process.exit(0);
}

main().catch(e => {
  console.error("\n✗  Error fatal:", e.message);
  if (e.stack) console.error(e.stack);
  process.exit(1);
});
