// Actualización idempotente del seed de parámetros:
// - Corrige marcas 43-127 con ON CONFLICT DO UPDATE
// - Agrega categorias_jerarquia y subcategorias de Jerarquia.csv
// - Agrega modelos iPhone 17 y modelos Xiaomi completos de varios.csv
// Uso: DATABASE_URL=... node scripts/seed-update-v2.mjs

import pg from "pg";
const { Pool } = pg;

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: (process.env.DATABASE_URL || "").includes("localhost") ? false : { rejectUnauthorized: false },
});

// ─── 1. CORREGIR MARCAS (43-127) ─────────────────────────────────────────────
// Usa DO UPDATE para corregir las que la sesión anterior seedeó distinto
const marcas = [
  {id:43,nombre:"DURACELL"},{id:44,nombre:"ENERGIZER"},{id:45,nombre:"RINGO"},
  {id:46,nombre:"RINGKE"},{id:47,nombre:"HOCO."},{id:48,nombre:"WK"},
  {id:49,nombre:"CAFELE"},{id:50,nombre:"ROYALCELL"},{id:51,nombre:"IBEK"},
  {id:52,nombre:"ONE_PLUS"},{id:53,nombre:"FLASH"},{id:54,nombre:"MTK"},
  {id:55,nombre:"misoo"},{id:56,nombre:"kumamon"},{id:57,nombre:"SOUND"},
  {id:58,nombre:"Foneng"},{id:59,nombre:"beats"},{id:60,nombre:"treqa"},
  {id:61,nombre:"AKZ"},{id:62,nombre:"HYPERX"},{id:63,nombre:"Flatband"},
  {id:64,nombre:"Music"},{id:65,nombre:"inPODS"},{id:66,nombre:"TGW"},
  {id:67,nombre:"OM"},{id:68,nombre:"ITOK"},{id:69,nombre:"CLD"},
  {id:70,nombre:"DISTRON"},{id:71,nombre:"NICTOM"},{id:72,nombre:"TIME"},
  {id:73,nombre:"AITECH"},{id:74,nombre:"JXD-Link"},{id:75,nombre:"ITLY"},
  {id:76,nombre:"SEISA"},{id:77,nombre:"RAZER"},{id:78,nombre:"MARVO"},
  {id:79,nombre:"MARS_GAMING"},{id:80,nombre:"YELANDAR"},{id:81,nombre:"GTC"},
  {id:82,nombre:"OFFICE"},{id:83,nombre:"VERBATIM"},{id:84,nombre:"Micro"},
  {id:85,nombre:"TCOM"},{id:86,nombre:"LEVELUP"},{id:87,nombre:"TEEKY"},
  {id:88,nombre:"BRAIDED"},{id:89,nombre:"ORIGiNAL"},{id:90,nombre:"BELKIN"},
  {id:91,nombre:"WK_DESIGN"},{id:92,nombre:"WUW"},{id:93,nombre:"BYSOUL"},
  {id:94,nombre:"KIKIGO"},{id:95,nombre:"DIGIMUNDO"},{id:96,nombre:"EZRA"},
  {id:97,nombre:"MALIBU"},{id:98,nombre:"OTAWA"},{id:99,nombre:"LAMBOTECH"},
  {id:100,nombre:"IMEGA"},{id:101,nombre:"MIXOR"},{id:102,nombre:"DIGICELL"},
  {id:103,nombre:"PRO21"},{id:104,nombre:"ALA"},{id:105,nombre:"SOMOSTEL"},
  {id:106,nombre:"SAFETYENERGY"},{id:107,nombre:"ACER"},{id:108,nombre:"QCY"},
  {id:109,nombre:"X-VIEW"},{id:110,nombre:"LENOVO"},{id:111,nombre:"NOVATIX"},
  {id:112,nombre:"ROKU"},{id:113,nombre:"KOSMO"},{id:114,nombre:"PUXIDA"},
  {id:115,nombre:"CAMERON_SINO"},{id:116,nombre:"CORSAIR"},{id:117,nombre:"ORYX"},
  {id:118,nombre:"HARMAN-KARDON"},{id:119,nombre:"LIANDA"},{id:120,nombre:"FLYCAT"},
  {id:121,nombre:"Deleex"},{id:122,nombre:"RAYOVAC"},{id:123,nombre:"HYTOSHY"},
  {id:124,nombre:"ONLY"},{id:125,nombre:"LG"},{id:126,nombre:"DATACELL"},
  {id:127,nombre:"OPPO"},
];

