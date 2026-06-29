# 🚀 crecimiento-ventas — skill portable de marketing/ventas

Carpeta **autocontenida y reutilizable** para ayudar a un comercio chico/mediano (e-commerce + local)
a **vender más**. Hecha para El Pasaje Dental, pero **portable a cualquier otro negocio**.

## Qué hay adentro
```
crecimiento-ventas/
├── SKILL.md                 ← el sistema: las 4 palancas, principios, workflow (entrada principal)
├── CONTEXTO-NEGOCIO.md      ← ⚙️ lo ÚNICO específico del negocio (se cambia al reusar)
├── plan-90-dias.md          ← roadmap accionable, qué hacer y en qué orden
├── metricas.md              ← qué medir y cómo (atribución con cupones)
├── playbooks/               ← tácticas paso a paso
│   ├── reactivacion.md      ← despertar clientes dormidos
│   ├── recompra.md          ← recurrencia de consumibles
│   ├── referidos.md         ← "traé un colega"
│   ├── prospeccion.md       ← base B2B de prospectos en frío
│   ├── instagram.md         ├ canales de
│   ├── whatsapp.md          ├ ejecución
│   ├── email.md             │
│   ├── seo-google.md        │
│   └── anuncios-presupuesto-chico.md
└── plantillas/              ← textos listos para copiar (con {{placeholders}})
    ├── whatsapp.md
    ├── email.md
    └── instagram.md
```

## Cómo se usa (en este proyecto)
1. Leé `SKILL.md` (el sistema) y `CONTEXTO-NEGOCIO.md` (el negocio).
2. Seguí `plan-90-dias.md`.
3. Para cada acción: abrí el `playbook/` y usá la `plantilla/`. Medí con `metricas.md`.

## Cómo REUTILIZARLA en otro proyecto/negocio
1. **Copiá la carpeta `crecimiento-ventas/`** al otro proyecto.
2. **Reescribí solo `CONTEXTO-NEGOCIO.md`** con los datos del nuevo negocio (identidad, público,
   canales, activos, tono, objetivo). **Nada más cambia** — playbooks y plantillas son genéricos.
3. (Opcional) Para usarla como *skill* de Claude Code: copiá la carpeta dentro de `.claude/skills/`
   del otro proyecto. El `SKILL.md` ya tiene el frontmatter (`name`, `description`) que la hace
   detectable e importable.
4. Ajustá los `{{PLACEHOLDERS}}` de las plantillas a la nueva marca.

## Filosofía
- **Vender a quien ya te compró es 5–7× más barato** que conseguir uno nuevo → empezá por ahí.
- **1 objetivo, 1 mensaje, 1 CTA** por campaña. Segmentá siempre.
- **No inventar** ofertas/precios: solo datos reales.
- **Medir con cupones** por campaña y **doblar lo que funciona**.

---
*Parte del proyecto El Pasaje Dental. Integra con: pestaña 📣 Campañas (email IA + Resend),
📸 Redes (posts), Cupones, base de clientes (WhatsApp normalizado) y avisos al cliente por WhatsApp.*
