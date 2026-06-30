// Seed de tablas de clasificación: grupos, atributos, colores, marcas, modelos.
// Idempotente — usa INSERT ... ON CONFLICT DO NOTHING.
// Requiere DATABASE_URL en el entorno.
// Uso: node scripts/seed-parametros.mjs

import pg from "pg";
import { initDb } from "../app/db.mjs";
const { Pool } = pg;

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: (process.env.DATABASE_URL || "").includes("localhost") ? false : { rejectUnauthorized: false },
});

// Crear tablas si no existen
await initDb();
console.log("✓ Schema listo");

async function ins(table, cols, rows) {
  if (!rows.length) return;
  const ph = rows.map((_, i) => `(${cols.map((_, j) => `$${i * cols.length + j + 1}`).join(",")})`).join(",");
  const vals = rows.flatMap(r => cols.map(c => r[c] ?? null));
  await db.query(
    `INSERT INTO ${table} (${cols.join(",")}) VALUES ${ph} ON CONFLICT DO NOTHING`,
    vals
  );
}

// ─── 1. GRUPOS (13) ──────────────────────────────────────────────────────────
await ins("grupos", ["id", "letra", "nombre"], [
  { id: 1,  letra: "R", nombre: "Repuestos" },
  { id: 2,  letra: "S", nombre: "Servicios" },
  { id: 3,  letra: "A", nombre: "Adaptadores" },
  { id: 4,  letra: "A", nombre: "Almacenamiento" },
  { id: 5,  letra: "A", nombre: "Audio" },
  { id: 6,  letra: "A", nombre: "Fundas" },
  { id: 7,  letra: "A", nombre: "Accesorios" },
  { id: 8,  letra: "A", nombre: "Informatica" },
  { id: 9,  letra: "A", nombre: "Unidad_Energia" },
  { id: 10, letra: "A", nombre: "Vidrios_Templados" },
  { id: 11, letra: "A", nombre: "Equipos" },
  { id: 12, letra: "A", nombre: "GAMER" },
  { id: 13, letra: "A", nombre: "Novedades" },
]);

// ─── 2. SUBGRUPOS ────────────────────────────────────────────────────────────
await ins("subgrupos", ["grupo_id", "numero", "nombre"], [
  // Repuestos
  { grupo_id: 1, numero: 1, nombre: "Partes" },
  { grupo_id: 1, numero: 2, nombre: "Pantalla" },
  { grupo_id: 1, numero: 3, nombre: "Boton" },
  { grupo_id: 1, numero: 4, nombre: "Camara" },
  { grupo_id: 1, numero: 5, nombre: "Flex" },
  { grupo_id: 1, numero: 6, nombre: "IC" },
  { grupo_id: 1, numero: 7, nombre: "Conector" },
  { grupo_id: 1, numero: 8, nombre: "Audio" },
  { grupo_id: 1, numero: 9, nombre: "Carga" },
  { grupo_id: 1, numero: 10, nombre: "Cosmetico" },
  { grupo_id: 1, numero: 11, nombre: "Placa" },
  // Servicios
  { grupo_id: 2, numero: 1, nombre: "Backup" },
  { grupo_id: 2, numero: 3, nombre: "Cuenta_de_Google" },
  { grupo_id: 2, numero: 4, nombre: "Instalacion_de_Soft" },
  { grupo_id: 2, numero: 5, nombre: "Full_Box" },
  { grupo_id: 2, numero: 6, nombre: "Unlock_Box" },
  { grupo_id: 2, numero: 7, nombre: "Downgrade_Android" },
  { grupo_id: 2, numero: 8, nombre: "Downgrade" },
  { grupo_id: 2, numero: 9, nombre: "Hard_Reset" },
  { grupo_id: 2, numero: 10, nombre: "Secado" },
  // Adaptadores
  { grupo_id: 3, numero: 1, nombre: "OTG" },
  { grupo_id: 3, numero: 2, nombre: "Splitter" },
  { grupo_id: 3, numero: 3, nombre: "Enchufe" },
  { grupo_id: 3, numero: 4, nombre: "Multifuncion" },
  // Almacenamiento
  { grupo_id: 4, numero: 1, nombre: "Tarjeta_de_almacenamiento" },
  { grupo_id: 4, numero: 2, nombre: "Pendrive" },
  { grupo_id: 4, numero: 3, nombre: "Disco_Externo" },
  { grupo_id: 4, numero: 4, nombre: "Lectores" },
  { grupo_id: 4, numero: 5, nombre: "Memorias_RAM" },
  // Audio
  { grupo_id: 5, numero: 1, nombre: "Auricular" },
  { grupo_id: 5, numero: 2, nombre: "Parlante" },
  { grupo_id: 5, numero: 3, nombre: "Microfonos" },
  { grupo_id: 5, numero: 4, nombre: "Interactivo_Karaoke" },
  { grupo_id: 5, numero: 5, nombre: "Reproductores_para_vehiculo" },
  // Fundas
  { grupo_id: 6, numero: 1, nombre: "Celulares" },
  { grupo_id: 6, numero: 2, nombre: "Tablet" },
  { grupo_id: 6, numero: 3, nombre: "Notebook_Netbook" },
  { grupo_id: 6, numero: 4, nombre: "Auriculares" },
  { grupo_id: 6, numero: 5, nombre: "GPS" },
  { grupo_id: 6, numero: 6, nombre: "Parlantes_y_Camaras" },
  // Accesorios
  { grupo_id: 7, numero: 1, nombre: "Soporte" },
  { grupo_id: 7, numero: 2, nombre: "Holder" },
  { grupo_id: 7, numero: 3, nombre: "Mallas" },
  { grupo_id: 7, numero: 4, nombre: "Base" },
  { grupo_id: 7, numero: 5, nombre: "Lapiz_Optico" },
  { grupo_id: 7, numero: 6, nombre: "Content_Creator" },
  // Informática
  { grupo_id: 8, numero: 1, nombre: "Conectividad" },
  { grupo_id: 8, numero: 2, nombre: "Perifericos_PC" },
  { grupo_id: 8, numero: 3, nombre: "Estabilizadores" },
  // Unidad Energía
  { grupo_id: 9, numero: 1, nombre: "Baterias_y_Pilas" },
  { grupo_id: 9, numero: 2, nombre: "Cargadores" },
  { grupo_id: 9, numero: 3, nombre: "Fuentes" },
  // Vidrios Templados
  { grupo_id: 10, numero: 1, nombre: "Clasico_Comun" },
  { grupo_id: 10, numero: 2, nombre: "Ceramico" },
  { grupo_id: 10, numero: 3, nombre: "Lamina_LENSUN" },
  // Equipos
  { grupo_id: 11, numero: 1, nombre: "Smartphones" },
  { grupo_id: 11, numero: 2, nombre: "Tablets" },
  { grupo_id: 11, numero: 3, nombre: "Smartwatchs" },
  { grupo_id: 11, numero: 4, nombre: "GPS" },
  { grupo_id: 11, numero: 5, nombre: "Celulares_basicos" },
  { grupo_id: 11, numero: 6, nombre: "Relojes_digitales" },
  // Gamer
  { grupo_id: 12, numero: 1, nombre: "Teclado" },
  { grupo_id: 12, numero: 2, nombre: "Mouse" },
  { grupo_id: 12, numero: 3, nombre: "Joystick_y_Controles" },
  { grupo_id: 12, numero: 4, nombre: "Consolas" },
  { grupo_id: 12, numero: 5, nombre: "Mousepad" },
  { grupo_id: 12, numero: 6, nombre: "Headsets" },
  // Novedades
  { grupo_id: 13, numero: 1, nombre: "Iluminacion" },
  { grupo_id: 13, numero: 2, nombre: "Jugueteria" },
  { grupo_id: 13, numero: 3, nombre: "Bazar_LifeStyle" },
  { grupo_id: 13, numero: 4, nombre: "Tecnologias" },
  { grupo_id: 13, numero: 5, nombre: "Articulos_de_temporada" },
]);

