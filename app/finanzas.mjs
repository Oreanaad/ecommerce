// Módulo de Finanzas / Caja: gastos, cheques, acreditaciones de plataformas, compras y cuentas corrientes.
// Datos en finanzas.json sobre el volumen.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { dataDir } from "../scripts/lib.mjs";

const COLECCIONES = ["gastos", "cheques", "acreditaciones", "compras", "ctacte", "movimientos", "proveedores", "envios"];

// Cuentas reales que se siguen en la Caja (saldo = inicial en config + movimientos)
export const CUENTAS = [
  { k: "efectivo", lbl: "Efectivo", emoji: "💵" },
  { k: "banco", lbl: "Banco", emoji: "🏦" },
  { k: "mp", lbl: "Mercado Pago", emoji: "📲" },
  { k: "nave", lbl: "Nave", emoji: "🟣" },
  { k: "naranja", lbl: "Naranja", emoji: "🟠" },
];
const CTA_KEYS = CUENTAS.map((c) => c.k);
// A qué cuenta de la Caja entra el neto cuando se acredita una plataforma
function cuentaDePlataforma(p) {
  const n = String(p || "").toLowerCase();
  if (n.includes("mercado") || n === "mp") return "mp";
  if (n.includes("nave")) return "nave";
  if (n.includes("naranja")) return "naranja";
  return "banco"; // Viumi, Posnet, link de pago, etc. → acreditan al banco
}

const DEFAULT = {
  config: {
    saldo_efectivo: 0,
    saldo_banco: 0,
    saldo_mp: 0,
    saldo_nave: 0,
    saldo_naranja: 0,
    impuesto_cheque: 0.6,            // % impuesto al cheque
    plataformas: [
      { nombre: "Mercado Pago", cargo_pct: 0, dias: 0 },
      { nombre: "Viumi", cargo_pct: 0, dias: 0 },
      { nombre: "Nave", cargo_pct: 0, dias: 0 },
      { nombre: "Posnet", cargo_pct: 0, dias: 0 },
    ],
  },
  gastos: [], cheques: [], acreditaciones: [], compras: [], ctacte: [], movimientos: [], proveedores: [], envios: [],
  costos: {}, // { <productId>: costo }
  equilibrio: {}, // { "YYYY-MM": { cf:{cat:monto}, cv:{cat:monto}, ventas } }
};

