// Parsea un dump SQL de wp_users y genera data/wp-usuarios-seed.json
// Uso: node scripts/parse-wp.mjs /ruta/al/dump.sql
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { verificarWP, hashWP } from "../app/wp-pass.mjs";
import { duenos } from "./lib.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// dominios de bots/SEO-spam detectados en el dump (solo se marcan, no se borran)
const SPAM_DOMINIOS = [
  "seoautomationpro.com", "welcometotijuana.com", "travel-e-store.com", "gsasearchengineranker.com",
  "verifiedlinklist.com", "budgetthailandtravel.com", "poochta.ru", "poochta.com", "thematinggrounds.com",
  "modelsexy.cfd", "thewisetransfer.click", "streetwormail.com", "aurevoirmail.com", "bientotmail.com",
  "wildbmail.com", "triol.site", "scrap-transport-musical-hospital-brainstorm.com",
];

function esSpam(email, login, nombre) {
  const dom = (email.split("@")[1] || "").toLowerCase();
  if (SPAM_DOMINIOS.some((d) => dom === d || dom.endsWith("." + d))) return true;
  // patrón típico de bot ("williamfischer2872mmyr" con display_name == login)
  if (/^[a-z]+\d{3,}[a-z0-9]{2,}$/.test(login) && nombre.toLowerCase() === login.toLowerCase()) return true;
  return false;
}

// Tokenizador de tuplas SQL: respeta comillas simples y escapes \'
function parseRows(sql) {
  const rows = [];
  let i = 0;
  while (i < sql.length) {
    if (sql[i] !== "(") { i++; continue; }
    const fields = []; let cur = "", inStr = false; i++;
    while (i < sql.length) {
      const c = sql[i];
      if (inStr) {
        if (c === "\\") { cur += sql[i + 1]; i += 2; continue; }
        if (c === "'") { inStr = false; i++; continue; }
        cur += c; i++; continue;
      }
      if (c === "'") { inStr = true; i++; continue; }
      if (c === ",") { fields.push(cur.trim()); cur = ""; i++; continue; }
      if (c === ")") { fields.push(cur.trim()); i++; break; }
      cur += c; i++;
    }
    rows.push(fields);
  }
  return rows;
}

async function main() {
  const sqlPath = process.argv[2];
  if (!sqlPath) { console.error("Falta la ruta al .sql"); process.exit(1); }
  const sql = await readFile(sqlPath, "utf8");

  // --- self-test del verificador antes de importar nada ---
  const claveDemo = "Balcarse1#demo";
  const okBcrypt = verificarWP(claveDemo, hashWP(claveDemo)) && !verificarWP("otra", hashWP(claveDemo));
  console.log(`  self-test ${okBcrypt ? "OK " : "FALLA"}  bcrypt $wp$ round-trip`);

  const rows = parseRows(sql).filter((f) => f.length >= 10 && /^\d+$/.test(f[0]));
  const dueñosLista = duenos();
  const usuarios = [];
  let nSpam = 0, nWp = 0, nPhpass = 0;
  for (const f of rows) {
    const login = f[1], hash = f[2], email = (f[4] || "").toLowerCase().trim(), nombre = (f[9] || "").trim();
    if (!email || !email.includes("@") || !hash) continue;
    const spam = esSpam(email, login, nombre);
    if (spam) nSpam++;
    if (hash.startsWith("$wp$")) nWp++; else if (hash.startsWith("$P$") || hash.startsWith("$H$")) nPhpass++;
    usuarios.push({
      email,
      nombre: nombre || "",
      wp_pass: hash,
      rol: dueñosLista.includes(email) ? "dueno" : "cliente",
      origen: "wordpress",
      ...(spam ? { spam: true } : {}),
    });
  }

  const out = join(ROOT, "data/wp-usuarios-seed.json");
  await writeFile(out, JSON.stringify({ usuarios }, null, 2));
  console.log(`\n  filas de datos:      ${rows.length}`);
  console.log(`  usuarios importados: ${usuarios.length}`);
  console.log(`  hashes $wp$ (6.8+):  ${nWp}`);
  console.log(`  hashes phpass:       ${nPhpass}`);
  console.log(`  marcados spam/bot:   ${nSpam}  -> reales aprox: ${usuarios.length - nSpam}`);
  console.log(`  escrito en:          ${out}`);
}
main();
