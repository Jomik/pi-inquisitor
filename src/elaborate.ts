import type { Message } from "@mariozechner/pi-ai";
import type { NormalizedQuestion, QuestionOption } from "./types.js";

export function buildElaborationContext(
  sessionSystemPrompt: string,
  conversationMessages: Message[],
  question: NormalizedQuestion,
  option: QuestionOption,
): { systemPrompt: string; messages: Message[] } {
  const systemPrompt = `${sessionSystemPrompt}

---

The user is choosing between options and wants a quick elaboration on one.
Reply with EXACTLY this format, nothing else:

Pros: <one sentence>
Cons: <one sentence>
Best when: <one sentence>`;

  const userPrompt = `Question: "${question.prompt}"
Options: ${question.options.map((o) => o.label).join(", ")}
Elaborate on: "${option.label}"${option.description ? ` (${option.description})` : ""}`;

  const messages: Message[] = [
    ...conversationMessages,
    { role: "user", content: userPrompt, timestamp: Date.now() } as Message,
  ];

  return { systemPrompt, messages };
}
