// Capa de datos propia: reemplaza WooCommerce. Postgres vía pg (Pool).
// Requiere DATABASE_URL en variables de entorno (Railway lo setea automáticamente).
import pg from "pg";
const { Pool } = pg;

let _pool = null;

export function getPool() {
  if (!_pool) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL no está configurada");
    _pool = new Pool({
      connectionString: url,
      ssl: url.includes("localhost") || url.includes("127.0.0.1")
        ? false
        : { rejectUnauthorized: false },
      max: 10,
    });
  }
  return _pool;
}

// ─── Schema ──────────────────────────────────────────────────────────────────
// Crear todas las tablas si no existen. Idempotente: se puede llamar al arrancar.

export async function initDb() {
  const db = getPool();
  await db.query(`
    CREATE SEQUENCE IF NOT EXISTS pedidos_id_seq START 1;
    CREATE SEQUENCE IF NOT EXISTS productos_id_seq START 2000;
  `).catch(() => {});
  // Asignar DEFAULT a productos.id para que crearArticulo funcione sin id externo
  await db.query(`
    ALTER TABLE productos ALTER COLUMN id SET DEFAULT nextval('productos_id_seq');
  `).catch(() => {});
  await db.query(`
    CREATE TABLE IF NOT EXISTS categorias (
      id        INTEGER PRIMARY KEY,
      nombre    TEXT    NOT NULL,
      slug      TEXT    DEFAULT '',
      parent_id INTEGER DEFAULT 0,
      count     INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS productos (
      id                INTEGER     PRIMARY KEY,
      sku               TEXT        DEFAULT '',
      nombre            TEXT        NOT NULL,
      tipo              TEXT        DEFAULT 'simple',
      precio            NUMERIC(12,2) DEFAULT 0,
      precio_regular    NUMERIC(12,2) DEFAULT 0,
      stock             INTEGER,
      stock_status      TEXT        DEFAULT 'instock',
      categorias        JSONB       DEFAULT '[]',
      marca             TEXT        DEFAULT '',
      descripcion       TEXT        DEFAULT '',
      descripcion_corta TEXT        DEFAULT '',
      imagen            TEXT        DEFAULT '',
      imagenes          JSONB       DEFAULT '[]',
      url               TEXT        DEFAULT '',
      slug              TEXT        DEFAULT '',
      peso              TEXT        DEFAULT '',
      dimensiones       JSONB       DEFAULT '{}',
      activo            BOOLEAN     DEFAULT true,
      creado_en         TIMESTAMPTZ DEFAULT NOW(),
      actualizado_en    TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_productos_activo ON productos(activo);
    CREATE INDEX IF NOT EXISTS idx_productos_stock  ON productos(stock_status);

    CREATE TABLE IF NOT EXISTS variaciones (
      id             INTEGER     PRIMARY KEY,
      producto_id    INTEGER     NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
      sku            TEXT        DEFAULT '',
      label          TEXT        DEFAULT '',
      atributos      JSONB       DEFAULT '{}',
      precio         NUMERIC(12,2) DEFAULT 0,
      precio_regular NUMERIC(12,2) DEFAULT 0,
      stock          INTEGER,
      stock_status   TEXT        DEFAULT 'instock',
      imagen         TEXT        DEFAULT '',
      activo         BOOLEAN     DEFAULT true
    );

    CREATE INDEX IF NOT EXISTS idx_variaciones_producto ON variaciones(producto_id);

    CREATE TABLE IF NOT EXISTS clientes (
      id             SERIAL      PRIMARY KEY,
      wc_id          INTEGER,
      email          TEXT        UNIQUE NOT NULL,
      nombre         TEXT        DEFAULT '',
      apellido       TEXT        DEFAULT '',
      telefono       TEXT        DEFAULT '',
      doc            TEXT        DEFAULT '',
      entrega        JSONB       DEFAULT NULL,
      billing        JSONB       DEFAULT NULL,
      shipping       JSONB       DEFAULT NULL,
      rol            TEXT        DEFAULT 'cliente',
      clave          TEXT,
      wp_pass        TEXT,
      spam           BOOLEAN     DEFAULT false,
      origen         TEXT        DEFAULT '',
      creado_en      TIMESTAMPTZ DEFAULT NOW(),
      actualizado_en TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS pedidos (
      id                INTEGER     PRIMARY KEY,
      numero            TEXT        DEFAULT '',
      status            TEXT        DEFAULT 'pending',
      total             NUMERIC(12,2) DEFAULT 0,
      subtotal          NUMERIC(12,2) DEFAULT 0,
      shipping_total    NUMERIC(12,2) DEFAULT 0,
      descuento_total   NUMERIC(12,2) DEFAULT 0,
      metodo_pago       TEXT        DEFAULT '',
      metodo_pago_titulo TEXT       DEFAULT '',
      cliente_email     TEXT        DEFAULT '',
      billing           JSONB       DEFAULT '{}',
      shipping          JSONB       DEFAULT '{}',
      shipping_lines    JSONB       DEFAULT '[]',
      fee_lines         JSONB       DEFAULT '[]',
      coupon_lines      JSONB       DEFAULT '[]',
      notas             TEXT        DEFAULT '',
      meta              JSONB       DEFAULT '{}',
      fecha_creado      TIMESTAMPTZ DEFAULT NOW(),
      actualizado_en    TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_pedidos_status ON pedidos(status);
    CREATE INDEX IF NOT EXISTS idx_pedidos_email  ON pedidos(cliente_email);
    CREATE INDEX IF NOT EXISTS idx_pedidos_fecha  ON pedidos(fecha_creado DESC);

    CREATE TABLE IF NOT EXISTS pedido_items (
      id           SERIAL  PRIMARY KEY,
      pedido_id    INTEGER NOT NULL REFERENCES pedidos(id) ON DELETE CASCADE,
      product_id   INTEGER,
      variation_id INTEGER,
      nombre       TEXT    DEFAULT '',
      sku          TEXT    DEFAULT '',
      cantidad     INTEGER DEFAULT 1,
      precio       NUMERIC(12,2) DEFAULT 0,
      subtotal     NUMERIC(12,2) DEFAULT 0,
      total        NUMERIC(12,2) DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_items_pedido ON pedido_items(pedido_id);

    CREATE TABLE IF NOT EXISTS cupones (
      id               SERIAL    PRIMARY KEY,
      codigo           TEXT      UNIQUE NOT NULL,
      tipo_descuento   TEXT      DEFAULT 'percent',
      valor            NUMERIC(12,2) DEFAULT 0,
      fecha_expiracion DATE,
      uso_limite       INTEGER,
      usos             INTEGER   DEFAULT 0,
      min_monto        NUMERIC(12,2),
      max_monto        NUMERIC(12,2),
      solo_un_uso      BOOLEAN   DEFAULT false,
      activo           BOOLEAN   DEFAULT true,
      creado_en        TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  // ── Schema de clasificación de artículos (PARAMETROS_2d) ─────────────────
  await db.query(`
    -- Jerarquía de producto (4 niveles)
    CREATE TABLE IF NOT EXISTS grupos (
      id      SMALLINT PRIMARY KEY,
      letra   CHAR(1),
      nombre  VARCHAR(60) NOT NULL,
      activo  BOOLEAN DEFAULT TRUE
    );

    CREATE TABLE IF NOT EXISTS subgrupos (
      id        SERIAL PRIMARY KEY,
      grupo_id  SMALLINT NOT NULL REFERENCES grupos(id),
      numero    SMALLINT NOT NULL,
      nombre    VARCHAR(100) NOT NULL,
      activo    BOOLEAN DEFAULT TRUE,
      UNIQUE(grupo_id, numero)
    );

    CREATE TABLE IF NOT EXISTS categorias_jerarquia (
      id           SERIAL PRIMARY KEY,
      subgrupo_id  INT NOT NULL REFERENCES subgrupos(id),
      numero       SMALLINT,
      nombre       VARCHAR(100) NOT NULL,
      activo       BOOLEAN DEFAULT TRUE
    );

    CREATE TABLE IF NOT EXISTS subcategorias (
      id            SERIAL PRIMARY KEY,
      categoria_id  INT NOT NULL REFERENCES categorias_jerarquia(id),
      numero        SMALLINT,
      nombre        VARCHAR(100) NOT NULL,
      activo        BOOLEAN DEFAULT TRUE
    );

    -- Sistema EAV de parámetros
    CREATE TABLE IF NOT EXISTS grupos_param (
      id      SMALLINT PRIMARY KEY,
      codigo  CHAR(2) NOT NULL,
      nombre  VARCHAR(50) NOT NULL
    );

    CREATE TABLE IF NOT EXISTS atributos (
      id              SERIAL PRIMARY KEY,
      grupo_param_id  SMALLINT NOT NULL REFERENCES grupos_param(id),
      nombre          VARCHAR(100) NOT NULL UNIQUE,
      tipo            VARCHAR(20) NOT NULL DEFAULT 'enum',
      activo          BOOLEAN DEFAULT TRUE
    );

    CREATE TABLE IF NOT EXISTS valores_atributo (
      id           SERIAL PRIMARY KEY,
      atributo_id  INT NOT NULL REFERENCES atributos(id) ON DELETE CASCADE,
      codigo       VARCHAR(20) NOT NULL,
      valor        VARCHAR(200) NOT NULL,
      sinonimos    TEXT,
      activo       BOOLEAN DEFAULT TRUE,
      UNIQUE(atributo_id, codigo)
    );

    -- Marcas del catálogo de productos
    CREATE TABLE IF NOT EXISTS marcas_prod (
      id      SMALLINT PRIMARY KEY,
      nombre  VARCHAR(100) NOT NULL UNIQUE,
      activo  BOOLEAN DEFAULT TRUE
    );

    -- Paleta de colores unificada
    CREATE TABLE IF NOT EXISTS colores (
      id        SMALLINT PRIMARY KEY,
      nombre    VARCHAR(100) NOT NULL UNIQUE,
      sinonimos TEXT,
      activo    BOOLEAN DEFAULT TRUE
    );

    -- Dimensiones / tamaños
    CREATE TABLE IF NOT EXISTS dimensiones (
      id        SERIAL PRIMARY KEY,
      tipo      VARCHAR(60) NOT NULL,
      valor     VARCHAR(50) NOT NULL,
      codigo    VARCHAR(10),
      sinonimo  TEXT,
      activo    BOOLEAN DEFAULT TRUE
    );

    -- Compatibilidad con dispositivos
    CREATE TABLE IF NOT EXISTS marcas_dispositivo (
      id      SERIAL PRIMARY KEY,
      nombre  VARCHAR(50) NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS lineas_dispositivo (
      id        SERIAL PRIMARY KEY,
      marca_id  INT NOT NULL REFERENCES marcas_dispositivo(id),
      nombre    VARCHAR(60) NOT NULL,
      UNIQUE(marca_id, nombre)
    );

    CREATE TABLE IF NOT EXISTS modelos_dispositivo (
      id            SERIAL PRIMARY KEY,
      marca_id      INT NOT NULL REFERENCES marcas_dispositivo(id),
      linea_id      INT REFERENCES lineas_dispositivo(id),
      cod_modelo    VARCHAR(60) UNIQUE,
      nombre        VARCHAR(200) NOT NULL,
      conectividad  VARCHAR(20),
      activo        BOOLEAN DEFAULT TRUE
    );

    -- Relaciones producto ↔ clasificación
    CREATE TABLE IF NOT EXISTS producto_atributos (
      producto_id  INT NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
      atributo_id  INT NOT NULL REFERENCES atributos(id),
      valor_id     INT REFERENCES valores_atributo(id),
      valor_num    NUMERIC,
      valor_texto  TEXT,
      PRIMARY KEY (producto_id, atributo_id)
    );

    CREATE TABLE IF NOT EXISTS producto_modelos (
      producto_id  INT NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
      modelo_id    INT NOT NULL REFERENCES modelos_dispositivo(id),
      PRIMARY KEY (producto_id, modelo_id)
    );

    CREATE TABLE IF NOT EXISTS producto_compat_marca (
      id           SERIAL PRIMARY KEY,
      producto_id  INT NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
      marca_id     INT NOT NULL REFERENCES marcas_dispositivo(id),
      linea_id     INT REFERENCES lineas_dispositivo(id)
    );

    CREATE TABLE IF NOT EXISTS producto_imagenes (
      id            SERIAL PRIMARY KEY,
      producto_id   INT NOT NULL REFERENCES productos(id) ON DELETE CASCADE,
      variacion_id  INT REFERENCES variaciones(id),
      url           TEXT NOT NULL,
      orden         SMALLINT DEFAULT 0,
      es_principal  BOOLEAN DEFAULT FALSE
    );

    -- Índices de búsqueda/filtrado
    CREATE INDEX IF NOT EXISTS idx_prod_atrib_producto ON producto_atributos(producto_id);
    CREATE INDEX IF NOT EXISTS idx_prod_atrib_atributo ON producto_atributos(atributo_id);
    CREATE INDEX IF NOT EXISTS idx_prod_modelos_modelo ON producto_modelos(modelo_id);
    CREATE INDEX IF NOT EXISTS idx_mod_disp_marca      ON modelos_dispositivo(marca_id);
    CREATE INDEX IF NOT EXISTS idx_valores_atributo    ON valores_atributo(atributo_id);
  `);

  // Extender tablas existentes con columnas de clasificación (idempotente)
  await db.query(`
    ALTER TABLE productos ADD COLUMN IF NOT EXISTS grupo_id        SMALLINT REFERENCES grupos(id);
    ALTER TABLE productos ADD COLUMN IF NOT EXISTS subgrupo_id     INT REFERENCES subgrupos(id);
    ALTER TABLE productos ADD COLUMN IF NOT EXISTS categoria_jer_id INT REFERENCES categorias_jerarquia(id);
    ALTER TABLE productos ADD COLUMN IF NOT EXISTS subcategoria_jer_id INT REFERENCES subcategorias(id);
    ALTER TABLE productos ADD COLUMN IF NOT EXISTS marca_prod_id   SMALLINT REFERENCES marcas_prod(id);
    ALTER TABLE variaciones ADD COLUMN IF NOT EXISTS color_id      SMALLINT REFERENCES colores(id);
    ALTER TABLE variaciones ADD COLUMN IF NOT EXISTS dimension_id  INT REFERENCES dimensiones(id);
  `);
}

// ─── Categorías ──────────────────────────────────────────────────────────────

export async function upsertCategoria({ id, nombre, slug = "", parent_id = 0, count = 0 }) {
  const db = getPool();
  await db.query(
    `INSERT INTO categorias (id, nombre, slug, parent_id, count)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (id) DO UPDATE SET nombre=$2, slug=$3, parent_id=$4, count=$5`,
    [id, nombre, slug, parent_id, count]
  );
}

export async function getCategorias() {
  const { rows } = await getPool().query(`SELECT * FROM categorias ORDER BY nombre`);
  return rows;
}

// ─── Productos ───────────────────────────────────────────────────────────────

export async function upsertProducto(p) {
  await getPool().query(
    `INSERT INTO productos
       (id, sku, nombre, tipo, precio, precio_regular, stock, stock_status,
        categorias, marca, descripcion, descripcion_corta, imagen, imagenes,
        url, slug, peso, dimensiones, activo, grupo_id, subgrupo_id, actualizado_en)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,NOW())
     ON CONFLICT (id) DO UPDATE SET
       sku=$2, nombre=$3, tipo=$4, precio=$5, precio_regular=$6,
       stock=$7, stock_status=$8, categorias=$9, marca=$10,
       descripcion=$11, descripcion_corta=$12, imagen=$13, imagenes=$14,
       url=$15, slug=$16, peso=$17, dimensiones=$18, activo=$19,
       grupo_id=$20, subgrupo_id=$21, actualizado_en=NOW()`,
    [
      p.id, p.sku || "", p.nombre, p.tipo || "simple",
      p.precio || 0, p.precio_regular || p.precio || 0,
      p.stock ?? null, p.stock_status || "instock",
      JSON.stringify(p.categorias || []),
      p.marca || "", p.descripcion || "", p.descripcion_corta || "",
      p.imagen || "", JSON.stringify(p.imagenes || []),
      p.url || "", p.slug || "", p.peso || "",
      JSON.stringify(p.dimensiones || {}), p.activo !== false,
      p.grupo_id || null, p.subgrupo_id || null,
    ]
  );
}

export async function upsertVariacion(v, productoId) {
  await getPool().query(
    `INSERT INTO variaciones
       (id, producto_id, sku, label, atributos, precio, precio_regular,
        stock, stock_status, imagen, activo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (id) DO UPDATE SET
       producto_id=$2, sku=$3, label=$4, atributos=$5, precio=$6,
       precio_regular=$7, stock=$8, stock_status=$9, imagen=$10, activo=$11`,
    [
      v.id, productoId, v.sku || "", v.label || "",
      JSON.stringify(v.atributos || {}),
      v.precio || 0, v.precio_regular || v.precio || 0,
      v.stock ?? null, v.stock_status || "instock",
      v.imagen || "", v.activo !== false,
    ]
  );
}

// Devuelve el catálogo en el mismo shape que syncCatalogo de WooCommerce.
// Es el reemplazo directo de leer catalogo.json.
export async function getCatalogo() {
  const { rows } = await getPool().query(`
    SELECT p.*,
      COALESCE(
        json_agg(
          json_build_object(
            'id', v.id, 'sku', v.sku, 'label', v.label,
            'atributos', v.atributos, 'precio', v.precio,
            'precio_regular', v.precio_regular,
            'stock', v.stock, 'stock_status', v.stock_status
          ) ORDER BY v.id
        ) FILTER (WHERE v.id IS NOT NULL AND v.activo = true),
        '[]'
      ) AS variaciones
    FROM productos p
    LEFT JOIN variaciones v ON v.producto_id = p.id
    WHERE p.activo = true
    GROUP BY p.id
    ORDER BY p.nombre
  `);
  const productos = rows.map(p => ({
    id: p.id, sku: p.sku || "", nombre: p.nombre,
    tipo: p.tipo, precio: Number(p.precio),
    precio_regular: Number(p.precio_regular),
    stock: p.stock, stock_status: p.stock_status,
    categorias: p.categorias || [], marca: p.marca || "",
    descripcion: p.descripcion || "", descripcion_corta: p.descripcion_corta || "",
    imagen: p.imagen || "", imagenes: p.imagenes || [],
    url: p.url || "", slug: p.slug || "",
    variaciones: (p.variaciones || []).map(v => ({
      id: v.id, sku: v.sku || "", label: v.label || "",
      atributos: v.atributos || {},
      precio: Number(v.precio), precio_regular: Number(v.precio_regular),
      stock: v.stock, stock_status: v.stock_status,
    })),
  }));
  const categorias = [...new Set(productos.flatMap(p => p.categorias))].sort();
  return {
    sincronizado: new Date().toISOString(),
    total: productos.length,
    total_variaciones: productos.reduce((n, p) => n + p.variaciones.length, 0),
    categorias, productos,
  };
}

// Jerarquía de categorías desde grupos/subgrupos, con conteo de productos
export async function getCategoriasJerarquia() {
  const db = getPool();
  const { rows: grupos } = await db.query(`
    SELECT g.id, g.nombre,
      COUNT(DISTINCT p.id) FILTER (WHERE p.activo AND p.stock_status = 'instock') AS total
    FROM grupos g
    LEFT JOIN productos p ON p.grupo_id = g.id
    GROUP BY g.id, g.nombre
    ORDER BY g.id
  `);
  const { rows: subs } = await db.query(`
    SELECT s.id, s.grupo_id, s.nombre,
      COUNT(DISTINCT p.id) FILTER (WHERE p.activo AND p.stock_status = 'instock') AS total
    FROM subgrupos s
    LEFT JOIN productos p ON p.subgrupo_id = s.id
    GROUP BY s.id, s.grupo_id, s.nombre
    ORDER BY s.grupo_id, s.id
  `);
  return grupos
    .filter(g => Number(g.total) > 0)
    .sort((a, b) => Number(b.total) - Number(a.total))
    .map(g => ({
      id: g.id, name: g.nombre, count: Number(g.total),
      hijas: subs
        .filter(s => s.grupo_id === g.id && Number(s.total) > 0)
        .sort((a, b) => Number(b.total) - Number(a.total))
        .map(s => ({ id: s.id, name: s.nombre, count: Number(s.total), parent: g.id })),
    }));
}

export async function getProducto(id) {
  const db = getPool();
  const { rows } = await db.query(`SELECT * FROM productos WHERE id = $1`, [id]);
  if (!rows[0]) return null;
  const { rows: vars } = await db.query(
    `SELECT * FROM variaciones WHERE producto_id = $1 AND activo = true ORDER BY id`,
    [id]
  );
  const p = rows[0];
  return {
    id: p.id, sku: p.sku, nombre: p.nombre, tipo: p.tipo,
    precio: Number(p.precio), precio_regular: Number(p.precio_regular),
    stock: p.stock, stock_status: p.stock_status,
    categorias: p.categorias || [], marca: p.marca || "",
    descripcion: p.descripcion || "", descripcion_corta: p.descripcion_corta || "",
    imagen: p.imagen || "", imagenes: p.imagenes || [],
    url: p.url || "", slug: p.slug || "",
    peso: p.peso || "", dimensiones: p.dimensiones || {},
    activo: p.activo,
    variaciones: vars.map(v => ({
      id: v.id, sku: v.sku, label: v.label, atributos: v.atributos || {},
      precio: Number(v.precio), precio_regular: Number(v.precio_regular),
      stock: v.stock, stock_status: v.stock_status, imagen: v.imagen || "",
    })),
  };
}

export async function setStock(productId, variationId, stock) {
  const db = getPool();
  const status = stock === null || stock > 0 ? "instock" : "outofstock";
  if (variationId) {
    await db.query(
      `UPDATE variaciones SET stock=$1, stock_status=$2 WHERE id=$3`,
      [stock, status, variationId]
    );
    // Recalcular stock del padre según sus variaciones
    const { rows } = await db.query(
      `SELECT stock, stock_status FROM variaciones WHERE producto_id=$1 AND activo=true`,
      [productId]
    );
    const totalStock = rows.reduce((n, v) => n + (v.stock || 0), 0);
    const parentStatus = rows.some(v => v.stock_status === "instock" && v.stock !== 0) ? "instock" : "outofstock";
    await db.query(
      `UPDATE productos SET stock=$1, stock_status=$2, actualizado_en=NOW() WHERE id=$3`,
      [totalStock, parentStatus, productId]
    );
  } else {
    await db.query(
      `UPDATE productos SET stock=$1, stock_status=$2, actualizado_en=NOW() WHERE id=$3`,
      [stock, status, productId]
    );
  }
}

export async function setPrecio(productId, variationId, precio, precioRegular) {
  const db = getPool();
  if (variationId) {
    await db.query(
      `UPDATE variaciones SET precio=$1, precio_regular=$2 WHERE id=$3`,
      [precio, precioRegular || precio, variationId]
    );
  } else {
    await db.query(
      `UPDATE productos SET precio=$1, precio_regular=$2, actualizado_en=NOW() WHERE id=$3`,
      [precio, precioRegular || precio, productId]
    );
  }
}

// ─── Clientes ────────────────────────────────────────────────────────────────

export async function upsertCliente(c) {
  const { rows } = await getPool().query(
    `INSERT INTO clientes
       (wc_id, email, nombre, apellido, telefono, doc,
        entrega, billing, shipping,
        rol, clave, wp_pass, spam, origen, actualizado_en)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
     ON CONFLICT (email) DO UPDATE SET
       wc_id      = COALESCE(EXCLUDED.wc_id, clientes.wc_id),
       nombre     = CASE WHEN EXCLUDED.nombre     != '' THEN EXCLUDED.nombre     ELSE clientes.nombre     END,
       apellido   = CASE WHEN EXCLUDED.apellido   != '' THEN EXCLUDED.apellido   ELSE clientes.apellido   END,
       telefono   = CASE WHEN EXCLUDED.telefono   != '' THEN EXCLUDED.telefono   ELSE clientes.telefono   END,
       doc        = CASE WHEN EXCLUDED.doc        != '' THEN EXCLUDED.doc        ELSE clientes.doc        END,
       entrega    = COALESCE(EXCLUDED.entrega,  clientes.entrega),
       billing    = COALESCE(EXCLUDED.billing,  clientes.billing),
       shipping   = COALESCE(EXCLUDED.shipping, clientes.shipping),
       rol        = CASE WHEN EXCLUDED.rol != 'cliente' THEN EXCLUDED.rol ELSE clientes.rol END,
       clave      = COALESCE(EXCLUDED.clave,   clientes.clave),
       wp_pass    = COALESCE(EXCLUDED.wp_pass, clientes.wp_pass),
       spam       = EXCLUDED.spam,
       actualizado_en = NOW()
     RETURNING *`,
    [
      c.wc_id || null,
      (c.email || "").toLowerCase().trim(),
      c.nombre || "", c.apellido || "",
      c.telefono || "", c.doc || "",
      c.entrega  ? JSON.stringify(c.entrega)  : null,
      c.billing  ? JSON.stringify(c.billing)  : null,
      c.shipping ? JSON.stringify(c.shipping) : null,
      c.rol || "cliente",
      c.clave   || null,
      c.wp_pass || null,
      c.spam || false,
      c.origen || "",
    ]
  );
  return rows[0];
}

export async function getCliente(email) {
  const { rows } = await getPool().query(
    `SELECT * FROM clientes WHERE email = $1`,
    [(email || "").toLowerCase().trim()]
  );
  return rows[0] || null;
}

export async function getClientes({ page = 1, per_page = 100 } = {}) {
  const db = getPool();
  const offset = (page - 1) * per_page;
  const { rows } = await db.query(
    `SELECT * FROM clientes WHERE spam = false ORDER BY creado_en DESC LIMIT $1 OFFSET $2`,
    [per_page, offset]
  );
  const { rows: [{ count }] } = await db.query(`SELECT COUNT(*) FROM clientes WHERE spam = false`);
  return { clientes: rows, total: Number(count) };
}

export async function buscarClientes(q) {
  const term = `%${q}%`;
  const { rows } = await getPool().query(
    `SELECT * FROM clientes
     WHERE spam = false
       AND (email ILIKE $1 OR nombre ILIKE $1 OR apellido ILIKE $1 OR telefono ILIKE $1)
     LIMIT 20`,
    [term]
  );
  return rows;
}

export async function actualizarCliente(email, campos) {
  email = (email || "").toLowerCase().trim();
  const allowed = ["nombre", "apellido", "telefono", "doc", "entrega", "billing", "shipping", "rol", "clave", "wp_pass"];
  const sets = [], vals = [];
  for (const [k, v] of Object.entries(campos || {})) {
    if (!allowed.includes(k)) continue;
    vals.push(typeof v === "object" && v !== null ? JSON.stringify(v) : v);
    sets.push(`${k} = $${vals.length}`);
  }
  if (!sets.length) return;
  vals.push(email);
  await getPool().query(
    `UPDATE clientes SET ${sets.join(", ")}, actualizado_en=NOW() WHERE email=$${vals.length}`,
    vals
  );
}

// ─── Pedidos ─────────────────────────────────────────────────────────────────

export async function crearPedido(data) {
  const db = getPool();
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    if (!data.id) {
      const { rows: [{ nextval }] } = await client.query(`SELECT nextval('pedidos_id_seq')`);
      data.id = Number(nextval);
    }
    const { rows: [p] } = await client.query(
      `INSERT INTO pedidos
         (id, numero, status, total, subtotal, shipping_total, descuento_total,
          metodo_pago, metodo_pago_titulo, cliente_email,
          billing, shipping, shipping_lines, fee_lines, coupon_lines,
          notas, meta, fecha_creado)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING *`,
      [
        data.id,
        data.numero || String(data.id),
        data.status || "pending",
        data.total || 0,
        data.subtotal || 0,
        data.shipping_total || 0,
        data.descuento_total || 0,
        data.metodo_pago || "",
        data.metodo_pago_titulo || "",
        (data.cliente_email || "").toLowerCase(),
        JSON.stringify(data.billing || {}),
        JSON.stringify(data.shipping || {}),
        JSON.stringify(data.shipping_lines || []),
        JSON.stringify(data.fee_lines || []),
        JSON.stringify(data.coupon_lines || []),
        data.notas || "",
        JSON.stringify(data.meta || {}),
        data.fecha_creado ? new Date(data.fecha_creado) : new Date(),
      ]
    );
    for (const it of data.items || []) {
      await client.query(
        `INSERT INTO pedido_items
           (pedido_id, product_id, variation_id, nombre, sku, cantidad, precio, subtotal, total)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [p.id, it.product_id || null, it.variation_id || null, it.nombre || "", it.sku || "", it.cantidad || 1, it.precio || 0, it.subtotal || 0, it.total || 0]
      );
    }
    await client.query("COMMIT");
    return p;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

export async function getPedido(id) {
  const db = getPool();
  const { rows } = await db.query(`SELECT * FROM pedidos WHERE id = $1`, [id]);
  if (!rows[0]) return null;
  const { rows: items } = await db.query(
    `SELECT * FROM pedido_items WHERE pedido_id = $1 ORDER BY id`,
    [id]
  );
  return { ...rows[0], items };
}

export async function getPedidos({ page = 1, per_page = 100, limit, status, email, after, before, desde, hasta, q } = {}) {
  const wheres = [], vals = [];
  if (status) {
    const list = Array.isArray(status) ? status : status.split(",").map(s => s.trim()).filter(Boolean);
    vals.push(list);
    wheres.push(`status = ANY($${vals.length})`);
  }
  if (email) { vals.push(email.toLowerCase()); wheres.push(`cliente_email = $${vals.length}`); }
  if (q)     { vals.push(`%${q}%`); wheres.push(`(cliente_email ILIKE $${vals.length} OR billing->>'first_name' ILIKE $${vals.length} OR billing->>'last_name' ILIKE $${vals.length} OR CAST(id AS TEXT) LIKE $${vals.length})`); }
  if (after)  { vals.push(new Date(after));  wheres.push(`fecha_creado >= $${vals.length}`); }
  if (before) { vals.push(new Date(before)); wheres.push(`fecha_creado <= $${vals.length}`); }
  if (desde)  { vals.push(desde); wheres.push(`fecha_creado::date >= $${vals.length}::date`); }
  if (hasta)  { vals.push(hasta); wheres.push(`fecha_creado::date <= $${vals.length}::date`); }
  const where = wheres.length ? `WHERE ${wheres.join(" AND ")}` : "";
  const lim = limit || per_page;
  const offset = (page - 1) * lim;
  vals.push(lim, offset);
  const { rows } = await getPool().query(
    `SELECT p.*, COALESCE(json_agg(pi ORDER BY pi.id) FILTER (WHERE pi.id IS NOT NULL), '[]') AS items
     FROM pedidos p LEFT JOIN pedido_items pi ON pi.pedido_id = p.id
     ${where} GROUP BY p.id ORDER BY p.fecha_creado DESC LIMIT $${vals.length - 1} OFFSET $${vals.length}`,
    vals
  );
  return rows;
}

export async function updatePedidoStatus(id, status) {
  const { rows } = await getPool().query(
    `UPDATE pedidos SET status=$1, actualizado_en=NOW() WHERE id=$2 RETURNING *`,
    [status, id]
  );
  return rows[0];
}

export async function updatePedido(id, fields) {
  const allowed = [
    "status", "total", "subtotal", "shipping_total", "descuento_total",
    "metodo_pago", "metodo_pago_titulo", "billing", "shipping",
    "shipping_lines", "fee_lines", "coupon_lines", "notas", "meta",
  ];
  const sets = [], vals = [];
  for (const [k, v] of Object.entries(fields)) {
    if (!allowed.includes(k)) continue;
    vals.push(typeof v === "object" && v !== null ? JSON.stringify(v) : v);
    sets.push(`${k} = $${vals.length}`);
  }
  if (!sets.length) return null;
  vals.push(id);
  const { rows } = await getPool().query(
    `UPDATE pedidos SET ${sets.join(", ")}, actualizado_en=NOW() WHERE id=$${vals.length} RETURNING *`,
    vals
  );
  return rows[0];
}

// ─── Cupones ─────────────────────────────────────────────────────────────────

export async function getCupones() {
  const { rows } = await getPool().query(
    `SELECT * FROM cupones WHERE activo = true ORDER BY creado_en DESC`
  );
  return rows;
}

export async function getCupon(codigo) {
  const { rows } = await getPool().query(
    `SELECT * FROM cupones WHERE codigo = $1 AND activo = true`,
    [(codigo || "").toLowerCase().trim()]
  );
  return rows[0] || null;
}

export async function crearCupon(c) {
  const { rows } = await getPool().query(
    `INSERT INTO cupones
       (codigo, tipo_descuento, valor, fecha_expiracion, uso_limite, usos,
        min_monto, max_monto, solo_un_uso)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (codigo) DO UPDATE SET
       tipo_descuento=$2, valor=$3, fecha_expiracion=$4,
       uso_limite=$5, min_monto=$7, max_monto=$8, solo_un_uso=$9
     RETURNING *`,
    [
      (c.codigo || "").toLowerCase().trim(),
      c.tipo_descuento || c.discount_type || "percent",
      Number(c.valor || c.amount || 0),
      c.fecha_expiracion || c.date_expires || null,
      c.uso_limite || c.usage_limit || null,
      c.usos || c.usage_count || 0,
      Number(c.min_monto || c.minimum_amount || 0) || null,
      Number(c.max_monto || c.maximum_amount || 0) || null,
      c.solo_un_uso || c.individual_use || false,
    ]
  );
  return rows[0];
}

export async function borrarCupon(id) {
  await getPool().query(`UPDATE cupones SET activo=false WHERE id=$1`, [id]);
}

export async function incrementarUsoCupon(codigo) {
  await getPool().query(
    `UPDATE cupones SET usos = usos + 1 WHERE codigo = $1`,
    [(codigo || "").toLowerCase().trim()]
  );
}

// ─── Stock delta (atómico en Postgres, sin locks JS) ─────────────────────────

export async function adjustStock(productId, variationId, delta) {
  delta = Math.round(Number(delta) || 0);
  if (!delta) return;
  const db = getPool();
  if (variationId) {
    await db.query(
      `UPDATE variaciones SET
         stock = GREATEST(0, COALESCE(stock, 0) + $1),
         stock_status = CASE WHEN GREATEST(0, COALESCE(stock, 0) + $1) > 0 THEN 'instock' ELSE 'outofstock' END
       WHERE id = $2`,
      [delta, variationId]
    );
    const { rows } = await db.query(
      `SELECT stock, stock_status FROM variaciones WHERE producto_id = $1 AND activo = true`,
      [productId]
    );
    const totalStock = rows.reduce((n, v) => n + (v.stock || 0), 0);
    const parentStatus = rows.some(v => v.stock_status === "instock" && v.stock !== 0) ? "instock" : "outofstock";
    await db.query(
      `UPDATE productos SET stock = $1, stock_status = $2, actualizado_en = NOW() WHERE id = $3`,
      [totalStock, parentStatus, productId]
    );
  } else {
    await db.query(
      `UPDATE productos SET
         stock = GREATEST(0, COALESCE(stock, 0) + $1),
         stock_status = CASE WHEN GREATEST(0, COALESCE(stock, 0) + $1) > 0 THEN 'instock' ELSE 'outofstock' END,
         actualizado_en = NOW()
       WHERE id = $2`,
      [delta, productId]
    );
  }
}

// Genera el próximo ID de pedido desde la secuencia de Postgres
export async function nextPedidoId() {
  const { rows: [{ nextval }] } = await getPool().query(`SELECT nextval('pedidos_id_seq')`);
  return Number(nextval);
}

// ─── Parámetros de clasificación ─────────────────────────────────────────────

export async function getEstructuraCompleta() {
  const db = getPool();
  const [grupos, subgrupos, categorias, subcategorias, grupos_param, atributos, marcas_prod, colores, marcas_disp, lineas, modelos] = await Promise.all([
    db.query(`SELECT * FROM grupos WHERE activo ORDER BY id`),
    db.query(`SELECT * FROM subgrupos WHERE activo ORDER BY grupo_id, numero`),
    db.query(`SELECT * FROM categorias_jerarquia WHERE activo ORDER BY subgrupo_id, numero`),
    db.query(`SELECT * FROM subcategorias WHERE activo ORDER BY categoria_id, numero`),
    db.query(`SELECT * FROM grupos_param ORDER BY id`),
    db.query(`SELECT a.*, json_agg(v ORDER BY v.codigo) FILTER (WHERE v.id IS NOT NULL) AS valores
              FROM atributos a LEFT JOIN valores_atributo v ON v.atributo_id = a.id
              WHERE a.activo GROUP BY a.id ORDER BY a.grupo_param_id, a.id`),
    db.query(`SELECT * FROM marcas_prod WHERE activo ORDER BY nombre`),
    db.query(`SELECT * FROM colores WHERE activo ORDER BY id`),
    db.query(`SELECT * FROM marcas_dispositivo ORDER BY nombre`),
    db.query(`SELECT * FROM lineas_dispositivo ORDER BY marca_id, nombre`),
    db.query(`SELECT m.*, md.nombre AS marca_nombre, l.nombre AS linea_nombre
              FROM modelos_dispositivo m
              JOIN marcas_dispositivo md ON md.id = m.marca_id
              LEFT JOIN lineas_dispositivo l ON l.id = m.linea_id
              WHERE m.activo ORDER BY md.nombre, l.nombre NULLS FIRST, m.nombre`),
  ]);
  return {
    grupos: grupos.rows, subgrupos: subgrupos.rows,
    categorias: categorias.rows, subcategorias: subcategorias.rows,
    grupos_param: grupos_param.rows, atributos: atributos.rows,
    marcas_prod: marcas_prod.rows, colores: colores.rows,
    marcas_dispositivo: marcas_disp.rows, lineas_dispositivo: lineas.rows,
    modelos_dispositivo: modelos.rows,
  };
}

// ─── CRUD de artículos con clasificación ──────────────────────────────────────

export async function listArticulos({ q = "", grupo_id, page = 1, limit = 50 } = {}) {
  const db = getPool();
  const offset = (page - 1) * limit;
  const conds = ["p.activo = TRUE"];
  const vals = [];
  if (q) { vals.push(`%${q}%`); conds.push(`(p.nombre ILIKE $${vals.length} OR p.sku ILIKE $${vals.length})`); }
  if (grupo_id) { vals.push(grupo_id); conds.push(`p.grupo_id = $${vals.length}`); }
  const where = conds.join(" AND ");
  vals.push(limit, offset);
  const { rows } = await db.query(
    `SELECT p.id, p.sku, p.nombre, p.precio, p.precio_regular, p.stock,
            g.nombre AS grupo, sg.nombre AS subgrupo, mp.nombre AS marca,
            p.grupo_id, p.subgrupo_id, p.categoria_jer_id, p.subcategoria_jer_id
     FROM productos p
     LEFT JOIN grupos g ON g.id = p.grupo_id
     LEFT JOIN subgrupos sg ON sg.id = p.subgrupo_id
     LEFT JOIN marcas_prod mp ON mp.id = p.marca_prod_id
     WHERE ${where} ORDER BY p.actualizado_en DESC LIMIT $${vals.length - 1} OFFSET $${vals.length}`,
    vals
  );
  return rows;
}

export async function getArticuloDetalle(id) {
  const db = getPool();
  const [pRes, atrsRes, modsRes] = await Promise.all([
    db.query(`SELECT p.*, g.nombre AS grupo_nombre, sg.nombre AS subgrupo_nombre,
                     cj.nombre AS categoria_nombre, sc.nombre AS subcategoria_nombre,
                     mp.nombre AS marca_nombre
              FROM productos p
              LEFT JOIN grupos g ON g.id = p.grupo_id
              LEFT JOIN subgrupos sg ON sg.id = p.subgrupo_id
              LEFT JOIN categorias_jerarquia cj ON cj.id = p.categoria_jer_id
              LEFT JOIN subcategorias sc ON sc.id = p.subcategoria_jer_id
              LEFT JOIN marcas_prod mp ON mp.id = p.marca_prod_id
              WHERE p.id = $1`, [id]),
    db.query(`SELECT pa.*, a.nombre AS atributo_nombre, va.valor AS valor_nombre
              FROM producto_atributos pa
              JOIN atributos a ON a.id = pa.atributo_id
              LEFT JOIN valores_atributo va ON va.id = pa.valor_id
              WHERE pa.producto_id = $1`, [id]),
    db.query(`SELECT pm.modelo_id, m.cod_modelo, m.nombre AS modelo_nombre,
                     md.nombre AS marca_nombre
              FROM producto_modelos pm
              JOIN modelos_dispositivo m ON m.id = pm.modelo_id
              JOIN marcas_dispositivo md ON md.id = m.marca_id
              WHERE pm.producto_id = $1`, [id]),
  ]);
  if (!pRes.rows[0]) return null;
  return { ...pRes.rows[0], atributos: atrsRes.rows, modelos: modsRes.rows };
}

export async function crearArticulo({ nombre, sku = "", descripcion = "", grupo_id, subgrupo_id, categoria_jer_id, subcategoria_jer_id, marca_prod_id, precio, precio_regular, stock = 0 }) {
  const db = getPool();
  const { rows: [p] } = await db.query(
    `INSERT INTO productos (nombre, sku, descripcion, grupo_id, subgrupo_id, categoria_jer_id, subcategoria_jer_id, marca_prod_id, precio, precio_regular, stock, stock_status, actualizado_en)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,CASE WHEN $11>0 THEN 'instock' ELSE 'outofstock' END,NOW())
     RETURNING id`,
    [nombre, sku, descripcion, grupo_id || null, subgrupo_id || null, categoria_jer_id || null, subcategoria_jer_id || null, marca_prod_id || null, precio || 0, precio_regular || 0, stock]
  );
  return p;
}

export async function actualizarArticulo(id, datos) {
  const db = getPool();
  const campos = [];
  const vals = [];
  const set = (col, v) => { if (v !== undefined) { vals.push(v); campos.push(`${col}=$${vals.length}`); } };
  set("nombre", datos.nombre);
  set("sku", datos.sku);
  set("descripcion", datos.descripcion);
  set("grupo_id", datos.grupo_id ?? null);
  set("subgrupo_id", datos.subgrupo_id ?? null);
  set("categoria_jer_id", datos.categoria_jer_id ?? null);
  set("subcategoria_jer_id", datos.subcategoria_jer_id ?? null);
  set("marca_prod_id", datos.marca_prod_id ?? null);
  set("precio", datos.precio);
  set("precio_regular", datos.precio_regular);
  set("stock", datos.stock);
  if (!campos.length) return;
  vals.push(id);
  await db.query(`UPDATE productos SET ${campos.join(",")}, actualizado_en=NOW() WHERE id=$${vals.length}`, vals);
}

export async function setArticuloAtributos(producto_id, atributos) {
  const db = getPool();
  await db.query(`DELETE FROM producto_atributos WHERE producto_id=$1`, [producto_id]);
  for (const { atributo_id, valor_id, valor_num, valor_texto } of atributos) {
    if (!atributo_id) continue;
    await db.query(
      `INSERT INTO producto_atributos (producto_id, atributo_id, valor_id, valor_num, valor_texto) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [producto_id, atributo_id, valor_id || null, valor_num || null, valor_texto || null]
    );
  }
}

export async function setArticuloModelos(producto_id, modelo_ids) {
  const db = getPool();
  await db.query(`DELETE FROM producto_modelos WHERE producto_id=$1`, [producto_id]);
  for (const mid of (modelo_ids || [])) {
    await db.query(`INSERT INTO producto_modelos (producto_id, modelo_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [producto_id, mid]);
  }
}
