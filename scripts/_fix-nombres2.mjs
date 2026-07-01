import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Paso 1: quitar comillas de nombres que las tienen
const r1 = await pool.query(`
  UPDATE productos
  SET nombre = trim(regexp_replace(replace(nombre, '"', ''), '\\s+', ' ', 'g'))
  WHERE nombre ~ '"'
`);
console.log('Comillas eliminadas:', r1.rowCount);

// Paso 2: nombres que siguen empezando con dígito → solo color o SKU
const r2 = await pool.query(`
  UPDATE productos
  SET nombre = CASE
    WHEN nombre ~ ' – ' THEN trim(split_part(nombre, ' – ', 2))
    ELSE 'SKU ' || split_part(sku, '-', 2)
  END
  WHERE nombre ~ '^[\\d|]'
`);
console.log('Nombres numéricos/pipe corregidos:', r2.rowCount);

// Paso 3: reemplazar | por - en nombres restantes
const r3 = await pool.query(`
  UPDATE productos
  SET nombre = replace(nombre, '|', '-')
  WHERE nombre ~ '\\|'
`);
console.log('Pipes reemplazados:', r3.rowCount);

// Muestra una muestra de lo que quedó
const sample = await pool.query(`SELECT nombre, sku FROM productos ORDER BY id LIMIT 10`);
console.log('\nMuestra:');
for (const r of sample.rows) console.log(' ', r.sku, '→', r.nombre);

await pool.end();
