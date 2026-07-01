// ---------- Estado ----------
let PRODS = [];
let CATS = [];
let ARBOL = [];           // categorías padre con sus hijas
let catPadre = "", catHija = "";
let TIENDA_URL = "";
let RECARGO = 0; // % extra para medios que no sean transferencia/efectivo
let NAVE_ON = false; // Nave (Naranja X) habilitado (según credenciales en el server)
let ENVIO_TUC = { fijo: 0, gratis_desde: 0 }; // envío local con cadete
let YO = { autenticado: false };
let STAFF = false;
let mostrar = 24;
let CART = cargarCarrito();

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const norm = (s) => (s || "").toString().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const esc = (s) => (s || "").toString().replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const precio = (n) => "$" + Number(n || 0).toLocaleString("es-AR");
const hayStock = (x) => x.stock_status === "instock" && x.stock !== 0;
// Muestra los dos precios (transferencia/efectivo y otros medios con recargo). Si RECARGO=0, uno solo.
function precios2(base, grande) {
  base = Number(base) || 0;
  if (!RECARGO) return `<span class="t-precio-uni ${grande ? "g" : ""}">${precio(base)}</span>`;
  const alt = Math.round(base * (1 + RECARGO / 100));
  return `<div class="t-precios ${grande ? "g" : ""}">
    <div class="t-precio-main">${precio(base)}<small>transferencia o efectivo</small></div>
    <div class="t-precio-alt">${precio(alt)}<small>otros medios (+${RECARGO}%)</small></div>
  </div>`;
}

function cargarCarrito() { try { return JSON.parse(localStorage.getItem("damia_cart") || "[]"); } catch { return []; } }
function guardarCarrito() { localStorage.setItem("damia_cart", JSON.stringify(CART)); }
function toast(m) { const t = $("#t-toast"); t.textContent = m; t.classList.remove("hidden"); clearTimeout(window._tt); window._tt = setTimeout(() => t.classList.add("hidden"), 1800); }

// ---------- Carga ----------
async function init() {
  const sug = document.createElement("div");
  sug.id = "t-sug"; sug.className = "t-sug hidden";
  $(".t-search").appendChild(sug);
  const params = new URLSearchParams(location.search);
  // 1) Catálogo: con esto ya mostramos la página (no esperamos lo demás)
  const d = await (await fetch("/api/tienda/catalogo")).json();
  PRODS = d.productos || [];
  CATS = d.categorias || [];
  TIENDA_URL = d.tienda_url || "";
  RECARGO = Number(d.recargo) || 0;
  NAVE_ON = !!d.nave;
  ENVIO_TUC = { fijo: Number(d.envio_tuc_fijo) || 0, gratis_desde: Number(d.envio_tuc_gratis_desde) || 0 };
  renderCats();
  renderGrid();
  renderCarrito();
  const mProd = location.pathname.match(/^\/producto\/(\d+)/);
  const pid = mProd ? mProd[1] : params.get("p");
  if (pid) abrirProducto(Number(pid), false);
  // 2) El resto en paralelo, sin bloquear el render
  fetch("/api/tienda/promo").then((r) => r.json()).then((p) => { if (p.activo) { const m = document.querySelector("main"); if (m) { const d = document.createElement("div"); d.className = "t-promo"; d.innerHTML = `🎉 ${esc(p.texto)}${p.codigo ? ` — usá el código <b>${esc(p.codigo)}</b>` : ""}`; m.prepend(d); } } }).catch(() => {});
  fetch("/api/auth/yo").then((r) => r.json()).then((y) => { YO = y; }).catch(() => {});
  fetch("/api/tienda/soy-staff").then((r) => r.json()).then((s) => { STAFF = !!s.staff; }).catch(() => {});
  fetch("/api/tienda/categorias").then((r) => r.json()).then((c) => {
    ARBOL = c.categorias || [];
    const cat = params.get("cat");
    if (cat) { const padre = ARBOL.find((p) => norm(p.name) === norm(cat)); if (padre) { catPadre = padre.name; renderGrid(); } else if ($("#t-q")) { $("#t-q").value = cat; renderGrid(); } }
    renderCats();
  }).catch(() => {});
}

