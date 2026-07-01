// Importador standalone genérico — grupos distintos de Fundas iPhone
// Uso: node scripts/importar-generico.mjs <archivo.csv>
// Requiere: DATABASE_URL como variable de entorno

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const pg = require('pg');
const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('ERROR: DATABASE_URL no está definida'); process.exit(1); }

const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false }, max: 5 });

async function crearArticulo({ nombre, sku = '', descripcion = '', grupo_id, subgrupo_id, categoria_jer_id, marca_prod_id, precio = 0, stock = 0 }) {
  const { rows: [p] } = await pool.query(
    `INSERT INTO productos (nombre, sku, descripcion, grupo_id, subgrupo_id, categoria_jer_id, marca_prod_id, precio, precio_regular, stock, stock_status, actualizado_en)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,CASE WHEN $9>0 THEN 'instock' ELSE 'outofstock' END,NOW())
     RETURNING id`,
    [nombre, sku, descripcion, grupo_id || null, subgrupo_id || null, categoria_jer_id || null, marca_prod_id || null, precio, stock]
  );
  return p;
}

async function setArticuloAtributos(producto_id, atributos) {
  await pool.query(`DELETE FROM producto_atributos WHERE producto_id=$1`, [producto_id]);
  for (const { atributo_id, valor_id, valor_num, valor_texto } of atributos) {
    if (!atributo_id) continue;
    await pool.query(
      `INSERT INTO producto_atributos (producto_id, atributo_id, valor_id, valor_num, valor_texto) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [producto_id, atributo_id, valor_id || null, valor_num || null, valor_texto || null]
    );
  }
}

// Mapeo BASE code → grupo/subgrupo/categoria en DB
// Patrón: 13XY → grupo 13, subgrupo X (posición dentro del grupo), categoria Y
const BASE_MAP = {
  // Iluminacion (sg_nombre=Iluminacion → id 68)
  '1311': { grupo: 13, sg: 'Iluminacion',        cat: 'Hogar' },
  '1312': { grupo: 13, sg: 'Iluminacion',        cat: 'Deco' },
  '1313': { grupo: 13, sg: 'Iluminacion',        cat: 'Compacta' },
  '131':  { grupo: 13, sg: 'Iluminacion',        cat: null },
  // Jugueteria (sg_id 69)
  '1321': { grupo: 13, sg: 'Jugueteria',         cat: 'electronicos' },
  '1322': { grupo: 13, sg: 'Jugueteria',         cat: 'juegos_de_mesa' },
  '1323': { grupo: 13, sg: 'Jugueteria',         cat: 'Otros' },
  // Bazar_LifeStyle (sg_id 70)
  '1331': { grupo: 13, sg: 'Bazar_LifeStyle',    cat: 'Termos' },
  '1332': { grupo: 13, sg: 'Bazar_LifeStyle',    cat: 'Vasos_termicos' },
  '1333': { grupo: 13, sg: 'Bazar_LifeStyle',    cat: 'botellas_termicas' },
  '1335': { grupo: 13, sg: 'Bazar_LifeStyle',    cat: null },
  // Tecnologias (sg_id 71)
  '1341': { grupo: 13, sg: 'Tecnologias',        cat: 'streaming_tv' },
  '1342': { grupo: 13, sg: 'Tecnologias',        cat: 'Gadgets' },
  '1343': { grupo: 13, sg: 'Tecnologias',        cat: 'Seguridad' },
  // Articulos_de_temporada (sg_id 72)
  '135':  { grupo: 13, sg: 'Articulos_de_temporada', cat: null },
  // Grupo 11 - Equipos
  '111': { grupo: 11, sg: 'Smartphones',      cat: null },
  '112': { grupo: 11, sg: 'Tablets',          cat: null },
  '113': { grupo: 11, sg: 'Smartwatchs',      cat: null },
  '114': { grupo: 11, sg: 'GPS',              cat: null },
  '115': { grupo: 11, sg: 'Celulares_basicos',cat: null },
  '116': { grupo: 11, sg: 'Relojes_digitales',cat: null },
  // Grupo 12 - GAMER
  '121': { grupo: 12, sg: 'Teclado',              cat: null },
  '122': { grupo: 12, sg: 'Mouse',                cat: null },
  '123': { grupo: 12, sg: 'Joystick_y_Controles', cat: null },
  '124': { grupo: 12, sg: 'Consolas',             cat: null },
  '125': { grupo: 12, sg: 'Mousepad',             cat: null },
  '126': { grupo: 12, sg: 'Headsets',             cat: null },
  // Grupo 7 - Accesorios
  '71':  { grupo: 7,  sg: 'Soporte',              cat: null },
  '72':  { grupo: 7,  sg: 'Holder',               cat: null },
  '73':  { grupo: 7,  sg: 'Mallas',               cat: null },
  '74':  { grupo: 7,  sg: 'Base',                 cat: null },
  '75':  { grupo: 7,  sg: 'Lapiz_Optico',         cat: null },
  '76':  { grupo: 7,  sg: 'Content_Creator',      cat: null },
  '761': { grupo: 7,  sg: 'Content_Creator',      cat: null },
  '762': { grupo: 7,  sg: 'Content_Creator',      cat: null },
  '763': { grupo: 7,  sg: 'Content_Creator',      cat: null },
  '764': { grupo: 7,  sg: 'Content_Creator',      cat: null },
  '765': { grupo: 7,  sg: 'Content_Creator',      cat: null },
  // Grupo 3 - Adaptadores
  '31':  { grupo: 3,  sg: 'OTG',                  cat: null },
  '32':  { grupo: 3,  sg: 'Splitter',             cat: null },
  '33':  { grupo: 3,  sg: 'Enchufe',              cat: null },
  '34':  { grupo: 3,  sg: 'Multifuncion',         cat: null },
  // Grupo 5 - Audio
  '511': { grupo: 5,  sg: 'Auricular',            cat: 'In-ear' },
  '512': { grupo: 5,  sg: 'Auricular',            cat: 'Over-ear' },
  '513': { grupo: 5,  sg: 'Auricular',            cat: 'On-ear' },
  '52':  { grupo: 5,  sg: 'Parlante',             cat: null },
  '53':  { grupo: 5,  sg: 'Microfonos',           cat: null },
  '55':  { grupo: 5,  sg: 'Cargador_Vehiculo',    cat: null },
  // Grupo 6 - Fundas Celulares / Notebook
  '631': { grupo: 6,  sg: 'Notebook_Netbook',     cat: null },
  '637': { grupo: 6,  sg: 'Notebook_Netbook',     cat: null },
  '6310':{ grupo: 6,  sg: 'Notebook_Netbook',     cat: null },
  '643': { grupo: 6,  sg: 'Auriculares',           cat: null },
  '611': { grupo: 6,  sg: 'Celulares',            cat: 'Rigidas' },
  '612': { grupo: 6,  sg: 'Celulares',            cat: 'Flexibles' },
  '613': { grupo: 6,  sg: 'Celulares',            cat: 'Silicona' },
  '614': { grupo: 6,  sg: 'Celulares',            cat: 'Book_cover' },
  '621': { grupo: 6,  sg: 'Tablet',               cat: 'Rigidas' },
  '622': { grupo: 6,  sg: 'Tablet',               cat: 'Antishock' },
  '623': { grupo: 6,  sg: 'Tablet',               cat: 'Rotativa' },
  '624': { grupo: 6,  sg: 'Tablet',               cat: 'Book_cover' },
  '625': { grupo: 6,  sg: 'Tablet',               cat: null },
  '626': { grupo: 6,  sg: 'Tablet',               cat: null },
  '627': { grupo: 6,  sg: 'Tablet',               cat: 'Generica' },
  '628': { grupo: 6,  sg: 'Tablet',               cat: 'Samsung_Book' },
  '657': { grupo: 6,  sg: 'Tablet',               cat: null },
  '661': { grupo: 6,  sg: 'Parlante',             cat: null },
  // Grupo 4 - Almacenamiento
  '41':  { grupo: 4,  sg: 'Tarjeta_de_almacenamiento', cat: null },
  '42':  { grupo: 4,  sg: 'Pendrive',             cat: null },
  '43':  { grupo: 4,  sg: 'Disco_Externo',        cat: null },
  '44':  { grupo: 4,  sg: 'Lectores',             cat: null },
  '45':  { grupo: 4,  sg: 'Memorias_RAM',         cat: null },
  // Subcategorias Grupo 12 - Joystick
  '1231': { grupo: 12, sg: 'Joystick_y_Controles', cat: 'Smartphones' },
  '1232': { grupo: 12, sg: 'Joystick_y_Controles', cat: 'Consola' },
  // Grupo 8 - Informatica
  '821':  { grupo: 8, sg: 'Perifericos_PC',        cat: 'Teclado' },
  '822':  { grupo: 8, sg: 'Perifericos_PC',        cat: 'Mouse' },
  '823':  { grupo: 8, sg: 'Perifericos_PC',        cat: 'Mousepad' },
  '824':  { grupo: 8, sg: 'Perifericos_PC',        cat: 'Audio_y_Video' },
  // Grupo 8 - Conectividad (cables)
  '812':  { grupo: 8, sg: 'Conectividad',          cat: null },
  '8121': { grupo: 8, sg: 'Conectividad',         cat: 'LAN' },
  '8122': { grupo: 8, sg: 'Conectividad',         cat: 'USB' },
  '8123': { grupo: 8, sg: 'Conectividad',         cat: 'AUX' },
  '8124': { grupo: 8, sg: 'Conectividad',         cat: 'HDMI' },
  '8125': { grupo: 8, sg: 'Conectividad',         cat: 'USB_C' },
};

const normH = h => {
  let s = (h || '').trim();
  try { const f = Buffer.from(s, 'latin1').toString('utf8'); if (!f.includes('?')) s = f; } catch {}
  return s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s*\(\d+\)/g, '')
    .replace(/[/\s]+/g, '_')
    .replace(/_+$/, '');
};

const humanize = s => (s || '').trim()
  .replace(/_/g, ' ')
  .replace(/\b\w/g, c => c.toUpperCase());

const COL_ATR = {
  'funcion':'funcion', 'mecanismo_agarre':'mecanismo_agarre', 'tipo_uso':'tipo_uso',
  'tipo_fuente_luz':'tipo_fuente_luz', 'tipo_microfono':'tipo_microfono',
  'tipo_conexion':'tipo_conexion', 'sistema_encastre':'sistema_encastre',
  'tipo_lapiz':'tipo_lapiz', 'sistema_ajuste_malla':'sistema_ajuste_malla',
  'tipo_de_base':'tipo_de_base', 'c_almacenamiento':'c_almacenamiento',
  'cancelacion_sonido':'cancelacion_sonido', 'microfono':'microfono', 'sonido':'sonido',
  'plataforma_comaptible':'plataforma_compatible', 'entrada_mic':'entrada_mic',
  'funcion_senal':'funcion_senal', 'cantida_botones':'cantidad_de_botones',
  'vibraciones':'vibracion', 'tipo_de_cable':'tipo_de_cable',
  'tipo_de_carga':'tipo_carga', 'covertura_film':'covertura_film',
  'tipo_film':'tipo_film', 'estado_equipo':'estado_equipo', 'tipo_gps':'tipo_gps',
  'tipo_de_prodcuto':'tipo_de_producto', 'tipo_de_juego':'tipo_de_juego',
  'capacidad_liquidos':'capacidad_liquidos',
  'estruct':'estructura', 'tipo_bumper':'tipo_bumper', 'tipo_fijacion':'tipo_fijacion',
  'material':'material', 'kit_incluye':'kit_incluye', 'tipo_punta':'tipo_punta',
  'tipo_formato':'tipo_formato', 'formato_auricular':'formato_auricular',
  'cant_puertos':'cantidad_puertos', 'tipo_mouse':'tipo_mouse',
  'formato_teclado':'formato_teclado', 'distribucion_teclado':'distribucion_teclado',
  'resolucion':'resolucion', 'tipo_controlador':'tipo_controlador',
  'tipo_consola':'tipo_consola', 'generacion_consola':'generacion_consola',
  'tipo_plataforma':'tipo_plataforma', 'tipo_de_cargador':'tipo_de_cargador',
  'tipo_de_fuente':'tipo_de_fuente', 'tipo_equipo':'tipo_equipo',
  'dispositivo_streaming':'dispositivo_streaming',
  'visual':'visual', 'tipo_brillo_acabado':'tipo_brillo_acabado',
  'tipo_borde':'tipo_borde', 'tipo_diseno':'tipo_diseno',
  'interfaz_entrada_input':'tipo_interfaz', 'tipo_alimentacion':'tipo_alimentacion',
  'cantidad_microfonos':'cantidad_microfonos', 'temperatura_color':'temperatura_color',
  'plug_and_play':'plug_and_play', 'generacion':'generacion',
  'tecnologia_wireless':'tecnologia_wireless', 'estandar_wifi':'estandar_wifi',
  'banda':'banda', 'categoria_de_red':'categoria_de_red',
  'estandar_hdmi':'estandar_hdmi', 'conexion_video':'conexion_video',
  'potencia':'potencia_w', 'volt_max':'voltaje_max_v',
  'tipo_de_pilas_compat':'tipo_pilas', 'almacenamiento_gb':'almacenamiento_gb',
  'memoria_ram':'memoria_ram_gb', 'tipo_ram':'tipo_ram', 'formato_ram':'formato_ram',
  'frecuencia':'frecuencia_mhz', 'tipo_bateria':'tipo_bateria',
  'capacidad_bateria':'capacidad_bateria_mah',
};

async function importarGenerico(csvText) {
  const lines    = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const rows     = lines.map(l => l.split(','));

  let hdrIdx = -1;
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    if (rows[i].some(c => c.includes('Codigo')) && rows[i].some(c => c.includes('Viejo'))) {
      hdrIdx = i; break;
    }
  }
  if (hdrIdx < 0) throw new Error('No se encontró la fila de encabezados');

  const headers  = rows[hdrIdx].map(h => h.trim());
  const dataRows = rows.slice(hdrIdx + 1).filter(r => r.some(c => c.trim()));
  console.log(`Headers fila ${hdrIdx + 1}, ${headers.length} cols, ${dataRows.length} filas datos`);

  const ci = name => headers.findIndex(h => h.trim() === name);
  const IDX = {
    sku:    ci('Codigo Viejo') >= 0 ? ci('Codigo Viejo') : 1,
    base:   ci('C_Nuevo_BASE') >= 0 ? ci('C_Nuevo_BASE') : 2,
    color:  ci('Color') >= 0 ? ci('Color') : 4,
    model:  ci('Modelos') >= 0 ? ci('Modelos') : 5,
    marca:  ci('marca') >= 0 ? ci('marca') : 6,
  };

  const atrCols = [];
  for (let i = 0; i < headers.length; i++) {
    const n = normH(headers[i]);
    if (COL_ATR[n]) atrCols.push({ colIdx: i, atrNombre: COL_ATR[n] });
  }
  console.log(`Atributos mapeados: ${atrCols.length}`);

  // Cargar referencias DB
  const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const [sgRes, catRes, colorRes, atrRes, valRes] = await Promise.all([
    pool.query(`SELECT id, grupo_id, nombre FROM subgrupos WHERE activo`),
    pool.query(`SELECT id, subgrupo_id, nombre FROM categorias_jerarquia WHERE activo`),
    pool.query(`SELECT id, nombre FROM colores WHERE activo`),
    pool.query(`SELECT id, nombre, tipo FROM atributos WHERE activo`),
    pool.query(`SELECT id, atributo_id, codigo FROM valores_atributo`),
  ]);

  const colorMap    = new Map(colorRes.rows.map(r => [r.id, r.nombre]));
  const atrByNombre = new Map(atrRes.rows.map(r => [r.nombre, r]));
  const valMap = {};
  for (const v of valRes.rows) {
    if (!valMap[v.atributo_id]) valMap[v.atributo_id] = {};
    valMap[v.atributo_id][v.codigo] = v.id;
  }

  const resolveBase = base => {
    const info = BASE_MAP[base];
    if (!info) return { grupo_id: null, subgrupo_id: null, categoria_jer_id: null };
    const sg = sgRes.rows.find(s => s.grupo_id === info.grupo && norm(s.nombre) === norm(info.sg));
    const cat = info.cat && sg
      ? catRes.rows.find(c => c.subgrupo_id === sg.id && norm(c.nombre) === norm(info.cat))
      : null;
    return { grupo_id: info.grupo, subgrupo_id: sg?.id || null, categoria_jer_id: cat?.id || null };
  };

  // Agrupar por (sku, base, color)
  const groups = new Map();
  for (const row of dataRows) {
    const sku   = (row[IDX.sku]   || '').trim();
    const base  = (row[IDX.base]  || '').trim();
    const color = (row[IDX.color] || '').trim();
    if (!sku || sku === '0' || !base || base === '0') continue;
    const key = `${sku}:${base}:${color}`;
    if (!groups.has(key)) groups.set(key, { row });
    // Para genérico no acumulamos modelos de dispositivo
  }
  console.log(`Grupos únicos: ${groups.size}`);

  const creados = [], errores = [];
  let i = 0;
  for (const [key, { row }] of groups) {
    i++;
    const [sku, base, colorId] = key.split(':');
    try {
      const { grupo_id, subgrupo_id, categoria_jer_id } = resolveBase(base);
      const colorNombre = colorId && colorId !== '0' ? (colorMap.get(Number(colorId)) || `Color ${colorId}`) : null;
      const modeloRaw   = (row[IDX.model] || '').trim();
      const isRealModel = modeloRaw && modeloRaw !== '0' && !/^\d+$/.test(modeloRaw);
      const modelNombre = isRealModel ? humanize(modeloRaw) : null;
      const nombre      = modelNombre && colorNombre ? `${modelNombre} – ${colorNombre}`
                        : modelNombre ? modelNombre
                        : colorNombre ? colorNombre
                        : `SKU ${sku}`;
      const artSku      = colorId && colorId !== '0' ? `${base}-${sku}-C${colorId}` : `${base}-${sku}`;
      const marcaRaw    = (row[IDX.marca] || '').trim();
      const marca_prod_id = (marcaRaw && marcaRaw !== '0' && !isNaN(marcaRaw)) ? Number(marcaRaw) : null;

      const atributos = [];
      for (const { colIdx, atrNombre } of atrCols) {
        const rawVal = (row[colIdx] || '').trim();
        if (!rawVal || rawVal === '0') continue;
        const atr = atrByNombre.get(atrNombre);
        if (!atr) continue;
        if (atr.tipo === 'number') {
          const n = parseFloat(rawVal);
          if (!isNaN(n) && n !== 0) atributos.push({ atributo_id: atr.id, valor_num: n });
        } else {
          const parts   = rawVal.split('|').map(p => p.trim()).filter(Boolean);
          const atrVals = valMap[atr.id] || {};
          for (const p of parts) {
            const valor_id = atrVals[p.padStart(3,'0')] || atrVals[p.padStart(2,'0')] || atrVals[p];
            if (valor_id) { atributos.push({ atributo_id: atr.id, valor_id }); break; }
          }
        }
      }

      const art = await crearArticulo({ nombre, sku: artSku, grupo_id, subgrupo_id, categoria_jer_id, marca_prod_id });
      if (atributos.length) await setArticuloAtributos(art.id, atributos);
      creados.push({ id: art.id, sku: artSku, nombre });
      if (i % 20 === 0) console.log(`  [${i}/${groups.size}] ${nombre}`);
    } catch (e) {
      errores.push({ clave: key, error: e.message });
      if (errores.length <= 5) console.error(`  ERROR ${key}: ${e.message}`);
    }
  }

  return { creados: creados.length, errores: errores.length, errores_detalle: errores.slice(0,10), primeros: creados.slice(0,8) };
}

// ─── Main ────────────────────────────────────────────────────────────────────
const csvPath = process.argv[2];
if (!csvPath) { console.error('Uso: node scripts/importar-generico.mjs <archivo.csv>'); process.exit(1); }

const csvText = await readFile(resolve(csvPath), 'utf8');
console.log(`CSV leído: ${csvText.length} chars`);

const result = await importarGenerico(csvText);
console.log('\n=== RESULTADO ===');
console.log(`Creados: ${result.creados}`);
console.log(`Errores: ${result.errores}`);
if (result.primeros.length) {
  console.log('\nPrimeros:');
  for (const p of result.primeros) console.log(`  [${p.id}] ${p.sku} — ${p.nombre}`);
}
if (result.errores_detalle.length) {
  console.log('\nErrores:');
  for (const e of result.errores_detalle) console.log(`  ${e.clave}: ${e.error}`);
}
await pool.end();
