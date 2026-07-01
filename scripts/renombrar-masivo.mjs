// Renombrado masivo de productos por SKU
// SKU formato: GGG-NNNNN-CXX  → tipo(GGG) + artículo(NNNNN) + color(CXX)
import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const TIPO = {
  '611':'Funda Rígida','612':'Funda Flexible','613':'Funda Silicona',
  '614':'Funda','615':'Book Cover','616':'Funda','617':'Funda',
  '621':'Funda Tablet','622':'Funda Tablet','623':'Funda Tablet',
  '624':'Funda Tablet','625':'Funda Tablet','626':'Funda Tablet',
  '627':'Funda Tablet','628':'Funda Tablet',
  '631':'Funda Notebook','632':'Funda Notebook','637':'Funda Notebook',
  '638':'Funda Notebook','643':'Funda Auricular',
  '111':'Smartphone','112':'Tablet','113':'Smartwatch','114':'Smartwatch',
  '123':'Control','134':'Cámara','135':'Accesorio',
  '511':'Auricular','512':'Auricular','513':'Auricular',
  '521':'Parlante','522':'Parlante','523':'Parlante',
  '811':'Cable','812':'Cable','813':'Cable','814':'Cable','815':'Cable',
  '821':'Periférico','822':'Periférico','823':'Periférico',
  '311':'Adaptador','312':'Adaptador','321':'Splitter','341':'Multifunción',
  '342':'Multifunción','343':'Multifunción',
};
const TIPO2 = {
  '71':'Soporte','72':'Holder','73':'Malla','74':'Malla','75':'Lápiz Óptico',
  '31':'Adaptador','32':'Splitter','34':'Multifunción','52':'Parlante',
};

const COLOR = {
  0:'',1:'Negro',2:'Blanco',3:'Gris',4:'Gris claro',5:'Gris oscuro',
  6:'Plateado',7:'Dorado',8:'Rose Gold',9:'Gris topo',10:'Azul',
  11:'Azul oscuro',12:'Celeste',13:'Verde',14:'Verde claro',15:'Verde oscuro',
  16:'Rojo',17:'Bordo',18:'Rosa',19:'Fucsia',20:'Naranja',21:'Amarillo',
  22:'Violeta',23:'Lavanda',24:'Marrón',25:'Beige',26:'Rosa viejo',27:'Salmón',
  28:'Turquesa',29:'Rosa pastel',30:'Verde pastel',31:'Violeta pastel',
  32:'Celeste pastel',33:'Fluo amarillo',34:'Fluo verde',35:'Fluo rosa',
  36:'Fluo naranja',37:'Amarillo pastel',38:'Granate',39:'Rosa chicle',
  40:'Multicolor',41:'Azul eléctrico',42:'Cherry',43:'Verde agua',
  44:'Azul oxford',45:'Rosa Barbie',46:'Rosa palo',47:'Coral',48:'Magenta',
  49:'Nude',50:'Amarillo ocre',51:'Azul pizarra',52:'Azul petróleo',
  53:'Verde manzana',54:'Azul grafito',55:'Azul ice',56:'Amarillo limón',
  57:'Amarillo girasol',58:'Sky blue',59:'Verde arcilla',60:'Púrpura',
  61:'Camel',62:'White gold',63:'Visón',
};

// Frases de categoría/subgrupo que no deben aparecer en el nombre del producto
const PREFIJOS_CATEGORIA = [
  'Artículos de Temporada','Bazar LifeStyle','Content Creator','Juguetería','Tecnologías',
];

// Todos los tipos (mayor a menor longitud para que los compuestos tengan prioridad)
const ALL_TIPOS = [...new Set([...Object.values(TIPO), ...Object.values(TIPO2)])]
  .sort((a, b) => b.length - a.length);

// Palabras que solas NO son un dispositivo válido (son sufijos del tipo)
const TIPO_SUFIJOS = new Set([
  'silicona','rígida','rigida','flexible','auricular','notebook','tablet',
  'cover','holder','soporte','malla','parlante','adaptador','splitter',
  'multifunción','multifuncion','cámara','camara','accesorio','cable',
  'periférico','periferico','lápiz óptico','lapiz optico','funda',
]);

function parseSku(sku) {
  const m = sku.match(/^(\d+)-(.+?)(?:-C(\d+))?$/);
  if (!m) return null;
  return { prefix: m[1], cod: m[2], colorId: m[3] != null ? +m[3] : null };
}