// ─── 3. GRUPOS DE PARÁMETROS (5) ─────────────────────────────────────────────
await ins("grupos_param", ["id", "codigo", "nombre"], [
  { id: 1, codigo: "01", nombre: "Funcionales" },
  { id: 2, codigo: "02", nombre: "Estructurales" },
  { id: 3, codigo: "03", nombre: "Visuales" },
  { id: 4, codigo: "04", nombre: "Tecnicos" },
  { id: 5, codigo: "05", nombre: "Transversales" },
]);

// ─── 4. ATRIBUTOS ────────────────────────────────────────────────────────────
// tipo: 'enum' | 'number' | 'text'
const atributosData = [
  // Funcionales (01)
  { g: 1, nombre: "funcion",                  tipo: "enum" },
  { g: 1, nombre: "mecanismo_agarre",         tipo: "enum" },
  { g: 1, nombre: "tipo_uso",                 tipo: "enum" },
  { g: 1, nombre: "tipo_fuente_luz",          tipo: "enum" },
  { g: 1, nombre: "tipo_microfono",           tipo: "enum" },
  { g: 1, nombre: "tipo_conexion",            tipo: "enum" },
  { g: 1, nombre: "sistema_encastre",         tipo: "enum" },
  { g: 1, nombre: "tipo_lapiz",               tipo: "enum" },
  { g: 1, nombre: "sistema_ajuste_malla",     tipo: "enum" },
  { g: 1, nombre: "tipo_de_base",             tipo: "enum" },
  { g: 1, nombre: "c_almacenamiento",         tipo: "enum" },
  { g: 1, nombre: "cancelacion_sonido",       tipo: "enum" },
  { g: 1, nombre: "microfono",                tipo: "enum" },
  { g: 1, nombre: "sonido",                   tipo: "enum" },
  { g: 1, nombre: "plataforma_compatible",    tipo: "enum" },
  { g: 1, nombre: "entrada_mic",              tipo: "enum" },
  { g: 1, nombre: "funcion_senal",            tipo: "enum" },
  { g: 1, nombre: "cantidad_de_botones",      tipo: "enum" },
  { g: 1, nombre: "tipo_de_cable",            tipo: "enum" },
  { g: 1, nombre: "tipo_carga",               tipo: "enum" },
  { g: 1, nombre: "covertura_film",           tipo: "enum" },
  { g: 1, nombre: "tipo_film",                tipo: "enum" },
  { g: 1, nombre: "funcion_lensun",           tipo: "enum" },
  { g: 1, nombre: "estado_equipo",            tipo: "enum" },
  { g: 1, nombre: "tipo_gps",                 tipo: "enum" },
  { g: 1, nombre: "tipo_de_producto",         tipo: "enum" },
  { g: 1, nombre: "tipo_de_juego",            tipo: "enum" },
  { g: 1, nombre: "capacidad_liquidos",       tipo: "number" },
  { g: 1, nombre: "vibracion",                tipo: "enum" },
  // Estructurales (02)
  { g: 2, nombre: "estructura",               tipo: "enum" },
  { g: 2, nombre: "tipo_bumper",              tipo: "enum" },
  { g: 2, nombre: "tipo_fijacion",            tipo: "enum" },
  { g: 2, nombre: "material",                 tipo: "enum" },
  { g: 2, nombre: "kit_incluye",              tipo: "enum" },
  { g: 2, nombre: "tipo_punta",               tipo: "enum" },
  { g: 2, nombre: "tipo_formato",             tipo: "enum" },
  { g: 2, nombre: "formato_auricular",        tipo: "enum" },
  { g: 2, nombre: "formato_tamano",           tipo: "enum" },
  { g: 2, nombre: "cantidad_puertos",         tipo: "number" },
  { g: 2, nombre: "tipo_dispositivo_interactivo", tipo: "enum" },
  { g: 2, nombre: "tipo_mouse",               tipo: "enum" },
  { g: 2, nombre: "formato_teclado",          tipo: "enum" },
  { g: 2, nombre: "distribucion_teclado",     tipo: "enum" },
  { g: 2, nombre: "resolucion",               tipo: "enum" },
  { g: 2, nombre: "tipo_controlador",         tipo: "enum" },
  { g: 2, nombre: "tipo_consola",             tipo: "enum" },
  { g: 2, nombre: "generacion_consola",       tipo: "enum" },
  { g: 2, nombre: "tipo_plataforma",          tipo: "enum" },
  { g: 2, nombre: "tipo_de_cargador",         tipo: "enum" },
  { g: 2, nombre: "tipo_de_fuente",           tipo: "enum" },
  { g: 2, nombre: "linea_lensun",             tipo: "enum" },
  { g: 2, nombre: "tipo_equipo",              tipo: "enum" },
  { g: 2, nombre: "dispositivo_streaming",    tipo: "enum" },
  // Visuales (03)
  { g: 3, nombre: "visual",                   tipo: "enum" },
  { g: 3, nombre: "tipo_brillo_acabado",      tipo: "enum" },
  { g: 3, nombre: "acabado_lensun",           tipo: "enum" },
  { g: 3, nombre: "tipo_borde",               tipo: "enum" },
  { g: 3, nombre: "tipo_diseno",              tipo: "enum" },
  // Técnicos (04)
  { g: 4, nombre: "tipo_interfaz",            tipo: "enum" },
  { g: 4, nombre: "genero",                   tipo: "enum" },
  { g: 4, nombre: "tipo_alimentacion",        tipo: "enum" },
  { g: 4, nombre: "cantidad_microfonos",      tipo: "enum" },
  { g: 4, nombre: "temperatura_color",        tipo: "enum" },
  { g: 4, nombre: "plug_and_play",            tipo: "enum" },
  { g: 4, nombre: "generacion_bt",            tipo: "enum" },
  { g: 4, nombre: "formato_tarjeta",          tipo: "enum" },
  { g: 4, nombre: "clase_veloc_msd",          tipo: "enum" },
  { g: 4, nombre: "tecnologia_wireless",      tipo: "enum" },
  { g: 4, nombre: "estandar_wifi",            tipo: "enum" },
  { g: 4, nombre: "banda",                    tipo: "enum" },
  { g: 4, nombre: "categoria_de_red",         tipo: "enum" },
  { g: 4, nombre: "tipo_senal_audio",         tipo: "enum" },
  { g: 4, nombre: "estandar_hdmi",            tipo: "enum" },
  { g: 4, nombre: "conexion_video",           tipo: "enum" },
  { g: 4, nombre: "potencia_w",               tipo: "number" },
  { g: 4, nombre: "voltaje_max_v",            tipo: "number" },
  { g: 4, nombre: "tipo_pilas",               tipo: "enum" },
  { g: 4, nombre: "almacenamiento_gb",        tipo: "number" },
  { g: 4, nombre: "memoria_ram_gb",           tipo: "number" },
  { g: 4, nombre: "tipo_ram",                 tipo: "enum" },
  { g: 4, nombre: "formato_ram",              tipo: "enum" },
  { g: 4, nombre: "frecuencia_mhz",           tipo: "number" },
  { g: 4, nombre: "tipo_bateria",             tipo: "enum" },
  { g: 4, nombre: "capacidad_bateria_mah",    tipo: "number" },
  // Transversales (05)
  { g: 5, nombre: "compat_dispositivo",       tipo: "enum" },
  { g: 5, nombre: "compat_so",                tipo: "enum" },
  { g: 5, nombre: "generacion",               tipo: "number" },
  { g: 5, nombre: "temporada",                tipo: "enum" },
];

