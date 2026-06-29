// Carga de configuracion: prioriza variables de entorno (nube) y cae a los archivos locales.
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Carpeta de datos escribibles. En Railway se monta un volumen y se setea DATA_DIR (ej. /data).
export function dataDir(ROOT) {
  return process.env.DATA_DIR || join(ROOT, "data");
}

export async function loadWoo(ROOT) {
  if (process.env.WC_URL && process.env.WC_KEY && process.env.WC_SECRET) {
    return { url: process.env.WC_URL, consumer_key: process.env.WC_KEY, consumer_secret: process.env.WC_SECRET };
  }
  try { return JSON.parse(await readFile(join(ROOT, "config/woocommerce.json"), "utf8")); } catch { return null; }
}

export async function loadAnthropic(ROOT) {
  if (process.env.ANTHROPIC_API_KEY) {
    return { api_key: process.env.ANTHROPIC_API_KEY, model: process.env.ANTHROPIC_MODEL || "claude-opus-4-8" };
  }
  try { return JSON.parse(await readFile(join(ROOT, "config/anthropic.json"), "utf8")); } catch { return null; }
}

// Resend (envío de emails). Devuelve { api_key, from } o null.
export async function loadResend(ROOT) {
  if (process.env.RESEND_API_KEY) {
    return { api_key: process.env.RESEND_API_KEY, from: process.env.MAIL_FROM || "El Pasaje Dental <onboarding@resend.dev>" };
  }
  try { return JSON.parse(await readFile(join(ROOT, "config/resend.json"), "utf8")); } catch { return null; }
}

// Emails de los dueños (acceso total). Coma-separados en DUENOS, o por defecto.
export function duenos() {
  return (process.env.DUENOS || "maximilianoespeche@gmail.com,nanzarate@hotmail.com,enrique.espeche@gmail.com")
    .split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
}

export function appSecret() {
  return process.env.APP_SECRET || process.env.APP_PASSWORD || "pasaje-dental-secreto-local";
}
