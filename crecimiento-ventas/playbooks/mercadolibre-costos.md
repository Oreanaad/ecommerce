# 🛒 Vender en Mercado Libre Argentina — costos y cómo fijar precios

> **Datos a junio 2026.** Los montos cambian seguido por inflación → verificá siempre el **simulador
> oficial** en tu cuenta antes de fijar precios. Lo que NO cambia es la **estructura** (esto es lo
> importante de entender).

## 🔑 La idea que te faltaba: TODO gira alrededor de **$33.000**

El "costo fijo por unidad" que te complicaba **depende del PRECIO del producto**. Y hay un número mágico:

- **Producto < $33.000** → pagás **comisión % + un COSTO FIJO por unidad** (escalonado por precio). El envío es **opcional** (lo paga el comprador si no ofrecés gratis).
- **Producto ≥ $33.000** → **NO** pagás costo fijo, pero el **envío gratis es OBLIGATORIO** y lo **absorbés vos** (total o parcial según tu reputación).

O sea: por debajo de $33k te cobran un fijo; por encima, te "cobran" el envío. Por eso parecía que el costo fijo "dependía de algo raro": **dependía del precio.**

## ⚠️ Nota de exactitud (importante)
La **comisión exacta de tu categoría** (Salud/Instrumental odontológico) y el **costo fijo vigente** NO
son 100% públicos: las páginas oficiales de ML bloquean el acceso automático y **la comisión es
personalizada** (categoría + provincia + reputación). El **número exacto está en tu cuenta de ML**:
publicá o previsualizá **1 producto** y ML te muestra el "**costo de venta**" (comisión + fijo) real.
Con ese dato, en el módulo del panel (🛒 Precios ML) ajustás los campos y queda **clavado**.

Tabla de comisiones por categoría (referencia, mar-2026 — fuente: consultores ML):

| Categoría | Clásica | Premium |
|---|---|---|
| Hogar, Muebles y Jardín | 13,0% | 16,5% |
| Belleza y Cuidado Personal | 14,0% | 17,14% |
| Electrónica | 15,0% | 17,14% |
| Supermercado | 11,8% | 14,8% |
| "Otros" | 14,0% | 17,14% |
| **Salud / odontología** | *~13% (estimado, confirmar en tu cuenta)* | *~16,5%* |

## 1) Comisión por venta (%)
Va de **~11,8% a ~17,14%** del precio, según **categoría** + **tipo de publicación**:

| Tipo | Qué es | Comisión |
|------|--------|----------|
| **Clásica** | Exposición estándar, **sin** cuotas sin interés | la más baja (~12–15%) |
| **Premium** | Más exposición + **cuotas sin interés** al comprador | la más alta (~16–17%), ~3–4 puntos más que Clásica |

- Insumos de salud/odontología caen en categorías de comisión **media** (no es de las más caras como electrónica). Confirmá el % exacto de tu categoría en el simulador.
- **+ IVA 21%** sobre la comisión (y sobre el costo fijo). Para monotributista (tu caso) ese IVA **es costo real** → la comisión efectiva es **comisión × 1,21**. Ej: 13% → **15,73% real**.
- **+ Ingresos Brutos por provincia** (desde mediados de 2025 ajustan según tu domicilio fiscal). Tucumán suele estar en el rango medio.

## 2) Costo fijo por unidad (solo productos < $33.000)
Escalonado por precio (valores actuales aprox., **+ IVA**):

| Precio del producto | Costo fijo por unidad |
|---------------------|----------------------|
| Hasta $15.000 | ~$1.115 |
| $15.000 – $25.000 | ~$2.300 |
| $25.000 – $33.000 | ~$2.810 |
| **$33.000 o más** | **$0** (pero envío gratis obligatorio) |

> ⚠️ Esto **mata** la venta de cosas baratas: un costo fijo de $1.115 en un producto de $2.000 te come
> el 55%. **Solución:** no vendas baratijas sueltas en ML → armá **packs/combos** que superen los $33k
> (o al menos que el fijo pese poco).

## 3) Mercado Envíos (productos ≥ $33.000 → lo pagás vos)
- El costo depende de **peso/volumen** del paquete y de **tu reputación** (MercadoLíder y reputación
  verde tienen **descuento** en el envío; sin reputación, pagás el total).
- Rango típico: **$4.000–$9.000+** según tamaño/peso (insumos chicos y livianos, más barato).
- Mirá el costo **real** de envío de cada producto en la publicación (ML te lo muestra al publicar).