// Necesitamos los IDs de los atributos para insertar valores — primero los insertamos
// y luego leemos los IDs
for (const a of atributosData) {
  await db.query(
    `INSERT INTO atributos (grupo_param_id, nombre, tipo) VALUES ($1,$2,$3) ON CONFLICT (nombre) DO NOTHING`,
    [a.g, a.nombre, a.tipo]
  );
}

// Función helper: get id de atributo por nombre
const atrId = {};
const { rows: atrRows } = await db.query(`SELECT id, nombre FROM atributos`);
for (const r of atrRows) atrId[r.nombre] = r.id;

// ─── 5. VALORES DE ATRIBUTOS ──────────────────────────────────────────────────
const valoresData = [
  // funcion
  ...["Reforzado","Antishock","360°","Waterproof","MagSafe","Deportivo","Sumergible","Sobre","Porta","Plegable","Estuche","Giratoria","Origami","Ergonomico","localizador","fan","Party","Termometro","Electrodomesticos","Tarjetero","Repuestos","Auxiliar_Extensor","case","charging_stand","Llaveros","reforzado_Premium"]
    .map((v,i) => ({ a: "funcion", c: String(i+1).padStart(2,"0"), v })),

  // mecanismo_agarre
  ...["Ring_Anillo","Strap","Popsocket","Ventosa_Sopapa","Grip","kickstand","correa"]
    .map((v,i) => ({ a: "mecanismo_agarre", c: String(i+1).padStart(2,"0"), v })),

  // tipo_uso
  ...["Escritorio","De_pie","Auto_Espejo","Auto_Ventilacion","Auto_torpedo","Moto","Bici","Brazalete","Pared","cuello","bandolera","Hogar","infantil","outdoor"]
    .map((v,i) => ({ a: "tipo_uso", c: String(i+1).padStart(2,"0"), v })),

  // tipo_fuente_luz
  ...["Aro_LED","Panel_LED","Clip_LED","Foco_LED","Tira_LED","Guirnalda","Lampara_Velador","Luz_decorativa"]
    .map((v,i) => ({ a: "tipo_fuente_luz", c: String(i+1).padStart(2,"0"), v })),

  // tipo_microfono
  ...["corbatero_lavalier","direccional","omnidireccional","de_mano","boom","integrado","Dinamico"]
    .map((v,i) => ({ a: "tipo_microfono", c: String(i+1).padStart(2,"0"), v })),

  // tipo_conexion
  ...["inalambrico","con_cable","hibrido","plug_in","FM"]
    .map((v,i) => ({ a: "tipo_conexion", c: String(i+1).padStart(2,"0"), v })),

  // sistema_encastre
  ...["perno_clasico","quick_release","bumper_integrado","conector_prop"]
    .map((v,i) => ({ a: "sistema_encastre", c: String(i+1).padStart(2,"0"), v })),

  // tipo_lapiz
  ...["capacitivo","activo","doble_punta","con_boton","con_punta"]
    .map((v,i) => ({ a: "tipo_lapiz", c: String(i+1).padStart(2,"0"), v })),

  // sistema_ajuste_malla
  ...["hebilla_clasica","alpine_loop","desplegable","magnetico","velcro","boton_clip"]
    .map((v,i) => ({ a: "sistema_ajuste_malla", c: String(i+1).padStart(2,"0"), v })),

  // tipo_de_base
  ...["fija","ajustable","cooler"]
    .map((v,i) => ({ a: "tipo_de_base", c: String(i+1).padStart(2,"0"), v })),

  // c_almacenamiento
  ...["16GB","32GB","64GB","128GB","256GB","1TB","2TB"]
    .map((v,i) => ({ a: "c_almacenamiento", c: String(i+1).padStart(2,"0"), v })),

  // cancelacion_sonido
  { a: "cancelacion_sonido", c: "01", v: "Activa_ANC" },
  { a: "cancelacion_sonido", c: "02", v: "Pasiva" },
  { a: "cancelacion_sonido", c: "03", v: "Sin" },

  // microfono
  { a: "microfono", c: "01", v: "Si" },
  { a: "microfono", c: "02", v: "No" },

  // sonido
  { a: "sonido", c: "01", v: "Estereo" },
  { a: "sonido", c: "02", v: "7.1_virtual" },

  // plataforma_compatible
  ...["PC","Consola","multiplataforma","PlayStation","Xbox","Nintendo","PC_Consola","TV"]
    .map((v,i) => ({ a: "plataforma_compatible", c: String(i+1).padStart(2,"0"), v })),

  // entrada_mic
  { a: "entrada_mic", c: "01", v: "Si" },
  { a: "entrada_mic", c: "02", v: "No" },

  // funcion_senal
  { a: "funcion_senal", c: "01", v: "WiFi" },
  { a: "funcion_senal", c: "02", v: "WiFi_Ethernet" },
  { a: "funcion_senal", c: "03", v: "Ethernet" },

  // cantidad_de_botones
  { a: "cantidad_de_botones", c: "01", v: "estandar" },
  { a: "cantidad_de_botones", c: "02", v: "avanzado_tecnico" },

  // tipo_de_cable
  { a: "tipo_de_cable", c: "01", v: "carga" },
  { a: "tipo_de_cable", c: "02", v: "carga_y_datos" },

  // tipo_carga
  { a: "tipo_carga", c: "01", v: "Lenta" },
  { a: "tipo_carga", c: "02", v: "Normal" },
  { a: "tipo_carga", c: "03", v: "Rapida" },

  // covertura_film
  { a: "covertura_film", c: "01", v: "estandar" },
  { a: "covertura_film", c: "02", v: "full_cover_9D_6D_5D" },
  { a: "covertura_film", c: "03", v: "film_blindado_camara" },
  { a: "covertura_film", c: "04", v: "film_blindado_lentes_individuales" },

  // tipo_film
  ...["comun","Anti_espia","Mate","siliconado","Flexible","back_skin"]
    .map((v,i) => ({ a: "tipo_film", c: String(i+1).padStart(2,"0"), v })),

  // funcion_lensun
  { a: "funcion_lensun", c: "01", v: "estandar" },
  { a: "funcion_lensun", c: "02", v: "Anti_reflejo" },
  { a: "funcion_lensun", c: "03", v: "anti_espia_privacy" },
  { a: "funcion_lensun", c: "04", v: "back_skin" },

  // estado_equipo
  { a: "estado_equipo", c: "01", v: "Nuevo" },
  { a: "estado_equipo", c: "02", v: "Usado" },
  { a: "estado_equipo", c: "03", v: "reacondicionado" },

  // tipo_gps
  { a: "tipo_gps", c: "01", v: "vehicular" },
  { a: "tipo_gps", c: "02", v: "outdoor" },

  // tipo_de_producto
  { a: "tipo_de_producto", c: "01", v: "decorativo" },
  { a: "tipo_de_producto", c: "02", v: "funcional" },
  { a: "tipo_de_producto", c: "03", v: "deco_y_funcion" },

  // tipo_de_juego
  { a: "tipo_de_juego", c: "01", v: "electronico" },
  { a: "tipo_de_juego", c: "02", v: "manual" },
  { a: "tipo_de_juego", c: "03", v: "interactivo" },

  // vibracion
  { a: "vibracion", c: "01", v: "Si" },
  { a: "vibracion", c: "02", v: "No" },

  // estructura
  ...["S/cubre_camara","C/cubre_camara","C/anillo","C/apliques","C/Bumper","Puffer","C/porta","Texturado","c/felpa","c/strap","c/spider","c/popsocket","c/soporte_stent","cromado_metalico","c/bolsillo","c/teclado","Brazos","Cierre","Manija_Asa","velcro","mosqueton_gancho","pasa_cinto","Tripode","porta_labial","c/espejo","cuentas","orejitas","pop_it","RGB_luces","c/ventosa","c/munequera_3D","imantado_magnetico","RETRACTIL","llavero","display","carrito","brazo_flexible","ultra_slim","borde_soft_edges","correa_desmontable"]
    .map((v,i) => ({ a: "estructura", c: String(i+1).padStart(2,"0"), v })),

  // tipo_bumper
  { a: "tipo_bumper", c: "01", v: "Metalico" },
  { a: "tipo_bumper", c: "02", v: "Plastico" },

  // tipo_fijacion
  ...["Adhesivo","Ventosa_vacuum","Tornillo_Abrazadera","Magnetico","Clip_Presion","pestana_tarjeta","cabo_lazo","SNAP"]
    .map((v,i) => ({ a: "tipo_fijacion", c: String(i+1).padStart(2,"0"), v })),

  // material
  ...["plastico","metalico","plastico_metal","neoprene","goma_eva","nylon_textil","silicona_deportiva","cuero_sintetico","cuero_natural","acero_inox","peluche","mallado","EVA"]
    .map((v,i) => ({ a: "material", c: String(i+1).padStart(2,"0"), v })),

  // kit_incluye
  ...["tripode","holder","aro","panel_flash","microfono","stick","control_remoto","mousepad","mouse","controlador","pilas","cable_tipoC","cable_microUSB","cable_Lightning","fuente_auto","barrel_jack_universal","lentes_camara"]
    .map((v,i) => ({ a: "kit_incluye", c: String(i+1).padStart(2,"0"), v })),

  // tipo_punta
  ...["goma","disco","punta_fina_act","fibra"]
    .map((v,i) => ({ a: "tipo_punta", c: String(i+1).padStart(2,"0"), v })),

  // tipo_formato
  ...["ficha_directa","cable_corto_pig_tail","cable_largo","multipuerto_HUB","dongle_receptor","placa_de_red"]
    .map((v,i) => ({ a: "tipo_formato", c: String(i+1).padStart(2,"0"), v })),

  // formato_auricular
  ...["clasico_earbuds","in_ear","vincha","neckband"]
    .map((v,i) => ({ a: "formato_auricular", c: String(i+1).padStart(2,"0"), v })),

  // formato_tamano
  ...["mini","mediano","grande","torre","soundbar"]
    .map((v,i) => ({ a: "formato_tamano", c: String(i+1).padStart(2,"0"), v })),

  // tipo_dispositivo_interactivo
  { a: "tipo_dispositivo_interactivo", c: "01", v: "Parlante_karaoke" },
  { a: "tipo_dispositivo_interactivo", c: "02", v: "Microfono_con_parlante_integrado" },
  { a: "tipo_dispositivo_interactivo", c: "03", v: "Sistema_karaoke" },

  // tipo_mouse
  { a: "tipo_mouse", c: "01", v: "optico" },
  { a: "tipo_mouse", c: "02", v: "laser" },

  // formato_teclado
  { a: "formato_teclado", c: "01", v: "completo" },
  { a: "formato_teclado", c: "02", v: "compacto" },

  // distribucion_teclado
  { a: "distribucion_teclado", c: "01", v: "QWERTY_ES" },
  { a: "distribucion_teclado", c: "02", v: "QWERTY_ENG" },
  { a: "distribucion_teclado", c: "03", v: "NUMERICO" },

  // resolucion
  { a: "resolucion", c: "01", v: "HD" },
  { a: "resolucion", c: "02", v: "FULL_HD" },
  { a: "resolucion", c: "03", v: "4K" },

  // tipo_controlador
  { a: "tipo_controlador", c: "01", v: "Joystick_Gamepad" },
  { a: "tipo_controlador", c: "02", v: "Volante" },
  { a: "tipo_controlador", c: "03", v: "Arcade_stick" },

  // tipo_consola
  { a: "tipo_consola", c: "01", v: "clasica_sobremesa" },
  { a: "tipo_consola", c: "02", v: "portatil" },
  { a: "tipo_consola", c: "03", v: "hibrida" },
  { a: "tipo_consola", c: "04", v: "mini_plug_and_play" },

  // generacion_consola
  { a: "generacion_consola", c: "01", v: "actual" },
  { a: "generacion_consola", c: "02", v: "anterior" },
  { a: "generacion_consola", c: "03", v: "retro" },

  // tipo_plataforma
  { a: "tipo_plataforma", c: "01", v: "PlayStation" },
  { a: "tipo_plataforma", c: "02", v: "Xbox" },
  { a: "tipo_plataforma", c: "03", v: "Nintendo" },
  { a: "tipo_plataforma", c: "04", v: "Retro_generica" },

  // tipo_de_cargador
  ...["De_pared","Portatil","Inalambrico","Vehicular","Integrado","fuente"]
    .map((v,i) => ({ a: "tipo_de_cargador", c: String(i+1).padStart(2,"0"), v })),

  // tipo_de_fuente
  { a: "tipo_de_fuente", c: "01", v: "notebook" },
  { a: "tipo_de_fuente", c: "02", v: "universal" },
  { a: "tipo_de_fuente", c: "03", v: "DC" },

  // linea_lensun
  ...["Gold","Silver","Regenerativa_self_healing","Privacy","360","Bronce","Nano","BRUSHED_RED","BRUSHED_BLUE","BRUSHED_GOLD"]
    .map((v,i) => ({ a: "linea_lensun", c: String(i+1).padStart(2,"0"), v })),

  // tipo_equipo
  ...["smartphone","tablet","smartwatch","gps","celular_basico","reloj_digital","camara_digital"]
    .map((v,i) => ({ a: "tipo_equipo", c: String(i+1).padStart(2,"0"), v })),

  // dispositivo_streaming
  { a: "dispositivo_streaming", c: "01", v: "TV_BOX" },
  { a: "dispositivo_streaming", c: "02", v: "TV_STICK" },
  { a: "dispositivo_streaming", c: "03", v: "media_player" },

  // visual
  ...["Liso","Glitter","Transparente","C_borde","Motivo_Diseno_material","brillo_acabado","C_marca_recorte"]
    .map((v,i) => ({ a: "visual", c: String(i+1).padStart(2,"0"), v })),

  // tipo_brillo_acabado
  ...["Tornasolado_Iridiscente_Holografico","Espejado_Mirror","Nacarado_Perlado_Satinado","Mate_Opaco","efecto_diamante_GEM","efecto_airbag","efecto_rayas","efecto_degrade","Esmerilado","efecto_liquid","efecto_3D","gummy","silky","GLOSSY"]
    .map((v,i) => ({ a: "tipo_brillo_acabado", c: String(i+1).padStart(2,"0"), v })),

  // acabado_lensun
  { a: "acabado_lensun", c: "01", v: "Brillante_glossy" },
  { a: "acabado_lensun", c: "02", v: "Mate" },
  { a: "acabado_lensun", c: "03", v: "Silk" },

  // tipo_borde
  { a: "tipo_borde", c: "01", v: "plastico" },
  { a: "tipo_borde", c: "02", v: "metalico" },
  { a: "tipo_borde", c: "03", v: "c_stras" },

  // tipo_diseno (149 valores)
  ...["Floral","Rayas","Estrellas","Geometrico","Animal_print","Marmol","Abstracto","Paisaje","Urbano","Retro","Vintage","Minimalista","Grunge","Neon","Acuarela","Caricatura","Comic","Anime","Manga","Disney","Marvel","Star_Wars","Harry_Potter","Game_of_Thrones","Stranger_Things","Friends","The_Office","Breaking_Bad","Rick_and_Morty","Adventure_Time","Steven_Universe","Gravity_Falls","Among_Us","Minecraft","Fortnite","Pokemon","Zelda","Mario","Sonic","Kirby","Pacman","Tetris","Space_Invaders","Roblox","GTA","Call_of_Duty","FIFA","NBA","NFL","MLB","NHL","Formula_1","MotoGP","Tenis","Futbol","Basketball","Baseball","Volleyball","Hockey","Rugby","Golf","Cricket","Surf","Snowboard","Skateboard","Musica","Rock","Pop","Hip_Hop","Jazz","Clasica","Electronic","Metal","Punk","Reggae","Cumbia","Tango","Folklore","Navidad","Halloween","Carnaval","San_Valentin","Dia_de_Muertos","Pascua","Corazones","Amor","Amistad","Familia","Mascotas","Perros","Gatos","Pajaros","Peces","Reptiles","Insectos","Plantas","Flores","Arboles","Mar","Playa","Montana","Desierto","Bosque","Ciudad","Campo","Espacio","Galaxia","Planetas","Luna","Sol","Arcoiris","Nubes","Lluvia","Nieve","Fuego","Agua","Tierra","Aire","Comida","Bebida","Helado","Pizza","Hamburguesa","Sushi","Tacos","Cafe","Te","Vino","Cerveza","Cocktail","Dulces","Fruta","Verdura","Pan","Pastel","Desayuno","Almuerzo","Cena","Postre","Snack","Abstracto_geometrico","Mandala","Arte_digital","Fotografia","Ilustracion","Acuarela_2","Oil_painting","Pixel_art","Glitch","Cyberpunk","Steampunk","Fantasy","Medieval","Samurai","Vikings","Ancient_Egypt","Ancient_Greece","Japan","China","India","Mexico","Africa","Australia","Custom"]
    .map((v,i) => ({ a: "tipo_diseno", c: String(i+1).padStart(3,"0"), v })),

  // tipo_interfaz
  ...["HDMI","Micro_HDMI","DisplayPort","VGA","USB_A","USB_B","USB_C","microUSB","Lightning","Jack_3_5","Jack_6_3","RJ45_Ethernet","microSD","nanoSD","SD","SD_microSD","SIM","nanoSIM","ad_EUR","ad_USA","ad_UK","ad_AU","ad_SA","U_19_23","microSIM","pin_fino_barrel_jack","miniHDMI","Toslink_S_PDIF","RCA","TRRS","TRS","SATA","Tipo_trebol_C5","Tipo_ocho_C7","Tipo_Mickey_C5","Tipo_C13","Tipo_C19","TCON_EXT","MagSafe","DVI","PS2","PCI"]
    .map((v,i) => ({ a: "tipo_interfaz", c: String(i+1).padStart(2,"0"), v })),

  // genero
  { a: "genero", c: "M", v: "macho" },
  { a: "genero", c: "H", v: "hembra" },

  // tipo_alimentacion
  ...["USB_JACK_CABLE","Bateria_pilas","Enchufe_110_220V","pasiva","12V"]
    .map((v,i) => ({ a: "tipo_alimentacion", c: String(i+1).padStart(2,"0"), v })),

  // cantidad_microfonos
  { a: "cantidad_microfonos", c: "01", v: "Single_uno" },
  { a: "cantidad_microfonos", c: "02", v: "Twin_dos" },
  { a: "cantidad_microfonos", c: "03", v: "mas_de_dos" },

  // temperatura_color
  ...["calida","neutra","fria","regulable","RGB"]
    .map((v,i) => ({ a: "temperatura_color", c: String(i+1).padStart(2,"0"), v })),

  // plug_and_play
  { a: "plug_and_play", c: "01", v: "Si" },

  // generacion_bt (velocidades USB)
  { a: "generacion_bt", c: "01", v: "USB_2.0" },
  { a: "generacion_bt", c: "02", v: "USB_3.0" },
  { a: "generacion_bt", c: "03", v: "USB_3.1" },
  { a: "generacion_bt", c: "04", v: "USB_3.2" },

  // formato_tarjeta
  ...["UHS-I","UHS-II","SDHC","SDXC"]
    .map((v,i) => ({ a: "formato_tarjeta", c: String(i+1).padStart(2,"0"), v })),

  // clase_veloc_msd
  ...["V10","V30","V60","V90","U1","U3","C10","C6","C4"]
    .map((v,i) => ({ a: "clase_veloc_msd", c: String(i+1).padStart(2,"0"), v })),

  // tecnologia_wireless
  { a: "tecnologia_wireless", c: "01", v: "BT" },
  { a: "tecnologia_wireless", c: "02", v: "RF_2_4GHz_Dongle_USB" },
  { a: "tecnologia_wireless", c: "03", v: "WI_FI" },

  // estandar_wifi
  { a: "estandar_wifi", c: "01", v: "Wi-Fi_4_802.11n" },
  { a: "estandar_wifi", c: "02", v: "Wi-Fi_5_802.11ac" },
  { a: "estandar_wifi", c: "03", v: "Wi-Fi_6_802.11ax" },

  // banda
  { a: "banda", c: "01", v: "2.4_GHz" },
  { a: "banda", c: "02", v: "Doble_2.4_5_GHz" },
  { a: "banda", c: "03", v: "1000MBPS" },

  // categoria_de_red
  { a: "categoria_de_red", c: "01", v: "Cat5e" },
  { a: "categoria_de_red", c: "02", v: "Cat6" },
  { a: "categoria_de_red", c: "03", v: "Cat6a" },

  // tipo_senal_audio
  { a: "tipo_senal_audio", c: "01", v: "analogico_jack" },
  { a: "tipo_senal_audio", c: "02", v: "optico" },

  // estandar_hdmi
  { a: "estandar_hdmi", c: "01", v: "HDMI_1.4" },
  { a: "estandar_hdmi", c: "02", v: "HDMI_2.0" },
  { a: "estandar_hdmi", c: "03", v: "HDMI_2.1" },

  // conexion_video
  { a: "conexion_video", c: "01", v: "HDMI" },
  { a: "conexion_video", c: "02", v: "AV" },
  { a: "conexion_video", c: "03", v: "HDMI_AV" },

  // tipo_pilas
  ...["AAA","AA","C","D","9V","CR2016","CR2025","CR2032","LR44","LR23A","bateria_extraible_celular"]
    .map((v,i) => ({ a: "tipo_pilas", c: String(i+1).padStart(2,"0"), v })),

  // tipo_ram
  { a: "tipo_ram", c: "01", v: "DDR3" },
  { a: "tipo_ram", c: "02", v: "DDR4" },
  { a: "tipo_ram", c: "03", v: "DDR5" },

  // formato_ram
  { a: "formato_ram", c: "01", v: "DIMM" },
  { a: "formato_ram", c: "02", v: "SO-DIMM" },

  // tipo_bateria
  { a: "tipo_bateria", c: "01", v: "Li-ION" },
  { a: "tipo_bateria", c: "02", v: "Li-Po" },
  { a: "tipo_bateria", c: "03", v: "Ni-MH" },

  // compat_dispositivo (transversal)
  ...["celular","tablet","notebook","netbook","smartwatch","consola","universal","Camara","Reloj","auriculares_inalambricos","GPS","TV","AUTO","PC","PARLANTE"]
    .map((v,i) => ({ a: "compat_dispositivo", c: String(i+1).padStart(2,"0"), v })),

  // compat_so
  ...["Android","IOS","Android_IOS","HarmonyOS","Windows","propietario"]
    .map((v,i) => ({ a: "compat_so", c: String(i+1).padStart(2,"0"), v })),

  // temporada
  { a: "temporada", c: "01", v: "regalos" },
  { a: "temporada", c: "02", v: "navidad" },
  { a: "temporada", c: "03", v: "eventos" },
];

