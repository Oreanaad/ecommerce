// Importador standalone de Vinculaciones → Railway Postgres
// Uso: node scripts/importar-vinculaciones.mjs <archivo.csv>
// Requiere: DATABASE_URL como variable de entorno

import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const pg = require('pg');
const { Pool } = pg;

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error('ERROR: DATABASE_URL no está definida'); process.exit(1); }

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
});

// ─── Helpers DB ──────────────────────────────────────────────────────────────

async function crearArticulo({ nombre, sku = '', descripcion = '', grupo_id, subgrupo_id, categoria_jer_id, subcategoria_jer_id, marca_prod_id, precio, precio_regular, stock = 0 }) {
  const { rows: [p] } = await pool.query(
    `INSERT INTO productos (nombre, sku, descripcion, grupo_id, subgrupo_id, categoria_jer_id, subcategoria_jer_id, marca_prod_id, precio, precio_regular, stock, stock_status, actualizado_en)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,CASE WHEN $11>0 THEN 'instock' ELSE 'outofstock' END,NOW())
     RETURNING id`,
    [nombre, sku, descripcion, grupo_id || null, subgrupo_id || null, categoria_jer_id || null, subcategoria_jer_id || null, marca_prod_id || null, precio || 0, precio_regular || 0, stock]
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

async function setArticuloModelos(producto_id, modelo_ids) {
  await pool.query(`DELETE FROM producto_modelos WHERE producto_id=$1`, [producto_id]);
  for (const mid of (modelo_ids || [])) {
    await pool.query(`INSERT INTO producto_modelos (producto_id, modelo_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [producto_id, mid]);
  }
}

// ─── Lógica de importación ───────────────────────────────────────────────────

async function importarVinculaciones(csvText) {
  const IP = {
    '5':'iPhone 5','5S':'iPhone 5S','6':'iPhone 6','6PLUS':'iPhone 6 Plus',
    '6_PLUS':'iPhone 6 Plus','6SPLUS':'iPhone 6S Plus','6sPLUS':'iPhone 6S Plus',
    '7':'iPhone 7','7PLUS':'iPhone 7 Plus','8':'iPhone 8','8PLUS':'iPhone 8 Plus',
    'X':'iPhone X','XR':'iPhone XR','XS':'iPhone XS','XSMAX':'iPhone XS Max',
    '11':'iPhone 11','11PRO':'iPhone 11 Pro','11PROMAX':'iPhone 11 Pro Max',
    'SE':'iPhone SE (2020)','SE_2G':'iPhone SE (2020)',
    '12MINI':'iPhone 12 Mini','12':'iPhone 12','12PRO':'iPhone 12 Pro','12PROMAX':'iPhone 12 Pro Max',
    '13MINI':'iPhone 13 Mini','13':'iPhone 13','13PRO':'iPhone 13 Pro','13PROMAX':'iPhone 13 Pro Max',
    '14':'iPhone 14','14PLUS':'iPhone 14 Plus','14plus':'iPhone 14 Plus',
    '14PRO':'iPhone 14 Pro','14PROMAX':'iPhone 14 Pro Max',
    '15':'iPhone 15','15PLUS':'iPhone 15 Plus','15PRO':'iPhone 15 Pro',
    '15PROMAX':'iPhone 15 Pro Max','15ULTRA':'iPhone 15 Ultra',
    '16':'iPhone 16','16E':'iPhone 16e','16PLUS':'iPhone 16 Plus',
    '16PRO':'iPhone 16 Pro','16PROMAX':'iPhone 16 Pro Max',
    '17':'iPhone 17','17AIR':'iPhone 17 Air','17AR':'iPhone 17 Air',
    '17PLUS':'iPhone 17 Plus','17PRO':'iPhone 17 Pro','17PROMAX':'iPhone 17 Pro Max',
  };

  const BASE_LABEL = { '611':'Rígida','612':'Flexible','613':'Silicona','614':'Otro','616':'Otro' };
  const BASE_CAT   = { '611':'Rigidas','612':'Flexibles','613':'Silicona','614':'Otro','616':'Otro' };

  // Normaliza header: fix mojibake latin1→utf8, quita acentos, suffijos numéricos, etc.
  const normH = h => {
    let s = (h || '').trim();
    // Fix mojibake: bytes UTF-8 leídos como Latin-1 (ej. Ã± → ñ)
    try {
      const fixed = Buffer.from(s, 'latin1').toString('utf8');
      if (!fixed.includes('�')) s = fixed;
    } catch {}
    return s.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\s*\(\d+\)/g, '')
      .replace(/[/\s]+/g, '_')
      .replace(/_+$/, '');
  };

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
    'tipo_film':'tipo_film', 'funcion_lensun':'funcion_lensun',
    'estado_equipo':'estado_equipo', 'tipo_gps':'tipo_gps',
    'tipo_de_prodcuto':'tipo_de_producto', 'tipo_de_juego':'tipo_de_juego',
    'capacidad_liquidos':'capacidad_liquidos',
    'estruct':'estructura', 'tipo_bumper':'tipo_bumper', 'tipo_fijacion':'tipo_fijacion',
    'material':'material', 'kit_incluye':'kit_incluye', 'tipo_punta':'tipo_punta',
    'tipo_formato':'tipo_formato', 'formato_auricular':'formato_auricular',
    'formato_tamano':'formato_tamano', 'cant_puertos':'cantidad_puertos',
    'tipo_dispositivo_interactivo':'tipo_dispositivo_interactivo',
    'tipo_mouse':'tipo_mouse', 'formato_teclado':'formato_teclado',
    'distribucion_teclado':'distribucion_teclado', 'resolucion':'resolucion',
    'tipo_controlador':'tipo_controlador', 'tipo_consola':'tipo_consola',
    'generacion_consola':'generacion_consola', 'tipo_plataforma':'tipo_plataforma',
    'tipo_de_cargador':'tipo_de_cargador', 'tipo_de_fuente':'tipo_de_fuente',
    'linea_lensun':'linea_lensun', 'tipo_equipo':'tipo_equipo',
    'dispositivo_streaming':'dispositivo_streaming',
    'visuales':'visual', 'tipo_brillo_acabado':'tipo_brillo_acabado',
    'acabado_lensun':'acabado_lensun', 'tipo_borde':'tipo_borde',
    'tipo_diseno':'tipo_diseno',
    'interfaz_entrada_input':'tipo_interfaz', 'tipo_alimentacion':'tipo_alimentacion',
    'cantidad_microfonos':'cantidad_microfonos', 'temperatura_color':'temperatura_color',
    'plug_and_play':'plug_and_play', 'generacion':'generacion',
    'formato_tarjeta':'formato_tarjeta', 'clase_veloc_msd':'clase_veloc_msd',
    'tecnologia_wireless':'tecnologia_wireless', 'estandar_wifi':'estandar_wifi',
    'banda':'banda', 'categoria_de_red':'categoria_de_red',
    'tipo_senal_audio':'tipo_senal_audio', 'estandar_hdmi':'estandar_hdmi',
    'conexion_video':'conexion_video', 'potencia':'potencia_w',
    'volt_max':'voltaje_max_v', 'tipo_de_pilas_compat':'tipo_pilas',
    'almacenamiento_gb':'almacenamiento_gb', 'memoria_ram':'memoria_ram_gb',
    'tipo_ram':'tipo_ram', 'formato_ram':'formato_ram',
    'frecuencia':'frecuencia_mhz', 'tipo_bateria':'tipo_bateria',
    'capacidad_bateria':'capacidad_bateria_mah',
  };

  // 1. Parsear CSV
  const lines = csvText.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const rows  = lines.map(l => l.split(','));

  let hdrIdx = -1;
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    if (rows[i].some(c => c.includes('Codigo')) && rows[i].some(c => c.includes('Viejo'))) {
      hdrIdx = i; break;
    }
  }
  if (hdrIdx < 0) throw new Error('No se encontró la fila de encabezados (Codigo Viejo)');

  const headers  = rows[hdrIdx].map(h => h.trim());
  const dataRows = rows.slice(hdrIdx + 1);
  console.log(`Headers encontrados en fila ${hdrIdx + 1}, ${headers.length} columnas, ${dataRows.length} filas de datos`);

  // Debug: mostrar qué columnas de atributos se mapearon
  const atrCols = [];
  for (let i = 0; i < headers.length; i++) {
    const norm = normH(headers[i]);
    const atrNom = COL_ATR[norm];
    if (atrNom) atrCols.push({ colIdx: i, atrNombre: atrNom, headerRaw: headers[i] });
  }
  console.log(`Columnas de atributos mapeadas: ${atrCols.length}`);
  if (atrCols.length > 0) console.log('  ' + atrCols.map(c => `${c.headerRaw}→${c.atrNombre}`).join(', '));

  const ci = name => headers.findIndex(h => h === name);
  const IDX = {
    sku:    ci('Codigo Viejo') >= 0 ? ci('Codigo Viejo') : 1,
    base:   ci('C_Nuevo_BASE') >= 0 ? ci('C_Nuevo_BASE') : 2,
    color:  ci('Color') >= 0 ? ci('Color') : 4,
    model:  ci('Modelos') >= 0 ? ci('Modelos') : 5,
    marca:  ci('marca') >= 0 ? ci('marca') : 6,
    compat: ci('Compat_otro') >= 0 ? ci('Compat_otro') : 13,
  };
  console.log('Índices clave:', IDX);

  // 2. Cargar tablas de referencia
  const norm = s => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
  const [catRes, sgRes, colorRes, atrRes, valRes, modelRes] = await Promise.all([
    pool.query(`SELECT cj.id, cj.nombre, sg.nombre AS sg_nombre
                FROM categorias_jerarquia cj
                JOIN subgrupos sg ON sg.id = cj.subgrupo_id
                WHERE sg.grupo_id = 6 AND cj.activo`),
    pool.query(`SELECT id, nombre FROM subgrupos WHERE grupo_id = 6 AND activo`),
    pool.query(`SELECT id, nombre FROM colores WHERE activo`),
    pool.query(`SELECT id, nombre, tipo FROM atributos WHERE activo`),
    pool.query(`SELECT id, atributo_id, codigo FROM valores_atributo`),
    pool.query(`SELECT m.id, m.nombre FROM modelos_dispositivo m
                JOIN marcas_dispositivo md ON md.id = m.marca_id
                WHERE md.nombre ILIKE 'apple'`),
  ]);

  console.log(`DB: ${catRes.rows.length} categorías, ${sgRes.rows.length} subgrupos, ${colorRes.rows.length} colores, ${atrRes.rows.length} atributos, ${valRes.rows.length} valores, ${modelRes.rows.length} modelos Apple`);

  const colorMap    = new Map(colorRes.rows.map(r => [r.id, r.nombre]));
  const atrByNombre = new Map(atrRes.rows.map(r => [r.nombre, r]));

  const valMap = {};
  for (const v of valRes.rows) {
    if (!valMap[v.atributo_id]) valMap[v.atributo_id] = {};
    valMap[v.atributo_id][v.codigo] = v.id;
  }

  const modelMap = new Map(modelRes.rows.map(r => [r.nombre.toLowerCase(), r.id]));

  const resolveModelo = abbr => {
    const full = IP[abbr] || IP[abbr.toUpperCase()];
    if (!full) return null;
    return modelMap.get(full.toLowerCase()) || null;
  };

  const resolveModelSet = str => {
    const ids = new Set();
    if (!str || str === '0') return ids;
    for (const part of str.split('|').map(p => p.trim()).filter(Boolean)) {
      const id = resolveModelo(part);
      if (id) ids.add(id);
    }
    return ids;
  };

  // 3. Agrupar filas por (sku, base, color)
  const groups = new Map();
  for (const row of dataRows) {
    const sku   = (row[IDX.sku]   || '').trim();
    const base  = (row[IDX.base]  || '').trim();
    const color = (row[IDX.color] || '').trim();
    if (!sku || sku === '0' || !base || base === '0') continue;
    const key = `${sku}:${base}:${color}`;
    if (!groups.has(key)) groups.set(key, { row, modeloIds: new Set() });
    const g = groups.get(key);
    for (const id of resolveModelSet((row[IDX.model]  || '').trim())) g.modeloIds.add(id);
    for (const id of resolveModelSet((row[IDX.compat] || '').trim())) g.modeloIds.add(id);
  }
  console.log(`Grupos únicos (productos a crear): ${groups.size}`);

  // 4. Crear un producto por grupo
  const creados = [], errores = [];
  let i = 0;
  for (const [key, { row, modeloIds }] of groups) {
    i++;
    const [sku, base, colorId] = key.split(':');
    try {
      const catNombre = BASE_CAT[base];
      const cat = catNombre
        ? catRes.rows.find(c => norm(c.nombre) === norm(catNombre))
        : null;
      const sg = cat
        ? sgRes.rows.find(s => norm(s.nombre) === norm(cat.sg_nombre || 'Celulares'))
        : sgRes.rows.find(s => norm(s.nombre) === 'celulares');

      const colorNombre = colorMap.get(Number(colorId)) || `Color ${colorId}`;
      const tipo        = BASE_LABEL[base] || 'Funda';

      const modelNames = [...modeloIds].slice(0, 3).map(id => {
        const found = modelRes.rows.find(r => r.id === id);
        return found ? found.nombre.replace('iPhone ', '') : '';
      }).filter(Boolean);
      const modelLabel = modelNames.length ? modelNames.join('/') : 'Universal';

      const nombre  = `Funda ${tipo} iPhone ${modelLabel} – ${colorNombre}`;
      const artSku  = `${base}-${sku}-C${colorId}`;
      const marcaRaw = (row[IDX.marca] || '').trim();
      const marca_prod_id = (marcaRaw && marcaRaw !== '0') ? Number(marcaRaw) : null;

      const atributos = [];
      for (const { colIdx, atrNombre } of atrCols) {
        const rawVal = (row[colIdx] || '').trim();
        if (!rawVal || rawVal === '0') continue;
        const atr = atrByNombre.get(atrNombre);
        if (!atr) continue;
        if (atr.tipo === 'number') {
          const n = Number(rawVal);
          if (n) atributos.push({ atributo_id: atr.id, valor_num: n });
        } else {
          const parts = rawVal.split('|').map(p => p.trim()).filter(Boolean);
          const atrVals = valMap[atr.id] || {};
          for (const p of parts) {
            const valor_id = atrVals[p.padStart(3,'0')] || atrVals[p.padStart(2,'0')] || atrVals[p];
            if (valor_id) {
              atributos.push({ atributo_id: atr.id, valor_id, valor_texto: parts.length > 1 ? rawVal : null });
              break;
            }
          }
        }
      }

      const art = await crearArticulo({
        nombre, sku: artSku,
        grupo_id: 6,
        subgrupo_id: sg?.id || null,
        categoria_jer_id: cat?.id || null,
        marca_prod_id,
      });

      if (atributos.length) await setArticuloAtributos(art.id, atributos);
      if (modeloIds.size)   await setArticuloModelos(art.id, [...modeloIds]);

      creados.push({ id: art.id, sku: artSku, nombre });
      if (i % 50 === 0) console.log(`  [${i}/${groups.size}] Último creado: ${nombre}`);
    } catch (e) {
      errores.push({ clave: key, error: e.message });
      if (errores.length <= 5) console.error(`  ERROR ${key}: ${e.message}`);
    }
  }

  return { creados: creados.length, errores: errores.length, errores_detalle: errores.slice(0, 10), primeros: creados.slice(0, 5) };
}

// ─── Main ────────────────────────────────────────────────────────────────────

const csvPath = process.argv[2];
if (!csvPath) { console.error('Uso: node scripts/importar-vinculaciones.mjs <archivo.csv>'); process.exit(1); }

const csvText = await readFile(resolve(csvPath), 'utf8');
console.log(`CSV leído: ${csvText.length} chars`);

const result = await importarVinculaciones(csvText);
console.log('\n=== RESULTADO ===');
console.log(`Creados: ${result.creados}`);
console.log(`Errores: ${result.errores}`);
if (result.primeros.length) {
  console.log('\nPrimeros creados:');
  for (const p of result.primeros) console.log(`  [${p.id}] ${p.sku} — ${p.nombre}`);
}
if (result.errores_detalle.length) {
  console.log('\nErrores:');
  for (const e of result.errores_detalle) console.log(`  ${e.clave}: ${e.error}`);
}

await pool.end();
