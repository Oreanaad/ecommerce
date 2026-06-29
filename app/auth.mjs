// Autenticación: login por código al email (Resend), sesiones firmadas, roles e import de clientes.
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHmac, randomInt, scryptSync, randomBytes, timingSafeEqual } from "node:crypto";
import { join } from "node:path";
import { dataDir, loadResend, duenos, appSecret } from "../scripts/lib.mjs";
import { upsertCliente, getCliente } from "./db.mjs";
import { verificarWP } from "./wp-pass.mjs";

// Dominios de bots/SEO-spam (cuentas basura registradas en el WordPress)
const SPAM_DOMINIOS = ["seoautomationpro.com", "welcometotijuana.com", "travel-e-store.com", "gsasearchengineranker.com", "verifiedlinklist.com", "budgetthailandtravel.com", "poochta.ru", "poochta.com", "thematinggrounds.com", "modelsexy.cfd", "thewisetransfer.click", "streetwormail.com", "aurevoirmail.com", "bientotmail.com", "wildbmail.com", "triol.site", "scrap-transport-musical-hospital-brainstorm.com"];
const esSpamEmail = (email) => { const dom = ((email || "").split("@")[1] || "").toLowerCase(); return SPAM_DOMINIOS.some((s) => dom === s || dom.endsWith("." + s)); };

// Normaliza un teléfono a formato WhatsApp AR: +549 + código de área + número (saca país, 0 troncal, 15 de celular, guiones/espacios).
// Devuelve { ok, valor } donde ok=false marca un número dudoso (no quedó en 10 dígitos nacionales) para revisar a mano.
export function normalizarTelAR(raw) {
  let t = String(raw || "").replace(/\D/g, "");
  if (!t) return { ok: false, valor: "", motivo: "vacío" };
  if (t.startsWith("00")) t = t.slice(2);            // salida internacional
  if (t.startsWith("54")) { t = t.slice(2); if (t.startsWith("9")) t = t.slice(1); } // país + 9 móvil
  if (t.startsWith("0")) t = t.slice(1);             // 0 troncal
  // sacar el "15" de celular: si está justo después del área (2-4 díg.) y sacándolo quedan 10 díg.
  if (t.length > 10) {
    for (const al of [4, 3, 2]) {
      if (t.length - 2 === 10 && t.slice(al, al + 2) === "15") { t = t.slice(0, al) + t.slice(al + 2); break; }
    }
  }
  if (t.length !== 10) return { ok: false, valor: "+549" + t, motivo: `quedó en ${t.length} díg (esperado 10)` };
  return { ok: true, valor: "+549" + t };
}

