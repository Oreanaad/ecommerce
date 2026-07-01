// ---------- Estado ----------
let DATA = { catalogo: { productos: [], categorias: [] }, muebles: { muebles: [] }, ubicaciones: { asignaciones: [] } };
let PROD_BY_ID = new Map();
let SLOT_INDEX = new Map(); // slotId -> { label, mueble, seccion }

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const norm = (s) => (s || "").toString().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// Rol del usuario: "dueno" (acceso total) o "empleado" (sin resultados/finanzas). Legacy password = dueño.
let ROL_ADMIN = "dueno";
(async () => {
  let y = {};
  try { y = await (await fetch("/api/auth/yo")).json(); if (y.autenticado && y.rol) ROL_ADMIN = y.rol; } catch {}
  const el = document.getElementById("usuario-actual");
  if (el) {
    const quien = y.autenticado ? (y.nombre || y.email) : "Administrador";
    const rolTxt = ROL_ADMIN === "empleado" ? "empleado" : "dueño";
    el.innerHTML = `<span class="ua-quien">👤 ${esc(quien)}</span> <span class="ua-rol">${rolTxt}</span>`;
  }
  if (ROL_ADMIN === "empleado") {
    document.body.classList.add("rol-empleado");
    ["stats", "ml", "ajustes", "campanas"].forEach((t) => { const b = $$(".tab").find((x) => x.dataset.tab === t); if (b) b.remove(); const p = $("#tab-" + t); if (p) p.remove(); });
    $$(".tabgroup").forEach((g) => { if (!g.querySelector(".tab")) g.remove(); }); // ocultar grupos vacíos
    const act = $(".tab.active");
    if (!act || !$(".panel.active")) { const b = $$(".tab").find((x) => x.dataset.tab === "buscar"); if (b) b.click(); }
  }
})();

async function api(path, body, method = "POST") {
  const res = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return res.json();
}
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.remove("hidden");
  clearTimeout(window._tt); window._tt = setTimeout(() => t.classList.add("hidden"), 1800);
}
function esc(s) { return (s || "").toString().replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

// ---------- Carga inicial ----------
let _dataReady; const DATA_READY = new Promise((r) => { _dataReady = r; }); // resuelve cuando /api/data ya cargó
async function load() {
  DATA = await (await fetch("/api/data")).json();
  PROD_BY_ID = new Map(DATA.catalogo.productos.map((p) => [p.id, p]));
  SLOT_INDEX = new Map();
  for (const m of (DATA.muebles.muebles || []))
    for (const sec of (m.secciones || []))
      for (const slot of (sec.slots || []))
        SLOT_INDEX.set(slot.id, { ...slot, mueble: m.nombre, seccion: sec.nombre, multiSec: (m.secciones || []).length > 1 });
  if (_dataReady) { _dataReady(); _dataReady = null; } // avisa que ya hay datos (combos esperan esto)

  const cat = $("#cat");
  if (cat) cat.innerHTML = '<option value="">Todas las categorías</option>' +
    (DATA.catalogo.categorias || []).map((c) => `<option>${esc(c)}</option>`).join("");
  try { renderBuscar(); } catch {}
  try { renderMuebles(); } catch {}
  // Refresca la pestaña activa apenas hay datos: si se entró/refrescó en Carga rápida o Mapa
  // antes de que cargara /api/data, así se llenan los combos y divisiones.
  try { const a = $$(".tab.active")[0]; if (a) activarTab(a.dataset.tab, true); } catch {}
}

// asignaciones del producto; si variationId se pasa (incl. null) filtra por esa variacion
function locsOf(productId, variationId) {
  return DATA.ubicaciones.asignaciones.filter((a) =>
    a.productId === productId && (variationId === undefined || (a.variationId || null) === (variationId || null)));
}
function prodsIn(slotId) {
  return DATA.ubicaciones.asignaciones.filter((a) => a.slotId === slotId);
}
function slotTxt(slotId) { const s = SLOT_INDEX.get(slotId); return s ? `${s.mueble} · ${s.multiSec ? s.seccion + " · " : ""}${s.label}` : slotId; }
function varOf(p, variationId) { return (p.variaciones || []).find((v) => v.id === variationId); }

function stockBadge(p) {
  // Editable (click) solo para productos simples; en variables se edita cada variación.
  const ed = p.tipo !== "variable" ? ` stock-edit" data-stock="${p.id}" data-actual="${p.stock != null ? p.stock : 0}" data-nombre="${esc(p.nombre)}" title="Click para editar el stock` : "";
  // En variables el estado se calcula desde las variaciones (en stock si alguna tiene stock).
  let ss = p.stock_status, st = p.stock;
  if (p.tipo === "variable" && Array.isArray(p.variaciones) && p.variaciones.length) {
    ss = p.variaciones.some((v) => v.stock_status === "instock" && v.stock !== 0) ? "instock" : "outofstock";
    st = p.variaciones.reduce((s, v) => s + (Number(v.stock) || 0), 0);
  }
  if (ss !== "instock" || st === 0) return `<span class="badge stock-no${ed}">Sin stock</span>`;
  if (st != null && st <= 3) return `<span class="badge stock-low${ed}">Stock ${st}</span>`;
  return `<span class="badge stock-ok${ed}">Stock ${st ?? "✓"}</span>`;
}
function stockBadgeV(v, pid) {
  const ed = pid ? ` stock-edit" data-stock="${pid}" data-var="${v.id}" data-actual="${v.stock != null ? v.stock : 0}" data-nombre="${esc((PROD_BY_ID.get(pid)?.nombre || "") + " — " + v.label)}" title="Click para editar el stock` : "";
  if (v.stock_status !== "instock" || v.stock === 0) return `<span class="badge stock-no${ed}">Sin stock</span>`;
  if (v.stock != null && v.stock <= 3) return `<span class="badge stock-low${ed}">${v.stock}</span>`;
  return `<span class="badge stock-ok${ed}">${v.stock ?? "✓"}</span>`;
}
const UMBRAL_LOC_BAJO = 3; // cantidad <= este número => marcar como "reponer"
function locCantDe(productId, variationId, slotId) {
  const a = DATA.ubicaciones.asignaciones.find((x) => x.productId === productId && (x.variationId || null) === (variationId || null) && x.slotId === slotId);
  return a && a.cantidad != null ? a.cantidad : null;
}
function locChip(productId, variationId, slotId) {
  const key = `${productId}|${variationId || ""}|${slotId}`;
  const cant = locCantDe(productId, variationId, slotId);
  const bajo = cant != null && cant <= UMBRAL_LOC_BAJO;
  return `<span class="loc${bajo ? " loc-bajo" : ""}">${esc(slotTxt(slotId))}
    <span class="loc-cant">
      <button class="loc-step" data-mover="${key}|-1" title="Sacar 1">−</button>
      <input class="loc-n" data-setcant="${key}" value="${cant != null ? cant : ""}" placeholder="—" inputmode="numeric">
      <button class="loc-step" data-mover="${key}|1" title="Reponer 1">＋</button>
    </span>
    <span class="x" data-unassign="${key}">✕</span></span>`;
}

// ---------- BUSCAR ----------
function renderBuscar() {
  const q = norm($("#q").value);
  const cat = $("#cat").value;
  const soloStock = $("#soloStock").checked;
  const soloUbicados = $("#soloUbicados").checked;
  const vf = $("#venc-filtro") ? $("#venc-filtro").value : "";
  const terms = q.split(/\s+/).filter(Boolean);

  let list = DATA.catalogo.productos.filter((p) => {
    if (cat && !p.categorias.includes(cat)) return false;
    if (soloStock && (p.stock_status !== "instock" || p.stock === 0)) return false;
    if (soloUbicados && locsOf(p.id).length === 0) return false;
    if (vf) { const v = VENC_MAP.get(p.id); if (vf === "con_fecha" ? !v : (!v || v.estado !== vf)) return false; }
    if (!terms.length) return true;
    const hay = norm(p.nombre + " " + p.sku + " " + p.categorias.join(" ") + " " + (p.descripcion || "") + " " + (p.descripcion_corta || "") + " " + (p.variaciones || []).map((v) => v.label).join(" "));
    return terms.every((t) => hay.includes(t));
  });

  $("#search-meta").textContent = `${list.length} producto(s)` + (terms.length || cat ? " · filtrado" : ` de ${DATA.catalogo.total}`);
  list = list.slice(0, 120);

  $("#resultados").innerHTML = list.map((p) => card(p)).join("");
}

function card(p) {
  const locsProd = locsOf(p.id, null); // ubicaciones a nivel producto
  const locHtml = locsProd.length
    ? locsProd.map((a) => locChip(p.id, null, a.slotId)).join("")
    : '<span class="loc none">Sin ubicación a nivel producto</span>';
  const esVar = p.tipo === "variable" && (p.variaciones || []).length;
  const thumb = p.imagen
    ? `<img class="thumb" src="${esc(p.imagen)}" loading="lazy" data-detalle="${p.id}" alt="">`
    : `<div class="thumb ph" data-detalle="${p.id}">🦷</div>`;
  return `<div class="card">
    <div class="card-top">
      ${thumb}
      <div class="card-main">
        <h4 class="card-nombre-edit" data-editar="${p.id}" title="Click para editar el producto (nombre, descripción, fotos)">${esc(p.nombre)} <span class="edit-hint">✏️</span></h4>
        <div class="row">
          <span class="badge">#${esc(p.sku || p.id)}</span>
          ${p.precio ? `<span class="badge price">$${p.precio.toLocaleString("es-AR")}</span>` : ""}
          ${(ROL_ADMIN === "dueno" && !esVar) ? `<button class="precio-edit" data-precio="${p.id}" data-actual="${p.precio || 0}" data-nombre="${esc(p.nombre)}" title="Editar precio">✏️ precio</button>` : ""}
          ${stockBadge(p)}
          ${vencBadge(p.id)}
          ${esVar ? `<span class="badge variable">${p.variaciones.length} medidas</span>` : ""}
          ${p.categorias.slice(0, 2).map((c) => `<span class="badge">${esc(c)}</span>`).join("")}
        </div>
      </div>
    </div>
    <div class="locs">${locHtml}</div>
    <div class="card-actions">
      <button class="btn sm" data-assign-prod="${p.id}">📍 Asignar ubicación</button>
      <button class="ver-detalle" data-detalle="${p.id}">Ver detalle</button>
      <button class="btn ghost sm" data-compartir="${p.id}">📤 Foto al cliente</button>
    </div>
    ${esVar ? `<button class="var-toggle" data-vtoggle="${p.id}">▸ Ver ${p.variaciones.length} medidas / variaciones</button>
      <div class="variaciones hidden" id="vars-${p.id}">${p.variaciones.map((v) => varRow(p, v)).join("")}</div>` : ""}
  </div>`;
}

// Detalle con imagen y descripciones
function showDetalle(productId) {
  const p = PROD_BY_ID.get(productId);
  if (!p) return;
  const img = p.imagen ? `<img class="detalle-img" src="${esc(p.imagen)}" alt="">` : "";
  const desc = [p.descripcion, p.descripcion_corta].filter(Boolean).join("\n\n") || "Sin descripción cargada en la web. Podés preguntarle a Claude para que la busque en internet.";
  const locs = locsOf(p.id);
  const locTxt = locs.length
    ? locs.map((a) => slotTxt(a.slotId) + (a.variationId ? ` (${varOf(p, a.variationId)?.label || ""})` : "")).join(" · ")
    : "Sin ubicación asignada";
  openModal(p.nombre, `
    <img class="detalle-logo" src="/assets/logo.png" alt="El Pasaje Dental">
    ${img}
    <div class="detalle-meta">
      <span class="badge">#${esc(p.sku || p.id)}</span>
      ${p.precio ? `<span class="badge price">$${p.precio.toLocaleString("es-AR")}</span>` : ""}
      ${stockBadge(p)}
      ${p.categorias.map((c) => `<span class="badge">${esc(c)}</span>`).join("")}
    </div>
    <div class="detalle-desc">${esc(desc)}</div>
    <div style="margin-top:12px;font-size:13px;color:var(--muted)">📍 ${esc(locTxt)}</div>
    ${p.url ? `<a class="detalle-link" href="${esc(p.url)}" target="_blank" rel="noopener">Ver en la web ↗</a>` : ""}
  `);
}

// Tarjeta del producto lista para mandarle al cliente (como se ve en la tienda, con logo)
function compartirProducto(productId) {
  const p = PROD_BY_ID.get(productId) || DATA.catalogo.productos.find((x) => x.id === productId);
  if (!p) return;
  const img = p.imagen ? `<img class="share-prod-img" src="${esc(p.imagen)}" alt="">` : `<div class="share-prod-img ph">🦷</div>`;
  const wa = `https://wa.me/?text=${encodeURIComponent(`${p.nombre}${p.precio ? " — " + fmtAR(p.precio) : ""}\n${p.url || "elpasajedental.com"}`)}`;
  openModal("Compartir con el cliente", `
    <div class="share-doc share-prod" id="share-doc">
      <img class="share-logo" src="/assets/logo.png" alt="El Pasaje Dental">
      ${img}
      <h3 class="share-prod-n">${esc(p.nombre)}</h3>
      ${p.precio ? `<div class="share-prod-precio">${fmtAR(p.precio)}</div>` : ""}
      ${p.descripcion_corta ? `<p class="share-prod-desc">${esc(p.descripcion_corta)}</p>` : ""}
      <div class="share-foot">El Pasaje Dental · elpasajedental.com</div>
    </div>
    <p class="meta share-hint">📸 Sacá una captura de la tarjeta y mandásela al cliente, o compartí el texto:</p>
    <a class="btn wa-btn" href="${wa}" target="_blank" rel="noopener">📱 Compartir por WhatsApp</a>`);
}
function varRow(p, v) {
  const locs = locsOf(p.id, v.id);
  const locHtml = locs.map((a) => locChip(p.id, v.id, a.slotId)).join(" ");
  return `<div class="variacion">
    <span class="vlabel">${esc(v.label)}</span>
    <span class="vright">
      ${locHtml || ""}
      ${v.precio ? `<span class="badge price">$${v.precio.toLocaleString("es-AR")}</span>` : ""}
      ${ROL_ADMIN === "dueno" ? `<button class="precio-edit" data-precio="${p.id}" data-var="${v.id}" data-actual="${v.precio || 0}" data-nombre="${esc(p.nombre + " — " + v.label)}" title="Editar precio">✏️</button>` : ""}
      ${stockBadgeV(v, p.id)}
      <button class="mini" data-assign-prod="${p.id}" data-var="${v.id}">📍</button>
    </span>
  </div>`;
}

// ---------- MUEBLES ----------
function renderMuebles() {
  $("#muebles-list").innerHTML = DATA.muebles.muebles.map((m) => {
    const total = m.secciones.reduce((n, s) => n + s.slots.reduce((k, sl) => k + prodsIn(sl.id).length, 0), 0);
    const secs = seccionesHtml(m.secciones);
    return `<details class="mueble">
      <summary><span>${esc(m.nombre)} <span class="nota">${esc(m.nota || "")}</span></span><span class="nota">${total} prod.</span></summary>
      <div class="mueble-body">${secs}</div>
    </details>`;
  }).join("");
}

function slotCard(slot, sec) {
  const prods = prodsIn(slot.id);
  const isGrid = sec.vista === "grid";
  const prodList = prods.map((a) => {
    const p = PROD_BY_ID.get(a.productId);
    const vlabel = a.variationId ? " · " + (varOf(p, a.variationId)?.label || "#" + a.variationId) : "";
    const nombre = (p ? p.nombre : "#" + a.productId) + vlabel;
    const cn = a.cantidad != null ? ` <span class="prod-n${a.cantidad <= UMBRAL_LOC_BAJO ? " bajo" : ""}">${a.cantidad}</span>` : "";
    return `<div class="prod"><span>${esc(nombre)}${cn}</span><span class="x" data-unassign="${a.productId}|${a.variationId || ""}|${slot.id}">✕</span></div>`;
  }).join("");
  return `<div class="slot ${isGrid ? "grid-cell" : ""}">
    <div class="slot-head">
      <span class="slot-label">${esc(slot.label)}</span>
      ${prods.length ? `<span class="count">${prods.length}</span>` : ""}
    </div>
    ${slot.nota ? `<div class="slot-nota">${esc(slot.nota)}</div>` : ""}
    ${prods.length ? `<div class="prods">${prodList}</div>` : ""}
    <div class="add"><button class="add-link" data-assign-slot="${slot.id}">+ agregar producto</button></div>
  </div>`;
}

// ---------- MODAL ----------
const modal = $("#modal");
function openModal(title, html) { $("#modal-title").textContent = title; const b = $("#modal-body"); b.onclick = null; b.innerHTML = html; modal.classList.remove("hidden"); }
function closeModal() { modal.classList.add("hidden"); }
$("#modal-close").onclick = closeModal;
modal.onclick = (e) => { if (e.target === modal) closeModal(); };

function slotOptions() {
  return DATA.muebles.muebles.map((m) =>
    `<optgroup label="${esc(m.nombre)}">` +
    m.secciones.flatMap((sec) => sec.slots.map((sl) => `<option value="${sl.id}">${esc(sec.nombre)} · ${esc(sl.label)}</option>`)).join("") +
    `</optgroup>`).join("");
}

// Asignar SLOT a un producto (o a una variacion concreta)
function assignProdFlow(productId, variationId) {
  const p = PROD_BY_ID.get(productId);
  const v = variationId ? varOf(p, variationId) : null;
  const titulo = v ? `${p.nombre} — ${v.label}` : p.nombre;
  openModal("Asignar ubicación", `
    <p style="margin:0 0 12px;color:var(--muted);font-size:13px">${esc(titulo)}</p>
    <select id="pick-slot" class="search">${slotOptions()}</select>
    <input id="pick-nota" class="search" placeholder="Nota opcional (ej. reposición, exhibido)" />
    <button class="btn" id="do-assign">Guardar ubicación</button>
  `);
  $("#do-assign").onclick = async () => {
    await api("/api/asignar", { productId, variationId: variationId || null, slotId: $("#pick-slot").value, nota: $("#pick-nota").value.trim() });
    await refresh(); closeModal(); toast("Ubicación guardada"); rerender();
  };
}

// Asignar PRODUCTO a un slot
function assignSlotFlow(slotId) {
  const s = SLOT_INDEX.get(slotId);
  openModal(`Agregar a ${s.mueble} · ${s.label}`, `
    <input id="pick-q" class="search" placeholder="Buscar producto por nombre o código…" autocomplete="off" />
    <div id="pick-results"></div>
  `);
  const input = $("#pick-q");
  const render = () => {
    const terms = norm(input.value).split(/\s+/).filter(Boolean);
    if (!terms.length) { $("#pick-results").innerHTML = '<p style="color:var(--muted);font-size:13px;padding:8px">Escribí para buscar…</p>'; return; }
    const list = DATA.catalogo.productos.filter((p) => {
      const hay = norm(p.nombre + " " + p.sku + " " + (p.variaciones || []).map((x) => x.label).join(" ")); return terms.every((t) => hay.includes(t));
    }).slice(0, 30);
    $("#pick-results").innerHTML = list.map((p) =>
      `<div class="pick" data-pick="${p.id}"><span class="pname">${esc(p.nombre)}${p.tipo === "variable" ? ` <span class="badge variable">${p.variaciones.length} med.</span>` : ""}</span><span class="pmeta">#${esc(p.sku || p.id)} · ${stockShort(p)}</span></div>`).join("")
      || '<p style="color:var(--muted);font-size:13px;padding:8px">Sin resultados</p>';
  };
  input.oninput = render; render(); input.focus();
  $("#pick-results").onclick = async (e) => {
    const el = e.target.closest("[data-pick]"); if (!el) return;
    const productId = Number(el.dataset.pick);
    const p = PROD_BY_ID.get(productId);
    if (p.tipo === "variable" && p.variaciones.length) return pickVariationForSlot(p, slotId);
    await api("/api/asignar", { productId, variationId: null, slotId });
    await refresh(); closeModal(); toast("Producto agregado"); rerender();
  };
}

// Elegir si va todo el producto o una variacion concreta en el slot
function pickVariationForSlot(p, slotId) {
  const s = SLOT_INDEX.get(slotId);
  openModal(`Agregar a ${s.mueble} · ${s.label}`, `
    <p style="margin:0 0 10px;color:var(--muted);font-size:13px">${esc(p.nombre)} — elegí qué ubicar:</p>
    <div class="pick" data-vpick=""><span class="pname"><b>Todo el producto</b> (todas las medidas)</span></div>
    ${p.variaciones.map((v) => `<div class="pick" data-vpick="${v.id}"><span class="pname">${esc(v.label)}</span><span class="pmeta">${stockShort(v)}</span></div>`).join("")}
  `);
  $("#modal-body").onclick = async (e) => {
    const el = e.target.closest("[data-vpick]"); if (!el) return;
    const variationId = el.dataset.vpick ? Number(el.dataset.vpick) : null;
    await api("/api/asignar", { productId: p.id, variationId, slotId });
    await refresh(); closeModal(); toast("Agregado"); rerender();
  };
}
function stockShort(x) { return (x.stock_status === "instock" && x.stock !== 0) ? `stock ${x.stock ?? "✓"}` : "sin stock"; }

// ---------- CARGA RAPIDA ----------
function findByCode(code) {
  const c = String(code).trim();
  if (!c) return null;
  for (const p of DATA.catalogo.productos) {
    if (String(p.sku) === c || String(p.id) === c) return { productId: p.id, variationId: null, label: p.nombre };
    for (const v of (p.variaciones || [])) {
      if (String(v.sku) === c || String(v.id) === c) return { productId: p.id, variationId: v.id, label: p.nombre + " — " + v.label };
    }
  }
  return null;
}
let CARGA_LOG = [];
async function initCarga() {
  await DATA_READY; // si se entró/refrescó acá antes de cargar los datos, espera a tenerlos
  const mSel = $("#carga-mueble"); if (!mSel) return;
  const muebles = (DATA.muebles && DATA.muebles.muebles) || [];
  // (Re)llena el combo si está vacío — p.ej. si se abrió antes de que cargara /api/data
  if (muebles.length && !mSel.options.length) {
    mSel.innerHTML = muebles.map((m) => `<option value="${m.id}">${esc(m.nombre)}</option>`).join("");
    fillCargaSlots();
  }
  // traer los vencimientos para mostrarlos junto a lo ya cargado
  if (!(VENC.items || []).length) fetch("/api/admin/vencimientos").then((r) => r.json()).then((v) => { VENC = v; rebuildVencMap(); renderCargaYaCargado(); }).catch(() => {});
  if (!mSel.dataset.init) {
    mSel.dataset.init = "1";
    mSel.onchange = fillCargaSlots;
    const sSel = $("#carga-slot"); if (sSel) sSel.onchange = renderCargaYaCargado;
    const inp = $("#carga-codigo");
    inp.oninput = cargaBuscar;
    inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); cargaElegirPrimero(); } });
    const cant = $("#carga-cant");
    if (cant) cant.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); const v = $("#carga-venc"); if (v) v.focus(); else cargaConfirmar(); } });
    const venc = $("#carga-venc");
    if (venc) {
      venc.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); cargaConfirmar(); } });
      venc.addEventListener("blur", () => { const p = parseVenc(venc.value); if (p) venc.value = fmtVenc(p); }); // al salir muestra mm/aaaa ya corregido
    }
    const modoInv = $("#carga-modo-inv");
    if (modoInv) modoInv.onchange = () => $("#tab-carga").classList.toggle("modo-inventario", modoInv.checked);
  }
  setTimeout(() => $("#carga-codigo").focus(), 50);
}
function fillCargaSlots() {
  const muebles = (DATA.muebles && DATA.muebles.muebles) || [];
  const m = muebles.find((x) => x.id === $("#carga-mueble").value) || muebles[0];
  $("#carga-slot").innerHTML = m ? (m.secciones || []).flatMap((sec) => (sec.slots || []).map((sl) => `<option value="${sl.id}">${esc(sec.nombre)} · ${esc(sl.label)}</option>`)).join("") : "";
  renderCargaYaCargado();
}
// Nombre de un producto/variación a partir de sus IDs
function cargaNombre(productId, variationId) {
  const p = PROD_BY_ID.get(productId) || DATA.catalogo.productos.find((x) => x.id === productId);
  if (!p) return "#" + productId;
  if (variationId) { const v = (p.variaciones || []).find((x) => x.id === variationId); return p.nombre + (v ? " — " + v.label : ""); }
  return p.nombre;
}
function cargaSku(productId, variationId) {
  const p = PROD_BY_ID.get(productId) || DATA.catalogo.productos.find((x) => x.id === productId);
  if (!p) return String(productId);
  if (variationId) { const v = (p.variaciones || []).find((x) => x.id === variationId); return (v && v.sku) || p.sku || String(variationId); }
  return p.sku || String(productId);
}
// Muestra lo que YA está cargado en el estante seleccionado (para seguir desde ahí y controlar)
function renderCargaYaCargado() {
  const cont = $("#carga-yacargado"); if (!cont) return;
  const slotId = ($("#carga-slot") || {}).value;
  const ubicTxt = slotTxt(slotId);
  // En orden de carga (como se cargaron): las asignaciones están guardadas en ese orden.
  const asigs = ((DATA.ubicaciones && DATA.ubicaciones.asignaciones) || []).filter((a) => a.slotId === slotId);
  const cnt = $("#carga-contador"); if (cnt) cnt.textContent = `${asigs.length} en este lugar`;
  if (!slotId) { cont.innerHTML = ""; return; }
  if (!asigs.length) { cont.innerHTML = `<div class="carga-yc-tit">📍 ${esc(ubicTxt)}: todavía no cargaste nada en este lugar.</div>`; return; }
  // Vencimientos de ESA variación (cada variación = producto distinto) en ESTE lugar.
  const vencsDe = (pid, vid) => (VENC.items || [])
    .filter((it) => it.productId === pid && (it.variationId || null) === (vid || null) && (it.ubicacion || "") === ubicTxt && it.fecha)
    .sort((a, b) => (a.fecha || "").localeCompare(b.fecha || ""));
  const total = asigs.reduce((n, a) => n + (Number(a.cantidad) || 0), 0);
  const vencsLugar = (VENC.items || []).filter((it) => (it.ubicacion || "") === ubicTxt).length;
  cont.innerHTML = `<div class="carga-yc-tit">📍 Ya cargado en <b>${esc(ubicTxt)}</b> — ${asigs.length} producto(s)${total ? " · " + total + " u." : ""} <span class="meta">(lo último arriba)</span>${vencsLugar ? ` <button class="btn ghost sm" id="carga-limpiar-venc" title="Borra TODOS los vencimientos de este lugar (no toca cantidades ni stock)">🗑️ Limpiar vencimientos de acá</button>` : ""}</div>` +
    [...asigs].reverse().map((a) => {
      const vs = vencsDe(a.productId, a.variationId);
      const chips = vs.map((v) => `<span class="carga-yc-venc">⏰ ${esc(v.fecha.split("-").reverse().join("/"))}${v.cantidad != null ? " ×" + v.cantidad : ""}<button class="carga-yc-venc-x" data-delvenc="${esc(v.id)}" title="Borrar este vencimiento">✕</button></span>`).join(" ");
      return `<div class="carga-yc-it">
        <div class="carga-yc-info"><div class="carga-yc-nom">${esc(cargaNombre(a.productId, a.variationId))}</div><div class="meta carga-yc-sku">cód ${esc(cargaSku(a.productId, a.variationId))}</div>${chips ? `<div class="carga-yc-vencs">${chips}</div>` : ""}</div>
        <input type="number" min="0" inputmode="numeric" class="carga-yc-cant" data-pid="${a.productId}" data-vid="${a.variationId || ""}" value="${a.cantidad != null ? a.cantidad : ""}" placeholder="—" title="Editá la cantidad y se actualiza el total">
        <button class="carga-yc-x" data-quitar="${a.productId}|${a.variationId || ""}" title="Quitar el producto de este lugar">✕</button></div>`;
    }).join("");
  const lv = $("#carga-limpiar-venc"); if (lv) lv.onclick = async () => {
    const items = (VENC.items || []).filter((it) => (it.ubicacion || "") === ubicTxt);
    if (!items.length) return;
    if (!confirm(`¿Borrar los ${items.length} vencimiento(s) de este lugar? (no toca las cantidades ni el stock — sirve para limpiar y volver a cargarlos bien)`)) return;
    for (const it of items) await api("/api/admin/vencimiento-borrar", { id: it.id });
    try { VENC = await (await fetch("/api/admin/vencimientos")).json(); rebuildVencMap(); } catch {}
    renderCargaYaCargado();
  };
  cont.querySelectorAll("[data-delvenc]").forEach((b) => b.onclick = async () => {
    const id = b.dataset.delvenc;
    const v = (VENC.items || []).find((it) => it.id === id); // datos ANTES de borrar (cantidad, producto)
    const cant = v ? (Number(v.cantidad) || 0) : 0;
    if (!confirm(`¿Borrar este vencimiento?${cant ? ` Se descuentan ${cant} u. del total de este lugar.` : ""}`)) return;
    await api("/api/admin/vencimiento-borrar", { id });
    try { VENC = await (await fetch("/api/admin/vencimientos")).json(); rebuildVencMap(); } catch {}
    if (v) {
      const pid = v.productId, vid = v.variationId || null;
      // ¿quedan otros vencimientos de este producto en este lugar?
      const quedan = (VENC.items || []).filter((it) => it.productId === pid && (it.variationId || null) === vid && (it.ubicacion || "") === ubicTxt && it.fecha).length;
      if (!quedan) {
        await api("/api/desasignar", { productId: pid, variationId: vid, slotId }); // era el único/último → desaparece la línea
      } else if (cant) {
        const asig = ((DATA.ubicaciones && DATA.ubicaciones.asignaciones) || []).find((a) => a.productId === pid && (a.variationId || null) === vid && a.slotId === slotId);
        const nueva = Math.max(0, (asig ? Number(asig.cantidad) || 0 : 0) - cant); // descuento la cantidad del vencimiento borrado
        await api("/api/asignar", { productId: pid, variationId: vid, slotId, cantidad: nueva, sumar: false });
      }
    }
    await refresh();
    renderCargaYaCargado();
  });
  cont.querySelectorAll("[data-quitar]").forEach((btn) => btn.onclick = async () => {
    const [pid, vid] = btn.dataset.quitar.split("|");
    if (!confirm("¿Quitar este producto de este lugar? (no toca el stock, solo la ubicación)")) return;
    await api("/api/desasignar", { productId: Number(pid), variationId: vid ? Number(vid) : null, slotId });
    await refresh(); renderCargaYaCargado();
  });
  // Editar la cantidad directo en la grilla → reemplaza (set) y actualiza el total
  cont.querySelectorAll(".carga-yc-cant").forEach((inp) => inp.onchange = async () => {
    const pid = Number(inp.dataset.pid), vid = inp.dataset.vid ? Number(inp.dataset.vid) : null;
    const cant = inp.value === "" ? 0 : Math.max(0, Math.round(Number(inp.value) || 0));
    const r = await api("/api/asignar", { productId: pid, variationId: vid, slotId, cantidad: cant, sumar: false }); // SET (no suma): es una corrección directa
    if (r && r.asignaciones && DATA.ubicaciones) DATA.ubicaciones.asignaciones = r.asignaciones;
    renderCargaYaCargado();
  });
}
// Carga rápida: buscar por descripción o código → elegir → cantidad → Enter carga (venc opcional)
let CARGA_SEL = null, CARGA_MATCHES = [];
function cargaMatches(q) {
  const t = norm(q); if (!t) return [];
  const terms = t.split(/\s+/);
  const res = [];
  for (const p of DATA.catalogo.productos) {
    const base = norm(p.nombre + " " + (p.sku || ""));
    if ((p.variaciones || []).length) {
      for (const v of p.variaciones) {
        const hay = base + " " + norm((v.label || "") + " " + (v.sku || ""));
        if (terms.every((x) => hay.includes(x))) res.push({ productId: p.id, variationId: v.id, label: p.nombre + " — " + v.label, sku: v.sku || p.sku || "" });
        if (res.length >= 10) return res;
      }
    } else if (terms.every((x) => base.includes(x))) {
      res.push({ productId: p.id, variationId: null, label: p.nombre, sku: p.sku || "" });
    }
    if (res.length >= 10) return res;
  }
  return res;
}
function cargaBuscar() {
  const q = $("#carga-codigo").value.trim();
  const res = $("#carga-res");
  if (!q) { res.innerHTML = ""; CARGA_MATCHES = []; return; }
  CARGA_MATCHES = cargaMatches(q);
  res.innerHTML = CARGA_MATCHES.length
    ? CARGA_MATCHES.map((m, i) => `<div class="carga-res-it${i === 0 ? " sel" : ""}" data-cidx="${i}"><span>${esc(m.label)}</span><small>${esc(m.sku || "sin código")}</small></div>`).join("")
    : '<div class="carga-res-it none">Sin resultados</div>';
  res.querySelectorAll("[data-cidx]").forEach((el) => el.onclick = () => cargaElegir(CARGA_MATCHES[+el.dataset.cidx]));
}
function cargaElegirPrimero() { if (CARGA_MATCHES.length) cargaElegir(CARGA_MATCHES[0]); }
function cargaElegir(m) {
  if (!m) return;
  CARGA_SEL = m;
  $("#carga-res").innerHTML = ""; CARGA_MATCHES = [];
  $("#carga-codigo").value = "";
  // vencimiento ya cargado para este producto (el "de ficha" de la grilla de costos, o el peor que tenga)
  const vFicha = (VENC.items || []).find((it) => String(it.productId) === String(m.productId) && it.origen === "ficha");
  const vAny = VENC_MAP.get(m.productId);
  const fecha = (vFicha && vFicha.fecha) || (vAny && vAny.fecha) || "";
  let vencMsg = "";
  if (fecha) {
    const est = vFicha ? null : (vAny && vAny.estado);
    const color = (est === "vencido") ? "#b91c1c" : (est === "por_vencer") ? "#d97706" : "var(--rose-500)";
    vencMsg = ` <span style="color:${color};font-weight:600">· ⏰ vence ${fecha.split("-").reverse().join("/")}</span>`;
    const vi = $("#carga-venc"); if (vi && !vi.value) vi.value = fmtVenc(fecha); // lo pre-carga (lo podés cambiar o borrar antes de confirmar)
  }
  $("#carga-sel").innerHTML = `✓ Elegido: <b>${esc(m.label)}</b> <span class="meta">${esc(m.sku || "sin código")}</span>${vencMsg} — poné la <b>cantidad</b> y Enter para cargar.`;
  const cant = $("#carga-cant"); if (cant) { cant.focus(); cant.select(); }
}
// Si el año quedó de 2 dígitos (ej. "0027-..." al tipear 27), lo expande a 20XX
function anio4(fecha) {
  const m = String(fecha || "").match(/^(\d{1,4})-(\d{2})-(\d{2})$/);
  if (!m) return fecha || "";
  let y = Number(m[1]); if (y < 100) y += 2000;
  return String(y).padStart(4, "0") + "-" + m[2] + "-" + m[3];
}
function fixVencInput(inp) { if (inp) inp.addEventListener("change", () => { const f = anio4(inp.value); if (f !== inp.value) inp.value = f; }); }
// Texto libre "mm/aaaa" o "dd/mm/aaaa" → "YYYY-MM-DD". Año de 2 dígitos → 20XX (30→2030). Devuelve "" si no se entiende.
function parseVenc(str) {
  let p = String(str || "").trim().split(/[^\d]+/).filter(Boolean);
  if (!p.length) return "";
  if (p.length === 1) {                             // números pegados sin separador
    const d = p[0];
    if (d.length === 4) p = [d.slice(0, 2), d.slice(2)];                      // mmaa → 12 30
    else if (d.length === 6) {                                                // ddmmaa (151030=15/10/30) o, si no cierra, mmaaaa (122030=12/2030)
      const ddmm = [d.slice(0, 2), d.slice(2, 4), d.slice(4)];                // dd mm aa
      p = (+ddmm[1] >= 1 && +ddmm[1] <= 12 && +ddmm[0] >= 1 && +ddmm[0] <= 31) ? ddmm : [d.slice(0, 2), d.slice(2)];
    }
    else if (d.length === 8) p = [d.slice(0, 2), d.slice(2, 4), d.slice(4)];  // ddmmaaaa
    else return "";                                  // 1-3 dígitos sueltos: no alcanza para mm/aaaa
  }
  let dd = "01", mm, yy;
  if (p.length === 2) { [mm, yy] = p; }            // mm/aaaa
  else if (p.length >= 3) { [dd, mm, yy] = p; }    // dd/mm/aaaa
  else return "";
  let y = Number(yy); if (y < 100) y += 2000;       // 30 → 2030
  mm = String(Number(mm)).padStart(2, "0"); dd = String(Number(dd)).padStart(2, "0");
  if (+mm < 1 || +mm > 12 || +dd < 1 || +dd > 31) return "";
  return `${String(y).padStart(4, "0")}-${mm}-${dd}`;
}
// "YYYY-MM-DD" → "mm/aaaa" (si el día es 01) o "dd/mm/aaaa" — para mostrar en el campo de texto
function fmtVenc(fecha) {
  const m = String(fecha || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return fecha || "";
  return m[3] === "01" ? `${m[2]}/${m[1]}` : `${m[3]}/${m[2]}/${m[1]}`;
}
async function cargaConfirmar() {
  if (!CARGA_SEL) { const i = $("#carga-codigo"); if (i) i.focus(); return; }
  const found = CARGA_SEL;
  const slotId = $("#carga-slot").value;
  const nota = $("#carga-nota").value.trim();
  const cant = Number($("#carga-cant").value) || null;
  const vencRaw = $("#carga-venc").value.trim();
  const venc = parseVenc(vencRaw); // texto mm/aaaa → YYYY-MM-DD (opcional)
  const fb = $("#carga-feedback");
  if (vencRaw && !venc) { fb.className = "carga-feedback err"; fb.textContent = "⏰ Vencimiento no entendido. Poné mm/aaaa (ej. 12/2030 o 12/30)."; const vEl = $("#carga-venc"); if (vEl) vEl.focus(); return; }
  // Modo inventario: REEMPLAZA la cantidad de la ubicación (conteo). Normal: SUMA (recibir mercadería).
  const modoInv = $("#carga-modo-inv") && $("#carga-modo-inv").checked;
  // Rápido: actualizo solo las asignaciones (de la respuesta), sin recargar todo /api/data
  const r = await api("/api/asignar", { productId: found.productId, variationId: found.variationId, slotId, nota, cantidad: cant, sumar: !modoInv });
  if (r && r.asignaciones && DATA.ubicaciones) DATA.ubicaciones.asignaciones = r.asignaciones;
  if (venc) { await api("/api/admin/vencimiento", { productId: found.productId, variationId: found.variationId, nombre: found.label, codigo: found.sku || "", fecha: venc, cantidad: cant, ubicacion: slotTxt(slotId) }); try { VENC = await (await fetch("/api/admin/vencimientos")).json(); rebuildVencMap(); } catch {} }
  fb.className = "carga-feedback ok"; fb.textContent = `✓ ${found.label}${cant ? " ×" + cant : ""} → ${slotTxt(slotId)}${modoInv ? " (inventario: cantidad reemplazada)" : ""}${venc ? " · ⏰ " + venc.split("-").reverse().join("/") : ""}`;
  CARGA_SEL = null; $("#carga-sel").innerHTML = "";
  const v = $("#carga-venc"); if (v) v.value = ""; // la fecha se limpia (cada lote puede tener otra); la cantidad se mantiene
  const inp = $("#carga-codigo"); inp.value = ""; inp.focus();
  renderCargaYaCargado();
}
// ---------- PIEDRAS: conteo rápido para Escritorio · Mostrador de piedras ----------
const SLOT_PIEDRAS = "escritorio.mostrador-piedras";
function esFresaJota(p) { return (p.marca || "").toLowerCase() === "jota" || /\bjota\b/.test((p.nombre || "").toLowerCase()); }
function esPiedraMicro(p) { const n = (p.nombre || "").toLowerCase(); return /piedra/.test(n) && (/microdont/.test(n) || (p.marca || "").toLowerCase() === "microdont"); }
function piedrasCantDe(pid) { const a = ((DATA.ubicaciones && DATA.ubicaciones.asignaciones) || []).find((x) => x.slotId === SLOT_PIEDRAS && x.productId === pid && !x.variationId); return a && a.cantidad != null ? a.cantidad : ""; }
function renderPiedrasLista() {
  const list = $("#piedras-list"); if (!list) return;
  const prods = (DATA.catalogo && DATA.catalogo.productos) || [];
  const jota = prods.filter(esFresaJota).sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));
  const micro = prods.filter(esPiedraMicro).sort((a, b) => (a.nombre || "").localeCompare(b.nombre || ""));
  const filtro = (($("#piedras-q") || {}).value || "").toLowerCase().trim();
  const fil = (arr) => filtro ? arr.filter((p) => ((p.nombre || "") + " " + (p.sku || "")).toLowerCase().includes(filtro)) : arr;
  const row = (p) => `<div class="pied-row"><div class="pied-info"><div class="pied-nom">${esc(p.nombre)}</div><div class="meta">cód ${esc(p.sku || p.id)}</div></div><input type="number" min="0" inputmode="numeric" class="pied-cant" data-pid="${p.id}" value="${piedrasCantDe(p.id)}" placeholder="—"></div>`;
  const sec = (t, arr) => { const f = fil(arr); return `<div class="pied-sec"><h3 class="pied-tit">${t} <span class="meta">(${f.length}${filtro ? " de " + arr.length : ""})</span></h3>${f.map(row).join("") || '<p class="meta">— sin resultados —</p>'}</div>`; };
  list.innerHTML = sec("🦷 Fresas Jota", jota) + sec("🪨 Piedras Microdont", micro);
  const recalcTotal = () => { const t = [...jota, ...micro].reduce((s, p) => s + (Number(piedrasCantDe(p.id)) || 0), 0); const tEl = $("#piedras-total"); if (tEl) tEl.textContent = `total ${t} u. · ${jota.length + micro.length} productos`; };
  recalcTotal();
  list.querySelectorAll(".pied-cant").forEach((inp) => inp.onchange = async () => {
    const pid = Number(inp.dataset.pid);
    const cant = inp.value === "" ? 0 : Math.max(0, Math.round(Number(inp.value) || 0));
    const r = await api("/api/asignar", { productId: pid, variationId: null, slotId: SLOT_PIEDRAS, cantidad: cant, sumar: false }); // set (conteo)
    if (r && r.asignaciones && DATA.ubicaciones) DATA.ubicaciones.asignaciones = r.asignaciones;
    inp.classList.add("guardado"); setTimeout(() => inp.classList.remove("guardado"), 700);
    recalcTotal();
  });
}
function renderPiedras() {
  const q = $("#piedras-q"); if (q && !q._w) { q._w = 1; q.oninput = renderPiedrasLista; }
  const rl = $("#piedras-reload"); if (rl && !rl._w) { rl._w = 1; rl.onclick = async () => { await refresh(); renderPiedrasLista(); }; }
  renderPiedrasLista();
}
// ---------- TRANSFERIR: mover mercadería de un lugar a otro ----------
function trAsigsOrigen() { const slot = ($("#tr-origen") || {}).value; if (!slot) return []; return ((DATA.ubicaciones && DATA.ubicaciones.asignaciones) || []).filter((a) => a.slotId === slot && (Number(a.cantidad) || 0) > 0); }
function renderTrLista() {
  const cont = $("#tr-lista"); if (!cont) return;
  const slot = ($("#tr-origen") || {}).value;
  if (!slot) { cont.innerHTML = `<p class="meta">Elegí el lugar de <b>origen</b> para ver qué tiene.</p>`; return; }
  const asigs = trAsigsOrigen();
  if (!asigs.length) { cont.innerHTML = `<p class="meta">📍 ${esc(slotTxt(slot))}: no hay nada cargado acá.</p>`; return; }
  cont.innerHTML = `<label class="tr-all"><input type="checkbox" id="tr-todos" checked> Seleccionar todo (${asigs.length} producto(s))</label>` +
    asigs.map((a, i) => `<div class="tr-row">
      <input type="checkbox" class="tr-chk" data-i="${i}" checked>
      <div class="tr-info"><div class="tr-nom">${esc(cargaNombre(a.productId, a.variationId))}</div><div class="meta">cód ${esc(cargaSku(a.productId, a.variationId))} · hay ${a.cantidad}</div></div>
      <input type="number" min="0" max="${a.cantidad}" inputmode="numeric" class="tr-cant" data-i="${i}" value="${a.cantidad}" title="Cuánto pasar">
    </div>`).join("");
  const todos = $("#tr-todos"); if (todos) todos.onchange = () => cont.querySelectorAll(".tr-chk").forEach((c) => c.checked = todos.checked);
}
function renderTransferir() {
  const o = $("#tr-origen"), de = $("#tr-destino");
  if (o && !o._w) { o._w = 1; o.innerHTML = `<option value="">— elegí origen —</option>` + slotOptions(); de.innerHTML = `<option value="">— elegí destino —</option>` + slotOptions(); o.onchange = renderTrLista; }
  const go = $("#tr-go"); if (go && !go._w) { go._w = 1; go.onclick = transferir; }
  renderTrLista();
}
async function transferir() {
  const origen = ($("#tr-origen") || {}).value, destino = ($("#tr-destino") || {}).value, fb = $("#tr-fb"), cont = $("#tr-lista");
  if (!origen || !destino) { fb.className = "carga-feedback err"; fb.textContent = "Elegí origen y destino."; return; }
  if (origen === destino) { fb.className = "carga-feedback err"; fb.textContent = "El origen y el destino no pueden ser el mismo."; return; }
  const asigs = trAsigsOrigen(), mover = [];
  cont.querySelectorAll(".tr-chk").forEach((chk) => { if (!chk.checked) return; const i = +chk.dataset.i, a = asigs[i]; const q = Math.min(Number((cont.querySelector(`.tr-cant[data-i="${i}"]`) || {}).value) || 0, Number(a.cantidad) || 0); if (q > 0) mover.push({ a, q }); });
  if (!mover.length) { fb.className = "carga-feedback err"; fb.textContent = "No seleccionaste nada para pasar."; return; }
  if (!confirm(`¿Pasar ${mover.length} producto(s) de ${slotTxt(origen)} a ${slotTxt(destino)}?`)) return;
  fb.className = "carga-feedback"; fb.textContent = "Transfiriendo…";
  const origenLabel = slotTxt(origen), destLabel = slotTxt(destino);
  let n = 0, u = 0, vMov = 0;
  for (const { a, q } of mover) {
    const disp = Number(a.cantidad) || 0, fullMove = q >= disp;
    // 1) cantidad de la ubicación
    await api("/api/asignar", { productId: a.productId, variationId: a.variationId || null, slotId: destino, cantidad: q, sumar: true }); // suma al destino
    if (fullMove) await api("/api/desasignar", { productId: a.productId, variationId: a.variationId || null, slotId: origen }); // pasé todo → saco del origen
    else await api("/api/asignar", { productId: a.productId, variationId: a.variationId || null, slotId: origen, cantidad: disp - q, sumar: false }); // parcial → dejo el resto
    // 2) arrastrar los vencimientos de este producto que están en el origen
    const lotes = (VENC.items || []).filter((v) => String(v.productId) === String(a.productId) && String(v.variationId || "") === String(a.variationId || "") && (v.ubicacion || "") === origenLabel && v.fecha).sort((x, y) => (x.fecha || "").localeCompare(y.fecha || "")); // FIFO: vence antes, se mueve primero
    let restante = q;
    for (const lote of lotes) {
      const base = { productId: a.productId, variationId: a.variationId || null, fecha: lote.fecha, nombre: lote.nombre || "", codigo: lote.codigo || "" };
      if (fullMove) { // pasé todo → arrastro el lote entero (incluye lotes sin cantidad)
        await api("/api/admin/vencimiento-sumar", { ...base, cantidad: lote.cantidad, ubicacion: destLabel });
        await api("/api/admin/vencimiento-borrar", { id: lote.id }); vMov++;
      } else { // parcial → muevo de los lotes más próximos a vencer hasta cubrir q
        if (restante <= 0) break;
        const lc = Number(lote.cantidad) || 0; if (lc <= 0) continue;
        const mv = Math.min(lc, restante);
        await api("/api/admin/vencimiento-sumar", { ...base, cantidad: mv, ubicacion: destLabel });
        if (mv >= lc) await api("/api/admin/vencimiento-borrar", { id: lote.id });
        else await api("/api/admin/vencimiento-sumar", { ...base, cantidad: -mv, ubicacion: origenLabel }); // resto queda en el origen
        vMov++; restante -= mv;
      }
    }
    n++; u += q;
  }
  try { VENC = await (await fetch("/api/admin/vencimientos")).json(); rebuildVencMap(); } catch {}
  await refresh(); renderTrLista();
  fb.className = "carga-feedback ok"; fb.textContent = `✓ ${n} producto(s) · ${u} u.${vMov ? ` · ${vMov} vencimiento(s)` : ""} → ${slotTxt(destino)}`;
}
function renderCargaLog() {
  $("#carga-contador").textContent = `${CARGA_LOG.length} cargados`;
  $("#carga-log").innerHTML = CARGA_LOG.map((x, i) =>
    `<div class="item"><span>✓ <b>#${esc(String(x.variationId || x.productId))}</b> ${esc(x.label)}${x.cant ? " ×" + x.cant : ""} → ${esc(slotTxt(x.slotId))}${x.venc ? " · ⏰ " + x.venc.split("-").reverse().join("/") : ""}</span><button class="undo" data-undo="${i}">deshacer</button></div>`).join("");
}

// ---------- Eventos globales ----------
document.addEventListener("click", async (e) => {
  const pc = e.target.closest("[data-pedido]");
  if (pc) return openPedido(pc.dataset.pedido);
  const pp = e.target.closest("[data-prep]");
  if (pp) {
    const nuevo = pp.dataset.estado !== "1";
    await api("/api/admin/pedido-preparado", { id: Number(pp.dataset.prep), preparado: nuevo });
    toast(nuevo ? "Marcado preparado" : "Desmarcado"); closeModal(); cargarPedidos(); return;
  }
  const cbb = e.target.closest("[data-cambio]");
  if (cbb) { abrirCambio({ num: cbb.dataset.num, cli: cbb.dataset.cli, email: cbb.dataset.email }); return; }
  const cc = e.target.closest("[data-ctacte]");
  if (cc) {
    if (!confirm(`¿Poner el pedido #${cc.dataset.num} en la cuenta corriente de ${cc.dataset.cli || "el cliente"}? Queda registrado como deuda (impago).`)) return;
    const r = await api("/api/admin/finanzas/agregar", { coleccion: "ctacte", registro: { tipo: "deuda", cliente: cc.dataset.cli, email: cc.dataset.email, monto: Math.round(Number(cc.dataset.total) || 0), pedido: cc.dataset.num, nota: "Pedido a cuenta corriente" } });
    toast(r && r.ok ? "✅ Agregado a la cuenta corriente" : (r && r.error) || "No se pudo");
    return;
  }
  const fb = e.target.closest("[data-facturar]");
  if (fb) {
    closeModal();
    FACT_PREFILL = { ped: fb.dataset.num || fb.dataset.facturar, cli: fb.dataset.cli || "", imp: fb.dataset.total || "" };
    FIN_SEC = "facturacion"; // se fija ANTES de cambiar de pestaña para que se renderice ya en Facturación con el N° de pedido
    activarTab("finanzas");
    return;
  }
  const mz = e.target.closest("[data-zona]");
  if (mz) return showZona(mz.dataset.zona);
  const comp = e.target.closest("[data-compartir]");
  if (comp) return compartirProducto(Number(comp.dataset.compartir));
  const det = e.target.closest("[data-detalle]");
  if (det) return showDetalle(Number(det.dataset.detalle));
  const undo = e.target.closest("[data-undo]");
  if (undo) {
    const x = CARGA_LOG[Number(undo.dataset.undo)];
    if (x) { await api("/api/desasignar", { productId: x.productId, variationId: x.variationId, slotId: x.slotId }); CARGA_LOG.splice(Number(undo.dataset.undo), 1); await refresh(); renderCargaLog(); renderBuscar(); renderMuebles(); toast("Deshecho"); }
    return;
  }
  const vt = e.target.closest("[data-vtoggle]");
  if (vt) { const el = $("#vars-" + vt.dataset.vtoggle); el.classList.toggle("hidden"); vt.textContent = (el.classList.contains("hidden") ? "▸ Ver " : "▾ Ocultar ") + el.children.length + " medidas / variaciones"; return; }
  const ap = e.target.closest("[data-assign-prod]");
  if (ap) return assignProdFlow(Number(ap.dataset.assignProd), ap.dataset.var ? Number(ap.dataset.var) : null);
  const as = e.target.closest("[data-assign-slot]"); if (as) return assignSlotFlow(as.dataset.assignSlot);
  const ed = e.target.closest("[data-editar]");
  if (ed) { editarProducto(Number(ed.dataset.editar)); return; }
  const pe = e.target.closest("[data-precio]");
  if (pe) {
    const pid = Number(pe.dataset.precio), vid = pe.dataset.var ? Number(pe.dataset.var) : null;
    const actual = pe.dataset.actual || "0";
    const val = prompt(`Nuevo precio para:\n${pe.dataset.nombre || ""}\n\n(actual: $${Number(actual).toLocaleString("es-AR")})`, actual);
    if (val === null) return;
    const precio = Number(String(val).replace(/[^\d.,]/g, "").replace(/\./g, "").replace(",", "."));
    if (!Number.isFinite(precio) || precio < 0) return toast("Precio inválido");
    const r = await api("/api/admin/precio", { productId: pid, variationId: vid, precio });
    if (r && r.ok) {
      const prod = DATA.catalogo.productos.find((x) => x.id === pid);
      if (prod) { if (vid) { const v = (prod.variaciones || []).find((x) => x.id === vid); if (v) v.precio = r.precio; } else prod.precio = r.precio; }
      toast("Precio actualizado: $" + r.precio.toLocaleString("es-AR")); rerender();
    } else toast((r && r.error) || "No se pudo actualizar");
    return;
  }
  const se = e.target.closest("[data-stock]");
  if (se) {
    const pid = Number(se.dataset.stock), vid = se.dataset.var ? Number(se.dataset.var) : null;
    const actual = se.dataset.actual || "0";
    const val = prompt(`Stock para:\n${se.dataset.nombre || ""}\n\n(actual: ${actual})`, actual);
    if (val === null) return;
    const stock = parseInt(String(val).replace(/[^\d]/g, ""), 10);
    if (!Number.isFinite(stock) || stock < 0) return toast("Cantidad inválida");
    const r = await api("/api/admin/stock", { productId: pid, variationId: vid, stock });
    if (r && r.ok) {
      const prod = DATA.catalogo.productos.find((x) => x.id === pid);
      if (prod) { const o = vid ? (prod.variaciones || []).find((x) => x.id === vid) : prod; if (o) { o.stock = r.stock; o.stock_status = r.stock_status; } }
      toast("Stock actualizado: " + r.stock); rerender();
    } else toast((r && r.error) || "No se pudo actualizar");
    return;
  }
  const mv = e.target.closest("[data-mover]");
  if (mv) {
    const parts = mv.dataset.mover.split("|");
    const delta = Number(parts.pop());
    const [pid, vid, slotId] = parts;
    const r = await api("/api/ubicacion-cantidad", { productId: Number(pid), variationId: vid ? Number(vid) : null, slotId, delta });
    if (r && r.ok) { DATA.ubicaciones.asignaciones = r.asignaciones; rerender(); } else toast((r && r.error) || "No se pudo");
    return;
  }
  const un = e.target.closest("[data-unassign]");
  if (un) {
    const [pid, vid, slotId] = un.dataset.unassign.split("|");
    await api("/api/desasignar", { productId: Number(pid), variationId: vid ? Number(vid) : null, slotId });
    await refresh(); toast("Ubicación quitada"); rerender();
  }
});
// Setear cantidad exacta de una ubicación (sin re-render, para no perder el foco)
document.addEventListener("change", async (e) => {
  const inp = e.target.closest("[data-setcant]");
  if (!inp) return;
  const [pid, vid, slotId] = inp.dataset.setcant.split("|");
  const r = await api("/api/ubicacion-cantidad", { productId: Number(pid), variationId: vid ? Number(vid) : null, slotId, cantidad: inp.value === "" ? 0 : Number(inp.value) });
  if (r && r.ok) { DATA.ubicaciones.asignaciones = r.asignaciones; toast("Cantidad actualizada"); }
});
async function refresh() {
  const d = await (await fetch("/api/data")).json();
  DATA.ubicaciones = d.ubicaciones; return d.ubicaciones.asignaciones;
}
function rerender() { renderBuscar(); renderMuebles(); }

// Tabs
function activarTab(name, fromHash) {
  const t = $$(".tab").find((x) => x.dataset.tab === name);
  if (!t) return;
  $$(".tab").forEach((x) => x.classList.remove("active"));
  $$(".panel").forEach((x) => x.classList.remove("active"));
  t.classList.add("active");
  const panel = $("#tab-" + name); if (panel) panel.classList.add("active");
  // resaltar el grupo del menú al que pertenece y cerrar desplegables
  $$(".tabgroup").forEach((g) => { g.classList.toggle("active-group", !!g.querySelector(".tab.active")); g.classList.remove("open"); });
  if (!fromHash && location.hash !== "#" + name) location.hash = name; // URL propia por opción
  const loaders = { carga: initCarga, piedras: renderPiedras, transferir: renderTransferir, mapa: renderMapa, pedidos: cargarPedidos, ml: cargarML, clientes: cargarClientes, ajustes: cargarAjustes, stats: cargarEstadisticas, finanzas: cargarFinanzas, vencimientos: cargarVencimientos, reparto: cargarReparto, campanas: cargarCampanas, venta: cargarVenta, foto: cargarRecibir, solicitudes: cargarSolicitudes, encargos: cargarEncargos, redes: cargarRedes, promos: cargarPromos, inventario: cargarInventario, articulos: cargarArticulos };
  if (loaders[name]) loaders[name]();
}
$$(".tab").forEach((t) => t.onclick = () => activarTab(t.dataset.tab));
// Menú con grupos desplegables
$$(".tabg-btn").forEach((b) => b.onclick = (e) => { e.stopPropagation(); const g = b.closest(".tabgroup"); const abierto = g.classList.contains("open"); $$(".tabgroup").forEach((x) => x.classList.remove("open")); if (!abierto) g.classList.add("open"); });
document.addEventListener("click", () => $$(".tabgroup").forEach((x) => x.classList.remove("open")));
window.addEventListener("hashchange", () => { const n = location.hash.slice(1); const p = $("#tab-" + n); if (n && p && !p.classList.contains("active")) activarTab(n, true); });
{ const inicial = location.hash.slice(1); if (inicial && $$(".tab").find((x) => x.dataset.tab === inicial)) activarTab(inicial, true); }

// ---------- CUPONES (WooCommerce) ----------
async function cargarPromos() {
  const cont = $("#cp-lista"); if (!cont) return;
  const cr = $("#cp-crear"); if (cr && !cr._w) { cr._w = 1; cr.onclick = crearCupon; const rl = $("#cp-reload"); if (rl) rl.onclick = cargarPromos; }
  cont.innerHTML = '<p class="meta">Cargando cupones…</p>';
  try {
    const d = await (await fetch("/api/admin/cupones")).json();
    if (d.error) { cont.innerHTML = `<p class="meta">${esc(d.error)}</p>`; return; }
    const list = d.cupones || [];
    $("#cp-meta").textContent = `${list.length} cupón(es)`;
    cont.innerHTML = list.length ? list.map((c) => `<div class="solic-card">
      <div class="solic-head"><strong>${esc(c.code)}</strong><span class="solic-badge">${c.tipo === "percent" ? c.monto + "%" : fmtAR(c.monto)}</span></div>
      <div class="meta">${c.vence ? "vence " + c.vence.split("-").reverse().join("/") + " · " : ""}${Number(c.min) > 0 ? "mín " + fmtAR(c.min) + " · " : ""}usados ${c.usados || 0}${c.limite ? "/" + c.limite : ""}</div>
      <div class="solic-acc"><button class="btn ghost sm" data-cpdel="${c.id}">✕ Borrar</button></div>
    </div>`).join("") : '<p class="meta">No hay cupones todavía.</p>';
    cont.querySelectorAll("[data-cpdel]").forEach((b) => b.onclick = async () => { if (!confirm("¿Borrar este cupón? Deja de funcionar en la tienda.")) return; await api("/api/admin/cupones/borrar", { id: Number(b.dataset.cpdel) }); cargarPromos(); });
  } catch { cont.innerHTML = '<p class="meta">No se pudieron cargar.</p>'; }
}
async function crearCupon() {
  const code = $("#cp-code").value.trim(); if (!code) return toast("Poné un código");
  const r = await api("/api/admin/cupones", { code, tipo: $("#cp-tipo").value, monto: $("#cp-monto").value, vence: $("#cp-vence").value || "", min: $("#cp-min").value || "", limite: $("#cp-limite").value || "" });
  if (r && r.ok) { toast("✅ Cupón creado"); ["cp-code", "cp-monto", "cp-vence", "cp-min", "cp-limite"].forEach((k) => { const e = $("#" + k); if (e) e.value = ""; }); cargarPromos(); }
  else toast((r && r.error) || "No se pudo crear");
}
// Banner promocional (se administra desde Ajustes)
async function cargarPromoAjustes() {
  const a = $("#pr-activo"); if (!a) return;
  const guardarPromo = async () => {
    const on = $("#pr-activo").checked;
    const r = await api("/api/admin/promo", { activo: on, texto: $("#pr-texto").value.trim(), codigo: $("#pr-codigo").value.trim(), hasta: $("#pr-hasta").value || "" });
    $("#pr-msg").textContent = (r && r.ok) ? (on ? "✅ Banner ACTIVADO y guardado" : "✅ Banner DESACTIVADO (ya no se ve en la web)") : ((r && r.error) || "No se pudo");
    if (r && r.ok) toast(on ? "Banner activado" : "Banner desactivado");
  };
  if (!$("#pr-guardar")._w) {
    $("#pr-guardar")._w = 1;
    $("#pr-guardar").onclick = guardarPromo;
    a.onchange = guardarPromo; // al tildar/destildar se guarda solo (no hay que apretar Guardar)
  }
  try { const p = await (await fetch("/api/admin/promo")).json(); $("#pr-activo").checked = !!p.activo; $("#pr-texto").value = p.texto || ""; $("#pr-codigo").value = p.codigo || ""; $("#pr-hasta").value = p.hasta || ""; } catch {}
}
// ---------- REDES: generador de imágenes (IG / WhatsApp) ----------
let RD_SEL = [], RD_CANVAS = null;
function cargarRedes() {
  const b = $("#rd-buscar"); if (!b) return;
  if (!b.dataset.w) {
    b.dataset.w = "1";
    b.oninput = () => {
      const q = norm(b.value).trim(), res = $("#rd-res");
      if (q.length < 2) { res.innerHTML = ""; return; }
      const terms = q.split(/\s+/);
      const list = DATA.catalogo.productos.filter((p) => terms.every((t) => norm(p.nombre + " " + p.sku).includes(t))).slice(0, 6);
      res.innerHTML = list.map((p) => `<div class="rd-res-it" data-rdadd="${p.id}">${esc(p.nombre)} <span class="meta">${p.precio ? fmtAR(p.precio) : ""}</span></div>`).join("") || '<div class="meta">Sin resultados</div>';
      res.querySelectorAll("[data-rdadd]").forEach((el) => el.onclick = () => {
        const p = DATA.catalogo.productos.find((x) => x.id === +el.dataset.rdadd); if (!p) return;
        const cap = $("#rd-formato").value === "pdf" ? 30 : 6;
        if (RD_SEL.length >= cap) return toast(`Máximo ${cap} productos para este formato`);
        if (!RD_SEL.find((x) => x.id === p.id)) RD_SEL.push({ id: p.id, nombre: p.nombre, precio: p.precio, imagen: p.imagen });
        b.value = ""; res.innerHTML = ""; renderRdSel();
      });
    };
    const gen = $("#rd-generar"); if (gen) gen.onclick = generarImagenRedes;
    const desc = $("#rd-descargar"); if (desc) desc.onclick = () => { if (!RD_CANVAS) return; const a = document.createElement("a"); a.download = "pasaje-dental-redes.png"; a.href = RD_CANVAS.toDataURL("image/png"); a.click(); };
  }
  renderRdSel();
}
// ---------- Modo Inventario (reconciliación: contado por ubicación vs stock WooCommerce) ----------
let INV_DATA = { items: [] };
async function cargarInventario() {
  const lista = $("#inv-lista"); if (!lista) return;
  const b = $("#inv-q");
  if (b && !b.dataset.w) {
    b.dataset.w = "1";
    b.oninput = renderInventario;
    $("#inv-solo-dif").onchange = renderInventario;
    $("#inv-recargar").onclick = cargarInventario;
    $("#inv-ajustar-todos").onclick = ajustarTodosInventario;
    $("#inv-reset").onclick = resetConteoInventario;
    $("#inv-restaurar").onclick = restaurarConteoInventario;
  }
  lista.innerHTML = '<p class="meta">Cargando…</p>';
  try { INV_DATA = await (await fetch("/api/admin/inventario")).json(); }
  catch { lista.innerHTML = '<p class="meta">No se pudo cargar.</p>'; return; }
  renderInventario();
}
function renderInventario() {
  const lista = $("#inv-lista"); if (!lista) return;
  const items = INV_DATA.items || [];
  const soloDif = $("#inv-solo-dif").checked;
  const q = norm(($("#inv-q").value || "").trim());
  let vis = items.filter((i) => !soloDif || i.contado !== i.wc);
  if (q) { const terms = q.split(/\s+/); vis = vis.filter((i) => terms.every((t) => norm(i.nombre + " " + i.sku + " " + i.label).includes(t))); }
  $("#inv-resumen").innerHTML =
    `<span class="inv-pill">📦 Contados: <b>${INV_DATA.contados || 0}</b> de ${INV_DATA.totalSku || 0}</span>` +
    `<span class="inv-pill dif">⚠️ Con diferencia: <b>${INV_DATA.conDif || 0}</b></span>` +
    `<span class="inv-pill ok">✓ Coinciden: <b>${(INV_DATA.contados || 0) - (INV_DATA.conDif || 0)}</b></span>`;
  if (!vis.length) { lista.innerHTML = '<p class="meta">Nada para mostrar. Cargá cantidades por ubicación en Carga rápida y volvé acá.</p>'; return; }
  lista.innerHTML = `<table class="inv-tabla"><thead><tr><th>Producto</th><th>Contado</th><th>Woo</th><th>Dif.</th><th></th></tr></thead><tbody>` +
    vis.map((i) => {
      const dif = i.contado - i.wc;
      const cls = dif === 0 ? "ok" : (dif > 0 ? "mas" : "menos");
      const key = `${i.productId}:${i.variationId || ""}`;
      return `<tr class="inv-row ${cls}">
        <td class="inv-nom"><b>${esc(i.nombre)}</b>${i.label ? ` · ${esc(i.label)}` : ""}<div class="inv-sku">${esc(i.sku)} · ${i.slots} ubic.</div></td>
        <td class="inv-num">${i.contado}</td>
        <td class="inv-num">${i.wc}</td>
        <td class="inv-num inv-dif">${dif > 0 ? "+" : ""}${dif}</td>
        <td>${dif !== 0 ? `<button class="btn sm inv-ajustar" data-aj="${key}">Ajustar a ${i.contado}</button>` : `<span class="inv-okmark">✓</span>`}</td>
      </tr>`;
    }).join("") + "</tbody></table>";
  lista.querySelectorAll("[data-aj]").forEach((btn) => btn.onclick = () => ajustarInventarioItem(btn.dataset.aj));
}
function invItem(key) { return (INV_DATA.items || []).find((i) => `${i.productId}:${i.variationId || ""}` === key); }
async function ajustarInventarioItem(key) {
  const i = invItem(key); if (!i) return;
  if (!confirm(`${i.nombre}${i.label ? " · " + i.label : ""}\n\nEn WooCommerce tenía: ${i.wc}\nVas a poner (lo contado): ${i.contado}\n\n¿Confirmás?`)) return;
  const r = await api("/api/admin/stock", { productId: i.productId, variationId: i.variationId, stock: i.contado });
  if (r && r.ok) { i.wc = r.stock; INV_DATA.conDif = (INV_DATA.items || []).filter((x) => x.contado !== x.wc).length; toast(`✓ ${i.nombre} → ${r.stock}`); renderInventario(); }
  else toast((r && r.error) || "No se pudo ajustar");
}
async function ajustarTodosInventario() {
  const difs = (INV_DATA.items || []).filter((i) => i.contado !== i.wc);
  if (!difs.length) return toast("No hay diferencias para ajustar");
  if (!confirm(`Vas a ajustar ${difs.length} producto(s) en WooCommerce, poniendo en cada uno la cantidad contada.\n\n¿Confirmás? (conviene hacerlo en un momento sin ventas)`)) return;
  const btn = $("#inv-ajustar-todos"); if (btn) btn.disabled = true;
  let ok = 0; const fallaron = [];
  for (const i of difs) {
    let r = await api("/api/admin/stock", { productId: i.productId, variationId: i.variationId, stock: i.contado });
    if (!(r && r.ok)) { await new Promise((res) => setTimeout(res, 400)); r = await api("/api/admin/stock", { productId: i.productId, variationId: i.variationId, stock: i.contado }); } // 1 reintento
    if (r && r.ok) { i.wc = r.stock; ok++; } else { fallaron.push(i); }
    if ((ok + fallaron.length) % 5 === 0) toast(`Ajustando… ${ok + fallaron.length}/${difs.length}`);
  }
  INV_DATA.conDif = (INV_DATA.items || []).filter((x) => x.contado !== x.wc).length;
  if (btn) btn.disabled = false;
  renderInventario();
  if (fallaron.length) {
    alert(`Se ajustaron ${ok} de ${difs.length}.\n\n⚠️ FALLARON ${fallaron.length} (quedaron sin ajustar — volvé a tocar "Ajustar todos" o ajustalos uno por uno):\n\n` + fallaron.slice(0, 30).map((i) => `• ${i.nombre}${i.label ? " · " + i.label : ""} (contado ${i.contado})`).join("\n") + (fallaron.length > 30 ? `\n…y ${fallaron.length - 30} más` : ""));
  } else {
    toast(`✓ Listo: ${ok} producto(s) ajustado(s), sin errores`);
  }
}
async function resetConteoInventario() {
  if (!confirm("⚠️ REINICIAR CONTEO\n\nAntes de borrar se guarda un BACKUP automático (y te lo descargo como archivo).\n\n• Borra todas las cantidades contadas por ubicación, para empezar de cero.\n• NO toca el stock de WooCommerce (la tienda sigue igual).\n• Si algo sale mal, tocás «🔄 Restaurar conteo» y volvés atrás.\n\n¿Confirmás?")) return;
  const btn = $("#inv-reset"); if (btn) btn.disabled = true;
  const r = await api("/api/admin/inventario/reset", {});
  if (btn) btn.disabled = false;
  if (!(r && r.ok)) return toast((r && r.error) || "No se pudo reiniciar");
  // descargar el backup recién creado, como copia local del momento del borrado
  try {
    const bk = await (await fetch("/api/admin/inventario/backup")).json();
    const blob = new Blob([JSON.stringify(bk, null, 2)], { type: "application/json" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `inventario-backup-${(bk.fecha || "").slice(0, 19).replace(/[:T]/g, "-")}.json`; a.click();
  } catch {}
  try { DATA = await (await fetch("/api/data")).json(); } catch {}
  toast(`🧹 Conteo reiniciado (${r.limpiados} ubicaciones en blanco). Backup guardado y descargado. Ya podés contar en Carga rápida → Modo inventario.`);
  cargarInventario();
}
async function restaurarConteoInventario() {
  if (!confirm("🔄 RESTAURAR CONTEO\n\nVuelve las cantidades por ubicación al último backup (deshace el reinicio).\n\n⚠️ Se pierde lo que hayas contado DESPUÉS del reinicio.\n\n¿Confirmás?")) return;
  const r = await api("/api/admin/inventario/restaurar", {});
  if (!(r && r.ok)) return toast((r && r.error) || "No hay backup para restaurar");
  try { DATA = await (await fetch("/api/data")).json(); } catch {}
  toast(`🔄 Conteo restaurado: ${r.restauradas} ubicaciones, del backup del ${(r.backup_fecha || "").slice(0, 10)}.`);
  cargarInventario();
}
// Botones "al azar" / vaciar de Redes: delegación a nivel documento.
// Se engancha UNA sola vez al cargar app.js y funciona siempre, sin depender del cableado por pestaña.
document.addEventListener("click", (e) => {
  const t = e.target && e.target.closest ? e.target.closest("button") : null; if (!t || !t.id) return;
  if (t.id === "rd-rand6") agregarRandom(6);
  else if (t.id === "rd-rand20") agregarRandom(20, "pdf");
  else if (t.id === "rd-clear") { RD_SEL = []; renderRdSel(); }
});
async function agregarRandom(n, formato) {
  // si la data no está cargada (fallo puntual al traer /api/data), la recargo
  if (!((DATA.catalogo || {}).productos || []).length) { try { DATA = await (await fetch("/api/data")).json(); } catch {} }
  const prods = (DATA.catalogo && DATA.catalogo.productos) || [];
  const precioDe = (p) => Number(p.precio) > 0 ? Number(p.precio) : ((p.variaciones || []).map((v) => Number(v.precio) || 0).filter((x) => x > 0).sort((a, b) => a - b)[0] || 0);
  // disponible = tiene foto, precio, y NO está marcado sin stock
  const dispo = prods.filter((p) => p.imagen && p.stock_status !== "outofstock" && precioDe(p) > 0);
  if (!dispo.length) { toast("No se pudo cargar el catálogo, probá de nuevo"); return; }
  const pool = dispo.slice();
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
  RD_SEL = pool.slice(0, n).map((p) => ({ id: p.id, nombre: p.nombre, precio: precioDe(p), imagen: p.imagen }));
  if (formato && $("#rd-formato")) $("#rd-formato").value = formato;
  renderRdSel();
  toast(`🎲 ${RD_SEL.length} productos al azar`);
}
function renderRdSel() {
  $("#rd-sel").innerHTML = RD_SEL.length ? RD_SEL.map((p, i) => `<span class="rd-chip">${esc(p.nombre)} <button data-rddel="${i}">✕</button></span>`).join("") : '<p class="meta">Agregá productos (hasta 6) y tocá "Generar imagen".</p>';
  $("#rd-sel").querySelectorAll("[data-rddel]").forEach((b) => b.onclick = () => { RD_SEL.splice(+b.dataset.rddel, 1); renderRdSel(); });
}
function rdLoadImg(src) { return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; }); }
function rdRoundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
function rdContain(ctx, img, x, y, w, h) { const r = Math.min(w / img.width, h / img.height); const iw = img.width * r, ih = img.height * r; ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih); }
// Cover: llena el recuadro recortando los bordes (achica el fondo blanco y agranda el producto)
function rdCover(ctx, img, x, y, w, h, r) { ctx.save(); rdRoundRect(ctx, x, y, w, h, r || 0); ctx.clip(); const s = Math.max(w / img.width, h / img.height); const iw = img.width * s, ih = img.height * s; ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih); ctx.restore(); }
function rdWrap(ctx, text, x, y, maxW, lh, maxLines) {
  const words = String(text).split(/\s+/); const lines = []; let line = "";
  for (const w of words) { const t = line ? line + " " + w : w; if (ctx.measureText(t).width > maxW && line) { lines.push(line); line = w; if (lines.length === maxLines) break; } else line = t; }
  if (lines.length < maxLines && line) lines.push(line);
  lines.forEach((ln, i) => ctx.fillText(ln, x, y + i * lh));
}
function generarCatalogoPDF() {
  if (!RD_SEL.length) return toast("Agregá productos");
  const titulo = esc($("#rd-titulo").value || "Catálogo");
  const cards = RD_SEL.map((p) => `<div class="c"><div class="img">${p.imagen ? `<img src="${esc(p.imagen)}" onerror="this.style.display='none'">` : "🦷"}</div><div class="n">${esc(p.nombre)}</div>${p.sku ? `<div class="sku">Cód: ${esc(p.sku)}</div>` : ""}<div class="p">${fmtAR(p.precio)}</div></div>`).join("");
  const w = window.open("", "_blank");
  if (!w) return toast("Permití las ventanas emergentes para generar el PDF");
  w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title> </title><style>
    @page{size:A4 portrait;margin:12mm 10mm 20mm}
    *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .sheet{width:190mm;margin:0 auto;padding-bottom:18mm}
    html{background:#fce3ee}
    body{margin:0;font-family:'Helvetica Neue',Arial,sans-serif;color:#2a1622;background:linear-gradient(180deg,#f7cfe0 0%,#fce3ee 200px,#fff5fb 100%)}
    .tip{background:#fff;border:1px dashed #DE3667;color:#7a1040;font-size:13px;padding:11px 14px;border-radius:10px;margin-bottom:20px;text-align:center}
    .head{text-align:center;margin-bottom:24px;background:#fff;border:1px solid #f3c9dd;border-radius:18px;padding:18px 16px 16px;box-shadow:0 6px 18px rgba(122,16,64,.08)}
    .head img{height:88px}
    .head .t{font-size:27px;font-weight:800;color:#7a1040;letter-spacing:-.4px;margin-top:8px}
    .head .bar{height:4px;width:140px;margin:11px auto 0;border-radius:4px;background:linear-gradient(90deg,#7a1040,#DE3667,#f2aad8)}
    .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
    .c{border:1px solid #f3c9dd;border-radius:16px;padding:14px 11px 12px;text-align:center;break-inside:avoid;page-break-inside:avoid;background:#fff;box-shadow:0 4px 12px rgba(122,16,64,.07)}
    .c .img{height:150px;display:flex;align-items:center;justify-content:center;font-size:56px;margin-bottom:10px}
    .c .img img{max-width:100%;max-height:150px;object-fit:contain}
    .c .n{font-size:12.5px;font-weight:700;line-height:1.3;min-height:34px;color:#2a1622}
    .c .sku{font-size:10px;color:#a8949e;margin:3px 0 0}
    .c .p{margin-top:7px;font-size:20px;font-weight:800;color:#DE3667}
    .foot{position:fixed;bottom:5mm;left:10mm;right:10mm;text-align:center;font-size:11.5px;color:#7a1040;background:#fff;border:1px solid #f3c9dd;border-top:3px solid #DE3667;border-radius:12px;padding:8px 10px;box-shadow:0 4px 12px rgba(122,16,64,.07)}
    .foot b{color:#b02060}
    @media print{.tip{display:none}}
  </style></head><body>
    <div class="sheet">
    <div class="tip">💡 Para que quede impecable: en el cuadro de impresión elegí <b>papel A4</b>, destildá <b>"Encabezados y pies de página"</b> y activá <b>"Gráficos de fondo"</b>.</div>
    <div class="head"><img src="/assets/logo.png" onerror="this.style.display='none'"><div class="t">${titulo}</div><div class="bar"></div></div>
    <div class="grid">${cards}</div>
    <div class="foot"><b>El Pasaje Dental</b> · elpasajedental.com · 📍 Tucumán · 📱 WhatsApp 381 208 5383</div>
    </div>
    <script>window.onload=function(){var i=[].slice.call(document.images),n=i.filter(function(x){return !x.complete}).length;function go(){if(--n<=0)window.print();}if(!n){window.print();}else{i.forEach(function(x){if(!x.complete){x.addEventListener('load',go);x.addEventListener('error',go);}});}setTimeout(function(){try{window.print()}catch(e){}},3500);};<\/script>
  </body></html>`);
  w.document.close();
}
async function generarImagenRedes() {
  if (!RD_SEL.length) return toast("Agregá al menos un producto");
  if ($("#rd-formato").value === "pdf") return generarCatalogoPDF();
  const msg = $("#rd-msg"); msg.textContent = "Generando…";
  const fmt = $("#rd-formato").value, W = 1080, H = fmt === "post" ? 1080 : 1920;
  const c = document.createElement("canvas"); c.width = W; c.height = H; const ctx = c.getContext("2d");
  const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, "#4a0a26"); g.addColorStop(.55, "#b02060"); g.addColorStop(1, "#d873bc");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const logo = await rdLoadImg("/assets/logo.png").catch(() => null);
  const imgs = await Promise.all(RD_SEL.map((p) => p.imagen ? rdLoadImg("/api/admin/img-proxy?url=" + encodeURIComponent(p.imagen)).catch(() => null) : Promise.resolve(null)));
  let y = fmt === "post" ? 40 : 70;
  if (logo) { const lw = fmt === "post" ? 420 : 480, lh = fmt === "post" ? 140 : 160, lx = (W - lw) / 2; rdRoundRect(ctx, lx, y, lw, lh, 28); ctx.fillStyle = "#fff"; ctx.fill(); rdContain(ctx, logo, lx + 24, y + 16, lw - 48, lh - 32); y += lh + 20; }
  ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.font = "800 " + (fmt === "post" ? 56 : 72) + "px Inter, Arial, sans-serif";
  rdWrap(ctx, $("#rd-titulo").value || "El Pasaje Dental", W / 2, y + (fmt === "post" ? 54 : 70), W - 100, fmt === "post" ? 62 : 80, 2);
  y += fmt === "post" ? 92 : 130;
  const footerH = fmt === "post" ? 120 : 160, pad = 56, gap = 26;
  const cols = RD_SEL.length <= 1 ? 1 : 2, rows = Math.ceil(RD_SEL.length / cols);
  const areaY = y, areaH = H - footerH - y - pad;
  const cardW = (W - pad * 2 - gap * (cols - 1)) / cols, cardH = (areaH - gap * (rows - 1)) / rows;
  RD_SEL.forEach((p, i) => {
    const col = i % cols, row = Math.floor(i / cols), x = pad + col * (cardW + gap), cy = areaY + row * (cardH + gap);
    rdRoundRect(ctx, x, cy, cardW, cardH, 22); ctx.fillStyle = "#fff"; ctx.fill();
    const imgH = cardH * 0.68, im = imgs[i]; // foto más grande
    if (im) rdCover(ctx, im, x + 10, cy + 10, cardW - 20, imgH - 12, 16); else { ctx.fillStyle = "#faf0f6"; rdRoundRect(ctx, x + 10, cy + 10, cardW - 20, imgH - 12, 16); ctx.fill(); }
    ctx.fillStyle = "#1a1a1a"; ctx.textAlign = "left"; ctx.font = "800 " + (cols === 1 ? 40 : 30) + "px Inter, Arial, sans-serif";
    rdWrap(ctx, p.nombre, x + 22, cy + imgH + (cols === 1 ? 44 : 34), cardW - 44, cols === 1 ? 46 : 36, 2);
    ctx.fillStyle = "#b02060"; ctx.font = "800 " + (cols === 1 ? 58 : 46) + "px Inter, Arial, sans-serif";
    ctx.fillText(fmtAR(p.precio), x + 22, cy + cardH - 26);
  });
  ctx.textAlign = "center"; ctx.fillStyle = "#fff"; ctx.font = "800 " + (fmt === "post" ? 32 : 38) + "px Inter, Arial, sans-serif";
  ctx.fillText("elpasajedental.com", W / 2, H - footerH / 2 - 4);
  ctx.font = "500 " + (fmt === "post" ? 22 : 26) + "px Inter, Arial, sans-serif"; ctx.fillStyle = "rgba(255,255,255,.85)";
  ctx.fillText("📍 Tucumán · Envíos a todo el país · WhatsApp 381 208 5383", W / 2, H - footerH / 2 + (fmt === "post" ? 30 : 36));
  const wrap = $("#rd-canvas-wrap"); wrap.innerHTML = ""; c.style.maxWidth = "340px"; c.style.width = "100%"; c.style.borderRadius = "12px"; c.style.boxShadow = "0 6px 24px rgba(0,0,0,.15)"; wrap.appendChild(c);
  RD_CANVAS = c; $("#rd-descargar").disabled = false; msg.textContent = "✅ Lista — descargala o sacale captura";
}
// ---------- ENCARGOS / ALERTAS (avisar cuando llega lo que pidió el cliente) ----------
let ENCARGOS = [];
const ENC_EST = { pendiente: { t: "Esperando", i: "🕐", c: "pend" }, llego: { t: "¡Llegó! avisar", i: "📦", c: "lista" }, avisado: { t: "Avisado", i: "✅", c: "conf" } };
async function cargarEncargos() {
  const cont = $("#enc-lista"); if (!cont) return;
  const env = $("#enc-enviar"); if (env && !env._wired) {
    env._wired = 1; env.onclick = nuevoEncargo;
    const r = $("#enc-reload"); if (r) r.onclick = cargarEncargos;
    const v = $("#enc-ver-avisados"); if (v) v.onchange = renderEncargos;
    // Búsqueda en vivo de clientes (por nombre o teléfono) para traer sus datos
    let _encT;
    const encBuscar = () => {
      clearTimeout(_encT);
      _encT = setTimeout(async () => {
        const sug = $("#enc-sug"); if (!sug) return;
        const q = ($("#enc-cliente").value.trim() + " " + $("#enc-tel").value.trim()).trim();
        if (q.length < 3) { sug.innerHTML = ""; return; }
        try {
          const d = await (await fetch("/api/admin/clientes/buscar?q=" + encodeURIComponent(q))).json();
          const list = d.clientes || [];
          sug.innerHTML = list.length ? `<div class="nc-sug-t">👇 Cliente existente — tocá para traer sus datos:</div>` + list.map((c, i) => `<div class="vt-cli-item" data-encpick="${i}"><strong>${esc(c.nombre || c.email)}</strong><small>${esc(c.telefono || "")} · ${esc(c.email || "")}</small></div>`).join("") : "";
          sug.querySelectorAll("[data-encpick]").forEach((el) => el.onclick = () => { const c = list[+el.dataset.encpick]; $("#enc-cliente").value = c.nombre || c.email || ""; if (c.telefono) $("#enc-tel").value = c.telefono; sug.innerHTML = ""; $("#enc-producto").focus(); });
        } catch {}
      }, 300);
    };
    const ec = $("#enc-cliente"); if (ec) ec.oninput = encBuscar;
    const et = $("#enc-tel"); if (et) et.oninput = encBuscar;
  }
  cont.innerHTML = '<p class="meta">Cargando…</p>';
  try { ENCARGOS = ((await (await fetch("/api/admin/encargos")).json()).encargos) || []; renderEncargos(); }
  catch { cont.innerHTML = '<p class="meta">No se pudieron cargar.</p>'; }
}
async function nuevoEncargo() {
  const cliente = $("#enc-cliente").value.trim(), producto = $("#enc-producto").value.trim();
  if (!cliente || !producto) return toast("Poné cliente y qué pidió");
  const r = await api("/api/admin/encargos/nueva", { cliente, telefono: $("#enc-tel").value.trim(), producto, nota: $("#enc-nota").value.trim() });
  if (r && r.ok) { toast("🔔 Encargo anotado"); ["enc-cliente", "enc-tel", "enc-producto", "enc-nota"].forEach((k) => { const el = $("#" + k); if (el) el.value = ""; }); const s = $("#enc-sug"); if (s) s.innerHTML = ""; cargarEncargos(); } else toast((r && r.error) || "No se pudo");
}
function renderEncargos() {
  const cont = $("#enc-lista"); const verAv = $("#enc-ver-avisados") && $("#enc-ver-avisados").checked;
  let list = ENCARGOS.filter((e) => verAv ? true : e.estado !== "avisado");
  const pend = ENCARGOS.filter((e) => e.estado !== "avisado").length;
  $("#enc-meta").textContent = `${pend} activo(s) · ${ENCARGOS.length} total`;
  if (!list.length) { cont.innerHTML = '<p class="meta">No hay encargos.</p>'; return; }
  cont.innerHTML = list.map((e) => {
    const st = ENC_EST[e.estado] || ENC_EST.pendiente;
    const acc = [];
    if (e.estado === "pendiente") acc.push(`<button class="btn sm" data-enc-est="${e.id}|llego">📦 Llegó</button>`);
    if (e.estado === "llego") {
      if (e.telefono) acc.push(waBtn(e.telefono, waMsgEncargo(e.cliente, e.producto), "📱 Avisar"));
      acc.push(`<button class="btn sm" data-enc-est="${e.id}|avisado">✅ Marcar avisado</button>`);
    }
    if (e.estado === "avisado") acc.push(`<button class="btn ghost sm" data-enc-est="${e.id}|pendiente">↩︎ Reabrir</button>`);
    acc.push(`<button class="btn ghost sm" data-enc-del="${e.id}">✕</button>`);
    return `<div class="solic-card est-${st.c}">
      <div class="solic-head"><strong>${esc(e.producto)}</strong><span class="solic-badge ${st.c}">${st.i} ${st.t}</span></div>
      <div class="meta">👤 ${esc(e.cliente)}${e.telefono ? " · 📱 " + esc(e.telefono) : ""} · ${(e.creado || "").slice(0, 10)}</div>
      ${e.nota ? `<div class="solic-nota">📝 ${esc(e.nota)}</div>` : ""}
      <div class="solic-acc">${acc.join("")}</div>
    </div>`;
  }).join("");
  cont.querySelectorAll("[data-enc-est]").forEach((b) => b.onclick = async () => { const [id, estado] = b.dataset.encEst.split("|"); const r = await api("/api/admin/encargos/estado", { id, estado }); if (r && r.ok) cargarEncargos(); });
  cont.querySelectorAll("[data-enc-del]").forEach((b) => b.onclick = async () => { if (!confirm("¿Borrar este encargo?")) return; await api("/api/admin/encargos/borrar", { id: b.dataset.encDel }); cargarEncargos(); });
}
// ---------- SOLICITUDES (pedidos de mejora del equipo) ----------
const SOLIC_EST = {
  pendiente: { t: "Pendiente", i: "🕐", c: "pend" },
  aprobada: { t: "Aprobada", i: "👍", c: "aprob" },
  en_curso: { t: "En curso", i: "🔨", c: "curso" },
  lista: { t: "Lista", i: "🎉", c: "lista" },
  confirmada: { t: "Confirmada", i: "✅", c: "conf" },
  rechazada: { t: "Rechazada", i: "🫏", c: "rech" },
};
let SOLIC_DUENO = false, SOLIC_YO = "", SOLIC_LIST = [];
async function cargarSolicitudes() {
  const cont = $("#sol-lista"); if (!cont) return;
  const env = $("#sol-enviar"); if (env && !env._wired) { env._wired = 1; env.onclick = enviarSolicitud; const r = $("#sol-reload"); if (r) r.onclick = cargarSolicitudes; const vc = $("#sol-ver-conf"); if (vc) vc.onchange = () => renderSolicitudes(); }
  cont.innerHTML = '<p class="meta">Cargando…</p>';
  try {
    const d = await (await fetch("/api/solicitudes")).json();
    SOLIC_DUENO = !!d.dueno; SOLIC_YO = d.yo || "";
    renderSolicitudes(d.solicitudes || []);
  } catch { cont.innerHTML = '<p class="meta">No se pudieron cargar.</p>'; }
}
async function enviarSolicitud() {
  const titulo = $("#sol-titulo").value.trim(), detalle = $("#sol-detalle").value.trim();
  if (!titulo) return toast("Escribí un título");
  const r = await api("/api/solicitudes/nueva", { titulo, detalle });
  if (r && r.ok) { toast("✅ Sugerencia enviada"); $("#sol-titulo").value = ""; $("#sol-detalle").value = ""; cargarSolicitudes(); } else toast((r && r.error) || "No se pudo");
}
function renderSolicitudes(list) {
  if (list) SOLIC_LIST = list;
  const cont = $("#sol-lista"); if (!cont) return;
  const ver = $("#sol-ver-conf") && $("#sol-ver-conf").checked;
  const todas = SOLIC_LIST || [];
  const ocultas = todas.filter((s) => s.estado === "confirmada").length;
  const vis = todas.filter((s) => ver || s.estado !== "confirmada");
  $("#sol-meta").textContent = `${vis.length} solicitud(es)` + (ocultas && !ver ? ` · ${ocultas} confirmada(s) oculta(s)` : "");
  if (!vis.length) { cont.innerHTML = '<p class="meta">No hay solicitudes para mostrar.</p>'; return; }
  cont.innerHTML = vis.map((s) => {
    const e = SOLIC_EST[s.estado] || SOLIC_EST.pendiente;
    const acc = [];
    if (SOLIC_DUENO) {
      if (s.estado === "pendiente") { acc.push(`<button class="btn sm" data-sol-est="${s.id}|aprobada">👍 Aprobar</button>`); acc.push(`<button class="btn ghost sm" data-sol-est="${s.id}|rechazada">🫏 Rechazar</button>`); }
      if (s.estado === "aprobada") acc.push(`<button class="btn sm" data-sol-est="${s.id}|en_curso">🔨 Empezar</button>`);
      if (s.estado === "en_curso" || s.estado === "aprobada") acc.push(`<button class="btn sm" data-sol-est="${s.id}|lista">🎉 Marcar lista</button>`);
      acc.push(`<button class="btn ghost sm" data-sol-del="${s.id}">✕</button>`);
    }
    if (s.estado === "lista" && (s.de === SOLIC_YO || SOLIC_DUENO)) acc.push(`<button class="btn sm" data-sol-conf="${s.id}">✅ Confirmar que está OK</button>`);
    return `<div class="solic-card est-${e.c}">
      <div class="solic-head"><strong>${esc(s.titulo)}</strong><span class="solic-badge ${e.c}">${e.i} ${e.t}</span></div>
      ${s.detalle ? `<div class="solic-det">${esc(s.detalle)}</div>` : ""}
      <div class="meta">${SOLIC_DUENO && s.nombre ? "👤 " + esc(s.nombre) + " · " : ""}${(s.creado || "").slice(0, 10)}</div>
      ${s.nota ? `<div class="solic-nota">💬 ${esc(s.nota)}</div>` : ""}
      ${acc.length ? `<div class="solic-acc">${acc.join("")}</div>` : ""}
    </div>`;
  }).join("");
  cont.querySelectorAll("[data-sol-est]").forEach((b) => b.onclick = () => cambiarEstadoSolic(...b.dataset.solEst.split("|")));
  cont.querySelectorAll("[data-sol-conf]").forEach((b) => b.onclick = async () => { const r = await api("/api/solicitudes/confirmar", { id: b.dataset.solConf }); if (r && r.ok) { toast("✅ Confirmada, ¡gracias!"); cargarSolicitudes(); } });
  cont.querySelectorAll("[data-sol-del]").forEach((b) => b.onclick = async () => { if (!confirm("¿Borrar esta solicitud?")) return; await api("/api/solicitudes/borrar", { id: b.dataset.solDel }); cargarSolicitudes(); });
}
async function cambiarEstadoSolic(id, estado) {
  let nota;
  if (estado === "rechazada") nota = prompt("Motivo del rechazo (opcional):") || "";
  if (estado === "lista") nota = prompt("Explicá cómo probarlo (se le envía por email a quien lo pidió):") || "";
  const r = await api("/api/solicitudes/estado", { id, estado, ...(nota != null ? { nota } : {}) });
  if (r && r.ok) { toast("Actualizada"); cargarSolicitudes(); } else toast((r && r.error) || "No se pudo");
}

// ---------- RECIBIR MERCADERÍA POR FOTO (IA) ----------
let REC = { fotos: [], proveedor: "", fecha: "", total: 0, items: [] };
function recSlotOpts() { return (DATA.muebles.muebles || []).map((m) => `<optgroup label="${esc(m.nombre)}">${m.secciones.flatMap((s) => s.slots.map((sl) => `<option value="${sl.id}">${esc(sl.label)}</option>`)).join("")}</optgroup>`).join(""); }
function recSlotOptsSel(selId) { return (DATA.muebles.muebles || []).map((m) => `<optgroup label="${esc(m.nombre)}">${m.secciones.flatMap((s) => s.slots.map((sl) => `<option value="${sl.id}" ${sl.id === selId ? "selected" : ""}>${esc(sl.label)}</option>`)).join("")}</optgroup>`).join(""); }
// Ubicación recomendada para un producto: donde ya tiene stock (guardado > exhibición > depósito; entre iguales, el que más tiene)
function recUbicRecomendada(productId, variationId) {
  if (!productId) return null;
  const vId = variationId || null, rolRank = { guardado: 0, exhibicion: 1, deposito: 2 };
  const slotInfo = new Map();
  for (const m of (DATA.muebles.muebles || [])) for (const sec of (m.secciones || [])) for (const sl of (sec.slots || [])) slotInfo.set(sl.id, { rol: m.rol || "guardado", label: `${m.nombre} · ${sl.label}` });
  const cand = (DATA.ubicaciones.asignaciones || []).filter((a) => a.productId === productId && ((a.variationId || null) === vId || a.variationId == null));
  if (!cand.length) return null;
  cand.sort((a, b) => { const ra = rolRank[(slotInfo.get(a.slotId) || {}).rol] ?? 0, rb = rolRank[(slotInfo.get(b.slotId) || {}).rol] ?? 0; if (ra !== rb) return ra - rb; return (Number(b.cantidad) || 0) - (Number(a.cantidad) || 0); });
  const info = slotInfo.get(cand[0].slotId);
  return info ? { slotId: cand[0].slotId, label: info.label } : null;
}
let REC_PROV = [], REC_COSTOS = {};
async function cargarRecibir() {
  try { REC_PROV = ((await (await fetch("/api/admin/finanzas")).json()).proveedores) || []; } catch { REC_PROV = []; }
  try { REC_COSTOS = {}; const d = await (await fetch("/api/admin/costos")).json(); for (const p of (d.productos || [])) REC_COSTOS[p.id] = p.costo; } catch { REC_COSTOS = {}; }
  renderRecibir();
}
function calcCostoRec(precio, prov, iva) {
  let p = Number(precio) || 0;
  if (!prov) return Math.round(p);
  if (prov.forma === "publico_descuento") p = p * (1 - (Number(prov.descuento) || 0) / 100);
  if (prov.forma === "con_iva") return Math.round(p);
  return Math.round(p * (1 + (Number(iva != null ? iva : prov.iva) || 21) / 100));
}
function leerArchivo(f) { return new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); }); }
function renderRecibir() {
  const c = $("#recibir-app"); if (!c) return;
  const esPdf = (f) => /^data:application\/pdf/.test(f) || /\.pdf($|\?)/i.test(f);
  c.innerHTML = `
    <h3>📷 Recibir mercadería</h3>
    <p class="meta">Subí fotos o el PDF de la factura (todas las páginas). La IA detecta el proveedor y los artículos. Después asignás cada uno a su lugar y registrás la compra.</p>
    <div class="rec-fotos">${REC.fotos.map((f, i) => `<div class="rec-foto">${esPdf(f) ? '<div class="rec-pdf">📄 PDF</div>' : `<img src="${f}" alt="">`}<button class="rec-foto-x" data-recx="${i}">✕</button></div>`).join("")}<label class="rec-add">＋ Foto o PDF<input type="file" id="rec-file" accept="image/*,application/pdf" multiple hidden></label></div>
    <div class="rec-botones">
      <button class="btn" id="rec-analizar" ${REC.fotos.length ? "" : "disabled"}>🤖 Analizar con IA</button>
      <button class="btn ghost" id="rec-qr">📱 Subir desde el celular</button>
    </div>
    <div id="rec-qr-box"></div>
    <div id="rec-resultado"></div>`;
  $("#rec-file").onchange = async (e) => { for (const f of e.target.files) { const url = await leerArchivo(f); if (url) REC.fotos.push(url); } renderRecibir(); };
  c.querySelectorAll("[data-recx]").forEach((b) => b.onclick = () => { REC.fotos.splice(+b.dataset.recx, 1); renderRecibir(); });
  $("#rec-analizar").onclick = analizarFacturas;
  $("#rec-qr").onclick = abrirQRCelular;
  if (REC_QR.token) renderQRBox();
  if (REC.items.length || REC.proveedor) renderRecResultado();
}
let REC_QR = { token: null, url: null, timer: null };
async function abrirQRCelular() {
  const r = await api("/api/admin/recibir/qr-nuevo", {});
  if (!r || !r.ok) return toast("No se pudo generar el QR");
  REC_QR.token = r.token; REC_QR.url = r.url;
  renderQRBox();
  if (REC_QR.timer) clearInterval(REC_QR.timer);
  REC_QR.timer = setInterval(pollQRFotos, 3000);
}
function renderQRBox() {
  const box = $("#rec-qr-box"); if (!box || !REC_QR.url) return;
  const qrImg = "https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=" + encodeURIComponent(REC_QR.url);
  box.innerHTML = `<div class="rec-qr-card"><img src="${qrImg}" alt="QR" width="180" height="180"><div><b>Escaneá con tu celular 📱</b><div class="meta">Sacá las fotos de la factura desde el teléfono — aparecen acá solas.</div><a href="${esc(REC_QR.url)}" target="_blank" style="font-size:11px;word-break:break-all">${esc(REC_QR.url)}</a></div></div>`;
}
async function pollQRFotos() {
  if (!REC_QR.token) return;
  try {
    const d = await (await fetch("/api/admin/recibir/fotos?token=" + REC_QR.token)).json();
    let nuevas = 0;
    for (const url of (d.fotos || [])) if (!REC.fotos.includes(url)) { REC.fotos.push(url); nuevas++; }
    if (nuevas) { renderRecibir(); toast(nuevas + " archivo(s) recibido(s) del celular"); }
  } catch {}
}
async function analizarFacturas() {
  if (!REC.fotos.length) return;
  if (REC_QR.timer) { clearInterval(REC_QR.timer); REC_QR.timer = null; REC_QR.token = null; }
  const btn = $("#rec-analizar"); btn.disabled = true; btn.textContent = "Analizando… (puede tardar unos segundos)";
  const r = await api("/api/admin/recibir/analizar", { images: REC.fotos });
  btn.disabled = false; btn.textContent = "🤖 Analizar facturas con IA";
  if (r && r.ok) { REC.proveedor = r.proveedor; REC.fecha = r.fecha; REC.total = r.total; REC.items = (r.items || []).map((it) => ({ ...it, recibido: false })); renderRecibir(); }
  else toast((r && r.error) || "No se pudo analizar");
}
function renderRecResultado() {
  const cont = $("#rec-resultado"); if (!cont) return;
  const slotOpts = recSlotOpts();
  const prov = REC_PROV.find((p) => p.id === REC.proveedorId);
  cont.innerHTML = `
    <div class="rec-prov">
      <label>Proveedor (reglas de precio) <select id="rec-prov-sel"><option value="">— elegí para calcular el costo —</option>${REC_PROV.map((p) => `<option value="${p.id}" ${REC.proveedorId === p.id ? "selected" : ""}>${esc(p.nombre)}</option>`).join("")}</select></label>
      <label>Detectado <input id="rec-prov-in" value="${esc(REC.proveedor)}"></label>
      <button class="btn ghost sm" id="rec-prov-alta">➕ Dar de alta proveedor</button>
      <label>Fecha <input id="rec-fecha-in" type="date" value="${esc(REC.fecha)}"></label>
      <span class="meta">Total factura: ${fmtAR(REC.total)}</span>
    </div>
    ${(REC.proveedor && !REC_PROV.find((p) => norm(p.nombre) === norm(REC.proveedor))) ? `<p class="meta">⚠️ El proveedor <b>${esc(REC.proveedor)}</b> no está cargado. <b>➕ Dálo de alta</b> para guardar sus reglas de precio y calcular costos.</p>` : ""}
    ${prov ? `<p class="meta">Costo calculado según <b>${esc(prov.nombre)}</b>: ${formaTxt(prov.forma)} · IVA ${prov.iva}%${prov.descuento ? " · desc " + prov.descuento + "%" : ""}.</p>` : '<p class="meta">Elegí el proveedor para que calcule el costo de cada artículo (o se usa el precio tal cual).</p>'}
    <div class="rec-items">${REC.items.map((it, i) => `
      <div class="rec-item ${it.recibido ? "recibido" : ""}">
        <div class="rec-item-info"><b>${esc(it.descripcion)}</b><div class="rec-line"><span class="meta">${it.codigo ? "cód " + esc(it.codigo) + " · " : ""}${it.cantidad} u.</span> <span class="rec-precio">${fmtAR(it.precio_unitario)} c/u</span></div>
          <div class="rec-match">
            ${(it.match && !it._buscar) ? `✅ existe: ${esc(it.match.nombre)} <span class="meta">(stock ${it.match.stock})</span> <button class="rec-cambiar" data-cambiar="${i}">cambiar</button>${(!it.match.variationId && (DATA.catalogo.productos.find((p) => p.id === it.match.id)?.variaciones || []).length) ? ` <span class="rec-subtipo-warn">⚠️ es variable: tocá <b>cambiar</b> y elegí el subtipo</span>` : ""}${REC.items.some((x, j) => j !== i && x.match && x.match.id === it.match.id && (x.match.variationId || null) === (it.match.variationId || null)) ? ` <span class="rec-subtipo-warn">⚠️ otra línea va a este MISMO producto — ¿es correcto?</span>` : ""}` : ""}
            ${(!it.match || it._buscar) ? `<input class="rec-buscar" data-busca="${i}" placeholder="🔎 Buscar producto existente… (vacío = crear nuevo)" autocomplete="off"><div class="rec-sug" data-sug="${i}"></div>` : ""}
            <button class="btn ghost sm rec-crear" data-crear="${i}">🆕 Crear producto nuevo (editable)</button>
          </div>
          ${(it.match && !it._buscar) ? (() => {
            const prod = DATA.catalogo.productos.find((p) => p.id === it.match.id) || {};
            const vv = it.match.variationId ? (prod.variaciones || []).find((v) => v.id === it.match.variationId) : null;
            const precioAct = Number(vv ? vv.precio : prod.precio) || 0, costoAct = Number(REC_COSTOS[it.match.variationId || it.match.id]) || 0;
            const costoCalc = prov && it.precio_unitario ? calcCostoRec(it.precio_unitario, prov, it.iva) : null;
            const costoVal = it._costo != null ? it._costo : (costoCalc != null ? costoCalc : costoAct);
            const precioVal = it._precio != null ? it._precio : precioAct;
            const m = (precioVal > 0 && costoVal > 0) ? Math.round((1 - costoVal / precioVal) * 100) : null;
            return `<div class="rec-cp">
              ${costoCalc != null ? `<span class="rec-cp-calc" title="Costo según la factura y reglas del proveedor">factura: <b>${fmtAR(costoCalc)}</b></span>` : ""}
              <label>Costo $<input class="rec-cp-costo" data-ic="${i}" value="${costoVal}" inputmode="numeric"></label>
              <label>Precio venta $<input class="rec-cp-precio" data-ip="${i}" value="${precioVal}" inputmode="numeric"></label>
              <span class="rec-cp-margen ${m != null && m < 0 ? "neg" : ""}" data-im="${i}">margen ${m != null ? m + "%" : "—"}</span>
              ${costoAct ? `<span class="meta">antes ${fmtAR(costoAct)}</span>` : ""}
            </div>`;
          })() : ""}</div>
        <div class="rec-item-acc">
          cant <input class="rec-cant" data-ri="${i}" value="${it.cantidad}" style="width:50px" inputmode="numeric">
          ${prov && prov.forma !== "con_iva" ? `IVA <select class="rec-iva" data-ri="${i}"><option value="21" ${(it.iva ?? prov.iva) == 21 ? "selected" : ""}>21</option><option value="10.5" ${(it.iva ?? prov.iva) == 10.5 ? "selected" : ""}>10,5</option></select>` : ""}
          ${prov ? `<span class="rec-costo" title="Costo calculado">costo ${fmtAR(calcCostoRec(it.precio_unitario, prov, it.iva))}</span>` : ""}
          ${(() => { const rec = it.match ? recUbicRecomendada(it.match.id, it.match.variationId) : null; const sel = it._slot != null ? it._slot : (rec ? rec.slotId : ""); return `<select class="rec-slot" data-ri="${i}"><option value="">¿Dónde se guarda?</option>${recSlotOptsSel(sel)}</select>${rec && it._slot == null ? `<span class="rec-ubic-rec" title="Ya tenés stock de este producto acá">📍 recomendado: ${esc(rec.label)}</span>` : ""}`; })()}
          <label class="rec-venc-l">vence <input class="rec-venc" data-ri="${i}" type="date" value="${it._venc || ""}" title="Vencimiento del producto que llega (opcional)"></label>
          <button class="btn sm" data-recib="${i}" ${it.recibido ? "disabled" : ""}>${it.recibido ? "✓ Recibido" : "Recibir"}</button>
        </div>
      </div>`).join("")}</div>
    <button class="btn" id="rec-compra">💰 Registrar compra en Finanzas</button> <span class="meta" id="rec-msg"></span>`;
  const ps = $("#rec-prov-sel");
  if (ps) ps.onchange = () => { REC.proveedorId = ps.value; const pp = REC_PROV.find((x) => x.id === ps.value); if (pp) { REC.items.forEach((it) => { if (it.iva == null) it.iva = pp.iva; }); if (pp.nombre) REC.proveedor = pp.nombre; } renderRecResultado(); };
  const pa = $("#rec-prov-alta"); if (pa) pa.onclick = () => altaProveedorRapido(($("#rec-prov-in").value || REC.proveedor || "").trim(), (reg) => { REC_PROV.push(reg); REC.proveedorId = reg.id; REC.proveedor = reg.nombre; REC.items.forEach((it) => { if (it.iva == null) it.iva = reg.iva; }); renderRecResultado(); });
  // Antes de cualquier re-render, guarda lo tipeado en cada renglón (cantidad/venc) para que NUNCA se pierda
  const recSnap = () => {
    cont.querySelectorAll(".rec-cant").forEach((inp) => { const ri = +inp.dataset.ri; if (REC.items[ri] && inp.value !== "") REC.items[ri].cantidad = Number(inp.value) || 0; });
    cont.querySelectorAll(".rec-venc").forEach((inp) => { const ri = +inp.dataset.ri; if (REC.items[ri]) REC.items[ri]._venc = inp.value; });
    cont.querySelectorAll(".rec-cp-costo").forEach((inp) => { const ri = +inp.dataset.ic; if (REC.items[ri] && inp.value !== "") REC.items[ri]._costo = Number(inp.value) || 0; });
    cont.querySelectorAll(".rec-cp-precio").forEach((inp) => { const ri = +inp.dataset.ip; if (REC.items[ri] && inp.value !== "") REC.items[ri]._precio = Number(inp.value) || 0; });
  };
  cont.querySelectorAll(".rec-iva").forEach((s) => s.onchange = () => { recSnap(); REC.items[+s.dataset.ri].iva = Number(s.value); renderRecResultado(); });
  cont.querySelectorAll("[data-recib]").forEach((b) => b.onclick = () => recibirItem(+b.dataset.recib));
  cont.querySelectorAll("[data-cambiar]").forEach((b) => b.onclick = () => { recSnap(); REC.items[+b.dataset.cambiar]._buscar = true; renderRecResultado(); });
  cont.querySelectorAll("[data-crear]").forEach((b) => b.onclick = () => { recSnap(); crearProductoDesdeRecibo(+b.dataset.crear); });
  cont.querySelectorAll(".rec-cp-costo").forEach((inp) => inp.oninput = () => { REC.items[+inp.dataset.ic]._costo = Number(inp.value) || 0; recMargen(+inp.dataset.ic); });
  cont.querySelectorAll(".rec-cp-precio").forEach((inp) => inp.oninput = () => { REC.items[+inp.dataset.ip]._precio = Number(inp.value) || 0; recMargen(+inp.dataset.ip); });
  cont.querySelectorAll(".rec-slot").forEach((s) => s.onchange = () => { recSnap(); REC.items[+s.dataset.ri]._slot = s.value; renderRecResultado(); });
  cont.querySelectorAll(".rec-venc").forEach((inp) => inp.onchange = () => { inp.value = anio4(inp.value); REC.items[+inp.dataset.ri]._venc = inp.value; });
  cont.querySelectorAll(".rec-cant").forEach((inp) => inp.oninput = () => { REC.items[+inp.dataset.ri].cantidad = Number(inp.value) || 0; }); // persiste la cantidad: no se pierde al re-renderizar (ej. al crear un producto nuevo)
  cont.querySelectorAll("[data-busca]").forEach((inp) => inp.oninput = () => {
    const i = +inp.dataset.busca, q = norm(inp.value).trim(), sug = cont.querySelector(`[data-sug="${i}"]`);
    if (q.length < 2) { sug.innerHTML = ""; return; }
    const terms = q.split(/\s+/);
    const opts = []; // los productos VARIABLES se expanden en sus variaciones (subtipos) para poder asignar la medida correcta
    for (const p of DATA.catalogo.productos) {
      const baseHay = norm(p.nombre + " " + (p.sku || ""));
      if ((p.variaciones || []).length) {
        for (const v of p.variaciones) {
          if (terms.every((t) => (baseHay + " " + norm((v.label || "") + " " + (v.sku || ""))).includes(t)))
            opts.push({ id: p.id, nombre: p.nombre, sku: v.sku || p.sku || "", stock: v.stock != null ? v.stock : (p.stock || 0), variationId: v.id, variationLabel: v.label || "" });
          if (opts.length >= 12) break;
        }
      } else if (terms.every((t) => baseHay.includes(t))) {
        opts.push({ id: p.id, nombre: p.nombre, sku: p.sku || "", stock: p.stock || 0, variationId: null, variationLabel: "" });
      }
      if (opts.length >= 12) break;
    }
    REC.items[i]._sug = opts;
    sug.innerHTML = opts.map((o, k) => `<div class="rec-sug-it" data-pick="${i}|${k}">${esc(o.nombre)}${o.variationLabel ? ` — <b>${esc(o.variationLabel)}</b>` : ""} <span class="meta">${o.stock != null ? "stock " + o.stock : ""}${o.sku ? " · " + esc(o.sku) : ""}</span></div>`).join("") || '<div class="meta">Sin coincidencias</div>';
    sug.querySelectorAll("[data-pick]").forEach((el) => el.onclick = () => {
      const [ii, k] = el.dataset.pick.split("|").map(Number);
      const o = (REC.items[ii]._sug || [])[k]; if (!o) return;
      REC.items[ii].match = { id: o.id, nombre: o.nombre + (o.variationLabel ? " — " + o.variationLabel : ""), sku: o.sku, stock: o.stock, variationId: o.variationId || null, variationLabel: o.variationLabel || "" };
      REC.items[ii]._buscar = false; REC.items[ii]._aprender = true; // recordar este nombre para la próxima
      renderRecResultado();
    });
  });
  $("#rec-compra").onclick = registrarCompraRecibida;
}
// Crea un producto NUEVO (editable: nombre, categoría, precio, etc.) con los datos de la imagen.
// El producto se crea con la cantidad como existencias; queda asociado al ítem y se marca recibido (sin volver a sumar stock).
async function crearProductoDesdeRecibo(i) {
  const it = REC.items[i];
  const slotEl = $(`.rec-slot[data-ri="${i}"]`), cantEl = $(`.rec-cant[data-ri="${i}"]`);
  const slot = slotEl ? slotEl.value : "";
  const cant = Number(cantEl && cantEl.value) || it.cantidad || 0;
  const r = await api("/api/admin/producto-nuevo", { nombre: it.descripcion, sku: it.codigo || "", precio: (it._precio != null ? it._precio : it.precio_unitario) || "", stock: cant });
  if (!r || !r.ok) return toast((r && r.error) || "No se pudo crear el producto");
  const pid = r.id;
  if (slot) await api("/api/asignar", { productId: pid, slotId: slot, cantidad: cant, sumar: true }); // ubicación elegida en la grilla
  const prov = REC_PROV.find((p) => p.id === REC.proveedorId);
  const costo = it._costo != null ? Number(it._costo) : (prov && it.precio_unitario ? calcCostoRec(it.precio_unitario, prov, it.iva) : null);
  if (costo != null && costo > 0) { await api("/api/admin/costos", { cambios: { [pid]: costo } }); REC_COSTOS[pid] = costo; }
  if (it.descripcion) api("/api/admin/recibir/aprender", { descripcion: it.descripcion, productId: pid });
  it.match = { id: pid, nombre: it.descripcion, sku: it.codigo || "", stock: cant }; it._buscar = false; it.recibido = true;
  try { DATA = await (await fetch("/api/data")).json(); } catch {}
  toast("✅ Producto creado — completá la ficha");
  editarProducto(pid, REC.proveedorId); // abre el editor COMPLETO con el proveedor de la factura sugerido
}
// Recalcula y pinta el margen de un ítem sin re-renderizar (no pierde el foco del input)
function recMargen(i) {
  const it = REC.items[i]; if (!it || !it.match) return;
  const prod = DATA.catalogo.productos.find((p) => p.id === it.match.id) || {};
  const costo = it._costo != null ? Number(it._costo) : 0;
  const precio = it._precio != null ? Number(it._precio) : (Number(prod.precio) || 0);
  const m = (precio > 0 && costo > 0) ? Math.round((1 - costo / precio) * 100) : null;
  const span = document.querySelector(`.rec-cp-margen[data-im="${i}"]`);
  if (span) { span.textContent = "margen " + (m != null ? m + "%" : "—"); span.classList.toggle("neg", m != null && m < 0); }
}
async function recibirItem(i) {
  const it = REC.items[i];
  const cant = Number($(`.rec-cant[data-ri="${i}"]`).value) || it.cantidad || 0;
  const slot = $(`.rec-slot[data-ri="${i}"]`).value;
  const prov = REC_PROV.find((p) => p.id === REC.proveedorId);
  let pid, vid = null;
  if (it.match) {
    pid = it.match.id; vid = it.match.variationId || null; // variación (subtipo) si el producto es variable
    const prodCheck = DATA.catalogo.productos.find((p) => p.id === pid);
    if (prodCheck && (prodCheck.variaciones || []).length && !vid) { toast("Este producto es variable: tocá «cambiar» y elegí el subtipo (medida) antes de recibir, si no el stock no se suma."); return; }
    // Aviso: si OTRA línea de la factura ya apunta al mismo producto/variación (típico con nombres parecidos, ej. los detergentes)
    const dup = REC.items.some((x, idx) => idx !== i && x.match && x.match.id === pid && (x.match.variationId || null) === vid);
    if (dup && !confirm(`⚠️ OJO: hay otra línea de esta factura que también va al producto:\n\n${it.match.nombre}\n\nNormalmente cada línea es un producto distinto. Si los nombres son parecidos (ej. bi/multi/trienzimático), quizás tengas que elegir el producto correcto con «cambiar».\n\n¿Recibir igual en este producto?`)) return;
    await api("/api/admin/stock", { productId: pid, variationId: vid, stock: cant, sumar: true }); // SUMA al stock actual (no pisa: 2 líneas del mismo producto acumulan)
    // precio de venta: si lo editaste y cambió, actualizalo en WooCommerce (en la variación si corresponde)
    const prod = DATA.catalogo.productos.find((p) => p.id === pid);
    const precioAct = vid && prod ? (Number((prod.variaciones || []).find((v) => v.id === vid)?.precio) || 0) : (Number(prod && prod.precio) || 0);
    if (it._precio != null && Math.round(Number(it._precio)) !== Math.round(precioAct)) await api("/api/admin/precio", { productId: pid, variationId: vid, precio: Math.round(Number(it._precio)) });
  } else {
    const r = await api("/api/admin/producto-nuevo", { nombre: it.descripcion, sku: it.codigo || "", precio: (it._precio != null ? it._precio : it.precio_unitario) || "", stock: cant });
    if (!r || !r.ok) return toast((r && r.error) || "No se pudo crear el producto");
    pid = r.id;
  }
  if (slot) await api("/api/asignar", { productId: pid, variationId: vid, slotId: slot, cantidad: cant, sumar: true }); // SUMA a lo que ya hay en esa ubicación (a la variación si corresponde)
  // Vencimiento del producto que llega: se agrega en la ubicación elegida; si ya existe esa misma fecha ahí, suma la cantidad
  const venc = anio4((() => { const el = $(`.rec-venc[data-ri="${i}"]`); return el ? el.value : (it._venc || ""); })());
  if (venc) { await api("/api/admin/vencimiento-sumar", { productId: pid, variationId: vid, nombre: it.match ? it.match.nombre : it.descripcion, codigo: it.codigo || "", fecha: venc, cantidad: cant, ubicacion: slot ? slotTxt(slot) : "" }); try { VENC = await (await fetch("/api/admin/vencimientos")).json(); rebuildVencMap(); } catch {} }
  // COSTO: el editado a mano manda; si no, el calculado por reglas del proveedor (a nivel variación si corresponde)
  const costoFinal = it._costo != null ? Number(it._costo) : (prov && it.precio_unitario ? calcCostoRec(it.precio_unitario, prov, it.iva) : null);
  if (costoFinal != null && costoFinal > 0) { const ck = vid || pid; await api("/api/admin/costos", { cambios: { [ck]: costoFinal } }); REC_COSTOS[ck] = costoFinal; }
  // aprende: este nombre de la factura ya queda asociado a este producto para la próxima
  if (it.descripcion) api("/api/admin/recibir/aprender", { descripcion: it.descripcion, productId: pid });
  it.recibido = true; toast("✅ Recibido");
  try { DATA = await (await fetch("/api/data")).json(); } catch {}
  const np = DATA.catalogo.productos.find((p) => p.id === pid); // refresca el stock que muestran otras líneas del mismo producto
  if (np) REC.items.forEach((x) => { if (x.match && x.match.id === pid) { const xv = x.match.variationId ? (np.variaciones || []).find((v) => v.id === x.match.variationId) : null; x.match.stock = xv ? (xv.stock != null ? xv.stock : x.match.stock) : np.stock; } });
  renderRecibir();
}
async function registrarCompraRecibida() {
  const detalle = (REC.items || []).map((it) => ({
    nombre: it.match ? it.match.nombre : it.descripcion, codigo: it.codigo || (it.match && it.match.sku) || "",
    cantidad: Number(it.cantidad) || 0,
    precio_unit: Math.round(Number(it._precio != null ? it._precio : it.precio_unitario) || 0),
    costo: it._costo != null ? Math.round(Number(it._costo)) : null,
    productId: it.match ? it.match.id : null, variationId: it.match ? (it.match.variationId || null) : null,
  }));
  const r = await api("/api/admin/finanzas/agregar", { coleccion: "compras", registro: { proveedor: ($("#rec-prov-in").value || "").trim(), monto: REC.total, fecha: $("#rec-fecha-in").value || "", estado: "pendiente", nota: "Compra recibida por factura (" + REC.items.length + " ítems)", detalle } });
  if (r && r.ok) { $("#rec-msg").textContent = "✅ Registrada en Finanzas → Compras (queda pendiente de pago)"; toast("Compra registrada"); }
  else toast((r && r.error) || "No se pudo registrar");
}

// ---------- POS / NUEVA VENTA ----------
let VENTA = { items: [], cliente: null, envio: "retiro", pago: "transferencia", envioCosto: 0 };
let VENTA_AJ = { envio_tuc_fijo: 0, envio_tuc_gratis_desde: 0 };
// Provincias AR con código WooCommerce (para calcular Andreani igual que la web)
const VT_PROV = [["", "Provincia…"], ["B", "Buenos Aires"], ["C", "CABA"], ["K", "Catamarca"], ["H", "Chaco"], ["U", "Chubut"], ["X", "Córdoba"], ["W", "Corrientes"], ["E", "Entre Ríos"], ["P", "Formosa"], ["Y", "Jujuy"], ["L", "La Pampa"], ["F", "La Rioja"], ["M", "Mendoza"], ["N", "Misiones"], ["Q", "Neuquén"], ["R", "Río Negro"], ["A", "Salta"], ["J", "San Juan"], ["D", "San Luis"], ["Z", "Santa Cruz"], ["S", "Santa Fe"], ["G", "Santiago del Estero"], ["V", "Tierra del Fuego"], ["T", "Tucumán"]];
function vtProvCode(nombre) { if (!nombre) return ""; const n = String(nombre).trim().toLowerCase(); const f = VT_PROV.find(([c, l]) => c && l.toLowerCase() === n); return f ? f[0] : (VT_PROV.find(([c]) => c === String(nombre).toUpperCase()) ? String(nombre).toUpperCase() : ""); }
let _vtTimer;
async function cargarVenta() {
  try { VENTA_AJ = await (await fetch("/api/admin/ajustes")).json(); } catch {}
  const bq = $("#vt-buscar"); if (bq) bq.oninput = () => renderVentaResultados(bq.value);
  const cq = $("#vt-cli-q"); if (cq) cq.oninput = () => { clearTimeout(_vtTimer); _vtTimer = setTimeout(() => buscarClienteVenta(cq.value), 250); };
  renderVentaCart(); renderVentaResto(); cargarPresupuestos();
}
let PRESUP_CACHE = [];
async function cargarPresupuestos() {
  const c = $("#vt-presupuestos"); if (!c) return;
  let list = [];
  try { list = (await (await fetch("/api/admin/presupuestos")).json()).presupuestos || []; } catch {}
  PRESUP_CACHE = list;
  if (!list.length) { c.innerHTML = ""; return; }
  c.innerHTML = `<h3 style="margin:18px 0 8px">📝 Presupuestos guardados (${list.length})</h3>` + list.map((p) => `
    <div class="vt-presup">
      <div><strong>${esc(p.cliente?.nombre || p.cliente?.email || "Consumidor final")}</strong> — ${fmtAR(p.total)}
        <div class="meta">${(p.fecha || "").slice(0, 10)} · ${(p.items || []).length} ítem(s) · ${esc(p.pago || "")}${p.envio?.costo ? " · 🚚 " + fmtAR(p.envio.costo) : (p.envio?.tipo === "retiro" ? " · 🚚 retiro" : "")}</div></div>
      <div class="vt-presup-acc">${waBtn(p.cliente?.telefono, waMsgPresupuesto(p.cliente?.nombre || p.cliente?.email, p.total), "📱 Seguir")}<button class="btn sm" data-presabrir="${p.id}">Abrir</button><button class="btn ghost sm" data-presdel="${p.id}">✕</button></div>
    </div>`).join("");
  c.querySelectorAll("[data-presabrir]").forEach((b) => b.onclick = () => abrirPresupuesto(b.dataset.presabrir));
  c.querySelectorAll("[data-presdel]").forEach((b) => b.onclick = async () => { if (!confirm("¿Borrar este presupuesto?")) return; await api("/api/admin/presupuesto/borrar", { id: b.dataset.presdel }); cargarPresupuestos(); });
}
function abrirPresupuesto(id) {
  const p = PRESUP_CACHE.find((x) => x.id === id); if (!p) return;
  VENTA = { items: (p.items || []).map((i) => ({ ...i })), cliente: p.cliente || null, envio: "retiro", pago: p.pago || "transferencia", envioCosto: p.envio?.envioCosto || 0, _presupuestoId: p.id };
  renderVentaCart(); renderVentaResto();
  toast("Presupuesto cargado — revisá y registrá la venta");
  window.scrollTo({ top: 0, behavior: "smooth" });
}
async function guardarPresupuesto() {
  if (!VENTA.items.length) return toast("Agregá productos");
  const sub = ventaSubtotal(), envio = ventaEnvioCosto();
  const body = { items: VENTA.items.map((i) => ({ key: i.key, id: i.id, variationId: i.variationId, label: i.label, precio: i.precio, qty: i.qty, imagen: i.imagen || "" })), cliente: VENTA.cliente, envio: { tipo: VENTA.envio, costo: envio, envioCosto: VENTA.envioCosto }, pago: VENTA.pago, total: sub + envio };
  const r = await api("/api/admin/presupuesto", body);
  if (r && r.ok) { if (VENTA._presupuestoId) await api("/api/admin/presupuesto/borrar", { id: VENTA._presupuestoId }); toast("💾 Presupuesto guardado"); VENTA = { items: [], cliente: null, envio: "retiro", pago: "transferencia", envioCosto: 0 }; renderVentaCart(); renderVentaResto(); cargarPresupuestos(); }
  else toast((r && r.error) || "No se pudo guardar");
}
// Stock de un producto para mostrar en la búsqueda del POS (suma variaciones si es variable)
function ventaStock(p) {
  let st, any;
  if (p.tipo === "variable" && (p.variaciones || []).length) {
    st = p.variaciones.reduce((s, v) => s + (Number(v.stock) || 0), 0);
    any = p.variaciones.some((v) => v.stock_status === "instock" && v.stock !== 0);
  } else { st = Number(p.stock) || 0; any = p.stock_status === "instock" && p.stock !== 0; }
  if (!any) return { txt: "sin stock", cls: "no" };
  if (st && st <= 3) return { txt: `stock ${st}`, cls: "low" };
  return { txt: `stock ${st || "✓"}`, cls: "ok" };
}
function renderVentaResultados(q) {
  const cont = $("#vt-resultados"); if (!cont) return;
  q = norm(q).trim();
  if (q.length < 2) { cont.innerHTML = ""; return; }
  const terms = q.split(/\s+/);
  const list = DATA.catalogo.productos.filter((p) => terms.every((t) => norm(p.nombre + " " + p.sku).includes(t))).slice(0, 8);
  cont.innerHTML = list.map((p) => { const s = ventaStock(p); return `<div class="vt-res" data-add="${p.id}"><span>${esc(p.nombre)}${p.tipo === "variable" ? " (medidas)" : ""} ${p.sku ? `<small class="vt-res-sku">#${esc(p.sku)}</small>` : ""} <small class="vt-res-stock ${s.cls}">${s.txt}</small></span><span class="vt-res-p">${p.precio ? fmtAR(p.precio) : ""} ＋</span></div>`; }).join("") || '<p class="meta">Sin resultados.</p>';
  cont.querySelectorAll("[data-add]").forEach((el) => el.onclick = () => agregarItemVenta(Number(el.dataset.add)));
}
function agregarItemVenta(pid) {
  const p = DATA.catalogo.productos.find((x) => x.id === pid); if (!p) return;
  if (p.tipo === "variable" && (p.variaciones || []).length) {
    openModal(`Elegí la medida — ${esc(p.nombre)}`, `
      <label class="meta" style="display:block;margin-bottom:6px">Medida / variación</label>
      <select id="vt-var-sel" class="vt-input">${p.variaciones.map((v) => `<option value="${v.id}">${esc(v.label)} — ${fmtAR(v.precio)}${(v.stock_status !== "instock" || v.stock === 0) ? " (sin stock)" : ""}</option>`).join("")}</select>
      <button class="btn" id="vt-var-ok" style="margin-top:10px">Agregar al carrito</button>`);
    $("#vt-var-ok").onclick = () => {
      const vv = p.variaciones.find((x) => x.id === Number($("#vt-var-sel").value)); if (!vv) return;
      _addVentaItem(p, vv.id, p.nombre + " — " + vv.label, vv.precio); closeModal();
    };
    return;
  }
  _addVentaItem(p, null, p.nombre, p.precio);
}
function _addVentaItem(p, variationId, label, precio) {
  const key = p.id + "|" + (variationId || "");
  const ex = VENTA.items.find((i) => i.key === key);
  if (ex) ex.qty++; else VENTA.items.push({ key, id: p.id, variationId, label, precio: precio || 0, qty: 1, imagen: p.imagen || "", sku: p.sku || "" });
  const bq = $("#vt-buscar"); if (bq) bq.value = ""; const rr = $("#vt-resultados"); if (rr) rr.innerHTML = "";
  renderVentaCart(); renderVentaResto();
}
function ventaSubtotal() { return VENTA.items.reduce((s, i) => s + (Number(i.precio) || 0) * i.qty, 0); }
function ventaEnvioCosto() {
  if (VENTA.envio === "local") { const sub = ventaSubtotal(), desde = Number(VENTA_AJ.envio_tuc_gratis_desde) || 0, fijo = Number(VENTA_AJ.envio_tuc_fijo) || 0; return (desde > 0 && sub >= desde) ? 0 : fijo; }
  if (VENTA.envio === "andreani") return Number(VENTA.envioCosto) || 0;
  return 0;
}
function renderVentaCart() {
  const c = $("#vt-cart"); if (!c) return;
  if (!VENTA.items.length) { c.innerHTML = '<p class="meta">Agregá productos buscándolos arriba.</p>'; return; }
  const sub = ventaSubtotal(), envio = ventaEnvioCosto(), total = sub + envio;
  c.innerHTML = VENTA.items.map((i, idx) => {
    const prod = DATA.catalogo.productos.find((x) => x.id === i.id) || {};
    const img = i.imagen || prod.imagen;
    let stockN, sku = i.sku || prod.sku || "";
    if (i.variationId) { const v = (prod.variaciones || []).find((x) => x.id === i.variationId) || {}; stockN = Number(v.stock) || 0; sku = v.sku || prod.sku || sku; }
    else stockN = Number(prod.stock) || 0;
    const info = [];
    if (sku) info.push("Cód: " + esc(sku));
    info.push("📦 Stock: " + stockN);
    return `<div class="vt-ci">
    <div class="vt-ci-img">${img ? `<img src="${esc(img)}" alt="" loading="lazy">` : "🦷"}</div>
    <div class="vt-ci-body">
      <div class="vt-ci-n">${esc(i.label)}</div>
      <div class="vt-ci-info">${info.join(" · ")}</div>
      <div class="vt-ci-r">
        <button class="vt-q" data-vq="${idx}|-1">−</button><span class="vt-qn">${i.qty}</span><button class="vt-q" data-vq="${idx}|1">＋</button>
        <span class="vt-pp">$<input class="vt-precio" data-vp="${idx}" value="${i.precio}" inputmode="numeric"></span>
        <b>${fmtAR((Number(i.precio) || 0) * i.qty)}</b>
        <button class="vt-del" data-vdel="${idx}" title="Quitar">✕</button>
      </div>
    </div></div>`; }).join("") +
    `<div class="vt-cart-total">
      <div class="vt-ct-line"><span>Subtotal</span><b>${fmtAR(sub)}</b></div>
      ${envio ? `<div class="vt-ct-line"><span>Envío</span><b>${fmtAR(envio)}</b></div>` : ""}
      <div class="vt-ct-big"><span>TOTAL</span><b>${fmtAR(total)}</b></div>
    </div>
    <button class="btn ghost vt-ver-btn" id="vt-ver">👁️ Ver carrito (resumen para el cliente)</button>`;
  const vv = $("#vt-ver"); if (vv) vv.onclick = verCarritoCliente;
  c.querySelectorAll("[data-vq]").forEach((b) => b.onclick = () => { const [i, d] = b.dataset.vq.split("|").map(Number); VENTA.items[i].qty = Math.max(1, VENTA.items[i].qty + d); renderVentaCart(); renderVentaResto(); });
  c.querySelectorAll("[data-vp]").forEach((inp) => inp.onchange = () => { VENTA.items[+inp.dataset.vp].precio = Number(inp.value) || 0; renderVentaCart(); renderVentaResto(); });
  c.querySelectorAll("[data-vdel]").forEach((b) => b.onclick = () => { VENTA.items.splice(+b.dataset.vdel, 1); renderVentaCart(); renderVentaResto(); });
}
// Resumen del carrito listo para mandarle al cliente (productos, cantidades, precios, envío, total)
function verCarritoCliente() {
  if (!VENTA.items.length) return toast("El carrito está vacío");
  const sub = ventaSubtotal(), envio = ventaEnvioCosto(), total = sub + envio;
  const cl = VENTA.cliente;
  const filas = VENTA.items.map((i) => { const img = i.imagen || (DATA.catalogo.productos.find((x) => x.id === i.id) || {}).imagen; return `<div class="share-item">
      ${img ? `<img class="share-item-img" src="${esc(img)}" alt="">` : `<div class="share-item-img ph">🦷</div>`}
      <div class="share-item-info"><div class="share-item-n">${esc(i.label)}</div><div class="share-item-pu">${i.qty} × ${fmtAR(i.precio)}</div></div>
      <div class="share-item-sub">${fmtAR((Number(i.precio) || 0) * i.qty)}</div>
    </div>`; }).join("");
  const envioTxt = VENTA.envio === "retiro" ? "Retiro en el local" : VENTA.envio === "local" ? "Envío en Tucumán" : "Envío (Andreani / otro)";
  const envioVal = VENTA.envio === "retiro" ? "Gratis" : (envio ? fmtAR(envio) : "a coordinar");
  openModal("Resumen para el cliente", `
    <div class="share-doc" id="share-doc">
      <img class="share-logo" src="/assets/logo.png" alt="El Pasaje Dental">
      ${cl ? `<div class="share-cli">Para: <b>${esc(cl.nombre || cl.email || "")}</b></div>` : ""}
      <div class="share-items">${filas}</div>
      <div class="share-tot">
        <div><span>Subtotal</span><b>${fmtAR(sub)}</b></div>
        <div><span>${envioTxt}</span><b>${envioVal}</b></div>
        <div class="big"><span>TOTAL</span><b>${fmtAR(total)}</b></div>
      </div>
      <div class="share-foot">El Pasaje Dental · elpasajedental.com</div>
    </div>
    <div class="share-actions"><button class="btn" id="share-pdf">📄 Generar PDF</button></div>
    <p class="meta share-hint">📄 Generá el PDF para mandárselo, o 📸 sacá una captura.</p>`);
  const pb = document.getElementById("share-pdf"); if (pb) pb.onclick = generarResumenPDF;
}
// PDF del resumen del carrito para mandar al cliente (abre ventana de impresión → Guardar como PDF)
function generarResumenPDF() {
  if (!VENTA.items.length) return toast("El carrito está vacío");
  const sub = ventaSubtotal(), envio = ventaEnvioCosto(), total = sub + envio;
  const cl = VENTA.cliente;
  const envioTxt = VENTA.envio === "retiro" ? "Retiro en el local" : VENTA.envio === "local" ? "Envío en Tucumán" : (VENTA.envioTitulo || "Envío (Andreani / otro)");
  const envioVal = VENTA.envio === "retiro" ? "Gratis" : (envio ? fmtAR(envio) : "a coordinar");
  const hoy = new Date().toLocaleDateString("es-AR");
  const filas = VENTA.items.map((i) => { const img = i.imagen || (DATA.catalogo.productos.find((x) => x.id === i.id) || {}).imagen; return `<div class="it">
      <div class="ph">${img ? `<img src="${esc(img)}" onerror="this.style.display='none';this.parentNode.innerHTML='🦷'">` : "🦷"}</div>
      <div class="nm">${esc(i.label)}<div class="q">${i.qty} × ${fmtAR(i.precio)}</div></div>
      <div class="sb">${fmtAR((Number(i.precio) || 0) * i.qty)}</div>
    </div>`; }).join("");
  const w = window.open("", "_blank");
  if (!w) return toast("Permití las ventanas emergentes para generar el PDF");
  w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title> </title><style>
    @page{size:A4 portrait;margin:14mm}
    *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    body{margin:0;font-family:'Helvetica Neue',Arial,sans-serif;color:#2a1622;background:#fff}
    .sheet{max-width:180mm;margin:0 auto}
    .tip{background:#fff;border:1px dashed #DE3667;color:#7a1040;font-size:13px;padding:10px 14px;border-radius:10px;margin-bottom:18px;text-align:center}
    .head{text-align:center;margin-bottom:18px}
    .head img{height:74px}
    .head .t{font-size:22px;font-weight:800;color:#7a1040;margin-top:6px}
    .head .d{font-size:12px;color:#a8949e;margin-top:2px}
    .cli{font-size:14px;margin:0 0 14px;padding:9px 12px;background:#fdf2f8;border:1px solid #f3c9dd;border-radius:10px}
    .it{display:flex;align-items:center;gap:12px;padding:10px 4px;border-bottom:1px solid #f0d5e2;break-inside:avoid}
    .it .ph{width:50px;height:50px;display:flex;align-items:center;justify-content:center;font-size:26px;flex:0 0 auto}
    .it .ph img{max-width:50px;max-height:50px;object-fit:contain}
    .it .nm{flex:1;font-weight:700;font-size:14px}
    .it .nm .q{font-weight:500;color:#8a7680;font-size:12.5px;margin-top:2px}
    .it .sb{font-weight:800;color:#DE3667;font-size:15px;white-space:nowrap}
    .tot{margin-top:16px;margin-left:auto;width:230px}
    .tot div{display:flex;justify-content:space-between;padding:5px 0;font-size:14px}
    .tot .big{border-top:2px solid #DE3667;margin-top:6px;padding-top:8px;font-size:19px;font-weight:800;color:#7a1040}
    .foot{margin-top:26px;text-align:center;font-size:12px;color:#7a1040;border-top:3px solid #DE3667;padding-top:10px}
    .foot b{color:#b02060}
    @media print{.tip{display:none}}
  </style></head><body>
    <div class="sheet">
    <div class="tip">💡 En el cuadro de impresión elegí <b>"Guardar como PDF"</b> y destildá <b>"Encabezados y pies de página"</b>.</div>
    <div class="head"><img src="/assets/logo.png" onerror="this.style.display='none'"><div class="t">Resumen de tu pedido</div><div class="d">${hoy}</div></div>
    ${cl ? `<div class="cli">Para: <b>${esc(cl.nombre || cl.email || "")}</b>${cl.telefono ? ` · ${esc(cl.telefono)}` : ""}</div>` : ""}
    <div class="items">${filas}</div>
    <div class="tot">
      <div><span>Subtotal</span><b>${fmtAR(sub)}</b></div>
      <div><span>${envioTxt}</span><b>${envioVal}</b></div>
      <div class="big"><span>TOTAL</span><b>${fmtAR(total)}</b></div>
    </div>
    <div class="foot"><b>El Pasaje Dental</b> · elpasajedental.com · 📍 Tucumán · 📱 WhatsApp 381 208 5383</div>
    </div>
    <script>window.onload=function(){var i=[].slice.call(document.images),n=i.filter(function(x){return !x.complete}).length;function go(){if(--n<=0)window.print();}if(!n){window.print();}else{i.forEach(function(x){if(!x.complete){x.addEventListener('load',go);x.addEventListener('error',go);}});}setTimeout(function(){try{window.print()}catch(e){}},3500);};<\/script>
  </body></html>`);
  w.document.close();
}
async function buscarClienteVenta(q) {
  const cont = $("#vt-cli-sug"); if (!cont) return;
  if ((q || "").trim().length < 3) { cont.innerHTML = ""; return; }
  try {
    const d = await (await fetch("/api/admin/clientes/buscar?q=" + encodeURIComponent(q))).json();
    cont.innerHTML = (d.clientes || []).map((c, i) => `<div class="vt-cli-item" data-cli="${i}"><strong>${esc(c.nombre || c.email)}</strong><small>${esc(c.telefono || "")} · ${esc(c.email || "")}</small></div>`).join("") || '<p class="meta">Sin coincidencias. Se carga como consumidor final.</p>';
    cont.querySelectorAll("[data-cli]").forEach((el) => el.onclick = () => { VENTA.cliente = d.clientes[+el.dataset.cli]; cont.innerHTML = ""; $("#vt-cli-q").value = ""; renderVentaResto(); });
  } catch {}
}
function renderClienteSelVenta() {
  const c = $("#vt-cli-sel"); if (!c) return;
  const cl = VENTA.cliente;
  if (cl) {
    const e = cl.entrega;
    const dir = e && e.calle ? [e.calle, e.ciudad, e.provincia, e.cp].filter(Boolean).join(", ") : "⚠️ sin dirección cargada";
    c.innerHTML = `<div class="vt-cli-card"><div><strong>${esc(cl.nombre || cl.email)}</strong> ${cl._nuevo ? '<span class="cli-tag woo">nuevo</span>' : ""} <button class="vt-cli-x" id="vt-cli-quitar">cambiar</button></div>
      <div class="meta">📞 ${esc(cl.telefono || "—")} · ✉️ ${esc(cl.email || "—")}${cl.doc ? " · 🧾 CUIT/DNI " + esc(cl.doc) : ""}</div>
      <div class="meta">📦 ${esc(dir)}</div></div>`;
    $("#vt-cli-quitar").onclick = () => { VENTA.cliente = null; renderVentaResto(); };
    return;
  }
  if (VENTA._nuevoCli) {
    c.innerHTML = `<div class="vt-nuevocli"><strong>➕ Cliente nuevo</strong>
      <input id="nc-nombre" placeholder="Nombre y apellido *" autocomplete="off">
      <input id="nc-tel" placeholder="Teléfono / WhatsApp" inputmode="tel" autocomplete="off">
      <div id="nc-sug" class="nc-sug"></div>
      <input id="nc-email" type="email" placeholder="Email *">
      <input id="nc-doc" placeholder="CUIT / DNI (para la factura)" inputmode="numeric">
      <input id="nc-calle" placeholder="Dirección (calle y número)">
      <div class="nc-row"><input id="nc-ciudad" placeholder="Localidad"><input id="nc-prov" placeholder="Provincia"><input id="nc-cp" placeholder="CP"></div>
      <div class="nc-acc"><button class="btn sm" id="nc-ok">Usar este cliente</button><button class="btn ghost sm" id="nc-cancel">Cancelar</button></div></div>`;
    // Búsqueda en vivo por nombre o teléfono: trae clientes existentes para no duplicar y autocompletar
    let _ncT;
    const ncBuscar = () => {
      clearTimeout(_ncT);
      _ncT = setTimeout(async () => {
        const sug = $("#nc-sug"); if (!sug) return;
        const q = ($("#nc-nombre").value.trim() + " " + $("#nc-tel").value.trim()).trim();
        if (q.length < 3) { sug.innerHTML = ""; return; }
        try {
          const d = await (await fetch("/api/admin/clientes/buscar?q=" + encodeURIComponent(q))).json();
          const list = d.clientes || [];
          sug.innerHTML = list.length ? `<div class="nc-sug-t">👇 Ya existe — tocá para traer sus datos:</div>` + list.map((c2, i) => `<div class="vt-cli-item" data-ncpick="${i}"><strong>${esc(c2.nombre || c2.email)}</strong><small>${esc(c2.telefono || "")} · ${esc(c2.email || "")}</small></div>`).join("") : "";
          sug.querySelectorAll("[data-ncpick]").forEach((el) => el.onclick = () => { VENTA.cliente = list[+el.dataset.ncpick]; VENTA._nuevoCli = false; renderVentaResto(); });
        } catch {}
      }, 300);
    };
    $("#nc-nombre").oninput = ncBuscar;
    $("#nc-tel").oninput = ncBuscar;
    $("#nc-ok").onclick = () => {
      const nombre = $("#nc-nombre").value.trim(), email = $("#nc-email").value.trim();
      if (!nombre || !email) return toast("Poné al menos nombre y email");
      VENTA.cliente = { nombre, email, telefono: $("#nc-tel").value.trim(), doc: ($("#nc-doc").value || "").replace(/\D/g, ""), entrega: { calle: $("#nc-calle").value.trim(), ciudad: $("#nc-ciudad").value.trim(), provincia: $("#nc-prov").value.trim(), cp: $("#nc-cp").value.trim() }, _nuevo: true };
      VENTA._nuevoCli = false; renderVentaResto();
    };
    $("#nc-cancel").onclick = () => { VENTA._nuevoCli = false; renderVentaResto(); };
    return;
  }
  c.innerHTML = '<p class="meta">Sin cliente (consumidor final). <button class="btn ghost sm" id="vt-nuevocli">➕ Cargar cliente nuevo</button></p>';
  $("#vt-nuevocli").onclick = () => { VENTA._nuevoCli = true; renderVentaResto(); };
}
function renderVentaResto() {
  renderClienteSelVenta();
  const c = $("#vt-resto"); if (!c) return;
  const sub = ventaSubtotal(), envio = ventaEnvioCosto(), total = sub + envio;
  const fijo = Number(VENTA_AJ.envio_tuc_fijo) || 0, desde = Number(VENTA_AJ.envio_tuc_gratis_desde) || 0;
  const localTxt = (desde > 0 && sub >= desde) ? "GRATIS ✅" : (fijo ? fmtAR(fijo) : "a definir");
  c.innerHTML = `
    <h3>🚚 Envío</h3>
    <div class="vt-envio">
      <label><input type="radio" name="vt-env" value="retiro" ${VENTA.envio === "retiro" ? "checked" : ""}> Retiro en el local (gratis)</label>
      <label><input type="radio" name="vt-env" value="local" ${VENTA.envio === "local" ? "checked" : ""}> Envío en Tucumán (${localTxt})</label>
      <label><input type="radio" name="vt-env" value="andreani" ${VENTA.envio === "andreani" ? "checked" : ""}> 📦 Andreani / otro (a domicilio)</label>
      ${VENTA.envio === "andreani" ? andreaniBlock() : ""}
    </div>
    <h3>💳 Pago</h3>
    <select id="vt-pago" class="vt-input">
      <option value="transferencia">Transferencia</option><option value="efectivo">Efectivo</option><option value="mp">Mercado Pago</option><option value="ctacte">Cuenta corriente (no pagado)</option>
    </select>
    <div class="vt-totales"><span>Subtotal: <b>${fmtAR(sub)}</b></span><span>Envío: <b>${fmtAR(envio)}</b></span><span class="vt-total-big">Total: ${fmtAR(total)}</span></div>
    <label class="vt-reparto"><input type="checkbox" id="vt-reparto" ${VENTA.envio === "local" ? "checked" : ""}> 🛵 Marcar para reparto (el cadete lo lleva — aparece en Reparto)</label>
    <div class="vt-acciones">
      <button class="btn" id="vt-registrar" ${VENTA.items.length ? "" : "disabled"}>✅ Registrar venta</button>
      <button class="btn ghost" id="vt-presup" ${VENTA.items.length ? "" : "disabled"}>💾 Guardar presupuesto</button>
    </div>
    <span class="meta" id="vt-msg"></span>`;
  c.querySelectorAll('input[name="vt-env"]').forEach((r) => r.onchange = () => { VENTA.envio = r.value; renderVentaResto(); renderVentaCart(); });
  const ec = $("#vt-env-costo"); if (ec) ec.onchange = () => { VENTA.envioCosto = Number(ec.value) || 0; VENTA.envioTitulo = "Andreani"; renderVentaResto(); renderVentaCart(); };
  if (VENTA.envio === "andreani") {
    const pv = $("#vt-an-prov"); if (pv) pv.onchange = () => VENTA._anProv = pv.value;
    const cp = $("#vt-an-cp"); if (cp) cp.oninput = () => VENTA._anCP = cp.value;
    const ci = $("#vt-an-ciudad"); if (ci) ci.oninput = () => VENTA._anCiudad = ci.value;
    const cb = $("#vt-an-calc"); if (cb) cb.onclick = ventaCalcularAndreani;
    c.querySelectorAll('input[name="vt-an-rate"]').forEach((r) => r.onchange = () => { const rt = (VENTA.envioRates || [])[+r.value]; if (rt) { VENTA.envioCosto = Math.round(rt.price); VENTA.envioTitulo = rt.name; renderVentaResto(); renderVentaCart(); } });
  }
  $("#vt-pago").value = VENTA.pago; $("#vt-pago").onchange = () => { VENTA.pago = $("#vt-pago").value; };
  $("#vt-registrar").onclick = registrarVenta;
  const pb = $("#vt-presup"); if (pb) pb.onclick = guardarPresupuesto;
}
function andreaniBlock() {
  const e = (VENTA.cliente && VENTA.cliente.entrega) || {};
  if (VENTA._anProv == null) VENTA._anProv = vtProvCode(e.provincia) || "";
  if (VENTA._anCP == null) VENTA._anCP = e.cp || "";
  if (VENTA._anCiudad == null) VENTA._anCiudad = e.ciudad || "";
  const provOpts = VT_PROV.map(([c, l]) => `<option value="${c}" ${c === VENTA._anProv ? "selected" : ""}>${l}</option>`).join("");
  const rates = VENTA.envioRates || [];
  const ratesH = rates.length ? `<div class="vt-an-rates">${rates.map((r, i) => `<label><input type="radio" name="vt-an-rate" value="${i}" ${(VENTA.envioTitulo === r.name && Number(VENTA.envioCosto) === Math.round(r.price)) ? "checked" : ""}> ${esc(r.name)} — <b>${fmtAR(Math.round(r.price))}</b></label>`).join("")}</div>` : "";
  return `<div class="vt-andreani">
    <div class="vt-an-row"><select id="vt-an-prov">${provOpts}</select><input id="vt-an-cp" placeholder="CP" value="${esc(VENTA._anCP)}" inputmode="numeric"><input id="vt-an-ciudad" placeholder="Localidad" value="${esc(VENTA._anCiudad)}"></div>
    <button type="button" class="btn ghost sm" id="vt-an-calc">📦 Calcular envío</button> <span class="meta" id="vt-an-msg"></span>
    ${ratesH}
    <label class="vt-an-manual">o a mano: $<input id="vt-env-costo" value="${VENTA.envioCosto || 0}" inputmode="numeric" style="width:90px"></label>
  </div>`;
}
async function ventaCalcularAndreani() {
  if (!VENTA.items.length) return toast("Agregá productos primero");
  const state = $("#vt-an-prov").value, postcode = ($("#vt-an-cp").value || "").trim(), city = ($("#vt-an-ciudad").value || "").trim();
  VENTA._anProv = state; VENTA._anCP = postcode; VENTA._anCiudad = city;
  if (!state || !postcode) return toast("Elegí provincia y CP");
  const msg = $("#vt-an-msg"); if (msg) msg.textContent = "Calculando…";
  try {
    const body = { items: VENTA.items.map((i) => ({ id: i.id, variationId: i.variationId, qty: i.qty })), address: { state, postcode, city } };
    const r = await (await fetch("/api/tienda/envio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })).json();
    if (!r.ok || !(r.rates || []).length) { VENTA.envioRates = []; if (msg) msg.textContent = r.error || "Sin tarifas para esa zona — cargá el costo a mano."; return; }
    VENTA.envioRates = r.rates.map((x) => ({ name: x.name, price: Number(x.price) || 0 }));
    const best = VENTA.envioRates.slice().sort((a, b) => a.price - b.price)[0];
    VENTA.envioCosto = Math.round(best.price); VENTA.envioTitulo = best.name;
    renderVentaResto(); renderVentaCart();
  } catch { if (msg) msg.textContent = "No se pudo calcular. Probá de nuevo."; }
}
// Desglose de qué ubicación(es) se descontó en la venta — con selector para corregir de dónde salió
let VT_ULTIMA = null; // { order_id, descontado:[...] } de la última venta
function descUbicHTML(ult) {
  const descontado = ult && ult.descontado;
  if (!descontado || !descontado.length) return "";
  const byProd = {};
  descontado.forEach((d, i) => { d._i = i; const k = d.productId + ":" + (d.variationId || ""); (byProd[k] || (byProd[k] = { productId: d.productId, variationId: d.variationId, slots: [] })).slots.push(d); });
  const lineas = Object.values(byProd).map((g) => {
    const p = DATA.catalogo.productos.find((x) => x.id === g.productId);
    const vlabel = g.variationId && p ? " — " + (((p.variaciones || []).find((v) => v.id === g.variationId) || {}).label || "") : "";
    const nombre = (p ? p.nombre : "#" + g.productId) + vlabel;
    const lugaresProd = locsOf(g.productId, g.variationId).map((a) => a.slotId);
    const slotsHTML = g.slots.map((s) => {
      const opts = [...new Set([s.slotId, ...lugaresProd])];
      const sel = `<select class="vt-mv" data-mvi="${s._i}">${opts.map((sl) => `<option value="${esc(sl)}" ${sl === s.slotId ? "selected" : ""}>${esc(slotTxt(sl))}</option>`).join("")}</select>`;
      return `${sel} <b>(${s.cant})</b>`;
    }).join(" · ");
    return `<div>📍 ${esc(nombre)}: ${slotsHTML}</div>`;
  }).join("");
  return `<div class="vt-descubic"><b>Descontado de:</b> <span class="meta">— si salió de otro lado, cambialo acá 👇</span>${lineas}</div>`;
}
// Al cancelar una venta: modal bien visible con DÓNDE devolver cada producto (para no equivocarse)
function mostrarDevolverUbic(restaurado) {
  if (!restaurado || !restaurado.length) return;
  const byProd = {};
  for (const d of restaurado) { const k = d.productId + ":" + (d.variationId || ""); (byProd[k] || (byProd[k] = { productId: d.productId, variationId: d.variationId, slots: [] })).slots.push(d); }
  const lineas = Object.values(byProd).map((g) => {
    const p = DATA.catalogo.productos.find((x) => x.id === g.productId);
    const vlabel = g.variationId && p ? " — " + (((p.variaciones || []).find((v) => v.id === g.variationId) || {}).label || "") : "";
    const nombre = (p ? p.nombre : "#" + g.productId) + vlabel;
    const lugares = g.slots.map((s) => `<b>${esc(slotTxt(s.slotId))}</b> ×${s.cant}`).join(" · ");
    return `<div class="dev-row"><span class="dev-prod">📦 ${esc(nombre)}</span><span class="dev-lug">↩️ ${lugares}</span></div>`;
  }).join("");
  openModal("↩️ Devolvé a su lugar", `<p class="meta">El pedido se canceló y el stock volvió. Guardá cada producto donde dice:</p><div class="dev-lista">${lineas}</div><button class="btn" id="dev-ok">Listo, ya lo guardé</button>`);
  const b = $("#dev-ok"); if (b) b.onclick = closeModal;
}
async function moverUbicVenta(sel) {
  if (!VT_ULTIMA) return;
  const i = +sel.dataset.mvi, d = VT_ULTIMA.descontado[i]; if (!d) return;
  const toSlot = sel.value, fromSlot = d.slotId;
  if (toSlot === fromSlot) return;
  const r = await api("/api/admin/venta/mover-ubic", { order_id: VT_ULTIMA.order_id, productId: d.productId, variationId: d.variationId, fromSlot, toSlot, cant: d.cant });
  if (r && r.ok) { d.slotId = toSlot; if (r.asignaciones && DATA.ubicaciones) DATA.ubicaciones.asignaciones = r.asignaciones; toast("📍 Movido a " + slotTxt(toSlot)); }
  else { toast((r && r.error) || "No se pudo mover"); sel.value = fromSlot; }
}
async function registrarVenta() {
  if (!VENTA.items.length) return toast("Agregá productos");
  const sub = ventaSubtotal(), envio = ventaEnvioCosto(), cl = VENTA.cliente;
  const envioTitle = VENTA.envio === "local" ? "Envío Tucumán" : VENTA.envio === "andreani" ? (VENTA.envioTitulo || "Andreani") : "Retiro en local";
  if (!confirm(`Registrar venta:\n${VENTA.items.length} ítem(s) · Total ${fmtAR(sub + envio)}\nCliente: ${cl ? (cl.nombre || cl.email) : "Consumidor final"}\nPago: ${VENTA.pago}\n\n¿Confirmar?`)) return;
  const btn = $("#vt-registrar"); if (btn) btn.disabled = true; const msg = $("#vt-msg"); if (msg) msg.textContent = "Registrando…";
  const body = {
    items: VENTA.items.map((i) => ({ id: i.id, variationId: i.variationId, qty: i.qty, precio: i.precio })),
    cliente: cl ? { nombre: cl.nombre, email: cl.email, telefono: cl.telefono, doc: cl.doc || "", entrega: cl.entrega } : { nombre: "Consumidor final" },
    envio: { tipo: VENTA.envio, costo: envio, metodo_title: envioTitle }, pago: VENTA.pago,
    reparto: !!($("#vt-reparto") && $("#vt-reparto").checked),
  };
  const r = await api("/api/admin/venta", body);
  if (r && r.ok) { toast("✅ Venta #" + r.number + " registrada"); VT_ULTIMA = { order_id: r.order_id, descontado: r.descontado || [] }; if (VENTA._presupuestoId) api("/api/admin/presupuesto/borrar", { id: VENTA._presupuestoId }); VENTA = { items: [], cliente: null, envio: "retiro", pago: "transferencia", envioCosto: 0 }; renderVentaCart(); renderVentaResto(); cargarPresupuestos(); const m2 = $("#vt-msg"); if (m2) { m2.innerHTML = `✅ Venta #${r.number} registrada (${fmtAR(r.total)})${descUbicHTML(VT_ULTIMA)}`; m2.querySelectorAll(".vt-mv").forEach((sel) => sel.onchange = () => moverUbicVenta(sel)); } }
  else { if (btn) btn.disabled = false; if (msg) msg.textContent = (r && r.error) || "No se pudo registrar"; }
}

// ---------- CAMPAÑAS DE EMAIL ----------
async function cargarCampanas() {
  const c = $("#camp-app"); if (!c) return;
  let dest = { clientes: 0, prospectos: 0 }, prospectos = [];
  try { dest = await (await fetch("/api/admin/campana/destinatarios")).json(); } catch {}
  try { prospectos = (await (await fetch("/api/admin/prospectos")).json()).prospectos || []; } catch {}
  c.innerHTML = `
    <div class="camp-grid">
      <div class="camp-box">
        <h3>📇 Prospectos (${prospectos.length})</h3>
        <p class="meta">Pegá tu lista (un contacto por línea: email, o "Nombre email"). Detecto los emails solos.</p>
        <textarea id="camp-prosp" rows="6" placeholder="Juan Pérez juan@mail.com&#10;maria@mail.com&#10;..."></textarea>
        <button class="btn sm" id="camp-prosp-add">Importar prospectos</button>
        <div class="camp-prosp-lista">${prospectos.slice(0, 100).map((p) => `<span class="cli-tag woo" title="${esc(p.email)}">${esc(p.nombre || p.email)} <span class="x" data-prosp-del="${esc(p.email)}">✕</span></span>`).join("")}${prospectos.length > 100 ? `<span class="meta">+${prospectos.length - 100} más</span>` : ""}</div>
      </div>
      <div class="camp-box">
        <h3>✉️ Nueva campaña</h3>
        <label class="camp-lbl">Enviar a
          <select id="camp-destino">
            <option value="clientes">Clientes (${dest.clientes})</option>
            <option value="prospectos">Prospectos (${dest.prospectos})</option>
            <option value="todos">Todos (${dest.clientes + dest.prospectos})</option>
          </select></label>
        <div class="camp-ia">
          <input id="camp-brief" placeholder="Contale a la IA de qué es la campaña… (ej: promo en ortodoncia esta semana)">
          <button class="btn ghost sm" id="camp-ia-btn">✨ Redactar con IA</button>
        </div>
        <input id="camp-asunto" placeholder="Asunto del email" class="camp-input">
        <textarea id="camp-msg" rows="8" placeholder="Escribí el mensaje… (los saltos de línea se respetan)"></textarea>
        <button class="btn" id="camp-enviar">📤 Enviar campaña</button>
        <div class="meta" id="camp-result"></div>
        <p class="meta">Cada persona recibe su propio email (no se ven entre sí). Para envíos masivos conviene tener el dominio verificado en Resend.</p>
      </div>
    </div>`;
  $("#camp-prosp-add").onclick = async () => {
    const texto = $("#camp-prosp").value.trim(); if (!texto) return toast("Pegá la lista primero");
    const r = await api("/api/admin/prospectos/importar", { texto });
    if (r.ok) { toast(`${r.nuevos} prospecto(s) nuevos · ${r.total} en total`); cargarCampanas(); } else toast(r.error || "No se pudo");
  };
  c.querySelectorAll("[data-prosp-del]").forEach((b) => b.onclick = async () => { await api("/api/admin/prospectos/borrar", { email: b.dataset.prospDel }); cargarCampanas(); });
  $("#camp-ia-btn").onclick = async () => {
    const brief = $("#camp-brief").value.trim(); if (!brief) return toast("Contale a la IA de qué es la campaña");
    const b = $("#camp-ia-btn"); b.disabled = true; b.textContent = "Redactando…";
    const r = await api("/api/admin/campana/redactar", { brief });
    b.disabled = false; b.textContent = "✨ Redactar con IA";
    if (r.ok) { if (r.asunto) $("#camp-asunto").value = r.asunto; $("#camp-msg").value = r.cuerpo || ""; toast("¡Listo! Revisá y ajustá lo que quieras antes de enviar"); }
    else toast(r.error || "No se pudo redactar");
  };
  $("#camp-enviar").onclick = async () => {
    const asunto = $("#camp-asunto").value.trim(), mensaje = $("#camp-msg").value.trim(), destino = $("#camp-destino").value;
    if (!asunto || !mensaje) return toast("Completá asunto y mensaje");
    const n = destino === "clientes" ? dest.clientes : destino === "prospectos" ? dest.prospectos : dest.clientes + dest.prospectos;
    if (!confirm(`¿Enviar esta campaña a ${n} destinatario(s)?`)) return;
    $("#camp-result").textContent = "Enviando…"; $("#camp-enviar").disabled = true;
    const r = await api("/api/admin/campana/enviar", { asunto, mensaje, destino });
    $("#camp-enviar").disabled = false;
    if (r.ok) { $("#camp-result").textContent = `✅ Enviados: ${r.enviados} · Fallidos: ${r.fallidos} (de ${r.total})`; toast("Campaña enviada"); }
    else { $("#camp-result").textContent = r.error || "No se pudo enviar"; }
  };
}

// ---------- REPARTO DEL CADETE ----------
let REPARTO = [];
async function cargarReparto() {
  $("#rep-meta").textContent = "Cargando…";
  const dd = $("#rep-desde");
  if (dd && !dd.dataset.w) { dd.dataset.w = "1"; dd.onchange = renderReparto; const h = $("#rep-hasta"); if (h) h.onchange = renderReparto; const lp = $("#rep-limpiar"); if (lp) lp.onclick = () => { dd.value = ""; if (h) h.value = ""; renderReparto(); }; }
  const mb = $("#rep-mandado-btn"); if (mb && !mb.dataset.w) { mb.dataset.w = "1"; mb.onclick = () => { const box = $("#rep-mandado-box"); box.hidden = !box.hidden; if (!box.hidden) $("#rep-md-detalle").focus(); }; const ad = $("#rep-md-add"); if (ad) ad.onclick = agregarMandado; const di = $("#rep-md-detalle"); if (di) di.onkeydown = (e) => { if (e.key === "Enter") agregarMandado(); }; }
  try { const d = await (await fetch("/api/admin/reparto")).json(); if (d.error) { $("#rep-meta").textContent = d.error; return; } REPARTO = d.lista || []; }
  catch { $("#rep-meta").textContent = "No se pudo cargar"; return; }
  renderReparto();
}
function repartoFiltrado() {
  const desde = ($("#rep-desde") || {}).value || "", hasta = ($("#rep-hasta") || {}).value || "";
  return REPARTO
    .filter((o) => { const f = (o.fecha || "").slice(0, 10); if (desde && f < desde) return false; if (hasta && f > hasta) return false; return true; })
    .sort((a, b) => (b.fecha || "").localeCompare(a.fecha || "")); // más recientes primero (los del día arriba)
}
function renderReparto() {
  const list = repartoFiltrado();
  const pend = list.filter((o) => !o.entregado).length, ent = list.length - pend;
  $("#rep-meta").textContent = `${pend} pendiente(s)${ent ? ` · ${ent} entregado(s)` : ""}`;
  let n = 0;
  $("#rep-app").innerHTML = list.length ? list.map((o) => {
    const titulo = o.mandado ? `🏃 ${esc(o.cliente || "Mandado")}` : `#${esc(o.number)} · ${esc(o.cliente || "—")}`;
    const tag = o.mandado ? '<span class="cli-tag mandado">🏃 mandado</span>' : (o.marcado ? '<span class="cli-tag woo">🛵 reparto</span>' : "");
    return `
    <div class="rep-row ${o.entregado ? "entregado" : ""} ${o.mandado ? "mandado" : ""}">
      <div class="rep-num">${o.entregado ? "✓" : ++n}</div>
      <div class="rep-main">
        <strong>${titulo}</strong> ${tag} ${o.preparado ? '<span class="cli-tag woo">preparado</span>' : ""} ${o.entregado ? `<span class="cli-tag">✅ ${o.mandado ? "hecho" : "entregado"}</span>` : ""}
        <div class="meta">📅 ${o.fecha ? new Date(o.fecha).toLocaleDateString("es-AR") : "—"}${o.direccion ? " · 📍 " + esc(o.direccion) : (o.mandado ? "" : " · 📍 sin dirección")}</div>
        ${o.mandado ? "" : `<div class="meta">${o.items} ítem(s) · ${fmtAR(o.total)}</div>`}
      </div>
      <div class="rep-acts">
        ${o.direccion ? `<a class="btn ghost sm" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.direccion + ", Tucumán, Argentina")}">📍 Mapa</a>` : ""}
        ${o.telefono ? `<a class="btn wa-btn sm" target="_blank" rel="noopener" href="${waLink(o.telefono, o.mandado ? "Hola! Te escribimos de El Pasaje Dental 🦷" : `Hola ${(o.cliente || "").split(" ")[0]}! Te escribimos de El Pasaje Dental 🦷 Vamos en camino con tu pedido #${o.number} 🛵`)}">📱 Avisar</a>` : ""}
        ${o.entregado ? (o.mandado ? `<button class="btn ghost sm" data-rep-mdel="${o.id}" title="Borrar del historial">🗑️</button>` : "") : `<button class="btn sm" data-rep-entregado="${o.id}" data-mandado="${o.mandado ? 1 : 0}">✅ ${o.mandado ? "Hecho" : "Entregado"}</button>`}
      </div>
    </div>`; }).join("") : '<p class="meta">No hay pedidos para reparto en ese rango.</p>';
  $("#rep-app").querySelectorAll("[data-rep-entregado]").forEach((b) => b.onclick = async () => {
    const esMandado = b.dataset.mandado === "1";
    if (!confirm(esMandado ? "¿Marcar el mandado como hecho?" : "¿Marcar como entregado? Sale de los pendientes pero queda en el historial de reparto.")) return;
    const r = esMandado ? await api("/api/admin/reparto/mandado/entregar", { id: b.dataset.repEntregado }) : await api("/api/admin/pedido-estado", { id: Number(b.dataset.repEntregado), estado: "completed" });
    if (r && r.ok) { toast("✅ Listo"); cargarReparto(); } else toast((r && r.error) || "No se pudo");
  });
  $("#rep-app").querySelectorAll("[data-rep-mdel]").forEach((b) => b.onclick = async () => {
    if (!confirm("¿Borrar este mandado del historial?")) return;
    const r = await api("/api/admin/reparto/mandado/borrar", { id: b.dataset.repMdel });
    if (r && r.ok) cargarReparto(); else toast((r && r.error) || "No se pudo");
  });
}
async function agregarMandado() {
  const detalle = ($("#rep-md-detalle").value || "").trim();
  if (!detalle) return toast("Poné qué tiene que hacer el cadete");
  const r = await api("/api/admin/reparto/mandado", { detalle, direccion: ($("#rep-md-dir").value || "").trim(), telefono: ($("#rep-md-tel").value || "").trim() });
  if (r && r.ok) { toast("🏃 Mandado agregado"); ["rep-md-detalle", "rep-md-dir", "rep-md-tel"].forEach((k) => { const e = $("#" + k); if (e) e.value = ""; }); $("#rep-mandado-box").hidden = true; cargarReparto(); }
  else toast((r && r.error) || "No se pudo");
}
function abrirRutaReparto() {
  const list = repartoFiltrado().filter((o) => !o.entregado && o.direccion);
  if (!list.length) return toast("No hay entregas pendientes para armar la ruta");
  const url = "https://www.google.com/maps/dir/" + list.map((o) => encodeURIComponent(o.direccion + ", Tucumán, Argentina")).join("/");
  window.open(url, "_blank", "noopener");
}

// ---------- VENCIMIENTOS ----------
let VENC = { items: [], dias_aviso: 60, vencidos: 0, por_vencer: 0 };
let VENC_MAP = new Map(); // productId -> peor vencimiento { estado, dias, fecha }
function rebuildVencMap() {
  VENC_MAP = new Map();
  const rank = { vencido: 3, por_vencer: 2, ok: 1 };
  for (const it of (VENC.items || [])) {
    if (!it.productId) continue;
    const cur = VENC_MAP.get(it.productId);
    if (!cur || rank[it.estado] > rank[cur.estado]) VENC_MAP.set(it.productId, { estado: it.estado, dias: it.dias, fecha: it.fecha });
  }
}
async function cargarVencimientos() {
  try { VENC = await (await fetch("/api/admin/vencimientos")).json(); } catch { VENC = { items: [], dias_aviso: 60 }; }
  rebuildVencMap();
  renderVencimientos();
  if ($("#tab-buscar") && $("#tab-buscar").classList.contains("active")) renderBuscar();
}
function vencClase(e) { return e === "vencido" ? "venc-rojo" : e === "por_vencer" ? "venc-ambar" : "venc-verde"; }
function vencBadge(productId) {
  const v = VENC_MAP.get(productId);
  if (!v || v.estado === "ok") return "";
  return v.estado === "vencido"
    ? `<span class="badge venc-b-rojo">⚠️ Vencido</span>`
    : `<span class="badge venc-b-ambar">⏰ Vence en ${v.dias}d</span>`;
}
function renderVencimientos() {
  const c = $("#venc-app"); if (!c) return;
  const items = VENC.items || [];
  c.innerHTML = `
    <div class="venc-cards">
      <div class="venc-card rojo"><div class="vc-num">${VENC.vencidos || 0}</div><div class="vc-lbl">Vencidos</div></div>
      <div class="venc-card ambar"><div class="vc-num">${VENC.por_vencer || 0}</div><div class="vc-lbl">Por vencer (≤ ${VENC.dias_aviso} días)</div></div>
      <div class="venc-card"><div class="vc-num">${items.length}</div><div class="vc-lbl">Lotes con fecha</div></div>
    </div>
    <div class="venc-form">
      <h4>➕ Cargar vencimiento</h4>
      <div class="venc-form-row">
        <input id="venc-codigo" placeholder="Código del producto" inputmode="numeric" autocomplete="off">
        <input id="venc-nombre" placeholder="Producto (se autocompleta)">
        <input id="venc-lote" placeholder="Lote (opcional)">
      </div>
      <div class="venc-form-row">
        <label class="venc-lbl">Vence el <input id="venc-fecha" type="date"></label>
        <input id="venc-cant" type="number" min="0" placeholder="Cantidad">
        <input id="venc-ubic" placeholder="Ubicación (opcional)">
        <button class="btn" id="venc-add">Agregar</button>
      </div>
      <input id="venc-nota" placeholder="Nota (opcional)" class="venc-nota">
    </div>
    <div class="venc-config meta">El aviso de "próximo a vencer" se configura en <strong>⚙️ Ajustes</strong> (hoy: ${VENC.dias_aviso} días). El filtro por vencimiento está en la pestaña 🔍 Buscar.</div>
    <div class="venc-lista">${items.length ? items.map(vencRow).join("") : '<p class="meta">Todavía no cargaste vencimientos. Cargá el primero arriba.</p>'}</div>`;
  const cod = $("#venc-codigo");
  cod.oninput = () => { const f = findByCode(cod.value.trim()); if (f) $("#venc-nombre").value = f.label; };
  $("#venc-add").onclick = agregarVencimiento;
  c.querySelectorAll("[data-venc-del]").forEach((b) => b.onclick = async () => { await api("/api/admin/vencimiento-borrar", { id: b.dataset.vencDel }); cargarVencimientos(); });
}
function vencRow(it) {
  const txt = it.estado === "vencido" ? `⚠️ Venció hace ${Math.abs(it.dias)} día(s)` : `Faltan ${it.dias} día(s)`;
  return `<div class="venc-row ${vencClase(it.estado)}">
    <div><strong>${esc(it.nombre || it.codigo || "—")}</strong>${it.lote ? ` <span class="vr-lote">Lote ${esc(it.lote)}</span>` : ""}
      <div class="meta">📅 ${esc(it.fecha)} · ${txt}${it.cantidad ? ` · ${it.cantidad} u.` : ""}${it.ubicacion ? ` · 📍 ${esc(it.ubicacion)}` : ""}${it.nota ? ` · ${esc(it.nota)}` : ""}</div></div>
    <button class="venc-del" data-venc-del="${it.id}" title="Borrar">✕</button></div>`;
}
async function agregarVencimiento() {
  const fecha = $("#venc-fecha").value;
  if (!fecha) return toast("Poné la fecha de vencimiento");
  const cod = $("#venc-codigo").value.trim();
  const f = findByCode(cod);
  const r = await api("/api/admin/vencimiento", { productId: f ? f.productId : null, codigo: cod, nombre: $("#venc-nombre").value.trim(), lote: $("#venc-lote").value.trim(), fecha, cantidad: $("#venc-cant").value, ubicacion: $("#venc-ubic").value.trim(), nota: $("#venc-nota").value.trim() });
  if (r.ok) { toast("Vencimiento agregado"); cargarVencimientos(); } else toast(r.error || "No se pudo");
}
if (location.hash.startsWith("#ml")) {
  const tml = $$(".tab").find((x) => x.dataset.tab === "ml"); if (tml) tml.click();
  if (location.hash === "#ml-ok") setTimeout(() => toast("MercadoLibre conectado ✓"), 300);
  if (location.hash === "#ml-error") setTimeout(() => toast("No se pudo conectar MercadoLibre"), 300);
}
const pedRec = $("#ped-recargar"); if (pedRec) pedRec.onclick = () => { ["ped-q", "ped-desde", "ped-hasta"].forEach((id) => { const e = $("#" + id); if (e) e.value = ""; }); const es = $("#ped-estado"); if (es) es.value = "any"; cargarPedidos(); };
{ const b = $("#ped-buscar"); if (b) b.onclick = cargarPedidos; const a = $("#ped-actualizar"); if (a) a.onclick = cargarPedidos; const q = $("#ped-q"); if (q) q.addEventListener("keydown", (e) => { if (e.key === "Enter") cargarPedidos(); }); }
{ const a = $("#rep-recargar"); if (a) a.onclick = cargarReparto; const b = $("#rep-ruta"); if (b) b.onclick = abrirRutaReparto; }
const pedEst = $("#ped-estado"); if (pedEst) pedEst.onchange = cargarPedidos;
const pedCanc = $("#ped-cancelados"); if (pedCanc) pedCanc.onchange = cargarPedidos;
["q", "cat", "venc-filtro", "soloStock", "soloUbicados"].forEach((id) => {
  const el = $("#" + id); if (el) el.addEventListener(el.tagName === "SELECT" || el.type === "checkbox" ? "change" : "input", renderBuscar);
});
cargarVencimientos(); // precarga para badges/filtro de vencimiento en Buscar
{ const b = $("#btn-nuevo-prod"); if (b) b.onclick = nuevoProducto; }

// ---------- MAPA ----------
// HTML de una sección (grilla o lista). Las marcadas con `junto:true` se pegan a la izquierda.
function seccionWrapHtml(sec) {
  const slots = sec.slots.map((sl) => slotCard(sl, sec)).join("");
  const wrap = sec.vista === "grid"
    ? `<div class="grid-slots" style="grid-template-columns:repeat(${sec.columnas},1fr)">${slots}</div>`
    : `<div class="slots-lista">${slots}</div>`;
  return `<div class="seccion${sec.junto ? " seccion-junto" : ""}"><h5>${esc(sec.nombre)}</h5>${wrap}</div>`;
}
// Agrupa cada sección con las siguientes marcadas `junto` en una misma fila (lado a lado).
function seccionesHtml(secciones) {
  let html = "";
  for (let i = 0; i < secciones.length; i++) {
    if (secciones[i + 1] && secciones[i + 1].junto) {
      const grupo = [seccionWrapHtml(secciones[i])];
      while (secciones[i + 1] && secciones[i + 1].junto) { i++; grupo.push(seccionWrapHtml(secciones[i])); }
      html += `<div class="seccion-fila">${grupo.join("")}</div>`;
    } else html += seccionWrapHtml(secciones[i]);
  }
  return html;
}
function muebleBodyHtml(m) { return seccionesHtml(m.secciones); }
function showMuebleDetalle(id) {
  const m = DATA.muebles.muebles.find((x) => x.id === id);
  if (!m) return;
  openModal(m.nombre + (m.nota ? ` — ${m.nota}` : ""), `<div class="mueble-detalle">${muebleBodyHtml(m)}</div>`);
}
function asigMap() { return (DATA.plano && DATA.plano.asignacion) || {}; }
function muebleDe(id) { return DATA.muebles.muebles.find((x) => x.id === id); }
function totalMueble(m) { return m.secciones.reduce((n, s) => n + s.slots.reduce((k, sl) => k + prodsIn(sl.id).length, 0), 0); }

function renderMapa() {
  const plano = DATA.muebles.plano;
  const cont = $("#mapa-cont");
  if (!plano || !plano.zonas) { cont.innerHTML = '<p class="meta">Sin plano configurado.</p>'; return; }
  const asig = asigMap();
  let svg = `<svg viewBox="${plano.viewBox || "0 0 100 72"}" xmlns="http://www.w3.org/2000/svg">`;
  svg += `<rect x="0.5" y="0.5" width="99" height="71" fill="none" stroke="var(--border)" stroke-width="0.4" rx="2"/>`;
  for (const z of plano.zonas) {
    const mid = asig[z.id];
    const m = mid ? muebleDe(mid) : null;
    const cx = z.x + z.w / 2, cy = z.y + z.h / 2;
    const label = m ? m.nombre : z.etiqueta;
    const sub = m ? `${totalMueble(m)} prod.` : "tocar para asignar";
    svg += `<g class="mapa-mueble ${m ? "" : "sinasig"}" data-zona="${z.id}">` +
      `<rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" rx="1"/>` +
      `<text x="${cx}" y="${cy}" text-anchor="middle">${esc(label)}</text>` +
      `<text class="mcount" x="${cx}" y="${cy + 2.6}" text-anchor="middle">${esc(sub)}</text></g>`;
  }
  svg += `</svg>`;
  cont.innerHTML = svg;
}

async function refreshPlano() {
  const d = await (await fetch("/api/data")).json();
  DATA.plano = d.plano;
}
function interiorHtml(mid) {
  const m = mid ? muebleDe(mid) : null;
  return m ? `<div class="mueble-detalle">${muebleBodyHtml(m)}</div>` : `<p class="meta">Elegí de la lista qué mueble es este rectángulo del plano.</p>`;
}
function showZona(zonaId) {
  const z = DATA.muebles.plano.zonas.find((x) => x.id === zonaId);
  if (!z) return;
  const mid = asigMap()[zonaId];
  const opts = `<option value="">— Sin asignar —</option>` +
    DATA.muebles.muebles.map((m) => `<option value="${m.id}" ${m.id === mid ? "selected" : ""}>${esc(m.nombre)}</option>`).join("");
  openModal(`Plano · "${z.etiqueta}"`, `
    <p style="margin:0 0 8px;color:var(--muted);font-size:13px">¿Qué mueble es este rectángulo?</p>
    <select id="zona-sel" class="search">${opts}</select>
    <div id="zona-interior">${interiorHtml(mid)}</div>
  `);
  $("#zona-sel").onchange = async (e) => {
    const nid = e.target.value || null;
    await api("/api/plano", { zonaId, muebleId: nid });
    await refreshPlano();
    $("#zona-interior").innerHTML = interiorHtml(nid);
    renderMapa();
    toast(nid ? "Mueble asignado" : "Zona liberada");
  };
}

// ---------- PREGUNTAR ----------
async function preguntar(q) {
  const cont = $("#preg-respuesta");
  if (!q.trim()) return;
  cont.innerHTML = `<div class="burbuja cargando">Pensando…</div>`;
  try {
    const r = await (await fetch("/api/preguntar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pregunta: q }) })).json();
    if (r.error) cont.innerHTML = `<div class="burbuja err">⚠️ ${esc(r.error)}</div>`;
    else cont.innerHTML = `<div class="burbuja">${esc(r.texto)}</div>`;
  } catch (e) {
    cont.innerHTML = `<div class="burbuja err">⚠️ No se pudo conectar con el asistente.</div>`;
  }
}
$("#preg-enviar").onclick = () => preguntar($("#preg-q").value);
$("#preg-q").addEventListener("keydown", (e) => { if (e.key === "Enter") preguntar($("#preg-q").value); });
$$(".chip-sug").forEach((c) => c.onclick = () => { $("#preg-q").value = c.textContent; preguntar(c.textContent); });

// ---------- PEDIDOS ----------
const fmtAR = (n) => "$" + Number(n || 0).toLocaleString("es-AR");
const estadoNom = (s) => ({ processing: "En proceso", pending: "Pendiente pago", "on-hold": "En espera", completed: "Completado", cancelled: "Cancelado", refunded: "Reintegrado", failed: "Fallido" }[s] || s);
// Fecha + hora de un pedido (usa el dato crudo de WooCommerce, sin reinterpretar zona horaria)
function fechaHora(s) { if (!s) return "—"; const [d, t] = String(s).split("T"); return d.split("-").reverse().join("/") + (t ? " " + t.slice(0, 5) + " hs" : ""); }
async function cargarPedidos() {
  const estado = $("#ped-estado").value;
  const params = new URLSearchParams({ estado });
  const q = ($("#ped-q") && $("#ped-q").value || "").trim();
  const desde = ($("#ped-desde") && $("#ped-desde").value) || "";
  const hasta = ($("#ped-hasta") && $("#ped-hasta").value) || "";
  if (q) params.set("q", q);
  if (desde) params.set("desde", desde);
  if (hasta) params.set("hasta", hasta);
  $("#ped-lista").innerHTML = '<p class="meta">Cargando pedidos…</p>';
  try {
    const d = await (await fetch("/api/admin/pedidos?" + params.toString())).json();
    if (d.error) { $("#ped-lista").innerHTML = `<p class="meta">${esc(d.error)}</p>`; return; }
    const verCanc = $("#ped-cancelados") && $("#ped-cancelados").checked;
    const pedidos = (estado === "any" && !verCanc) ? d.pedidos.filter((p) => p.status !== "cancelled") : d.pedidos;
    const oc = d.pedidos.length - pedidos.length;
    $("#ped-meta").textContent = `${pedidos.length} pedido(s)` + (oc ? ` · ${oc} cancelado(s) oculto(s)` : "") + (d.totalPaginas > 1 ? ` · pág ${d.page}/${d.totalPaginas}` : "");
    $("#ped-lista").innerHTML = pedidos.length ? pedidos.map(pedCard).join("") : '<p class="meta">No hay pedidos para mostrar.</p>';
  } catch { $("#ped-lista").innerHTML = '<p class="meta">No se pudieron cargar los pedidos.</p>'; }
}
function pedCard(p) {
  return `<div class="ped-card" data-pedido="${p.id}">
    <div class="pc-main">
      <div class="pc-num"><strong class="pc-cliente">#${esc(p.number || p.id)} · ${esc(p.cliente)}</strong> ${p.preparado ? '<span class="prep-badge">✓ preparado</span>' : ""}</div>
      <div class="pc-sub">🕒 ${fechaHora(p.date_created)} · ${p.items} ítem(s)${p.pago ? ` · 💳 ${esc(p.pago)}` : ""}</div>
    </div>
    <div class="pc-right"><div class="pc-total">${fmtAR(p.total)}</div><span class="est ${p.status}">${estadoNom(p.status)}</span></div>
  </div>`;
}
// Arma un link wa.me con el teléfono normalizado a formato AR (549 + área + número).
function waLink(telefono, mensaje) {
  let t = String(telefono || "").replace(/\D/g, "");
  if (!t) return null;
  if (t.startsWith("00")) t = t.slice(2);  // prefijo internacional
  if (t.startsWith("54")) t = t.slice(2);  // código de país
  if (t.startsWith("0")) t = t.slice(1);   // 0 troncal
  if (t.length === 11 && t.startsWith("9")) t = t.slice(1); // 9 de celular (con o sin país) → corrige el caso "9 381 ..."
  if (t.length > 10) { for (const al of [4, 3, 2]) { if (t.length - 2 === 10 && t.slice(al, al + 2) === "15") { t = t.slice(0, al) + t.slice(al + 2); break; } } } // saca el 15 del celular
  if (t.length < 8) return null; // demasiado corto: no es un número válido (abre WhatsApp para elegir contacto)
  return `https://wa.me/549${t}?text=${encodeURIComponent(mensaje)}`;
}
function waMensajePedido(p) {
  const nom = (p.cliente.nombre || "").trim().split(/\s+/)[0] || "";
  const n = p.number || p.id;
  const segun = {
    pending: `tu pedido #${n} quedó registrado y está pendiente de pago. Cualquier duda quedamos a disposición 😊`,
    processing: `ya estamos preparando tu pedido #${n} 📦. Te avisamos apenas esté listo.`,
    "on-hold": `tu pedido #${n} está en espera. Cualquier consulta escribinos 😊`,
    completed: `tu pedido #${n} ya está listo ✅ ¡Gracias por tu compra!`,
    cancelled: `tu pedido #${n} fue cancelado. Cualquier duda escribinos.`,
    refunded: `tu pedido #${n} fue reembolsado.`,
  }[p.status] || `te escribimos por tu pedido #${n}.`;
  return `Hola ${nom}! Te escribimos de El Pasaje Dental 🦷 ${segun}`;
}
// Mensajes de aviso al cliente por evento (semi-automático: se manda con 1 toque, no es invasivo)
const _n1 = (nombre) => { // primer nombre, en minúscula y sin acentos (así escribimos nosotros)
  const w = ((nombre || "").trim().split(/\s+/)[0] || "").toLowerCase();
  return w.replace(/[áàä]/g, "a").replace(/[éèë]/g, "e").replace(/[íìï]/g, "i").replace(/[óòö]/g, "o").replace(/[úùü]/g, "u");
};
const _pick = (a) => a[Math.floor(Math.random() * a.length)]; // elige una variante al azar (que no parezca un bot)
const _monto = (n) => String(Math.round(Number(n) || 0)); // monto sin $ ni puntos (estilo casual)
function waMsgEvento(tipo, p) {
  const n = _n1(p.cliente.nombre), num = p.number || p.id, t = _monto(p.total);
  const v = {
    recibido: [
      `hola ${n} nos llego tu pedido ${num} ya lo estamos armando cualquier cosa avisame`,
      `${n} llego tu pedido ${num} lo preparamos y te aviso cuando este dale`,
      `hola ${n} recibimos tu pedido ${num} ya estamos con eso`,
      `${n} ya tenemos tu pedido ${num} lo armamos y te aviso`,
      `buenas ${n} nos llego tu pedido ${num} lo preparo y te aviso beso`,
    ],
    salio: [
      `${n} ya salio tu pedido ${num} va para alla`,
      `listo ${n} tu pedido ${num} va en camino avisame cuando llegue`,
      `hola ${n} salio tu pedido ${num} en un rato lo tenes`,
      `${n} tu pedido ${num} ya te lo llevan dale`,
      `buenas ${n} salio tu pedido ${num} va para alla cualquier cosa avisame`,
    ],
    pago: [
      `${n} nos entro tu pago gracias seguimos con el pedido`,
      `listo ${n} llego tu pago de ${t} gracias`,
      `hola ${n} recibimos el pago gracias`,
      `${n} ya nos figura tu pago gracias por avisar dale`,
      `buenas ${n} entro tu pago de ${t} gracias`,
    ],
  }[tipo];
  return v ? _pick(v) : waMensajePedido(p);
}
// Botón de WhatsApp: arma el link con el teléfono (o sin número, para elegir contacto) y el mensaje listo
function waBtn(tel, mensaje, label) {
  const link = waLink(tel, mensaje) || `https://wa.me/?text=${encodeURIComponent(mensaje)}`;
  return `<a class="btn wa-btn sm" target="_blank" rel="noopener" href="${esc(link)}">${label}</a>`;
}
function waMsgCobranza(nombre, saldo) {
  const n = _n1(nombre), s = _monto(saldo);
  return _pick([
    `hola ${n} como va te recuerdo que quedo un saldo de ${s} cuando puedas lo vemos`,
    `${n} como andas quedo pendiente ${s} en tu cuenta cualquier cosa lo arreglamos`,
    `hola ${n} te recuerdo el saldito de ${s} cuando tengas un rato`,
    `${n} quedo ${s} en la cuenta avisame y lo coordinamos dale`,
  ]);
}
function waMsgPresupuesto(nombre, total) {
  const n = _n1(nombre), t = _monto(total);
  return _pick([
    `hola ${n} viste el presupuesto de ${t} cualquier duda decime`,
    `${n} que te parecio el presupuesto de ${t} si queres ajustamos algo`,
    `hola ${n} te consulto por el presupuesto de ${t} cuando quieras lo cerramos`,
    `${n} pudiste ver el presu de ${t} cualquier cosa me decis`,
  ]);
}
function waMsgReactivacion(nombre) {
  const n = _n1(nombre);
  return _pick([
    `hola ${n} tanto tiempo necesitas reponer algo`,
    `${n} como va todo cualquier cosa que te haga falta avisame`,
    `hola ${n} hace rato no charlamos necesitas algun insumo`,
    `${n} hace un tiempo no pasas te quedo algo por reponer`,
  ]);
}
function waMsgEncargo(cliente, producto) {
  const n = _n1(cliente);
  return _pick([
    `${n} llego lo que encargaste te lo guardo avisame cuando pasas`,
    `hola ${n} ya llego ${producto} te lo reservo cuando puedas pasa`,
    `buenas ${n} llego ${producto} te lo dejo apartado`,
    `${n} ya tenemos ${producto} que encargaste te lo guardo dale`,
  ]);
}
function waMsgChequeVenc(ch) { const f = String(ch.vencimiento || "").slice(0, 10).split("-").reverse().join("/"); return `Recordatorio: el cheque ${ch.numero ? "N° " + ch.numero + " " : ""}${ch.tercero ? "de " + ch.tercero + " " : ""}por ${fmtAR(ch.monto)} vence el ${f}.`; }
// ---------- ALTA DE PRODUCTO ----------
let NP_IMG = [];
async function nuevoProducto(prefill, onCreated) {
  prefill = prefill || {};
  if (!CATS_WC) { try { CATS_WC = (await (await fetch("/api/admin/categorias-wc")).json()).categorias || []; } catch { CATS_WC = []; } }
  NP_IMG = Array.isArray(prefill.images) ? [...prefill.images] : [];
  const npGrupoOpts = (CATS_WC || []).map((g) => `<option value="${g.id}">${esc(g.name)}</option>`).join("");
  openModal("➕ Nuevo producto", `
    <label class="ed-l">Nombre *<input id="np-nombre" value="${esc(prefill.nombre || "")}"></label>
    <div class="ed-row2"><label class="ed-l">Precio<input id="np-precio" inputmode="numeric" value="${esc(prefill.precio == null ? "" : prefill.precio)}"></label><label class="ed-l">Existencias (stock)<input id="np-stock" inputmode="numeric" value="${esc(prefill.stock == null ? "" : prefill.stock)}"></label></div>
    <div class="ed-row2"><label class="ed-l">Código / SKU<input id="np-sku" value="${esc(prefill.sku || "")}"></label><label class="ed-l">Peso (kg)<input id="np-peso"></label></div>
    <label class="ed-l">Descripción<textarea id="np-desc" rows="3">${esc(prefill.descripcion || "")}</textarea></label>
    <div class="ed-row2">
      <label class="ed-l">Grupo<select id="np-grupo"><option value="">— sin grupo —</option>${npGrupoOpts}</select></label>
      <label class="ed-l">Subcategoría<select id="np-subgrupo"><option value="">— sin subcategoría —</option></select></label>
    </div>
    <div class="ed-l">Foto<div class="ed-imgs" id="np-imgs">${NP_IMG.map((im) => `<div class="ed-img"><img src="${esc(im.src)}" alt=""></div>`).join("")}</div><label class="ed-img-add">＋ Subir<input type="file" id="np-file" accept="image/*" hidden></label></div>
    <button class="btn" id="np-guardar">Crear producto</button> <span class="meta" id="np-msg"></span>`);
  $("#np-grupo").onchange = () => { const g = (CATS_WC || []).find((x) => x.id === Number($("#np-grupo").value)); $("#np-subgrupo").innerHTML = `<option value="">— sin subcategoría —</option>` + (g?.hijas || []).map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join(""); };
  $("#np-file").onchange = async (e) => { const f = e.target.files[0]; if (!f) return; const url = await subirImagen(f); if (url) { NP_IMG.push({ src: url }); $("#np-imgs").innerHTML = NP_IMG.map((im) => `<div class="ed-img"><img src="${esc(im.src)}" alt=""></div>`).join(""); } };
  $("#np-guardar").onclick = async () => {
    const nombre = $("#np-nombre").value.trim(); if (!nombre) return toast("Poné el nombre");
    const grupo_id = Number($("#np-grupo").value) || null;
    const subgrupo_id = Number($("#np-subgrupo").value) || null;
    const sku = $("#np-sku").value.trim(), stock = Number($("#np-stock").value) || 0, precio = $("#np-precio").value;
    const btn = $("#np-guardar"); btn.disabled = true; $("#np-msg").textContent = "Creando…";
    const r = await api("/api/admin/producto-nuevo", { nombre, precio, stock: $("#np-stock").value, sku, peso: $("#np-peso").value.trim(), descripcion: $("#np-desc").value.trim(), grupo_id, subgrupo_id, images: NP_IMG });
    btn.disabled = false;
    if (r && r.ok) {
      toast("✅ Producto creado"); closeModal();
      try { DATA = await (await fetch("/api/data")).json(); } catch {}
      if (onCreated) onCreated({ id: r.id, nombre, sku, stock }); else rerender();
    } else $("#np-msg").textContent = (r && r.error) || "No se pudo crear";
  };
}
// ---------- EDITOR DE PRODUCTO ----------
let PROD_EDIT = null;
let CATS_WC = null;
async function editarProducto(id, sugProvId) {
  openModal("Editar producto", '<p class="meta">Cargando…</p>');
  let p;
  try { p = await (await fetch("/api/admin/producto-edit?id=" + id)).json(); } catch { $("#modal-body").innerHTML = '<p class="meta">No se pudo cargar.</p>'; return; }
  if (p.error) { $("#modal-body").innerHTML = `<p class="meta">${esc(p.error)}</p>`; return; }
  if (sugProvId && !p.proveedorId) p.proveedorId = sugProvId; // sugerir el proveedor de la factura que estamos ingresando
  if (!CATS_WC) { try { CATS_WC = (await (await fetch("/api/admin/categorias-wc")).json()).categorias || []; } catch { CATS_WC = []; } }
  renderEditorProducto(p);
}
const sinHtml = (s) => String(s || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
function renderEditorProducto(p) {
  PROD_EDIT = p;
  const imgs = (p.images || []).map((im, i) => `<div class="ed-img"><img src="${esc(im.src)}" alt=""><button class="ed-img-x" data-edimg="${i}" title="Quitar">✕</button></div>`).join("");
  const vars = (p.variaciones || []).map((v, i) => `<div class="ed-var">
      <div class="ed-var-img">${v.imagen ? `<img src="${esc(v.imagen)}" alt="">` : "🦷"}</div>
      <div class="ed-var-main"><b>${esc(v.label)}</b>
        <div class="ed-var-r">$<input class="ed-vp" data-vi="${i}" value="${v.precio}" inputmode="numeric"> · stock <input class="ed-vs" data-vi="${i}" value="${v.stock == null ? "" : v.stock}" inputmode="numeric" style="width:56px">
          <button class="btn ghost sm" data-vfoto="${i}">📷 Foto</button><button class="btn sm" data-vsave="${i}">Guardar</button></div>
      </div></div>`).join("");
  const slotOpts = (DATA.muebles.muebles || []).map((m) => `<optgroup label="${esc(m.nombre)}">${m.secciones.flatMap((s) => s.slots.map((sl) => `<option value="${sl.id}">${esc(sl.label)}</option>`)).join("")}</optgroup>`).join("");
  const grupoOpts = (CATS_WC || []).map((g) => `<option value="${g.id}" ${g.id === p.grupo_id ? "selected" : ""}>${esc(g.name)}</option>`).join("");
  const subgrupoActual = (CATS_WC || []).find((g) => g.id === p.grupo_id);
  const subOpts = (subgrupoActual?.hijas || []).map((s) => `<option value="${s.id}" ${s.id === p.subgrupo_id ? "selected" : ""}>${esc(s.name)}</option>`).join("");
  $("#modal-body").innerHTML = `
    <label class="ed-l">Nombre<input id="ed-nombre" value="${esc(p.nombre)}"></label>
    <label class="ed-l">Código (SKU)<input id="ed-sku" value="${esc(p.sku || "")}" placeholder="código de barras / interno — ponéselo a los duplicados"></label>
    ${p.tipo !== "variable" ? `<div class="ed-row2"><label class="ed-l">Precio<input id="ed-precio" value="${p.precio || ""}" inputmode="numeric"></label><label class="ed-l">Existencias (stock)<input id="ed-stock" value="${p.stock == null ? "" : p.stock}" inputmode="numeric" placeholder="cantidad"></label></div>` : '<p class="meta">Precio y existencias se editan por variación (abajo).</p>'}
    <div class="ed-row2"><label class="ed-l">💲 Precio de costo<input id="ed-costo" value="${p.costo || ""}" inputmode="numeric" placeholder="costo"></label><label class="ed-l">🚚 Proveedor<select id="ed-prov"><option value="">— sin proveedor —</option>${(p.proveedores || []).map((pp) => `<option value="${esc(pp.id)}" ${pp.id === p.proveedorId ? "selected" : ""}>${esc(pp.nombre)}</option>`).join("")}</select></label></div>
    <label class="ed-l">📅 Vencimiento <input id="ed-venc" type="date" value="${p.vencimiento || ""}"> <span class="meta">(dejalo vacío si el producto no vence)</span></label>
    <p class="meta" id="ed-margen">${(p.costo && p.precio) ? `Margen: <b>${Math.round((1 - p.costo / p.precio) * 100)}%</b> · utilidad ${fmtAR(p.precio - p.costo)}` : "Cargá costo y precio para ver el margen."}</p>
    <div class="ed-row2"><label class="ed-l">Peso (kg)<input id="ed-peso" value="${esc(p.peso || "")}"></label><label class="ed-l">URL (slug)<input id="ed-slug" value="${esc(p.slug || "")}"></label></div>
    <div class="ed-row2"><label class="ed-l">Largo (cm)<input id="ed-largo" value="${esc((p.dimensiones || {}).length || "")}" inputmode="decimal"></label><label class="ed-l">Ancho (cm)<input id="ed-ancho" value="${esc((p.dimensiones || {}).width || "")}" inputmode="decimal"></label><label class="ed-l">Alto (cm)<input id="ed-alto" value="${esc((p.dimensiones || {}).height || "")}" inputmode="decimal"></label></div>
    <label class="ed-l">Descripción corta<textarea id="ed-corta" rows="2">${esc(sinHtml(p.descripcion_corta))}</textarea></label>
    <label class="ed-l">Descripción<textarea id="ed-desc" rows="5">${esc(sinHtml(p.descripcion))}</textarea></label>
    <div class="ed-row2">
      <label class="ed-l">Grupo<select id="ed-grupo"><option value="">— sin grupo —</option>${grupoOpts}</select></label>
      <label class="ed-l">Subcategoría<select id="ed-subgrupo"><option value="">— sin subcategoría —</option>${subOpts}</select></label>
    </div>
    <div class="ed-l">Ubicaciones en el local<div id="ed-ubic"></div>
      <div class="ed-ubic-add"><select id="ed-ubic-slot"><option value="">Elegí un lugar…</option>${slotOpts}</select> <input id="ed-ubic-cant" type="number" min="0" placeholder="cant" style="width:64px"><button class="btn ghost sm" id="ed-ubic-add-btn">Agregar acá</button></div>
    </div>
    <div class="ed-l">Fotos del producto
      <div class="ed-imgs">${imgs}<label class="ed-img-add">＋ Subir<input type="file" id="ed-file" accept="image/*" hidden></label></div>
      <div class="ed-url-row"><input id="ed-img-url" placeholder="…o pegá la URL de una imagen"><button class="btn ghost sm" id="ed-img-url-add">Agregar URL</button></div>
    </div>
    ${vars ? `<div class="ed-l">Variaciones (medidas / colores)<div class="ed-vars">${vars}</div></div>` : ""}
    <div class="ed-l">🎁 Combo — productos que incluye<div id="ed-combo"></div>
      <p class="meta">Si este producto es un <b>combo</b> (no existe como tal, sino que es un pack), agregá acá los productos que lo forman. Al vender, se desglosan y el empleado elige la medida y de dónde sacar cada uno. Dejalo vacío si no es combo.</p>
    </div>
    <div class="ed-acciones"><button class="btn" id="ed-guardar">💾 Guardar producto</button><button class="btn ghost" id="ed-duplicar">📋 Duplicar</button></div> <span class="meta" id="ed-msg"></span>`;
  const mb = $("#modal-body");
  mb.querySelectorAll("[data-edimg]").forEach((b) => b.onclick = () => { PROD_EDIT.images.splice(+b.dataset.edimg, 1); renderEditorProducto(PROD_EDIT); });
  $("#ed-file").onchange = async (e) => { const f = e.target.files[0]; if (!f) return; const url = await subirImagen(f); if (url) { PROD_EDIT.images.push({ src: url }); renderEditorProducto(PROD_EDIT); } };
  $("#ed-img-url-add").onclick = () => { const v = $("#ed-img-url").value.trim(); if (v) { PROD_EDIT.images.push({ src: v }); renderEditorProducto(PROD_EDIT); } };
  $("#ed-guardar").onclick = guardarProducto;
  const edMargen = () => { const c = Number($("#ed-costo") && $("#ed-costo").value) || 0, pr = Number($("#ed-precio") && $("#ed-precio").value) || 0; const el = $("#ed-margen"); if (el) el.innerHTML = (c && pr) ? `Margen: <b>${Math.round((1 - c / pr) * 100)}%</b> · utilidad ${fmtAR(pr - c)}` : "Cargá costo y precio para ver el margen."; };
  if ($("#ed-costo")) $("#ed-costo").oninput = edMargen;
  if ($("#ed-precio")) $("#ed-precio").oninput = edMargen;
  // Cascada grupo → subgrupo
  if ($("#ed-grupo")) $("#ed-grupo").onchange = () => {
    const gid = Number($("#ed-grupo").value) || null;
    const g = (CATS_WC || []).find((x) => x.id === gid);
    const hijas = g?.hijas || [];
    $("#ed-subgrupo").innerHTML = `<option value="">— sin subcategoría —</option>` + hijas.map((s) => `<option value="${s.id}">${esc(s.name)}</option>`).join("");
  };
  $("#ed-duplicar").onclick = async () => {
    if (!confirm("¿Duplicar este producto? Se crea una copia (con sus variaciones) que después podés editar.")) return;
    const btn = $("#ed-duplicar"); btn.disabled = true; $("#ed-msg").textContent = "Duplicando…";
    const r = await api("/api/admin/producto-duplicar", { id: p.id });
    if (r && r.ok) { toast("✅ Producto duplicado"); try { DATA = await (await fetch("/api/data")).json(); } catch {} rerender(); editarProducto(r.id); }
    else { btn.disabled = false; $("#ed-msg").textContent = (r && r.error) || "No se pudo duplicar"; }
  };
  mb.querySelectorAll("[data-vsave]").forEach((b) => b.onclick = () => guardarVariacion(+b.dataset.vsave));
  mb.querySelectorAll("[data-vfoto]").forEach((b) => b.onclick = () => { const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*"; inp.onchange = async () => { const f = inp.files[0]; if (!f) return; const url = await subirImagen(f); if (url) { PROD_EDIT.variaciones[+b.dataset.vfoto].imagen = url; PROD_EDIT.variaciones[+b.dataset.vfoto]._imgChanged = true; renderEditorProducto(PROD_EDIT); } }; inp.click(); });
  renderEditUbic(p.id);
  renderComboSection();
  $("#ed-ubic-add-btn").onclick = async () => {
    const slotId = $("#ed-ubic-slot").value, cant = $("#ed-ubic-cant").value;
    if (!slotId) return toast("Elegí un lugar");
    await api("/api/asignar", { productId: p.id, slotId, cantidad: cant === "" ? null : Number(cant) });
    await refresh(); renderEditUbic(p.id); renderBuscar(); toast("Ubicación agregada");
  };
}
function renderEditUbic(pid) {
  const cont = $("#ed-ubic"); if (!cont) return;
  const locs = locsOf(pid, null);
  cont.innerHTML = locs.length ? locs.map((a) => `<div class="ed-ubic-row"><span>📍 ${esc(slotTxt(a.slotId))}${a.cantidad != null ? ` · ${a.cantidad} u.` : ""}</span><button class="ed-ubic-x" data-edub="${esc(a.slotId)}">✕</button></div>`).join("") : '<p class="meta">Sin ubicación asignada.</p>';
  cont.querySelectorAll("[data-edub]").forEach((b) => b.onclick = async () => { await api("/api/desasignar", { productId: pid, slotId: b.dataset.edub }); await refresh(); renderEditUbic(pid); renderBuscar(); });
}
// --- Combo: componentes del producto-combo (en el editor) ---
function comboComps() { if (!PROD_EDIT.combo) PROD_EDIT.combo = { componentes: [] }; if (!PROD_EDIT.combo.componentes) PROD_EDIT.combo.componentes = []; return PROD_EDIT.combo.componentes; }
async function guardarCombo() { await api("/api/admin/combo-set", { productId: PROD_EDIT.id, componentes: comboComps() }); }
function renderComboSection() {
  const cont = $("#ed-combo"); if (!cont) return;
  const comps = comboComps();
  const prodById = (id) => DATA.catalogo.productos.find((p) => p.id === id);
  const rows = comps.map((c, i) => {
    const p = prodById(c.productId), esVar = p && (p.tipo === "variable" || (p.variaciones || []).length);
    const varCell = esVar ? `<select class="cmb-var" data-ci="${i}"><option value="">medida: la elige el empleado</option>${(p.variaciones || []).map((v) => `<option value="${v.id}" ${c.variationId === v.id ? "selected" : ""}>${esc(v.label)}</option>`).join("")}</select>` : "";
    return `<div class="cmb-row"><div class="cmb-info"><b>${esc(p ? p.nombre : "#" + c.productId)}</b> ${varCell}</div>
      <span class="cmb-x-wrap">× <input type="number" min="1" class="cmb-cant" data-ci="${i}" value="${c.cantidad}" title="cantidad"><button class="cmb-x" data-ci="${i}" title="Quitar">✕</button></span></div>`;
  }).join("") || `<p class="meta">— sin componentes —</p>`;
  cont.innerHTML = `<div class="cmb-list">${rows}</div><div class="cmb-add"><input id="ed-combo-q" placeholder="🔎 Buscar producto para incluir…" autocomplete="off"><div id="ed-combo-res" class="cmb-res"></div></div>`;
  cont.querySelectorAll(".cmb-x").forEach((b) => b.onclick = async () => { comps.splice(+b.dataset.ci, 1); await guardarCombo(); renderComboSection(); });
  cont.querySelectorAll(".cmb-cant").forEach((inp) => inp.onchange = async () => { comps[+inp.dataset.ci].cantidad = Math.max(1, Math.round(Number(inp.value) || 1)); await guardarCombo(); });
  cont.querySelectorAll(".cmb-var").forEach((sel) => sel.onchange = async () => { comps[+sel.dataset.ci].variationId = sel.value ? Number(sel.value) : null; await guardarCombo(); });
  const q = $("#ed-combo-q"); if (q) q.oninput = () => {
    const t = q.value.toLowerCase().trim(), res = $("#ed-combo-res");
    if (t.length < 2) { res.innerHTML = ""; return; }
    const list = DATA.catalogo.productos.filter((p) => p.id !== PROD_EDIT.id && ((p.nombre || "") + " " + (p.sku || "")).toLowerCase().includes(t)).slice(0, 8);
    res.innerHTML = list.map((p) => `<div class="cmb-opt" data-add="${p.id}">${esc(p.nombre)} <span class="meta">${esc(p.sku || p.id)}${(p.tipo === "variable" || (p.variaciones || []).length) ? " · variable" : ""}</span></div>`).join("") || '<div class="meta">Sin resultados</div>';
    res.querySelectorAll("[data-add]").forEach((el) => el.onclick = async () => {
      const pid = Number(el.dataset.add);
      if (!comps.some((c) => c.productId === pid && !c.variationId)) comps.push({ productId: pid, variationId: null, cantidad: 1 });
      await guardarCombo(); renderComboSection();
    });
  };
}
async function subirImagen(file) {
  if (file.size > 6 * 1024 * 1024) { toast("Imagen muy grande (máx 6MB)"); return null; }
  toast("Subiendo imagen…");
  const data = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(file); });
  const r = await api("/api/admin/subir-imagen", { data });
  if (r && r.ok) return r.url;
  toast((r && r.error) || "No se pudo subir"); return null;
}
async function guardarProducto() {
  const p = PROD_EDIT, btn = $("#ed-guardar"); btn.disabled = true; $("#ed-msg").textContent = "Guardando…";
  const grupo_id = $("#ed-grupo") ? (Number($("#ed-grupo").value) || null) : undefined;
  const subgrupo_id = $("#ed-subgrupo") ? (Number($("#ed-subgrupo").value) || null) : undefined;
  const body = { id: p.id, nombre: $("#ed-nombre").value.trim(), sku: $("#ed-sku") ? $("#ed-sku").value.trim() : undefined, descripcion_corta: $("#ed-corta").value.trim(), descripcion: $("#ed-desc").value.trim(), images: p.images, peso: $("#ed-peso") ? $("#ed-peso").value.trim() : "", slug: $("#ed-slug") ? $("#ed-slug").value.trim() : "", grupo_id, subgrupo_id, dimensiones: { length: $("#ed-largo") ? $("#ed-largo").value.trim() : "", width: $("#ed-ancho") ? $("#ed-ancho").value.trim() : "", height: $("#ed-alto") ? $("#ed-alto").value.trim() : "" } };
  if ($("#ed-precio")) body.precio = $("#ed-precio").value;
  if ($("#ed-stock")) body.stock = $("#ed-stock").value;
  if ($("#ed-costo")) body.costo = $("#ed-costo").value;
  if ($("#ed-prov")) body.proveedorId = $("#ed-prov").value;
  const r = await api("/api/admin/producto", body);
  if ($("#ed-venc")) await api("/api/admin/vencimiento-set", { productId: p.id, nombre: $("#ed-nombre").value.trim(), fecha: anio4($("#ed-venc").value) || "" }); // vencimiento de ficha
  btn.disabled = false;
  if (r && r.ok) {
    $("#ed-msg").textContent = "✅ Guardado";
    const prod = DATA.catalogo.productos.find((x) => x.id === p.id);
    if (prod) { prod.nombre = $("#ed-nombre").value.trim(); if ($("#ed-sku")) prod.sku = $("#ed-sku").value.trim(); if (r.imagen) prod.imagen = r.imagen; if ($("#ed-precio")) prod.precio = Number($("#ed-precio").value) || prod.precio; }
    toast("Producto actualizado"); rerender();
  } else $("#ed-msg").textContent = (r && r.error) || "No se pudo guardar";
}
async function guardarVariacion(i) {
  const p = PROD_EDIT, v = p.variaciones[i];
  const vp = $(`.ed-vp[data-vi="${i}"]`).value, vs = $(`.ed-vs[data-vi="${i}"]`).value;
  const r = await api("/api/admin/producto/variacion", { productId: p.id, variationId: v.id, precio: vp, stock: vs, image: v._imgChanged ? { src: v.imagen } : undefined });
  toast(r && r.ok ? "✅ Variación guardada" : (r && r.error) || "No se pudo");
}
function rolTxt(r) { return r === "exhibicion" ? "a la vista" : r === "deposito" ? "depósito" : "guardado"; }
function renderUbicPick(it, orderId) {
  const ubics = it.ubicaciones || [];
  if (!ubics.length) return "sin ubicación asignada";
  const reco = ubics.find((u) => u.recomendado) || ubics[0];
  const conStock = ubics.filter((u) => u.cantidad == null || u.cantidad > 0);
  const lista = conStock.length ? conStock : ubics;
  const opts = lista.map((u) => `<option value="${esc(u.slotId)}" ${u.slotId === reco.slotId ? "selected" : ""}>${esc(u.label)}${u.cantidad != null ? ` (${u.cantidad})` : ""}${u.ultima ? " · última opción" : ""}</option>`).join("");
  return `<div class="pick-reco">👉 Sacá de: <select class="pick-sel" data-pid="${it.product_id}" data-vid="${it.variation_id || ""}" data-cant="${it.cantidad}">${opts}</select> <span class="pick-rol ${reco.rol}">${rolTxt(reco.rol)}</span></div>`;
}
// --- Combo: desglose en preparar pedido (elegir medida + ubicación de cada componente) ---
let COMBO_PICKS = {}; // durante el modal: comboProductId -> [{variationId, slotId}]
function comboDe(pid) { return (DATA.combos && DATA.combos[pid] && DATA.combos[pid].componentes) || null; }
function comboLocs(pid, vid) { return ((DATA.ubicaciones && DATA.ubicaciones.asignaciones) || []).filter((a) => a.productId === pid && (a.variationId || null) === (vid || null) && (a.cantidad == null || a.cantidad > 0)); }
function comboPickState(pid) {
  if (!COMBO_PICKS[pid]) { const comps = comboDe(pid) || []; COMBO_PICKS[pid] = comps.map((c) => { const locs = comboLocs(c.productId, c.variationId || null); return { variationId: c.variationId || null, slotId: locs[0] ? locs[0].slotId : "" }; }); }
  return COMBO_PICKS[pid];
}
function renderComboDesglose(it, orderId) {
  const pid = it.product_id, cont = $("#cmb-dg-" + pid); if (!cont) return;
  const comps = comboDe(pid) || [], st = comboPickState(pid), comboQty = it.cantidad || 1;
  cont.innerHTML = `<div class="cmb-dg-t">🎁 incluye:</div>` + comps.map((c, i) => {
    const p = DATA.catalogo.productos.find((x) => x.id === c.productId), esVar = p && (p.tipo === "variable" || (p.variaciones || []).length);
    const cant = (c.cantidad || 1) * comboQty, vid = st[i].variationId, needVar = esVar && !vid;
    const varSel = esVar ? `<select class="cmb-dg-var" data-ci="${i}"><option value="">elegí medida…</option>${(p.variaciones || []).map((v) => `<option value="${v.id}" ${vid === v.id ? "selected" : ""}>${esc(v.label)}</option>`).join("")}</select>` : "";
    const locs = comboLocs(c.productId, vid);
    const slotSel = `<select class="cmb-dg-slot" data-ci="${i}" ${needVar ? "disabled" : ""}>${locs.length ? locs.map((a) => `<option value="${esc(a.slotId)}" ${a.slotId === st[i].slotId ? "selected" : ""}>${esc(slotTxt(a.slotId))}${a.cantidad != null ? ` (${a.cantidad})` : ""}</option>`).join("") : `<option value="">${needVar ? "elegí la medida primero" : "sin stock en ubicaciones"}</option>`}</select>`;
    return `<div class="cmb-dg-row ${needVar ? "falta" : ""}"><span class="cmb-dg-nom">${esc(p ? p.nombre : "#" + c.productId)} <b>×${cant}</b></span> ${varSel} <span class="cmb-dg-loc">📍 ${slotSel}</span></div>`;
  }).join("");
  cont.querySelectorAll(".cmb-dg-var").forEach((sel) => sel.onchange = () => { const i = +sel.dataset.ci; st[i].variationId = sel.value ? Number(sel.value) : null; const locs = comboLocs(comps[i].productId, st[i].variationId); st[i].slotId = locs[0] ? locs[0].slotId : ""; renderComboDesglose(it, orderId); guardarComboPick(it, orderId); });
  cont.querySelectorAll(".cmb-dg-slot").forEach((sel) => sel.onchange = () => { st[+sel.dataset.ci].slotId = sel.value; guardarComboPick(it, orderId); });
}
function guardarComboPick(it, orderId) {
  const pid = it.product_id, comps = comboDe(pid) || [], st = comboPickState(pid), comboQty = it.cantidad || 1;
  const componentes = comps.map((c, i) => ({ productId: c.productId, variationId: st[i].variationId, slotId: st[i].slotId, cant: (c.cantidad || 1) * comboQty }));
  api("/api/admin/pedido/combo-pick", { order_id: orderId, comboProductId: pid, componentes });
}
function abrirCambio(d) {
  openModal(`🔄 Cambio / Devolución — pedido #${d.num}`, `
    <p class="meta">Si el cliente paga la diferencia, entra a la caja. Si le queda saldo a favor, va a su cuenta corriente como crédito.</p>
    <label class="cb-l">Valor de lo que <b>devuelve</b> el cliente<div class="cb-in">$<input id="cb-dev" type="number" min="0" value="0" inputmode="numeric"></div></label>
    <label class="cb-l">Valor de lo que <b>se lleva</b> a cambio<div class="cb-in">$<input id="cb-lle" type="number" min="0" value="0" inputmode="numeric"></div></label>
    <div id="cb-net" class="cb-net"></div>
    <div id="cb-medio-wrap" style="display:none;margin:8px 0">Medio del cobro: <select id="cb-medio"><option value="efectivo">Efectivo</option><option value="transferencia">Transferencia</option><option value="mp">Mercado Pago</option></select></div>
    <button class="btn" id="cb-ok">Registrar cambio</button> <span class="meta" id="cb-msg"></span>`);
  const calc = () => {
    const dev = Number($("#cb-dev").value) || 0, lle = Number($("#cb-lle").value) || 0, net = lle - dev, w = $("#cb-net");
    if (net > 0) { w.innerHTML = `💵 El cliente paga <b>${fmtAR(net)}</b> → entra a la <b>caja</b>.`; $("#cb-medio-wrap").style.display = ""; }
    else if (net < 0) { w.innerHTML = `🎁 Saldo a favor del cliente: <b>${fmtAR(-net)}</b> → a su <b>cuenta corriente</b>.`; $("#cb-medio-wrap").style.display = "none"; }
    else { w.innerHTML = "Cambio par (sin diferencia)."; $("#cb-medio-wrap").style.display = "none"; }
  };
  $("#cb-dev").oninput = calc; $("#cb-lle").oninput = calc; calc();
  $("#cb-ok").onclick = async () => {
    const dev = Number($("#cb-dev").value) || 0, lle = Number($("#cb-lle").value) || 0;
    if (dev === 0 && lle === 0) return toast("Cargá los montos");
    const medio = $("#cb-medio") ? $("#cb-medio").value : "";
    const r = await api("/api/admin/cambio", { pedido: d.num, cliente: d.cli, email: d.email, devuelto: dev, llevado: lle, medio });
    if (r && r.ok) { const t = r.net > 0 ? `Cobro de ${fmtAR(r.net)} a caja (${medio})` : r.net < 0 ? `Saldo a favor ${fmtAR(-r.net)} a cuenta corriente` : "Cambio par registrado"; toast("✅ " + t); closeModal(); }
    else toast((r && r.error) || "No se pudo registrar");
  };
}
// Normaliza el título de pago de WooCommerce al valor del selector
function pagoToVal(t) { const s = String(t || "").toLowerCase(); if (s.includes("efectivo")) return "efectivo"; if (s.includes("mercado")) return "mp"; if (s.includes("nave")) return "nave"; if (s.includes("transfer")) return "transferencia"; return "transferencia"; }
async function openPedido(id) {
  openModal("Pedido", '<p class="meta">Cargando…</p>');
  const p = await (await fetch("/api/admin/pedido?id=" + id)).json();
  if (p.error) { $("#modal-body").innerHTML = `<p class="meta">${esc(p.error)}</p>`; return; }
  COMBO_PICKS = {};
  const items = p.items.map((it) => {
    const esCombo = !!comboDe(it.product_id);
    const ubicHtml = esCombo ? `<div class="cmb-desglose" id="cmb-dg-${it.product_id}"></div>` : renderUbicPick(it, id);
    return `<div class="pick-item">
      <div><div class="pi-nombre">${esc(it.nombre)}${esCombo ? ' <span class="pi-combo">🎁 combo</span>' : ""}</div>
        <div class="pi-sku">cód: ${esc(it.sku || "—")}</div>
        <div class="pi-ubic ${esCombo || it.ubicaciones.length ? "" : "sin"}">${ubicHtml}</div></div>
      <span class="pi-cant">${it.cantidad} × ${fmtAR(it.precio_unit)}<br><b>${fmtAR(it.total)}</b></span></div>`;
  }).join("");
  openModal(`Pedido #${esc(p.number || p.id)}`, `
    <div class="ped-resumen">
      <div><span>N° pedido</span><b>#${esc(p.number || p.id)}</b></div>
      <div><span>Fecha y hora</span><b>${fechaHora(p.date_created)}</b></div>
      <div><span>Ítems</span><b>${p.items.length} (${p.items.reduce((n, it) => n + (it.cantidad || 0), 0)} u.)</b></div>
      <div><span>Envío</span><b>🚚 ${esc(p.envio_titulo || p.envio || "Retiro en el local")}${p.envio_costo ? " · " + fmtAR(p.envio_costo) : " · gratis"}</b></div>
      <div><span>Total</span><b>${fmtAR(p.total)}</b></div>
    </div>
    <div class="ped-cli"><strong>${esc(p.cliente.nombre || "—")}</strong><br>${esc(p.cliente.email || "")} · ${esc(p.cliente.telefono || "")}
      <br>📦 ${esc(p.cliente.direccion || "sin dirección cargada")}
      ${p.envio ? "<br>Envío: " + esc(p.envio) : ""}${p.pago ? " · Pago: " + esc(p.pago) : ""}</div>
    ${(p.nota || (p.cupones && p.cupones.length)) ? `<div class="ped-extra">
      ${p.nota ? `<div class="ped-nota">📝 <b>Nota:</b> ${esc(p.nota)}</div>` : ""}
      ${(p.cupones && p.cupones.length) ? `<div class="ped-cupon">🎟️ <b>Cupón:</b> ${p.cupones.map((c) => `${esc(c.code)}${c.descuento ? " (−" + fmtAR(c.descuento) + ")" : ""}`).join(", ")}</div>` : ""}
    </div>` : ""}
    <h5 style="margin:10px 0 4px;text-transform:uppercase;letter-spacing:.5px;color:var(--muted);font-size:12px">Lista de pickeo</h5>
    ${items}
    <div style="margin-top:16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
      <label style="font-size:13px;color:var(--muted)">Estado:
        <select id="ped-estado-sel" data-id="${id}" style="margin-left:6px;padding:7px 9px;border:1px solid var(--border);border-radius:8px">
          ${[["pending", "Pendiente de pago"], ["processing", "En proceso"], ["on-hold", "En espera"], ["completed", "Completado"], ["cancelled", "Cancelado"], ["refunded", "Reembolsado"]].map(([v, t]) => `<option value="${v}" ${p.status === v ? "selected" : ""}>${t}</option>`).join("")}
        </select></label>
      <label style="font-size:13px;color:var(--muted)">💳 Pago:
        <select id="ped-pago-sel" data-id="${id}" style="margin-left:6px;padding:7px 9px;border:1px solid var(--border);border-radius:8px">
          ${[["efectivo", "Efectivo"], ["transferencia", "Transferencia"], ["mp", "Mercado Pago"], ["nave", "Nave"]].map(([v, t]) => `<option value="${v}" ${pagoToVal(p.pago) === v ? "selected" : ""}>${t}</option>`).join("")}
        </select></label>
      <span class="badge price">Total ${fmtAR(p.total)}</span>
    </div>
    <label class="ped-reparto"><input type="checkbox" id="ped-reparto" ${p.reparto ? "checked" : ""}> 🛵 Marcado para reparto (lo lleva el cadete — aparece en Reparto)</label>
    <div style="margin-top:12px;display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn sm" id="ped-editar">✏️ Editar productos</button>
      <button class="btn ghost sm" id="ped-vercarrito">👁️ Ver como carrito</button>
      <button class="btn ghost sm" data-prep="${id}" data-estado="${p.preparado ? "1" : "0"}">${p.preparado ? "✓ Preparado — deshacer" : "Marcar preparado"}</button>
      ${p.factura
      ? `<a class="btn sm" href="/factura/${p.factura.id}" target="_blank" rel="noopener">🖨️ Imprimir factura ${esc(p.factura.numero)}</a>`
      : `<button class="btn sm" data-facturar="${id}" data-num="${esc(p.number || id)}" data-total="${p.total}" data-cli="${esc(p.cliente.nombre || "")}">🧾 Facturar este pedido</button>`}
      <button class="btn ghost sm" data-ctacte="${id}" data-num="${esc(p.number || id)}" data-cli="${esc(p.cliente.nombre || "")}" data-email="${esc(p.cliente.email || "")}" data-total="${p.total}">📒 Poner en cuenta corriente</button>
      <button class="btn ghost sm" data-cambio="${id}" data-num="${esc(p.number || id)}" data-cli="${esc(p.cliente.nombre || "")}" data-email="${esc(p.cliente.email || "")}">🔄 Cambio / Devolución</button>
      ${p.cliente.telefono ? `<a class="btn wa-btn sm" id="ped-wa" target="_blank" rel="noopener">📱 WhatsApp al cliente</a>` : ""}
    </div>
    ${p.cliente.telefono ? `<div class="ped-avisos"><span class="ped-avisos-t">📲 Avisar al cliente (1 toque):</span><a class="btn wa-btn sm" id="wa-ev-recibido" target="_blank" rel="noopener">✅ Pedido recibido</a><a class="btn wa-btn sm" id="wa-ev-salio" target="_blank" rel="noopener">🛵 Salió / en camino</a><a class="btn wa-btn sm" id="wa-ev-pago" target="_blank" rel="noopener">💳 Pago recibido</a></div>` : '<p class="meta" style="margin-top:8px">Para avisar al cliente por WhatsApp, cargá su teléfono en la ficha.</p>'}`);
  const wa = $("#ped-wa"); if (wa) wa.href = waLink(p.cliente.telefono, waMensajePedido(p)) || "#";
  for (const [eid, tipo] of [["wa-ev-recibido", "recibido"], ["wa-ev-salio", "salio"], ["wa-ev-pago", "pago"]]) { const el = $("#" + eid); if (el) el.href = waLink(p.cliente.telefono, waMsgEvento(tipo, p)) || "#"; }
  const pe = $("#ped-editar"); if (pe) pe.onclick = () => editarPedido(p);
  const pvc = $("#ped-vercarrito"); if (pvc) pvc.onclick = () => verPedidoResumen(p);
  p.items.forEach((it) => { if (comboDe(it.product_id)) { renderComboDesglose(it, id); guardarComboPick(it, id); } }); // desglose de combos + guarda picks por defecto
  $$(".pick-sel").forEach((selp) => selp.onchange = async () => {
    const pid = Number(selp.dataset.pid), vid = selp.dataset.vid ? Number(selp.dataset.vid) : null, cant = Number(selp.dataset.cant) || 0, toSlot = selp.value;
    selp.disabled = true;
    const r = await api("/api/admin/pedido/sacar-de", { order_id: id, productId: pid, variationId: vid, cant, toSlot });
    selp.disabled = false;
    if (r && r.ok) { if (r.asignaciones && DATA.ubicaciones) DATA.ubicaciones.asignaciones = r.asignaciones; toast(r.movido ? "📍 Movido a " + slotTxt(toSlot) : "📍 Al completar se saca de " + slotTxt(toSlot)); }
    else toast((r && r.error) || "No se pudo");
  });
  const repCb = $("#ped-reparto"); if (repCb) repCb.onchange = async () => {
    repCb.disabled = true;
    const r = await api("/api/admin/pedido/reparto", { id, reparto: repCb.checked });
    repCb.disabled = false;
    if (r && r.ok) { toast(repCb.checked ? "🛵 Marcado para reparto" : "Quitado de reparto"); cargarPedidos(); }
    else { repCb.checked = !repCb.checked; toast((r && r.error) || "No se pudo"); }
  };
  const sel = $("#ped-estado-sel");
  if (sel) sel.onchange = async () => {
    const r = await api("/api/admin/pedido-estado", { id: Number(sel.dataset.id), estado: sel.value });
    toast(r && r.ok ? "Estado actualizado en WooCommerce" : (r && r.error) || "No se pudo");
    if (r && r.ok) {
      if (sel.value === "cancelled" && r.restaurado && r.restaurado.length) mostrarDevolverUbic(r.restaurado);
      cargarPedidos();
    }
  };
  const psel = $("#ped-pago-sel");
  if (psel) psel.onchange = async () => {
    psel.disabled = true;
    const pid = Number(psel.dataset.id);
    const r = await api("/api/admin/pedido/pago", { id: pid, pago: psel.value });
    psel.disabled = false;
    if (r && r.ok) {
      toast(r.recargo ? `💳 Recargo ${fmtAR(r.recargo)} aplicado · total ${fmtAR(r.total)}` : `💳 Pago actualizado · total ${fmtAR(r.total)}`);
      cargarPedidos(); openPedido(pid); // refresca el modal con el nuevo total
    } else toast((r && r.error) || "No se pudo");
  };
}
// ---- Ver un pedido como "carrito" (resumen con fotos para mandar al cliente) ----
function verPedidoResumen(p) {
  const filas = (p.items || []).map((it) => {
    const prod = DATA.catalogo.productos.find((x) => x.id === it.product_id);
    const img = prod && prod.imagen;
    return `<div class="share-item">
      ${img ? `<img class="share-item-img" src="${esc(img)}" alt="">` : `<div class="share-item-img ph">🦷</div>`}
      <div class="share-item-info"><div class="share-item-n">${esc(it.nombre)}</div><div class="share-item-pu">${it.cantidad} × ${fmtAR(it.precio_unit || 0)}</div></div>
      <div class="share-item-sub">${fmtAR(it.total)}</div>
    </div>`;
  }).join("");
  openModal(`Pedido #${esc(p.number || p.id)}`, `
    <div class="share-doc" id="share-doc">
      <img class="share-logo" src="/assets/logo.png" alt="El Pasaje Dental">
      ${p.cliente?.nombre ? `<div class="share-cli">Para: <b>${esc(p.cliente.nombre)}</b></div>` : ""}
      <div class="share-items">${filas}</div>
      <div class="share-tot">
        ${p.envio ? `<div><span>Envío</span><b>${esc(p.envio)}</b></div>` : ""}
        <div class="big"><span>TOTAL</span><b>${fmtAR(p.total)}</b></div>
      </div>
      <div class="share-foot">El Pasaje Dental · elpasajedental.com</div>
    </div>
    <p class="meta share-hint">📸 Sacá una captura y mandásela al cliente.</p>`);
}
// ---- Editar productos de un pedido (cambiar cantidades, agregar, quitar) ----
let PEDED = null;
function editarPedido(p) {
  PEDED = {
    id: p.id, number: p.number,
    items: (p.items || []).map((it) => ({ line_item_id: it.line_item_id, nombre: it.nombre, sku: it.sku, precio_unit: it.precio_unit || 0, qty: it.cantidad })),
    nuevos: [], envio: p.envio_costo || 0, envioOrig: p.envio_costo || 0, envioTitulo: p.envio_titulo || p.envio || "",
  };
  renderPedidoEdit();
}
function renderPedidoEdit() {
  const e = PEDED;
  const envioN = Number(e.envio) || 0;
  const total = e.items.reduce((s, i) => s + (i.precio_unit || 0) * i.qty, 0) + e.nuevos.reduce((s, n) => s + (n.precio || 0) * n.qty, 0) + envioN;
  const filas = e.items.map((it, idx) => `<div class="pe-item ${it.qty === 0 ? "quitado" : ""}">
      <div class="pe-n">${esc(it.nombre)}${it.sku ? ` <span class="meta">${esc(it.sku)}</span>` : ""}</div>
      <div class="pe-ctrl"><button class="pe-q" data-peq="${idx}|-1">−</button><span class="pe-qn">${it.qty}</span><button class="pe-q" data-peq="${idx}|1">＋</button>
        <span class="pe-sub">${fmtAR((it.precio_unit || 0) * it.qty)}</span>
        <button class="pe-del" data-pedel="${idx}" title="Quitar">✕</button></div></div>`).join("");
  const nuevos = e.nuevos.map((n, idx) => `<div class="pe-item nuevo">
      <div class="pe-n">🆕 ${esc(n.nombre)}</div>
      <div class="pe-ctrl"><button class="pe-q" data-penq="${idx}|-1">−</button><span class="pe-qn">${n.qty}</span><button class="pe-q" data-penq="${idx}|1">＋</button>
        <span class="pe-sub">${fmtAR((n.precio || 0) * n.qty)}</span>
        <button class="pe-del" data-pendel="${idx}" title="Quitar">✕</button></div></div>`).join("");
  openModal(`Editar pedido #${esc(e.number || e.id)}`, `
    <p class="meta">Cambiá cantidades, agregá o quitá productos. Se guarda en WooCommerce y recalcula el total.</p>
    <div class="pe-list">${filas}${nuevos || ""}</div>
    <div class="pe-add"><input id="pe-buscar" placeholder="🔎 Agregar producto al pedido…" autocomplete="off"><div id="pe-res" class="pe-res"></div></div>
    <label class="pe-envio">🚚 Costo de envío $ <input id="pe-envio" inputmode="numeric" value="${envioN}">${e.envioTitulo ? ` <span class="meta">(${esc(e.envioTitulo)})</span>` : ""}</label>
    <div class="pe-total">Total estimado: <b>${fmtAR(total)}</b></div>
    ${ROL_ADMIN === "dueno" ? `<label class="pe-totalfinal">💰 Fijar total final $ <input id="pe-totalfinal" inputmode="numeric" placeholder="vacío = no cambiar"></label><p class="meta">Ajusta el total del pedido a ese valor exacto (agrega un renglón "Ajuste"). Solo dueño.</p>` : ""}
    <div class="pe-acc"><button class="btn" id="pe-guardar">💾 Guardar cambios</button><button class="btn ghost" id="pe-cancelar">Volver</button></div>
    <span class="meta" id="pe-msg"></span>`);
  const mb = $("#modal-body");
  mb.querySelectorAll("[data-peq]").forEach((b) => b.onclick = () => { const [i, d] = b.dataset.peq.split("|").map(Number); e.items[i].qty = Math.max(0, e.items[i].qty + d); renderPedidoEdit(); });
  mb.querySelectorAll("[data-pedel]").forEach((b) => b.onclick = () => { e.items[+b.dataset.pedel].qty = 0; renderPedidoEdit(); });
  mb.querySelectorAll("[data-penq]").forEach((b) => b.onclick = () => { const [i, d] = b.dataset.penq.split("|").map(Number); e.nuevos[i].qty = Math.max(1, e.nuevos[i].qty + d); renderPedidoEdit(); });
  mb.querySelectorAll("[data-pendel]").forEach((b) => b.onclick = () => { e.nuevos.splice(+b.dataset.pendel, 1); renderPedidoEdit(); });
  const bu = $("#pe-buscar"); if (bu) bu.oninput = () => {
    const q = norm(bu.value).trim(), res = $("#pe-res");
    if (q.length < 2) { res.innerHTML = ""; return; }
    const terms = q.split(/\s+/);
    const list = DATA.catalogo.productos.filter((pp) => terms.every((t) => norm(pp.nombre + " " + pp.sku).includes(t))).slice(0, 6);
    res.innerHTML = list.map((pp) => `<div class="pe-res-it" data-peadd="${pp.id}">${esc(pp.nombre)} ${pp.sku ? `<small>#${esc(pp.sku)}</small>` : ""} <span class="meta">${pp.precio ? fmtAR(pp.precio) : ""}</span></div>`).join("") || '<div class="meta">Sin resultados</div>';
    res.querySelectorAll("[data-peadd]").forEach((el) => el.onclick = () => {
      const pp = DATA.catalogo.productos.find((x) => x.id === +el.dataset.peadd); if (!pp) return;
      if (pp.tipo === "variable" && (pp.variaciones || []).length) {
        const opts = pp.variaciones.map((v, i) => `${i + 1}) ${v.label} ${fmtAR(v.precio)}`).join("\n");
        const sel = prompt(`Elegí la medida de ${pp.nombre}:\n${opts}\n\nEscribí el número:`);
        const vv = pp.variaciones[Number(sel) - 1]; if (!vv) return;
        e.nuevos.push({ product_id: pp.id, variation_id: vv.id, nombre: pp.nombre + " — " + vv.label, precio: vv.precio || 0, qty: 1 });
      } else { e.nuevos.push({ product_id: pp.id, nombre: pp.nombre, precio: pp.precio || 0, qty: 1 }); }
      bu.value = ""; res.innerHTML = ""; renderPedidoEdit();
    });
  };
  const ev = $("#pe-envio"); if (ev) ev.oninput = () => { e.envio = Number(ev.value) || 0; $(".pe-total b").textContent = fmtAR(e.items.reduce((s, i) => s + (i.precio_unit || 0) * i.qty, 0) + e.nuevos.reduce((s, n) => s + (n.precio || 0) * n.qty, 0) + (Number(e.envio) || 0)); };
  $("#pe-guardar").onclick = guardarPedidoEdit;
  $("#pe-cancelar").onclick = () => openPedido(e.id);
}
async function guardarPedidoEdit() {
  const e = PEDED, btn = $("#pe-guardar"); btn.disabled = true; $("#pe-msg").textContent = "Guardando…";
  const items = e.items.map((it) => ({ line_item_id: it.line_item_id, quantity: it.qty }));
  const nuevos = e.nuevos.map((n) => ({ product_id: n.product_id, variation_id: n.variation_id, quantity: n.qty }));
  const body = { id: e.id, items, nuevos };
  if (Number(e.envio) !== Number(e.envioOrig)) body.envio = Number(e.envio) || 0; // solo si cambió el envío
  const tf = $("#pe-totalfinal"); if (tf && tf.value !== "" && Number(tf.value) >= 0) body.total_final = Math.round(Number(tf.value)); // dueño: fijar total exacto
  const r = await api("/api/admin/pedido/editar", body);
  if (r && r.ok) { toast("✅ Pedido actualizado"); openPedido(e.id); cargarPedidos(); }
  else { btn.disabled = false; $("#pe-msg").textContent = (r && r.error) || "No se pudo guardar"; }
}

// ---------- MERCADOLIBRE ----------
async function cargarML() {
  const cont = $("#ml-estado");
  cont.innerHTML = '<p class="meta">Cargando estado…</p>';
  try {
    const e = await (await fetch("/api/ml/estado")).json();
    if (!e.configurado) {
      cont.innerHTML = `<div class="ml-card"><h3>MercadoLibre — no configurado</h3>
        <p class="meta">Faltan credenciales. En Railway cargá <code>ML_CLIENT_ID</code>, <code>ML_CLIENT_SECRET</code> y <code>ML_REDIRECT</code> = <code>${esc(location.origin)}/api/ml/callback</code>. Después actualizá y conectá.</p></div>`;
    } else if (e.conectado) {
      cont.innerHTML = `<div class="ml-card ok"><h3>✓ Conectado a MercadoLibre</h3>
        <p class="meta">Cuenta: <strong>${esc(e.nickname || "")}</strong> (user ${e.user_id}) · markup precio <strong>×${e.markup}</strong> · publicados <strong>${e.publicados || 0}</strong></p>
        <p class="meta">${e.category_id ? "Categoría ML fija: " + esc(e.category_id) : "Categoría: se predice por título de cada producto."}</p>
        <div style="margin-top:14px;display:flex;gap:10px;flex-wrap:wrap">
          <button class="btn sm" id="ml-elegir">🧾 Elegir productos y precios</button>
          <button class="btn sm" id="ml-publicar">⬆️ Publicar seleccionados (tanda de 20)</button>
          <button class="btn ghost sm" id="ml-sync">🔄 Sincronizar stock y precio</button>
          <a class="btn ghost sm" href="/api/ml/conectar">Reconectar</a>
        </div>
        <div id="ml-result" class="meta" style="margin-top:14px"></div>
        <div id="ml-gestor" class="ml-gestor"></div></div>`;
      const bp = $("#ml-publicar"), bs = $("#ml-sync"), out = $("#ml-result");
      if (bp) bp.onclick = () => mlAccion("/api/ml/publicar", bp, out, "Publicando");
      if (bs) bs.onclick = () => mlAccion("/api/ml/sincronizar", bs, out, "Sincronizando");
      const be = $("#ml-elegir"); if (be) be.onclick = cargarGestor;
    } else {
      cont.innerHTML = `<div class="ml-card"><h3>MercadoLibre — listo para conectar</h3>
        <p class="meta">Redirect: <code>${esc(e.redirect)}</code> · markup ×${e.markup}</p>
        <a class="btn" href="/api/ml/conectar">Conectar MercadoLibre</a></div>`;
    }
  } catch { cont.innerHTML = '<p class="meta">No se pudo cargar el estado de MercadoLibre.</p>'; }
}
// ----- Gestor de productos para ML (elegir cuáles subir y a qué precio) -----
let ML_PRODS = [];
async function cargarGestor() {
  const box = $("#ml-gestor");
  box.innerHTML = '<p class="meta">Cargando productos…</p>';
  try {
    const d = await (await fetch("/api/ml/productos")).json();
    ML_PRODS = (d.productos || []).map((p) => ({ ...p, _precio: p.precio || p.precio_auto }));
    box.innerHTML = `<div class="mlg-bar">
        <input id="mlg-q" type="search" placeholder="Buscar producto…" autocomplete="off">
        <button class="btn ghost sm" id="mlg-all">Marcar todos</button>
        <button class="btn ghost sm" id="mlg-none">Ninguno</button>
        <button class="btn sm" id="mlg-save">💾 Guardar selección</button>
        <span class="meta" id="mlg-meta"></span>
      </div>
      <div id="mlg-list" class="mlg-list"></div>`;
    $("#mlg-q").oninput = () => renderGestor($("#mlg-q").value);
    $("#mlg-all").onclick = () => { ML_PRODS.forEach((p) => p.subir = true); renderGestor($("#mlg-q").value); };
    $("#mlg-none").onclick = () => { ML_PRODS.forEach((p) => p.subir = false); renderGestor($("#mlg-q").value); };
    $("#mlg-save").onclick = guardarGestor;
    renderGestor("");
  } catch (e) { box.innerHTML = `<p class="meta">No se pudieron cargar los productos. (${esc(String(e && e.message || e))})</p>`; }
}
function renderGestor(q) {
  q = (q || "").toLowerCase().trim();
  const lista = ML_PRODS.filter((p) => !q || (p.nombre || "").toLowerCase().includes(q));
  const marcados = ML_PRODS.filter((p) => p.subir).length;
  $("#mlg-meta").textContent = `${marcados} marcados de ${ML_PRODS.length}`;
  $("#mlg-list").innerHTML = lista.slice(0, 400).map((p) => {
    const i = ML_PRODS.indexOf(p);
    const fijo = p.precio && p.precio !== p.precio_auto;
    const sinMarca = !(p.marca && p.marca.trim());
    return `<div class="mlg-row ${p.subir ? "on" : ""}">
      <label class="mlg-chk"><input type="checkbox" data-mlsub="${i}" ${p.subir ? "checked" : ""}></label>
      <div class="mlg-name">${esc(p.nombre)} ${p.tipo === "variable" ? '<span class="mlg-tag var">variable</span>' : ""} ${p.publicado ? `<span class="mlg-tag pub">publicado</span> <button type="button" class="mlg-del" data-mldel="${p.id}">despublicar</button>` : ""}<small class="mlg-web">web ${fmtAR(p.precio_web)}</small></div>
      <input class="mlg-marca ${sinMarca ? "vacia" : ""}" data-mlmarca="${i}" value="${esc(p.marca || "")}" placeholder="Marca" title="Marca para MercadoLibre">
      <div class="mlg-ml"><span>$</span><input type="number" min="0" step="1" data-mlpre="${i}" value="${p._precio}" title="Precio en ML (auto +20% = ${fmtAR(p.precio_auto)})">${fijo ? '<small>fijo</small>' : '<small>+20%</small>'}</div>
    </div>`;
  }).join("") + (lista.length > 400 ? `<p class="meta">…y ${lista.length - 400} más, filtrá para verlos</p>` : "");
  $("#mlg-list").querySelectorAll("[data-mlsub]").forEach((c) => c.onchange = () => { ML_PRODS[+c.dataset.mlsub].subir = c.checked; renderGestor($("#mlg-q").value); });
  $("#mlg-list").querySelectorAll("[data-mlpre]").forEach((inp) => inp.onchange = () => { const p = ML_PRODS[+inp.dataset.mlpre]; p._precio = Number(inp.value) || p.precio_auto; });
  $("#mlg-list").querySelectorAll("[data-mlmarca]").forEach((inp) => inp.onchange = () => { ML_PRODS[+inp.dataset.mlmarca].marca = inp.value.trim(); inp.classList.toggle("vacia", !inp.value.trim()); });
  $("#mlg-list").querySelectorAll("[data-mldel]").forEach((b) => b.onclick = async () => {
    if (!confirm("¿Despublicar este producto de MercadoLibre?")) return;
    b.disabled = true; b.textContent = "…";
    try {
      const r = await (await fetch("/api/ml/borrar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: Number(b.dataset.mldel) }) })).json();
      if (r.ok) { toast("Despublicado de MercadoLibre"); cargarGestor(); } else { toast(r.error || "No se pudo"); b.disabled = false; b.textContent = "despublicar"; }
    } catch { toast("No se pudo despublicar"); b.disabled = false; b.textContent = "despublicar"; }
  });
}
async function guardarGestor() {
  const btn = $("#mlg-save"); btn.disabled = true; const pv = btn.textContent; btn.textContent = "Guardando…";
  const cambios = ML_PRODS.map((p) => ({ id: p.id, subir: !!p.subir, precio: (p._precio && p._precio !== p.precio_auto) ? p._precio : null, marca: p.marca || "" }));
  try {
    const r = await (await fetch("/api/ml/seleccion", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cambios }) })).json();
    if (r.ok) toast(`Guardado: ${r.marcados} productos para subir`);
    else toast(r.error || "No se pudo guardar");
  } catch { toast("No se pudo guardar"); }
  btn.disabled = false; btn.textContent = pv;
}

async function mlAccion(url, btn, out, label) {
  btn.disabled = true; const prev = btn.textContent; btn.textContent = label + "…";
  out.innerHTML = `${label}… esto puede tardar (respeta el límite de MercadoLibre).`;
  try {
    const r = await (await fetch(url, { method: "POST" })).json();
    if (r.error) { out.innerHTML = "⚠️ " + esc(r.error); }
    else if (r.publicados != null) {
      out.innerHTML = `✓ Publicados <b>${r.publicados}</b> · restantes ${r.restantes} · variables omitidos ${r.variables_omitidos}` +
        (r.errores && r.errores.length ? `<br>Errores (${r.errores.length}): ` + r.errores.slice(0, 5).map((e) => esc(e.nombre + ": " + e.error)).join("; ") : "");
    } else if (r.actualizados != null) {
      out.innerHTML = `✓ Actualizados <b>${r.actualizados}</b> · pausados sin stock ${r.pausados}` + (r.errores && r.errores.length ? ` · errores ${r.errores.length}` : "");
    } else out.innerHTML = "Listo.";
  } catch { out.innerHTML = "No se pudo completar la acción."; }
  btn.disabled = false; btn.textContent = prev; cargarML();
}

// ---------- CLIENTES ----------
let CLIENTES = [];
async function cargarClientes() {
  const cont = $("#cli-lista");
  cont.innerHTML = '<p class="meta">Cargando…</p>';
  try {
    const d = await (await fetch("/api/admin/usuarios")).json();
    CLIENTES = d.usuarios || [];
    renderClientes();
  } catch { cont.innerHTML = '<p class="meta">No se pudieron cargar los clientes.</p>'; }
}
function renderClientes() {
  const q = ($("#cli-q").value || "").toLowerCase().trim();
  const verSpam = $("#cli-spam").checked;
  let lista = CLIENTES.filter((u) => verSpam ? true : !u.spam);
  if (q) lista = lista.filter((u) => (u.email || "").toLowerCase().includes(q) || (u.nombre || "").toLowerCase().includes(q));
  const reales = CLIENTES.filter((u) => !u.spam).length;
  $("#cli-meta").textContent = `${reales} reales · ${CLIENTES.length - reales} spam · ${CLIENTES.length} total`;
  cont_render(lista);
}
// Condiciones frente al IVA del receptor (IDs de AFIP/ARCA para el comprobante)
const COND_IVA = [[5, "Consumidor Final"], [1, "Responsable Inscripto"], [6, "Monotributo"], [4, "Exento"], [13, "Monotributo Social"], [16, "Monotributo Promovido"], [7, "No Categorizado"]];
const condIvaTxt = (id) => { const c = COND_IVA.find((x) => x[0] === Number(id)); return c ? c[1] : ""; };
function editarCliente(email) {
  const u = CLIENTES.find((x) => (x.email || "").toLowerCase() === (email || "").toLowerCase()); if (!u) return;
  const e = u.entrega || {};
  openModal(`Editar ${u.nombre || u.email}`, `<div class="cli-edit-form">
    <label>Nombre <input id="ce-nombre" value="${esc(u.nombre || "")}"></label>
    <label>Email <input value="${esc(u.email)}" disabled title="El email es la cuenta, no se cambia"></label>
    <label>Teléfono / WhatsApp <input id="ce-tel" value="${esc(u.telefono || "")}" inputmode="tel"></label>
    <label>CUIT / DNI <input id="ce-doc" value="${esc(u.doc || "")}" inputmode="numeric"></label>
    <label>Condición frente al IVA <select id="ce-cond"><option value="">— sin definir —</option>${COND_IVA.map(([v, t]) => `<option value="${v}" ${u.cond_iva == v ? "selected" : ""}>${t}</option>`).join("")}</select></label>
    <label>Dirección (calle y número) <input id="ce-calle" value="${esc(e.calle || "")}"></label>
    <div class="nc-row"><input id="ce-ciudad" placeholder="Localidad" value="${esc(e.ciudad || "")}"><input id="ce-prov" placeholder="Provincia" value="${esc(e.provincia || "")}"><input id="ce-cp" placeholder="CP" value="${esc(e.cp || "")}"></div>
    <button class="btn" id="ce-guardar">Guardar cambios</button></div>`);
  $("#ce-guardar").onclick = async () => {
    const r = await api("/api/admin/cliente-editar", { email: u.email, nombre: $("#ce-nombre").value.trim(), telefono: $("#ce-tel").value.trim(), doc: $("#ce-doc").value, cond_iva: $("#ce-cond").value || null, entrega: { calle: $("#ce-calle").value.trim(), ciudad: $("#ce-ciudad").value.trim(), provincia: $("#ce-prov").value.trim(), cp: $("#ce-cp").value.trim() } });
    if (r && r.ok) { toast("✅ Datos actualizados"); closeModal(); cargarClientes(); } else toast((r && r.error) || "No se pudo");
  };
}
function cont_render(lista) {
  const cont = $("#cli-lista");
  if (!lista.length) { cont.innerHTML = '<p class="meta">Sin resultados.</p>'; return; }
  cont.innerHTML = lista.slice(0, 600).map((u) => {
    const tags = [];
    if (u.rol && u.rol !== "cliente") tags.push(`<span class="cli-tag rol">${esc(u.rol)}</span>`);
    if (u.wp_pass) tags.push('<span class="cli-tag wp">clave WP</span>');
    if (u.clave) tags.push('<span class="cli-tag wp">clave propia</span>');
    if (u.wc_id) tags.push(`<span class="cli-tag woo">WC ${u.wc_id}</span>`);
    if (u.spam) tags.push('<span class="cli-tag spam">spam</span>');
    const e = u.entrega;
    const contacto = [u.telefono ? "📞 " + esc(u.telefono) : "", e && e.calle ? "📍 " + esc([e.calle, e.ciudad, e.provincia, e.cp].filter(Boolean).join(", ")) : ""].filter(Boolean).join(" · ");
    return `<div class="cli-row"><div><strong>${esc(u.nombre || "—")}</strong><div class="meta">${esc(u.email)}</div>${contacto ? `<div class="meta cli-contacto">${contacto}</div>` : ""}<div class="cli-doc">🧾 CUIT/DNI: <input data-doc="${esc(u.email)}" value="${esc(u.doc || "")}" placeholder="—" inputmode="numeric"></div></div><div class="cli-tags">${tags.join("")}${u.telefono ? waBtn(u.telefono, waMsgReactivacion(u.nombre), "📱 Reactivar") : ""}<button class="cli-edit-btn" data-editcli="${esc(u.email)}">✎ Editar</button>${ROL_ADMIN === "dueno" && u.rol !== "dueno" ? `<button class="cli-rol-btn ${u.rol === "empleado" ? "on" : ""}" data-rol="${esc(u.email)}" data-es="${u.rol === "empleado" ? "1" : "0"}">${u.rol === "empleado" ? "✓ Empleado" : "Hacer empleado"}</button>` : ""}</div></div>`;
  }).join("") + (lista.length > 600 ? `<p class="meta">…y ${lista.length - 600} más (filtrá para ver el resto)</p>` : "");
  cont.querySelectorAll("[data-editcli]").forEach((b) => b.onclick = () => editarCliente(b.dataset.editcli));
  cont.querySelectorAll("[data-doc]").forEach((inp) => inp.onchange = async () => {
    try { const r = await (await fetch("/api/admin/cliente-doc", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: inp.dataset.doc, doc: inp.value }) })).json(); toast(r.ok ? "CUIT/DNI guardado" : (r.error || "No se pudo")); } catch { toast("No se pudo guardar"); }
  });
  cont.querySelectorAll("[data-rol]").forEach((b) => b.onclick = async () => {
    const nuevo = b.dataset.es === "1" ? "cliente" : "empleado";
    if (!confirm(nuevo === "empleado" ? `¿Hacer empleado a ${b.dataset.rol}? Va a tener acceso al panel (stock, ventas, cobros) menos los resultados/finanzas.` : `¿Quitar el rol de empleado a ${b.dataset.rol}?`)) return;
    const r = await api("/api/admin/cliente-rol", { email: b.dataset.rol, rol: nuevo });
    if (r && r.ok) { toast(nuevo === "empleado" ? "✅ Ahora es empleado" : "Volvió a cliente"); cargarClientes(); } else toast((r && r.error) || "No se pudo");
  });
}
async function importar(url, btn, label) {
  btn.disabled = true; const prev = btn.textContent; btn.textContent = "Importando…";
  try {
    const r = await (await fetch(url, { method: "POST" })).json();
    if (r.ok) { toast(`${label}: +${r.nuevos || 0} nuevos${r.claves != null ? ", +" + r.claves + " claves" : ""}${r.con_telefono != null ? ` · ${r.con_telefono} con tel, ${r.con_direccion} con domicilio` : ""} (total ${r.total || r.en_sistema})`); await cargarClientes(); }
    else toast(r.error || "No se pudo importar");
  } catch { toast("No se pudo importar"); }
  btn.disabled = false; btn.textContent = prev;
}
{
  const impWp = $("#cli-imp-wp"); if (impWp) impWp.onclick = () => importar("/api/admin/importar-wp", impWp, "WordPress");
  const impWoo = $("#cli-imp-woo"); if (impWoo) impWoo.onclick = () => importar("/api/admin/importar-clientes", impWoo, "WooCommerce");
  const cliQ = $("#cli-q"); if (cliQ) cliQ.oninput = renderClientes;
  const cliSpam = $("#cli-spam"); if (cliSpam) cliSpam.onchange = renderClientes;
}

// ----- Estadísticas (dashboard) -----
let STATS_CHART = null;
async function cargarEstadisticas() {
  const mes = $("#stats-mes").value;
  if (!mes) return;
  $("#stats-meta").textContent = "Cargando…";
  try {
    const r = await fetch("/api/admin/estadisticas?mes=" + mes);
    if (r.status === 401) { $("#stats-meta").textContent = "Sesión vencida — volvé a iniciar sesión."; return; }
    const d = await r.json();
    if (d.error) { $("#stats-meta").textContent = d.error; return; }
    $("#stats-meta").textContent = "";
    $("#stats-cards").innerHTML =
      `<div class="stats-card"><div class="sc-num">${d.total_pedidos}</div><div class="sc-lbl">Pedidos del mes</div></div>` +
      `<div class="stats-card brand"><div class="sc-num">${fmtAR(d.total_facturado)}</div><div class="sc-lbl">Facturado</div></div>` +
      `<div class="stats-card"><div class="sc-num">${fmtAR(d.ticket)}</div><div class="sc-lbl">Ticket promedio</div></div>`;
    const labels = d.datos.map((x) => x.dia);
    if (STATS_CHART) STATS_CHART.destroy();
    STATS_CHART = new Chart($("#stats-canvas"), {
      data: { labels, datasets: [
        { type: "bar", label: "Pedidos", data: d.datos.map((x) => x.pedidos), yAxisID: "y", backgroundColor: "rgba(222,54,103,.78)", borderRadius: 4, order: 2 },
        { type: "line", label: "Facturado ($)", data: d.datos.map((x) => x.facturado), yAxisID: "y1", borderColor: "#7a1040", backgroundColor: "#7a1040", tension: .3, pointRadius: 2, borderWidth: 2, order: 1 },
      ] },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false },
        scales: {
          y: { position: "left", beginAtZero: true, title: { display: true, text: "Pedidos" }, ticks: { precision: 0 } },
          y1: { position: "right", beginAtZero: true, title: { display: true, text: "Facturado" }, grid: { drawOnChartArea: false }, ticks: { callback: (v) => "$" + Number(v).toLocaleString("es-AR") } },
          x: { title: { display: true, text: "Día del mes" } },
        },
        plugins: { legend: { position: "top" }, tooltip: { callbacks: { label: (c) => c.dataset.yAxisID === "y1" ? "Facturado: " + fmtAR(c.parsed.y) : "Pedidos: " + c.parsed.y } } },
      },
    });
  } catch { $("#stats-meta").textContent = "No se pudieron cargar las estadísticas."; }
}
{
  const mesInput = $("#stats-mes");
  if (mesInput) {
    const now = new Date();
    mesInput.value = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
    mesInput.onchange = cargarEstadisticas;
    const rel = $("#stats-reload"); if (rel) rel.onclick = cargarEstadisticas;
    cargarEstadisticas();
  }
}

// ----- Finanzas / Caja -----
let FIN_DATA = null, FIN_SEC = "caja", FIN_EDIT = null, FIN_CHEQUE_SORT = "vencimiento", FIN_CHEQUE_VERPAG = false;
let FIN_CHEQUE_FILT = { tercero: "", estado: "", desde: "", hasta: "" };
const FIN_DEF = {
  caja: { t: "Caja", i: "💰" },
  cheques: { t: "Cheques", i: "🏦", campos: [
    { k: "tipo", t: "select", op: ["recibido", "emitido"], lbl: "Tipo" },
    { k: "tercero", t: "text", lbl: "Cliente / Proveedor" },
    { k: "banco", t: "text", lbl: "Banco" },
    { k: "numero", t: "text", lbl: "N°" },
    { k: "monto", t: "num", lbl: "Monto $" },
    { k: "fecha_emision", t: "date", lbl: "Fecha de emisión" },
    { k: "vencimiento", t: "date", lbl: "Fecha de cobro" },
    { k: "estado", t: "select", op: ["activo", "en cartera", "depositado", "cubierto", "cobrado", "pagado", "rechazado"], lbl: "Estado" },
  ], cols: ["tipo", "tercero", "numero", "monto", "con_imp", "fecha_emision", "vencimiento", "estado"] },
  acreditaciones: { t: "Acreditaciones", i: "⏳", campos: [
    { k: "plataforma", t: "platform", lbl: "Plataforma" },
    { k: "fecha_venta", t: "date", lbl: "Fecha venta" },
    { k: "bruto", t: "num", lbl: "Bruto $" },
    { k: "cargo_pct", t: "num", lbl: "Cargo %" },
    { k: "fecha_acreditacion", t: "date", lbl: "Se acredita" },
    { k: "estado", t: "select", op: ["pendiente", "acreditado"], lbl: "Estado" },
  ], cols: ["plataforma", "fecha_venta", "bruto", "cargo_pct", "neto", "fecha_acreditacion", "estado"] },
  gastos: { t: "Gastos", i: "🧾", campos: [
    { k: "fecha", t: "date", lbl: "Fecha" },
    { k: "categoria", t: "select", op: ["Envío", "Cadete", "Bolsas/Packaging", "Insumos", "Servicios (luz/agua/internet)", "Alquiler", "Sueldos", "Impuestos", "Mantenimiento", "Marketing", "Otro"], lbl: "Categoría" },
    { k: "concepto", t: "text", lbl: "Concepto" },
    { k: "monto", t: "num", lbl: "Monto $" },
    { k: "medio", t: "select", op: ["efectivo", "banco", "cheque"], lbl: "Pagado con" },
  ], cols: ["fecha", "categoria", "concepto", "monto", "medio"] },
  compras: { t: "Compras", i: "📦", campos: [
    { k: "fecha", t: "date", lbl: "Fecha" },
    { k: "proveedor", t: "text", lbl: "Proveedor" },
    { k: "concepto", t: "text", lbl: "Concepto" },
    { k: "monto", t: "num", lbl: "Monto $" },
    { k: "pago", t: "select", op: ["cheque", "transferencia", "efectivo"], lbl: "Pago" },
    { k: "estado", t: "select", op: ["pendiente", "pagada"], lbl: "Estado" },
    { k: "sin_caja", t: "check", lbl: "Ya pagada antes (no impacta caja)" },
  ], cols: ["fecha", "proveedor", "concepto", "monto", "pago", "estado", "sin_caja"] },
  envios: { t: "Seguimiento", i: "📍" },
  ctacte: { t: "Ctas. corrientes", i: "👤" },
  proveedores: { t: "Proveedores", i: "🚚" },
  facturacion: { t: "Facturación", i: "🧾" },
  costos: { t: "Costos", i: "📈" },
  mercadolibre: { t: "Precios ML", i: "🛒" },
  test: { t: "Test del sistema", i: "🧪" },
  equilibrio: { t: "Punto de equilibrio", i: "📐" },
  informes: { t: "Informes", i: "📑" },
  banco: { t: "Banco", i: "🏦" },
  config: { t: "Config", i: "⚙️" },
};
const FIN_MONEY = new Set(["monto", "bruto", "neto"]);

async function cargarFinanzas() {
  try {
    const d = await (await fetch("/api/admin/finanzas")).json();
    if (d.error) { $("#fin-app").innerHTML = `<p class="meta">${esc(d.error)}</p>`; return; }
    FIN_DATA = d; renderFinNav(); renderFin();
  } catch { $("#fin-app").innerHTML = '<p class="meta">No se pudieron cargar las finanzas.</p>'; }
}
const FIN_OCULTO_EMP = ["caja", "cheques", "acreditaciones", "compras", "costos", "mercadolibre", "test", "equilibrio", "informes", "banco", "config", "proveedores"];
function finOculto(k) { return ROL_ADMIN === "empleado" && FIN_OCULTO_EMP.includes(k); }
function renderFinNav() {
  if (finOculto(FIN_SEC)) FIN_SEC = "facturacion";
  $("#fin-nav").innerHTML = Object.entries(FIN_DEF).filter(([k]) => !finOculto(k)).map(([k, s]) => `<button class="fin-tab ${FIN_SEC === k ? "active" : ""}" data-fin="${k}">${s.i} ${s.t}</button>`).join("");
  $("#fin-nav").querySelectorAll("[data-fin]").forEach((b) => b.onclick = () => { FIN_SEC = b.dataset.fin; renderFinNav(); renderFin(); });
}
function renderFin() {
  if (FIN_SEC === "caja") return renderCaja();
  if (FIN_SEC === "config") return renderFinConfig();
  if (FIN_SEC === "costos") return renderFinCostos();
  if (FIN_SEC === "mercadolibre") return renderMercadoLibre();
  if (FIN_SEC === "test") return renderTest();
  if (FIN_SEC === "equilibrio") return renderEquilibrio();
  if (FIN_SEC === "banco") return renderBanco();
  if (FIN_SEC === "informes") return renderInformes();
  if (FIN_SEC === "envios") return renderEnvios();
  if (FIN_SEC === "ctacte") return renderCtaCte();
  if (FIN_SEC === "proveedores") return renderProveedores();
  if (FIN_SEC === "facturacion") return renderFacturacion();
  return renderFinLista(FIN_SEC);
}
// ---- Informes / analítica (ranking, recompra, top, Curva ABC) ----
let INF_MESES = 3;
async function renderInformes() {
  const cont = $("#fin-app");
  cont.innerHTML = `
    <div class="inf-bar">
      <label>Período <select id="inf-meses">
        <option value="3">Últimos 3 meses</option><option value="6">Últimos 6 meses</option><option value="12">Último año</option>
      </select></label>
      <button class="btn" id="inf-gen">📊 Generar informe</button>
      <button class="btn ghost sm" id="inf-print" style="display:none">🖨️ Imprimir</button>
      <span class="meta" id="inf-msg"></span>
    </div>
    <div id="inf-out"></div>`;
  $("#inf-meses").value = String(INF_MESES);
  $("#inf-gen").onclick = generarInforme;
  $("#inf-print").onclick = () => window.print();
}
async function generarInforme() {
  INF_MESES = Number($("#inf-meses").value) || 3;
  const msg = $("#inf-msg"), out = $("#inf-out");
  msg.textContent = "Generando… (puede tardar, trae todos los pedidos del período)"; out.innerHTML = "";
  let d; try { d = await (await fetch("/api/admin/informes?meses=" + INF_MESES)).json(); } catch { msg.textContent = "No se pudo generar"; return; }
  if (d.error) { msg.textContent = d.error; return; }
  msg.textContent = `${d.pedidos} pedidos · ${d.productos} productos analizados`;
  $("#inf-print").style.display = "";
  const tablaABC = (arr, campo, unidad) => `<table class="inf-t"><thead><tr><th>#</th><th>Producto</th><th class="r">${unidad}</th><th class="r">% acum.</th><th>Clase</th></tr></thead><tbody>${arr.slice(0, 60).map((p, i) => `<tr class="abc-${p.clase}"><td>${i + 1}</td><td>${esc(p.nombre)}</td><td class="r">${campo === "importe" ? fmtAR(p.importe) : p.unidades}</td><td class="r">${p.acum_pct}%</td><td><b>${p.clase}</b></td></tr>`).join("")}</tbody></table>`;
  out.innerHTML = `
    <h3 class="inf-h">🏆 Ranking de clientes (los que más gastaron)</h3>
    <table class="inf-t"><thead><tr><th>#</th><th>Cliente</th><th class="r">Gastó</th><th class="r">Pedidos</th><th>Recompró</th></tr></thead><tbody>
      ${d.rankingClientes.map((c, i) => `<tr><td>${i + 1}</td><td>${esc(c.nombre)}<div class="meta">${esc(c.email || "")}</div></td><td class="r"><b>${fmtAR(c.total)}</b></td><td class="r">${c.pedidos}</td><td class="meta">${(c.recompro || []).map((p) => esc(p.nombre) + " ×" + p.veces).join(", ") || "—"}</td></tr>`).join("")}
    </tbody></table>
    <p class="meta">💡 Para fidelizar: regalá los <b>productos a vencer</b> a estos clientes (de arriba hacia abajo).</p>

    <h3 class="inf-h">🔁 Productos recomprados (se consumen y reponen)</h3>
    <table class="inf-t"><thead><tr><th>Producto</th><th class="r">Veces</th><th class="r">Clientes</th><th class="r">Unidades</th></tr></thead><tbody>
      ${d.recompra.map((p) => `<tr><td>${esc(p.nombre)}${p.sku ? ` <span class="meta">#${esc(p.sku)}</span>` : ""}</td><td class="r">${p.veces}</td><td class="r">${p.clientes}</td><td class="r">${p.unidades}</td></tr>`).join("")}
    </tbody></table>

    <h3 class="inf-h">🦷 Más vendidos (uso odontológico, sin descartables)</h3>
    <table class="inf-t"><thead><tr><th>#</th><th>Producto</th><th class="r">Unidades</th><th class="r">Ingresos</th><th>Mejores clientes</th></tr></thead><tbody>
      ${d.topProductos.map((p, i) => `<tr><td>${i + 1}</td><td>${esc(p.nombre)}</td><td class="r"><b>${p.unidades}</b></td><td class="r">${fmtAR(p.importe)}</td><td class="meta">${(p.topClientes || []).map((c) => esc(c.nombre) + " (" + c.qty + ")").join(", ") || "—"}</td></tr>`).join("")}
    </tbody></table>

    <h3 class="inf-h">📊 Curva ABC — Análisis de Pareto</h3>
    <div class="inf-abc-wrap">
      <div><h4>Por ingresos ($)</h4><div class="inf-abc-res">A: ${d.resumenImporte.A} · B: ${d.resumenImporte.B} · C: ${d.resumenImporte.C}</div>${tablaABC(d.abcImporte, "importe", "Ingresos")}</div>
      <div><h4>Por cantidad (unidades)</h4><div class="inf-abc-res">A: ${d.resumenCantidad.A} · B: ${d.resumenCantidad.B} · C: ${d.resumenCantidad.C}</div>${tablaABC(d.abcCantidad, "unidades", "Unidades")}</div>
    </div>

    <h3 class="inf-h">🔀 Tabla de doble entrada (ABC ingresos × ABC cantidad)</h3>
    <p class="meta">Filas = clase por <b>ingresos</b> · Columnas = clase por <b>cantidad</b>. Cantidad de productos en cada cruce.</p>
    <table class="inf-t inf-cruce"><thead><tr><th></th><th>Cant. A</th><th>Cant. B</th><th>Cant. C</th></tr></thead><tbody>
      ${["A", "B", "C"].map((fi) => `<tr><th>Ingresos ${fi}</th>${["A", "B", "C"].map((co) => `<td class="r ${fi === "A" && co === "A" ? "cruce-aa" : ""}">${d.cruce[fi][co]}</td>`).join("")}</tr>`).join("")}
    </tbody></table>
    <p class="meta">🟢 <b>Ingresos A + Cantidad A</b> = lo más crítico (mucho dinero y mucho volumen). 🔴 Ingresos A / Cantidad C = caros que se venden poco (cuidar quiebres). 🟡 Ingresos C / Cantidad A = baratos de alta rotación.</p>

    <h3 class="inf-h">🎁 Productos a vencer (candidatos a regalar)</h3>
    ${d.porVencer && d.porVencer.length ? `<table class="inf-t"><thead><tr><th>Producto</th><th>Vence</th><th class="r">Días</th><th class="r">Cant.</th></tr></thead><tbody>${d.porVencer.map((v) => `<tr class="${v.dias < 0 ? "abc-A" : ""}"><td>${esc(v.nombre)}</td><td>${(v.fecha || "").split("-").reverse().join("/")}</td><td class="r">${v.dias < 0 ? "vencido" : v.dias}</td><td class="r">${v.cantidad || "—"}</td></tr>`).join("")}</tbody></table>` : '<p class="meta">No hay productos próximos a vencer cargados.</p>'}`;
}
// ---- Banco: leer extracto con IA → Gastos Bancarios (Costos Variables) ----
let BANCO_RES = null;
const BK_CAT = { impuesto_cheque: "Impuesto al cheque (Ley 25413)", iibb: "Retenciones IIBB", comisiones: "Comisiones", iva: "IVA / débito fiscal", otros: "Otros" };
function renderBanco() {
  $("#fin-app").innerHTML = `
    <div class="fin-form"><strong class="fin-form-tit">🏦 Extracto bancario → Gastos Bancarios</strong>
      <p class="meta">Subí el extracto (PDF) y la IA separa los gastos del banco (impuesto al cheque, IIBB, comisiones, IVA). El total se carga en Costos Variables → "Gastos Bancarios".</p>
      <label class="btn ghost sm" style="display:inline-block;cursor:pointer">📄 Subir extracto (PDF)<input type="file" id="bk-file" accept="application/pdf,image/*" hidden></label>
      <span class="meta" id="bk-msg"></span>
    </div>
    <div id="bk-result"></div>`;
  $("#bk-file").onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    if (f.size > 12 * 1024 * 1024) return toast("Archivo muy grande (máx 12MB)");
    $("#bk-msg").textContent = "Leyendo el extracto con IA… (unos segundos)";
    const data = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(f); });
    const r = await api("/api/admin/banco/analizar", { data });
    if (r && r.ok) { BANCO_RES = r; $("#bk-msg").textContent = ""; drawBanco(); } else $("#bk-msg").textContent = (r && r.error) || "No se pudo leer el extracto";
  };
}
function drawBanco() {
  const r = BANCO_RES, t = r.totales || {};
  const filas = (r.items || []).map((it) => `<tr><td>${esc(it.fecha || "")}</td><td>${esc(it.descripcion || "")}</td><td>${esc(BK_CAT[it.categoria] || it.categoria || "")}</td><td class="r">${fmtAR(it.importe)}</td></tr>`).join("");
  const mes = new Date().toISOString().slice(0, 7);
  $("#bk-result").innerHTML = `
    ${r.periodo ? `<p class="meta">Período: <b>${esc(r.periodo)}</b></p>` : ""}
    <div class="bk-tot">
      ${Object.keys(BK_CAT).map((k) => t[k] ? `<div><span>${BK_CAT[k]}</span><b>${fmtAR(t[k])}</b></div>` : "").join("")}
      <div class="big"><span>Total Gastos Bancarios</span><b>${fmtAR(t.total || 0)}</b></div>
    </div>
    <div class="bk-cargar"><label>Mes <input type="month" id="bk-mes" value="${mes}"></label><button class="btn" id="bk-cargar">➕ Cargar a Gastos Bancarios (Costos Variables)</button> <span class="meta" id="bk-cargar-msg"></span></div>
    <details class="bk-detalle"><summary>Ver detalle (${(r.items || []).length} cargos)</summary>
      <div class="fin-table"><table><thead><tr><th>Fecha</th><th>Descripción</th><th>Categoría</th><th class="r">Importe</th></tr></thead><tbody>${filas}</tbody></table></div></details>`;
  $("#bk-cargar").onclick = async () => {
    const m = $("#bk-mes").value.slice(0, 7); if (!m) return toast("Elegí el mes");
    const g = await (await fetch("/api/admin/equilibrio?mes=" + m)).json();
    const data = g.data || { cf: {}, cv: {}, ventas: 0 }; if (!data.cv) data.cv = {};
    data.cv["Gastos Bancarios"] = Math.round(t.total || 0);
    const rr = await api("/api/admin/equilibrio", { mes: m, cf: data.cf || {}, cv: data.cv, ventas: data.ventas || 0 });
    $("#bk-cargar-msg").textContent = (rr && rr.ok) ? `✅ Cargado ${fmtAR(t.total || 0)} a Gastos Bancarios (${m}) — lo ves en Punto de equilibrio` : ((rr && rr.error) || "No se pudo");
  };
}
// ---- Punto de equilibrio mensual: PE = CF / (1 - CV/V) ----
const PE_CF = ["Internet y Telefonía", "Luz (Base) EDET", "Agua (SAT)", "Impuesto Inmobiliario (CISI)", "Honorarios Contador", "Honorarios Asesora", "Software de Gestión/Facturación", "Mantenimiento Terminal de Pago", "Seguro Local y Mercadería", "Fondo Reparaciones Local", "AFIP (Monotributo Maxi)"];
const PE_CV = ["Costo Mercadería Vendida (CMV)", "Ingresos Brutos", "TEM", "Gastos Bancarios", "Cadetería y Envíos", "Uber", "Personal Eventual (por día)", "Vía Cargo", "Expreso Tokio", "Limpieza", "Librería", "Caramelos", "Bolsas", "Varios"];
let PE_MES = null, PE_CMV_COMPRAS = 0;
async function renderEquilibrio() {
  const cont = $("#fin-app"); cont.innerHTML = '<p class="meta">Cargando…</p>';
  if (!PE_MES) PE_MES = new Date().toISOString().slice(0, 7);
  let res; try { res = await (await fetch("/api/admin/equilibrio?mes=" + PE_MES)).json(); } catch { res = {}; }
  const data = res.data || { cf: {}, cv: {}, ventas: 0 };
  PE_CMV_COMPRAS = res.cmv_compras || 0;
  if (!data.cv) data.cv = {}; if (!data.cf) data.cf = {};
  if (data.cv[PE_CV[0]] == null && PE_CMV_COMPRAS) data.cv[PE_CV[0]] = PE_CMV_COMPRAS; // prefill CMV con compras del mes
  const cfRows = PE_CF.map((c, i) => `<div class="pe-row"><label>${esc(c)}</label><input class="pe-cf" data-i="${i}" inputmode="numeric" value="${data.cf[c] || ""}"></div>`).join("");
  const cvRows = PE_CV.map((c, i) => `<div class="pe-row"><label>${esc(c)}${i === 0 ? ` <button class="pe-lnk" id="pe-cmv" type="button">↓ compras ${fmtAR(PE_CMV_COMPRAS)}</button>` : ""}</label><input class="pe-cv" data-i="${i}" inputmode="numeric" value="${data.cv[c] || ""}"></div>`).join("");
  cont.innerHTML = `
    <div class="pe-head"><label>Mes <input type="month" id="pe-mes" value="${PE_MES}"></label><button class="btn" id="pe-guardar">💾 Guardar</button><span class="meta" id="pe-msg"></span></div>
    <p class="meta">Punto de equilibrio = <b>Costos Fijos ÷ (1 − Costos Variables/Ventas)</b>. Cargá los valores del mes y se calcula solo.</p>
    <div class="pe-grid">
      <div class="pe-col"><h3>🔒 Costos Fijos (CF)</h3>${cfRows}<div class="pe-sub">Total CF: <b id="pe-cf-tot">—</b></div></div>
      <div class="pe-col"><h3>📦 Costos Variables (CV)</h3>${cvRows}<div class="pe-sub">Total CV: <b id="pe-cv-tot">—</b></div></div>
    </div>
    <div class="pe-vent"><label>💵 Ventas totales del mes (V) <input id="pe-ventas" inputmode="numeric" value="${data.ventas || ""}"></label></div>
    <div class="pe-result" id="pe-result"></div>`;
  $("#pe-mes").onchange = () => { PE_MES = $("#pe-mes").value.slice(0, 7); renderEquilibrio(); };
  const cmv = $("#pe-cmv"); if (cmv) cmv.onclick = () => { const inp = cont.querySelector('.pe-cv[data-i="0"]'); if (inp) { inp.value = PE_CMV_COMPRAS; recomputePE(); } };
  cont.querySelectorAll(".pe-cf, .pe-cv, #pe-ventas").forEach((inp) => inp.oninput = recomputePE);
  $("#pe-guardar").onclick = guardarPE;
  recomputePE();
}
function recomputePE() {
  let CF = 0, CV = 0;
  document.querySelectorAll(".pe-cf").forEach((inp) => CF += Number(inp.value) || 0);
  document.querySelectorAll(".pe-cv").forEach((inp) => CV += Number(inp.value) || 0);
  const V = Number($("#pe-ventas").value) || 0;
  if ($("#pe-cf-tot")) $("#pe-cf-tot").textContent = fmtAR(CF);
  if ($("#pe-cv-tot")) $("#pe-cv-tot").textContent = fmtAR(CV);
  const ratio = V > 0 ? CV / V : 0, MC = 1 - ratio, PE = MC > 0 ? CF / MC : 0, gan = V * MC - CF;
  const r = $("#pe-result"); if (!r) return;
  if (!V) { r.innerHTML = '<p class="meta">Cargá las ventas del mes para calcular el punto de equilibrio.</p>'; return; }
  r.innerHTML = `<div class="pe-cards">
      <div class="pe-card"><span>% Costo variable (CV/V)</span><b>${(ratio * 100).toFixed(1)}%</b><small>de cada $100 que vendés, $${(ratio * 100).toFixed(0)} se van en reponer, comisiones, bolsa y cadete</small></div>
      <div class="pe-card"><span>Margen de contribución (1−CV/V)</span><b>${(MC * 100).toFixed(1)}%</b><small>queda limpio para cubrir los costos fijos</small></div>
      <div class="pe-card big ${V >= PE && MC > 0 ? "ok" : "bajo"}"><span>📐 Punto de equilibrio</span><b>${MC > 0 ? fmtAR(Math.round(PE)) : "—"}</b><small>ventas necesarias para no perder ni ganar</small></div>
    </div>
    <p class="pe-conclu">${MC <= 0 ? "⚠️ El margen de contribución es 0 o negativo: los costos variables se comen todas las ventas." :
      V >= PE ? `✅ Estás <b>${fmtAR(Math.round(V - PE))}</b> por encima del equilibrio. Resultado operativo estimado del mes: <b>${fmtAR(Math.round(gan))}</b>.` :
        `🔴 Te faltan <b>${fmtAR(Math.round(PE - V))}</b> en ventas para llegar al equilibrio. Resultado operativo estimado: <b>${fmtAR(Math.round(gan))}</b>.`}</p>`;
}
async function guardarPE() {
  const cf = {}, cv = {};
  document.querySelectorAll(".pe-cf").forEach((inp) => { const v = Number(inp.value) || 0; if (v) cf[PE_CF[+inp.dataset.i]] = v; });
  document.querySelectorAll(".pe-cv").forEach((inp) => { const v = Number(inp.value) || 0; if (v) cv[PE_CV[+inp.dataset.i]] = v; });
  const ventas = Number($("#pe-ventas").value) || 0;
  const r = await api("/api/admin/equilibrio", { mes: PE_MES, cf, cv, ventas });
  if ($("#pe-msg")) $("#pe-msg").textContent = (r && r.ok) ? "✅ Guardado" : ((r && r.error) || "No se pudo");
}
function formaTxt(f) { return f === "neto" ? "Precio neto (le sumo IVA)" : f === "publico_descuento" ? "Público s/IVA con descuento (le sumo IVA)" : "Precio con IVA incluido"; }
// Alta rápida de proveedor (desde Recibir o donde haga falta). onCreado recibe el registro nuevo.
function altaProveedorRapido(nombre, onCreado) {
  openModal("➕ Nuevo proveedor", `<div class="prov-form" style="grid-template-columns:1fr">
    <input id="ap-nombre" placeholder="Proveedor / empresa *" value="${esc(nombre || "")}">
    <input id="ap-vendedor" placeholder="Nombre del vendedor">
    <input id="ap-cel" placeholder="Celular del vendedor" inputmode="tel">
    <input id="ap-cuit" placeholder="CUIT (para cheques)" inputmode="numeric">
    <select id="ap-forma"><option value="con_iva">Precio CON IVA incluido</option><option value="neto">Precio NETO (sin IVA)</option><option value="publico_descuento">Precio público s/IVA con descuento</option></select>
    <select id="ap-iva"><option value="21">IVA 21%</option><option value="10.5">IVA 10,5%</option></select>
    <input id="ap-desc" placeholder="Descuento % (si aplica)" inputmode="numeric">
    <button class="btn" id="ap-ok">Crear proveedor</button></div>`);
  $("#ap-ok").onclick = async () => {
    const nom = $("#ap-nombre").value.trim(); if (!nom) return toast("Poné el nombre del proveedor");
    const r = await api("/api/admin/finanzas/agregar", { coleccion: "proveedores", registro: { nombre: nom, vendedor: $("#ap-vendedor").value.trim(), celular: $("#ap-cel").value.trim(), cuit: $("#ap-cuit").value.replace(/\D/g, ""), forma: $("#ap-forma").value, iva: Number($("#ap-iva").value), descuento: Number($("#ap-desc").value) || 0 } });
    if (r && r.ok) { toast("✅ Proveedor dado de alta"); closeModal(); onCreado && onCreado(r.registro); } else toast((r && r.error) || "No se pudo");
  };
}
let PROV_EDIT = null;
function renderProveedores() {
  const list = FIN_DATA.proveedores || [];
  $("#fin-app").innerHTML = `
    <p class="meta">Cargá tus proveedores: datos del vendedor, CUIT (para los cheques) y cómo te mandan los precios (así al recibir mercadería se calcula el costo solo).</p>
    <div class="prov-form">
      <input id="pv-nombre" placeholder="Proveedor / empresa *">
      <input id="pv-vendedor" placeholder="Nombre del vendedor">
      <input id="pv-cel" placeholder="Celular del vendedor" inputmode="tel">
      <input id="pv-cuit" placeholder="CUIT (para cheques)" inputmode="numeric">
      <select id="pv-forma"><option value="con_iva">Precio CON IVA incluido</option><option value="neto">Precio NETO (sin IVA)</option><option value="publico_descuento">Precio público s/IVA con descuento</option></select>
      <select id="pv-iva"><option value="21">IVA 21%</option><option value="10.5">IVA 10,5%</option></select>
      <input id="pv-desc" placeholder="Descuento % (si aplica)" inputmode="numeric">
      <button class="btn" id="pv-add">＋ Agregar proveedor</button>
    </div>
    <div class="prov-list">${list.map((p) => p.id === PROV_EDIT ? `<div class="prov-card prov-editing">
        <input class="pe-f" data-pf="nombre" value="${esc(p.nombre)}" placeholder="Proveedor">
        <input class="pe-f" data-pf="vendedor" value="${esc(p.vendedor || "")}" placeholder="Vendedor">
        <input class="pe-f" data-pf="celular" value="${esc(p.celular || "")}" placeholder="Celular" inputmode="tel">
        <input class="pe-f" data-pf="cuit" value="${esc(p.cuit || "")}" placeholder="CUIT" inputmode="numeric">
        <select class="pe-f" data-pf="forma"><option value="con_iva" ${p.forma === "con_iva" ? "selected" : ""}>Precio CON IVA incluido</option><option value="neto" ${p.forma === "neto" ? "selected" : ""}>Precio NETO (sin IVA)</option><option value="publico_descuento" ${p.forma === "publico_descuento" ? "selected" : ""}>Público s/IVA con descuento</option></select>
        <select class="pe-f" data-pf="iva"><option value="21" ${(p.iva || 21) == 21 ? "selected" : ""}>IVA 21%</option><option value="10.5" ${p.iva == 10.5 ? "selected" : ""}>IVA 10,5%</option></select>
        <input class="pe-f" data-pf="descuento" value="${p.descuento || 0}" placeholder="Descuento %" inputmode="numeric" style="width:90px">
        <button class="btn sm" data-pvsave="${p.id}">💾 Guardar</button><button class="btn ghost sm" data-pvcancel="1">Cancelar</button>
      </div>` : `<div class="prov-card">
        <div><strong>${esc(p.nombre)}</strong> ${p.cuit ? `<span class="meta">CUIT ${esc(p.cuit)}</span>` : ""}
          <div class="meta">${p.vendedor ? "👤 " + esc(p.vendedor) : ""}${p.celular ? " · 📱 " + esc(p.celular) : ""}</div>
          <div class="meta">${formaTxt(p.forma)} · IVA ${p.iva || 21}%${p.descuento ? " · desc " + p.descuento + "%" : ""}</div></div>
        <div class="prov-acc">${p.celular ? `<a class="btn wa-btn sm" target="_blank" rel="noopener" href="${waLink(p.celular, "Hola " + (p.vendedor || "") + "! Te escribo de El Pasaje Dental.")}">📱</a>` : ""}<button class="btn ghost sm" data-pvedit="${p.id}" title="Editar">✎</button><button class="btn ghost sm" data-pvdel="${p.id}">✕</button></div>
      </div>`).join("") || '<p class="meta">Sin proveedores cargados todavía.</p>'}</div>`;
  $("#pv-add").onclick = async () => {
    const nombre = $("#pv-nombre").value.trim(); if (!nombre) return toast("Poné el nombre del proveedor");
    const r = await api("/api/admin/finanzas/agregar", { coleccion: "proveedores", registro: { nombre, vendedor: $("#pv-vendedor").value.trim(), celular: $("#pv-cel").value.trim(), cuit: $("#pv-cuit").value.replace(/\D/g, ""), forma: $("#pv-forma").value, iva: Number($("#pv-iva").value), descuento: Number($("#pv-desc").value) || 0 } });
    if (r.ok) { toast("✅ Proveedor agregado"); cargarFinanzas(); } else toast(r.error || "No se pudo");
  };
  $("#fin-app").querySelectorAll("[data-pvdel]").forEach((b) => b.onclick = async () => { if (!confirm("¿Borrar este proveedor?")) return; await api("/api/admin/finanzas/borrar", { coleccion: "proveedores", id: b.dataset.pvdel }); cargarFinanzas(); });
  $("#fin-app").querySelectorAll("[data-pvedit]").forEach((b) => b.onclick = () => { PROV_EDIT = b.dataset.pvedit; renderProveedores(); });
  $("#fin-app").querySelectorAll("[data-pvcancel]").forEach((b) => b.onclick = () => { PROV_EDIT = null; renderProveedores(); });
  $("#fin-app").querySelectorAll("[data-pvsave]").forEach((b) => b.onclick = async () => {
    const card = b.closest(".prov-card"), cambios = {};
    card.querySelectorAll(".pe-f").forEach((el) => { const k = el.dataset.pf; let v = el.value; if (k === "iva" || k === "descuento") v = Number(v) || 0; else if (k === "cuit") v = v.replace(/\D/g, ""); else v = v.trim(); cambios[k] = v; });
    if (!cambios.nombre) return toast("Poné el nombre");
    const r = await api("/api/admin/finanzas/actualizar", { coleccion: "proveedores", id: b.dataset.pvsave, cambios });
    PROV_EDIT = null;
    if (r && r.ok) { toast("✅ Proveedor actualizado"); cargarFinanzas(); } else { toast((r && r.error) || "No se pudo"); renderProveedores(); }
  });
}
let FACT_EMISORES = [], FACT_LIST = [], FACT_PREFILL = null;
async function renderFacturacion() {
  $("#fin-app").innerHTML = '<p class="meta">Cargando facturación…</p>';
  try {
    FACT_EMISORES = ((await (await fetch("/api/admin/afip/emisores")).json()).emisores) || [];
    FACT_LIST = ((await (await fetch("/api/admin/facturas")).json()).facturas) || [];
    drawFacturacion();
  } catch { $("#fin-app").innerHTML = '<p class="meta">No se pudo cargar.</p>'; }
}
function compNombre(f) { return `C ${String(f.pv).padStart(4, "0")}-${String(f.numero).padStart(8, "0")}`; }
function fechaAfip(s) { return (s || "").replace(/(\d{4})(\d{2})(\d{2})/, "$3/$2/$1"); }
function drawFacturacion() {
  const emiOpts = FACT_EMISORES.map((e, i) => `<option value="${i}">${esc(e.razon)} · CUIT ${e.cuit} (PV ${e.punto_venta})</option>`).join("");
  const mesAfip = new Date().toISOString().slice(0, 7).replace("-", "");
  const delMes = FACT_LIST.filter((f) => (f.fecha || "").slice(0, 6) === mesAfip);
  const totalMes = delMes.reduce((s, f) => s + (f.importe || 0), 0);
  let h = `<div class="fin-form"><strong class="fin-form-tit">Emitir Factura C</strong>
    <label>Emisor<select id="fa-emisor">${emiOpts || "<option>Sin emisores</option>"}</select></label>
    <button class="btn ghost sm" type="button" id="fa-puntos">🔍 Ver puntos de venta autorizados (AFIP)</button>
    <div id="fa-puntos-res" class="meta"></div>
    <label>N° pedido (opcional)<input id="fa-ped" placeholder="traer importe" inputmode="numeric"></label>
    <button class="btn ghost sm" type="button" id="fa-traer">↓ Traer pedido</button>
    <label>Cliente (opcional)<input id="fa-cli"></label>
    <label>CUIT/DNI cliente (opcional)<input id="fa-doc" inputmode="numeric" placeholder="consumidor final si vacío"></label>
    <button class="btn ghost sm" type="button" id="fa-padron">🔍 Traer nombre oficial de AFIP (por CUIT)</button>
    <label>Condición IVA del cliente<select id="fa-cond">${COND_IVA.map(([v, t]) => `<option value="${v}">${t}</option>`).join("")}</select></label>
    <label>Importe total $<input id="fa-imp" type="number" step="0.01"></label>
    <button class="btn" id="fa-emitir">🧾 Emitir factura</button>
  </div>
  <div id="fa-result" class="meta"></div>
  <p class="meta">Facturado este mes: <b>${fmtAR(totalMes)}</b> · ${delMes.length} comprobante(s)</p>
  <div class="fin-table"><table><thead><tr><th>Fecha</th><th>Comprobante</th><th>Cliente</th><th>Importe</th><th>CAE</th><th>Pedido</th><th></th></tr></thead><tbody>`;
  for (const f of FACT_LIST.slice(0, 300)) h += `<tr><td>${fechaAfip(f.fecha)}</td><td>${compNombre(f)}</td><td>${esc(f.cliente || "-")}</td><td>${fmtAR(f.importe)}</td><td>${esc(f.cae || "")}</td><td>${f.pedido ? esc(String(f.pedido)) : `<button class="btn ghost sm" data-vincf="${esc(f.id || "")}" data-vincn="${esc(String(f.numero || ""))}">🔗 Vincular</button>`}</td><td><a class="btn ghost sm" href="/factura/${f.id}" target="_blank">🖨️</a></td></tr>`;
  h += `</tbody></table>${FACT_LIST.length ? "" : '<p class="meta" style="padding:12px">Todavía no emitiste facturas.</p>'}</div>`;
  $("#fin-app").innerHTML = h;
  $("#fa-traer").onclick = async () => { const n = $("#fa-ped").value.trim(); if (!n) return toast("Poné el N° de pedido"); const r = await (await fetch("/api/admin/ctacte/pedido?n=" + n)).json(); if (r.ok) { $("#fa-cli").value = r.cliente; $("#fa-imp").value = r.total; if (r.doc) $("#fa-doc").value = r.doc; if (r.cond_iva) $("#fa-cond").value = r.cond_iva; toast("Pedido #" + r.pedido + " traído"); } else toast(r.error || "No se encontró"); };
  $("#fa-emitir").onclick = emitirFactura;
  const fpb = $("#fa-padron"); if (fpb) fpb.onclick = async () => {
    const doc = ($("#fa-doc").value || "").replace(/\D/g, "");
    if (doc.length !== 11) return toast("Para traer el nombre necesito el CUIT (11 dígitos)");
    const e = FACT_EMISORES[Number($("#fa-emisor").value)];
    fpb.disabled = true; const prev = fpb.textContent; fpb.textContent = "Consultando AFIP…";
    try { const r = await (await fetch("/api/admin/afip/padron?cuit=" + doc + "&emisor=" + (e ? e.cuit : ""))).json(); if (r.ok) { $("#fa-cli").value = r.nombre; toast("✓ " + r.nombre); } else toast(r.error || "No se pudo"); }
    catch { toast("No se pudo consultar AFIP"); }
    fpb.disabled = false; fpb.textContent = prev;
  };
  $("#fin-app").querySelectorAll("[data-vincf]").forEach((b) => b.onclick = async () => {
    const ped = prompt("N° de pedido para vincular a esta factura:");
    if (!ped || !ped.trim()) return;
    const r = await api("/api/admin/afip/factura-pedido", { id: b.dataset.vincf || undefined, numero: b.dataset.vincn ? Number(b.dataset.vincn) : undefined, pedido: ped.trim() });
    if (r && r.ok) { toast("✅ Pedido #" + ped.trim() + " vinculado"); renderFacturacion(); }
    else toast((r && r.error) || "No se pudo vincular");
  });
  if (FACT_PREFILL && FACT_PREFILL.ped) {
    const pf = FACT_PREFILL; FACT_PREFILL = null;
    $("#fa-ped").value = pf.ped;
    if (pf.cli) $("#fa-cli").value = pf.cli;
    if (pf.imp) $("#fa-imp").value = pf.imp;
    $("#fa-traer").click(); // trae cliente + importe + doc + condición IVA del pedido
  }
  $("#fa-puntos").onclick = async () => {
    const e = FACT_EMISORES[Number($("#fa-emisor").value)]; if (!e) return toast("Elegí un emisor");
    const res = $("#fa-puntos-res"); res.textContent = "Consultando AFIP…";
    try {
      const r = await (await fetch("/api/admin/afip/puntos?cuit=" + e.cuit)).json();
      if (!r.puntos || !r.puntos.length) {
        res.innerHTML = `⚠️ ${r.error ? esc(r.error) + " — " : ""}No hay puntos de venta habilitados para <b>Web Services</b> en este CUIT. Entrá a AFIP → <b>Administración de puntos de venta y domicilios</b> y creá uno asociado a <b>“Facturación Electrónica - Web Services”</b> (es distinto del de Comprobantes en línea). Después poné ese número en el emisor.`;
        return;
      }
      const usado = e.punto_venta;
      const ok = r.puntos.some((p) => p.nro === Number(usado));
      res.innerHTML = `PV habilitados para Web Services: ${r.puntos.map((p) => `<b>${p.nro}</b>${p.bloqueado === "S" ? " (bloqueado)" : ""}`).join(", ")}.<br>` +
        (ok ? `✅ El emisor está usando el PV <b>${usado}</b>, que está habilitado.` : `⚠️ El emisor tiene configurado el PV <b>${usado}</b>, que <b>NO</b> está en la lista. Cambialo en Ajustes por uno de los de arriba.`);
    } catch { res.textContent = "No se pudo consultar AFIP."; }
  };
}
async function emitirFactura() {
  const e = FACT_EMISORES[Number($("#fa-emisor").value)]; if (!e) return toast("Elegí un emisor");
  const importe = Number($("#fa-imp").value); if (!(importe > 0)) return toast("Poné el importe");
  const doc = $("#fa-doc").value.replace(/\D/g, "");
  if (!confirm(`¿Emitir Factura C por ${fmtAR(importe)} con ${e.razon}?\n\n⚠️ Esto genera una factura REAL en AFIP.`)) return;
  const btn = $("#fa-emitir"); btn.disabled = true; const pv = btn.textContent; btn.textContent = "Emitiendo…";
  try {
    const r = await (await fetch("/api/admin/afip/emitir", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cuit: e.cuit, pv: e.punto_venta, importe, cliente: $("#fa-cli").value, doc_nro: doc || undefined, doc_tipo: doc ? (doc.length === 11 ? 80 : 96) : 99, cond_iva_receptor: Number($("#fa-cond").value) || 5, pedido: $("#fa-ped").value.trim() || null }) })).json();
    if (r.ok) { const f = r.factura; $("#fa-result").innerHTML = `✅ <b>${compNombre(f)}</b> emitida · CAE ${f.cae} · <a href="/factura/${f.id}" target="_blank">🖨️ Imprimir</a>`; toast("¡Factura emitida!"); FACT_LIST.unshift(f); }
    else { $("#fa-result").innerHTML = "⚠️ " + esc(r.error || "Rechazada por AFIP"); toast("Rechazada"); }
  } catch { $("#fa-result").innerHTML = "⚠️ No se pudo conectar."; }
  btn.disabled = false; btn.textContent = pv;
}
let CTACTE = [];
let CC_TEL = {}, CC_DOC = {}; // email(lower) -> telefono / CUIT-DNI, para cuenta corriente
async function renderCtaCte() {
  $("#fin-app").innerHTML = '<p class="meta">Cargando cuentas corrientes…</p>';
  try {
    const d = await (await fetch("/api/admin/finanzas")).json(); CTACTE = d.ctacte || [];
    try { const u = await (await fetch("/api/admin/usuarios")).json(); CC_TEL = {}; CC_DOC = {}; for (const x of (u.usuarios || [])) { const em = (x.email || "").toLowerCase(); if (em) { if (x.telefono) CC_TEL[em] = x.telefono; if (x.doc) CC_DOC[em] = x.doc; } } } catch { CC_TEL = {}; CC_DOC = {}; }
    drawCtaCte("");
  } catch { $("#fin-app").innerHTML = '<p class="meta">No se pudieron cargar.</p>'; }
}
let CC_EXP = new Set(); // claves de clientes con el detalle desplegado
let CC_MOV_EDIT = null; // id del registro (deuda/cobro) que se está editando
function drawCtaCte(q) {
  q = (q || "").toLowerCase().trim();
  const map = {};
  for (const m of CTACTE) {
    const k = (m.email || m.cliente || "").toLowerCase(); if (!k) continue;
    if (!map[k]) map[k] = { key: k, cliente: m.cliente || m.email, email: m.email || "", debe: 0, haber: 0, movs: [] };
    if (m.tipo === "cobro") map[k].haber += Number(m.monto) || 0; else map[k].debe += Number(m.monto) || 0;
    map[k].movs.push(m);
  }
  let clientes = Object.values(map).map((c) => ({ ...c, saldo: c.debe - c.haber, telefono: CC_TEL[(c.email || "").toLowerCase()] || "" }));
  const totalSaldo = clientes.reduce((s, c) => s + c.saldo, 0);
  const qDig = q.replace(/\D/g, "");
  const lista = q ? clientes.filter((c) => (c.cliente || "").toLowerCase().includes(q) || (c.email || "").toLowerCase().includes(q) || (qDig && (c.telefono || "").replace(/\D/g, "").includes(qDig))) : clientes;
  lista.sort((a, b) => b.saldo - a.saldo);
  const datalist = `<datalist id="cc-list">${clientes.map((c) => `<option value="${esc(c.email || c.cliente)}">${esc(c.cliente)}</option>`).join("")}</datalist>`;
  let h = `<p class="meta">Registrás las <b>deudas</b> (traé un pedido impago por su N° o cargá manual) y los <b>cobros</b>. Total adeudado: <b>${fmtAR(totalSaldo)}</b>.</p>
  <div class="cc-picker">
    <input id="cc-buscar" type="search" placeholder="🔎 Elegí el cliente por nombre, email o teléfono…" autocomplete="off">
    <div id="cc-buscar-sug" class="vt-cli-sug"></div>
    <div id="cc-buscar-sel" class="meta"></div>
  </div>
  <div class="fin-form"><strong class="fin-form-tit">Registrar deuda</strong>
    <label>N° pedido impago<input type="text" id="cc-ped" placeholder="ej 12150" inputmode="numeric"></label>
    <button class="btn ghost sm" type="button" id="cc-traer">↓ Traer de WooCommerce</button>
    <label>Cliente<input type="text" id="cc-cli"></label>
    <label>Email<input type="text" id="cc-email"></label>
    <label>Monto $<input type="number" id="cc-monto" step="0.01"></label>
    <label>Concepto<input type="text" id="cc-concepto" placeholder="opcional"></label>
    <button class="btn" id="cc-deuda">+ Deuda</button>
  </div>
  <div class="fin-form"><strong class="fin-form-tit">Registrar cobro</strong>
    <label>Cliente / Email<input type="text" id="cb-cli" list="cc-list">${datalist}</label>
    <label>Fecha<input type="date" id="cb-fecha"></label>
    <label>Monto $<input type="number" id="cb-monto" step="0.01"></label>
    <label>Medio<select id="cb-medio"><option>cheque</option><option>efectivo</option><option>transferencia</option></select></label>
    <button class="btn" id="cb-add">+ Cobro</button>
  </div>
  <div class="cos-bar"><input id="cc-q" type="search" placeholder="Buscar por nombre, email o teléfono…"></div>
  <p class="meta">👉 Tocá un cliente para ver los pedidos y cobros que forman su cuenta.</p>
  <div class="fin-table"><table><thead><tr><th>Cliente</th><th>Debe</th><th>Cobrado</th><th>Saldo</th></tr></thead><tbody>`;
  const fdmy = (s) => (s || "").slice(0, 10).split("-").reverse().join("/");
  for (const c of lista.slice(0, 400)) {
    const abierto = CC_EXP.has(c.key);
    const sub = [c.email ? esc(c.email) : "", c.telefono ? "📱 " + esc(c.telefono) : ""].filter(Boolean).join(" · ");
    h += `<tr class="cc-row" data-ccexp="${esc(c.key)}"><td>${abierto ? "▾" : "▸"} ${esc(c.cliente || c.email)}${sub ? `<div class="meta">${sub}</div>` : ""}</td><td>${fmtAR(c.debe)}</td><td>${fmtAR(c.haber)}</td><td class="${c.saldo > 0 ? "cos-neg" : "cos-pos"}">${fmtAR(c.saldo)}</td></tr>`;
    if (abierto) {
      const movs = [...c.movs].sort((a, b) => String(a.fecha || a.creado || "").localeCompare(String(b.fecha || b.creado || "")));
      const filas = movs.map((m) => {
        const cobro = m.tipo === "cobro";
        if (m.id === CC_MOV_EDIT) {
          const campos = cobro
            ? `<select class="ce-f" data-cf="medio"><option ${m.medio === "cheque" ? "selected" : ""}>cheque</option><option ${m.medio === "efectivo" ? "selected" : ""}>efectivo</option><option ${m.medio === "transferencia" ? "selected" : ""}>transferencia</option></select>`
            : `<input class="ce-f" data-cf="pedido" value="${esc(m.pedido || "")}" placeholder="N° pedido" style="width:78px"><input class="ce-f" data-cf="nota" value="${esc(m.nota || m.concepto || "")}" placeholder="concepto">`;
          return `<div class="cc-mov cc-mov-edit ${cobro ? "cobro" : "deuda"}"><input type="date" class="ce-f" data-cf="fecha" value="${(m.fecha || m.creado || "").slice(0, 10)}">${campos}<input class="ce-f" data-cf="monto" value="${m.monto}" inputmode="numeric" style="width:96px" placeholder="monto"><button class="btn sm" data-ccsave="${m.id}">💾</button><button class="btn ghost sm" data-cccancel="1">✕</button></div>`;
        }
        const desc = cobro ? `🟢 Cobro${m.medio ? " (" + esc(m.medio) + ")" : ""}` : `🔴 Deuda${m.pedido ? " · Pedido #" + esc(m.pedido) : ""}`;
        const extra = esc(m.nota || m.concepto || "");
        return `<div class="cc-mov ${cobro ? "cobro" : "deuda"}"><span class="cc-mov-f">${fdmy(m.fecha || m.creado)}</span><span class="cc-mov-d">${desc}${extra ? ` · <span class="meta">${extra}</span>` : ""}</span><span class="cc-mov-m">${cobro ? "−" : "+"}${fmtAR(m.monto)}</span><span class="cc-mov-acc"><button class="cc-mov-e" data-ccedit="${m.id}" title="Editar">✎</button><button class="cc-mov-x" data-ccdel="${m.id}" title="Borrar registro">✕</button></span></div>`;
      }).join("");
      h += `<tr class="cc-detail"><td colspan="4"><div class="cc-movs">${filas || '<span class="meta">Sin registros.</span>'}</div><div class="cc-detail-acc">${c.saldo > 0 ? waBtn(c.telefono, waMsgCobranza(c.cliente, c.saldo), "📱 Mandar cobranza") : ""}<button class="btn ghost sm" data-ccpdf="${esc(c.key)}">📄 PDF estado de cuenta</button></div></td></tr>`;
    }
  }
  h += `</tbody></table>${lista.length ? "" : '<p class="meta" style="padding:12px">Sin cuentas con saldo todavía.</p>'}</div>`;
  $("#fin-app").innerHTML = h;
  $("#fin-app").querySelectorAll("[data-ccexp]").forEach((tr) => tr.onclick = () => { const k = tr.dataset.ccexp; if (CC_EXP.has(k)) CC_EXP.delete(k); else CC_EXP.add(k); drawCtaCte($("#cc-q") ? $("#cc-q").value : ""); });
  $("#fin-app").querySelectorAll("[data-ccdel]").forEach((b) => b.onclick = async (e) => { e.stopPropagation(); if (!confirm("¿Borrar este registro de la cuenta corriente?")) return; const r = await api("/api/admin/finanzas/borrar", { coleccion: "ctacte", id: b.dataset.ccdel }); if (r && r.ok) renderCtaCte(); else toast((r && r.error) || "No se pudo"); });
  $("#fin-app").querySelectorAll("[data-ccpdf]").forEach((b) => b.onclick = (e) => { e.stopPropagation(); estadoCuentaPDF(b.dataset.ccpdf); });
  $("#fin-app").querySelectorAll("[data-ccedit]").forEach((b) => b.onclick = (e) => { e.stopPropagation(); CC_MOV_EDIT = b.dataset.ccedit; drawCtaCte($("#cc-q") ? $("#cc-q").value : ""); });
  $("#fin-app").querySelectorAll("[data-cccancel]").forEach((b) => b.onclick = (e) => { e.stopPropagation(); CC_MOV_EDIT = null; drawCtaCte($("#cc-q") ? $("#cc-q").value : ""); });
  $("#fin-app").querySelectorAll("[data-ccsave]").forEach((b) => b.onclick = async (e) => {
    e.stopPropagation();
    const row = b.closest(".cc-mov"), cambios = {};
    row.querySelectorAll(".ce-f").forEach((el) => { const k = el.dataset.cf; cambios[k] = k === "monto" ? (Number(el.value) || 0) : el.value.trim(); });
    const r = await api("/api/admin/finanzas/actualizar", { coleccion: "ctacte", id: b.dataset.ccsave, cambios });
    CC_MOV_EDIT = null;
    if (r && r.ok) { toast("✅ Registro actualizado"); renderCtaCte(); } else { toast((r && r.error) || "No se pudo"); drawCtaCte($("#cc-q") ? $("#cc-q").value : ""); }
  });
  $("#cc-q").value = q; $("#cc-q").oninput = () => drawCtaCte($("#cc-q").value);
  $("#cc-traer").onclick = traerPedidoCC;
  $("#cc-deuda").onclick = () => agregarCC("deuda");
  $("#cb-add").onclick = () => agregarCC("cobro");
  const ccb = $("#cc-buscar"); if (ccb) ccb.oninput = () => { clearTimeout(window._ccbT); window._ccbT = setTimeout(() => ccBuscarCli(ccb.value), 250); };
}
async function ccBuscarCli(q) {
  const sug = $("#cc-buscar-sug"); if (!sug) return;
  if ((q || "").trim().length < 2) { sug.innerHTML = ""; return; }
  try {
    const d = await (await fetch("/api/admin/clientes/buscar?q=" + encodeURIComponent(q))).json();
    sug.innerHTML = (d.clientes || []).map((c, i) => `<div class="vt-cli-item" data-cci="${i}"><strong>${esc(c.nombre || c.email)}</strong><small>${esc(c.telefono || "")} · ${esc(c.email || "")}</small></div>`).join("") || '<p class="meta">Sin coincidencias. Cargá los datos a mano abajo.</p>';
    sug.querySelectorAll("[data-cci]").forEach((el) => el.onclick = () => { ccElegirCli(d.clientes[+el.dataset.cci]); sug.innerHTML = ""; });
  } catch {}
}
function ccElegirCli(c) {
  if ($("#cc-cli")) $("#cc-cli").value = c.nombre || c.email || "";
  if ($("#cc-email")) $("#cc-email").value = c.email || "";
  if ($("#cb-cli")) $("#cb-cli").value = c.email || c.nombre || ""; // email para que el cobro caiga en la misma cuenta
  const sel = $("#cc-buscar-sel"); if (sel) sel.innerHTML = `✅ Cliente elegido: <b>${esc(c.nombre || c.email)}</b>${c.telefono ? " · 📱 " + esc(c.telefono) : ""}${c.email ? " · " + esc(c.email) : ""} — ahora cargá la deuda o el cobro acá abajo.`;
  const b = $("#cc-buscar"); if (b) b.value = "";
}
// PDF estado de cuenta de un cliente (movimientos + saldo acumulado) para mandárselo
function estadoCuentaPDF(key) {
  const movs = CTACTE.filter((m) => (m.email || m.cliente || "").toLowerCase() === key);
  if (!movs.length) return toast("Sin registros");
  const cliente = movs[0].cliente || movs[0].email || "Cliente", email = movs[0].email || "";
  const cuit = CC_DOC[email.toLowerCase()] || "";
  const fmt = (n) => "$" + Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 2 });
  const fdmy = (s) => (s || "").slice(0, 10).split("-").reverse().join("/");
  const ord = [...movs].sort((a, b) => String(a.fecha || a.creado || "").localeCompare(String(b.fecha || b.creado || "")));
  let debe = 0, haber = 0, saldo = 0;
  const filas = ord.map((m) => {
    const cobro = m.tipo === "cobro", monto = Number(m.monto) || 0;
    if (cobro) haber += monto; else debe += monto;
    saldo += cobro ? -monto : monto;
    const desc = cobro ? `Cobro${m.medio ? " (" + esc(m.medio) + ")" : ""}` : `Deuda${m.pedido ? " · Pedido #" + esc(m.pedido) : ""}`;
    const extra = esc(m.nota || m.concepto || "");
    return `<tr><td>${fdmy(m.fecha || m.creado)}</td><td>${desc}${extra ? " · " + extra : ""}</td><td class="r">${cobro ? "" : fmt(monto)}</td><td class="r">${cobro ? fmt(monto) : ""}</td><td class="r">${fmt(saldo)}</td></tr>`;
  }).join("");
  const hoy = new Date().toLocaleDateString("es-AR");
  const w = window.open("", "_blank");
  if (!w) return toast("Permití las ventanas emergentes para generar el PDF");
  w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title> </title><style>
    @page{size:A4 portrait;margin:14mm}
    *{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    body{margin:0;font-family:'Helvetica Neue',Arial,sans-serif;color:#2a1622}
    .sheet{max-width:180mm;margin:0 auto}
    .tip{background:#fff;border:1px dashed #DE3667;color:#7a1040;font-size:13px;padding:10px 14px;border-radius:10px;margin-bottom:16px;text-align:center}
    .head{display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid #DE3667;padding-bottom:12px;margin-bottom:14px}
    .head img{height:60px}
    .head .t{text-align:right}
    .head .t b{font-size:20px;color:#7a1040}
    .head .t div{font-size:12px;color:#a8949e}
    .cli{font-size:15px;margin:0 0 14px}
    .cli b{color:#7a1040}
    table{border-collapse:collapse;width:100%;font-size:13px}
    th{background:#fdf2f8;text-align:left;padding:8px 10px;border-bottom:2px solid #DE3667;color:#7a1040}
    td{padding:7px 10px;border-bottom:1px solid #f0d5e2}
    .r{text-align:right;white-space:nowrap}
    tfoot td{font-weight:800;border-top:2px solid #DE3667;background:#fff}
    .saldo{margin-top:16px;text-align:right;font-size:20px;font-weight:800;color:${saldo > 0 ? "#b91c1c" : "#15803d"}}
    .foot{margin-top:26px;text-align:center;font-size:12px;color:#7a1040;border-top:1px solid #f0d5e2;padding-top:10px}
    @media print{.tip{display:none}}
  </style></head><body><div class="sheet">
    <div class="tip">💡 En el cuadro de impresión elegí <b>"Guardar como PDF"</b> y destildá <b>"Encabezados y pies de página"</b>.</div>
    <div class="head"><img src="/assets/logo.png" onerror="this.style.display='none'"><div class="t"><b>Estado de cuenta</b><div>${hoy}</div></div></div>
    <p class="cli">Cliente: <b>${esc(cliente)}</b>${cuit ? ` · CUIT/DNI: ${esc(cuit)}` : ""}</p>
    <table><thead><tr><th>Fecha</th><th>Detalle</th><th class="r">Debe</th><th class="r">Haber</th><th class="r">Saldo</th></tr></thead>
    <tbody>${filas}</tbody>
    <tfoot><tr><td colspan="2">Totales</td><td class="r">${fmt(debe)}</td><td class="r">${fmt(haber)}</td><td class="r">${fmt(saldo)}</td></tr></tfoot></table>
    <div class="saldo">Saldo ${saldo > 0 ? "adeudado" : saldo < 0 ? "a favor" : ""}: ${fmt(Math.abs(saldo))}</div>
    <div class="foot"><b>El Pasaje Dental</b> · elpasajedental.com · 📍 Tucumán · 📱 WhatsApp 381 208 5383</div>
    </div>
    <script>window.onload=function(){var i=[].slice.call(document.images),n=i.filter(function(x){return !x.complete}).length;function go(){if(--n<=0)window.print();}if(!n){window.print();}else{i.forEach(function(x){if(!x.complete){x.addEventListener('load',go);x.addEventListener('error',go);}});}setTimeout(function(){try{window.print()}catch(e){}},3000);};<\/script>
  </body></html>`);
  w.document.close();
}
async function traerPedidoCC() {
  const n = $("#cc-ped").value.trim(); if (!n) return toast("Poné el N° de pedido");
  try {
    const r = await (await fetch("/api/admin/ctacte/pedido?n=" + encodeURIComponent(n))).json();
    if (r.ok) { $("#cc-cli").value = r.cliente; $("#cc-email").value = r.email; $("#cc-monto").value = r.total; $("#cc-concepto").value = "Pedido #" + r.pedido; toast("Pedido #" + r.pedido + " traído"); }
    else toast(r.error || "No se encontró");
  } catch { toast("No se pudo consultar"); }
}
async function agregarCC(tipo) {
  let registro;
  if (tipo === "deuda") {
    const monto = Number($("#cc-monto").value), cliente = $("#cc-cli").value.trim();
    if (!cliente || !(monto > 0)) return toast("Completá cliente y monto");
    registro = { tipo: "deuda", cliente, email: $("#cc-email").value.trim().toLowerCase(), monto, concepto: $("#cc-concepto").value, pedido: $("#cc-ped").value.trim(), fecha: new Date().toISOString().slice(0, 10) };
  } else {
    const monto = Number($("#cb-monto").value), cli = $("#cb-cli").value.trim();
    if (!cli || !(monto > 0)) return toast("Completá cliente y monto");
    registro = { tipo: "cobro", cliente: cli, email: cli.includes("@") ? cli.toLowerCase() : "", monto, medio: $("#cb-medio").value, fecha: $("#cb-fecha").value || new Date().toISOString().slice(0, 10) };
  }
  try { const r = await (await fetch("/api/admin/finanzas/agregar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ coleccion: "ctacte", registro }) })).json(); if (r.ok) { toast(tipo === "deuda" ? "Deuda registrada" : "Cobro registrado"); renderCtaCte(); } else toast(r.error || "No se pudo"); } catch { toast("No se pudo"); }
}
let COSTOS_PROD = [];
let COSTOS_PAGE = 0; // paginado de a 100
let COSTOS_SOLO_VACIOS = false; // filtro: solo productos sin costo cargado
const COSTOS_POR_PAG = 100;
async function guardarPrecioRow(p) {
  try { const r = await (await fetch("/api/admin/precio", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId: p.productId || p.id, variationId: p.variationId || null, precio: p.precio }) })).json(); toast(r.ok ? "Precio actualizado en la web" : (r.error || "No se pudo guardar el precio")); }
  catch { toast("No se pudo guardar el precio"); }
}
async function guardarCostoUno(id, costo) {
  try { const r = await (await fetch("/api/admin/costos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cambios: { [id]: costo } }) })).json(); toast(r.ok ? "Costo guardado" : (r.error || "No se pudo guardar el costo")); }
  catch { toast("No se pudo guardar el costo"); }
}
async function guardarVencimiento(productId, variationId, nombre, fecha) {
  try { const r = await (await fetch("/api/admin/vencimiento-set", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ productId, variationId: variationId || null, nombre, fecha }) })).json(); toast(r.ok ? (fecha ? "Vencimiento guardado" : "Vencimiento quitado") : (r.error || "No se pudo")); }
  catch { toast("No se pudo guardar el vencimiento"); }
}
// Recalcula la fila según el campo que se editó. precio (con IVA) → WooCommerce; costo → finanzas.
function recalcCosto(idx, field, raw) {
  const p = COSTOS_PROD[idx];
  const val = Number(raw) || 0;
  let savePrecio = false, saveCosto = false;
  if (field === "precio") { p.precio = Math.round(val); savePrecio = true; }
  else if (field === "precioiva") { p.precio = Math.round(val * 1.21); savePrecio = true; }
  else if (field === "costo") { p._costo = Math.round(val * 100) / 100; saveCosto = true; }
  else if (field === "costoiva") { p._costo = Math.round(val * (1 + (Number(p.ivaProv) || 21) / 100)); saveCosto = true; }
  else if (field === "util") { p.precio = Math.max(0, Math.round((p._costo || 0) + val)); savePrecio = true; }
  else if (field === "margen") {
    if (!(p._costo > 0)) { toast("Cargá primero el costo para fijar el precio por margen"); drawCostos($("#cos-q").value); return; }
    const m = val / 100;
    if (m >= 0.99) { toast("El margen tiene que ser menor a 99%"); drawCostos($("#cos-q").value); return; }
    p.precio = Math.round(p._costo / (1 - m)); savePrecio = true;
  }
  if (savePrecio) guardarPrecioRow(p);
  if (saveCosto) guardarCostoUno(p.id, p._costo);
  drawCostos($("#cos-q") ? $("#cos-q").value : "");
}
// ----- Precios de Mercado Libre (que el neto = tu precio web; ML lo paga el comprador) -----
let ML_CFG = { comision: 16.5, envio: 5000, iibb: 5, fijoBajo: 900, fijoAlto: 1800, umbralBajo: 12000, umbralEnvio: 33000 };
function mlFijo(precio, cfg) { // costo fijo por unidad (editable; $0 a partir del umbral de envío gratis)
  const ue = Number(cfg.umbralEnvio) || 33000, ub = Number(cfg.umbralBajo) || 12000;
  if (precio >= ue) return 0;
  return precio <= ub ? (Number(cfg.fijoBajo) || 0) : (Number(cfg.fijoAlto) || 0);
}
function calcML(web, cfg) {
  web = Number(web) || 0; if (web <= 0) return null;
  const com = (Number(cfg.comision) || 0) / 100, iibb = (Number(cfg.iibb) || 0) / 100, envio = Number(cfg.envio) || 0;
  const ue = Number(cfg.umbralEnvio) || 33000;
  const rate = com * 1.21 + iibb; // costos proporcionales al precio (comisión con IVA + IIBB sobre el total)
  if (rate >= 0.95) return null;
  let price = (web + envio * 1.21) / (1 - rate), extra, esEnvio; // tanteo como ≥ umbral (envío gratis)
  if (price >= ue) { extra = envio * 1.21; esEnvio = true; }
  else { // debajo del umbral: costo fijo por tramo, iteramos para converger
    let f = mlFijo(price, cfg);
    for (let i = 0; i < 6; i++) { price = (web + f * 1.21) / (1 - rate); f = mlFijo(price, cfg); }
    if (price >= ue) { price = (web + envio * 1.21) / (1 - rate); extra = envio * 1.21; esEnvio = true; }
    else { extra = f * 1.21; esEnvio = false; }
  }
  price = Math.round(price);
  const comision = Math.round(price * com * 1.21), iibbM = Math.round(price * iibb), extraM = Math.round(extra);
  return { price, comision, iibb: iibbM, extra: extraM, esEnvio, totalML: comision + iibbM + extraM };
}
function exportarMLCsv(rows) {
  const head = ["Producto", "SKU/ID", "Costo", "Precio web (neto)", "Utilidad", "Comision ML", "Fijo/Envio", "IIBB 5%", "Total costos ML", "PRECIO ML"];
  const lines = [head.join(";")];
  for (const r of rows) lines.push([`"${String(r.nombre || "").replace(/"/g, '""')}"`, r.id, r.costo, r.precio, r.utilidad, r.ml.comision, r.ml.extra, r.ml.iibb, r.ml.totalML, r.ml.price].join(";"));
  const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "precios-mercadolibre.csv"; a.click();
}
async function renderMercadoLibre() {
  $("#fin-app").innerHTML = '<p class="meta">Cargando productos con costo…</p>';
  let prods = [];
  try { const d = await (await fetch("/api/admin/costos?todos=1")).json(); if (d.error) { $("#fin-app").innerHTML = `<p class="meta">${esc(d.error)}</p>`; return; } prods = (d.productos || []).filter((p) => p.costo > 0 && p.precio > 0); } catch { $("#fin-app").innerHTML = '<p class="meta">No se pudieron cargar.</p>'; return; }
  const c = ML_CFG;
  const rows = prods.map((p) => ({ ...p, ml: calcML(p.precio, c) })).filter((r) => r.ml).sort((a, b) => a.nombre.localeCompare(b.nombre));
  let h = `<p class="meta">Calcula el <b>precio de venta en Mercado Libre</b> para que, después de TODOS los costos de ML, te quede neto en la cuenta <b>lo mismo que cobrás hoy</b> (tu precio web de transferencia/efectivo). Tu <b>utilidad no cambia</b>: los costos de ML los paga el comprador con un precio más alto. Incluye <b>IIBB Tucumán</b>.</p>
  <div class="ml-cfg">
    <label>Publicación <select id="ml-tipo"><option value="13" ${c.comision == 13 ? "selected" : ""}>Clásica (~13%)</option><option value="16.5" ${c.comision == 16.5 ? "selected" : ""}>Premium (~16,5%)</option></select></label>
    <label>Comisión %<input id="ml-com" type="number" step="0.1" value="${c.comision}"></label>
    <label>Envío que absorbés $<input id="ml-envio" type="number" value="${c.envio}" title="Solo aplica a productos de $33.000 o más (envío gratis obligatorio)"></label>
    <label>IIBB %<input id="ml-iibb" type="number" step="0.1" value="${c.iibb}"></label>
    <label>Costo fijo bajo $<input id="ml-fbajo" type="number" value="${c.fijoBajo}" title="Productos hasta ~$12.000"></label>
    <label>Costo fijo alto $<input id="ml-falto" type="number" value="${c.fijoAlto}" title="Productos de ~$12.000 a $33.000"></label>
    <button class="btn ghost sm" id="ml-csv">⬇️ Exportar CSV</button>
    <span class="meta">${rows.length} producto(s) con costo</span>
  </div>
  <p class="meta">⚠️ Valores de ML <b>editables</b> arriba (la comisión exacta de tu categoría y el costo fijo están en tu cuenta de ML: publicá/previsualizá 1 producto y ML te muestra el "costo de venta" — ajustá los campos con eso). Por defecto: comisión 13% + IVA 21%, costo fijo $900 (≤$12k) / $1.800 (hasta $33k), <b>$0 desde $33.000</b> pero ahí el <b>envío</b> lo absorbés vos, + IIBB Tucumán 5%.</p>
  <div class="fin-table"><table><thead><tr><th>Producto</th><th>Costo</th><th>Precio web</th><th>Utilidad</th><th>Comisión ML</th><th>Fijo/Envío</th><th>IIBB</th><th>Precio ML</th></tr></thead><tbody>`;
  for (const r of rows) h += `<tr><td>${esc(r.nombre)}</td><td>${fmtAR(r.costo)}</td><td>${fmtAR(r.precio)}</td><td>${fmtAR(r.utilidad)}</td><td>${fmtAR(r.ml.comision)}</td><td>${fmtAR(r.ml.extra)} <small class="meta">${r.ml.esEnvio ? "envío" : "fijo"}</small></td><td>${fmtAR(r.ml.iibb)}</td><td class="ml-precio"><b>${fmtAR(r.ml.price)}</b></td></tr>`;
  h += `</tbody></table>${rows.length ? "" : '<p class="meta" style="padding:12px">No hay productos con costo cargado todavía. Cargá costos al recibir mercadería o en la ficha del producto.</p>'}</div>`;
  $("#fin-app").innerHTML = h;
  const upd = () => { ML_CFG = { ...ML_CFG, comision: Number($("#ml-com").value) || 13, envio: Number($("#ml-envio").value) || 0, iibb: Number($("#ml-iibb").value) || 0, fijoBajo: Number($("#ml-fbajo").value) || 0, fijoAlto: Number($("#ml-falto").value) || 0 }; renderMercadoLibre(); };
  $("#ml-com").onchange = upd; $("#ml-envio").onchange = upd; $("#ml-iibb").onchange = upd; $("#ml-fbajo").onchange = upd; $("#ml-falto").onchange = upd;
  $("#ml-tipo").onchange = () => { $("#ml-com").value = $("#ml-tipo").value; upd(); };
  $("#ml-csv").onclick = () => exportarMLCsv(rows);
}
// ---------- Panel de TEST del sistema (auto-chequeos después de cada cambio) ----------
const TEST_PID = 9990001; // producto de prueba (no existe en el catálogo): solo para probar la lógica de datos
const _tp = (url, body) => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({}));
const _tg = (url) => fetch(url).then((r) => r.json()).catch(() => ({}));
function testOut(res) {
  const okN = res.filter((r) => r.ok).length, total = res.length;
  return `<div class="test-sum ${okN === total ? "ok" : "bad"}">${okN === total ? "✅ TODO OK" : "❌ HAY FALLAS"} — ${okN}/${total} pasaron</div>` +
    res.map((r) => `<div class="test-row ${r.ok ? "ok" : "bad"}">${r.ok ? "✅" : "❌"} <b>${esc(r.name)}</b>${r.detail ? ` — <span class="meta">${esc(r.detail)}</span>` : ""}</div>`).join("");
}
async function renderTest() {
  $("#fin-app").innerHTML = `<p class="meta">Verificá que todo ande después de cada cambio. Los <b>tests rápidos</b> usan datos de prueba y se limpian solos (no tocan productos reales ni crean pedidos). El <b>ciclo de venta</b> crea un pedido de prueba real y lo cancela.</p>
  <div class="test-bar">
    <button class="btn" id="test-run">▶️ Correr tests rápidos</button>
    <button class="btn ghost" id="test-ciclo">🛒 Test ciclo de venta (crea y cancela un pedido de prueba)</button>
  </div>
  <div id="test-out"></div>`;
  $("#test-run").onclick = correrTests;
  $("#test-ciclo").onclick = correrTestCiclo;
}
async function correrTests() {
  const out = $("#test-out"); out.innerHTML = '<p class="meta">Corriendo tests…</p>';
  const res = [];
  try { // Ubicación: suma (recibir) y reemplaza (inventario)
    const SL = "zzz-test-A";
    await _tp("/api/asignar", { productId: TEST_PID, slotId: SL, cantidad: 10, sumar: true });
    let r = await _tp("/api/asignar", { productId: TEST_PID, slotId: SL, cantidad: 5, sumar: true });
    const suma = ((r.asignaciones || []).find((x) => x.productId === TEST_PID && x.slotId === SL) || {}).cantidad === 15;
    r = await _tp("/api/asignar", { productId: TEST_PID, slotId: SL, cantidad: 3, sumar: false });
    const reemplaza = ((r.asignaciones || []).find((x) => x.productId === TEST_PID && x.slotId === SL) || {}).cantidad === 3;
    await _tp("/api/desasignar", { productId: TEST_PID, variationId: null, slotId: SL });
    res.push({ name: "Ubicación: suma al recibir / reemplaza en inventario", ok: suma && reemplaza, detail: `suma ${suma ? "✓" : "✗"} · reemplaza ${reemplaza ? "✓" : "✗"}` });
  } catch (e) { res.push({ name: "Ubicación", ok: false, detail: e.message }); }
  try { // Mover ubicación (corrección desde la venta)
    const A = "zzz-test-A", B = "zzz-test-B";
    await _tp("/api/asignar", { productId: TEST_PID, slotId: A, cantidad: 10, sumar: false });
    await _tp("/api/asignar", { productId: TEST_PID, slotId: B, cantidad: 5, sumar: false });
    const r = await _tp("/api/admin/venta/mover-ubic", { order_id: "test", productId: TEST_PID, fromSlot: A, toSlot: B, cant: 3 });
    const a = (r.asignaciones || []).find((x) => x.productId === TEST_PID && x.slotId === A) || {};
    const b = (r.asignaciones || []).find((x) => x.productId === TEST_PID && x.slotId === B) || {};
    const ok = a.cantidad === 13 && b.cantidad === 2;
    await _tp("/api/desasignar", { productId: TEST_PID, variationId: null, slotId: A });
    await _tp("/api/desasignar", { productId: TEST_PID, variationId: null, slotId: B });
    res.push({ name: "Mover ubicación (devuelve a una, descuenta de otra)", ok, detail: ok ? "✓" : `A=${a.cantidad} B=${b.cantidad}` });
  } catch (e) { res.push({ name: "Mover ubicación", ok: false, detail: e.message }); }
  try { // Vencimiento: suma por fecha+ubic / agrega por fecha distinta
    const base = { productId: TEST_PID, nombre: "TEST", ubicacion: "zzz-test-ubic" };
    await _tp("/api/admin/vencimiento-sumar", { ...base, fecha: "2030-01-01", cantidad: 10 });
    await _tp("/api/admin/vencimiento-sumar", { ...base, fecha: "2030-01-01", cantidad: 5 });
    await _tp("/api/admin/vencimiento-sumar", { ...base, fecha: "2030-06-01", cantidad: 7 });
    const mios = ((await _tg("/api/admin/vencimientos")).items || []).filter((x) => String(x.productId) === String(TEST_PID));
    const f1 = mios.find((x) => x.fecha === "2030-01-01");
    const ok = mios.length === 2 && f1 && f1.cantidad === 15;
    for (const x of mios) await _tp("/api/admin/vencimiento-borrar", { id: x.id });
    res.push({ name: "Vencimiento: suma misma fecha+lugar / agrega fecha nueva", ok, detail: ok ? "✓" : `items=${mios.length} suma=${f1 && f1.cantidad}` });
  } catch (e) { res.push({ name: "Vencimiento", ok: false, detail: e.message }); }
  try { // Caja: un ingreso refleja en el saldo y se revierte al borrar
    const ef0 = Number((await _tg("/api/admin/finanzas")).resumen.saldos.efectivo) || 0;
    const ag = await _tp("/api/admin/finanzas/agregar", { coleccion: "movimientos", registro: { tipo: "ingreso", cuenta: "efectivo", monto: 777, categoria: "TEST", detalle: "TEST self-check", fecha: new Date().toISOString().slice(0, 10) } });
    const mid = ag.registro && ag.registro.id;
    const ef1 = Number((await _tg("/api/admin/finanzas")).resumen.saldos.efectivo) || 0;
    if (mid) await _tp("/api/admin/finanzas/borrar", { coleccion: "movimientos", id: mid });
    const ef2 = Number((await _tg("/api/admin/finanzas")).resumen.saldos.efectivo) || 0;
    res.push({ name: "Caja: ingreso refleja en el saldo y se revierte", ok: ef1 === ef0 + 777 && ef2 === ef0, detail: `+777 ${ef1 === ef0 + 777 ? "✓" : "✗"} · revierte ${ef2 === ef0 ? "✓" : "✗"}` });
  } catch (e) { res.push({ name: "Caja", ok: false, detail: e.message }); }
  try { // Endpoints clave vivos
    const cat = await _tg("/api/tienda/catalogo"), cos = await _tg("/api/admin/costos"), inv = await _tg("/api/admin/inventario");
    const ok = (cat.productos || []).length > 0 && Array.isArray(cos.productos) && inv.contados != null;
    res.push({ name: "Endpoints clave responden (catálogo, costos, inventario)", ok, detail: ok ? `${(cat.productos || []).length} productos` : "alguno no respondió" });
  } catch (e) { res.push({ name: "Endpoints", ok: false, detail: e.message }); }
  out.innerHTML = testOut(res);
}
async function correrTestCiclo() {
  if (!confirm("Crea una VENTA de prueba real (qty 2), la edita a 4 y la cancela, verificando stock/ubicación/caja en cada paso. Al final restaura el stock.\n\nVa a quedar un pedido de prueba cancelado y puede que llegue 1 notificación. ¿Seguimos?")) return;
  const out = $("#test-out"); out.innerHTML = '<p class="meta">Corriendo ciclo de venta… (no cierres la pestaña)</p>';
  const res = [];
  const wcStock = async (pid) => Number((await _tg("/api/admin/producto-edit?id=" + pid)).stock);
  try {
    const data = await _tg("/api/data");
    const byProd = {}; for (const a of (data.ubicaciones.asignaciones || [])) if (a.cantidad > 0) (byProd[a.productId] = byProd[a.productId] || []).push(a);
    const prod = (data.catalogo.productos || []).find((p) => !(p.variaciones || []).length && Number(p.stock) >= 3 && byProd[p.id]);
    if (!prod) { out.innerHTML = testOut([{ name: "Ciclo de venta", ok: false, detail: "no hay producto simple con stock≥3 y ubicación para probar" }]); return; }
    const pid = prod.id, slot = byProd[pid][0];
    const S0 = await wcStock(pid), ef0 = Number((await _tg("/api/admin/finanzas")).resumen.saldos.efectivo) || 0, u0 = slot.cantidad;
    const venta = await _tp("/api/admin/venta", { items: [{ id: pid, qty: 2 }], cliente: { nombre: "TEST CICLO", email: "maximilianoespeche@gmail.com" }, envio: { metodo: "retiro" }, pago: "efectivo", nota: "TEST CICLO - ignorar" });
    const oid = venta.order_id; await new Promise((r) => setTimeout(r, 1200));
    res.push({ name: `Vender 2 (${prod.nombre.slice(0, 22)})`, ok: (await wcStock(pid)) === S0 - 2, detail: `stock esperado ${S0 - 2}` });
    const det = await _tg("/api/admin/pedido?id=" + oid); const li = (det.items || []).find((x) => Number(x.product_id) === pid);
    await _tp("/api/admin/pedido/editar", { id: oid, items: [{ line_item_id: li.line_item_id, quantity: 4 }] }); await new Promise((r) => setTimeout(r, 1200));
    res.push({ name: "Editar 2→4", ok: (await wcStock(pid)) === S0 - 4, detail: `stock esperado ${S0 - 4}` });
    await _tp("/api/admin/pedido-estado", { id: oid, estado: "cancelled" }); await new Promise((r) => setTimeout(r, 1500));
    const S3 = await wcStock(pid), ef3 = Number((await _tg("/api/admin/finanzas")).resumen.saldos.efectivo) || 0;
    const u3 = ((await _tg("/api/data")).ubicaciones.asignaciones || []).find((a) => a.productId === pid && a.slotId === slot.slotId);
    res.push({ name: "Cancelar → stock vuelve al original", ok: S3 === S0, detail: `quedó ${S3} (esperado ${S0})` });
    res.push({ name: "Cancelar → caja sin cambios", ok: ef3 === ef0, detail: `efectivo ${ef0}→${ef3}` });
    res.push({ name: "Cancelar → ubicación restaurada", ok: !!(u3 && u3.cantidad === u0), detail: `quedó ${u3 ? u3.cantidad : "?"} (esperado ${u0})` });
    if (S3 !== S0) { await _tp("/api/admin/stock", { productId: pid, stock: S0 }); res.push({ name: "Seguridad: stock forzado al original", ok: true, detail: "→ " + S0 }); }
    res.push({ name: "Pedido de prueba", ok: true, detail: "#" + (venta.number || oid) + " quedó cancelado (podés borrarlo)" });
  } catch (e) { res.push({ name: "Ciclo de venta", ok: false, detail: e.message }); }
  out.innerHTML = testOut(res);
}
async function renderFinCostos() {
  $("#fin-app").innerHTML = '<p class="meta">Cargando productos…</p>';
  try {
    const d = await (await fetch("/api/admin/costos")).json();
    COSTOS_PROD = (d.productos || []).map((p) => ({ ...p, _costo: p.costo || 0 }));
    COSTOS_PAGE = 0;
    // La barra de búsqueda se arma UNA sola vez (no se redibuja al tipear → el input no pierde el foco)
    $("#fin-app").innerHTML = `<div class="cos-bar">
      <input id="cos-q" type="search" placeholder="Buscar por producto, marca, proveedor, costo…" autocomplete="off">
      <label class="cos-chk"><input type="checkbox" id="cos-vacios" ${COSTOS_SOLO_VACIOS ? "checked" : ""}> Solo sin costo</label>
      <span class="meta" id="cos-resumen"></span>
    </div>
    <div id="cos-cont"></div>`;
    $("#cos-q").oninput = () => { COSTOS_PAGE = 0; drawCostos($("#cos-q").value); };
    $("#cos-vacios").onchange = () => { COSTOS_SOLO_VACIOS = $("#cos-vacios").checked; COSTOS_PAGE = 0; drawCostos($("#cos-q").value); };
    drawCostos("");
  } catch { $("#fin-app").innerHTML = '<p class="meta">No se pudieron cargar los productos.</p>'; }
}
function drawCostos(q) {
  q = (q || "").toLowerCase().trim();
  const conCosto = COSTOS_PROD.filter((p) => p._costo > 0);
  const margs = conCosto.filter((p) => p.precio > 0).map((p) => (p.precio - p._costo) / p.precio * 100);
  const prom = margs.length ? Math.round(margs.reduce((a, b) => a + b, 0) / margs.length) : 0;
  const terms = q.split(/\s+/).filter(Boolean); // "aguja corta" → ["aguja","corta"]: cada término tiene que aparecer (no como una sola cadena)
  const lista = COSTOS_PROD.filter((p) => {
    if (COSTOS_SOLO_VACIOS && p._costo > 0) return false;
    if (!terms.length) return true;
    const hay = [p.nombre, p.marca, p.proveedor, p.precio, p._costo].map((v) => String(v == null ? "" : v).toLowerCase()).join(" ");
    return terms.every((t) => hay.includes(t));
  });
  const totalPag = Math.max(1, Math.ceil(lista.length / COSTOS_POR_PAG));
  if (COSTOS_PAGE >= totalPag) COSTOS_PAGE = totalPag - 1;
  if (COSTOS_PAGE < 0) COSTOS_PAGE = 0;
  const desde = COSTOS_PAGE * COSTOS_POR_PAG;
  const pagina = lista.slice(desde, desde + COSTOS_POR_PAG);
  const pager = totalPag > 1 ? `<div class="cos-pager">
    <button class="btn ghost sm" data-cospag="prev" ${COSTOS_PAGE === 0 ? "disabled" : ""}>← Anterior</button>
    <span class="meta">Página <b>${COSTOS_PAGE + 1}</b> de ${totalPag} · ${lista.length} producto(s) ${q ? "(filtrados)" : ""} · mostrando ${desde + 1}–${desde + pagina.length}</span>
    <button class="btn ghost sm" data-cospag="next" ${COSTOS_PAGE >= totalPag - 1 ? "disabled" : ""}>Siguiente →</button>
  </div>` : "";
  const resEl = $("#cos-resumen"); if (resEl) resEl.innerHTML = `${conCosto.length}/${COSTOS_PROD.length} con costo · se guarda solo ✓ · margen promedio <b>${prom}%</b>`;
  let h = `${pager}
  <div class="fin-table"><table><thead><tr><th>Producto</th><th>Proveedor</th><th>Costo</th><th>Costo s/IVA</th><th>Precio</th><th>Utilidad</th><th>Margen %</th><th>Vencimiento</th></tr></thead><tbody>`;
  for (const p of pagina) {
    const i = COSTOS_PROD.indexOf(p);
    const iva = Number(p.ivaProv) || 21;
    const util = p._costo > 0 ? Math.round(p.precio - p._costo) : "";
    const margen = (p._costo > 0 && p.precio > 0) ? Math.round((p.precio - p._costo) / p.precio * 100) : "";
    const costoSinIva = p._costo > 0 ? Math.round(p._costo / (1 + iva / 100)) : "";
    const ci = (f, v) => `<input type="number" step="0.01" min="0" inputmode="decimal" data-f="${f}" data-i="${i}" value="${v === "" ? "" : v}" placeholder="—" class="cos-input">`;
    h += `<tr><td>${esc(p.nombre)}${p.marca ? ` <span class="cos-marca">${esc(p.marca)}</span>` : ""}</td>
      <td>${p.proveedor ? esc(p.proveedor) : "<span class='meta'>—</span>"}${p.proveedor ? ` <small class="meta">IVA ${iva}%</small>` : ""}</td>
      <td>${ci("costo", p._costo || "")}</td>
      <td>${ci("costoiva", costoSinIva)}</td>
      <td>${ci("precio", p.precio || "")}</td>
      <td>${ci("util", util)}</td>
      <td>${ci("margen", margen)}</td>
      <td>${(() => { let vc = ""; if (p.vencimiento) { const dd = Math.ceil((new Date(p.vencimiento) - new Date(new Date().toISOString().slice(0, 10))) / 86400000); vc = dd < 0 ? "cos-venc-vencido" : dd <= 60 ? "cos-venc-pronto" : ""; } return `<input type="date" data-venc="${i}" value="${p.vencimiento || ""}" class="cos-venc ${vc}">`; })()}</td></tr>`;
  }
  h += `</tbody></table></div>${pager}`;
  const cont = $("#cos-cont"); if (!cont) return;
  cont.innerHTML = h; // solo el contenido; la barra de búsqueda queda intacta (no se pierde el foco)
  cont.querySelectorAll("[data-f]").forEach((inp) => inp.onchange = () => recalcCosto(+inp.dataset.i, inp.dataset.f, inp.value));
  cont.querySelectorAll("[data-venc]").forEach((inp) => inp.onchange = () => {
    inp.value = anio4(inp.value);
    const idx = +inp.dataset.venc, fecha = inp.value || "";
    COSTOS_PROD[idx].vencimiento = fecha;
    guardarVencimiento(COSTOS_PROD[idx].productId, COSTOS_PROD[idx].variationId, COSTOS_PROD[idx].nombre, fecha);
    inp.classList.remove("cos-venc-vencido", "cos-venc-pronto"); // recolorea sin redibujar toda la grilla
    if (fecha) { const dd = Math.ceil((new Date(fecha) - new Date(new Date().toISOString().slice(0, 10))) / 86400000); if (dd < 0) inp.classList.add("cos-venc-vencido"); else if (dd <= 60) inp.classList.add("cos-venc-pronto"); }
  });
  cont.querySelectorAll("[data-cospag]").forEach((b) => b.onclick = () => { COSTOS_PAGE += b.dataset.cospag === "next" ? 1 : -1; drawCostos($("#cos-q") ? $("#cos-q").value : ""); window.scrollTo({ top: 0, behavior: "smooth" }); });
}
async function guardarCostos() {
  const cambios = {};
  COSTOS_PROD.forEach((p) => { if (p._costo > 0) cambios[p.id] = p._costo; });
  try { const r = await (await fetch("/api/admin/costos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cambios }) })).json(); if (r.ok) toast(`Costos guardados (${r.total} productos)`); else toast(r.error || "No se pudo"); } catch { toast("No se pudo guardar"); }
}
const CAJA_CUENTAS = [["efectivo", "💵 Efectivo"], ["banco", "🏦 Banco"], ["mp", "📲 Mercado Pago"], ["nave", "🟣 Nave"], ["naranja", "🟠 Naranja"]];
const CAJA_CATS = ["Mercadería", "Cadetería y Envíos", "Vía Cargo", "Expreso Tokio", "Uber", "Limpieza", "Ingresos Brutos", "AFIP / Impuestos", "Personal", "Personal Eventual", "Bolsas", "Librería", "Web", "Caramelos", "Cheques", "Retiro socios", "Aporte socios", "Varios"];
const CAJA_CATS_IN = ["Ventas", "Intereses", "Aporte socios", "Cobro cta. cte.", "Devolución", "Otro"];
let CAJA_TIPO = "ingreso", CAJA_MES = "", CAJA_MODO = "mes", CAJA_DIA = "";
const cajaLbl = (k) => (CAJA_CUENTAS.find((c) => c[0] === k) || [k, k])[1];
const cajaFec = (s) => (String(s || "").slice(0, 10).split("-").reverse().join("/"));

function renderCaja() {
  const r = FIN_DATA.resumen, saldos = r.saldos || {};
  if (!CAJA_MES) CAJA_MES = new Date().toISOString().slice(0, 7);
  if (!CAJA_DIA) CAJA_DIA = new Date().toISOString().slice(0, 10);
  const card = (lbl, val, cls = "") => `<div class="fin-card ${cls}"><div class="fin-card-val">${fmtAR(val)}</div><div class="fin-card-lbl">${lbl}</div></div>`;
  let h = `<div class="fin-cards">
    ${CAJA_CUENTAS.map(([k, l]) => card(l, saldos[k] || 0)).join("")}
    ${card("💰 Total disponible", r.disponible, "brand")}
    ${r.chequesVencidos ? card("🟠 Cheques vencidos sin pagar", -r.chequesVencidos, "warn") : ""}
    ${r.chequesVencidos ? card("✅ Disponible real", r.disponibleReal, "brand") : ""}
    ${card("🔴 Cheques a cubrir", r.chequesCubrir, "warn")}
    ${r.chequesCobrar ? card("🟢 Cheques a cobrar", r.chequesCobrar) : ""}
    ${r.acredPend ? card("⏳ Por acreditar (tarjetas)", r.acredPend) : ""}
  </div>
  <div class="caja-stats"><span class="caja-in">▲ Ingresos del mes <b>${fmtAR(r.ingresosMes)}</b></span><span class="caja-out">▼ Egresos del mes <b>${fmtAR(r.egresosMes)}</b></span></div>`;

  // --- Alta rápida ---
  const tab = (t, l) => `<button type="button" class="caja-tab ${CAJA_TIPO === t ? "active" : ""}" data-cajatipo="${t}">${l}</button>`;
  const ctaSel = (id, val) => `<select id="${id}">${CAJA_CUENTAS.map(([k, l]) => `<option value="${k}" ${k === val ? "selected" : ""}>${l}</option>`).join("")}</select>`;
  const hoy = new Date().toISOString().slice(0, 10);
  let campos = `<label>Fecha<input type="date" id="cj-fecha" value="${hoy}"></label><label>Monto $<input type="number" id="cj-monto" inputmode="decimal" placeholder="0"></label>`;
  if (CAJA_TIPO === "transferencia") {
    campos += `<div class="caja-wide cj-quick"><button type="button" class="btn ghost sm" data-cjdir="efectivo,banco">💵 → 🏦 Depositar</button><button type="button" class="btn ghost sm" data-cjdir="banco,efectivo">🏦 → 💵 Retirar</button></div><label>Desde${ctaSel("cj-desde", "efectivo")}</label><label>Hacia${ctaSel("cj-hacia", "banco")}</label><label class="caja-wide">Detalle<input type="text" id="cj-det" placeholder="Ej: depósito en banco"></label>`;
  } else {
    campos += `<label>${CAJA_TIPO === "ingreso" ? "Entra a" : "Sale de"}${ctaSel("cj-cuenta", CAJA_TIPO === "ingreso" ? "efectivo" : "banco")}</label>`;
    campos += `<label class="caja-wide">Detalle<input type="text" id="cj-det" placeholder="${CAJA_TIPO === "ingreso" ? "Ej: Pedido 12345 / Aporte" : "Ej: pago a proveedor / sueldo"}"></label>`;
    if (CAJA_TIPO === "egreso") campos += `<label>Categoría<select id="cj-cat">${CAJA_CATS.map((c) => `<option>${c}</option>`).join("")}</select></label>`;
    else if (CAJA_TIPO === "ingreso") campos += `<label>Categoría<select id="cj-cat">${CAJA_CATS_IN.map((c) => `<option>${c}</option>`).join("")}</select></label>`;
  }
  h += `<div class="caja-form">
    <div class="caja-tabs">${tab("ingreso", "▲ Ingreso")}${tab("egreso", "▼ Egreso")}${tab("transferencia", "↔ Transferencia")}</div>
    <div class="caja-form-row">${campos}<button class="btn" id="cj-add">+ Cargar</button></div>
  </div>`;

  // --- Movimientos (filtro por mes o por día) ---
  const enRango = (m) => { const f = (m.fecha || m.creado || "").slice(0, 10); return CAJA_MODO === "dia" ? f === CAJA_DIA : f.slice(0, 7) === CAJA_MES; };
  const movs = (FIN_DATA.movimientos || []).filter((m) => ["ingreso", "egreso", "transferencia"].includes(m.tipo) && enRango(m))
    .sort((a, b) => String(b.fecha || b.creado || "").localeCompare(String(a.fecha || a.creado || "")) || String(b.creado || "").localeCompare(String(a.creado || "")));
  const sumIn = movs.filter((m) => m.tipo === "ingreso").reduce((s, m) => s + (Number(m.monto) || 0), 0);
  const sumOut = movs.filter((m) => m.tipo === "egreso").reduce((s, m) => s + (Number(m.monto) || 0), 0);
  const inputF = CAJA_MODO === "dia" ? `<input type="date" id="cj-dia" value="${CAJA_DIA}">` : `<input type="month" id="cj-mes" value="${CAJA_MES}">`;
  h += `<div class="caja-listhead">
    <div class="caja-seg"><button type="button" class="caja-segb ${CAJA_MODO === "mes" ? "active" : ""}" data-cmodo="mes">Por mes</button><button type="button" class="caja-segb ${CAJA_MODO === "dia" ? "active" : ""}" data-cmodo="dia">Por día</button></div>
    ${inputF}
    <span class="meta">${movs.length} mov · <span class="caja-in">▲${fmtAR(sumIn)}</span> · <span class="caja-out">▼${fmtAR(sumOut)}</span></span>
  </div>`;
  h += `<div class="caja-list">` + (movs.length ? movs.map((m) => {
    const tr = m.tipo === "transferencia";
    const cls = tr ? "tr" : m.tipo;
    const cta = tr ? `${cajaLbl(m.desde)} → ${cajaLbl(m.hacia)}` : cajaLbl(m.cuenta);
    const signo = m.tipo === "ingreso" ? "+" : m.tipo === "egreso" ? "−" : "";
    const det = `${esc(m.detalle || "—")}${m.categoria ? ` <span class="caja-cat">${esc(m.categoria)}</span>` : ""}${m.auto ? ` <span class="caja-auto" title="Generado por cheque/compra">🔗</span>` : ""}`;
    return `<div class="caja-row ${cls}"><span class="caja-fecha">${cajaFec(m.fecha || m.creado)}</span><span class="caja-det">${det}</span><span class="caja-cta">${cta}</span><span class="caja-monto">${signo}${fmtAR(m.monto)}</span><button class="caja-del" data-cajadel="${m.id}" title="Borrar">🗑️</button></div>`;
  }).join("") : '<p class="meta">Sin movimientos este mes. Cargá el primero arriba ⬆️</p>') + `</div>`;
  h += `<p class="meta">Los saldos iniciales de cada cuenta se ajustan en ⚙️ Config. Los cheques al marcarse <b>pagados</b> y las compras <b>pagadas</b> se descuentan solas (🔗).</p>`;

  $("#fin-app").innerHTML = h;
  $("#fin-app").querySelectorAll("[data-cajatipo]").forEach((b) => b.onclick = () => { CAJA_TIPO = b.dataset.cajatipo; renderCaja(); });
  $("#fin-app").querySelectorAll("[data-cmodo]").forEach((b) => b.onclick = () => { CAJA_MODO = b.dataset.cmodo; renderCaja(); });
  const mesEl = $("#cj-mes"); if (mesEl) mesEl.onchange = () => { CAJA_MES = mesEl.value; renderCaja(); };
  const diaEl = $("#cj-dia"); if (diaEl) diaEl.onchange = () => { CAJA_DIA = diaEl.value; renderCaja(); };
  $("#cj-add").onclick = cajaAgregar;
  $("#fin-app").querySelectorAll("[data-cjdir]").forEach((b) => b.onclick = () => { const [d, hh] = b.dataset.cjdir.split(","); if ($("#cj-desde")) $("#cj-desde").value = d; if ($("#cj-hacia")) $("#cj-hacia").value = hh; if ($("#cj-monto")) $("#cj-monto").focus(); });
  $("#fin-app").querySelectorAll("[data-cajadel]").forEach((b) => b.onclick = async () => {
    if (!confirm("¿Borrar este movimiento de la caja?")) return;
    const r2 = await api("/api/admin/finanzas/borrar", { coleccion: "movimientos", id: b.dataset.cajadel });
    if (r2 && r2.ok) cargarFinanzas(); else toast("No se pudo borrar");
  });
}

async function cajaAgregar() {
  const monto = Number($("#cj-monto").value) || 0;
  if (monto <= 0) { toast("Poné un monto"); return; }
  const reg = { tipo: CAJA_TIPO, monto, fecha: $("#cj-fecha").value || new Date().toISOString().slice(0, 10), detalle: ($("#cj-det").value || "").trim() };
  if (CAJA_TIPO === "transferencia") {
    reg.desde = $("#cj-desde").value; reg.hacia = $("#cj-hacia").value;
    if (reg.desde === reg.hacia) { toast("Elegí cuentas distintas"); return; }
  } else {
    reg.cuenta = $("#cj-cuenta").value;
    if ($("#cj-cat")) reg.categoria = $("#cj-cat").value;
  }
  const r = await api("/api/admin/finanzas/agregar", { coleccion: "movimientos", registro: reg });
  if (r && r.ok) { toast("Movimiento cargado"); cargarFinanzas(); } else toast((r && r.error) || "No se pudo");
}
function finEstadoSelect(sec, r) {
  const campo = FIN_DEF[sec].campos.find((c) => c.k === "estado");
  if (!campo) return esc(r.estado || "");
  const ops = (campo.op.includes(r.estado) || !r.estado) ? campo.op : [r.estado, ...campo.op]; // conserva estados custom (ej. ACTIVO/CUSTODIA)
  return `<select data-estado="${r.id}" class="fin-estado">${ops.map((o) => `<option ${o === r.estado ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
}
// Seguimiento de envíos Via Cargo: proveedor + N° de guía con link directo al rastreo. Al marcar "Llegó", desaparece.
let ENV_EDIT = null;
function renderEnvios() {
  const cont = $("#fin-app");
  const regs = (FIN_DATA.envios || []).filter((e) => e.estado !== "llegado");
  cont.innerHTML = `
    <div class="fin-form">
      <label>Proveedor<input id="env-prov" placeholder="Proveedor"></label>
      <label>N° de guía (Via Cargo)<input id="env-num" placeholder="Ej: 999032390443" inputmode="numeric"></label>
      <label>Total $<input id="env-total" placeholder="0" inputmode="numeric"></label>
      <button class="btn" id="env-add">+ Agregar seguimiento</button>
    </div>
    <p class="meta">Cargá tus envíos de <b>Via Cargo</b>. Editá con ✎ para cargar lo que pagaste. Al marcar <b>"✓ Llegó"</b>, elegí <b>Efectivo</b> o <b>Transferencia</b> y se registra el egreso en la Caja.</p>
    <div class="env-list">${regs.length ? regs.map((e) => {
      const num = String(e.numero || "").replace(/\D/g, "");
      if (e.id === ENV_EDIT) return `<div class="env-card env-editing">
        <input class="ev-f" data-ef="proveedor" value="${esc(e.proveedor || "")}" placeholder="Proveedor">
        <input class="ev-f" data-ef="numero" value="${esc(e.numero || "")}" placeholder="N° guía" inputmode="numeric">
        <input class="ev-f" data-ef="total" value="${e.total || ""}" placeholder="Total $" inputmode="numeric" style="width:120px">
        <button class="btn sm" data-ev-save="${e.id}">💾 Guardar</button><button class="btn ghost sm" data-ev-cancel="1">Cancelar</button>
      </div>`;
      return `<div class="env-card">
        <div class="env-info"><strong>${esc(e.proveedor || "—")}</strong><span class="env-num">Guía: ${esc(e.numero || "")}${e.total ? " · 💲 " + fmtAR(e.total) : " · sin total"}</span></div>
        <div class="env-acc">
          <a class="btn sm env-ver" href="https://viacargo.com.ar/seguimiento-de-envio/${num}/" target="_blank" rel="noopener">🔍 Via Cargo ↗</a>
          <select class="env-medio" data-em="${e.id}"><option value="efectivo">Efectivo</option><option value="banco">Transferencia</option></select>
          <button class="btn sm" data-env-ok="${e.id}">✓ Llegó</button>
          <button class="btn ghost sm" data-env-edit="${e.id}" title="Editar">✎</button>
          <button class="fin-del" data-env-del="${e.id}" title="Borrar">✕</button>
        </div>
      </div>`;
    }).join("") : '<p class="meta" style="padding:14px">No hay envíos en seguimiento.</p>'}</div>`;
  $("#env-add").onclick = async () => {
    const proveedor = $("#env-prov").value.trim(), numero = $("#env-num").value.trim(), total = Math.round(Number($("#env-total").value) || 0);
    if (!proveedor || !numero) return toast("Poné proveedor y N° de guía");
    const r = await api("/api/admin/finanzas/agregar", { coleccion: "envios", registro: { proveedor, numero, total, estado: "pendiente", creado: new Date().toISOString() } });
    if (r && r.ok) { toast("📍 Seguimiento agregado"); await cargarFinanzas(); } else toast((r && r.error) || "No se pudo");
  };
  cont.querySelectorAll("[data-env-edit]").forEach((b) => b.onclick = () => { ENV_EDIT = b.dataset.envEdit; renderEnvios(); });
  cont.querySelectorAll("[data-ev-cancel]").forEach((b) => b.onclick = () => { ENV_EDIT = null; renderEnvios(); });
  cont.querySelectorAll("[data-ev-save]").forEach((b) => b.onclick = async () => {
    const card = b.closest(".env-card"), cambios = {};
    card.querySelectorAll(".ev-f").forEach((el) => { const k = el.dataset.ef; cambios[k] = k === "total" ? Math.round(Number(el.value) || 0) : el.value.trim(); });
    const r = await api("/api/admin/finanzas/actualizar", { coleccion: "envios", id: b.dataset.evSave, cambios });
    ENV_EDIT = null;
    if (r && r.ok) { toast("✅ Actualizado"); cargarFinanzas(); } else { toast((r && r.error) || "No se pudo"); renderEnvios(); }
  });
  cont.querySelectorAll("[data-env-ok]").forEach((b) => b.onclick = async () => {
    const e = (FIN_DATA.envios || []).find((x) => x.id === b.dataset.envOk); if (!e) return;
    const medio = (cont.querySelector(`.env-medio[data-em="${e.id}"]`) || {}).value || "efectivo";
    const total = Number(e.total) || 0, ctaTxt = medio === "efectivo" ? "Efectivo" : "Banco (transferencia)";
    if (!confirm(total > 0 ? `¿Marcar "${e.proveedor || ""}" como llegado y registrar el egreso de ${fmtAR(total)} en ${ctaTxt}?` : "¿Marcar como llegado? (sin total cargado, no impacta en la Caja)")) return;
    if (total > 0) await api("/api/admin/finanzas/agregar", { coleccion: "movimientos", registro: { tipo: "egreso", cuenta: medio, monto: total, categoria: "Vía Cargo", detalle: `Vía Cargo · ${e.proveedor || ""} · guía ${e.numero || ""}`.trim(), fecha: new Date().toISOString().slice(0, 10), ref: "envio:" + e.id } });
    await api("/api/admin/finanzas/actualizar", { coleccion: "envios", id: e.id, cambios: { estado: "llegado", medio_pago: medio } });
    toast(total > 0 ? "✓ Llegó · egreso en Caja" : "✓ Llegó"); await cargarFinanzas();
  });
  cont.querySelectorAll("[data-env-del]").forEach((b) => b.onclick = async () => {
    if (!confirm("¿Borrar este seguimiento?")) return;
    await api("/api/admin/finanzas/borrar", { coleccion: "envios", id: b.dataset.envDel });
    await cargarFinanzas();
  });
}
const COL_LBL = { fecha_emision: "Emisión", vencimiento: "Cobro", tercero: "Cliente / Proveedor", numero: "N°", monto: "Monto", con_imp: "Con imp.", monto_con_impuestos: "Con imp." };
let COMPRAS_SEL = new Set(); // ids de compras seleccionadas para pagar con cheques
function actualizarCmpBar() {
  const bar = $("#cmp-bar"); if (!bar) return;
  const sel = [...document.querySelectorAll(".cmp-sel:checked")].map((c) => ({ id: c.dataset.id, prov: c.dataset.prov, monto: Number(c.dataset.monto) || 0 }));
  if (!sel.length) { bar.innerHTML = ""; return; }
  const provs = [...new Set(sel.map((s) => s.prov))];
  if (provs.length > 1) { bar.innerHTML = `<div class="cmp-bar-in warn">⚠️ Elegí facturas de un <b>mismo proveedor</b> (tenés ${provs.length} distintos seleccionados).</div>`; return; }
  const total = sel.reduce((s, x) => s + x.monto, 0);
  bar.innerHTML = `<div class="cmp-bar-in"><span><b>${sel.length}</b> factura(s) de <b>${esc(provs[0] || "—")}</b> · Total <b>${fmtAR(total)}</b></span> <button class="btn" id="cmp-pagar">💳 Pagar con cheques</button></div>`;
  $("#cmp-pagar").onclick = () => abrirPagoCheques(sel.map((s) => s.id), provs[0], total);
}
function abrirPagoCheques(compraIds, proveedor, total) {
  const hoy = new Date().toISOString().slice(0, 10);
  const prov = (FIN_DATA.proveedores || []).find((p) => p.nombre === proveedor);
  let PCH = [];
  const addDays = (s, d) => { const x = new Date((s || hoy) + "T00:00:00"); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); };
  const regen = (n, start) => { n = Math.max(1, Math.min(12, Math.floor(n) || 1)); const base = Math.floor(total / n); PCH = []; for (let i = 0; i < n; i++) PCH.push({ monto: i === n - 1 ? Math.round(total) - base * (n - 1) : base, fecha: addDays(start, 30 * (i + 1)) }); };
  regen(2, hoy);
  openModal("💳 Pagar con cheques", `
    <p>Pagás <b>${compraIds.length}</b> factura(s) de <b>${esc(proveedor || "—")}</b> · Total <b>${fmtAR(total)}</b></p>
    <div class="pch-cfg">
      <label>Cheques <input type="number" id="pch-n" min="1" max="12" value="2" style="width:60px"></label>
      <label>1° vencimiento <input type="date" id="pch-fecha" value="${hoy}"></label>
      <span class="meta">cada uno +30 días</span>
    </div>
    <div id="pch-lista"></div>
    <div id="pch-sum" class="meta" style="margin:6px 0"></div>
    <button class="btn" id="pch-ok">✓ Marcar pagadas y crear cheques en cartera</button> <span class="meta" id="pch-msg"></span>
    <p class="meta" style="margin-top:8px">Los cheques se crean <b>sin número</b> (lo completás cuando los emitís). El banco se descuenta recién cuando los marcás cobrados/pagados.</p>`);
  const pintar = () => {
    const lista = $("#pch-lista"); if (!lista) return;
    lista.innerHTML = PCH.map((c, i) => `<div class="pch-row"><span>Cheque ${i + 1}</span> $<input type="number" class="pch-m" data-i="${i}" value="${c.monto}"> <input type="date" class="pch-f" data-i="${i}" value="${c.fecha}"></div>`).join("");
    const suma = PCH.reduce((s, c) => s + (Number(c.monto) || 0), 0);
    const sm = $("#pch-sum"); if (sm) sm.innerHTML = `Suma de cheques: <b>${fmtAR(suma)}</b> ${suma === Math.round(total) ? "✓ coincide" : `<span style="color:#b91c1c">≠ total ${fmtAR(total)}</span>`}`;
    lista.querySelectorAll(".pch-m").forEach((inp) => inp.onchange = () => { PCH[+inp.dataset.i].monto = Math.round(Number(inp.value) || 0); pintar(); });
    lista.querySelectorAll(".pch-f").forEach((inp) => inp.onchange = () => { PCH[+inp.dataset.i].fecha = inp.value; });
  };
  $("#pch-n").oninput = () => { regen($("#pch-n").value, $("#pch-fecha").value); pintar(); };
  $("#pch-fecha").onchange = () => { regen($("#pch-n").value, $("#pch-fecha").value); pintar(); };
  pintar();
  $("#pch-ok").onclick = async () => {
    const suma = PCH.reduce((s, c) => s + (Number(c.monto) || 0), 0);
    if (Math.abs(suma - Math.round(total)) > 1 && !confirm(`La suma de los cheques (${fmtAR(suma)}) no coincide con el total (${fmtAR(total)}). ¿Continuar igual?`)) return;
    if (PCH.some((c) => !c.fecha)) { $("#pch-msg").textContent = "Poné la fecha de cada cheque"; return; }
    const btn = $("#pch-ok"); btn.disabled = true; $("#pch-msg").textContent = "Creando…";
    const r = await api("/api/admin/compras/pagar-cheques", { compraIds, proveedor, cuit: prov ? prov.cuit : "", cheques: PCH });
    if (r && r.ok) { toast(`✓ ${r.compras} compra(s) pagada(s) · ${r.cheques} cheque(s) en cartera`); COMPRAS_SEL.clear(); closeModal(); cargarFinanzas(); }
    else { btn.disabled = false; $("#pch-msg").textContent = (r && r.error) || "No se pudo"; }
  };
}
function verDetalleCompra(id) {
  const c = (FIN_DATA.compras || []).find((x) => x.id === id);
  if (!c || !c.detalle || !c.detalle.length) return toast("Esta compra no tiene detalle guardado");
  const rows = c.detalle.map((it) => `<tr><td>${esc(it.nombre || "—")}</td><td class="meta">${esc(it.codigo || "")}</td><td style="text-align:center">${it.cantidad || 0}</td><td style="text-align:right">${it.precio_unit != null ? fmtAR(it.precio_unit) : "—"}</td><td style="text-align:right">${it.costo != null ? fmtAR(it.costo) : "—"}</td></tr>`).join("");
  const fec = (c.fecha || "").slice(0, 10).split("-").reverse().join("/");
  openModal(`📦 Detalle compra — ${esc(c.proveedor || "—")}${fec ? " · " + fec : ""}`, `
    <div class="fin-table"><table><thead><tr><th>Producto</th><th>Cód</th><th>Cant</th><th>P. unit</th><th>Costo</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p class="meta" style="margin-top:8px">Total compra: <b>${fmtAR(c.monto)}</b> · ${c.detalle.length} ítem(s)</p>`);
}
function renderFinLista(sec) {
  const def = FIN_DEF[sec];
  let regs = FIN_DATA[sec] || [];
  if (sec === "cheques") {
    regs = [...regs].sort((a, b) => {
      const ca = String(a.estado || "").toLowerCase() === "cubierto" ? 1 : 0, cb = String(b.estado || "").toLowerCase() === "cubierto" ? 1 : 0;
      if (ca !== cb) return ca - cb; // los "cubierto" van al final, hasta que pasen a cobrado
      return String(a[FIN_CHEQUE_SORT] || "").localeCompare(String(b[FIN_CHEQUE_SORT] || ""));
    });
    if (!FIN_CHEQUE_VERPAG) regs = regs.filter((c) => !["pagado", "cobrado", "rechazado"].includes(c.estado)); // por defecto oculta los ya cobrados/pagados (los "cubierto" SÍ se ven)
    const f = FIN_CHEQUE_FILT;
    if (f.tercero) regs = regs.filter((c) => String(c.tercero || "").toLowerCase().includes(f.tercero.toLowerCase()));
    if (f.estado) regs = regs.filter((c) => String(c.estado || "") === f.estado);
    if (f.desde) regs = regs.filter((c) => String(c.vencimiento || "").slice(0, 10) >= f.desde);
    if (f.hasta) regs = regs.filter((c) => String(c.vencimiento || "").slice(0, 10) <= f.hasta);
  }
  const plats = (FIN_DATA.config.plataformas || []).map((p) => p.nombre);
  const campo = (c, val) => {
    const v = val == null ? "" : val;
    if (c.t === "select") { const ops = (c.op.includes(v) || !v) ? c.op : [v, ...c.op]; return `<select data-f="${c.k}">${ops.map((o) => `<option ${o === v ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`; }
    if (c.t === "platform") return `<select data-f="${c.k}">${plats.map((o) => `<option ${o === v ? "selected" : ""}>${esc(o)}</option>`).join("")}</select>`;
    if (c.t === "date") return `<input type="date" data-f="${c.k}" value="${esc(String(v).slice(0, 10))}">`;
    if (c.t === "check") return `<label class="fin-chk-in"><input type="checkbox" data-f="${c.k}" ${v ? "checked" : ""}> ${esc(c.lbl)}</label>`;
    if (c.t === "num") return `<input type="number" step="0.01" data-f="${c.k}" value="${v === "" ? "" : esc(String(v))}" placeholder="0">`;
    return `<input type="text" data-f="${c.k}" value="${esc(String(v))}" placeholder="${esc(c.lbl)}">`;
  };
  let h = `<div class="fin-form">${def.campos.map((c) => `<label>${esc(c.lbl)}${campo(c)}</label>`).join("")}<button class="btn" id="fin-add">+ Agregar</button>${sec === "cheques" ? `<label>Ordenar por<select id="fin-sort"><option value="vencimiento">Fecha de cobro</option><option value="fecha_emision">Fecha de emisión</option></select></label><label class="chk"><input type="checkbox" id="fin-verpag"> Ver pagados</label><button class="btn ghost" type="button" id="fin-print-cheques">🖨️ Imprimir cheques a cubrir</button>` : ""}</div>`;
  if (sec === "cheques") {
    const ests = ["", "activo", "en cartera", "depositado", "cubierto", "cobrado", "pagado", "rechazado"];
    h += `<div class="fin-form fch-filtros"><span class="fch-filt-t">🔎 Filtrar:</span>
      <label>Proveedor/Cliente<input type="text" id="fch-f-terc" value="${esc(FIN_CHEQUE_FILT.tercero)}" placeholder="nombre…"></label>
      <label>Estado<select id="fch-f-estado">${ests.map((o) => `<option value="${o}" ${o === FIN_CHEQUE_FILT.estado ? "selected" : ""}>${o || "todos"}</option>`).join("")}</select></label>
      <label>Cobro desde<input type="date" id="fch-f-desde" value="${esc(FIN_CHEQUE_FILT.desde)}"></label>
      <label>hasta<input type="date" id="fch-f-hasta" value="${esc(FIN_CHEQUE_FILT.hasta)}"></label>
      <button class="btn ghost sm" type="button" id="fch-f-limpiar">Limpiar</button></div>`;
    const r = FIN_DATA.resumen || {};
    const aCubrir = Number(r.chequesCubrir) || 0, aCobrar = Number(r.chequesCobrar) || 0;
    const disp = (Number(r.disponible) || 0) + aCobrar + (Number(r.acredPend) || 0);
    const falta = Math.max(0, aCubrir - disp);
    h += `<div class="fch-stats">
      <div class="fch-stat out">🔴 A cubrir (emitidos)<b>${fmtAR(aCubrir)}</b></div>
      <div class="fch-stat in">🟢 A cobrar (recibidos)<b>${fmtAR(aCobrar)}</b></div>
      <div class="fch-stat disp">💰 Disponible total<b>${fmtAR(disp)}</b></div>
      <div class="fch-stat ${falta > 0 ? "falta" : "ok"}">${falta > 0 ? "⚠️ Falta vender" : "✅ Alcanza"}<b>${fmtAR(falta)}</b></div>
    </div>
    <p class="meta">Disponible = efectivo + banco + MP/Nave/Naranja + cheques a cobrar + lo que está por acreditarse. <b>Falta vender</b> = lo que necesitás juntar para cubrir los cheques emitidos.</p>`;
  }
  h += `<div class="fin-table"><table><thead><tr>${sec === "compras" ? "<th></th>" : ""}${def.cols.map((c) => `<th>${esc(COL_LBL[c] || c.replace(/_/g, " "))}</th>`).join("")}<th></th></tr></thead><tbody>`;
  for (const r of regs) {
    if (r.id === FIN_EDIT) {
      h += "<tr class='fin-edit-row'>" + (sec === "compras" ? "<td></td>" : "") + def.cols.map((c) => { const cmp = def.campos.find((x) => x.k === c); return `<td>${cmp ? campo(cmp, r[c]) : esc(String(r[c] == null ? "" : r[c]))}</td>`; }).join("") + `<td class="fin-acc"><button class="btn sm" data-edsave="${r.id}">💾</button><button class="fin-del" data-edcancel="1" title="Cancelar">✕</button></td></tr>`;
      continue;
    }
    const esCubierto = sec === "cheques" && String(r.estado || "").toLowerCase() === "cubierto";
    const esHoy = sec === "cheques" && !esCubierto && String(r.vencimiento || "").slice(0, 10) === new Date().toISOString().slice(0, 10) && !["pagado", "cobrado", "rechazado"].includes(String(r.estado || "").toLowerCase());
    h += `<tr class="${esHoy ? "fin-row-hoy" : ""}${esCubierto ? "fin-row-cubierto" : ""}">` + (sec === "compras" ? `<td><input type="checkbox" class="cmp-sel" data-id="${r.id}" data-prov="${esc(r.proveedor || "")}" data-monto="${Number(r.monto) || 0}" ${COMPRAS_SEL.has(r.id) ? "checked" : ""}></td>` : "") + def.cols.map((c) => {
      if (c === "estado") return `<td>${finEstadoSelect(sec, r)}</td>`;
      if (c === "sin_caja") return `<td title="Pagada antes de empezar a registrar: no descuenta de la caja">${r.sin_caja ? "✓ sin caja" : "—"}</td>`;
      if (c === "con_imp") { const pct = Number(FIN_DATA.config.impuesto_cheque) || 0; return `<td title="Monto + ${pct}% de impuesto al cheque">${fmtAR((Number(r.monto) || 0) * (1 + pct / 100))}</td>`; }
      let v = r[c];
      if (FIN_MONEY.has(c)) v = fmtAR(v || 0);
      else if (c === "cargo_pct") v = (r[c] || 0) + "%";
      else if (c === "fecha_emision" || c === "vencimiento") v = v ? String(v).slice(0, 10).split("-").reverse().join("/") : "—";
      return `<td>${esc(String(v == null ? "" : v))}</td>`;
    }).join("") + `<td class="fin-acc">${sec === "cheques" ? waBtn("", waMsgChequeVenc(r), "📱") : ""}${sec === "compras" && r.detalle && r.detalle.length ? `<button class="fin-edit" data-detalle="${r.id}" title="Ver detalle de la compra">👁️</button>` : ""}<button class="fin-edit" data-edit="${r.id}" title="Editar">✎</button><button class="fin-del" data-del="${r.id}" title="Borrar">✕</button></td></tr>`;
  }
  h += `</tbody></table>${regs.length ? "" : '<p class="meta" style="padding:14px">Sin registros todavía.</p>'}</div>${sec === "compras" ? '<div id="cmp-bar" class="cmp-bar"></div>' : ""}`;
  $("#fin-app").innerHTML = h;
  if (sec === "compras") {
    $("#fin-app").querySelectorAll(".cmp-sel").forEach((c) => c.onchange = () => { if (c.checked) COMPRAS_SEL.add(c.dataset.id); else COMPRAS_SEL.delete(c.dataset.id); actualizarCmpBar(); });
    $("#fin-app").querySelectorAll("[data-detalle]").forEach((b) => b.onclick = () => verDetalleCompra(b.dataset.detalle));
    actualizarCmpBar();
  }
  $("#fin-add").onclick = () => finAgregar(sec);
  const pc = $("#fin-print-cheques"); if (pc) pc.onclick = imprimirCheques;
  const fs = $("#fin-sort"); if (fs) { fs.value = FIN_CHEQUE_SORT; fs.onchange = () => { FIN_CHEQUE_SORT = fs.value; renderFin(); }; }
  const vp = $("#fin-verpag"); if (vp) { vp.checked = FIN_CHEQUE_VERPAG; vp.onchange = () => { FIN_CHEQUE_VERPAG = vp.checked; renderFin(); }; }
  { // filtros de cheques (proveedor, estado, fecha de cobro)
    const ft = $("#fch-f-terc"); if (ft) ft.oninput = () => { FIN_CHEQUE_FILT.tercero = ft.value; renderFin(); const n = $("#fch-f-terc"); if (n) { n.focus(); n.setSelectionRange(ft.value.length, ft.value.length); } };
    const fe = $("#fch-f-estado"); if (fe) fe.onchange = () => { FIN_CHEQUE_FILT.estado = fe.value; renderFin(); };
    const fd = $("#fch-f-desde"); if (fd) fd.onchange = () => { FIN_CHEQUE_FILT.desde = fd.value; renderFin(); };
    const fh = $("#fch-f-hasta"); if (fh) fh.onchange = () => { FIN_CHEQUE_FILT.hasta = fh.value; renderFin(); };
    const fl = $("#fch-f-limpiar"); if (fl) fl.onclick = () => { FIN_CHEQUE_FILT = { tercero: "", estado: "", desde: "", hasta: "" }; renderFin(); };
  }
  $("#fin-app").querySelectorAll("[data-edit]").forEach((b) => b.onclick = () => { FIN_EDIT = b.dataset.edit; renderFin(); });
  $("#fin-app").querySelectorAll("[data-edcancel]").forEach((b) => b.onclick = () => { FIN_EDIT = null; renderFin(); });
  $("#fin-app").querySelectorAll("[data-edsave]").forEach((b) => b.onclick = async () => {
    const row = b.closest("tr"); const cambios = {};
    row.querySelectorAll("[data-f]").forEach((el) => { cambios[el.dataset.f] = el.type === "checkbox" ? el.checked : el.type === "number" ? (el.value === "" ? null : Number(el.value)) : el.value; });
    const r = await api("/api/admin/finanzas/actualizar", { coleccion: sec, id: b.dataset.edsave, cambios });
    FIN_EDIT = null;
    if (r && r.ok) await cargarFinanzas(); else { toast((r && r.error) || "No se pudo guardar"); renderFin(); }
  });
  $("#fin-app").querySelectorAll("[data-del]").forEach((b) => b.onclick = () => finBorrar(sec, b.dataset.del));
  $("#fin-app").querySelectorAll("[data-estado]").forEach((s) => s.onchange = () => finActualizar(sec, s.dataset.estado, { estado: s.value }));
}
// Reporte imprimible de cheques a cubrir (emitidos sin pagar), A4 horizontal con cabecera de marca.
function imprimirCheques() {
  const regs = (FIN_DATA.cheques || []).filter((c) => c.tipo === "emitido" && !["pagado", "rechazado", "cobrado"].includes(c.estado))
    .sort((a, b) => (a.vencimiento || "").localeCompare(b.vencimiento || ""));
  if (!regs.length) return toast("No hay cheques a cubrir");
  const fmt = (n) => "$" + Number(n || 0).toLocaleString("es-AR", { minimumFractionDigits: 2 });
  const fdmy = (s) => (s || "").slice(0, 10).split("-").reverse().join("/");
  const pct = Number(FIN_DATA.config.impuesto_cheque) || 0, conImp = (c) => (Number(c.monto) || 0) * (1 + pct / 100);
  const totM = regs.reduce((s, c) => s + (Number(c.monto) || 0), 0);
  const totI = regs.reduce((s, c) => s + conImp(c), 0);
  const filas = regs.map((c) => `<tr><td>${fdmy(c.vencimiento)}</td><td>${esc(c.numero || "")}</td><td class="r">${fmt(c.monto)}</td><td class="r">${fmt(conImp(c))}</td><td>${esc(c.cuit || "")}</td><td>${esc(c.tercero || "")}</td><td>${esc(c.estado || "")}</td></tr>`).join("");
  const w = window.open("", "_blank");
  if (!w) return toast("Permití las ventanas emergentes para imprimir");
  w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title> </title><style>
    @page{size:A4 landscape;margin:11mm}
    *{box-sizing:border-box;font-family:'Helvetica Neue',Arial,sans-serif;color:#2a1622;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    body{margin:0}
    .head{display:flex;align-items:center;gap:14px;border-bottom:3px solid #DE3667;padding-bottom:12px;margin-bottom:16px}
    .head img{height:54px}
    .head h1{font-size:23px;color:#7a1040;margin:0}
    .head .meta{margin-left:auto;text-align:right;color:#9a8a93;font-size:12px}
    table{width:100%;border-collapse:collapse;font-size:13px}
    th{background:#fff0f7;text-align:left;padding:9px 11px;border-bottom:2px solid #DE3667;font-size:11px;text-transform:uppercase;letter-spacing:.04em;color:#7a1040}
    td{padding:8px 11px;border-bottom:1px solid #f0dbe7}
    td.r,th.r{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
    tr:nth-child(even) td{background:#fff9fc}
    tfoot td{font-weight:800;border-top:2px solid #DE3667;background:#fff7fb;font-size:14px}
  </style></head><body>
    <div class="head"><img src="/assets/logo.png" onerror="this.style.display='none'"><h1>🏦 Cheques a cubrir</h1><div class="meta"><b>El Pasaje Dental</b><br>${regs.length} cheque(s)</div></div>
    <table><thead><tr><th>Fecha</th><th>N° cheque</th><th class="r">Monto</th><th class="r">Con impuesto</th><th>CUIT</th><th>Proveedor</th><th>Estado</th></tr></thead>
    <tbody>${filas}</tbody>
    <tfoot><tr><td colspan="2">TOTAL · ${regs.length} cheques</td><td class="r">${fmt(totM)}</td><td class="r">${fmt(totI)}</td><td colspan="3"></td></tr></tfoot></table>
    <script>window.onload=function(){setTimeout(function(){window.print()},350)}<\/script>
  </body></html>`);
  w.document.close();
}
async function finAgregar(sec) {
  const reg = {};
  $("#fin-app").querySelectorAll(".fin-form [data-f]").forEach((el) => { reg[el.dataset.f] = el.type === "checkbox" ? el.checked : el.type === "number" ? Number(el.value) : el.value; });
  const monto = reg.bruto != null ? reg.bruto : reg.monto;
  if (!(Number(monto) > 0)) return toast("Poné un monto válido");
  const r = await (await fetch("/api/admin/finanzas/agregar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ coleccion: sec, registro: reg }) })).json();
  if (r.ok) { toast("Agregado"); await cargarFinanzas(); } else toast(r.error || "No se pudo agregar");
}
async function finBorrar(sec, id) {
  if (!confirm("¿Borrar este registro?")) return;
  const r = await (await fetch("/api/admin/finanzas/borrar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ coleccion: sec, id }) })).json();
  if (r.ok) await cargarFinanzas(); else toast(r.error || "No se pudo");
}
async function finActualizar(sec, id, cambios) {
  const r = await (await fetch("/api/admin/finanzas/actualizar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ coleccion: sec, id, cambios }) })).json();
  if (r.ok) await cargarFinanzas(); else toast(r.error || "No se pudo");
}
function renderFinConfig() {
  const c = FIN_DATA.config;
  $("#fin-app").innerHTML = `<div class="fin-cfg">
    <h3>Saldos iniciales de cada cuenta</h3>
    <p class="meta">Punto de partida. La Caja le suma/resta los movimientos del libro diario.</p>
    <div class="fin-cfg-row"><label>💵 Efectivo $ <input type="number" id="cfg-ef" value="${c.saldo_efectivo || 0}"></label>
    <label>🏦 Banco $ <input type="number" id="cfg-bk" value="${c.saldo_banco || 0}"></label></div>
    <div class="fin-cfg-row"><label>📲 Mercado Pago $ <input type="number" id="cfg-mp" value="${c.saldo_mp || 0}"></label>
    <label>🟣 Nave $ <input type="number" id="cfg-nave" value="${c.saldo_nave || 0}"></label>
    <label>🟠 Naranja $ <input type="number" id="cfg-naranja" value="${c.saldo_naranja || 0}"></label></div>
    <h3>Impuesto al cheque</h3>
    <label>% <input type="number" step="0.01" id="cfg-imp" value="${c.impuesto_cheque || 0}"></label>
    <h3>Plataformas — cargo % y días de acreditación</h3>
    <div class="fin-plats">${(c.plataformas || []).map((p, i) => `<div class="fin-plat"><span>${esc(p.nombre)}</span><input type="number" step="0.01" data-pc="${i}" value="${p.cargo_pct || 0}" title="cargo %"><span class="u">%</span><input type="number" data-pd="${i}" value="${p.dias || 0}" title="días"><span class="u">días</span></div>`).join("")}</div>
    <button class="btn" id="cfg-save">💾 Guardar configuración</button> <span class="meta" id="cfg-msg2"></span>
  </div>`;
  $("#cfg-save").onclick = async () => {
    const plataformas = (c.plataformas || []).map((p, i) => ({ nombre: p.nombre, cargo_pct: Number($(`[data-pc="${i}"]`).value) || 0, dias: Number($(`[data-pd="${i}"]`).value) || 0 }));
    const config = { saldo_efectivo: Number($("#cfg-ef").value) || 0, saldo_banco: Number($("#cfg-bk").value) || 0, saldo_mp: Number($("#cfg-mp").value) || 0, saldo_nave: Number($("#cfg-nave").value) || 0, saldo_naranja: Number($("#cfg-naranja").value) || 0, impuesto_cheque: Number($("#cfg-imp").value) || 0, plataformas };
    const r = await (await fetch("/api/admin/finanzas/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config }) })).json();
    if (r.ok) { $("#cfg-msg2").textContent = "Guardado ✓"; toast("Configuración guardada"); await cargarFinanzas(); } else $("#cfg-msg2").textContent = r.error || "Error";
  };
}

// ----- Ajustes del negocio -----
async function cargarAjustes() {
  cargarPromoAjustes();
  try {
    const a = await (await fetch("/api/admin/ajustes")).json();
    $("#aj-recargo").value = a.recargo_otros != null ? a.recargo_otros : 10;
    $("#aj-tuc-fijo").value = a.envio_tuc_fijo || 0;
    $("#aj-tuc-gratis").value = a.envio_tuc_gratis_desde || 0;
    if ($("#aj-venc-dias")) $("#aj-venc-dias").value = a.venc_dias_aviso || 60;
    const f = a.afip || {};
    AJ_EMISORES = Array.isArray(f.emisores) && f.emisores.length ? f.emisores.map((e) => ({ ...e })) : (f.cuit ? [{ cuit: f.cuit, razon: f.razon, punto_venta: f.punto_venta, condicion_iva: f.condicion_iva || "monotributo" }] : []);
    $("#aj-amb").value = f.ambiente || "produccion";
    renderEmisores();
  } catch {}
  cargarDescEstado();
  const dg = $("#desc-generar"); if (dg) dg.onclick = generarDescripcionesIA;
}
async function cargarDescEstado() {
  const el = $("#desc-estado"); if (!el) return;
  try {
    const d = await (await fetch("/api/admin/descripciones/estado")).json();
    if (d.error) { el.textContent = d.error; return; }
    el.textContent = d.faltan > 0
      ? `Hay ${d.faltan} de ${d.total} productos sin descripción. ${d.generadas ? "Ya generadas con IA: " + d.generadas + "." : ""}`
      : `✅ Todos los productos tienen descripción${d.generadas ? " (" + d.generadas + " generadas con IA)" : ""}.`;
    const dg = $("#desc-generar"); if (dg) dg.style.display = d.faltan > 0 ? "" : "none";
  } catch {}
}
async function generarDescripcionesIA() {
  const btn = $("#desc-generar"), prog = $("#desc-progreso");
  if (!confirm("Voy a generar las descripciones faltantes con IA. Puede tardar unos minutos. ¿Seguimos?")) return;
  btn.disabled = true; let total = 0;
  while (true) {
    let r;
    try { r = await api("/api/admin/descripciones/generar", { limite: 10 }); } catch { prog.textContent = "Se cortó la conexión, reintentá."; break; }
    if (r.error) { prog.textContent = "Error: " + r.error; break; }
    total += r.generadas || 0;
    prog.textContent = `Generadas ${total}… faltan ${r.restantes}`;
    if (!r.restantes || !r.generadas) { prog.textContent = `✅ Listo. ${total} descripciones generadas.`; break; }
  }
  btn.disabled = false; cargarDescEstado();
}
let AJ_EMISORES = [];
function renderEmisores() {
  const c = $("#aj-emisores"); if (!c) return;
  c.innerHTML = AJ_EMISORES.map((e, i) => `<div class="aj-emisor">
    <input data-em="razon" data-i="${i}" value="${esc(e.razon || "")}" placeholder="Razón social / Nombre">
    <input data-em="cuit" data-i="${i}" value="${esc(e.cuit || "")}" placeholder="CUIT" inputmode="numeric">
    <input data-em="punto_venta" data-i="${i}" value="${e.punto_venta || 1}" type="number" min="1" placeholder="PV" style="width:70px">
    <button type="button" class="aj-em-del" data-i="${i}" title="Quitar">✕</button>
  </div>`).join("") || '<p class="meta">Sin emisores. Agregá uno.</p>';
  c.querySelectorAll("[data-em]").forEach((inp) => inp.onchange = () => { const e = AJ_EMISORES[+inp.dataset.i]; e[inp.dataset.em] = inp.dataset.em === "punto_venta" ? Number(inp.value) : inp.value.trim(); });
  c.querySelectorAll(".aj-em-del").forEach((b) => b.onclick = () => { AJ_EMISORES.splice(+b.dataset.i, 1); renderEmisores(); });
}
{ const b = $("#aj-add-emisor"); if (b) b.onclick = () => { AJ_EMISORES.push({ cuit: "", razon: "", punto_venta: 1, condicion_iva: "monotributo" }); renderEmisores(); }; }
{
  const b = $("#aj-guardar");
  if (b) b.onclick = async () => {
    b.disabled = true; $("#aj-msg").textContent = "";
    try {
      const afip = { ambiente: $("#aj-amb").value, emisores: AJ_EMISORES.filter((e) => (e.cuit || "").trim()).map((e) => ({ cuit: String(e.cuit).replace(/\D/g, ""), razon: e.razon || "", punto_venta: Number(e.punto_venta) || 1, condicion_iva: e.condicion_iva || "monotributo" })) };
      const r = await fetch("/api/admin/ajustes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recargo_otros: Number($("#aj-recargo").value), envio_tuc_fijo: Number($("#aj-tuc-fijo").value), envio_tuc_gratis_desde: Number($("#aj-tuc-gratis").value), venc_dias_aviso: Number($("#aj-venc-dias").value), afip }) });
      if (r.status === 401) { $("#aj-msg").textContent = "Sesión vencida — volvé a iniciar sesión."; }
      else { const j = await r.json(); if (j.ok) { $("#aj-msg").textContent = "Guardado ✓"; toast("Ajustes guardados"); } else $("#aj-msg").textContent = j.error || "No se pudo guardar"; }
    } catch { $("#aj-msg").textContent = "No se pudo guardar"; }
    b.disabled = false;
  };
}

// Actualizar stock (re-sincroniza el catalogo desde WooCommerce)
const btnSync = $("#btn-sync");
if (btnSync) btnSync.onclick = async () => {
  btnSync.disabled = true; const prev = btnSync.textContent; btnSync.textContent = "Actualizando…";
  try {
    const r = await (await fetch("/api/sync", { method: "POST" })).json();
    if (r.ok) { await load(); toast(`Stock actualizado: ${r.total} productos`); }
    else toast(r.error || "No se pudo actualizar");
  } catch { toast("No se pudo actualizar"); }
  btnSync.disabled = false; btnSync.textContent = prev;
};

// ─── ARTÍCULOS (alta y listado con clasificación paramétrica) ────────────────
let ART_STRUCT = null; // cache de grupos, atributos, marcas, colores, modelos
let ART_EDIT_ID = null; // null = nuevo, number = editar

async function cargarArticulos() {
  if (!ART_STRUCT) {
    ART_STRUCT = await (await fetch("/api/admin/param/estructura")).json();
    artPoblarFiltros();
  }
  await artCargarLista();
}

function artPoblarFiltros() {
  const gf = $("#art-grupo-fil");
  ART_STRUCT.grupos.forEach(g => {
    const o = document.createElement("option"); o.value = g.id; o.textContent = `${g.id}. ${g.nombre}`; gf.appendChild(o);
  });
  // Formulario: grupo
  const afg = $("#af-grupo");
  ART_STRUCT.grupos.forEach(g => { const o = document.createElement("option"); o.value = g.id; o.textContent = `${g.id}. ${g.nombre}`; afg.appendChild(o); });
  // Formulario: marca
  const afm = $("#af-marca");
  ART_STRUCT.marcas_prod.forEach(m => { const o = document.createElement("option"); o.value = m.id; o.textContent = m.nombre; afm.appendChild(o); });
  // Formulario: compat marca
  const acm = $("#af-compat-marca");
  ART_STRUCT.marcas_dispositivo.forEach(m => { const o = document.createElement("option"); o.value = m.id; o.textContent = m.nombre; acm.appendChild(o); });

  // Cascada grupo → subgrupo → categoria → subcategoria
  $("#af-grupo").onchange = () => artCascada("grupo");
  $("#af-subgrupo").onchange = () => artCascada("subgrupo");
  $("#af-categoria").onchange = () => artCascada("categoria");
  // Cascada compat marca → linea → modelos
  $("#af-compat-marca").onchange = () => artCompatMarca();
  $("#af-compat-linea").onchange = () => artCompatModelos();

  // Atributos: renderizar grupos colapsables
  const wrap = $("#af-attrs-grupos");
  wrap.innerHTML = "";
  ART_STRUCT.grupos_param.forEach(gp => {
    const attrs = ART_STRUCT.atributos.filter(a => a.grupo_param_id === gp.id);
    if (!attrs.length) return;
    const det = document.createElement("details"); det.className = "af-gp"; det.dataset.gpId = gp.id;
    const sum = document.createElement("summary"); sum.textContent = gp.nombre;
    det.appendChild(sum);
    attrs.forEach(a => {
      const div = document.createElement("div"); div.className = "af-attr-row";
      const lbl = document.createElement("label"); lbl.textContent = a.nombre;
      let inp;
      if (a.tipo === "number") {
        inp = document.createElement("input"); inp.type = "number"; inp.min = "0"; inp.step = "any";
        inp.dataset.atributoId = a.id; inp.dataset.tipo = "number"; inp.className = "af-inp";
      } else if (a.tipo === "text") {
        inp = document.createElement("input"); inp.type = "text";
        inp.dataset.atributoId = a.id; inp.dataset.tipo = "text"; inp.className = "af-inp";
      } else {
        inp = document.createElement("select");
        const emp = document.createElement("option"); emp.value = ""; emp.textContent = "—"; inp.appendChild(emp);
        (a.valores || []).forEach(v => { const o = document.createElement("option"); o.value = v.id; o.textContent = `${v.codigo}. ${v.valor}`; inp.appendChild(o); });
        inp.dataset.atributoId = a.id; inp.dataset.tipo = "enum"; inp.className = "af-inp";
      }
      lbl.appendChild(inp); div.appendChild(lbl); det.appendChild(div);
    });
    wrap.appendChild(det);
  });
}

function artCascada(nivel) {
  const grupoId  = +$("#af-grupo").value || null;
  const subgId   = +$("#af-subgrupo").value || null;
  const catId    = +$("#af-categoria").value || null;

  if (nivel === "grupo") {
    const sg = $("#af-subgrupo"); sg.innerHTML = '<option value="">—</option>';
    ART_STRUCT.subgrupos.filter(s => s.grupo_id == grupoId).forEach(s => { const o = document.createElement("option"); o.value = s.id; o.textContent = `${s.numero}. ${s.nombre}`; sg.appendChild(o); });
    const cf = $("#af-categoria"); cf.innerHTML = '<option value="">—</option>';
    const sc = $("#af-subcategoria"); sc.innerHTML = '<option value="">—</option>';
  }
  if (nivel === "grupo" || nivel === "subgrupo") {
    const cf = $("#af-categoria"); cf.innerHTML = '<option value="">—</option>';
    const sgSel = +$("#af-subgrupo").value || null;
    ART_STRUCT.categorias.filter(c => c.subgrupo_id == sgSel).forEach(c => { const o = document.createElement("option"); o.value = c.id; o.textContent = `${c.numero || ""}. ${c.nombre}`; cf.appendChild(o); });
    const sc = $("#af-subcategoria"); sc.innerHTML = '<option value="">—</option>';
  }
  if (nivel === "categoria") {
    const sc = $("#af-subcategoria"); sc.innerHTML = '<option value="">—</option>';
    const cSel = +$("#af-categoria").value || null;
    ART_STRUCT.subcategorias.filter(s => s.categoria_id == cSel).forEach(s => { const o = document.createElement("option"); o.value = s.id; o.textContent = `${s.numero || ""}. ${s.nombre}`; sc.appendChild(o); });
  }
}

function artCompatMarca() {
  const marcaId = +$("#af-compat-marca").value || null;
  const sl = $("#af-compat-linea"); sl.innerHTML = '<option value="">Todas</option>';
  if (marcaId) {
    ART_STRUCT.lineas_dispositivo.filter(l => l.marca_id == marcaId).forEach(l => { const o = document.createElement("option"); o.value = l.id; o.textContent = l.nombre; sl.appendChild(o); });
  }
  artCompatModelos();
}

function artCompatModelos() {
  const marcaId = +$("#af-compat-marca").value || null;
  const lineaId = +$("#af-compat-linea").value || null;
  const grid = $("#af-modelos-grid"); grid.innerHTML = "";
  if (!marcaId) return;
  const mods = ART_STRUCT.modelos_dispositivo.filter(m => m.marca_id == marcaId && (!lineaId || m.linea_id == lineaId));
  mods.forEach(m => {
    const l = document.createElement("label"); l.className = "af-modelo-chk";
    const cb = document.createElement("input"); cb.type = "checkbox"; cb.value = m.id; cb.name = "modelo";
    l.appendChild(cb); l.appendChild(document.createTextNode(m.nombre)); grid.appendChild(l);
  });
}

async function artCargarLista() {
  const q = $("#art-q").value.trim();
  const grupo = $("#art-grupo-fil").value;
  const url = `/api/admin/articulos?q=${encodeURIComponent(q)}&grupo=${grupo}`;
  const lista = await (await fetch(url)).json();
  const wrap = $("#art-lista");
  if (!lista.length) { wrap.innerHTML = '<p class="meta" style="padding:16px">Sin artículos. Creá el primero.</p>'; return; }
  wrap.innerHTML = `<table class="art-table"><thead><tr><th>SKU</th><th>Nombre</th><th>Grupo</th><th>Subgrupo</th><th>Marca</th><th>Venta</th><th>Stock</th><th></th></tr></thead><tbody>
    ${lista.map(a => `<tr>
      <td class="meta">${esc(a.sku||"")}</td>
      <td>${esc(a.nombre)}</td>
      <td class="meta">${esc(a.grupo||"")}</td>
      <td class="meta">${esc(a.subgrupo||"")}</td>
      <td class="meta">${esc(a.marca||"")}</td>
      <td>$${num(a.precio||0)}</td>
      <td>${a.stock??0}</td>
      <td><button class="btn ghost xs" data-art-id="${a.id}">✏️ Editar</button></td>
    </tr>`).join("")}
  </tbody></table>`;
  wrap.querySelectorAll("[data-art-id]").forEach(b => b.onclick = () => artAbrirEditar(+b.dataset.artId));
}

function artAbrirFormulario(titulo) {
  $("#art-drawer-title").textContent = titulo;
  $("#art-drawer").classList.remove("hidden");
  $("#af-feedback").textContent = "";
}

function artCerrarDrawer() { $("#art-drawer").classList.add("hidden"); ART_EDIT_ID = null; }

function artLimpiarForm() {
  $("#af-nombre").value = ""; $("#af-sku").value = ""; $("#af-descripcion").value = "";
  $("#af-precio").value = ""; $("#af-costo").value = ""; $("#af-stock").value = "0";
  $("#af-grupo").value = ""; $("#af-subgrupo").value = ""; $("#af-categoria").value = ""; $("#af-subcategoria").value = "";
  $("#af-marca").value = "";
  artCascada("grupo");
  $$(".af-inp").forEach(i => { if (i.tagName === "SELECT") i.value = ""; else i.value = ""; });
  $$(".af-modelo-chk input").forEach(c => c.checked = false);
}

async function artAbrirEditar(id) {
  artLimpiarForm(); ART_EDIT_ID = id;
  const art = await (await fetch(`/api/admin/articulos/${id}`)).json();
  artAbrirFormulario(`Editar artículo #${id}`);
  $("#af-nombre").value = art.nombre || "";
  $("#af-sku").value = art.sku || "";
  $("#af-descripcion").value = art.descripcion || "";
  $("#af-precio").value = art.precio || "";
  $("#af-costo").value = art.precio_regular || "";
  $("#af-stock").value = art.stock ?? 0;
  if (art.grupo_id) { $("#af-grupo").value = art.grupo_id; artCascada("grupo"); }
  if (art.subgrupo_id) { await new Promise(r=>setTimeout(r,0)); $("#af-subgrupo").value = art.subgrupo_id; artCascada("subgrupo"); }
  if (art.categoria_jer_id) { await new Promise(r=>setTimeout(r,0)); $("#af-categoria").value = art.categoria_jer_id; artCascada("categoria"); }
  if (art.subcategoria_jer_id) { await new Promise(r=>setTimeout(r,0)); $("#af-subcategoria").value = art.subcategoria_jer_id; }
  if (art.marca_prod_id) $("#af-marca").value = art.marca_prod_id;
  // Restaurar atributos
  (art.atributos || []).forEach(a => {
    const inp = $(`.af-inp[data-atributo-id="${a.atributo_id}"]`);
    if (!inp) return;
    if (a.tipo === "number" || inp.dataset.tipo === "number") inp.value = a.valor_num || "";
    else if (inp.dataset.tipo === "text") inp.value = a.valor_texto || "";
    else inp.value = a.valor_id || "";
  });
  // Restaurar modelos
  const modeloIds = new Set((art.modelos||[]).map(m=>m.modelo_id));
  if (modeloIds.size > 0) {
    const primero = art.modelos[0];
    const md = ART_STRUCT.modelos_dispositivo.find(m => m.id === primero.modelo_id);
    if (md) {
      $("#af-compat-marca").value = md.marca_id; artCompatMarca();
      await new Promise(r=>setTimeout(r,0));
      $$(".af-modelo-chk input").forEach(c => { if (modeloIds.has(+c.value)) c.checked = true; });
    }
  }
}

function artRecogerFormData() {
  const atributos = [];
  $$(".af-inp").forEach(inp => {
    const aId = +inp.dataset.atributoId;
    if (!aId) return;
    const tipo = inp.dataset.tipo;
    const v = inp.value;
    if (!v) return;
    if (tipo === "number") atributos.push({ atributo_id: aId, valor_num: +v });
    else if (tipo === "text") atributos.push({ atributo_id: aId, valor_texto: v });
    else atributos.push({ atributo_id: aId, valor_id: +v });
  });
  const modelos = [...$$(".af-modelo-chk input:checked")].map(c => +c.value);
  return {
    nombre: $("#af-nombre").value.trim(),
    sku: $("#af-sku").value.trim(),
    descripcion: $("#af-descripcion").value.trim(),
    grupo_id: +$("#af-grupo").value || null,
    subgrupo_id: +$("#af-subgrupo").value || null,
    categoria_jer_id: +$("#af-categoria").value || null,
    subcategoria_jer_id: +$("#af-subcategoria").value || null,
    marca_prod_id: +$("#af-marca").value || null,
    precio: +$("#af-precio").value || 0,
    precio_regular: +$("#af-costo").value || 0,
    stock: +$("#af-stock").value || 0,
    atributos, modelos,
  };
}

$("#art-nuevo").onclick = () => { artLimpiarForm(); ART_EDIT_ID = null; artAbrirFormulario("Nuevo artículo"); };
$("#art-buscar").onclick = artCargarLista;
$("#art-q").onkeydown = e => { if (e.key === "Enter") artCargarLista(); };
$("#art-drawer-cerrar").onclick = artCerrarDrawer;
$("#art-drawer-cerrar2").onclick = artCerrarDrawer;

$("#art-form").onsubmit = async (e) => {
  e.preventDefault();
  const datos = artRecogerFormData();
  if (!datos.nombre) return;
  const fb = $("#af-feedback"); fb.textContent = "Guardando…";
  try {
    if (ART_EDIT_ID) {
      await api(`/api/admin/articulos/${ART_EDIT_ID}`, datos, "PUT");
      fb.textContent = "✓ Guardado";
    } else {
      const r = await api("/api/admin/articulos", datos);
      fb.textContent = `✓ Creado (#${r.id})`;
    }
    await artCargarLista();
    if (!ART_EDIT_ID) { artLimpiarForm(); }
  } catch (e2) { fb.textContent = "Error: " + e2.message; }
};

// Cerrar sesión
const btnSalir = $("#btn-salir");
if (btnSalir) btnSalir.onclick = async () => { await fetch("/api/auth/salir", { method: "POST" }); location.href = "/ingresar"; };

// ─── IMPORTAR ARTÍCULOS DESDE CSV ────────────────────────────────────────────
{
  const btnImp = $("#art-importar-btn");
  const modal  = $("#art-import-modal");
  const cerrar = $("#art-import-cerrar");
  const fileIn = $("#art-import-file");
  const preview = $("#art-import-preview");
  const btnOk  = $("#art-import-ok");
  const status = $("#art-import-status");
  const tpl    = $("#art-import-tpl");
  if (btnImp && modal) {
    const HEADERS = ["nombre","sku","precio","precio_costo","stock","grupo","subgrupo","marca","descripcion","imagen"];
    let parsed = [];

    // Plantilla CSV para descargar
    if (tpl) tpl.onclick = (e) => {
      e.preventDefault();
      const row = HEADERS.join(",") + "\n" + '"Funda iPhone 15 Transparente","F-IP15",8500,3000,25,"Fundas","Fundas iPhone","Generic","Descripción",""\n';
      const blob = new Blob([row], { type: "text/csv" });
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "plantilla-articulos.csv"; a.click();
    };

    // Parseo CSV (maneja comillas y comas dentro de campos)
    function parseCSV(text) {
      const lines = text.replace(/\r/g,"").split("\n").filter(l => l.trim());
      if (lines.length < 2) return [];
      const heads = lines[0].split(",").map(h => h.replace(/^"|"$/g,"").trim().toLowerCase());
      const rows = [];
      for (let i = 1; i < lines.length; i++) {
        const vals = []; let cur = "", inQ = false;
        for (const ch of lines[i] + ",") {
          if (ch === '"') { inQ = !inQ; }
          else if (ch === "," && !inQ) { vals.push(cur.trim()); cur = ""; }
          else { cur += ch; }
        }
        if (vals.length < 2) continue;
        const obj = {};
        heads.forEach((h, idx) => { obj[h] = vals[idx] || ""; });
        if (obj.nombre) rows.push(obj);
      }
      return rows;
    }

    btnImp.onclick = () => modal.classList.remove("hidden");
    cerrar.onclick = () => { modal.classList.add("hidden"); parsed = []; preview.innerHTML = ""; btnOk.disabled = true; status.textContent = ""; };

    fileIn.onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        parsed = parseCSV(ev.target.result);
        if (!parsed.length) { preview.innerHTML = '<p class="meta">No se encontraron filas válidas.</p>'; btnOk.disabled = true; return; }
        const cols = ["nombre","sku","precio","stock","grupo","subgrupo","marca"];
        preview.innerHTML = `<p class="meta">${parsed.length} artículos listos para importar.</p>
          <div style="max-height:200px;overflow-y:auto">
            <table style="width:100%;font-size:12px;border-collapse:collapse">
              <thead><tr>${cols.map(c=>`<th style="text-align:left;padding:4px 8px;border-bottom:1px solid #eee">${c}</th>`).join("")}</tr></thead>
              <tbody>${parsed.slice(0,20).map(r=>`<tr>${cols.map(c=>`<td style="padding:3px 8px;border-bottom:1px solid #f3f4f6">${esc(r[c]||"")}</td>`).join("")}</tr>`).join("")}</tbody>
            </table>
          </div>`;
        btnOk.disabled = false;
        status.textContent = "";
      };
      reader.readAsText(f);
    };

    btnOk.onclick = async () => {
      if (!parsed.length) return;
      btnOk.disabled = true; status.textContent = "Importando…";
      try {
        const r = await api("/api/admin/articulos/importar", { articulos: parsed });
        status.textContent = `✓ ${r.creados} creados${r.errores?.length ? ` · ${r.errores.length} con error` : ""}`;
        if (r.errores?.length) console.warn("[importar]", r.errores);
        await artCargarLista();
      } catch (e) { status.textContent = "Error: " + e.message; btnOk.disabled = false; }
    };
  }
}

// ─── IMPORTAR VINCULACIONES ───────────────────────────────────────────────────
{
  const btn    = $("#art-vinc-btn");
  const modal  = $("#art-vinc-modal");
  const cerrar = $("#art-vinc-cerrar");
  const fileIn = $("#art-vinc-file");
  const prev   = $("#art-vinc-preview");
  const btnOk  = $("#art-vinc-ok");
  const status = $("#art-vinc-status");

  if (btn && modal) {
    let csvText = "";

    btn.onclick = () => modal.classList.remove("hidden");
    cerrar.onclick = () => {
      modal.classList.add("hidden");
      csvText = ""; prev.innerHTML = ""; btnOk.disabled = true; status.textContent = "";
      fileIn.value = "";
    };

    fileIn.onchange = (e) => {
      const f = e.target.files[0]; if (!f) return;
      status.textContent = "";
      const reader = new FileReader();
      reader.onload = (ev) => {
        csvText = ev.target.result;
        // Vista previa rápida: contar filas de datos (saltar primeras 4)
        const lines = csvText.replace(/\r/g,"").split("\n").filter(l => l.trim());
        const dataLines = lines.slice(4).filter(l => {
          const parts = l.split(",");
          return parts[1] && parts[1].trim() !== "0" && parts[1].trim() !== "";
        });
        // Contar combinaciones únicas (sku:base:color)
        const uniq = new Set(dataLines.map(l => {
          const p = l.split(",");
          return `${(p[1]||"").trim()}:${(p[2]||"").trim()}:${(p[4]||"").trim()}`;
        }));
        prev.innerHTML = `<p class="meta">📄 ${f.name} · ${dataLines.length} filas de datos · ~${uniq.size} productos únicos (por SKU/tipo/color)</p>`;
        btnOk.disabled = false;
      };
      reader.readAsText(f, "utf-8");
    };

    btnOk.onclick = async () => {
      if (!csvText) return;
      btnOk.disabled = true;
      status.textContent = "Importando…";
      try {
        const r = await api("/api/admin/articulos/importar-vinculaciones", { csv: csvText });
        status.textContent = `✓ ${r.creados} productos creados${r.errores?.length ? ` · ${r.errores.length} errores` : ""}`;
        if (r.errores?.length) console.warn("[vinc]", r.errores);
        if (r.creados > 0) await artCargarLista();
      } catch (e) {
        status.textContent = "Error: " + e.message;
        btnOk.disabled = false;
      }
    };
  }
}

// Carga inicial resiliente: reintenta si /api/data falla/tarda, y al terminar re-renderiza la pestaña
// activa por si se abrió antes de que llegaran los datos (evita combos/mapa vacíos).
(async function initApp() {
  for (let intento = 0; intento < 4; intento++) {
    try { await load(); break; }
    catch (e) { console.log("[load] reintento " + intento + ":", e && e.message); await new Promise((r) => setTimeout(r, 1200)); }
  }
  const activa = $$(".tab.active")[0]; if (activa) activarTab(activa.dataset.tab, true);
})();
