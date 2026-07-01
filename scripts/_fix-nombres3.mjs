import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Paso 1: reemplazar _ con espacio en colores (Pastel_Rosa → Pastel Rosa)
const r1 = await pool.query(`
  UPDATE productos SET nombre = replace(nombre, '_', ' ')
  WHERE nombre ~ '_'
`);
console.log('Guiones bajos en nombres reemplazados:', r1.rowCount);

// Paso 2: eliminar " – Color 0" del final de nombres (o como prefijo)
const r2 = await pool.query(`
  UPDATE productos SET nombre = trim(regexp_replace(nombre, '\\s*–\\s*Color 0\\s*$', '', 'i'))
  WHERE nombre ~* 'Color 0'
`);
console.log('Sufijo "Color 0" eliminado:', r2.rowCount);

// Paso 3: los que quedaron siendo solo "Color 0" → SKU
const r3 = await pool.query(`
  UPDATE productos
  SET nombre = 'SKU ' || split_part(sku, '-', 2)
  WHERE trim(nombre) ~* '^Color 0$'
`);
console.log('Nombres "Color 0" puros → SKU:', r3.rowCount);

// Verificar
const bad = await pool.query(`SELECT count(*) FROM productos WHERE nombre ~ '_' OR nombre ~* 'color 0'`);
console.log('Quedan problemáticos:', bad.rows[0].count);

// Muestra final
const sample = await pool.query(`SELECT nombre, sku FROM productos ORDER BY random() LIMIT 15`);
console.log('\nMuestra final:');
for (const r of sample.rows) console.log(' ', r.sku, '→', r.nombre);

await pool.end();
