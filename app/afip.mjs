// Facturación electrónica AFIP/ARCA por webservice (WSAA + WSFEv1). Multi-CUIT.
// Certificados por env: AFIP_CERT_<cuit> / AFIP_KEY_<cuit> (base64 del PEM). Fallback AFIP_CERT / AFIP_KEY.
// Nota: los servidores de AFIP usan TLS viejo -> hay que bajar el nivel de seguridad (SECLEVEL=0).
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import https from "node:https";
import { dataDir } from "../scripts/lib.mjs";

const AGENT = new https.Agent({ ciphers: "DEFAULT@SECLEVEL=0", minVersion: "TLSv1.2" });
const WSAA_URL = "https://wsaa.afip.gov.ar/ws/services/LoginCms";
const WSFE_URL = "https://servicios1.afip.gov.ar/wsfev1/service.asmx";
const PADRON_A5_URL = "https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA5";

function soap(url, body, action) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: "POST", agent: AGENT, headers: { "Content-Type": "text/xml; charset=utf-8", SOAPAction: action, "Content-Length": Buffer.byteLength(body) } }, (r) => { let d = ""; r.on("data", (c) => (d += c)); r.on("end", () => resolve(d)); });
    req.on("error", reject); req.write(body); req.end();
  });
}
const pick = (xml, tag) => { const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)); return m ? m[1] : null; };

