import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const r = await pool.query("UPDATE productos SET stock = 1, stock_status = 'instock' WHERE stock_status = 'outofstock' OR stock = 0 OR stock IS NULL");
console.log('Productos actualizados:', r.rowCount);
await pool.end();