## 4) Costo por cuotas (si ofrecés Premium / cuotas sin interés)
Si el comprador paga en cuotas sin interés, ese costo se absorbe (ya viene en la comisión Premium, o
se suma si lo activás): 3 cuotas ~13% · 6 cuotas ~21% · 12 cuotas ~35%. Por eso Premium "cuesta más".

---

## 🧮 Fórmula para saber "a cuánto vender"

**Precio de venta = ( Costo del producto + Ganancia que querés + Extra ) ÷ ( 1 − Comisión efectiva )**

Donde:
- **Comisión efectiva** = comisión de tu categoría **× 1,21** (IVA). Ej: 13% → 0,1573.
- **Extra** = si el precio va a quedar **< $33.000** → el **costo fijo** del tramo (× 1,21).
  Si va a quedar **≥ $33.000** → el **costo de envío** que absorbés (× 1,21).

### Ejemplo A — producto barato (queda < $33k)
Costo $5.000 · querés ganar $3.000 · Clásica 13% (efectiva 15,73%) · costo fijo tramo bajo $1.115 (×1,21 = $1.349):
> Precio = (5.000 + 3.000 + 1.349) ÷ (1 − 0,1573) = 9.349 ÷ 0,8427 ≈ **$11.100**
> (queda < $15.000 → tramo correcto ✓). ML se queda ~$3.090; te quedan ~$8.000; ganancia ≈ $3.000 ✓

### Ejemplo B — producto caro (queda ≥ $33k, envío gratis)
Costo $40.000 · querés ganar $15.000 · Clásica 13% (efectiva 15,73%) · envío que absorbés ~$5.000 (×1,21 = $6.050):
> Precio = (40.000 + 15.000 + 6.050) ÷ (1 − 0,1573) = 61.050 ÷ 0,8427 ≈ **$72.450**

> Si es **Premium** (más comisión), cambiá 13% por el % premium (ej. 16,5% → efectiva 19,97% → dividís por 0,8003).

## 🎯 Tips de estrategia (importante para no perder plata)
1. **No vendas barato suelto.** Productos < ~$8–10k casi no dejan margen por el costo fijo. Armá **combos/packs**.
2. **Cuidado con la "zona muerta" cerca de $33.000.** Justo abajo pagás ~$2.810 de fijo; justo arriba pagás
   el envío entero (puede ser más caro). A veces conviene **subir bien por encima** (que el envío pese poco %)
   o **quedarte claramente abajo**. Calculá los dos.
3. **Reputación = plata.** Llegar a reputación **verde / MercadoLíder** te **baja el costo de envío** → más margen.
4. **Empezá con Clásica** (menos comisión). Pasá a **Premium** solo en productos donde las cuotas sin interés
   te hagan vender bastante más (electrónica/equipos caros), no en consumibles.
5. **Cargá el costo real en tu panel.** El sistema ya tiene **costo por producto** (lo ordenamos) → con eso
   y esta fórmula sabés el precio mínimo de ML para cada artículo.
6. **Mismo SKU = ID** (ya lo normalizamos) → facilita publicar y conciliar ML con tu stock.

## Para fijar precios rápido
Pedile al asistente: *"calculame el precio de ML para un producto que me cuesta $X, quiero ganar $Y,
publicación Clásica"* → aplica esta fórmula con los valores actuales.

---
### Fuentes (verificar montos exactos, cambian seguido)
- Mercado Libre oficial — [Costos de envíos gratis](https://www.mercadolibre.com.ar/ayuda/costos-envios-gratis_3482) · [Beneficio de envíos gratis](https://www.mercadolibre.com.ar/ayuda/como-funciona-beneficio-envios-gratis_4603) · [Costos de envío por reputación](https://www.mercadolibre.com.ar/ayuda/40538) · [Cambios envíos gratis mar-2026](https://www.mercadolibre.com.ar/ayuda/48578)
- [Algoritmo Digital — comisiones ML](https://algoritmodigital.com.ar/cuanto-es-la-comision-de-mercado-libre-por-vender/) · [SpomBridge — tabla comisiones 2026](https://app.spomsolutions.com/herramientas/comisiones-mercadolibre-2026) · [Base — costos de vender en ML AR](https://base.com/es-AR/blog/costos-ventas-mercado-libre-argentina/)
- **La fuente definitiva es el SIMULADOR de tu cuenta de ML** (toma tu categoría, provincia y reputación reales).