export function crearAFIP(ROOT) {
  const TOK_PATH = join(dataDir(ROOT), "afip-tokens.json");
  const FACT_PATH = join(dataDir(ROOT), "facturas.json");

  function credenciales(cuit) {
    const c = process.env["AFIP_CERT_" + cuit] || process.env.AFIP_CERT;
    const k = process.env["AFIP_KEY_" + cuit] || process.env.AFIP_KEY;
    if (!c || !k) return null;
    return { cert: Buffer.from(c, "base64").toString(), key: Buffer.from(k, "base64").toString() };
  }
  const leerTok = async () => { try { return JSON.parse(await readFile(TOK_PATH, "utf8")); } catch { return {}; } };
  const guardarTok = async (t) => { await mkdir(dataDir(ROOT), { recursive: true }); await writeFile(TOK_PATH, JSON.stringify(t, null, 2)); };
  const leerFacturas = async () => { try { return JSON.parse(await readFile(FACT_PATH, "utf8")); } catch { return { facturas: [] }; } };
  const guardarFacturas = async (d) => { await mkdir(dataDir(ROOT), { recursive: true }); await writeFile(FACT_PATH, JSON.stringify(d, null, 2)); };

  async function token(cuit, service = "wsfe") {
    const all = await leerTok();
    const ckey = service === "wsfe" ? cuit : cuit + "|" + service;
    if (all[ckey] && all[ckey].exp > Date.now() + 120000) return all[ckey];
    const cred = credenciales(cuit); if (!cred) throw new Error("Sin certificado cargado para el CUIT " + cuit);
    const now = Date.now(), iso = (ms) => new Date(ms).toISOString().replace("Z", "-00:00");
    const tra = `<?xml version="1.0" encoding="UTF-8"?>\n<loginTicketRequest version="1.0">\n<header><uniqueId>${Math.floor(now / 1000)}</uniqueId><generationTime>${iso(now - 600000)}</generationTime><expirationTime>${iso(now + 600000)}</expirationTime></header>\n<service>${service}</service>\n</loginTicketRequest>`;
    const d = tmpdir(), cf = join(d, `afc_${cuit}.pem`), kf = join(d, `afk_${cuit}.pem`), tf = join(d, `aftra_${cuit}.xml`);
    writeFileSync(cf, cred.cert); writeFileSync(kf, cred.key); writeFileSync(tf, tra);
    let cms = "";
    for (const cmd of [`openssl cms -sign -in ${tf} -signer ${cf} -inkey ${kf} -nodetach -outform DER 2>/dev/null | base64 | tr -d '\\n'`, `openssl smime -sign -in ${tf} -signer ${cf} -inkey ${kf} -outform DER -nodetach 2>/dev/null | base64 | tr -d '\\n'`]) {
      try { cms = execSync(cmd, { shell: "/bin/bash" }).toString().trim(); if (cms) break; } catch {}
    }
    if (!cms) throw new Error("No se pudo firmar el TRA (¿openssl disponible?)");
    const env = `<?xml version="1.0"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov"><soapenv:Body><wsaa:loginCms><wsaa:in0>${cms}</wsaa:in0></wsaa:loginCms></soapenv:Body></soapenv:Envelope>`;
    const resp = await soap(WSAA_URL, env, "");
    const dec = resp.replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    const tk = pick(dec, "token"), sg = pick(dec, "sign");
    if (!tk) throw new Error("WSAA: " + (pick(resp, "faultstring") || "no se obtuvo token"));
    const nt = { token: tk, sign: sg, exp: now + 11 * 3600 * 1000 };
    all[ckey] = nt; await guardarTok(all);
    return nt;
  }
  const auth = (cuit, t) => `<ar:Auth><ar:Token>${t.token}</ar:Token><ar:Sign>${t.sign}</ar:Sign><ar:Cuit>${cuit}</ar:Cuit></ar:Auth>`;

  // Consulta el Padrón de AFIP y devuelve la razón social / nombre oficial de un CUIT.
  // Usa "Constancia de Inscripción" (ws_sr_constancia_inscripcion / A13); si no está, prueba Padrón A5.
  // Requiere tener habilitado ese WS para el CUIT emisor (mismo certificado que facturación).
  async function padronNombre(cuitEmisor, idConsulta, debug) {
    const id = String(idConsulta || "").replace(/\D/g, "");
    if (id.length !== 11) return debug ? { error: "CUIT inválido (11 dígitos)" } : null;
    const intentos = [
      { svc: "ws_sr_padron_a13", url: "https://aws.afip.gov.ar/sr-padron/webservices/personaServiceA13", ns: "a13", method: "getPersona" },
      { svc: "ws_sr_padron_a5", url: PADRON_A5_URL, ns: "a5", method: "getPersona" },
    ];
    const diag = [];
    for (const it of intentos) {
      try {
        const t = await token(cuitEmisor, it.svc);
        const body = `<?xml version="1.0"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:${it.ns}="http://${it.ns}.soap.ws.server.puc.sr/"><soapenv:Body><${it.ns}:${it.method}><token>${t.token}</token><sign>${t.sign}</sign><cuitRepresentada>${cuitEmisor}</cuitRepresentada><idPersona>${id}</idPersona></${it.ns}:${it.method}></soapenv:Body></soapenv:Envelope>`;
        const r = await soap(it.url, body, "");
        const razon = pick(r, "razonSocial");
        if (razon) return debug ? { ok: true, nombre: razon.trim(), via: it.svc } : razon.trim();
        const ape = pick(r, "apellido"), nom = pick(r, "nombre");
        const nombre = [ape, nom].filter(Boolean).join(" ").trim();
        if (nombre) return debug ? { ok: true, nombre, via: it.svc } : nombre;
        diag.push({ svc: it.svc, nota: "token OK pero respuesta sin nombre", fault: pick(r, "faultstring") || (r.match(/<Mensaje[^>]*>([^<]+)/) || [])[1] || null, muestra: r.replace(/\s+/g, " ").slice(0, 500) });
      } catch (e) { diag.push({ svc: it.svc, error: e.message }); }
    }
    return debug ? { error: "no se obtuvo nombre", diag } : null;
  }

  async function ultimo(cuit, pv, tipo) {
    const t = await token(cuit);
    const body = `<?xml version="1.0"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/"><soapenv:Body><ar:FECompUltimoAutorizado>${auth(cuit, t)}<ar:PtoVta>${pv}</ar:PtoVta><ar:CbteTipo>${tipo}</ar:CbteTipo></ar:FECompUltimoAutorizado></soapenv:Body></soapenv:Envelope>`;
    const r = await soap(WSFE_URL, body, "http://ar.gov.afip.dif.FEV1/FECompUltimoAutorizado");
    const n = pick(r, "CbteNro");
    if (n == null) throw new Error("WSFE: " + (pick(r, "Msg") || pick(r, "faultstring") || "error"));
    return Number(n);
  }

  // Lista los puntos de venta habilitados para Web Services (FEParamGetPtosVenta)
  async function puntosVenta(cuit) {
    const t = await token(cuit);
    const body = `<?xml version="1.0"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/"><soapenv:Body><ar:FEParamGetPtosVenta>${auth(cuit, t)}</ar:FEParamGetPtosVenta></soapenv:Body></soapenv:Envelope>`;
    const r = await soap(WSFE_URL, body, "http://ar.gov.afip.dif.FEV1/FEParamGetPtosVenta");
    const puntos = [];
    const re = /<PtoVenta>([\s\S]*?)<\/PtoVenta>/g; let m;
    while ((m = re.exec(r))) {
      const blk = m[1];
      puntos.push({
        nro: Number((blk.match(/<Nro>(\d+)/) || [])[1] || 0),
        tipo: (blk.match(/<EmisionTipo>([^<]+)/) || [])[1] || "",
        bloqueado: (blk.match(/<Bloqueado>([^<]+)/) || [])[1] || "",
      });
    }
    const err = (r.match(/<Errors><Err><Code>\d+<\/Code><Msg>([^<]+)/) || [])[1] || (r.match(/<Msg>([^<]+)/) || [])[1];
    if (!puntos.length) return { ok: true, puntos: [], error: err || null };
    return { ok: true, puntos };
  }

  async function estado(cuit, pv, tipo = 11) {
    try { const n = await ultimo(cuit, pv, tipo); return { ok: true, conectado: true, ultimo: n, proximo: n + 1 }; }
    catch (e) { return { ok: false, conectado: false, error: e.message }; }
  }

  // Emite una Factura C (monotributo). datos: { pv, tipo=11, importe, doc_tipo, doc_nro, concepto=1, cond_iva_receptor=5, fecha, pedido }
  async function emitir(cuit, datos) {
    const t = await token(cuit);
    const pv = Number(datos.pv), tipo = Number(datos.tipo) || 11;
    const nro = (await ultimo(cuit, pv, tipo)) + 1;
    const fch = (datos.fecha || new Date().toISOString().slice(0, 10)).replace(/-/g, "");
    const imp = Number(datos.importe).toFixed(2);
    const docTipo = datos.doc_nro ? (datos.doc_tipo || 80) : 99; // 80=CUIT, 96=DNI, 99=consumidor final
    const docNro = datos.doc_nro || 0;
    // Nombre oficial de AFIP (padrón) cuando hay CUIT — el comprobante muestra ese, no el tipeado.
    let clienteNom = datos.cliente || "";
    if (docTipo === 80 && docNro) {
      const nAfip = await Promise.race([padronNombre(cuit, docNro), new Promise((r) => setTimeout(() => r(null), 8000))]);
      if (nAfip) clienteNom = nAfip;
    }
    const det = `<ar:FECAEDetRequest><ar:Concepto>${datos.concepto || 1}</ar:Concepto><ar:DocTipo>${docTipo}</ar:DocTipo><ar:DocNro>${docNro}</ar:DocNro><ar:CbteDesde>${nro}</ar:CbteDesde><ar:CbteHasta>${nro}</ar:CbteHasta><ar:CbteFch>${fch}</ar:CbteFch><ar:ImpTotal>${imp}</ar:ImpTotal><ar:ImpTotConc>0</ar:ImpTotConc><ar:ImpNeto>${imp}</ar:ImpNeto><ar:ImpOpEx>0</ar:ImpOpEx><ar:ImpIVA>0</ar:ImpIVA><ar:ImpTrib>0</ar:ImpTrib><ar:MonId>PES</ar:MonId><ar:MonCotiz>1</ar:MonCotiz><ar:CondicionIVAReceptorId>${datos.cond_iva_receptor || 5}</ar:CondicionIVAReceptorId></ar:FECAEDetRequest>`;
    const body = `<?xml version="1.0"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="http://ar.gov.afip.dif.FEV1/"><soapenv:Body><ar:FECAESolicitar>${auth(cuit, t)}<ar:FeCAEReq><ar:FeCabReq><ar:CantReg>1</ar:CantReg><ar:PtoVta>${pv}</ar:PtoVta><ar:CbteTipo>${tipo}</ar:CbteTipo></ar:FeCabReq><ar:FeDetReq>${det}</ar:FeDetReq></ar:FeCAEReq></ar:FECAESolicitar></soapenv:Body></soapenv:Envelope>`;
    const r = await soap(WSFE_URL, body, "http://ar.gov.afip.dif.FEV1/FECAESolicitar");
    const resultado = pick(r, "Resultado"), cae = pick(r, "CAE"), caeVto = pick(r, "CAEFchVto");
    if (resultado !== "A" || !cae) {
      const obs = (r.match(/<Obs><Obs><Code>\d+<\/Code><Msg>([^<]+)/) || [])[1];
      const err = (r.match(/<Errors><Err><Code>\d+<\/Code><Msg>([^<]+)/) || [])[1];
      return { error: obs || err || pick(r, "faultstring") || "AFIP rechazó el comprobante" };
    }
    const factura = { id: Date.now().toString(36), cuit, pv, tipo, numero: nro, cae, cae_vto: caeVto, importe: Number(imp), fecha: fch, pedido: datos.pedido || null, cliente: clienteNom, doc_tipo: docTipo, doc_nro: docNro, items: datos.items || [], creado: new Date().toISOString() };
    const d = await leerFacturas(); d.facturas.unshift(factura); await guardarFacturas(d);
    return { ok: true, factura };
  }

  // Completa el detalle de ítems de una factura ya emitida (NO re-emite en AFIP)
  async function setItems(id, items) {
    const d = await leerFacturas();
    const f = (d.facturas || []).find((x) => x.id === id);
    if (!f) return { error: "Factura no encontrada" };
    f.items = items || [];
    await guardarFacturas(d);
    return { ok: true, factura: f };
  }
  // Actualiza campos de una factura ya emitida (ej. vincular pedido). NO toca AFIP.
  async function actualizar(buscar, campos) {
    const d = await leerFacturas();
    const f = (d.facturas || []).find((x) => x.id === buscar.id || (buscar.numero != null && Number(x.numero) === Number(buscar.numero)));
    if (!f) return { error: "Factura no encontrada" };
    Object.assign(f, campos);
    await guardarFacturas(d);
    return { ok: true, factura: f };
  }
  return { token, ultimo, estado, emitir, leerFacturas, puntosVenta, setItems, actualizar, padronNombre };
}
