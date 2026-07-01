import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Buscar patrones problemáticos
const checks = [
  [`Nombres con comillas`, `SELECT count(*) FROM productos WHERE nombre ~ '"'`],
  [`Nombres con pipe |`, `SELECT count(*) FROM productos WHERE nombre ~ '\\|'`],
  [`Nombres que empiezan con dígito`, `SELECT count(*) FROM productos WHERE nombre ~ '^\\d'`],
  [`Nombres "Color 0"`, `SELECT count(*) FROM productos WHERE nombre LIKE '%Color 0%'`],
  [`Nombres tipo "SKU 12345"`, `SELECT count(*) FROM productos WHERE nombre LIKE 'SKU %'`],
  [`Total productos`, `SELECT count(*) FROM productos`],
];

for (const [label, sql] of checks) {
  const { rows } = await pool.query(sql);
  console.log(`${label}: ${rows[0].count}`);
}

// Muestra de nombres actuales
const sample = await pool.query(`
  SELECT nombre, sku FROM productos
  WHERE nombre NOT LIKE '%–%'
  ORDER BY random()
  LIMIT 15
`);
console.log('\nMuestra (sin separador –):');
for (const r of sample.rows) console.log(' ', r.sku, '→', r.nombre);

const sample2 = await pool.query(`
  SELECT nombre, sku FROM productos
  WHERE nombre LIKE '%–%'
  ORDER BY random()
  LIMIT 10
`);
console.log('\nMuestra (con separador –):');
for (const r of sample2.rows) console.log(' ', r.sku, '→', r.nombre);

await pool.end();
