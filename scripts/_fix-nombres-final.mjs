import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// 1. "Funda Tablet Para Tablet – X" → "Funda Tablet – X"
//    "Funda Notebook Para Notebook – X" → "Funda Notebook – X"
const r1 = await pool.query(`
  UPDATE productos
  SET nombre = regexp_replace(nombre,
    '^(Funda (?:Tablet|Notebook|Auricular|GPS|Parlante)) Para (?:Tablet|Notebook|Auriculares|GPS|Parlantes y Cámaras)(\\s*–?\\s*)',
    '\\1\\2', 'i')
  WHERE nombre ~* '^Funda (Tablet|Notebook|Auricular|GPS) Para '
`);
console.log('Dobles eliminados (Funda X Para X):', r1.rowCount);

// 2. "Funda Rígida/Flexible/Silicona/Otro Para Celulares – Color"
//    → "Funda Rígida/Flexible/Silicona/Otro – Color"
const r2 = await pool.query(`
  UPDATE productos
  SET nombre = regexp_replace(nombre,
    '^(Funda (?:Rígida|Flexible|Silicona|Otro)) Para Celulares(\\s*–?\\s*)',
    '\\1\\2', '')
  WHERE nombre ~* '^Funda (Rígida|Flexible|Silicona|Otro) Para Celulares'
`);
console.log('"Para Celulares" redundante eliminado:', r2.rowCount);

// 3. Limpiar espacios dobles o "– " al inicio que puedan haber quedado
const r3 = await pool.query(`
  UPDATE productos
  SET nombre = trim(regexp_replace(nombre, '^–\\s*|\\s{2,}', ' ', 'g'))
  WHERE nombre ~ '^–|\\s{2}'
`);
console.log('Limpieza de espacios/guiones:', r3.rowCount);

// Verificar resultado
const checks = [
  [`Dobles "Funda X Para X"`,   `nombre ~* '^Funda (Tablet|Notebook|Auricular|GPS) Para'`],
  [`"Para Celulares" redundante`,`nombre ~* '^Funda (Rígida|Flexible|Silicona|Otro) Para Celulares'`],
];
console.log('\n--- Chequeo ---');
for (const [label, cond] of checks) {
  const { rows } = await pool.query(`SELECT count(*) FROM productos WHERE ${cond}`);
  console.log(` ${rows[0].count} × ${label}`);
}

const sample = await pool.query(`
  SELECT nombre FROM productos WHERE grupo_id = 6 ORDER BY random() LIMIT 12
`);
console.log('\nMuestra grupo Fundas:');
for (const r of sample.rows) console.log(' ', r.nombre);

await pool.end();