let SUG_LIST = [], SUG_SEL = null, SUG_VAR = null, SUG_QTY = 1;
function renderSug() {
  const div = $("#t-sug"); if (!div) return;
  const q = $("#t-q").value.trim();
  if (q.length < 3) { div.classList.add("hidden"); return; }   // a partir de 3 letras
  const terms = norm(q).split(/\s+/).filter(Boolean);
  SUG_LIST = PRODS.filter((p) => { const hay = norm(p.nombre + " " + p.sku + " " + p.categorias.join(" ") + " " + (p.descripcion || "") + " " + (p.variaciones || []).map((v) => v.label).join(" ")); return terms.every((t) => hay.includes(t)); }).slice(0, 8);
  if (!SUG_LIST.length) { div.innerHTML = `<div class="t-sug-list"><div class="t-sug-empty">Sin resultados para “${esc(q)}”</div></div>`; div.classList.remove("hidden"); return; }
  if (!SUG_LIST.find((p) => p.id === SUG_SEL)) { SUG_SEL = SUG_LIST[0].id; SUG_VAR = null; SUG_QTY = 1; }
  div.innerHTML = `<div class="t-sug-list">${SUG_LIST.map(sugItem).join("")}</div><div class="t-sug-preview">${sugPreview()}</div>`;
  div.classList.remove("hidden");
}
function sugItem(p) {
  return `<div class="t-sug-item ${p.id === SUG_SEL ? "sel" : ""}" data-sugsel="${p.id}">
    ${p.imagen ? `<img src="${esc(p.imagen)}" data-src="${esc(p.imagen)}" alt="" onerror="imgRetry(this)">` : `<div class="t-sug-ph">🦷</div>`}
    <div class="t-sug-info"><div class="t-sug-name">${esc(p.nombre)}</div>${p.sku ? `<div class="t-sug-sku">SKU ${esc(p.sku)}</div>` : ""}</div>
    <div class="t-sug-price">${precio(p.precio)}</div></div>`;
}
function sugPreview() {
  const p = PROD_BY_ID_T(SUG_SEL); if (!p) return "";
  const esVar = p.tipo === "variable" && (p.variaciones || []).length;
  const v = SUG_VAR ? p.variaciones.find((x) => x.id === SUG_VAR) : null;
  let prc = v ? v.precio : p.precio;
  if (!v && esVar) { const vs = (p.variaciones || []).filter(hayStock).map((x) => Number(x.precio) || 0).filter(Boolean); if (vs.length) prc = Math.min(...vs); }
  const stockOk = v ? hayStock(v) : hayStock(p);
  const puede = esVar ? (SUG_VAR && stockOk) : hayStock(p);
  return `<div class="t-pv-img">${p.imagen ? `<img src="${esc(p.imagen)}" data-src="${esc(p.imagen)}" alt="" onerror="imgRetry(this)">` : `<span class="ph">🦷</span>`}</div>
    <h4 class="t-pv-name">${esc(p.nombre)}</h4>
    <div class="t-pv-sku">${esc(p.sku || p.id)}</div>
    <div class="t-pv-price">${precio(prc)}</div>
    ${esVar ? `<select class="t-pv-var" id="sug-var"><option value="">Elegí una medida…</option>${p.variaciones.filter(hayStock).map((x) => `<option value="${x.id}" ${x.id === SUG_VAR ? "selected" : ""}>${esc(x.label)}</option>`).join("")}</select>` : ""}
    <div class="t-pv-stock ${stockOk ? "ok" : "no"}">${stockOk ? "Hay existencias" : "Sin stock"}</div>
    <div class="t-pv-foot">
      <div class="t-pv-qty"><button data-sugqty="-1">−</button><span>${SUG_QTY}</span><button data-sugqty="1">+</button></div>
      <button class="t-pv-add" data-sugaddsel ${puede ? "" : "disabled"}>🛒 ${puede ? "Añadir al carrito" : (esVar ? "Elegí medida" : "Sin stock")}</button>
    </div>
    <span class="t-pv-ver" data-sugprod="${p.id}">Ver producto completo →</span>`;
}
function PROD_BY_ID_T(id) { return PRODS.find((x) => x.id === id); }
function ocultarSug() { const d = $("#t-sug"); if (d) d.classList.add("hidden"); }

function renderCats() {
  const padres = ARBOL.length ? ARBOL : CATS.slice(0, 16).map((n) => ({ name: n, hijas: [] }));
  $("#t-cats").innerHTML = `<button class="t-cat ${catPadre ? "" : "active"}" data-cat-padre="">Todo</button>` +
    padres.map((p) => `<button class="t-cat ${catPadre === p.name ? "active" : ""}" data-cat-padre="${esc(p.name)}">${esc(p.name)}</button>`).join("");
  const pSel = padres.find((p) => p.name === catPadre);
  const sub = $("#t-subcats");
  sub.innerHTML = (pSel && pSel.hijas && pSel.hijas.length)
    ? `<button class="t-subcat ${catHija ? "" : "active"}" data-cat-hija="">Todas las de ${esc(catPadre)}</button>` +
      pSel.hijas.map((h) => `<button class="t-subcat ${catHija === h.name ? "active" : ""}" data-cat-hija="${esc(h.name)}">${esc(h.name)}</button>`).join("")
    : "";
}

