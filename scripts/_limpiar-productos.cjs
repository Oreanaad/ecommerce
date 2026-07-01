// Elimina todos los productos importados (fundas iPhone) para reimportar limpio
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
async function run() {
  const cnt = await pool.query('SELECT COUNT(*) FROM productos');
  console.log('Productos actuales:', cnt.rows[0].count);

  // Borrar en orden: atributos y modelos se borran por CASCADE si está configurado,
  // si no, los borramos explícitamente primero
  await pool.query('DELETE FROM producto_atributos');
  await pool.query('DELETE FROM producto_modelos');
  const del = await pool.query('DELETE FROM productos RETURNING id');
  console.log('Eliminados:', del.rowCount, 'productos');

  // Resetear secuencia a 2000
  await pool.query('ALTER SEQUENCE productos_id_seq RESTART WITH 2000');
  console.log('Secuencia reseteada a 2000');

  await pool.end();
}
run().catch(e => { console.error(e.message); process.exit(1); });
