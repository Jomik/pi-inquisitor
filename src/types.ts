export interface QuestionOption {
  value: string;
  label: string;
  description?: string;
  recommended?: boolean;
}

export interface Question {
  id: string;
  type: "radio" | "checkbox";
  prompt: string;
  label?: string;
  options: QuestionOption[];
  allowOther?: boolean;
}

export interface NormalizedQuestion extends Question {
  label: string;
  options: QuestionOption[];
  allowOther: boolean;
}

export interface Answer {
  id: string;
  type: "radio" | "checkbox";
  value: string | string[];
  wasCustom: boolean;
}

export interface FormResult {
  title?: string;
  description?: string;
  questions: NormalizedQuestion[];
  answers: Answer[];
  cancelled: boolean;
}
