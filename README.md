# Prologue Interviewer

Un entrevistador agéntico que sí vale la pena. Automatiza el Discovery Audit de Prologue:
recibe una asignación editorial desde Claude, hace la entrevista en vivo por voz, y devuelve
el *context gap*, **the Nail** y contenido publicable.

**Bounty:** Prologue Stories LLC — "Build an interviewer worth talking to" ($250 + integración).

---

## La idea en una frase

**Claude es el editor, no el entrevistador.** Una conversación de voz de diez minutos necesita
turnos de menos de un segundo, así que Claude hace lo que hace un editor: reparte la asignación,
vigila cómo va, y recibe la copia terminada. La entrevista la corre el servidor.

```
Claude (MCP)  ──create_assignment──►  API  ──link──►  vendor abre /i/xxx y habla
     ▲                                 │
     └────generate_content─────────────┘
```

---

## Arrancar en 5 minutos

```bash
npm install
cp .env.example .env          # pega tu ANTHROPIC_API_KEY
npm start                     # http://localhost:8787
```

Al arrancar hace un *preflight*: si el id del modelo está mal te lo dice **ahí**, no cuando
tengas un vendor con micrófono enfrente. Si se queja, pon `ANTHROPIC_MODEL` en `.env` con uno
de los que te liste.

Prueba todo el ciclo sin micrófono ni humanos:

```bash
npm run simulate
```

Corre una entrevista completa contra un vendor ficticio (uno difícil, callado) e imprime cada
pregunta con el razonamiento detrás. Si persigue la línea de "nos quedaban $400 y la renta era $600"
y el detalle de las 4 de la mañana, el producto funciona.

---

## Conectarlo a Claude

`claude_desktop_config.json` (o `.mcp.json` en Claude Code):

```json
{
  "mcpServers": {
    "prologue-interviewer": {
      "command": "npx",
      "args": ["tsx", "/RUTA/ABSOLUTA/prologue-interviewer/mcp/server.ts"],
      "env": { "API_BASE": "http://localhost:8787" }
    }
  }
}
```

El servidor web tiene que estar corriendo. Herramientas que quedan disponibles:

| Tool | Qué hace |
|---|---|
| `create_assignment` | Briefea al entrevistador: a quién, el ángulo, qué necesitas on the record |
| `start_interview` | Abre la sala y te da el link que le pasas a la persona |
| `interview_status` | Cómo va: tiempo, beats cubiertos, últimos intercambios |
| `get_transcript` | Transcripción completa con el razonamiento de cada pregunta |
| `generate_content` | Context gap, the Nail, citas verbatim, y los entregables pedidos |
| `the_wall` | Todas las entrevistas terminadas con su Nail y mejor cita — **la lámina de prueba** |

---

## Dónde está el producto

En `src/interviewer.ts`, en la constante `CRAFT`. Ahí están las reglas de oficio:

- Una pregunta a la vez. Menos de 20 palabras. Las mejores tienen cinco.
- Qué pasó antes de cómo te sentiste.
- Si la respuesta es corta o abstracta, **no avanza** — pide el ejemplo.
- Si dicen algo cargado, repite sus propias dos o tres palabras como pregunta. La gente llena el silencio.
- Si te sorprenden, abandona el plan. Una sorpresa vale más que un beat cubierto.
- Nunca felicita la respuesta ("qué bueno", "me encanta") — hace que la gente actúe en vez de hablar.
- Al final: *"¿Qué debí haberte preguntado y no te pregunté?"* Casi siempre produce la cita.

Cualquiera mete una transcripción en un modelo y saca un blog. Lo que se está calificando es
si **escucha**. Todo lo demás es plomería.

En `src/content.ts` está el editor, con el método de Prologue codificado: primero el *context gap*,
luego **the Nail** (una frase, menos de 15 palabras), y las citas siempre verbatim.

---

## La jugada de las 24 horas

1. **Esta noche, food hall.** A cada vendor de Mashup: *"¿Te regalo un post de Instagram sobre tu
   negocio? Diez minutos, solo tienes que hablar."* Le pasas el QR desde la consola en `/`.
2. Cada entrevista terminada sale en **the wall** con su Nail y su mejor cita.
3. **En el escenario:** se lo aplicas a un juez 60 segundos en vivo, muestras la cita que produce,
   y cortas a la pared de vendors reales de anoche.

Graba un clip de 30 segundos de un vendor de verdad usándolo. Es seguro contra fallas de demo
**y** es evidencia literal de High Agency en la rúbrica.

---

## Bounties que se apilan gratis

- **ElevenLabs** (audífonos) — pon `ELEVENLABS_API_KEY` en `.env`. Sin key usa la voz del navegador
  y todo sigue funcionando, solo suena peor.
- **Vultr** (pantallas portátiles) — despliega ahí y pon `PUBLIC_BASE_URL` a la URL pública, así el
  link del QR funciona en el celular del vendor. **Esto hay que hacerlo antes de caminar el food hall.**
- **Swell** ($200) — es un "dupe" del Discovery Audit manual de una agencia, con la mejora de que
  corre en diez minutos en vez de dos semanas.

---

## Notas y trampas

- El reconocimiento de voz usa la Web Speech API → **usa Chrome**. Safari y Firefox no.
- El botón "Done answering" siempre funciona. Nunca dependas solo del silencio para cortar el turno.
- `?operator=1` en el link de la sala muestra el razonamiento en vivo. Úsalo en la demo, no con el vendor.
- El estado vive en `data/store.json`. No borres esa carpeta el sábado — es tu pared de prueba.
- Si vas a desplegar, HTTPS es obligatorio: el navegador no da micrófono en HTTP fuera de localhost.