// ---------- Menú desplegable de categorías (con subniveles) ----------
function renderCatMenu() {
  const cont = $("#t-catmenu-body"); if (!cont) return;
  const arbol = ARBOL.length ? ARBOL : CATS.map((n) => ({ name: n, hijas: [], count: 0 }));
  cont.innerHTML = `<button class="t-cm-item all ${!catPadre ? "on" : ""}" data-cm-padre="">Ver todos los productos</button>` +
    arbol.map((p) => `<div class="t-cm-group">
      <button class="t-cm-padre ${catPadre === p.name && !catHija ? "on" : ""}" data-cm-padre="${esc(p.name)}">${esc(p.name)}${p.count ? `<span class="t-cm-count">${p.count}</span>` : ""}</button>
      ${(p.hijas || []).length ? `<div class="t-cm-hijas">${p.hijas.map((h) => `<button class="t-cm-hija ${catHija === h.name ? "on" : ""}" data-cm-padre="${esc(p.name)}" data-cm-hija="${esc(h.name)}">${esc(h.name)}</button>`).join("")}</div>` : ""}
    </div>`).join("");
}
function abrirCatMenu() { renderCatMenu(); $("#t-catmenu").classList.remove("hidden"); document.body.style.overflow = "hidden"; }
function cerrarCatMenu() { $("#t-catmenu").classList.add("hidden"); document.body.style.overflow = ""; }
function elegirCat(padre, hija) {
  catPadre = padre || ""; catHija = hija || ""; mostrar = 24;
  $("#t-q").value = "";
  renderCats(); renderGrid(); cerrarCatMenu();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
$("#t-cat-btn") && ($("#t-cat-btn").onclick = abrirCatMenu);
$("#t-catmenu-close") && ($("#t-catmenu-close").onclick = cerrarCatMenu);
$("#t-catmenu") && ($("#t-catmenu").addEventListener("click", (e) => { if (e.target.id === "t-catmenu") cerrarCatMenu(); }));
$("#t-catmenu-body") && ($("#t-catmenu-body").addEventListener("click", (e) => { const b = e.target.closest("[data-cm-padre]"); if (b) elegirCat(b.dataset.cmPadre, b.dataset.cmHija); }));

function filtrados() {
  const terms = norm($("#t-q").value).split(/\s+/).filter(Boolean);
  let nombres = null;
  if (catHija) nombres = [catHija];
  else if (catPadre) { const p = ARBOL.find((x) => x.name === catPadre); nombres = p ? [catPadre, ...p.hijas.map((h) => h.name)] : [catPadre]; }
  return PRODS.filter((p) => {
    if (nombres && !p.categorias.some((c) => nombres.includes(c))) return false;
    if (!terms.length) return true;
    const hay = norm(p.nombre + " " + p.sku + " " + p.categorias.join(" ") + " " + (p.descripcion || "") + " " + (p.variaciones || []).map((v) => v.label).join(" "));
    return terms.every((t) => hay.includes(t));
  });
}

function renderGrid() {
  const list = filtrados();
  // primero con stock
  list.sort((a, b) => (hayStock(b) - hayStock(a)));
  $("#t-meta").textContent = `${list.length} producto(s)`;
  const vis = list.slice(0, mostrar);
  $("#t-grid").innerHTML = vis.map((p) => card(p)).join("");
  $("#t-mas").innerHTML = list.length > mostrar ? `<button id="t-mas-btn">Ver más productos</button>` : "";
}

// Si una foto falla al cargar, reintenta hasta 3 veces (con espera creciente) antes de mostrar el 🦷.
window.imgRetry = function (img) {
  const n = (img._try || 0) + 1; img._try = n;
  const base = (img.getAttribute("data-src") || img.src).split("?")[0];
  if (n <= 3) { setTimeout(() => { img.src = base + "?r=" + n; }, 600 * n); }
  else { img.replaceWith(Object.assign(document.createElement("span"), { className: "ph", textContent: "🦷" })); }
};
const IMG_ERR = `onerror="imgRetry(this)"`;
function imgTag(p, cls) {
  return p.imagen ? `<img src="${esc(p.imagen)}" data-src="${esc(p.imagen)}" loading="lazy" alt="" ${IMG_ERR}>` : `<span class="ph">🦷</span>`;
}
function card(p) {
  const stock = hayStock(p);
  const esVar = p.tipo === "variable" && (p.variaciones || []).length;
  const tags = (p.categorias || []).slice(0, 2).map((c) => `<span class="t-tag">${esc(c)}</span>`).join("");
  return `<div class="t-card" data-prod="${p.id}">
    <div class="t-card-img">${imgTag(p)}</div>
    <div class="t-card-body">
      ${tags ? `<div class="t-tags">${tags}</div>` : ""}
      <div class="t-card-name">${esc(p.nombre)}</div>
      ${precios2(p.precio)}
      <button class="t-add" data-add="${p.id}" ${stock ? "" : "disabled"}>${esVar ? "Ver opciones" : "Agregar al carrito"}</button>
    </div>
  </div>`;
}

// ---------- Modal producto ----------
let MODAL_PROD = null, MODAL_VAR = null, MODAL_QTY = 1;
async function abrirProducto(id, push = true) {
  let p = PRODS.find((x) => x.id === id);
  if (!p) { // producto fuera del listado (p. ej. sin stock): traerlo por id
    try { const d = await (await fetch("/api/tienda/producto?id=" + id)).json(); p = d.producto; if (d.recargo != null) RECARGO = Number(d.recargo) || RECARGO; } catch {}
  }
  if (!p) return;
  MODAL_PROD = p; MODAL_VAR = null; MODAL_QTY = 1;
  renderModal();
  $("#t-modal").classList.remove("hidden");
  if (push && location.pathname !== "/producto/" + id) history.pushState({ p: id }, "", "/producto/" + id);
  window.scrollTo(0, 0);
}
function cerrarProducto() {
  $("#t-modal").classList.add("hidden");
  VC_OPEN = false;
  if (location.pathname.indexOf("/producto") === 0) history.pushState({}, "", "/tienda");
}
window.addEventListener("popstate", () => {
  const m = location.pathname.match(/^\/producto\/(\d+)/);
  if (m) abrirProducto(Number(m[1]), false);
  else $("#t-modal").classList.add("hidden");
});
function varActual() { return MODAL_VAR ? (MODAL_PROD.variaciones || []).find((v) => v.id === MODAL_VAR) : null; }
function precioActual() {
  const v = varActual(); if (v) return v.precio;
  if (MODAL_PROD.tipo === "variable") { const vs = (MODAL_PROD.variaciones || []).filter(hayStock).map((x) => Number(x.precio) || 0).filter(Boolean); if (vs.length) return Math.min(...vs); }
  return MODAL_PROD.precio;
}
function stockActual() { const v = varActual(); return v ? hayStock(v) : hayStock(MODAL_PROD); }
function renderModal() {
  const p = MODAL_PROD;
  const esVar = p.tipo === "variable" && (p.variaciones || []).length;
  const desc = [p.descripcion, p.descripcion_corta].filter(Boolean).join("\n\n");
  const puede = esVar ? (MODAL_VAR && stockActual()) : hayStock(p);
  $("#t-modal-body").innerHTML = `
    <div class="t-detalle-img">${imgTag(p)}</div>
    <div class="t-detalle-info">
      <a class="t-volver" id="t-volver">← Volver a la tienda</a>
      <img class="t-detalle-logo" src="/assets/logo.png" alt="Punto Damia">
      <h2>${esc(p.nombre)}</h2>
      ${(p.categorias && p.categorias.length) ? `<div class="t-detalle-cats">${p.categorias.map((c) => `<span class="t-detalle-cat">${esc(c)}</span>`).join("")}</div>` : ""}
      <div class="t-detalle-precio">${precios2(precioActual(), true)}</div>
      <div class="t-stock ${stockActual() ? "ok" : "no"}" style="display:inline-block">${stockActual() ? "En stock" : "Sin stock"}</div>
      ${esVar ? `<div class="t-variaciones"><label>Elegí una opción:</label>
        <select id="t-var-sel"><option value="">— Seleccionar —</option>
        ${p.variaciones.filter(hayStock).map((v) => `<option value="${v.id}" ${v.id === MODAL_VAR ? "selected" : ""}>${esc(v.label)}</option>`).join("")}
        </select></div>` : ""}
      <div class="t-qty">
        <button data-qty="-1">−</button><span>${MODAL_QTY}</span><button data-qty="1">+</button>
      </div>
      <button class="t-btn-grande" id="t-add-modal" ${puede ? "" : "disabled"}>${puede ? "Agregar al carrito" : (esVar ? "Elegí una opción" : "Sin stock")}</button>
      ${desc ? `<div class="t-detalle-desc">${esc(desc)}</div>` : ""}
    </div>`;
  const bv = $("#t-volver"); if (bv) bv.onclick = cerrarProducto;
}

// ---------- Carrito ----------
function keyDe(id, variationId) { return id + ":" + (variationId || ""); }
function agregar(p, variationId, qty) {
  const v = variationId ? (p.variaciones || []).find((x) => x.id === variationId) : null;
  const disponible = v ? hayStock(v) : hayStock(p);
  if (!disponible) { toast("Ese producto no tiene stock"); return; }
  const key = keyDe(p.id, variationId);
  const ex = CART.find((i) => i.key === key);
  const rawMax = v ? v.stock : p.stock;
  const max = (rawMax && rawMax > 1) ? rawMax : 99;
  if (ex) ex.qty = Math.min(ex.qty + qty, max);
  else CART.push({ key, id: p.id, variationId: variationId || null, nombre: p.nombre, label: v ? v.label : "", precio: v ? v.precio : p.precio, imagen: p.imagen, qty: Math.min(qty, max), max });
  guardarCarrito(); renderCarrito(); toast("Agregado al carrito");
}
function renderCarrito() {
  const n = CART.reduce((s, i) => s + i.qty, 0);
  $("#t-cart-count").textContent = n;
  const total = CART.reduce((s, i) => s + i.precio * i.qty, 0);
  $("#t-cart-total").textContent = precio(total);
  $("#t-checkout").disabled = CART.length === 0;
  $("#t-cart-items").innerHTML = CART.length ? CART.map((i) => `
    <div class="t-cart-item">
      ${i.imagen ? `<img src="${esc(i.imagen)}" data-src="${esc(i.imagen)}" alt="" onerror="imgRetry(this)">` : `<div style="width:56px;height:56px;background:var(--soft);border-radius:8px"></div>`}
      <div class="ci-info">
        <div class="ci-name">${esc(i.nombre)}</div>
        ${i.label ? `<div class="ci-var">${esc(i.label)}</div>` : ""}
        <div class="ci-row">
          <div class="ci-qty"><button data-cq="${i.key}|-1">−</button><span>${i.qty}</span><button data-cq="${i.key}|1">+</button></div>
          <span class="ci-price">${precio(i.precio * i.qty)}</span>
        </div>
        <button class="ci-del" data-cdel="${i.key}">Quitar</button>
      </div>
    </div>`).join("") : `<div class="t-cart-vacio">Tu carrito está vacío.</div>`;
}

// ---------- Ver carrito: ventana grande con fotos para que el cliente confirme ----------
let VC_OPEN = false;
function verCarritoModal() {
  if (!CART.length) return;
  const total = CART.reduce((s, i) => s + i.precio * i.qty, 0);
  const PH_SVG = `<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z"/><line x1="3" y1="6" x2="21" y2="6"/><path d="M16 10a4 4 0 01-8 0"/></svg>`;
  const np = CART.length;
  const filas = CART.map((i) => `
    <div class="t-vc-item">
      ${i.imagen ? `<img class="t-vc-img" src="${esc(i.imagen)}" data-src="${esc(i.imagen)}" alt="" onerror="imgRetry(this)">` : `<div class="t-vc-img ph">${PH_SVG}</div>`}
      <div class="t-vc-body">
        <div class="t-vc-n">${esc(i.nombre)}${i.label ? `<span class="t-vc-var"> · ${esc(i.label)}</span>` : ""}</div>
        ${i.precio > 0 ? `<div class="t-vc-pu">${precio(i.precio)} c/u</div>` : ""}
        <div class="t-vc-row2">
          <div class="ci-qty"><button data-cq="${i.key}|-1">−</button><span>${i.qty}</span><button data-cq="${i.key}|1">+</button></div>
          <button class="ci-del" data-cdel="${i.key}">Quitar</button>
          ${i.precio > 0 ? `<span class="t-vc-sub">${precio(i.precio * i.qty)}</span>` : ""}
        </div>
      </div>
    </div>`).join("");
  $("#t-modal-body").innerHTML = `<div class="t-vc">
    <div class="t-vc-header">
      <img class="t-vc-logo" src="/assets/logo.png" alt="Punto Damia">
      <h2>Tu pedido</h2>
      <p class="t-vc-intro">${np} ${np === 1 ? "producto" : "productos"} · revisá antes de confirmar</p>
    </div>
    <div class="t-vc-list">${filas}</div>
    <div class="t-vc-footer">
      <div class="t-vc-total"><span>Total</span><strong>${precio(total)}</strong></div>
      <button class="t-btn-grande" id="t-vc-checkout">Finalizar compra →</button>
      <p class="t-cart-nota" style="margin-top:10px">🔒 Pago seguro · Envío por Andreani</p>
    </div>
  </div>`;
  VC_OPEN = true;
  $("#t-cart").classList.add("hidden");
  $("#t-modal").classList.remove("hidden");
  window.scrollTo(0, 0);
  $("#t-vc-checkout").onclick = () => checkout();
}

// ---------- Checkout: arma el pedido y va al pago seguro de WooCommerce (Mercado Pago / Andreani) ----------
const PROV_AR = [["T","Tucumán"],["B","Buenos Aires"],["C","CABA"],["K","Catamarca"],["H","Chaco"],["U","Chubut"],["X","Córdoba"],["W","Corrientes"],["E","Entre Ríos"],["P","Formosa"],["Y","Jujuy"],["L","La Pampa"],["F","La Rioja"],["M","Mendoza"],["N","Misiones"],["Q","Neuquén"],["R","Río Negro"],["A","Salta"],["J","San Juan"],["D","San Luis"],["Z","Santa Cruz"],["S","Santa Fe"],["G","Santiago del Estero"],["V","Tierra del Fuego"]];
let CO_RATE = null, CO_PROD = 0, CO_PAGO = "transferencia", CO_CUPON = null;

function totalesHTML() {
  const envio = CO_RATE ? CO_RATE.price : 0;
  const desc = CO_CUPON ? CO_CUPON.descuento : 0;
  const recargo = ((CO_PAGO === "mp" || CO_PAGO === "nave") && RECARGO) ? Math.round(CO_PROD * RECARGO / 100) : 0;
  let h = `<div class="t-co-line"><span>Productos</span><b>${precio(CO_PROD)}</b></div>`;
  if (desc) h += `<div class="t-co-line"><span>🎟️ Cupón ${esc(CO_CUPON.code)}</span><b>−${precio(desc)}</b></div>`;
  if (CO_RATE) h += `<div class="t-co-line"><span>Envío · ${esc(CO_RATE.name)}</span><b>${precio(CO_RATE.price)}</b></div>`;
  if (recargo) h += `<div class="t-co-line"><span>Recargo ${CO_PAGO === "nave" ? "Nave" : "Mercado Pago"} (+${RECARGO}%)</span><b>${precio(recargo)}</b></div>`;
  h += `<div class="t-co-line big"><span>Total</span><b>${precio(Math.max(0, CO_PROD - desc) + envio + recargo)}</b></div>`;
  return h;
}
async function aplicarCupon() {
  const inp = $("#t-cupon-code"), msg = $("#t-cupon-msg"), code = inp.value.trim();
  if (CO_CUPON) { CO_CUPON = null; inp.value = ""; inp.disabled = false; $("#t-cupon-btn").textContent = "Aplicar"; msg.textContent = "Cupón quitado."; $("#t-co-totales").innerHTML = totalesHTML(); return; }
  if (!code) return;
  msg.textContent = "Validando…";
  try {
    const r = await (await fetch(`/api/tienda/cupon?code=${encodeURIComponent(code)}&subtotal=${CO_PROD}`)).json();
    if (r.ok) { CO_CUPON = r; inp.disabled = true; $("#t-cupon-btn").textContent = "Quitar"; msg.innerHTML = `✅ Cupón <b>${esc(r.code)}</b> aplicado: −${precio(r.descuento)}`; }
    else { CO_CUPON = null; msg.textContent = "⚠️ " + (r.error || "Cupón inválido"); }
  } catch { msg.textContent = "No se pudo validar el cupón."; }
  $("#t-co-totales").innerHTML = totalesHTML();
}

function checkout() {
  if (!CART.length) return;

  // Verificar stock antes de mostrar el formulario
  const sinStock = CART.flatMap(i => {
    const prod = PRODS.find(p => p.id === i.id);
    if (!prod) return [];
    const obj = i.variationId ? (prod.variaciones || []).find(v => v.id === i.variationId) : prod;
    if (!obj) return [];
    if (!hayStock(obj)) return [{ ...i, motivo: "sin stock" }];
    if (obj.stock != null && i.qty > obj.stock) return [{ ...i, motivo: `pedís ${i.qty}, hay ${obj.stock}` }];
    return [];
  });
  if (sinStock.length) {
    const lista = sinStock.map(i => `<li>${esc(i.nombre)}${i.label ? ` · ${esc(i.label)}` : ""} <span style="color:#888;font-size:12px">(${esc(i.motivo)})</span></li>`).join("");
    $("#t-modal-body").innerHTML = `<div class="t-co" style="grid-column:1/-1">
      <h2>⚠️ Productos sin stock</h2>
      <p style="color:var(--text-mid);margin-bottom:16px">Estos artículos ya no tienen stock disponible:</p>
      <ul style="margin:0 0 24px;padding-left:20px;color:var(--text-mid);line-height:1.8">${lista}</ul>
      <button class="t-btn-grande" id="t-co-quitar">Quitar del carrito y continuar</button>
      <button class="t-btn-grande t-btn-sec" style="margin-top:10px" id="t-co-volver">Volver al carrito</button>
    </div>`;
    VC_OPEN = false;
    $("#t-cart").classList.add("hidden");
    $("#t-modal").classList.remove("hidden");
    window.scrollTo(0, 0);
    $("#t-co-quitar").onclick = () => {
      const claves = new Set(sinStock.map(i => i.key));
      CART = CART.filter(i => !claves.has(i.key));
      guardarCarrito(); renderCarrito();
      cerrarProducto();
      if (CART.length) checkout();
    };
    $("#t-co-volver").onclick = () => { cerrarProducto(); $("#t-cart").classList.remove("hidden"); };
    return;
  }

  CO_RATE = null; CO_PAGO = "transferencia"; CO_CUPON = null;
  CO_PROD = CART.reduce((s, i) => s + i.precio * i.qty, 0);
  const items = CART.map((i) => `<div class="t-co-item"><span>${i.qty}× ${esc(i.nombre)}${i.label ? " · " + esc(i.label) : ""}</span><b>${precio(i.precio * i.qty)}</b></div>`).join("");
  const provOpts = PROV_AR.map(([c, n]) => `<option value="${c}">${esc(n)}</option>`).join("");
  $("#t-modal-body").innerHTML = `<div class="t-co" style="grid-column:1/-1">
    <h2 class="t-co-titulo">Finalizar compra</h2>
    <form id="t-co-form" class="t-co-form">
      <div class="t-co-left">
        ${STAFF ? `<div class="t-co-staff">
          <strong>🧑‍💼 Vendedor: cargar a nombre de un cliente</strong>
          <input id="t-co-cli" placeholder="Buscar por teléfono, email o nombre…" autocomplete="off">
          <div id="t-co-cli-sug" class="t-co-cli-sug"></div>
          <div id="t-co-cli-sel"></div>
        </div>` : ""}
        <div class="t-co-fields">
          <label>Nombre y apellido<input name="nombre" required value="${esc(YO.nombre || "")}"></label>
          <label>Email<input name="email" type="email" required value="${esc(YO.email || "")}" ${YO.autenticado ? "readonly" : ""}></label>
          <label>Teléfono / WhatsApp<input name="telefono" inputmode="tel" placeholder="Ej: 381 555 1234"></label>
        </div>
        <div class="t-co-section">
          <div class="t-co-section-tit">Método de envío</div>
          <div class="t-co-envio">
            <label class="t-co-radio"><input type="radio" name="metodo" value="retiro" checked> Retiro en el local (gratis)</label>
            <label class="t-co-radio"><input type="radio" name="metodo" value="local"> 🛵 Envío en Tucumán (cadete)</label>
            <label class="t-co-radio"><input type="radio" name="metodo" value="envio"> 📦 Envío a domicilio (Andreani)</label>
          </div>
          <div id="t-co-dir" class="t-co-dir hidden">
            <label>Dirección<input name="calle" placeholder="Calle y número"></label>
            <div class="t-co-row">
              <label>Localidad<input name="ciudad"></label>
              <label>Provincia<select name="provincia">${provOpts}</select></label>
              <label>CP<input name="cp" inputmode="numeric" placeholder="Ej: 4000"></label>
            </div>
            <label>DNI (requerido para Andreani)<input name="dni" inputmode="numeric" placeholder="Sin puntos"></label>
            <button type="button" class="t-co-calc" id="t-co-calc">Calcular envío</button>
            <div id="t-co-rates" class="t-co-rates"></div>
          </div>
        </div>
        <label>Notas (opcional)<textarea name="notas" rows="2" placeholder="Aclaraciones para tu pedido"></textarea></label>
        <div class="t-co-cupon"><input id="t-cupon-code" placeholder="🎟️ Código de descuento" autocomplete="off"><button type="button" class="t-co-calc" id="t-cupon-btn">Aplicar</button></div>
        <div id="t-cupon-msg" class="t-cart-nota" style="text-align:left"></div>
      </div>
      <div class="t-co-right">
        <div class="t-co-resumen">
          <div class="t-co-resumen-tit">Tu pedido</div>
          ${items}
          <div id="t-co-totales">${totalesHTML()}</div>
        </div>
        <div class="t-co-pago">
          <div class="t-co-pago-tit">Medio de pago</div>
          <label class="t-co-radio"><input type="radio" name="pago" value="transferencia" checked> 🏦 Transferencia bancaria</label>
          <label class="t-co-radio"><input type="radio" name="pago" value="efectivo"> 💵 Efectivo (retiro)</label>
          <label class="t-co-radio"><input type="radio" name="pago" value="mp"> 💳 Mercado Pago / tarjeta${RECARGO ? ` <small>(+${RECARGO}%)</small>` : ""}</label>
          ${NAVE_ON ? `<label class="t-co-radio"><input type="radio" name="pago" value="nave"> 🟠 Nave (Naranja X) / tarjeta${RECARGO ? ` <small>(+${RECARGO}%)</small>` : ""}</label>` : ""}
        </div>
        <p class="t-cart-nota" style="text-align:left" id="t-co-nota">Coordinás el <strong>pago por transferencia</strong>. Te pasamos los datos al confirmar.</p>
        <button type="submit" class="t-btn-grande" id="t-co-pagar">Confirmar pedido →</button>
      </div>
    </form>
  </div>`;
  $("#t-cart").classList.add("hidden");
  $("#t-modal").classList.remove("hidden");
  const form = $("#t-co-form");
  { const cb = $("#t-cupon-btn"); if (cb) cb.onclick = aplicarCupon; }
  form.metodo.forEach((r) => r.onchange = () => {
    const m = form.metodo.value, local = m === "local";
    $("#t-co-dir").classList.toggle("hidden", m === "retiro");
    const calc = $("#t-co-calc"); if (calc) calc.style.display = local ? "none" : "";
    if (local) {
      const desde = Number(ENVIO_TUC.gratis_desde) || 0, fijo = Number(ENVIO_TUC.fijo) || 0;
      const costo = (desde > 0 && CO_PROD >= desde) ? 0 : fijo;
      CO_RATE = { rate_id: "local", name: costo > 0 ? "Envío en Tucumán (cadete)" : "Envío gratis (Tucumán)", price: costo };
      $("#t-co-rates").innerHTML = `<div class="t-co-rate" style="border-color:var(--rose-500)"><span>🛵 ${CO_RATE.name}</span><b>${precio(costo)}</b></div>`;
    } else { CO_RATE = null; $("#t-co-rates").innerHTML = ""; }
    $("#t-co-totales").innerHTML = totalesHTML();
  });
  // si cambia el destino, las tarifas de Andreani quedan obsoletas (no las del cadete local)
  ["provincia", "cp", "calle", "ciudad"].forEach((n) => form[n].addEventListener("input", () => {
    if (CO_RATE && form.metodo.value === "envio") { CO_RATE = null; $("#t-co-rates").innerHTML = ""; $("#t-co-totales").innerHTML = totalesHTML(); }
  }));
  form.pago.forEach((r) => r.onchange = () => {
    CO_PAGO = form.pago.value;
    $("#t-co-totales").innerHTML = totalesHTML();
    const online = CO_PAGO === "mp" || CO_PAGO === "nave";
    $("#t-co-pagar").textContent = online ? "Ir a pagar →" : "Confirmar pedido →";
    $("#t-co-nota").innerHTML = CO_PAGO === "mp" ? "Pagás con <strong>Mercado Pago</strong> de forma segura. El pago se procesa al continuar."
      : CO_PAGO === "nave" ? "Pagás con <strong>Nave (Naranja X)</strong> de forma segura. El pago se procesa al continuar."
      : CO_PAGO === "transferencia" ? "Coordinás el <strong>pago por transferencia</strong>. Te pasamos los datos al confirmar."
      : "Pagás en <strong>efectivo al retirar</strong> en el local.";
  });
  $("#t-co-calc").onclick = () => calcularEnvioFront(form);
  form.onsubmit = enviarCheckout;
  if (STAFF) { let _ct; const cq = $("#t-co-cli"); if (cq) cq.oninput = () => { clearTimeout(_ct); _ct = setTimeout(() => buscarClienteCheckout(cq.value), 250); }; }
}
// Staff: buscar y elegir un cliente para vender a su nombre desde el checkout
async function buscarClienteCheckout(q) {
  const cont = $("#t-co-cli-sug"); if (!cont) return;
  if ((q || "").trim().length < 3) { cont.innerHTML = ""; return; }
  try {
    const d = await (await fetch("/api/admin/clientes/buscar?q=" + encodeURIComponent(q))).json();
    cont.innerHTML = (d.clientes || []).map((c, i) => `<div class="t-co-cli-item" data-cc="${i}"><strong>${esc(c.nombre || c.email)}</strong><small>${esc(c.telefono || "")} · ${esc(c.email || "")}</small></div>`).join("") || '<p class="t-cart-nota" style="text-align:left">Sin coincidencias.</p>';
    cont.querySelectorAll("[data-cc]").forEach((el) => el.onclick = () => elegirClienteCheckout(d.clientes[+el.dataset.cc]));
  } catch {}
}
function elegirClienteCheckout(c) {
  if (!c) return;
  const f = $("#t-co-form");
  f.nombre.value = c.nombre || "";
  f.email.value = c.email || ""; f.email.removeAttribute("readonly");
  f.telefono.value = c.telefono || "";
  $("#t-co-cli-sug").innerHTML = ""; $("#t-co-cli").value = "";
  const e = c.entrega; let dirTxt = "Sin dirección cargada (confirmá con el cliente)";
  if (e && e.calle) {
    dirTxt = [e.calle, e.ciudad, e.provincia, e.cp].filter(Boolean).join(", ");
    const rEnvio = [...f.metodo].find((r) => r.value === "envio"); if (rEnvio) { rEnvio.checked = true; rEnvio.dispatchEvent(new Event("change")); }
    if (f.calle) f.calle.value = e.calle || "";
    if (f.ciudad) f.ciudad.value = e.ciudad || "";
    if (f.cp) f.cp.value = e.cp || "";
    if (f.provincia && e.provincia) { for (const o of f.provincia.options) { if (o.value === e.provincia || o.text.toLowerCase().includes(String(e.provincia).toLowerCase())) { f.provincia.value = o.value; break; } } }
    if (f.dni && c.doc) f.dni.value = c.doc;
  }
  $("#t-co-cli-sel").innerHTML = `<div class="t-co-cli-card">🧾 Vendiendo a: <strong>${esc(c.nombre || c.email)}</strong><br><small>📦 ${esc(dirTxt)}</small></div>`;
}

async function calcularEnvioFront(f) {
  const cp = f.cp.value.trim(), prov = f.provincia.value;
  if (!cp || !prov) return toast("Elegí provincia y CP");
  const btn = $("#t-co-calc"), cont = $("#t-co-rates");
  btn.disabled = true; const pv = btn.textContent; btn.textContent = "Calculando…";
  cont.innerHTML = '<p class="t-cart-nota" style="text-align:left">Consultando tarifas…</p>';
  try {
    const r = await (await fetch("/api/tienda/envio", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items: CART.map((i) => ({ id: i.id, variationId: i.variationId, qty: i.qty })), address: { state: prov, city: f.ciudad.value, postcode: cp, address_1: f.calle.value } }),
    })).json();
    if (r.ok && r.rates && r.rates.length) {
      cont.innerHTML = r.rates.map((rt) => `<label class="t-co-rate"><input type="radio" name="rate" value="${esc(rt.rate_id)}"><span>${esc(rt.name)}</span><b>${precio(rt.price)}</b></label>`).join("");
      cont.querySelectorAll('input[name="rate"]').forEach((inp) => inp.onchange = () => { CO_RATE = r.rates.find((x) => x.rate_id === inp.value); $("#t-co-totales").innerHTML = totalesHTML(); });
    } else if (r.ok) {
      cont.innerHTML = '<p class="t-cart-nota" style="text-align:left">No hay envío a domicilio para ese CP. Revisá el código postal o elegí "Retiro en el local".</p>';
    } else { cont.innerHTML = ""; toast(r.error || "No se pudo calcular"); }
  } catch { cont.innerHTML = ""; toast("No se pudo calcular el envío"); }
  btn.disabled = false; btn.textContent = pv;
}

