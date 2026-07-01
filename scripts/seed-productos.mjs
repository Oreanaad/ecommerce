// Carga 20 productos de prueba en la DB de Punto Damia.
// Idempotente: usa ON CONFLICT DO NOTHING.
// Uso: DATABASE_URL=... node scripts/seed-productos.mjs

import pg from "pg";
import { initDb } from "../app/db.mjs";

const { Pool } = pg;
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: (process.env.DATABASE_URL || "").includes("localhost") ? false : { rejectUnauthorized: false },
});

await initDb();
console.log("✓ Schema listo");

const productos = [
  { id:2001, sku:"F-IP15-TRN",   nombre:"Funda TPU iPhone 15 Transparente",           precio:8500,  stock:25, grupo_id:6,  imagen:"https://picsum.photos/seed/pd2001/400/400" },
  { id:2002, sku:"F-IP15-BLK",   nombre:"Funda Silicona iPhone 15 Negro Mate",         precio:9200,  stock:18, grupo_id:6,  imagen:"https://picsum.photos/seed/pd2002/400/400" },
  { id:2003, sku:"F-SGS24-AG",   nombre:"Funda Antigolpes Samsung Galaxy S24 Ultra",   precio:10800, stock:15, grupo_id:6,  imagen:"https://picsum.photos/seed/pd2003/400/400" },
  { id:2004, sku:"F-XRN13-MIL",  nombre:"Funda Militarizada Xiaomi Redmi Note 13",    precio:7200,  stock:28, grupo_id:6,  imagen:"https://picsum.photos/seed/pd2004/400/400" },
  { id:2005, sku:"VT-IP14P",     nombre:"Vidrio Templado 9H iPhone 14 Pro",           precio:5500,  stock:40, grupo_id:10, imagen:"https://picsum.photos/seed/pd2005/400/400" },
  { id:2006, sku:"VT-SGA55",     nombre:"Vidrio Templado Full Cover Samsung A55",      precio:4200,  stock:35, grupo_id:10, imagen:"https://picsum.photos/seed/pd2006/400/400" },
  { id:2007, sku:"VT-IP16PM",    nombre:"Vidrio Templado Privacidad iPhone 16 Pro Max",precio:6800, stock:22, grupo_id:10, imagen:"https://picsum.photos/seed/pd2007/400/400" },
  { id:2008, sku:"CAR-USBC-65",  nombre:"Cargador GaN 65W USB-C 2 Puertos",          precio:12800, stock:12, grupo_id:9,  imagen:"https://picsum.photos/seed/pd2008/400/400" },
  { id:2009, sku:"CAR-QI-15W",   nombre:"Cargador Inalámbrico Qi 15W MagSafe Compat", precio:13500, stock:9,  grupo_id:9,  imagen:"https://picsum.photos/seed/pd2009/400/400" },
  { id:2010, sku:"CAB-UCL-1M",   nombre:"Cable USB-C a Lightning 1m Certificado",     precio:6900,  stock:30, grupo_id:9,  imagen:"https://picsum.photos/seed/pd2010/400/400" },
  { id:2011, sku:"PB-20K-QC",    nombre:"Power Bank 20000mAh Carga Rápida 22.5W",    precio:22000, stock:10, grupo_id:9,  imagen:"https://picsum.photos/seed/pd2011/400/400" },
  { id:2012, sku:"AUR-TWS-PRO",  nombre:"Auriculares TWS Bluetooth 5.3 ANC",          precio:35000, stock:8,  grupo_id:5,  imagen:"https://picsum.photos/seed/pd2012/400/400" },
  { id:2013, sku:"AUR-SPORT-BT", nombre:"Auriculares Deportivos Resistentes al Agua", precio:18500, stock:14, grupo_id:5,  imagen:"https://picsum.photos/seed/pd2013/400/400" },
  { id:2014, sku:"PEN-128-USB3", nombre:"Pendrive 128GB USB 3.0 Metal",               precio:9800,  stock:20, grupo_id:4,  imagen:"https://picsum.photos/seed/pd2014/400/400" },
  { id:2015, sku:"SD-256-C10",   nombre:"MicroSD 256GB A2 V30 Clase 10",              precio:14200, stock:16, grupo_id:4,  imagen:"https://picsum.photos/seed/pd2015/400/400" },
  { id:2016, sku:"HUB-USBC-7",   nombre:"Hub USB-C 7 en 1 con HDMI 4K y PD 100W",   precio:29500, stock:6,  grupo_id:3,  imagen:"https://picsum.photos/seed/pd2016/400/400" },
  { id:2017, sku:"MOU-INL-RC",   nombre:"Mouse Inalámbrico Recargable Silencioso",    precio:16800, stock:11, grupo_id:8,  imagen:"https://picsum.photos/seed/pd2017/400/400" },
  { id:2018, sku:"TEC-MEC-RGB",  nombre:"Teclado Mecánico Gaming RGB TKL",            precio:42000, stock:4,  grupo_id:12, imagen:"https://picsum.photos/seed/pd2018/400/400" },
  { id:2019, sku:"SOP-AUTO-MAG", nombre:"Soporte Auto Magnético MagSafe Compatible",  precio:7800,  stock:22, grupo_id:7,  imagen:"https://picsum.photos/seed/pd2019/400/400" },
  { id:2020, sku:"PANT-IP13-OL", nombre:"Pantalla OLED iPhone 13 con Marco Original", precio:48000, stock:5,  grupo_id:1,  imagen:"https://picsum.photos/seed/pd2020/400/400" },
];

let ok = 0, skip = 0;
for (const p of productos) {
  try {
    await db.query(
      `INSERT INTO productos
         (id, sku, nombre, precio, precio_regular, stock, stock_status, imagen, activo, grupo_id, actualizado_en)
       VALUES ($1,$2,$3,$4,$4,$5,'instock',$6,true,$7,NOW())
       ON CONFLICT (id) DO NOTHING`,
      [p.id, p.sku, p.nombre, p.precio, p.stock, p.imagen, p.grupo_id ?? null]
    );
    ok++;
    console.log(`  ✓ [${p.id}] ${p.nombre}`);
  } catch (e) {
    console.log(`  ✗ ${p.nombre}: ${e.message}`);
    skip++;
  }
}

console.log(`\n✓ ${ok} productos cargados, ${skip} saltados`);
await db.end();
