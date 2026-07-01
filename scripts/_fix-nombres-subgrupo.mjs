import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Ver cuántos productos afecta por subgrupo (fuera de Fundas grupo 6, que ya está ok)
const { rows: preview } = await pool.query(`
  SELECT s.nombre AS sg, count(*) AS cant
  FROM productos p
  JOIN subgrupos s ON s.id = p.subgrupo_id
  WHERE p.grupo_id != 6
    AND p.subgrupo_id IS NOT NULL
    AND lower(p.nombre) NOT LIKE lower(s.nombre) || '%'
  GROUP BY s.nombre
  ORDER BY cant DESC
`);
console.log('Productos sin prefijo de subgrupo por subgrupo:');
for (const r of preview) console.log(` ${r.cant.toString().padStart(5)} × ${r.sg}`);

// UPDATE masivo: prepend subgrupo.nombre a todos los que no lo tengan ya
const r = await pool.query(`
  UPDATE productos p
  SET nombre = s.nombre || ' ' || p.nombre
  FROM subgrupos s
  WHERE s.id = p.subgrupo_id
    AND p.grupo_id != 6
    AND p.subgrupo_id IS NOT NULL
    AND lower(p.nombre) NOT LIKE lower(s.nombre) || '%'
`);
console.log('\nActualizados:', r.rowCount);

// Muestra por grupo
const sample = await pool.query(`
  SELECT p.nombre, g.nombre AS grupo
  FROM productos p
  JOIN grupos g ON g.id = p.grupo_id
  WHERE p.grupo_id != 6
  ORDER BY g.id, random()
  LIMIT 24
`);
console.log('\nMuestra:');
let lastGrupo = '';
for (const r of sample.rows) {
  if (r.grupo !== lastGrupo) { console.log(`\n  [${r.grupo}]`); lastGrupo = r.grupo; }
  console.log(`    ${r.nombre}`);
}

await pool.end();