for (const { a, c, v } of valoresData) {
  if (!atrId[a]) { console.warn(`Atributo no encontrado: ${a}`); continue; }
  await db.query(
    `INSERT INTO valores_atributo (atributo_id, codigo, valor) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
    [atrId[a], c, v]
  );
}

// ─── 6. MARCAS DEL CATÁLOGO (131) ────────────────────────────────────────────
await ins("marcas_prod", ["id", "nombre"], [
  {id:1,nombre:"Apple"},{id:2,nombre:"Bulltec"},{id:3,nombre:"Dinax"},
  {id:4,nombre:"Garmin"},{id:5,nombre:"Generico"},{id:6,nombre:"Genius"},
  {id:7,nombre:"Huawei"},{id:8,nombre:"JBL"},{id:9,nombre:"Kanji"},
  {id:10,nombre:"Kingston"},{id:11,nombre:"Lensun"},{id:12,nombre:"Logitech"},
  {id:13,nombre:"Maxell"},{id:14,nombre:"Maxxa"},{id:15,nombre:"Motorola"},
  {id:16,nombre:"Netmak"},{id:17,nombre:"Noblex"},{id:18,nombre:"NOGA"},
  {id:19,nombre:"Nokia"},{id:20,nombre:"Panasonic"},{id:21,nombre:"RCA"},
  {id:22,nombre:"Samsung"},{id:23,nombre:"SanDisk"},{id:24,nombre:"Smartlife"},
  {id:25,nombre:"Sony"},{id:26,nombre:"Soul"},{id:27,nombre:"Spigen"},
  {id:28,nombre:"Suono"},{id:29,nombre:"Treqa"},{id:30,nombre:"Vention"},
  {id:31,nombre:"Xiaomi"},{id:32,nombre:"YOOKIE"},{id:33,nombre:"TP-LINK"},
  {id:34,nombre:"TIME"},{id:35,nombre:"FOXBOX"},{id:36,nombre:"Cdtek"},
  {id:37,nombre:"KINDLE"},{id:38,nombre:"Griffin"},{id:39,nombre:"BASEUS"},
  {id:40,nombre:"LEGATUS"},{id:41,nombre:"Geeker"},{id:42,nombre:"GADNIC"},
  {id:43,nombre:"Anker"},{id:44,nombre:"Belkin"},{id:45,nombre:"Aukey"},
  {id:46,nombre:"Ugreen"},{id:47,nombre:"Xiaomi_redmi"},{id:48,nombre:"POCO"},
  {id:49,nombre:"OnePlus"},{id:50,nombre:"Realme"},{id:51,nombre:"Oppo"},
  {id:52,nombre:"Vivo"},{id:53,nombre:"ZTE"},{id:54,nombre:"TCL"},
  {id:55,nombre:"Lenovo"},{id:56,nombre:"Asus"},{id:57,nombre:"HTC"},
  {id:58,nombre:"LG"},{id:59,nombre:"Alcatel"},{id:60,nombre:"BlackBerry"},
  {id:61,nombre:"Motorola_Moto"},{id:62,nombre:"iOttie"},{id:63,nombre:"Peak_Design"},
  {id:64,nombre:"Moment"},{id:65,nombre:"Manfrotto"},{id:66,nombre:"Joby"},
  {id:67,nombre:"DJI"},{id:68,nombre:"GoPro"},{id:69,nombre:"Insta360"},
  {id:70,nombre:"Rode"},{id:71,nombre:"Boya"},{id:72,nombre:"Saramonic"},
  {id:73,nombre:"Godox"},{id:74,nombre:"Profoto"},{id:75,nombre:"Nanlite"},
  {id:76,nombre:"Elgato"},{id:77,nombre:"Razer"},{id:78,nombre:"Corsair"},
  {id:79,nombre:"SteelSeries"},{id:80,nombre:"Hyperx"},{id:81,nombre:"Sennheiser"},
  {id:82,nombre:"Audio_Technica"},{id:83,nombre:"AKG"},{id:84,nombre:"Shure"},
  {id:85,nombre:"Bose"},{id:86,nombre:"Marshall"},{id:87,nombre:"Harman_Kardon"},
  {id:88,nombre:"Jabra"},{id:89,nombre:"Plantronics"},{id:90,nombre:"Skullcandy"},
  {id:91,nombre:"Beats"},{id:92,nombre:"Abyss"},{id:93,nombre:"Turtle_Beach"},
  {id:94,nombre:"Astro"},{id:95,nombre:"Koss"},{id:96,nombre:"Grado"},
  {id:97,nombre:"Hifiman"},{id:98,nombre:"Focal"},{id:99,nombre:"Beyerdynamic"},
  {id:100,nombre:"Western_Digital"},{id:101,nombre:"Seagate"},{id:102,nombre:"Toshiba"},
  {id:103,nombre:"Crucial"},{id:104,nombre:"Corsair_RAM"},{id:105,nombre:"G_Skill"},
  {id:106,nombre:"ADATA"},{id:107,nombre:"PNY"},{id:108,nombre:"Verbatim"},
  {id:109,nombre:"Transcend"},{id:110,nombre:"Lexar"},{id:111,nombre:"Patriot"},
  {id:112,nombre:"Team"},{id:113,nombre:"Silicon_Power"},{id:114,nombre:"Sabrent"},
  {id:115,nombre:"Inateck"},{id:116,nombre:"StarTech"},{id:117,nombre:"Cable_Matters"},
  {id:118,nombre:"Anker_PowerPort"},{id:119,nombre:"RAVPower"},{id:120,nombre:"Mophie"},
  {id:121,nombre:"Zagg"},{id:122,nombre:"OtterBox"},{id:123,nombre:"UAG"},
  {id:124,nombre:"LifeProof"},{id:125,nombre:"Casetify"},{id:126,nombre:"dbrand"},
  {id:127,nombre:"Mous"},{id:128,nombre:"Caudabe"},{id:129,nombre:"Torras"},
  {id:130,nombre:"ESR"},{id:131,nombre:"Supcase"},
]);

// ─── 7. COLORES (63) ─────────────────────────────────────────────────────────
await ins("colores", ["id", "nombre"], [
  {id:1,nombre:"Negro"},{id:2,nombre:"Blanco"},{id:3,nombre:"Gris"},
  {id:4,nombre:"Gris_claro"},{id:5,nombre:"Gris_oscuro"},{id:6,nombre:"Plateado"},
  {id:7,nombre:"Dorado"},{id:8,nombre:"Rose_Gold"},{id:9,nombre:"Gris_topo"},
  {id:10,nombre:"Azul"},{id:11,nombre:"Azul_oscuro"},{id:12,nombre:"Celeste"},
  {id:13,nombre:"Verde"},{id:14,nombre:"Verde_claro"},{id:15,nombre:"Verde_oscuro"},
  {id:16,nombre:"Rojo"},{id:17,nombre:"Bordo"},{id:18,nombre:"Rosa"},
  {id:19,nombre:"Fucsia"},{id:20,nombre:"Naranja"},{id:21,nombre:"Amarillo"},
  {id:22,nombre:"Violeta"},{id:23,nombre:"Lavanda"},{id:24,nombre:"Marron"},
  {id:25,nombre:"Beige"},{id:26,nombre:"Rosa_viejo"},{id:27,nombre:"Salmon"},
  {id:28,nombre:"Turquesa"},{id:29,nombre:"Pastel_Rosa"},{id:30,nombre:"Pastel_Verde"},
  {id:31,nombre:"Pastel_Violeta"},{id:32,nombre:"Pastel_Celeste"},{id:33,nombre:"Fluo_Amarillo"},
  {id:34,nombre:"Fluo_Verde"},{id:35,nombre:"Fluo_Rosa"},{id:36,nombre:"Fluo_Naranja"},
  {id:37,nombre:"Pastel_amarillo"},{id:38,nombre:"Granate"},{id:39,nombre:"Rosa_chicle"},
  {id:40,nombre:"Multicolor"},{id:41,nombre:"Azul_electrico"},{id:42,nombre:"Cherry"},
  {id:43,nombre:"Verde_agua"},{id:44,nombre:"Azul_oxford"},{id:45,nombre:"Rosa_barbie"},
  {id:46,nombre:"Rosa_palo"},{id:47,nombre:"Coral"},{id:48,nombre:"Magenta"},
  {id:49,nombre:"Nude"},{id:50,nombre:"Amarillo_ocre"},{id:51,nombre:"Azul_pizarra"},
  {id:52,nombre:"Azul_petroleo"},{id:53,nombre:"Verde_manzana"},{id:54,nombre:"Azul_grafito"},
  {id:55,nombre:"Azul_ice"},{id:56,nombre:"Amarillo_limon"},{id:57,nombre:"Amarillo_girasol"},
  {id:58,nombre:"Sky_blue"},{id:59,nombre:"Verde_arcilla"},{id:60,nombre:"Purpura"},
  {id:61,nombre:"Camel"},{id:62,nombre:"White_gold"},{id:63,nombre:"Vison"},
]);

// ─── 8. MODELOS DE DISPOSITIVOS ───────────────────────────────────────────────
// iPhone — marca Apple
await db.query(`INSERT INTO marcas_dispositivo (nombre) VALUES ('Apple') ON CONFLICT DO NOTHING`);
await db.query(`INSERT INTO marcas_dispositivo (nombre) VALUES ('Xiaomi') ON CONFLICT DO NOTHING`);
await db.query(`INSERT INTO marcas_dispositivo (nombre) VALUES ('Samsung') ON CONFLICT DO NOTHING`);
await db.query(`INSERT INTO marcas_dispositivo (nombre) VALUES ('Motorola') ON CONFLICT DO NOTHING`);
await db.query(`INSERT INTO marcas_dispositivo (nombre) VALUES ('Huawei') ON CONFLICT DO NOTHING`);
await db.query(`INSERT INTO marcas_dispositivo (nombre) VALUES ('Alcatel') ON CONFLICT DO NOTHING`);
await db.query(`INSERT INTO marcas_dispositivo (nombre) VALUES ('Garmin') ON CONFLICT DO NOTHING`);

const { rows: mdRows } = await db.query(`SELECT id, nombre FROM marcas_dispositivo`);
const mdId = Object.fromEntries(mdRows.map(r => [r.nombre, r.id]));

// Líneas Xiaomi
for (const l of ["Mi","Redmi","POCO"]) {
  await db.query(
    `INSERT INTO lineas_dispositivo (marca_id, nombre) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
    [mdId["Xiaomi"], l]
  );
}

