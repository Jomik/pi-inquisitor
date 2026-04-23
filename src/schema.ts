import { StringEnum } from "@mariozechner/pi-ai";
import { Type } from "typebox";

const OptionSchema = Type.Object({
  value: Type.String({ description: "Value returned when selected" }),
  label: Type.String({ description: "Display label" }),
  description: Type.Optional(Type.String({ description: "Help text shown below the label" })),
  recommended: Type.Optional(
    Type.Boolean({
      description: "Show a '(recommended)' badge next to this option",
    }),
  ),
});

const QuestionSchema = Type.Object({
  id: Type.String({ description: "Unique identifier for this question" }),
  type: StringEnum(["radio", "checkbox"] as const, {
    description: "Question type: radio (single-select), checkbox (multi-select)",
  }),
  prompt: Type.String({ description: "The question text to display" }),
  label: Type.Optional(
    Type.String({
      description: "Short label for tab bar (defaults to Q1, Q2...)",
    }),
  ),
  options: Type.Array(OptionSchema, {
    description: "Options for radio/checkbox types",
    minItems: 2,
  }),
  allowOther: Type.Optional(
    Type.Boolean({
      description: "Add an 'Other...' option with text input (default: true for radio/checkbox)",
    }),
  ),
});

export const AskUserParams = Type.Object({
  title: Type.Optional(Type.String({ description: "Form title displayed at the top" })),
  description: Type.Optional(
    Type.String({
      description: "Brief context or instructions shown under the title",
    }),
  ),
  questions: Type.Array(QuestionSchema, {
    description: "One or more questions to ask. Use radio for single-select, checkbox for multi-select",
  }),
});
