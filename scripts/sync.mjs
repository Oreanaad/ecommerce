// Sincroniza el catalogo desde WooCommerce -> <DATA_DIR>/catalogo.json
// Uso: node scripts/sync.mjs
import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadWoo, dataDir } from "./lib.mjs";
import { syncCatalogo } from "./sync-core.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const cfg = await loadWoo(ROOT);
if (!cfg) { console.error("Falta la config de WooCommerce (config/woocommerce.json o variables WC_URL/WC_KEY/WC_SECRET)."); process.exit(1); }

const out = await syncCatalogo(cfg, (m) => process.stdout.write(m));
const DATA = dataDir(ROOT);
await mkdir(DATA, { recursive: true });
await writeFile(join(DATA, "catalogo.json"), JSON.stringify(out, null, 2));
console.log(`Listo: ${out.total} productos (${out.total_variaciones} variaciones), ${out.categorias.length} categorias -> ${join(DATA, "catalogo.json")}`);
