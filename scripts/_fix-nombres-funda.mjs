import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Muestra antes
const { rows: antes } = await pool.query(`
  SELECT count(*) FROM productos
  WHERE grupo_id = 6 AND nombre NOT ILIKE 'Funda%'
`);
console.log('Productos grupo 6 sin "Funda" en nombre:', antes[0].count);

// UPDATE masivo usando subgrupo_id + BASE code del SKU
const r = await pool.query(`
  UPDATE productos p
  SET nombre =
    CASE
      -- Para Celulares: tipo por BASE code
      WHEN p.subgrupo_id = 35 AND split_part(p.sku, '-', 1) = '611' THEN 'Funda Rígida ' || p.nombre
      WHEN p.subgrupo_id = 35 AND split_part(p.sku, '-', 1) = '612' THEN 'Funda Flexible ' || p.nombre
      WHEN p.subgrupo_id = 35 AND split_part(p.sku, '-', 1) = '613' THEN 'Funda Silicona ' || p.nombre
      WHEN p.subgrupo_id = 35 AND split_part(p.sku, '-', 1) = '614' THEN 'Funda Otro ' || p.nombre
      WHEN p.subgrupo_id = 35 THEN 'Funda ' || p.nombre
      -- Para Tablet
      WHEN p.subgrupo_id = 36 THEN 'Funda Tablet ' || p.nombre
      -- Para Notebook
      WHEN p.subgrupo_id = 37 THEN 'Funda Notebook ' || p.nombre
      -- Para Auriculares
      WHEN p.subgrupo_id = 38 THEN 'Funda Auricular ' || p.nombre
      -- Para GPS
      WHEN p.subgrupo_id = 39 THEN 'Funda GPS ' || p.nombre
      -- Para Parlantes y Cámaras
      WHEN p.subgrupo_id = 40 THEN 'Funda ' || p.nombre
      ELSE 'Funda ' || p.nombre
    END
  WHERE p.grupo_id = 6
    AND p.nombre NOT ILIKE 'Funda%'
`);
console.log('Actualizados:', r.rowCount);

// Muestra final de cada tipo
const sample = await pool.query(`
  SELECT nombre, sku FROM productos
  WHERE grupo_id = 6
  ORDER BY random()
  LIMIT 20
`);
console.log('\nMuestra final:');
for (const r of sample.rows) console.log(' ', r.sku.padEnd(22), '→', r.nombre);

await pool.end();
