import type { Message } from "@mariozechner/pi-ai";
import { describe, expect, it } from "vitest";
import { buildElaborationContext } from "../src/elaborate.js";
import type { NormalizedQuestion, QuestionOption } from "../src/types.js";

const baseQuestion: NormalizedQuestion = {
  id: "q1",
  type: "radio",
  prompt: "Which framework?",
  label: "Q1",
  options: [
    { value: "react", label: "React" },
    { value: "vue", label: "Vue" },
    { value: "svelte", label: "Svelte" },
  ],
  allowOther: true,
};

const sessionPrompt = "You are a helpful assistant.";

const conversationMessages = [
  { role: "user", content: "Help me pick a framework", timestamp: 1000 },
  {
    role: "assistant",
    content: "Sure, here are some options",
    timestamp: 2000,
  },
] as unknown as Message[];

describe("buildElaborationContext", () => {
  it("returns system prompt with session prompt + elaboration instructions", () => {
    const option: QuestionOption = { value: "react", label: "React" };
    const { systemPrompt } = buildElaborationContext(sessionPrompt, conversationMessages, baseQuestion, option);

    expect(systemPrompt).toContain(sessionPrompt);
    expect(systemPrompt).toContain("quick elaboration");
  });

  it("returns messages with conversation messages + final user message", () => {
    const option: QuestionOption = { value: "react", label: "React" };
    const { messages } = buildElaborationContext(sessionPrompt, conversationMessages, baseQuestion, option);

    expect(messages.length).toBe(3);
    expect(messages[0]).toEqual(conversationMessages[0]);
    expect(messages[1]).toEqual(conversationMessages[1]);
    expect(messages[2].role).toBe("user");
  });

  it("user message contains question prompt, all option labels, and target option", () => {
    const option: QuestionOption = { value: "vue", label: "Vue" };
    const { messages } = buildElaborationContext(sessionPrompt, conversationMessages, baseQuestion, option);
    const userMsg = messages[2].content as string;

    expect(userMsg).toContain("Which framework?");
    expect(userMsg).toContain("React");
    expect(userMsg).toContain("Vue");
    expect(userMsg).toContain("Svelte");
    expect(userMsg).toContain('Elaborate on: "Vue"');
  });

  it("user message includes option description when present", () => {
    const option: QuestionOption = {
      value: "react",
      label: "React",
      description: "A UI library by Meta",
    };
    const { messages } = buildElaborationContext(sessionPrompt, conversationMessages, baseQuestion, option);
    const userMsg = messages[2].content as string;

    expect(userMsg).toContain("A UI library by Meta");
  });

  it("user message omits description parenthetical when absent", () => {
    const option: QuestionOption = { value: "react", label: "React" };
    const { messages } = buildElaborationContext(sessionPrompt, conversationMessages, baseQuestion, option);
    const userMsg = messages[2].content as string;

    expect(userMsg).not.toContain("(");
  });

  it("system prompt contains exact Pros/Cons/Best-when format instructions", () => {
    const option: QuestionOption = { value: "react", label: "React" };
    const { systemPrompt } = buildElaborationContext(sessionPrompt, conversationMessages, baseQuestion, option);

    expect(systemPrompt).toContain("Pros:");
    expect(systemPrompt).toContain("Cons:");
    expect(systemPrompt).toContain("Best when:");
  });
});
