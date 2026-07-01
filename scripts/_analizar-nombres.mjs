import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Muestra ejemplos de nombres por grupo/subgrupo para entender el estado actual
const { rows } = await pool.query(`
  SELECT
    g.nombre AS grupo,
    s.nombre AS subgrupo,
    p.nombre,
    p.sku,
    COUNT(*) OVER (PARTITION BY p.grupo_id, p.subgrupo_id) AS total_sub
  FROM productos p
  JOIN grupos g ON g.id = p.grupo_id
  LEFT JOIN subgrupos s ON s.id = p.subgrupo_id
  WHERE p.activo
  ORDER BY g.id, s.id, random()
`);

// Agrupar y mostrar 5 ejemplos por subgrupo
const vistos = new Set();
for (const r of rows) {
  const key = `${r.grupo}||${r.subgrupo}`;
  if (!vistos.has(key)) {
    console.log(`\n[${r.grupo} > ${r.subgrupo || '—'}] (${r.total_sub} productos)`);
    vistos.add(key);
  }
  const shown = [...vistos].filter(k => k === key).length;
  // contar cuántos de este grupo ya mostramos
}

// Mejor approach: agrupar primero
const grupos = {};
for (const r of rows) {
  const key = `${r.grupo}||${r.subgrupo || '—'}`;
  if (!grupos[key]) grupos[key] = { grupo: r.grupo, sub: r.subgrupo, total: r.total_sub, ejemplos: [] };
  if (grupos[key].ejemplos.length < 6) grupos[key].ejemplos.push({ nombre: r.nombre, sku: r.sku });
}

for (const [, g] of Object.entries(grupos)) {
  console.log(`\n[${g.grupo} > ${g.sub}] — ${g.total} productos`);
  for (const e of g.ejemplos) console.log(`  ${e.nombre}  (${e.sku})`);
}

await pool.end();
