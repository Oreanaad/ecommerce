const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
async function run() {
  const g  = await pool.query('SELECT id, nombre FROM grupos ORDER BY id');
  console.log('Grupos:', JSON.stringify(g.rows));
  const sg = await pool.query('SELECT id, grupo_id, nombre FROM subgrupos ORDER BY grupo_id, id');
  console.log('Subgrupos:', JSON.stringify(sg.rows));
  const cj = await pool.query('SELECT id, subgrupo_id, nombre FROM categorias_jerarquia WHERE activo ORDER BY subgrupo_id, id');
  console.log('Categorias:', JSON.stringify(cj.rows));
  await pool.end();
}
run().catch(e => { console.error(e.message); process.exit(1); });
