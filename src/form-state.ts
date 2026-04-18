import { Key, matchesKey } from "@mariozechner/pi-tui";
import type { Answer, FormResult, NormalizedQuestion, QuestionOption } from "./types.js";

/**
 * Callback interface for effects that FormState cannot perform itself.
 * In production, these bridge to the TUI editor and render loop.
 * In tests, these are simple mocks.
 */
export interface FormDeps {
  getEditorText(): string;
  setEditorText(text: string): void;
  forwardToEditor(data: string): void;
  requestElaboration(q: NormalizedQuestion, opt: QuestionOption): void;
  refresh(): void;
  finish(result: FormResult): void;
}

/**
 * Pure state machine for the ask_user form.
 *
 * Holds all form state (answers, cursor, tabs, elaboration tracking)
 * and processes keyboard input. Side effects are dispatched via FormDeps.
 */
export class FormState {
  // ── Configuration (immutable) ────────────────────────────────────
  readonly questions: NormalizedQuestion[];
  readonly title?: string;
  readonly description?: string;
  readonly isMulti: boolean;
  readonly totalTabs: number;

  // ── Mutable state ────────────────────────────────────────────────
  currentTab = 0;
  cursorIdx = 0;
  otherMode = false;
  otherQuestionId: string | null = null;
  finished = false;
  scrollOffset = 0;

  // ── Answer stores ────────────────────────────────────────────────
  readonly radioAnswers = new Map<string, { value: string; label: string; wasCustom: boolean }>();
  readonly checkAnswers = new Map<string, Set<string>>();
  readonly checkCustom = new Map<string, string>();

  // ── Elaboration state ────────────────────────────────────────────
  readonly elaborations = new Map<string, string>();
  readonly elaborating = new Map<string, boolean>();
  spinnerFrame = 0;

  private readonly deps: FormDeps;

  constructor(questions: NormalizedQuestion[], params: { title?: string; description?: string }, deps: FormDeps) {
    this.questions = questions;
    this.title = params.title;
    this.description = params.description;
    this.isMulti = questions.length > 1;
    this.totalTabs = questions.length + (this.isMulti ? 1 : 0);
    this.deps = deps;
  }

  // ── Query methods ────────────────────────────────────────────────

  curQ(): NormalizedQuestion | undefined {
    return this.questions[this.currentTab];
  }

  optionCount(q: NormalizedQuestion): number {
    return q.options.length + (q.allowOther ? 1 : 0);
  }

  isAnswered(q: NormalizedQuestion): boolean {
    if (q.type === "radio") return this.radioAnswers.has(q.id);
    const set = this.checkAnswers.get(q.id);
    const custom = this.checkCustom.get(q.id);
    return (set != null && set.size > 0) || (custom != null && custom.trim().length > 0);
  }

  allAnswered(): boolean {
    return this.questions.every((q) => this.isAnswered(q));
  }

  elabKey(questionId: string, optionValue: string): string {
    return `${questionId}:${optionValue}`;
  }

  // ── Navigation ───────────────────────────────────────────────────

  private getNextTab(): number {
    if (this.currentTab < this.questions.length - 1) {
      return this.currentTab + 1;
    }
    return this.questions.length; // Submit tab
  }

  advanceTab() {
    if (!this.isMulti) {
      this.finishSubmit(false);
    } else {
      this.switchTab(this.getNextTab());
    }
  }

  switchTab(idx: number) {
    this.currentTab = ((idx % this.totalTabs) + this.totalTabs) % this.totalTabs;
    this.cursorIdx = 0;
    this.scrollOffset = 0;
    this.otherMode = false;
    this.otherQuestionId = null;
    this.deps.refresh();
  }

  saveOtherModeText() {
    if (!this.otherMode || !this.otherQuestionId) return;
    const t = this.deps.getEditorText().trim();
    const oq = this.questions.find((q) => q.id === this.otherQuestionId);
    if (oq?.type === "radio" && t) {
      this.radioAnswers.set(oq.id, { value: t, label: t, wasCustom: true });
    } else if (oq?.type === "checkbox" && t) {
      const set = this.checkAnswers.get(oq.id) ?? new Set();
      this.checkAnswers.set(oq.id, set);
      this.checkCustom.set(oq.id, t);
    }
    this.otherMode = false;
    this.otherQuestionId = null;
    this.deps.setEditorText("");
  }

  // ── Answer building ──────────────────────────────────────────────

  buildAnswers(): Answer[] {
    const answers: Answer[] = [];
    for (const q of this.questions) {
      if (q.type === "radio") {
        const a = this.radioAnswers.get(q.id);
        answers.push({
          id: q.id,
          type: "radio",
          value: a?.value ?? "",
          wasCustom: a?.wasCustom ?? false,
        });
      } else {
        const set = this.checkAnswers.get(q.id) ?? new Set();
        const custom = this.checkCustom.get(q.id)?.trim();
        const values = [...set];
        if (custom) values.push(custom);
        answers.push({
          id: q.id,
          type: "checkbox",
          value: values,
          wasCustom: !!custom,
        });
      }
    }
    return answers;
  }

  finishSubmit(cancelled: boolean) {
    if (this.finished) return;
    this.finished = true;
    this.deps.finish({
      title: this.title,
      description: this.description,
      questions: this.questions,
      answers: cancelled ? [] : this.buildAnswers(),
      cancelled,
    });
  }