const { rows: ldRows } = await db.query(`SELECT id, nombre FROM lineas_dispositivo`);
const ldId = Object.fromEntries(ldRows.map(r => [r.nombre, r.id]));

// Modelos iPhone
const iphones = [
  ["IP_6","iPhone 6"],["IP_6S","iPhone 6S"],["IP_6S_PLUS","iPhone 6S Plus"],
  ["IP_7","iPhone 7"],["IP_7_PLUS","iPhone 7 Plus"],["IP_8","iPhone 8"],
  ["IP_8_PLUS","iPhone 8 Plus"],["IP_X","iPhone X"],["IP_XS","iPhone XS"],
  ["IP_XS_MAX","iPhone XS Max"],["IP_XR","iPhone XR"],["IP_11","iPhone 11"],
  ["IP_11_PRO","iPhone 11 Pro"],["IP_11_PRO_MAX","iPhone 11 Pro Max"],
  ["IP_SE2","iPhone SE 2ª gen"],["IP_12","iPhone 12"],["IP_12_MINI","iPhone 12 Mini"],
  ["IP_12_PRO","iPhone 12 Pro"],["IP_12_PRO_MAX","iPhone 12 Pro Max"],
  ["IP_13","iPhone 13"],["IP_13_MINI","iPhone 13 Mini"],["IP_13_PRO","iPhone 13 Pro"],
  ["IP_13_PRO_MAX","iPhone 13 Pro Max"],["IP_14","iPhone 14"],["IP_14_PLUS","iPhone 14 Plus"],
  ["IP_14_PRO","iPhone 14 Pro"],["IP_14_PRO_MAX","iPhone 14 Pro Max"],
  ["IP_15","iPhone 15"],["IP_15_PLUS","iPhone 15 Plus"],["IP_15_PRO","iPhone 15 Pro"],
  ["IP_15_PRO_MAX","iPhone 15 Pro Max"],["IP_16","iPhone 16"],["IP_16_PLUS","iPhone 16 Plus"],
  ["IP_16_PRO","iPhone 16 Pro"],["IP_16_PRO_MAX","iPhone 16 Pro Max"],
];