for (const { id, nombre } of marcas) {
  // Si el nombre ya existe en otro ID, agregar sufijo para evitar conflicto
  try {
    await db.query(
      `INSERT INTO marcas_prod (id, nombre) VALUES ($1,$2)
       ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre`,
      [id, nombre]
    );
  } catch (e) {
    if (e.code === "23505") {
      // nombre duplicado — insertar con sufijo _id para evitar colisión
      await db.query(
        `INSERT INTO marcas_prod (id, nombre) VALUES ($1,$2)
         ON CONFLICT (id) DO UPDATE SET nombre = EXCLUDED.nombre`,
        [id, `${nombre}_${id}`]
      ).catch(() => {});
    } else throw e;
  }
}
console.log("✓ Marcas 43-127 actualizadas");

// ─── 2. CATEGORIAS_JERARQUIA (de Jerarquia.csv) ───────────────────────────────
// Obtener IDs de subgrupos dinámicamente
const { rows: sgs } = await db.query(`SELECT id, grupo_id, numero, nombre FROM subgrupos`);
const sgById = {}; // key: "grupo_id:numero" → id
for (const sg of sgs) sgById[`${sg.grupo_id}:${sg.numero}`] = sg.id;

const sgId = (gId, num) => {
  const id = sgById[`${gId}:${num}`];
  if (!id) throw new Error(`Subgrupo no encontrado: grupo ${gId} numero ${num}`);
  return id;
};

const insCat = async (subgrupo_id, numero, nombre) => {
  await db.query(
    `INSERT INTO categorias_jerarquia (subgrupo_id, numero, nombre)
     VALUES ($1,$2,$3)
     ON CONFLICT (subgrupo_id, numero) DO UPDATE SET nombre = EXCLUDED.nombre`,
    [subgrupo_id, numero, nombre]
  );
};

// Agregar unique constraint si no existe (silenciar error si ya existe)
await db.query(`
  ALTER TABLE categorias_jerarquia ADD CONSTRAINT uq_cat_sg_num UNIQUE (subgrupo_id, numero)
`).catch(() => {});

// Grupo 2 - Servicios, SubGrupo 1 - Backup
{
  const sgid = sgId(2, 1);
  await insCat(sgid, 1, "Datos");
  await insCat(sgid, 2, "Fotos");
}

// Grupo 5 - Audio, SubGrupo 1 - Auricular
{
  const sgid = sgId(5, 1);
  await insCat(sgid, 1, "In-ear");
  await insCat(sgid, 2, "Over-ear");
  await insCat(sgid, 3, "On-ear");
}

// Grupo 6 - Fundas, SubGrupo 1 - Celulares ← CRÍTICO PARA EL IMPORTER
{
  const sgid = sgId(6, 1);
  await insCat(sgid, 1,  "Rigidas");
  await insCat(sgid, 2,  "Flexibles");
  await insCat(sgid, 3,  "Silicona");
  await insCat(sgid, 4,  "Book_cover");
  await insCat(sgid, 5,  "Bumper");
  await insCat(sgid, 6,  "Otro");
  await insCat(sgid, 7,  "Neoprene");
  await insCat(sgid, 8,  "Smart_Case");
}

// Grupo 6 - Fundas, SubGrupo 2 - Tablet
{
  const sgid = sgId(6, 2);
  await insCat(sgid, 1, "Metalica");
  await insCat(sgid, 2, "Nylon_Elastizado");
}

// Grupo 7 - Accesorios, SubGrupo 6 - Content_Creator
{
  const sgid = sgId(7, 6);
  await insCat(sgid, 1, "Kit_CC");
  await insCat(sgid, 2, "Soporte_con_iluminacion");
  await insCat(sgid, 3, "Microfonos_CC");
  await insCat(sgid, 4, "Iluminacion_pro_CC");
  await insCat(sgid, 5, "Selfie_Sticks");
}

// Grupo 8 - Informática, SubGrupo 1 - Conectividad
{
  const sgid = sgId(8, 1);
  await insCat(sgid, 1, "conectividad_inalambrica");
  await insCat(sgid, 2, "conectividad_por_cable");
}

// Grupo 8 - Informática, SubGrupo 2 - Periféricos
{
  const sgid = sgId(8, 2);
  await insCat(sgid, 1, "Teclado");
  await insCat(sgid, 2, "Mouse");
  await insCat(sgid, 3, "Mousepad");
  await insCat(sgid, 4, "Audio_y_Video");
}