  // ── Checkbox select all / deselect all ───────────────────────────

  toggleSelectAll() {
    const q = this.curQ();
    if (!q || q.type !== "checkbox") return;
    const set = this.checkAnswers.get(q.id) ?? new Set();
    const allSelected = q.options.every((o) => set.has(o.value));
    if (allSelected) {
      set.clear();
    } else {
      for (const o of q.options) set.add(o.value);
    }
    this.checkAnswers.set(q.id, set);
    this.deps.refresh();
  }

  // ── Input handling ───────────────────────────────────────────────

  handleInput(data: string) {
    if (this.finished) return;

    // "Other" editor mode
    if (this.otherMode) {
      if (matchesKey(data, Key.escape)) {
        this.otherMode = false;
        this.otherQuestionId = null;
        this.deps.setEditorText("");
        this.deps.refresh();
        return;
      }
      if (matchesKey(data, Key.enter)) {
        this.saveOtherModeText();
        this.advanceTab();
        return;
      }
      if (this.isMulti && (matchesKey(data, Key.tab) || matchesKey(data, Key.shift("tab")))) {
        this.saveOtherModeText();
        this.switchTab(this.currentTab + (matchesKey(data, Key.shift("tab")) ? -1 : 1));
        return;
      }
      this.deps.forwardToEditor(data);
      this.deps.refresh();
      return;
    }

    const q = this.curQ();

    // Submit tab (multi-question only)
    if (this.isMulti && this.currentTab === this.questions.length) {
      if (matchesKey(data, Key.enter)) {
        this.finishSubmit(false);
        return;
      }
      if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
        this.switchTab(0);
        return;
      }
      if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
        this.switchTab(this.currentTab - 1);
        return;
      }
      if (matchesKey(data, Key.escape)) {
        this.finishSubmit(true);
        return;
      }
      return;
    }

    if (!q) return;

    // Tab navigation (multi)
    if (this.isMulti) {
      if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
        this.switchTab(this.currentTab + 1);
        return;
      }
      if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
        this.switchTab(this.currentTab - 1);
        return;
      }
    }

    // Arrow navigation
    const total = this.optionCount(q);
    if (matchesKey(data, Key.up)) {
      this.cursorIdx = Math.max(0, this.cursorIdx - 1);
      this.deps.refresh();
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.cursorIdx = Math.min(total - 1, this.cursorIdx + 1);
      this.deps.refresh();
      return;
    }

    // Escape
    if (matchesKey(data, Key.escape)) {
      this.finishSubmit(true);
      return;
    }

    // Select all / deselect all (A key) — checkbox only
    if (q.type === "checkbox" && (data === "a" || data === "A")) {
      this.toggleSelectAll();
      return;
    }

    // Elaborate (E key)
    if (data === "e" || data === "E") {
      const otherIdx = q.allowOther ? q.options.length : -1;
      // Only elaborate on real options, not "Other..."
      if (this.cursorIdx < q.options.length && this.cursorIdx !== otherIdx) {
        const opt = q.options[this.cursorIdx];
        if (opt) {
          const key = this.elabKey(q.id, opt.value);
          if (!this.elaborating.get(key) && !this.elaborations.has(key)) {
            this.elaborating.set(key, true);
            this.elaborations.set(key, "");
            this.deps.refresh();
            this.deps.requestElaboration(q, opt);
          }
        }
      }
      return;
    }

    // Radio select (Enter or Space)
    if (q.type === "radio" && (matchesKey(data, Key.enter) || matchesKey(data, Key.space))) {
      const otherIdx = q.allowOther ? q.options.length : -1;
      if (q.allowOther && this.cursorIdx === otherIdx) {
        // "Other..."
        this.otherMode = true;
        this.otherQuestionId = q.id;
        const existing = this.radioAnswers.get(q.id);
        this.deps.setEditorText(existing?.wasCustom ? existing.label : "");
        this.deps.refresh();
        return;
      }
      const opt = q.options[this.cursorIdx];
      if (opt) {
        this.radioAnswers.set(q.id, {
          value: opt.value,
          label: opt.label,
          wasCustom: false,
        });
        this.advanceTab();
      }
      return;
    }

    // Checkbox toggle (space only)
    if (q.type === "checkbox" && matchesKey(data, Key.space)) {
      const otherIdx = q.allowOther ? q.options.length : -1;
      if (q.allowOther && this.cursorIdx === otherIdx) {
        // "Other..."
        this.otherMode = true;
        this.otherQuestionId = q.id;
        this.deps.setEditorText(this.checkCustom.get(q.id) ?? "");
        this.deps.refresh();
        return;
      }
      const opt = q.options[this.cursorIdx];
      if (opt) {
        const set = this.checkAnswers.get(q.id) ?? new Set();
        if (set.has(opt.value)) set.delete(opt.value);
        else set.add(opt.value);
        this.checkAnswers.set(q.id, set);
        this.deps.refresh();
      }
      return;
    }

    // Checkbox: Enter advances
    if (q.type === "checkbox" && matchesKey(data, Key.enter)) {
      this.advanceTab();
      return;
    }
  }
}