for (const [cod, nom] of iphones) {
  await db.query(
    `INSERT INTO modelos_dispositivo (marca_id, cod_modelo, nombre) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
    [mdId["Apple"], cod, nom]
  );
}

// Modelos Samsung (serie S)
const samsungs = [
  ["S_A03","Galaxy A03"],["S_A04","Galaxy A04"],["S_A05","Galaxy A05"],
  ["S_A13","Galaxy A13"],["S_A14","Galaxy A14"],["S_A23","Galaxy A23"],
  ["S_A24","Galaxy A24"],["S_A33","Galaxy A33"],["S_A34","Galaxy A34"],
  ["S_A52","Galaxy A52"],["S_A53","Galaxy A53"],["S_A54","Galaxy A54"],
  ["S_S21","Galaxy S21"],["S_S21U","Galaxy S21 Ultra"],["S_S22","Galaxy S22"],
  ["S_S22U","Galaxy S22 Ultra"],["S_S23","Galaxy S23"],["S_S23U","Galaxy S23 Ultra"],
  ["S_S24","Galaxy S24"],["S_S24U","Galaxy S24 Ultra"],
];

for (const [cod, nom] of samsungs) {
  await db.query(
    `INSERT INTO modelos_dispositivo (marca_id, cod_modelo, nombre) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
    [mdId["Samsung"], cod, nom]
  );
}

