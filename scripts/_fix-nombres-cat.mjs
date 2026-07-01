import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Verificar qué hay en la tabla colores
const { rows: muestraColores } = await pool.query(
  `SELECT nombre FROM colores WHERE activo ORDER BY nombre LIMIT 20`
);
console.log('Muestra colores DB:', muestraColores.map(r => r.nombre).join(', '));

// Contar nombres que son solo colores (normalizando guiones bajos ↔ espacios)
const { rows: preview } = await pool.query(`
  SELECT count(*) FROM productos p
  WHERE EXISTS (
    SELECT 1 FROM colores c
    WHERE c.activo
      AND replace(lower(c.nombre), '_', ' ') = replace(lower(p.nombre), '_', ' ')
  )
  AND p.subgrupo_id IS NOT NULL
`);
console.log('Productos con nombre = solo color:', preview[0].count);

// UPDATE masivo: agregar prefijo de subcategoría a nombres que son solo un color
const r = await pool.query(`
  UPDATE productos p
  SET nombre = s.nombre || ' – ' || p.nombre
  FROM subgrupos s
  WHERE s.id = p.subgrupo_id
    AND (
      EXISTS (
        SELECT 1 FROM colores c
        WHERE c.activo
          AND replace(lower(c.nombre), '_', ' ') = replace(lower(p.nombre), '_', ' ')
      )
      OR p.nombre ~ '^SKU \\d'
    )
`);
console.log('Actualizados:', r.rowCount);

// Muestra final
const sample = await pool.query(`
  SELECT nombre, sku FROM productos
  WHERE nombre ~ '^(Para |Smartwatches|Auricular|Smartphones|Holder|Mallas|Soporte|Conect)'
  ORDER BY nombre LIMIT 20
`);
console.log('\nMuestra de productos corregidos:');
for (const r of sample.rows) console.log(' ', r.sku, '→', r.nombre);

await pool.end();
