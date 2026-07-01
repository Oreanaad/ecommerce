const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
async function run() {
  const r = await pool.query(`SELECT column_name, column_default FROM information_schema.columns WHERE table_name='productos' AND column_name='id'`);
  console.log('id default:', JSON.stringify(r.rows));
  const s = await pool.query(`SELECT last_value FROM productos_id_seq`).catch(e => ({rows:[{error:e.message}]}));
  console.log('seq:', JSON.stringify(s.rows));
  const cnt = await pool.query(`SELECT COUNT(*) FROM productos`);
  console.log('productos count:', cnt.rows[0].count);
  await pool.end();
}
run().catch(e => { console.error(e.message); pool.end(); });
