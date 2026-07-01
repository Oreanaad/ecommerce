import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const fixes = [
  // 1. Encoding roto
  [`UPDATE productos SET nombre = regexp_replace(nombre, 'Ã±', 'ñ', 'g') WHERE nombre LIKE '%Ã±%'`, 'encoding ñ'],
  [`UPDATE productos SET nombre = regexp_replace(nombre, 'Ã©', 'é', 'g') WHERE nombre LIKE '%Ã©%'`, 'encoding é'],
  [`UPDATE productos SET nombre = regexp_replace(nombre, 'Ã¡', 'á', 'g') WHERE nombre LIKE '%Ã¡%'`, 'encoding á'],
  [`UPDATE productos SET nombre = regexp_replace(nombre, 'Ã³', 'ó', 'g') WHERE nombre LIKE '%Ã³%'`, 'encoding ó'],
  [`UPDATE productos SET nombre = regexp_replace(nombre, 'Ãº', 'ú', 'g') WHERE nombre LIKE '%Ãº%'`, 'encoding ú'],
  [`UPDATE productos SET nombre = regexp_replace(nombre, 'Ã­', 'í', 'g') WHERE nombre LIKE '%Ã­%'`, 'encoding í'],

  // 2. Quitar " – SKU XXXXXX" (con número) — el SKU ya está en el campo sku
  [`UPDATE productos SET nombre = trim(regexp_replace(nombre, '\\s*[–-]\\s*SKU\\s+\\d+', '', 'g'))
    WHERE nombre ~ 'SKU\\s+\\d+'`, 'strip – SKU XXXXX'],

  // 3. Limpiar doble guión que puede quedar "Holder –  – Color" o "Holder – "
  [`UPDATE productos SET nombre = regexp_replace(nombre, '\\s*–\\s*–', ' –', 'g')
    WHERE nombre ~ '–\\s*–'`, 'limpiar doble guión'],
  [`UPDATE productos SET nombre = rtrim(nombre, ' –')
    WHERE nombre ~ '–\\s*$'`, 'limpiar guión al final'],

  // 4. Plurales → singulares en los prefijos
  [`UPDATE productos SET nombre = 'Smartphone ' || substr(nombre, length('Smartphones ')+1) WHERE nombre LIKE 'Smartphones %'`, 'Smartphones→Smartphone'],
  [`UPDATE productos SET nombre = 'Smartwatch ' || substr(nombre, length('Smartwatches ')+1) WHERE nombre LIKE 'Smartwatches %'`, 'Smartwatches→Smartwatch'],
  [`UPDATE productos SET nombre = 'Tablet ' || substr(nombre, length('Tablets ')+1) WHERE nombre LIKE 'Tablets %'`, 'Tablets→Tablet'],
  [`UPDATE productos SET nombre = 'Consola ' || substr(nombre, length('Consolas ')+1) WHERE nombre LIKE 'Consolas %'`, 'Consolas→Consola'],
  [`UPDATE productos SET nombre = 'Headset ' || substr(nombre, length('Headsets ')+1) WHERE nombre LIKE 'Headsets %'`, 'Headsets→Headset'],
  [`UPDATE productos SET nombre = 'Memoria RAM ' || substr(nombre, length('Memorias RAM ')+1) WHERE nombre LIKE 'Memorias RAM %'`, 'Memorias RAM→Memoria RAM'],
  [`UPDATE productos SET nombre = 'Reloj Digital ' || substr(nombre, length('Relojes Digitales ')+1) WHERE nombre LIKE 'Relojes Digitales %'`, 'Relojes Digitales→Reloj Digital'],
  [`UPDATE productos SET nombre = 'Lector ' || substr(nombre, length('Lectores ')+1) WHERE nombre LIKE 'Lectores %'`, 'Lectores→Lector'],

  // 5. Nombres más descriptivos
  [`UPDATE productos SET nombre = 'Tarjeta SD ' || substr(nombre, length('Tarjeta de Almacenamiento ')+1) WHERE nombre LIKE 'Tarjeta de Almacenamiento %'`, 'Tarjeta de Almacenamiento→Tarjeta SD'],
  [`UPDATE productos SET nombre = 'Tarjeta SD' WHERE nombre = 'Tarjeta de Almacenamiento'`, 'Tarjeta de Almacenamiento (solo)'],
  [`UPDATE productos SET nombre = 'Control ' || substr(nombre, length('Joystick y Controles ')+1) WHERE nombre LIKE 'Joystick y Controles %'`, 'Joystick y Controles→Control'],
  [`UPDATE productos SET nombre = 'Celular ' || substr(nombre, length('Celulares Básicos ')+1) WHERE nombre LIKE 'Celulares Básicos %'`, 'Celulares Básicos→Celular'],
  [`UPDATE productos SET nombre = 'Celular' WHERE nombre = 'Celulares Básicos'`, 'Celulares Básicos (solo)'],
  [`UPDATE productos SET nombre = 'Periférico ' || substr(nombre, length('Periféricos PC ')+1) WHERE nombre LIKE 'Periféricos PC %'`, 'Periféricos PC→Periférico'],
  [`UPDATE productos SET nombre = 'Cable ' || substr(nombre, length('Conectividad ')+1) WHERE nombre LIKE 'Conectividad %'`, 'Conectividad→Cable'],
  [`UPDATE productos SET nombre = 'GPS ' || substr(nombre, length('GPS ')+1) WHERE nombre LIKE 'GPS %' AND grupo_id = 11`, 'GPS no duplicar (Equipos)'],

  // 6. Capitalizar primera letra de cada palabra del color (estética)
  // No hacemos esto para evitar romper nombres de modelos

  // 7. Limpiar espacios dobles
  [`UPDATE productos SET nombre = regexp_replace(nombre, '\\s{2,}', ' ', 'g') WHERE nombre ~ '\\s{2,}'`, 'espacios dobles'],
];

let total = 0;
for (const [sql, desc] of fixes) {
  const r = await pool.query(sql);
  if (r.rowCount > 0) console.log(`  ✓ ${desc}: ${r.rowCount} productos`);
}

// Muestra una muestra del resultado
console.log('\n--- Muestra post-fix ---');
const sample = await pool.query(`
  SELECT g.nombre AS grupo, s.nombre AS sub, p.nombre
  FROM productos p
  JOIN grupos g ON g.id = p.grupo_id
  LEFT JOIN subgrupos s ON s.id = p.subgrupo_id
  WHERE p.activo
  ORDER BY g.id, s.id, random()
  LIMIT 60
`);

const grupos = {};
for (const r of sample.rows) {
  const k = `${r.grupo} > ${r.sub || '—'}`;
  if (!grupos[k]) grupos[k] = [];
  if (grupos[k].length < 4) grupos[k].push(r.nombre);
}
for (const [k, ns] of Object.entries(grupos)) {
  console.log(`\n[${k}]`);
  ns.forEach(n => console.log(`  ${n}`));
}

// Verificar si quedan productos con SKU en el nombre
const { rows: conSku } = await pool.query(`SELECT COUNT(*) AS n FROM productos WHERE nombre LIKE '%SKU%'`);
console.log(`\nProductos con "SKU" aún en el nombre: ${conSku[0].n}`);

await pool.end();
