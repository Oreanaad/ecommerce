# El Pasaje Dental — Sistema de ubicaciones

Sistema para saber **dónde está cada producto** en el local, **recomendar** según el stock
disponible y **ubicar mercadería** que llega.

## Cómo abrirlo (lo más fácil)

Hacé **doble clic en `iniciar.command`**. Eso:
1. Actualiza el catálogo desde tu web (elpasajedental.com).
2. Abre el sistema en el navegador: **http://localhost:4321**

> La primera vez, macOS puede pedir permiso: clic derecho en `iniciar.command` → *Abrir* → *Abrir*.

Para cerrarlo, cerrá la ventana de la terminal que se abrió.

## Cómo usar la app

- **🔍 Buscar**: escribí nombre, código o marca. Cada producto muestra precio, stock, foto, descripción y **dónde está**. En productos con medidas (arcos NiTi, dientes), *Ver medidas* despliega cada variación con su stock. Botón *📍 Asignar ubicación* para decir en qué mueble va.
- **⚡ Carga rápida**: elegís mueble + estante/cajón y vas tipeando códigos (Enter por cada uno) → se asignan al instante. Ideal de a dos: uno dicta desde el estante, otro escribe.
- **💬 Preguntar**: chat con IA. Tus empleados preguntan en lenguaje natural ("¿qué tengo para pulir composite?", "¿dónde está X?") y responde usando tu stock; si falta info, busca en internet. *(Requiere API key de Claude — ver abajo.)*
- **🗄️ Muebles**: ves todos tus muebles y qué hay en cada estante/cajón. En cada lugar, *+ agregar producto* para ubicar algo ahí.
- **📷 Recibir mercadería**: se conecta en la siguiente etapa (por foto, con ayuda de Claude).

Filtros útiles: *Solo con stock* y *Solo ubicados*.

## Activar el chat 💬 (API key de Claude)

1. Entrá a https://console.anthropic.com → **API Keys** → creá una key (`sk-ant-...`).
2. En la carpeta `config/`, copiá `anthropic.json.ejemplo` como **`anthropic.json`** y pegá tu key.
3. Listo: la pestaña *💬 Preguntar* ya funciona. Cada consulta tiene un costo bajo (centavos); podés cambiar a un modelo más barato editando `"model"` a `"claude-haiku-4-5"`.

## Tareas con Claude (cuando necesitás "inteligencia")

Abrí esta carpeta en Claude Code y pedile, por ejemplo:
- "¿Dónde está la lima K 25 de endodoncia?"
- "Un cliente quiere algo para pulir composite, ¿qué tengo con stock y dónde está?"
- "Llegó esta mercadería" + foto → identifica los productos y sugiere a qué mueble asignarlos.

La skill `SKILL-ubicaciones.md` le explica a Claude cómo trabajar con tus datos.

## Estructura de archivos

```
config/woocommerce.json   Tus credenciales (privado, no se comparte)
data/catalogo.json        Productos sincronizados de WooCommerce
data/muebles.json         Tus muebles, estantes y cajones
data/ubicaciones.json     Qué producto está en cada lugar
scripts/sync.mjs          Actualiza el catálogo desde la web
app/                      La app web (servidor + interfaz)
iniciar.command           Doble clic para abrir todo
SKILL-ubicaciones.md      Instrucciones para Claude
```

## Notas importantes

- La conexión con WooCommerce es de **solo lectura**: el sistema nunca modifica tu web.
- El **stock numérico** se administra en WooCommerce; acá se ve actualizado al sincronizar.
- Las **ubicaciones** viven solo en este sistema (`data/ubicaciones.json`), no tocan tu web.
- Para actualizar el catálogo manualmente: `node scripts/sync.mjs`.

## Próximos pasos

1. Cargar las ubicaciones reales de cada producto (lo hacemos juntos, mueble por mueble).
2. Activar la recepción por foto.
3. Afinar la recomendación clínica con tu criterio de venta.
