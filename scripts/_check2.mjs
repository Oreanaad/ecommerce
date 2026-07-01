import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const { rows } = await pool.query(`
  SELECT p.nombre, p.sku FROM productos p
  JOIN subgrupos s ON s.id = p.subgrupo_id
  WHERE s.nombre IN ('Para Celulares','Para Tablet','Auricular','Smartwatches')
  ORDER BY random() LIMIT 20
`);
for (const r of rows) console.log(r.sku.padEnd(22), '→', r.nombre);

// Top nombres más repetidos
const { rows: top } = await pool.query(`
  SELECT nombre, count(*) FROM productos GROUP BY nombre ORDER BY count(*) DESC LIMIT 10
`);
console.log('\nNombres más comunes:');
for (const r of top) console.log(' ', r.count, '×', r.nombre);

await pool.end();