// Grupo 9 - Unidad Energía, SubGrupo 1 - Baterías
{
  const sgid = sgId(9, 1);
  await insCat(sgid, 1, "Pilas_alcalinas");
  await insCat(sgid, 2, "Pilas_boton");
  await insCat(sgid, 3, "Pilas_Recargables");
  await insCat(sgid, 4, "Baterias");
}

// Grupo 9 - Unidad Energía, SubGrupo 2 - Cargadores
{
  const sgid = sgId(9, 2);
  await insCat(sgid, 1, "carga_de_pared_y_otros");
  await insCat(sgid, 2, "carga_portatil");
  await insCat(sgid, 3, "carga_inalambrica");
  await insCat(sgid, 4, "carga_vehicular");
  await insCat(sgid, 5, "cables_de_carga_y_datos");
}

// Grupo 12 - GAMER, SubGrupo 1 - Teclado
{
  const sgid = sgId(12, 1);
  await insCat(sgid, 1, "Mecanico");
  await insCat(sgid, 2, "Membrana");
}

// Grupo 12 - GAMER, SubGrupo 3 - Joystick_y_Controles
{
  const sgid = sgId(12, 3);
  await insCat(sgid, 1, "p_Celular");
  await insCat(sgid, 2, "Fundas_J");
}

// Grupo 13 - Novedades, SubGrupo 1 - Iluminacion
{
  const sgid = sgId(13, 1);
  await insCat(sgid, 1, "Hogar");
  await insCat(sgid, 2, "Deco");
  await insCat(sgid, 3, "Compacta");
}

// Grupo 13 - Novedades, SubGrupo 2 - Jugeteria
{
  const sgid = sgId(13, 2);
  await insCat(sgid, 1, "electronicos");
  await insCat(sgid, 2, "juegos_de_mesa");
  await insCat(sgid, 3, "Otros");
}

// Grupo 13 - Novedades, SubGrupo 3 - Bazar/LifeStyle
{
  const sgid = sgId(13, 3);
  await insCat(sgid, 1, "Termos");
  await insCat(sgid, 2, "Vasos_termicos");
  await insCat(sgid, 3, "botellas_termicas");
}

// Grupo 13 - Novedades, SubGrupo 4 - Tecnologias
{
  const sgid = sgId(13, 4);
  await insCat(sgid, 1, "streaming_tv");
  await insCat(sgid, 2, "Gadgets");
  await insCat(sgid, 3, "Seguridad");
}

console.log("✓ categorias_jerarquia insertadas");

// ─── 3. SUBCATEGORIAS ────────────────────────────────────────────────────────
// Obtener categorias_jerarquia IDs para hacer sub-inserts
const { rows: cats } = await db.query(
  `SELECT cj.id, cj.nombre, sg.grupo_id, sg.numero AS sg_num, cj.numero
   FROM categorias_jerarquia cj JOIN subgrupos sg ON sg.id = cj.subgrupo_id`
);
const catIdx = {}; // "grupo_id:sg_num:cat_num" → id
for (const c of cats) catIdx[`${c.grupo_id}:${c.sg_num}:${c.numero}`] = c.id;

