import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

// Nombres display mejorados para grupos y subgrupos
const GRUPO_NOMBRES = {
  1: 'Repuestos',
  2: 'Servicios',
  3: 'Adaptadores',
  4: 'Almacenamiento',
  5: 'Audio',
  6: 'Fundas',
  7: 'Accesorios',
  8: 'Informática',
  9: 'Energía',
  10: 'Vidrios Templados',
  11: 'Equipos',
  12: 'Gamer',
  13: 'Novedades',
};

const SUBGRUPO_NOMBRES = {
  // Repuestos
  1: 'Partes', 2: 'Pantalla', 3: 'Botón', 4: 'Cámara', 5: 'Flex',
  6: 'IC', 7: 'Conector', 8: 'Audio', 9: 'Carga', 10: 'Cosmético', 11: 'Placa',
  // Servicios
  12: 'Backup', 13: 'Cuenta de Google', 14: 'Instalación de Software',
  15: 'Full Box', 16: 'Unlock Box', 17: 'Downgrade Android', 18: 'Downgrade',
  19: 'Hard Reset', 20: 'Secado',
  // Adaptadores
  21: 'OTG', 22: 'Splitter', 23: 'Enchufe', 24: 'Multifunción',
  // Almacenamiento
  25: 'Tarjeta de Almacenamiento', 26: 'Pendrive', 27: 'Disco Externo',
  28: 'Lectores', 29: 'Memorias RAM',
  // Audio
  30: 'Auricular', 31: 'Parlante', 32: 'Micrófono', 33: 'Karaoke',
  34: 'Reproductores para Vehículo',
  // Fundas
  35: 'Para Celulares', 36: 'Para Tablet', 37: 'Para Notebook',
  38: 'Para Auriculares', 39: 'Para GPS', 40: 'Para Parlantes y Cámaras',
  // Accesorios
  41: 'Soporte', 42: 'Holder', 43: 'Mallas', 44: 'Base', 45: 'Lápiz Óptico',
  46: 'Content Creator',
  // Informática
  47: 'Conectividad', 48: 'Periféricos PC', 49: 'Estabilizadores',
  // Energía
  50: 'Baterías y Pilas', 51: 'Cargadores', 52: 'Fuentes',
  // Vidrios Templados
  53: 'Clásico', 54: 'Cerámico', 55: 'Lámina LENSUN',
  // Equipos
  56: 'Smartphones', 57: 'Tablets', 58: 'Smartwatches', 59: 'GPS',
  60: 'Celulares Básicos', 61: 'Relojes Digitales',
  // Gamer
  62: 'Teclado', 63: 'Mouse', 64: 'Joystick y Controles', 65: 'Consolas',
  66: 'Mousepad', 67: 'Headsets',
  // Novedades
  68: 'Iluminación', 69: 'Juguetería', 70: 'Bazar LifeStyle',
  71: 'Tecnologías', 72: 'Artículos de Temporada',
};

// Actualizar nombres en grupos
for (const [id, nombre] of Object.entries(GRUPO_NOMBRES)) {
  await pool.query(`UPDATE grupos SET nombre = $1 WHERE id = $2`, [nombre, id]);
}
console.log('Grupos actualizados:', Object.keys(GRUPO_NOMBRES).length);

// Actualizar nombres en subgrupos
for (const [id, nombre] of Object.entries(SUBGRUPO_NOMBRES)) {
  await pool.query(`UPDATE subgrupos SET nombre = $1 WHERE id = $2`, [nombre, id]);
}
console.log('Subgrupos actualizados:', Object.keys(SUBGRUPO_NOMBRES).length);

// Rebuildar productos.categorias con los nuevos nombres
const upd = await pool.query(`
  UPDATE productos p
  SET categorias = (
    SELECT jsonb_build_array(g.nombre, s.nombre)
    FROM grupos g
    JOIN subgrupos s ON s.id = p.subgrupo_id AND s.grupo_id = g.id
    WHERE g.id = p.grupo_id
  )
  WHERE p.grupo_id IS NOT NULL AND p.subgrupo_id IS NOT NULL
`);
console.log('Productos con categorias actualizadas:', upd.rowCount);

// Para productos sin subgrupo pero con grupo
const upd2 = await pool.query(`
  UPDATE productos p
  SET categorias = (SELECT jsonb_build_array(g.nombre) FROM grupos g WHERE g.id = p.grupo_id)
  WHERE p.grupo_id IS NOT NULL
    AND (p.subgrupo_id IS NULL OR NOT EXISTS (SELECT 1 FROM subgrupos s WHERE s.id = p.subgrupo_id))
`);
console.log('Productos solo con grupo:', upd2.rowCount);

// Verificar
const check = await pool.query(`
  SELECT categorias, count(*) FROM productos GROUP BY categorias ORDER BY count(*) DESC LIMIT 10
`);
console.log('\n=== TOP categorias finales ===');
for (const r of check.rows) console.log(' ', JSON.stringify(r.categorias), '→', r.count);

await pool.end();
