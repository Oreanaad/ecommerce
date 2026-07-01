import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const { rows } = await pool.query(`
  SELECT g.nombre AS grupo, s.nombre AS sub, p.nombre
  FROM productos p JOIN grupos g ON g.id=p.grupo_id LEFT JOIN subgrupos s ON s.id=p.subgrupo_id
  WHERE p.activo ORDER BY g.id, s.id, p.nombre
`);
const gs = {};
for (const r of rows) {
  const k = r.grupo + ' > ' + (r.sub || '—');
  if (!gs[k]) gs[k] = [];
  if (gs[k].length < 5) gs[k].push(r.nombre);
}
for (const [k, ns] of Object.entries(gs)) {
  console.log(`\n[${k}]`);
  ns.forEach(n => console.log(`  ${n}`));
}
await pool.end();
