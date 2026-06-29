---
name: crear-skill
description: "Crea nuevas skills de Claude Code desde cero. Es la skill que hace skills. Usa esta skill cuando el usuario quiera crear su propia skill, automatizar un flujo de trabajo, hacer que Claude repita un proceso, crear un comando personalizado, o convertir algo que hace manualmente en algo automático. Triggers: 'crea una skill', 'quiero hacer una skill', 'skill personalizada', 'automatizar esto como skill', 'crear un comando para Claude Code', 'convierte esto en una skill', 'quiero que Claude siempre haga X', 'skill para Y'."
---

# Skill Creator — Crea tus propias skills

Le describes un proceso que quieres automatizar y Claude genera una skill completa lista para usar. Es la herramienta que crea herramientas.

Las skills de Claude Code son archivos `.md` que le enseñan a Claude a hacer tareas específicas. Cualquier proceso que hagas de forma repetitiva puede convertirse en una skill.

---

## Paso 1 — Entender qué necesita el usuario

Pregunta de forma conversacional:

- **¿Qué quieres que haga Claude automáticamente?** — describe el resultado que esperas
- **¿Qué información necesita recibir?** — URL, texto, carpeta, datos, archivo...
- **¿Qué debe generar?** — HTML, informe, archivo, código, dashboard...
- **¿Lo vas a usar tú o se lo vas a dar a otras personas?**

Si el usuario ya describió suficiente (ej: "una skill que lea un CSV de productos y genere fichas de producto en HTML"), diseña directamente.

Si no sabe qué skill crear, proponle ideas:

**Para negocios:**
- Generador de propuestas comerciales (datos del cliente → propuesta PDF/HTML profesional)
- Calculadora de presupuestos (servicio + horas → presupuesto detallado)
- Generador de contratos (datos → contrato personalizado)
- Creador de presentaciones de ventas (producto → slides HTML)
- Onboarding de clientes (datos → carpeta + emails + documentos)

**Para marketing:**
- Generador de copy para ads (producto + público → variantes de anuncios)
- Planificador de contenido (nicho → calendario de 30 días con ideas)
- Creador de emails de venta (producto → secuencia de emails)
- Generador de posts para redes (tema → posts para IG, LinkedIn, X)

**Para desarrollo:**
- Generador de APIs (modelo de datos → API completa)
- Documentador de código (repositorio → documentación)
- Generador de tests (código → suite de tests)
- Scaffolding de proyectos (tipo de proyecto → estructura completa)

**Para productividad:**
- Resumidor de documentos (PDF → resumen ejecutivo)
- Transcriptor de reuniones (notas → acta formal)
- Generador de SOPs (proceso → documento de procedimiento paso a paso)
- Analizador de datos (CSV → dashboard con insights)

---

## Paso 2 — Diseñar la skill

Antes de escribir, planifica la estructura:

1. **Input** — qué recibe la skill (qué pregunta al usuario)
2. **Proceso** — qué pasos sigue (en orden)
3. **Herramientas** — qué necesita usar (WebFetch, Bash, Playwright, Read, Write, herramientas nativas de Claude Code)
4. **Output** — qué genera y en qué formato
5. **Experiencia de usuario** — cómo se siente usarla (mensajes amigables, flujo conversacional)

### Principios de diseño de skills (aprendidos de nuestras 9 skills anteriores)

Estos principios son los que hacen que una skill sea realmente buena:

**1. No inventes datos** — si la skill necesita información del usuario (servicios, precios, contacto, testimonios), pregúntala. Nunca la inventes. Si algo no está disponible, usa placeholders visibles o omite la sección.

**2. Datos reales primero, preguntas después** — si la skill puede obtener datos automáticamente (scraping, WebFetch, WebSearch), hazlo primero. Solo pregunta lo que no puedes encontrar solo.

**3. Auto-instalación de dependencias** — si necesita Playwright, npm packages o cualquier herramienta, la skill debe instalarlas automáticamente. Avisa al usuario con un mensaje amigable ("Estoy preparando las herramientas, tarda 30 segundos la primera vez").

**4. Libertad creativa en diseño** — si genera HTML/dashboards, no dictes CSS rígido. Describe el resultado visual deseado y deja que Claude diseñe libremente. Esto produce resultados más bonitos y únicos.

**5. Adaptación al contexto** — si la skill sirve para diferentes sectores/tipos (como la de web que se adapta a restaurante vs gimnasio), incluye una guía de adaptación.

**6. Flujo conversacional** — la skill debe funcionar como una conversación natural, no como un formulario. Agrupa preguntas en 2-3 bloques, no hagas interrogatorios largos.