// Modelos Motorola
const motos = [
  ["MOTO_G4","Moto G4"],["MOTO_G5","Moto G5"],["MOTO_G6","Moto G6"],
  ["MOTO_G7","Moto G7"],["MOTO_G8","Moto G8"],["MOTO_G9","Moto G9"],
  ["MOTO_G10","Moto G10"],["MOTO_G20","Moto G20"],["MOTO_G30","Moto G30"],
  ["MOTO_G31","Moto G31"],["MOTO_G32","Moto G32"],["MOTO_G42","Moto G42"],
  ["MOTO_G52","Moto G52"],["MOTO_G53","Moto G53"],["MOTO_G54","Moto G54"],
  ["MOTO_G62","Moto G62"],["MOTO_G73","Moto G73"],["MOTO_G84","Moto G84"],
  ["MOTO_E7","Moto E7"],["MOTO_E7I","Moto E7i"],["MOTO_E20","Moto E20"],
  ["MOTO_E22","Moto E22"],["MOTO_E32","Moto E32"],["MOTO_E40","Moto E40"],
];

for (const [cod, nom] of motos) {
  await db.query(
    `INSERT INTO modelos_dispositivo (marca_id, cod_modelo, nombre) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
    [mdId["Motorola"], cod, nom]
  );
}

// Modelos Xiaomi Redmi
const redmis = [
  ["X_REDMI_9","Redmi 9"],["X_REDMI_9A","Redmi 9A"],["X_REDMI_9C","Redmi 9C"],
  ["X_REDMI_10","Redmi 10"],["X_REDMI_10A","Redmi 10A"],["X_REDMI_10C","Redmi 10C"],
  ["X_REDMI_12","Redmi 12"],["X_REDMI_12C","Redmi 12C"],
  ["X_REDMI_NOTE8","Redmi Note 8"],["X_REDMI_NOTE9","Redmi Note 9"],
  ["X_REDMI_NOTE9S","Redmi Note 9S"],["X_REDMI_NOTE10","Redmi Note 10"],
  ["X_REDMI_NOTE10S","Redmi Note 10S"],["X_REDMI_NOTE11","Redmi Note 11"],
  ["X_REDMI_NOTE11S","Redmi Note 11S"],["X_REDMI_NOTE12","Redmi Note 12"],
  ["X_REDMI_NOTE12S","Redmi Note 12S"],["X_REDMI_NOTE13","Redmi Note 13"],
  ["X_REDMI_NOTE13S","Redmi Note 13S"],["X_REDMI_NOTE13PRO","Redmi Note 13 Pro"],
];

for (const [cod, nom] of redmis) {
  await db.query(
    `INSERT INTO modelos_dispositivo (marca_id, linea_id, cod_modelo, nombre) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
    [mdId["Xiaomi"], ldId["Redmi"], cod, nom]
  );
}

