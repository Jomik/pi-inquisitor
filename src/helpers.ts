import type { FormResult, NormalizedQuestion, Question } from "./types.js";

export function normalize(questions: Question[]): NormalizedQuestion[] {
  return questions.map((q, i) => ({
    ...q,
    label: q.label || `Q${i + 1}`,
    options: q.options || [],
    allowOther: q.allowOther !== false,
  }));
}

export function errorResult(msg: string): {
  content: { type: "text"; text: string }[];
  details: FormResult;
} {
  return {
    content: [{ type: "text", text: msg }],
    details: { questions: [], answers: [], cancelled: true },
  };
}

/**
 * Validate questions for structural issues.
 * Returns an error message string if invalid, or null if valid.
 */
export function validateQuestions(questions: Question[]): string | null {
  if (!questions.length) {
    return "Error: No questions provided";
  }

  // Check for at least 2 options on radio/checkbox
  for (const q of questions) {
    if (!q.options || q.options.length < 2) {
      return `Error: ${q.type} question "${q.id}" requires at least 2 options`;
    }
  }

  // Check for duplicate question IDs
  const ids = new Set<string>();
  for (const q of questions) {
    if (ids.has(q.id)) {
      return `Error: Duplicate question id "${q.id}"`;
    }
    ids.add(q.id);
  }

  return null;
}