export function crearAuth(ROOT) {
  const DATA = dataDir(ROOT);
  const USERS_PATH = join(DATA, "usuarios.json");
  const codigos = new Map(); // email -> { codigo, exp, intentos }

  async function leerUsuarios() {
    try { return JSON.parse(await readFile(USERS_PATH, "utf8")); } catch { return { usuarios: [] }; }
  }
  async function guardarUsuarios(d) { await mkdir(DATA, { recursive: true }); await writeFile(USERS_PATH, JSON.stringify(d, null, 2)); }

  async function usuarioDe(email) {
    email = (email || "").toLowerCase().trim();
    const d = await leerUsuarios();
    return d.usuarios.find((u) => (u.email || "").toLowerCase() === email) || null;
  }
  async function rolDe(email) {
    email = (email || "").toLowerCase().trim();
    if (duenos().includes(email)) return "dueno";
    const u = await usuarioDe(email);
    return u ? (u.rol || "cliente") : "cliente";
  }

  // ---- Sesiones firmadas (cookie HMAC) ----
  function firmar(email) {
    const payload = Buffer.from(JSON.stringify({ e: email.toLowerCase(), exp: Date.now() + 2592000000 })).toString("base64url");
    const sig = createHmac("sha256", appSecret()).update(payload).digest("base64url");
    return payload + "." + sig;
  }
  function leerSesion(cookieHeader) {
    const m = (cookieHeader || "").split(";").map((s) => s.trim()).find((s) => s.startsWith("cli="));
    if (!m) return null;
    const [payload, sig] = m.slice(4).split(".");
    if (!payload || !sig) return null;
    if (createHmac("sha256", appSecret()).update(payload).digest("base64url") !== sig) return null;
    try { const o = JSON.parse(Buffer.from(payload, "base64url").toString()); return o.exp > Date.now() ? o.e : null; } catch { return null; }
  }
  const cookieSet = (email) => `cli=${firmar(email)}; HttpOnly; Path=/; Max-Age=2592000; SameSite=Lax`;
  const cookieClear = () => `cli=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`;

  // ---- Código por email ----
  async function solicitarCodigo(email) {
    email = (email || "").toLowerCase().trim();
    if (!email || !email.includes("@")) return { error: "Email inválido" };
    const codigo = String(randomInt(0, 1000000)).padStart(6, "0");
    codigos.set(email, { codigo, exp: Date.now() + 600000, intentos: 0 });
    const resend = await loadResend(ROOT);
    if (resend && resend.api_key) {
      try {
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + resend.api_key },
          body: JSON.stringify({
            from: resend.from, to: [email], reply_to: "elpasajedental@gmail.com",
            subject: `Tu código de acceso es ${codigo}`,
            text: `Tu código de acceso a El Pasaje Dental es: ${codigo}\n\nVence en 10 minutos. Si no lo pediste, ignorá este mensaje.`,
            html: `<div style="font-family:-apple-system,Segoe UI,sans-serif;max-width:440px;margin:auto"><h2 style="color:#DE3667;font-family:sans-serif">El Pasaje Dental</h2><p style="color:#334155">Tu código de acceso es:</p><p style="font-size:34px;font-weight:800;letter-spacing:8px;color:#7a1040;margin:8px 0">${codigo}</p><p style="color:#64748b;font-size:14px">Vence en 10 minutos. Si no lo pediste, ignorá este mensaje.</p></div>`,
            headers: { "X-Entity-Ref-ID": String(Date.now()) },
          }),
        });
        if (!r.ok) return { error: "No se pudo enviar el email (revisá la config de Resend)" };
        return { ok: true };
      } catch { return { error: "No se pudo enviar el email" }; }
    }
    return { ok: true, dev_codigo: codigo }; // modo prueba sin Resend
  }

  async function verificarCodigo(email, codigo) {
    email = (email || "").toLowerCase().trim();
    const rec = codigos.get(email);
    if (!rec) return { error: "Pedí un código primero" };
    if (Date.now() > rec.exp) { codigos.delete(email); return { error: "El código venció, pedí uno nuevo" }; }
    if (++rec.intentos > 6) { codigos.delete(email); return { error: "Demasiados intentos, pedí un código nuevo" }; }
    if (String(codigo).trim() !== rec.codigo) return { error: "Código incorrecto" };
    codigos.delete(email);
    let u = await usuarioDe(email);
    if (!u) {
      const rol = duenos().includes(email) ? "dueno" : "cliente";
      await asegurarEnDB(email, "");
      const d = await leerUsuarios();
      u = { email, nombre: "", rol, creado: new Date().toISOString() };
      d.usuarios.push(u); await guardarUsuarios(d);
    }
    return { ok: true, email, rol: await rolDe(email), nombre: u.nombre || "", tiene_clave: !!u.clave, cookie: cookieSet(email) };
  }

  // ---- Contraseña opcional (para entrar directo) ----
  function hashClave(pass) {
    const salt = randomBytes(16).toString("hex");
    return salt + ":" + scryptSync(pass, salt, 32).toString("hex");
  }
  function verifClave(pass, stored) {
    if (!stored || !stored.includes(":")) return false;
    const [salt, h] = stored.split(":");
    const calc = scryptSync(pass, salt, 32), orig = Buffer.from(h, "hex");
    return calc.length === orig.length && timingSafeEqual(calc, orig);
  }
  async function setClave(email, pass) {
    email = (email || "").toLowerCase().trim();
    if (!pass || pass.length < 4) return { error: "La contraseña debe tener al menos 4 caracteres" };
    const d = await leerUsuarios();
    let u = d.usuarios.find((x) => (x.email || "").toLowerCase() === email);
    if (!u) { u = { email, nombre: "", rol: duenos().includes(email) ? "dueno" : "cliente", creado: new Date().toISOString() }; d.usuarios.push(u); }
    u.clave = hashClave(pass);
    await guardarUsuarios(d);
    return { ok: true };
  }
  async function loginClave(email, pass) {
    email = (email || "").toLowerCase().trim();
    const u = await usuarioDe(email);
    if (!u) return { error: "Email o contraseña incorrectos" };
    let ok = false;
    if (u.clave) ok = verifClave(pass, u.clave);            // contraseña propia (scrypt)
    if (!ok && u.wp_pass) ok = verificarWP(pass, u.wp_pass); // contraseña histórica de WordPress
    if (!ok) {
      if (!u.clave && !u.wp_pass) return { error: "Este email no tiene contraseña. Entrá con código." };
      return { error: "Email o contraseña incorrectos" };
    }
    return { ok: true, email, rol: await rolDe(email), nombre: u.nombre || "", cookie: cookieSet(email) };
  }

  // ---- Importar usuarios + claves de WordPress desde data/wp-usuarios-seed.json (idempotente) ----
  async function importarSeedWP() {
    let seed;
    try { seed = JSON.parse(await readFile(join(ROOT, "data/wp-usuarios-seed.json"), "utf8")); }
    catch { return { error: "No se encontró data/wp-usuarios-seed.json" }; }
    const d = await leerUsuarios();
    const byEmail = new Map(d.usuarios.map((u) => [(u.email || "").toLowerCase(), u]));
    let nuevos = 0, claves = 0;
    for (const s of seed.usuarios || []) {
      const email = (s.email || "").toLowerCase(); if (!email) continue;
      let u = byEmail.get(email);
      if (!u) {
        u = { email, nombre: s.nombre || "", rol: s.rol || "cliente", origen: "wordpress", creado: new Date().toISOString() };
        d.usuarios.push(u); byEmail.set(email, u); nuevos++;
      }
      if (!u.wp_pass && s.wp_pass) { u.wp_pass = s.wp_pass; claves++; }
      if (!u.nombre && s.nombre) u.nombre = s.nombre;
      if (s.spam && u.spam === undefined) u.spam = true;
    }
    await guardarUsuarios(d);
    return { ok: true, nuevos, claves, total: d.usuarios.length };
  }

  // ---- Asegura que el cliente exista en la base de datos propia. ----
  async function asegurarEnDB(email, nombre) {
    try {
      const partes = (nombre || "").trim().split(/\s+/);
      const c = await upsertCliente({
        email: email.toLowerCase(),
        nombre: partes[0] || "",
        apellido: partes.slice(1).join(" ") || "",
        rol: duenos().includes(email.toLowerCase()) ? "dueno" : "cliente",
        origen: "tienda",
      });
      return c ? { id: c.id, nombre: `${c.nombre || ""} ${c.apellido || ""}`.trim() } : null;
    } catch { return null; }
  }

  // ---- Importar clientes (ahora desde la DB propia) ----
  async function importarClientes() {
    return { ok: true, mensaje: "Los clientes ahora se gestionan en la base de datos propia." };
  }

  // ---- Actualiza campos de un cliente (ej. CUIT/DNI para facturar) ----
  async function actualizarCliente(email, campos) {
    email = (email || "").toLowerCase().trim();
    const d = await leerUsuarios();
    const u = d.usuarios.find((x) => (x.email || "").toLowerCase() === email);
    if (!u) return { error: "Cliente no encontrado" };
    if (campos && campos.telefono) { const n = normalizarTelAR(campos.telefono); if (n.ok) campos.telefono = n.valor; }
    for (const [k, v] of Object.entries(campos || {})) u[k] = v;
    await guardarUsuarios(d);
    return { ok: true };
  }

  // ---- Purga cuentas bot (dominios spam) que no tengan datos reales (tel/domicilio/clave propia) ----
  async function purgarSpam() {
    const d = await leerUsuarios();
    const antes = d.usuarios.length;
    d.usuarios = d.usuarios.filter((u) => !(esSpamEmail(u.email) && !u.telefono && !u.entrega && !u.clave));
    await guardarUsuarios(d);
    return { ok: true, borrados: antes - d.usuarios.length, quedan: d.usuarios.length };
  }

  // ---- Normaliza TODOS los teléfonos al formato +549<área><número> (dry-run por defecto) ----
  async function normalizarTelefonos({ apply = false } = {}) {
    const d = await leerUsuarios();
    const cambian = [], revisar = [];
    let yaok = 0, sinTel = 0;
    for (const u of d.usuarios) {
      if (!u.telefono) { sinTel++; continue; }
      const n = normalizarTelAR(u.telefono);
      if (!n.ok) { revisar.push({ email: u.email, nombre: u.nombre || "", antes: u.telefono, intento: n.valor, motivo: n.motivo }); continue; }
      if (n.valor === u.telefono) { yaok++; continue; }
      cambian.push({ email: u.email, nombre: u.nombre || "", antes: u.telefono, despues: n.valor });
      if (apply) u.telefono = n.valor;
    }
    if (apply && cambian.length) await guardarUsuarios(d);
    return { ok: true, aplicado: apply, total: d.usuarios.length, sin_telefono: sinTel, ya_ok: yaok, cambian, revisar };
  }

  // ---- Asegura que el cliente exista en la DB y en usuarios.json ----
  async function asegurarCliente(email, nombre) {
    email = (email || "").toLowerCase().trim();
    if (!email || !email.includes("@")) return null;
    // Asegurar en usuarios.json (para sesiones/roles)
    const d = await leerUsuarios();
    let u = d.usuarios.find((x) => (x.email || "").toLowerCase() === email);
    if (!u) {
      u = { email, nombre: nombre || "", rol: duenos().includes(email) ? "dueno" : "cliente", creado: new Date().toISOString() };
      d.usuarios.push(u); await guardarUsuarios(d);
    } else if (!u.nombre && nombre) { u.nombre = nombre; await guardarUsuarios(d); }
    // Asegurar en DB
    return await asegurarEnDB(email, nombre || u.nombre || "");
  }

  return { leerUsuarios, guardarUsuarios, usuarioDe, rolDe, leerSesion, cookieSet, cookieClear, solicitarCodigo, verificarCodigo, importarClientes, importarSeedWP, setClave, loginClave, asegurarCliente, purgarSpam, actualizarCliente, normalizarTelefonos };
}
