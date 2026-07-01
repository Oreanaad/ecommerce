import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Ver qué tipo de nombre tienen los productos que ya tienen "Funda X" por BASE code
const { rows } = await pool.query(`
  SELECT
    split_part(sku, '-', 1) AS base,
    regexp_replace(nombre, '\\s+–.*', '') AS tipo_nombre,
    count(*) AS total
  FROM productos
  WHERE nombre ILIKE 'Funda %'
    AND grupo_id = 6
  GROUP BY base, tipo_nombre
  ORDER BY base, total DESC
  LIMIT 40
`);

console.log('BASE → tipo de funda (por nombre existente):');
for (const r of rows) console.log(` BASE ${r.base.padEnd(6)} | ${r.tipo_nombre}`);

// Ver cuántos productos en grupo 6 NO tienen "Funda" en el nombre
const { rows: sinFunda } = await pool.query(`
  SELECT split_part(sku,'-',1) AS base, count(*) AS cant
  FROM productos
  WHERE grupo_id = 6
    AND nombre NOT ILIKE 'Funda%'
  GROUP BY base ORDER BY base
`);
console.log('\nProductos grupo 6 SIN "Funda" en el nombre por BASE:');
for (const r of sinFunda) console.log(` BASE ${r.base.padEnd(6)} → ${r.cant} productos`);

await pool.end();