async function enviarCheckout(e) {
  e.preventDefault();
  const f = e.target, btn = $("#t-co-pagar");
  const metodo = f.metodo.value;
  if (metodo === "local") {
    if (!f.calle.value.trim()) return toast("Completá la dirección para el envío con cadete");
  } else if (metodo === "envio") {
    if (!f.calle.value.trim() || !f.ciudad.value.trim() || !f.cp.value.trim()) return toast("Completá la dirección de envío");
    if (f.provincia.value !== "T" && !f.dni.value.trim()) return toast("Para el envío por Andreani necesitamos tu DNI");
    if (!CO_RATE) return toast("Calculá y elegí una opción de envío");
  }
  btn.disabled = true; const prev = btn.textContent; btn.textContent = "Creando tu pedido…";
  try {
    const r = await (await fetch("/api/tienda/checkout", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        items: CART.map((i) => ({ id: i.id, variationId: i.variationId, qty: i.qty })),
        cliente: { nombre: f.nombre.value, email: f.email.value, telefono: f.telefono.value },
        envio: { metodo, calle: f.calle.value, ciudad: f.ciudad.value, provincia: f.provincia.value, cp: f.cp.value, dni: f.dni ? f.dni.value : "", notas: f.notas.value, rate_id: CO_RATE ? CO_RATE.rate_id : "" },
        metodo_pago: CO_PAGO, cupon: CO_CUPON ? CO_CUPON.code : "",
      }),
    })).json();
    if (r.ok && r.pay_url) { localStorage.removeItem("damia_cart"); location.href = r.pay_url; return; }
    toast(r.error || "No se pudo crear el pedido");
  } catch { toast("No se pudo crear el pedido"); }
  btn.disabled = false; btn.textContent = prev;
}

