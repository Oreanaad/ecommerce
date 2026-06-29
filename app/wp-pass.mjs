// Verificación de contraseñas de WordPress en Node puro.
// Soporta los dos formatos que aparecen en wp_users:
//   - $wp$2y$...  -> WordPress 6.8+ (bcrypt sobre base64(HMAC-SHA384(pass,"wp-sha384")))
//   - $P$ / $H$   -> phpass portable (MD5 iterado)
import { createHash, createHmac } from "node:crypto";
import bcrypt from "bcryptjs";

const ITOA64 = "./0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

// codificación base64 propia de phpass
function encode64(input, count) {
  let output = "", i = 0;
  do {
    let value = input[i++];
    output += ITOA64[value & 0x3f];
    if (i < count) value |= input[i] << 8;
    output += ITOA64[(value >> 6) & 0x3f];
    if (i++ >= count) break;
    if (i < count) value |= input[i] << 16;
    output += ITOA64[(value >> 12) & 0x3f];
    if (i++ >= count) break;
    output += ITOA64[(value >> 18) & 0x3f];
  } while (i < count);
  return output;
}

function phpassVerify(password, stored) {
  if (!stored || stored.length !== 34) return false;
  const countLog2 = ITOA64.indexOf(stored[3]);
  if (countLog2 < 7 || countLog2 > 30) return false;
  let count = 1 << countLog2;
  const salt = stored.substring(4, 12);
  if (salt.length !== 8) return false;
  const pw = Buffer.from(password, "utf8");
  let hash = createHash("md5").update(Buffer.concat([Buffer.from(salt, "binary"), pw])).digest();
  do { hash = createHash("md5").update(Buffer.concat([hash, pw])).digest(); } while (--count);
  return (stored.substring(0, 12) + encode64(hash, 16)) === stored;
}

function wpBcryptVerify(password, stored) {
  // stored = "$wp$2y$..."; el bcrypt real es lo que sigue a "$wp"
  const pre = createHmac("sha384", "wp-sha384").update(password).digest("base64");
  try { return bcrypt.compareSync(pre, stored.slice(3)); } catch { return false; }
}

// Devuelve true si `password` corresponde al hash de WordPress.
export function verificarWP(password, stored) {
  if (!password || !stored) return false;
  if (stored.startsWith("$wp$")) return wpBcryptVerify(password, stored);
  if (stored.startsWith("$P$") || stored.startsWith("$H$")) return phpassVerify(password, stored);
  if (stored.startsWith("$2y$") || stored.startsWith("$2a$") || stored.startsWith("$2b$")) {
    try { return bcrypt.compareSync(password, stored); } catch { return false; }
  }
  return false;
}

// Igual que WordPress 6.8: genera un hash $wp$ a partir de una contraseña (para pruebas/round-trip).
export function hashWP(password) {
  const pre = createHmac("sha384", "wp-sha384").update(password).digest("base64");
  return "$wp" + bcrypt.hashSync(pre, 10);
}
