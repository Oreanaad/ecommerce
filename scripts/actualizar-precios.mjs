// Actualiza precios en la DB usando Codigo Viejo como clave.
// Uso: node scripts/actualizar-precios.mjs <archivo.csv>
// El CSV debe tener una columna "Codigo Viejo" (o similar) y una columna de precio.
// Ejemplo de columnas aceptadas para precio: precio, Precio, precio_venta, Precio Venta, price, etc.

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const pg = require('pg');
const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('ERROR: DATABASE_URL no está definida'); process.exit(1); }

const archivo = process.argv[2];
if (!archivo) { console.error('Uso: node scripts/actualizar-precios.mjs <archivo.csv>'); process.exit(1); }

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 5 });

// ─── Parsear CSV simple (sin manejar comillas con comas adentro) ──────────────
function parsearCSV(texto) {
  const lineas = texto.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  return lineas.map(l => l.split(',').map(c => c.trim().replace(/^"|"$/g, '')));
}

// ─── Detectar columna de precio ───────────────────────────────────────────────
const NOMBRES_PRECIO = ['precio_venta','precio venta','precio de venta','precio','price','venta','pvp','p_venta'];
const NOMBRES_COSTO  = ['precio_costo','precio costo','precio de costo','costo','cost','p_costo'];
const NOMBRES_CODIGO = ['codigo viejo','codigo_viejo','cod viejo','cod_viejo','codigo','code','sku_viejo'];

function encontrarCol(headers, candidatos) {
  const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  for (const c of candidatos) {
    const idx = headers.findIndex(h => norm(h) === c);
    if (idx >= 0) return idx;
  }
  return -1;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
const texto = await readFile(resolve(archivo), 'latin1');
const filas = parsearCSV(texto).filter(r => r.some(c => c));

// Buscar fila de headers (que contenga algún nombre de código)
let hdrIdx = -1;
for (let i = 0; i < Math.min(10, filas.length); i++) {
  const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  if (filas[i].some(h => NOMBRES_CODIGO.includes(norm(h)))) { hdrIdx = i; break; }
}
if (hdrIdx < 0) {
  console.error('No se encontró columna de código. Columnas detectadas:', filas[0]?.join(' | '));
  process.exit(1);
}

const headers = filas[hdrIdx].map(h => h.trim());
const datos   = filas.slice(hdrIdx + 1).filter(r => r.some(c => c));

const idxCodigo = encontrarCol(headers, NOMBRES_CODIGO);
const idxPrecio = encontrarCol(headers, NOMBRES_PRECIO);
const idxCosto  = encontrarCol(headers, NOMBRES_COSTO);

console.log(`Headers detectados: ${headers.join(' | ')}`);
console.log(`Columna código:  [${idxCodigo}] "${headers[idxCodigo]}"`);
console.log(`Columna precio:  [${idxPrecio}] "${idxPrecio >= 0 ? headers[idxPrecio] : '—'}"`);
console.log(`Columna costo:   [${idxCosto}] "${idxCosto >= 0 ? headers[idxCosto] : '—'}"`);
console.log(`Filas de datos:  ${datos.length}`);

if (idxCodigo < 0 || idxPrecio < 0) {
  console.error('\nERROR: No se pudo detectar la columna de código o precio.');
  console.error('Columnas disponibles:', headers.join(', '));
  process.exit(1);
}

// ─── Construir mapa codigo → precio ──────────────────────────────────────────
const limpiarPrecio = s => {
  if (!s) return null;
  const n = parseFloat(s.replace(/[^0-9.,]/g, '').replace(',', '.'));
  return isNaN(n) || n <= 0 ? null : n;
};

const mapa = new Map(); // codigo_viejo → { precio, costo }
for (const fila of datos) {
  const codigo = (fila[idxCodigo] || '').trim();
  if (!codigo || codigo === '0') continue;
  const precio = limpiarPrecio(fila[idxPrecio]);
  const costo  = idxCosto >= 0 ? limpiarPrecio(fila[idxCosto]) : null;
  if (precio !== null) mapa.set(codigo, { precio, costo });
}

console.log(`\nCódigos con precio válido: ${mapa.size}`);
// Muestra
let n = 0;
for (const [cod, v] of mapa) {
  if (n++ >= 5) break;
  console.log(`  ${cod} → $${v.precio}${v.costo ? ` (costo $${v.costo})` : ''}`);
}

// ─── UPDATE en la DB ──────────────────────────────────────────────────────────
// El SKU en la DB tiene formato: BASE-CODIGOVIEJO-CCOLOR  (ej: 611-22471-C24)
// El Codigo Viejo es split_part(sku, '-', 2)

// Construir tabla temporal de valores
const valores = [...mapa.entries()].map(([cod, v]) => `('${cod.replace(/'/g,"''")}', ${v.precio}, ${v.costo ?? 'NULL'})`);

if (valores.length === 0) { console.log('\nNada que actualizar.'); await pool.end(); process.exit(0); }

// UPDATE en lote usando CTE
const { rowCount } = await pool.query(`
  WITH precios(codigo, precio, costo) AS (
    VALUES ${valores.join(',\n    ')}
  )
  UPDATE productos p
  SET
    precio         = precios.precio::numeric,
    precio_regular = CASE WHEN precios.costo IS NOT NULL THEN precios.costo::numeric ELSE precios.precio::numeric END,
    stock_status   = CASE WHEN precios.precio > 0 THEN 'instock' ELSE p.stock_status END
  FROM precios
  WHERE split_part(p.sku, '-', 2) = precios.codigo
`);

console.log(`\n✓ Productos actualizados: ${rowCount}`);

// Verificar muestra
const sample = await pool.query(`
  SELECT p.sku, p.nombre, p.precio, p.precio_regular
  FROM productos p
  WHERE split_part(p.sku, '-', 2) = ANY($1)
  LIMIT 8
`, [[...mapa.keys()].slice(0, 20)]);

console.log('\nMuestra de productos actualizados:');
for (const r of sample.rows) {
  console.log(`  ${r.sku.padEnd(25)} ${r.nombre.substring(0,35).padEnd(35)} $${r.precio}`);
}

await pool.end();