// ─── 9. DIMENSIONES BASE ──────────────────────────────────────────────────────
const dims = [
  { tipo: "tamaño_cualitativo", valor: "pequeño", codigo: "S" },
  { tipo: "tamaño_cualitativo", valor: "mediano",  codigo: "M" },
  { tipo: "tamaño_cualitativo", valor: "grande",   codigo: "L" },
  { tipo: "tamaño_mm", valor: "18 mm" },
  { tipo: "tamaño_mm", valor: "20 mm" },
  { tipo: "tamaño_mm", valor: "22 mm" },
  { tipo: "tamaño_mm", valor: "24 mm" },
  { tipo: "tamaño_mm", valor: "26 mm" },
  { tipo: "tamaño_mm", valor: "28 mm" },
  { tipo: "tamaño_mm", valor: "30 mm" },
  { tipo: "tamaño_mm", valor: "40 mm" },
  { tipo: "tamaño_mm", valor: "44 mm" },
  { tipo: "tamaño_mm", valor: "45 mm" },
  { tipo: "tamaño_Pulgadas_pantalla", valor: '5.5"' },
  { tipo: "tamaño_Pulgadas_pantalla", valor: '6.0"' },
  { tipo: "tamaño_Pulgadas_pantalla", valor: '6.1"' },
  { tipo: "tamaño_Pulgadas_pantalla", valor: '6.4"' },
  { tipo: "tamaño_Pulgadas_pantalla", valor: '6.7"' },
  { tipo: "tamaño_Pulgadas_pantalla", valor: '7.0"' },
  { tipo: "tamaño_Pulgadas_pantalla", valor: '10.0"' },
  { tipo: "tamaño_Pulgadas_pantalla", valor: '10.9"' },
  { tipo: "tamaño_Pulgadas_pantalla", valor: '11.0"' },
  { tipo: "tamaño_Pulgadas_pantalla", valor: '12.9"' },
  { tipo: "tamaño_Pulgadas_pantalla", valor: '13.0"' },
  { tipo: "tamaño_Pulgadas_pantalla", valor: '13.3"' },
  { tipo: "tamaño_Pulgadas_pantalla", valor: '14.0"' },
  { tipo: "tamaño_Pulgadas_pantalla", valor: '15.6"' },
];
await ins("dimensiones", ["tipo", "valor", "codigo"], dims);

console.log("✓ Seed de parámetros completado.");
await db.end();
