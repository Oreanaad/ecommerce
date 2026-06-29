# Cómo usar este kit

## Requisitos

1. **Visual Studio Code** instalado (descarga en https://code.visualstudio.com)
2. **Extensión de Claude Code** instalada desde el marketplace de VS Code (busca "Claude Code" en extensiones)

## Paso 1 — Abrir este proyecto

1. Abre VS Code
2. Archivo → Abrir carpeta → selecciona esta carpeta (`kit-skill-creator`)
3. Abre Claude Code desde el panel lateral de VS Code

## Paso 2 — Describir tu skill

Escribe algo como:

> "Crea una skill que lea un CSV de productos y genere fichas de producto en HTML"

> "Quiero una skill que analice un perfil de LinkedIn y genere un informe de marca personal"

> "Skill para generar presupuestos automáticos a partir de datos del cliente"

Claude te hará preguntas sobre los detalles y generará la skill completa.

## Paso 3 — Instalar la skill

Claude instala la skill automáticamente en `.claude/skills/`. Para usarla, simplemente describe lo que necesitas en Claude Code y la skill se activará.

## Paso 4 — Compartir (opcional)

Si quieres que otras personas usen tu skill, Claude puede generar un kit completo con instrucciones para que cualquiera la instale y use.

## Estructura

```
kit-skill-creator/
├── CLAUDE.md                         <- Claude lo lee automáticamente
├── INSTRUCCIONES.md                  <- Este archivo
└── .claude/
    └── skills/
        └── 10-skill-creator.md       <- La skill
```