**7. Fallbacks amigables** — si algo falla (scraping, instalación, etc.), no te bloquees. Ofrece alternativa y sigue adelante.

**8. Mensaje de bienvenida** — si la skill va en un kit independiente con CLAUDE.md, incluye un mensaje de bienvenida que se active con cualquier input del usuario.

**9. Sin precios sugeridos** — no incluir "como servicio" ni precios al final del output.

**10. Presentar resultado claro** — al terminar, mostrar qué se generó, qué datos se usaron, qué falta por completar, y preguntar si quiere ajustar algo.

---

## Paso 3 — Escribir la skill

Genera el archivo `.md` con esta estructura:

```markdown
---
name: nombre-en-kebab-case
description: "Descripción completa de qué hace y cuándo activarse. Incluir múltiples frases trigger variadas. Ser específico pero cubrir sinónimos y formas diferentes de pedir lo mismo."
---

# Nombre de la Skill

Una línea describiendo qué hace en lenguaje simple.

**Regla fundamental: [la regla más importante de esta skill]**

---

## Paso 1 — [Recoger información / Entender qué necesita]

[Flujo conversacional para obtener los datos necesarios]
[Qué intentar obtener automáticamente primero]
[Qué preguntar si falta]

---

## Paso 2 — [Procesar / Analizar / Investigar]

[La lógica principal de la skill]
[Qué herramientas usar y cómo]
[Adaptación según contexto si aplica]

---

## Paso 3 — [Generar el resultado]

[Qué formato tiene el output]
[Estructura del contenido]
[Libertad creativa en diseño si es HTML]

---

## Paso 4 — [Guardar y presentar]

[Cómo nombrar el archivo]
[Abrirlo automáticamente si es HTML]
[Resumen de lo generado]
[Preguntar si quiere ajustar]
```

### Reglas del archivo generado

**Frontmatter:**
- `name` en kebab-case, sin espacios ni mayúsculas
- `description` con al menos 5-8 frases trigger diferentes
- La description debe cubrir sinónimos y variaciones

**Instrucciones:**
- Escritas en imperativo (haz, pregunta, genera)
- Auto-suficientes — funcionar sin que el usuario sepa programar
- Si necesita dependencias, incluir comando exacto de instalación
- Si necesita APIs, explicar cómo obtener la key

**Herramientas:**
- Preferir herramientas nativas de Claude Code (Read, Write, WebFetch, WebSearch, Bash)
- Evitar dependencias externas cuando sea posible
- Si necesita Python/Node, que sea lo mínimo y con auto-instalación

---

## Paso 4 — Instalar la skill

Después de generarla, instálala automáticamente:

```bash
mkdir -p .claude/skills
cp [nombre-skill].md .claude/skills/
```

Si el usuario quiere que la skill esté disponible en todos sus proyectos (no solo en esta carpeta):

```bash
mkdir -p ~/.claude/skills
cp [nombre-skill].md ~/.claude/skills/
```

---

## Paso 5 — Crear el kit (si el usuario quiere compartirla)

Si la skill va a ser usada por otras personas, genera un kit completo:

```
kit-[nombre]/
├── CLAUDE.md                    ← Mensaje de bienvenida + qué hace
├── INSTRUCCIONES.md             ← Guía paso a paso para instalar y usar
├── .claude/
│   └── skills/
│       └── [nombre].md          ← La skill
└── [carpetas extra si necesita] ← assets/, facturas/, etc.
```

**CLAUDE.md** debe incluir:
- Sección "Comportamiento al iniciar" con mensaje de bienvenida
- Qué hace la skill
- Qué necesita del usuario
- Que no necesita nada instalado (si es el caso)

**INSTRUCCIONES.md** debe incluir:
- Requisitos (Claude Code + lo que necesite)
- Pasos numerados desde abrir la carpeta hasta ver el resultado
- Estructura de archivos

---

## Paso 6 — Testear

Después de instalar:

1. Simula que eres un usuario nuevo y escribe una frase que debería activar la skill
2. Verifica que las instrucciones son claras y completas
3. Si genera archivos, verifica que funcionan
4. Ajusta si algo no fluye bien

---

## Paso 7 — Presentar al usuario

Muestra:
1. Nombre y ruta del archivo generado
2. Frases que la activan
3. Qué input necesita y qué output genera
4. Si se creó kit, listar los archivos del kit
5. Instrucciones para usarla
6. Pregunta si quiere ajustar algo

No muestres precios sugeridos ni consejos de venta.