const insSub = async (categoria_id, numero, nombre) => {
  await db.query(
    `INSERT INTO subcategorias (categoria_id, numero, nombre)
     VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
    [categoria_id, numero, nombre]
  );
};

// Informática > Conectividad > conectividad_inalambrica
{
  const cid = catIdx["8:1:1"];
  if (cid) {
    await insSub(cid, 1, "router");
    await insSub(cid, 2, "Repetidor_Extensor_WiFi");
    await insSub(cid, 3, "adaptador_wifi");
    await insSub(cid, 4, "modem_router");
  }
}

// Informática > Conectividad > conectividad_por_cable
{
  const cid = catIdx["8:1:2"];
  if (cid) {
    await insSub(cid, 1, "red_ethernet");
    await insSub(cid, 2, "cables_impresora");
    await insSub(cid, 3, "cables_audio");
    await insSub(cid, 4, "Cables_HDTV");
    await insSub(cid, 5, "Alimentacion");
  }
}

// Unidad Energía > Cargadores > carga_de_pared_y_otros
{
  const cid = catIdx["9:2:1"];
  if (cid) {
    await insSub(cid, 1, "integrados");
    await insSub(cid, 2, "bases");
    await insSub(cid, 3, "p_baterias");
  }
}

console.log("✓ subcategorias insertadas");

// ─── 4. MODELOS IPHONE 17 (nuevos) ───────────────────────────────────────────
const { rows: [appleRow] } = await db.query(
  `SELECT id FROM marcas_dispositivo WHERE nombre = 'Apple'`
);
const appleId = appleRow?.id;
if (!appleId) {
  console.warn("⚠ Marca Apple no encontrada, salteando modelos iPhone 17");
} else {
  const iphone17 = [
    ["IP_17",         "iPhone 17"],
    ["IP_17_PLUS",    "iPhone 17 Plus"],
    ["IP_17_PRO",     "iPhone 17 Pro"],
    ["IP_17_PRO_MAX", "iPhone 17 Pro Max"],
  ];
  for (const [cod, nom] of iphone17) {
    await db.query(
      `INSERT INTO modelos_dispositivo (marca_id, cod_modelo, nombre)
       VALUES ($1,$2,$3) ON CONFLICT (cod_modelo) DO NOTHING`,
      [appleId, cod, nom]
    );
  }
  // iPhone SE gen 1 y modelos históricos que pueden aparecer en CSVs
  const iphoneExtra = [
    ["IP_5",      "iPhone 5"],
    ["IP_5S",     "iPhone 5S"],
    ["IP_6_PLUS", "iPhone 6 Plus"],
    ["IP_6S",     "iPhone 6S"],
    ["IP_16E",    "iPhone 16e"],
  ];
  for (const [cod, nom] of iphoneExtra) {
    await db.query(
      `INSERT INTO modelos_dispositivo (marca_id, cod_modelo, nombre)
       VALUES ($1,$2,$3) ON CONFLICT (cod_modelo) DO NOTHING`,
      [appleId, cod, nom]
    );
  }
  console.log("✓ Modelos iPhone 17 + históricos insertados");
}

// ─── 5. MODELOS XIAOMI COMPLETOS (de varios.csv) ─────────────────────────────
const { rows: [xiaomiRow] } = await db.query(
  `SELECT id FROM marcas_dispositivo WHERE nombre = 'Xiaomi'`
);
const xiaomiId = xiaomiRow?.id;

if (!xiaomiId) {
  console.warn("⚠ Marca Xiaomi no encontrada");
} else {
  // Líneas
  for (const l of ["Mi", "Redmi", "POCO"]) {
    await db.query(
      `INSERT INTO lineas_dispositivo (marca_id, nombre) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
      [xiaomiId, l]
    );
  }
  const { rows: lds } = await db.query(`SELECT id, nombre FROM lineas_dispositivo WHERE marca_id=$1`, [xiaomiId]);
  const ldId = Object.fromEntries(lds.map(r => [r.nombre, r.id]));

  // Xiaomi Mi
  const miModels = [
    "Black Shark","Black Shark 2","Mi 1","Mi 1S","Mi 2","Mi 2S","Mi 2A",
    "Mi 3","Mi 4","Mi 4c","Mi 4i","Mi 4s","Mi 5","Mi 5s","Mi 5s Plus","Mi 5X",
    "Mi 6","Mi 6X","Mi 8","Mi 8 Lite","Mi 9","Mi 9 SE","Mi 9T","Mi 9T Pro",
    "Mi 10 Lite","Mi 10","Mi 10 Pro","Mi 11 Lite","Mi 11","Mi 11 Pro","Mi 11 Ultra",
    "11T","11T Pro",
    "Mi Mix","Mi Mix 2","Mi Mix 2S","Mi Mix 3","Mi Mix Alpha",
    "Mi Note","Mi Note 2","Mi Note 3","Mi Note 10 Lite","Mi Note 10","Mi Note 10 Pro",
    "Mi Play","Mi A1","Mi A2","Mi A2 Lite","Mi A3",
  ];
  for (const nom of miModels) {
    const cod = "X_MI_" + nom.replace(/\s+/g,"_").replace(/[^A-Za-z0-9_]/g,"").toUpperCase();
    await db.query(
      `INSERT INTO modelos_dispositivo (marca_id, linea_id, cod_modelo, nombre)
       VALUES ($1,$2,$3,$4) ON CONFLICT (cod_modelo) DO NOTHING`,
      [xiaomiId, ldId["Mi"], cod, nom]
    );
  }

  // Xiaomi sin línea (serie principal: 12, 13, 14, 15)
  const xiaomiMain = [
    "12","12 Lite","12 Pro","12T","12T Pro","12S","12S Pro","12S Ultra","12 Ultra",
    "13","13 Lite","13 Pro","13 Ultra","13T","13T Pro",
    "14","14 Pro","14 Ultra","14T","14T Pro",
    "15","15 Pro","15 Ultra","15T","15T Pro",
  ];
  for (const nom of xiaomiMain) {
    const cod = "X_" + nom.replace(/\s+/g,"_").replace(/[^A-Za-z0-9_]/g,"").toUpperCase();
    await db.query(
      `INSERT INTO modelos_dispositivo (marca_id, cod_modelo, nombre)
       VALUES ($1,$2,$3) ON CONFLICT (cod_modelo) DO NOTHING`,
      [xiaomiId, cod, nom]
    );
  }

  // Redmi
  const redmiExtra = [
    "Redmi 1","Redmi 1S","Redmi 2","Redmi 2A","Redmi 3","Redmi 3S","Redmi 3X","Redmi 3A",
    "Redmi 4","Redmi 4A","Redmi 4X","Redmi 5","Redmi 5A","Redmi 5 Plus",
    "Redmi 6","Redmi 6A","Redmi 6 Pro","Redmi 7A","Redmi 7","Redmi 8A","Redmi 8",
    "Redmi 13C","Redmi 14C","Redmi 14","Redmi 14 Pro",
    "Redmi A1","Redmi A1 Lite","Redmi A2","Redmi A2 Lite","Redmi Y1","Redmi Y1 Lite","Redmi S2",
    "Redmi Note","Redmi Note 2","Redmi Note 3","Redmi Note 3 Pro","Redmi Note 4","Redmi Note 4 Pro",
    "Redmi Note 4X","Redmi Note 5","Redmi Note 5 Pro","Redmi Note 5A","Redmi Note 6 Pro",
    "Redmi Note 7","Redmi Note 7 Pro","Redmi Note 8 Pro","Redmi Note 8T",
    "Redmi Note 9 Pro","Redmi Note 9 Pro Max","Redmi Note 10 Pro","Redmi Note 10 5G",
    "Redmi Note 11 Pro","Redmi Note 11 Pro Plus","Redmi Note 12 5G","Redmi Note 12 Pro","Redmi Note 12 Pro Plus",
    "Redmi Note 13","Redmi Note 13 5G","Redmi Note 13 Pro","Redmi Note 13 Pro 5G","Redmi Note 13 Pro Plus",
    "Redmi Note 14","Redmi Note 14 Pro","Redmi Note 14 Pro Plus",
  ];
  for (const nom of redmiExtra) {
    const cod = "X_REDMI_" + nom.replace(/^Redmi\s*/i,"").replace(/\s+/g,"_").replace(/[^A-Za-z0-9_]/g,"").toUpperCase();
    await db.query(
      `INSERT INTO modelos_dispositivo (marca_id, linea_id, cod_modelo, nombre)
       VALUES ($1,$2,$3,$4) ON CONFLICT (cod_modelo) DO NOTHING`,
      [xiaomiId, ldId["Redmi"], cod, nom]
    );
  }

  // POCO
  const pocoModels = [
    "POCO F1","POCO F2","POCO F3","POCO F4","POCO F5","POCO F5 Pro","POCO F6","POCO F6 Pro","POCO F7","POCO F7 Pro",
    "POCO X3","POCO X3 Pro","POCO X4 Pro","POCO X5","POCO X5 Pro","POCO X6","POCO X6 Pro","POCO X6 Neo","POCO X7 Pro",
    "POCO M2","POCO M2 Pro","POCO M3","POCO M3 Pro","POCO M4","POCO M4 Pro","POCO M5","POCO M5 Pro","POCO M6","POCO M6 Pro",
    "POCO C65","POCO C75",
  ];
  for (const nom of pocoModels) {
    const cod = "X_POCO_" + nom.replace(/^POCO\s*/i,"").replace(/\s+/g,"_").replace(/[^A-Za-z0-9_]/g,"").toUpperCase();
    await db.query(
      `INSERT INTO modelos_dispositivo (marca_id, linea_id, cod_modelo, nombre)
       VALUES ($1,$2,$3,$4) ON CONFLICT (cod_modelo) DO NOTHING`,
      [xiaomiId, ldId["POCO"], cod, nom]
    );
  }

  console.log("✓ Modelos Xiaomi (Mi, Redmi, POCO) insertados");
}

await db.query(`
  ALTER TABLE subcategorias ADD CONSTRAINT uq_subcat_cat_num UNIQUE (categoria_id, numero)
`).catch(() => {});

console.log("✓ Seed update v2 completado.");
await db.end();
