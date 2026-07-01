import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const grupos = [
  { label: 'Funda Rígida (BASE 611)',    where: `sku LIKE '611-%' AND grupo_id = 6` },
  { label: 'Funda Flexible (BASE 612)',  where: `sku LIKE '612-%' AND grupo_id = 6` },
  { label: 'Funda Silicona (BASE 613)',  where: `sku LIKE '613-%' AND grupo_id = 6` },
  { label: 'Funda Tablet (BASE 62X)',    where: `split_part(sku,'-',1) LIKE '62%' AND grupo_id = 6` },
  { label: 'Equipos (Smartphones)',      where: `subgrupo_id = 56` },
  { label: 'Audio (Auricular)',          where: `subgrupo_id = 30` },
  { label: 'Accesorios (Holder)',        where: `subgrupo_id = 42` },
];

for (const g of grupos) {
  const { rows } = await pool.query(
    `SELECT nombre FROM productos WHERE ${g.where} ORDER BY random() LIMIT 6`
  );
  console.log(`\n=== ${g.label} ===`);
  for (const r of rows) console.log(' ', r.nombre);
}

// Patrones problemáticos que puedan quedar
const checks = [
  [`Empiezan con dígito`,      `nombre ~ '^\\d'`],
  [`Tienen comillas`,          `nombre ~ '"'`],
  [`Tienen pipe |`,            `nombre ~ '\\|'`],
  [`Tienen guión bajo _`,      `nombre ~ '_'`],
  [`Son solo "SKU XXXXX"`,     `nombre ~ '^SKU \\d+$'`],
  [`"Para Celulares – SKU"`,   `nombre LIKE 'Para Celulares – SKU%'`],
  [`"Funda X Para X" doble`,   `nombre ~ '^Funda (Tablet|Notebook|Auricular) Para'`],
];

console.log('\n=== PROBLEMAS PENDIENTES ===');
for (const [label, cond] of checks) {
  const { rows } = await pool.query(`SELECT count(*) FROM productos WHERE ${cond}`);
  if (rows[0].count > 0) console.log(` ${rows[0].count.toString().padStart(5)} × ${label}`);
}

await pool.end();
