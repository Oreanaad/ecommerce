import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Muestra cuántos afecta antes de actualizar
const preview = await pool.query(`SELECT count(*) FROM productos WHERE nombre ~ '^\\d+'`);
console.log('Productos con nombre numérico:', preview.rows[0].count);

const r = await pool.query(`
  UPDATE productos
  SET nombre = CASE
    WHEN nombre ~ ' – ' THEN split_part(nombre, ' – ', 2)
    ELSE 'SKU ' || split_part(sku, '-', 2)
  END
  WHERE nombre ~ '^\\d+'
`);
console.log('Actualizados:', r.rowCount);
await pool.end();
