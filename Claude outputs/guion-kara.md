# Kara — PTY Rookies
### Guion de 5 minutos

En inglés, porque los jueces están en Louisville. Si lo quieres en español, dímelo y lo traduzco.

Lo que va **en negrita** es lo que dices. Lo que va entre corchetes son indicaciones, no se leen.

---

## 0:00 — El gancho

[No empieces con tu nombre ni con el equipo. Empieza con el problema.]

**Everyone in this room has one good story. The time you almost quit. The customer who cried. The thing you built at four in the morning.**

**And almost none of those stories will ever get written down. Not because they're not worth it — because nobody has ten minutes and the skill to pull it out of you.**

[Pausa de un segundo.]

---

## 0:25 — El giro

**Now, here's the thing we figured out early, and it changed what we built.**

**Turning a transcript into a blog post? That's the easy half. Any model does that today.**

[Pausa. Bajas la voz un poco.]

**Somebody still has to get the transcript. Somebody has to sit across from you and ask the right question at the right moment. That's the hard half.**

**Almost nobody can run an interview. So that's what we built.**

---

## 0:50 — Presentas a Kara

**Her name is Kara. She runs a ten-minute voice interview. She asks, you talk, and before you stand up you have publishable writing — a headline, a summary, pull quotes, social copy, and a PDF.**

**Everything I'm about to show you came out of real interviews we ran today. Nothing is staged.**

---

## 1:10 — La demo

[Ahora la demo es el centro de la presentación y tiene dos minutos. Que hable un juez si se anima; eso vale el doble que cualquier cosa que digas tú. Mientras corre, narra solo dos cosas y cállate el resto:]

**Watch what she does when he says something she can't verify.**

**And watch that she never asks the same question twice — she's reading the whole conversation, not the last line.**

[Si la demo se cae, no la pelees: ve al PLAN B del final y cuenta los tres momentos. Llenan este minuto con la misma fuerza.]

[Cuando termine la demo, una sola frase para cerrarla antes de seguir:]

**Everything she just did, she did by listening — not by following a script.**

---

## 3:15 — Por qué se puede confiar en lo que escribe

**Then it writes. And a second model fact-checks the draft against the tape — it cannot publish a claim the recording doesn't support.**

**We tested that with the hardest input there is: an interview where the subject answered nothing and only asked questions. It could have invented a story. Instead it wrote: "No story yet — the subject only asked questions."**

**A system that tells you when it has nothing is a system you can believe when it says it has something.**

---

## 4:00 — El registro público

**These go on a public wall with a real person's name on them, so the guardrails aren't decoration. Bad language gets one warning out loud — the second time, the interview is over, and the sentence that caused it is deleted from the transcript, the PDF, and the copy. And every subject chooses Private or On the Record out loud before anything is published.**

**We know that works because people spent all day trying to break it.**

---

## 4:25 — Cómo se hizo buena

[Esta es la sección que más peso gana con el número. Dilo despacio.]

**Last thing — and this is the part I'd want to know if I were you.**

**We didn't build this and demo it once. We put Kara in front of thirty different people today. Different accents. Different vocabularies. People who gave her one-word answers, people who wouldn't stop talking, people who answered in Spanish. People who were polite, and people who walked up specifically to insult her and see what she'd do.**

**Every rule she follows came out of one of those conversations going wrong.**

**She repeated a question — we caught it. She talked over someone who said they had to go — we fixed it. She flagged a polite question as abuse — we fixed that too, because that one was our fault, not theirs.**

**We didn't design an interviewer. We corrected one, thirty conversations deep, until it listened.**

---

## 4:50 — Cierre

**It's live right now. English and Spanish. Voice both ways. And it runs as an MCP tool inside Claude, so Claude does the editing while Kara does the asking.**

**We're PTY Rookies. Talk for ten minutes, leave with something worth publishing.**

[Punto. No agregues "gracias por su tiempo" ni pidas preguntas — déjalo cerrado.]

---

# Notas de ensayo

