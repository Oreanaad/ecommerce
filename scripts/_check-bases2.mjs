import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Confirmar 612 y 613 mirando sus productos que YA tienen nombre con "Funda"
for (const base of ['612','613','614']) {
  const { rows } = await pool.query(`
    SELECT DISTINCT regexp_replace(nombre, '\\s+–.*', '') AS tipo
    FROM productos
    WHERE sku LIKE $1 AND nombre ILIKE 'Funda %'
    LIMIT 3
  `, [`${base}-%`]);
  console.log(`BASE ${base}:`, rows.map(r => r.tipo).join(', ') || '(sin ejemplos)');
}

// Bases 62X para tablets
const { rows: tabs } = await pool.query(`
  SELECT split_part(sku,'-',1) AS base, nombre, count(*) AS cnt
  FROM productos
  WHERE grupo_id = 6 AND subgrupo_id = (SELECT id FROM subgrupos WHERE nombre = 'Para Tablet' LIMIT 1)
  GROUP BY base, nombre
  ORDER BY base, cnt DESC
  LIMIT 30
`);
console.log('\n--- TABLETS (grupo 6, subgrupo Para Tablet) ---');
const vistas = new Set();
for (const r of tabs) {
  const k = r.base;
  if (!vistas.has(k)) { console.log(`BASE ${r.base}: "${r.nombre}" (${r.cnt} veces)`); vistas.add(k); }
}

await pool.end();
