import { describe, expect, it } from "vitest";
import { errorResult, normalize, validateQuestions } from "../src/helpers.js";
import type { Question } from "../src/types.js";

describe("normalize", () => {
  it("fills in default label, options, allowOther", () => {
    const questions: Question[] = [
      { id: "q1", type: "radio", prompt: "Pick one", options: [] },
      { id: "q2", type: "checkbox", prompt: "Pick many", options: [] },
    ];
    const result = normalize(questions);

    expect(result[0].label).toBe("Q1");
    expect(result[0].options).toEqual([]);
    expect(result[0].allowOther).toBe(true);

    expect(result[1].label).toBe("Q2");
  });

  it("preserves explicit values", () => {
    const questions: Question[] = [
      {
        id: "q1",
        type: "radio",
        prompt: "Pick",
        label: "Custom",
        options: [{ value: "a", label: "A" }],
        allowOther: false,
      },
    ];
    const result = normalize(questions);

    expect(result[0].label).toBe("Custom");
    expect(result[0].options).toEqual([{ value: "a", label: "A" }]);
    expect(result[0].allowOther).toBe(false);
  });
});

describe("errorResult", () => {
  it("returns correct structure with text content and cancelled FormResult", () => {
    const result = errorResult("something went wrong");

    expect(result.content).toEqual([{ type: "text", text: "something went wrong" }]);
    expect(result.details).toEqual({
      questions: [],
      answers: [],
      cancelled: true,
    });
  });
});

describe("validateQuestions", () => {
  it("returns null for valid questions", () => {
    const questions: Question[] = [
      {
        id: "q1",
        type: "radio",
        prompt: "Pick one",
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ],
      },
    ];
    expect(validateQuestions(questions)).toBeNull();
  });

  it("returns error for empty array", () => {
    expect(validateQuestions([])).toBe("Error: No questions provided");
  });

  it("returns error for radio with fewer than 2 options", () => {
    const questions: Question[] = [
      {
        id: "q1",
        type: "radio",
        prompt: "Pick",
        options: [{ value: "a", label: "A" }],
      },
    ];
    expect(validateQuestions(questions)).toBe('Error: radio question "q1" requires at least 2 options');
  });

  it("returns error for checkbox with fewer than 2 options", () => {
    const questions: Question[] = [
      {
        id: "q1",
        type: "checkbox",
        prompt: "Pick",
        options: [{ value: "a", label: "A" }],
      },
    ];
    expect(validateQuestions(questions)).toBe('Error: checkbox question "q1" requires at least 2 options');
  });

  it("returns error for duplicate question IDs", () => {
    const questions: Question[] = [
      {
        id: "q1",
        type: "radio",
        prompt: "A",
        options: [
          { value: "a", label: "A" },
          { value: "b", label: "B" },
        ],
      },
      {
        id: "q1",
        type: "radio",
        prompt: "B",
        options: [
          { value: "c", label: "C" },
          { value: "d", label: "D" },
        ],
      },
    ];
    expect(validateQuestions(questions)).toBe('Error: Duplicate question id "q1"');
  });
});