Ahora la demo es el centro y tiene dos minutos. Todo lo hablado son unas 550 palabras — poco menos de tres minutos a paso de presentación. Esa holgura es a propósito: una demo en vivo siempre tarda más de lo que ensayaste.

**Si vas largo,** corta la sección del registro público (4:00) entera. Es la única que puede salir sin que se note.

**Si vas corto,** alarga la demo. Nunca el discurso.

**Si la demo se cae,** vas al PLAN B del final. Está calculado para llenar exactamente ese hueco.

**La pausa después de *"that's the hard half"*** no es adorno. Es la que hace que todo lo que sigue aterrice. Si la saltas, el resto suena a lista de features.

**Las tres frases que tienen que salir perfectas:**

- *"Almost nobody can run an interview."*
- *"A system that tells you when it has nothing is a system you can believe when it says it has something."*
- *"We corrected one, thirty conversations deep, until it listened."*

Practícalas en voz alta hasta que no las tengas que leer. El resto lo puedes improvisar.

---

# Sobre el número de personas

**Di "we put her in front of thirty people", no "we trained her on thirty people".** No hicieron fine-tuning, y si dices "trained" el juez técnico pregunta con qué datos y te quedas sin piso. Lo que hicieron se llama desarrollo guiado por evaluación, y contado bien suena más serio, no menos.

**Usa el número que sea cierto.** Si fueron 22, di veintidós — un número raro suena a que lo contaste, un número redondo suena a que lo estimaste. Si no sabes cuántos fueron, di "dozens" y no lo inventes; si un juez pregunta y dudas, pierdes más de lo que ganas.

**La pregunta que quieres que te hagan es "¿qué se rompió?".** Ten estas tres listas, son las mejores que tienes:

- Le repitió tres veces la misma pregunta a una señora que estaba llorando. Ahí nació el detector de repetidas, que compara contra la entrevista entera y no solo contra los últimos turnos.
- Alguien dijo *"I have to go"* y ella preguntó otra cosa. Ahí nació la detección de salida.
- Alguien le preguntó *"can you answer my questions?"* y el filtro lo marcó como contenido inapropiado y casi cierra la entrevista. Ese fue error nuestro, no de la persona — y admitirlo en voz alta te hace ver mejor, no peor.

**Cuidado con los acentos.** Puedes decir que hablaron con ella gente muy distinta, y es verdad. No prometas que entiende cualquier acento: el reconocimiento de voz es del navegador, no es nuestro, y falla — a veces oye "Cara" cuando dicen "Kara". Si un juez lo prueba con acento cerrado y falla justo después de que prometiste lo contrario, pierdes credibilidad en todo lo demás. Reclama lo que es tuyo: **cómo reacciona Kara** a gente que responde en fragmentos, que divaga, que cambia de idioma, que la está probando.

---

# PLAN B — si la demo falla

[No la pelees en tarima. Cierras la ventana, dices *"let me just tell you what she did today instead"*, y cuentas esto. Llena el minuto y pico que ibas a usar demostrando.]

**Three moments from today.**

**One. A guy tells her he played defense, and drops Lionel Messi's name. A weak interviewer asks what it was like marking Messi — and gets a made-up answer. Kara asked: "did you ever *actually* mark someone like Messi?" He said no. So she asked who the toughest player really was. That one word — actually — is the difference between a real quote and a fantasy.**

**Two. Peter told her he had to leave. She stopped. No last question, no goodbye script — she thanked him and named three things he'd actually told her. The bike, his brother laughing, his grandmother's aloe vera.**

**Three, and this is my favorite. Earlier in that same interview, she asked if he had anything to add. He said "I want to continue." Most systems say thank you and close the door. Kara extended the clock and went straight back to the thread she'd left open — his brother. And she got this:**

[Lee la cita más lento.]

**"He actually laughed. And I started crying and stuff."**

**That line does not exist if she says goodbye.**

[Si solo te da tiempo de contar una, cuenta la tercera. Es la más fuerte de las tres por bastante.]