export function crearFinanzas(ROOT) {
  const PATH = join(dataDir(ROOT), "finanzas.json");
  const id = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  async function leer() {
    try {
      const d = JSON.parse(await readFile(PATH, "utf8"));
      d.config = { ...DEFAULT.config, ...(d.config || {}) };
      for (const c of COLECCIONES) if (!Array.isArray(d[c])) d[c] = [];
      if (!d.costos || typeof d.costos !== "object") d.costos = {};
      if (!d.prodprov || typeof d.prodprov !== "object") d.prodprov = {}; // { <productId>: <proveedorId> }
      if (!d.equilibrio || typeof d.equilibrio !== "object") d.equilibrio = {};
      return d;
    } catch { return JSON.parse(JSON.stringify(DEFAULT)); }
  }
  async function guardar(d) { await mkdir(dataDir(ROOT), { recursive: true }); await writeFile(PATH, JSON.stringify(d, null, 2)); }

  const num = (v) => Number(v) || 0;

  // Saldo actual de cada cuenta = saldo inicial (config) + movimientos del libro diario
  function saldosCuentas(d) {
    const s = {};
    for (const k of CTA_KEYS) s[k] = num(d.config["saldo_" + k]);
    for (const m of d.movimientos || []) {
      const monto = num(m.monto);
      if (m.tipo === "ingreso" && CTA_KEYS.includes(m.cuenta)) s[m.cuenta] += monto;
      else if (m.tipo === "egreso" && CTA_KEYS.includes(m.cuenta)) s[m.cuenta] -= monto;
      else if (m.tipo === "transferencia") {
        if (CTA_KEYS.includes(m.desde)) s[m.desde] -= monto;
        if (CTA_KEYS.includes(m.hacia)) s[m.hacia] += monto;
      }
    }
    return s;
  }

  // Resumen para el tablero de Caja
  function resumen(d) {
    const saldos = saldosCuentas(d);
    const efectivo = saldos.efectivo, banco = saldos.banco;
    const disponible = CTA_KEYS.reduce((t, k) => t + saldos[k], 0);
    const chequesCobrar = d.cheques.filter((x) => x.tipo === "recibido" && ["en cartera", "depositado"].includes(x.estado)).reduce((s, x) => s + num(x.monto), 0);
    const chequesCubrir = d.cheques.filter((x) => x.tipo === "emitido" && !["pagado", "rechazado", "cobrado", "cubierto"].includes(x.estado)).reduce((s, x) => s + num(x.monto), 0);
    // Cheques emitidos VENCIDOS y sin pagar (la fecha ya pasó pero todavía no se debitaron del banco): plata comprometida que aún figura en el banco.
    const hoyStr = new Date().toISOString().slice(0, 10);
    const chequesVencidos = d.cheques.filter((x) => x.tipo === "emitido" && !["pagado", "rechazado", "cobrado", "cubierto"].includes(x.estado) && x.fecha && x.fecha.slice(0, 10) <= hoyStr).reduce((s, x) => s + num(x.monto), 0);
    const acredPend = d.acreditaciones.filter((x) => x.estado !== "acreditado").reduce((s, x) => s + num(x.neto), 0);
    const comprasPend = d.compras.filter((x) => x.estado !== "pagada").reduce((s, x) => s + num(x.monto), 0);
    const ctacteSaldo = d.ctacte.reduce((s, x) => s + (x.tipo === "cobro" ? -num(x.monto) : num(x.monto)), 0);
    // Ingresos / egresos del mes en curso (solo movimientos del libro diario)
    const mes = new Date().toISOString().slice(0, 7);
    let ingresosMes = 0, egresosMes = 0;
    for (const m of d.movimientos || []) {
      if ((m.fecha || m.creado || "").slice(0, 7) !== mes) continue;
      if (m.tipo === "ingreso") ingresosMes += num(m.monto);
      else if (m.tipo === "egreso") egresosMes += num(m.monto);
    }
    return {
      efectivo, banco, saldos, disponible,
      chequesCobrar, chequesCubrir, chequesVencidos, acredPend, comprasPend, ctacteSaldo,
      disponibleReal: disponible - chequesVencidos, // efectivo+banco+… menos los cheques emitidos vencidos sin pagar
      ingresosMes, egresosMes,
      proyectado: disponible + acredPend + chequesCobrar - chequesCubrir - comprasPend,
    };
  }

  // Movimiento "derivado": cuando un cheque se marca pagado o una compra se marca pagada,
  // se descuenta solo de la Caja. Se identifica por ref para no duplicar / poder revertir.
  function sincronizarDerivado(d, coleccion, reg) {
    if (!reg) return;
    const ref = coleccion + ":" + reg.id;
    d.movimientos = (d.movimientos || []).filter((m) => m.ref !== ref);
    if (reg.sin_caja) return; // pagado/cobrado ANTES de empezar a registrar: queda asentado pero NO impacta en la caja (no duplica el egreso)
    let mov = null;
    if (coleccion === "cheques" && reg.tipo === "emitido" && (reg.estado === "pagado" || reg.estado === "cobrado")) {
      const pct = num(d.config && d.config.impuesto_cheque); // % impuesto al cheque cargado en Ajustes
      const conImp = Math.round(num(reg.monto) * (1 + pct / 100) * 100) / 100; // descuenta el monto con impuesto
      mov = { tipo: "egreso", cuenta: "banco", monto: conImp,
        categoria: "Cheques", detalle: `Cheque ${reg.numero || ""} · ${reg.tercero || ""}`.trim(), fecha: (reg.vencimiento || reg.fecha_emision || "").slice(0, 10) };
    } else if (coleccion === "compras" && reg.estado === "pagada") {
      mov = { tipo: "egreso", cuenta: reg.pago === "efectivo" ? "efectivo" : "banco", monto: num(reg.monto),
        categoria: "Mercadería", detalle: `${reg.proveedor || ""} ${reg.concepto || ""}`.trim(), fecha: (reg.fecha || "").slice(0, 10) };
    } else if (coleccion === "gastos" && num(reg.monto) > 0) {
      mov = { tipo: "egreso", cuenta: reg.medio === "efectivo" ? "efectivo" : "banco", monto: num(reg.monto),
        categoria: reg.categoria || "Gastos", detalle: reg.concepto || "Gasto", fecha: (reg.fecha || "").slice(0, 10) };
    } else if (coleccion === "acreditaciones" && reg.estado === "acreditado") {
      const neto = num(reg.neto) > 0 ? num(reg.neto) : Math.round(num(reg.bruto) * (1 - num(reg.cargo_pct) / 100));
      mov = { tipo: "ingreso", cuenta: cuentaDePlataforma(reg.plataforma), monto: neto,
        categoria: "Acreditación", detalle: `${reg.plataforma || "Tarjeta"}${reg.fecha_venta ? " · venta " + reg.fecha_venta : ""}`.trim(), fecha: (reg.fecha_acreditacion || "").slice(0, 10) };
    } else if (coleccion === "ctacte" && reg.tipo === "cobro" && !reg.sin_caja) {
      // Un cobro de cuenta corriente entra a la caja según el medio (el cheque no: se cobra después como cheque recibido)
      const medio = String(reg.medio || "").toLowerCase();
      const cuenta = medio === "efectivo" ? "efectivo" : medio === "transferencia" ? "banco" : ["mp", "nave", "naranja"].includes(medio) ? medio : null;
      if (cuenta) mov = { tipo: "ingreso", cuenta, monto: num(reg.monto),
        categoria: "Cobro cta. cte.", detalle: `Cobro cta cte · ${reg.cliente || reg.email || ""}`.trim(), fecha: (reg.fecha || reg.creado || "").slice(0, 10) };
    }
    if (mov) { mov.id = id(); mov.creado = new Date().toISOString(); mov.ref = ref; mov.auto = true; d.movimientos.unshift(mov); }
  }

  async function todo() { const d = await leer(); return { ...d, resumen: resumen(d) }; }

  async function agregar(coleccion, registro) {
    if (!COLECCIONES.includes(coleccion)) return { error: "Colección inválida" };
    const d = await leer();
    const reg = { id: id(), creado: new Date().toISOString(), ...registro };
    // cálculo automático del neto en acreditaciones
    if (coleccion === "acreditaciones") {
      const bruto = num(reg.bruto), pct = num(reg.cargo_pct);
      reg.neto = reg.neto != null && num(reg.neto) > 0 ? num(reg.neto) : Math.round(bruto * (1 - pct / 100));
      if (!reg.estado) reg.estado = "pendiente";
    }
    d[coleccion].unshift(reg);
    if (["cheques", "compras", "gastos", "acreditaciones", "ctacte"].includes(coleccion)) sincronizarDerivado(d, coleccion, reg);
    await guardar(d);
    return { ok: true, registro: reg };
  }

  async function borrar(coleccion, regId) {
    if (!COLECCIONES.includes(coleccion)) return { error: "Colección inválida" };
    const d = await leer();
    const antes = d[coleccion].length;
    d[coleccion] = d[coleccion].filter((x) => x.id !== regId);
    // si era un cheque/compra, borrar también su movimiento derivado en la Caja
    if (["cheques", "compras", "gastos", "acreditaciones", "ctacte"].includes(coleccion)) d.movimientos = (d.movimientos || []).filter((m) => m.ref !== coleccion + ":" + regId);
    await guardar(d);
    return { ok: true, borrados: antes - d[coleccion].length };
  }

  async function actualizar(coleccion, regId, cambios) {
    if (!COLECCIONES.includes(coleccion)) return { error: "Colección inválida" };
    const d = await leer();
    const r = d[coleccion].find((x) => x.id === regId);
    if (!r) return { error: "No encontrado" };
    Object.assign(r, cambios);
    // recalcular el neto de una acreditación si cambió el bruto o el cargo % (y no se fijó el neto a mano)
    if (coleccion === "acreditaciones" && (cambios.bruto != null || cambios.cargo_pct != null) && cambios.neto == null) r.neto = Math.round(num(r.bruto) * (1 - num(r.cargo_pct) / 100));
    if (["cheques", "compras", "gastos", "acreditaciones", "ctacte"].includes(coleccion)) sincronizarDerivado(d, coleccion, r);
    await guardar(d);
    return { ok: true, registro: r };
  }

  async function guardarConfig(config) {
    const d = await leer();
    d.config = { ...d.config, ...config };
    await guardar(d);
    return { ok: true, config: d.config };
  }

  async function getCostos() { const d = await leer(); return d.costos || {}; }
  async function setCostos(cambios) {
    const d = await leer(); if (!d.costos) d.costos = {};
    for (const [pid, costo] of Object.entries(cambios || {})) {
      const c = Number(costo);
      if (!c || c <= 0) delete d.costos[pid]; else d.costos[pid] = c;
    }
    await guardar(d);
    return { ok: true, total: Object.keys(d.costos).length };
  }

  // Punto de equilibrio mensual
  async function getEquilibrio(mes) {
    const d = await leer();
    const pe = (d.equilibrio || {})[mes] || null;
    const cmvCompras = (d.compras || []).filter((x) => (x.fecha || "").slice(0, 7) === mes).reduce((s, x) => s + num(x.monto), 0);
    return { data: pe, cmv_compras: cmvCompras };
  }
  async function setEquilibrio(mes, data) {
    const d = await leer();
    if (!d.equilibrio) d.equilibrio = {};
    d.equilibrio[mes] = { cf: data.cf || {}, cv: data.cv || {}, ventas: num(data.ventas), actualizado: new Date().toISOString() };
    await guardar(d);
    return { ok: true };
  }
  // Actualiza campos del movimiento de la Caja por su ref (ej. mover "venta:123" de efectivo a banco)
  async function actualizarMovPorRef(ref, cambios) {
    const d = await leer();
    let n = 0;
    for (const m of d.movimientos || []) if (m.ref === ref) { Object.assign(m, cambios); n++; }
    if (n) await guardar(d);
    return { ok: true, actualizados: n };
  }
  // Borra movimiento(s) de la Caja por su ref (ej. "venta:123" al cancelar un pedido)
  async function borrarMovPorRef(ref) {
    const d = await leer();
    const antes = (d.movimientos || []).length;
    d.movimientos = (d.movimientos || []).filter((m) => m.ref !== ref);
    const borrados = antes - d.movimientos.length;
    if (borrados) await guardar(d);
    return { ok: true, borrados };
  }
  // Proveedor por producto (para mostrar/editar en la ficha del producto)
  async function getProvProd() { const d = await leer(); return d.prodprov || {}; }
  async function setProvProd(productId, proveedorId) {
    const d = await leer(); if (!d.prodprov) d.prodprov = {};
    if (proveedorId) d.prodprov[productId] = proveedorId; else delete d.prodprov[productId];
    await guardar(d);
    return { ok: true };
  }
  // Carga masiva proveedor-por-producto (una sola lectura/escritura)
  async function setProvProdBulk(mapa) {
    const d = await leer(); if (!d.prodprov) d.prodprov = {};
    let n = 0;
    for (const [pid, provId] of Object.entries(mapa || {})) { if (provId) { d.prodprov[pid] = provId; n++; } else delete d.prodprov[pid]; }
    await guardar(d);
    return { ok: true, aplicados: n, total: Object.keys(d.prodprov).length };
  }
  return { todo, agregar, borrar, actualizar, guardarConfig, getCostos, setCostos, getProvProd, setProvProd, setProvProdBulk, borrarMovPorRef, actualizarMovPorRef, getEquilibrio, setEquilibrio };
}
