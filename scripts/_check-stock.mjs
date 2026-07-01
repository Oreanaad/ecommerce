import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const r1 = await pool.query("SELECT count(*) FROM productos WHERE stock_status = 'outofstock' OR stock = 0 OR stock IS NULL");
const r2 = await pool.query("SELECT count(*) FROM productos");
console.log('Productos a actualizar:', r1.rows[0].count);
console.log('Total productos en DB:', r2.rows[0].count);
await pool.end();
