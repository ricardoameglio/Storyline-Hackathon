import type { InterviewType, Language } from "./types.ts";

const styles = {
  career: {
    en: ["Explore their career choices, transitions, challenges, mentors and growth.", "A defining career decision", "A challenge and what it taught them", "People who shaped their path", "How their perspective changed"],
    es: ["Explora sus decisiones profesionales, transiciones, desafíos, mentores y crecimiento.", "Una decisión profesional importante", "Un desafío y lo que aprendió", "Personas que marcaron su camino", "Cómo cambió su perspectiva"],
  },
  founder: {
    en: ["Explore how the business began: the problem, first customers, failures, pivots and breakthroughs.", "The specific moment the idea began", "The problem and first customers", "A failure or pivot", "A breakthrough and what changed"],
    es: ["Explora cómo nació el negocio: el problema, primeros clientes, fracasos, cambios y avances.", "El momento en que nació la idea", "El problema y los primeros clientes", "Un fracaso o cambio de rumbo", "Un avance y lo que cambió"],
  },
  personal: {
    en: ["Explore meaningful life experiences, relationships, challenges, motivations and personal change.", "A meaningful moment in their life", "The people who mattered", "A challenge and how they changed", "What the experience means to them now"],
    es: ["Explora experiencias de vida, relaciones, desafíos, motivaciones y cambios personales.", "Un momento significativo de su vida", "Las personas que importaron", "Un desafío y cómo cambió", "Lo que significa esa experiencia ahora"],
  },
  expert: {
    en: ["Explore their expertise, opinions, misconceptions, trends and practical lessons through concrete examples.", "An insight people often miss", "A misconception and a concrete example", "A change they see in their field", "A practical lesson others can use"],
    es: ["Explora sus conocimientos, opiniones, ideas equivocadas, tendencias y lecciones prácticas con ejemplos concretos.", "Una idea que otros suelen pasar por alto", "Una idea equivocada y un ejemplo concreto", "Un cambio que observa en su campo", "Una lección práctica para otros"],
  },
};

export function parseInterviewType(value: unknown): InterviewType | undefined {
  return typeof value === "string" && Object.hasOwn(styles, value) ? value as InterviewType : undefined;
}

export function interviewStyle(type: InterviewType, language?: Language) {
  const [angle, ...beats] = styles[type][language === "es" ? "es" : "en"];
  return { angle, beats };
}