function extractDevice(tipo, leftPart) {
  let s = leftPart.trim();
  // Hasta 5 pasadas, intentando quitar prefijos de tipo
  for (let pass = 0; pass < 5; pass++) {
    let stripped = false;
    // En la primera pasada priorizamos el tipo exacto del producto
    const candidates = pass === 0 ? [tipo, ...ALL_TIPOS] : ALL_TIPOS;
    for (const t of candidates) {
      if (s.toLowerCase() === t.toLowerCase()) return '';       // todo el string es el tipo → sin dispositivo
      if (s.toLowerCase().startsWith((t + ' ').toLowerCase())) {
        s = s.slice(t.length + 1).trim();
        stripped = true;
        break;
      }
    }
    if (!stripped) break;
  }
  // Si lo que queda es solo un sufijo de tipo (ej: "Silicona", "Rígida") → sin dispositivo
  if (TIPO_SUFIJOS.has(s.toLowerCase())) return '';
  return s;
}

function construirNombre(sku, nombreActual) {
  const p = parseSku(sku);
  if (!p) return null;

  const tipo = TIPO[p.prefix] || TIPO2[p.prefix.slice(0, 2)];
  if (!tipo) return null; // prefijo desconocido → no tocar

  const color = p.colorId != null ? (COLOR[p.colorId] ?? '') : '';

  // Limpiar prefijos de categoría del nombre original antes de procesar
  let nombreLimpio = nombreActual;
  for (const cat of PREFIJOS_CATEGORIA) {
    nombreLimpio = nombreLimpio.replace(new RegExp(cat + '\\s*', 'gi'), '').trim();
  }

  // Partir por " – " para separar dispositivo de color
  const sep = nombreLimpio.includes(' – ') ? ' – ' : (nombreLimpio.includes(' - ') ? ' - ' : null);
  const leftPart = sep ? nombreLimpio.split(sep)[0] : nombreLimpio;

  const dispositivo = extractDevice(tipo, leftPart);

  // Si el dispositivo extraído coincide exactamente con el color, descartarlo
  if (dispositivo.toLowerCase() === color.toLowerCase()) return [tipo, ...(color ? ['– ' + color] : [])].join(' ');

  const partes = [tipo];
  if (dispositivo) partes.push(dispositivo);
  if (color) partes.push('– ' + color);

  return partes.join(' ');
}

// ─── Main ────────────────────────────────────────────────────────────────────
const { rows: todos } = await pool.query(
  `SELECT id, sku, nombre FROM productos WHERE activo = TRUE AND sku != '' ORDER BY id`
);

console.log(`Total con SKU: ${todos.length}`);

const actualizaciones = [];
const ejemplos = [];
let sinPrefijo = 0;

for (const p of todos) {
  const nuevo = construirNombre(p.sku, p.nombre);
  if (nuevo === null) { sinPrefijo++; continue; }
  if (nuevo === p.nombre) continue; // ya está bien
  actualizaciones.push({ id: p.id, nombre: nuevo });
  if (ejemplos.length < 12) ejemplos.push({ antes: p.nombre, despues: nuevo, sku: p.sku });
}

console.log(`\nPrefijos desconocidos (no tocar): ${sinPrefijo}`);
console.log(`A renombrar: ${actualizaciones.length}`);
console.log(`\nEjemplos:`);
ejemplos.forEach(e => console.log(`  SKU ${e.sku}\n    ANTES:  ${e.antes}\n    DESPUÉS: ${e.despues}`));

if (!actualizaciones.length) { console.log('\nNada que actualizar.'); await pool.end(); process.exit(0); }

// Confirmar si se pasa --run
const doRun = process.argv.includes('--run');
if (!doRun) {
  console.log('\n⚠️  Modo DRY-RUN. Pasá --run para aplicar los cambios.');
  await pool.end();
  process.exit(0);
}

console.log('\nActualizando...');
let ok = 0;
// Batch de 100 a la vez para no saturar conexiones
for (let i = 0; i < actualizaciones.length; i += 100) {
  const batch = actualizaciones.slice(i, i + 100);
  await Promise.all(batch.map(u =>
    pool.query('UPDATE productos SET nombre=$1, actualizado_en=NOW() WHERE id=$2', [u.nombre, u.id])
  ));
  ok += batch.length;
  if (ok % 500 === 0 || ok === actualizaciones.length) process.stdout.write(`\r  ${ok}/${actualizaciones.length} `);
}

console.log(`\n✓ Renombrados ${ok} productos.`);
await pool.end();