// ---------- Eventos ----------
document.addEventListener("click", (e) => {
  const ssel = e.target.closest("[data-sugsel]");
  if (ssel) { SUG_SEL = Number(ssel.dataset.sugsel); SUG_VAR = null; SUG_QTY = 1; renderSug(); return; }
  const sq = e.target.closest("[data-sugqty]");
  if (sq) { SUG_QTY = Math.max(1, SUG_QTY + Number(sq.dataset.sugqty)); renderSug(); return; }
  const sadd = e.target.closest("[data-sugaddsel]");
  if (sadd) { const p = PROD_BY_ID_T(SUG_SEL); if (!p || (p.tipo === "variable" && !SUG_VAR)) return; agregar(p, SUG_VAR, SUG_QTY); ocultarSug(); return; }
  const sp = e.target.closest("[data-sugprod]");
  if (sp) { abrirProducto(Number(sp.dataset.sugprod)); ocultarSug(); $("#t-q").blur(); return; }
  if (!e.target.closest(".t-search")) ocultarSug();
  const add = e.target.closest("[data-add]");
  if (add) { const p = PRODS.find((x) => x.id === Number(add.dataset.add)); if (p.tipo === "variable" && p.variaciones.length) return abrirProducto(p.id); return agregar(p, null, 1); }
  const prod = e.target.closest("[data-prod]");
  if (prod && !e.target.closest("[data-add]")) return abrirProducto(Number(prod.dataset.prod));
  const cp = e.target.closest("[data-cat-padre]");
  if (cp) { catPadre = cp.dataset.catPadre; catHija = ""; mostrar = 24; renderCats(); renderGrid(); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
  const ch = e.target.closest("[data-cat-hija]");
  if (ch) { catHija = ch.dataset.catHija; mostrar = 24; renderCats(); renderGrid(); return; }
  if (e.target.id === "t-mas-btn") { mostrar += 24; renderGrid(); return; }
  const qb = e.target.closest("[data-qty]");
  if (qb) { MODAL_QTY = Math.max(1, MODAL_QTY + Number(qb.dataset.qty)); renderModal(); return; }
  if (e.target.id === "t-add-modal") { const p = MODAL_PROD; if (p.tipo === "variable" && !MODAL_VAR) return; agregar(p, MODAL_VAR, MODAL_QTY); cerrarProducto(); return; }
  const cq = e.target.closest("[data-cq]");
  if (cq) { const [key, d] = cq.dataset.cq.split("|"); const it = CART.find((i) => i.key === key); if (it) { const cap = (it.max && it.max > 1) ? it.max : 99; it.qty = Math.max(1, Math.min(it.qty + Number(d), cap)); guardarCarrito(); renderCarrito(); if (VC_OPEN) verCarritoModal(); } return; }
  const cd = e.target.closest("[data-cdel]");
  if (cd) { CART = CART.filter((i) => i.key !== cd.dataset.cdel); guardarCarrito(); renderCarrito(); if (VC_OPEN) { if (CART.length) verCarritoModal(); else cerrarProducto(); } return; }
});
document.addEventListener("change", (e) => {
  if (e.target.id === "t-var-sel") { MODAL_VAR = e.target.value ? Number(e.target.value) : null; MODAL_QTY = 1; renderModal(); }
  if (e.target.id === "sug-var") { SUG_VAR = e.target.value ? Number(e.target.value) : null; SUG_QTY = 1; renderSug(); }
});
$("#t-q").addEventListener("input", () => { mostrar = 24; renderGrid(); renderSug(); });
// Enter: cierra el popup y deja ver la grilla ya filtrada (para cuando lo buscado no está sugerido)
$("#t-q").addEventListener("keydown", (e) => {
  if (e.key === "Enter") { e.preventDefault(); ocultarSug(); $("#t-q").blur(); const g = document.querySelector("main"); if (g) g.scrollIntoView({ behavior: "smooth", block: "start" }); }
  else if (e.key === "Escape") { ocultarSug(); $("#t-q").blur(); }
});
// Al hacer scroll en la página, cerrar el popup de sugerencias
window.addEventListener("scroll", () => { const d = $("#t-sug"); if (d && !d.classList.contains("hidden")) ocultarSug(); }, { passive: true });
$("#t-modal-close").onclick = cerrarProducto;
$("#t-modal").onclick = (e) => { if (e.target.id === "t-modal") cerrarProducto(); };
$("#t-cart-btn").onclick = () => $("#t-cart").classList.remove("hidden");
$("#t-cart-close").onclick = () => $("#t-cart").classList.add("hidden");
$("#t-cart").onclick = (e) => { if (e.target.id === "t-cart") $("#t-cart").classList.add("hidden"); };
$("#t-checkout").onclick = checkout;

init();

// Título animado al irse a otra pestaña (avisa si dejó productos en el carrito)
(function () {
  const orig = document.title;
  let t = null, i = 0;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      let n = 0; try { n = JSON.parse(localStorage.getItem("damia_cart") || "[]").reduce((s, x) => s + (x.qty || 0), 0); } catch {}
      const msgs = n > 0 ? [`🛒 Tenés ${n} en el carrito`, "👋 ¡Volvé a tu compra!", "📱 Punto Damia"] : ["👋 ¡Volvé!", "📱 Accesorios tech", "✨ Punto Damia"];
      t = setInterval(() => { document.title = msgs[i++ % msgs.length]; }, 1100);
    } else { clearInterval(t); t = null; i = 0; document.title = orig; }
  });
})();
