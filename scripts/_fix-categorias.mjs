import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Ver qué grupos y subgrupos existen en DB
const grp = await pool.query(`SELECT id, nombre FROM grupos ORDER BY id`);
const sub = await pool.query(`SELECT id, grupo_id, nombre FROM subgrupos ORDER BY grupo_id, id`);

console.log('=== GRUPOS ===');
for (const r of grp.rows) console.log(` ${r.id} → ${r.nombre}`);

console.log('\n=== SUBGRUPOS ===');
for (const r of sub.rows) console.log(` ${r.id} (grupo ${r.grupo_id}) → ${r.nombre}`);

// Cuántos productos hay por grupo/subgrupo
const dist = await pool.query(`
  SELECT p.grupo_id, g.nombre AS grupo_nombre, p.subgrupo_id, s.nombre AS sub_nombre,
         COUNT(*) AS total
  FROM productos p
  LEFT JOIN grupos g ON g.id = p.grupo_id
  LEFT JOIN subgrupos s ON s.id = p.subgrupo_id
  GROUP BY p.grupo_id, g.nombre, p.subgrupo_id, s.nombre
  ORDER BY p.grupo_id, p.subgrupo_id
`);

console.log('\n=== DISTRIBUCIÓN (grupo → subgrupo → cant) ===');
for (const r of dist.rows) {
  console.log(` [${r.grupo_id ?? 'NULL'}] ${r.grupo_nombre ?? '?'} → [${r.subgrupo_id ?? 'NULL'}] ${r.sub_nombre ?? '?'} : ${r.total}`);
}

// Actualizar productos.categorias con [grupo_nombre, subgrupo_nombre]
// Solo para productos que tienen grupo_id asignado
const upd = await pool.query(`
  UPDATE productos p
  SET categorias = (
    SELECT jsonb_build_array(g.nombre, s.nombre)
    FROM grupos g
    JOIN subgrupos s ON s.id = p.subgrupo_id AND s.grupo_id = g.id
    WHERE g.id = p.grupo_id
  )
  WHERE p.grupo_id IS NOT NULL
    AND p.subgrupo_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM grupos g JOIN subgrupos s ON s.id = p.subgrupo_id AND s.grupo_id = g.id
      WHERE g.id = p.grupo_id
    )
`);
console.log('\nProductos con categorias actualizadas:', upd.rowCount);

// Para productos sin subgrupo pero con grupo
const upd2 = await pool.query(`
  UPDATE productos p
  SET categorias = (
    SELECT jsonb_build_array(g.nombre)
    FROM grupos g WHERE g.id = p.grupo_id
  )
  WHERE p.grupo_id IS NOT NULL
    AND (p.subgrupo_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM subgrupos s WHERE s.id = p.subgrupo_id
    ))
    AND EXISTS (SELECT 1 FROM grupos g WHERE g.id = p.grupo_id)
`);
console.log('Productos solo con grupo (sin subgrupo):', upd2.rowCount);

// Verificar
const check = await pool.query(`
  SELECT categorias, count(*) FROM productos GROUP BY categorias ORDER BY count(*) DESC LIMIT 10
`);
console.log('\n=== TOP categorias en DB ===');
for (const r of check.rows) console.log(' ', JSON.stringify(r.categorias), '→', r.count);

await pool.end();
