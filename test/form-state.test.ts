import { describe, expect, it, vi } from "vitest";
import { type FormDeps, FormState } from "../src/form-state.js";
import type { FormResult, NormalizedQuestion } from "../src/types.js";

// ── Helpers ──────────────────────────────────────────────────────────

function makeDeps(): FormDeps & { results: FormResult[] } {
  const results: FormResult[] = [];
  return {
    results,
    getEditorText: vi.fn(() => ""),
    setEditorText: vi.fn(),
    forwardToEditor: vi.fn(),
    requestElaboration: vi.fn(),
    refresh: vi.fn(),
    finish: vi.fn((r: FormResult) => results.push(r)),
  };
}

const radioQ: NormalizedQuestion = {
  id: "color",
  type: "radio",
  prompt: "Pick a color",
  label: "Color",
  options: [
    { value: "red", label: "Red" },
    { value: "green", label: "Green" },
    { value: "blue", label: "Blue" },
  ],
  allowOther: false,
};

const radioQWithOther: NormalizedQuestion = {
  ...radioQ,
  id: "colorOther",
  allowOther: true,
};

const checkQ: NormalizedQuestion = {
  id: "fruits",
  type: "checkbox",
  prompt: "Pick fruits",
  label: "Fruits",
  options: [
    { value: "apple", label: "Apple" },
    { value: "banana", label: "Banana" },
    { value: "cherry", label: "Cherry" },
  ],
  allowOther: false,
};

const checkQWithOther: NormalizedQuestion = {
  ...checkQ,
  id: "fruitsOther",
  allowOther: true,
};

const optionalCheckQ: NormalizedQuestion = {
  id: "extras",
  type: "checkbox",
  prompt: "Pick extras?",
  label: "Extras",
  options: [
    { value: "sprinkles", label: "Sprinkles" },
    { value: "sauce", label: "Sauce" },
  ],
  allowOther: false,
};

function single(q: NormalizedQuestion, deps?: ReturnType<typeof makeDeps>) {
  const d = deps ?? makeDeps();
  return { fs: new FormState([q], {}, d), deps: d };
}

function multi(qs: NormalizedQuestion[], deps?: ReturnType<typeof makeDeps>) {
  const d = deps ?? makeDeps();
  return {
    fs: new FormState(qs, { title: "T", description: "D" }, d),
    deps: d,
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("FormState", () => {
  // ── a) Option navigation ──────────────────────────────────────

  describe("option navigation", () => {
    it("down arrow increments cursorIdx", () => {
      const { fs, deps } = single(radioQ);
      expect(fs.cursorIdx).toBe(0);
      fs.handleInput("\x1b[B"); // Down
      expect(fs.cursorIdx).toBe(1);
      fs.handleInput("\x1b[B");
      expect(fs.cursorIdx).toBe(2);
      expect(deps.refresh).toHaveBeenCalled();
    });

    it("up arrow decrements cursorIdx", () => {
      const { fs } = single(radioQ);
      fs.cursorIdx = 2;
      fs.handleInput("\x1b[A"); // Up
      expect(fs.cursorIdx).toBe(1);
    });

    it("clamps at lower bound (0)", () => {
      const { fs } = single(radioQ);
      fs.handleInput("\x1b[A"); // Up at 0
      expect(fs.cursorIdx).toBe(0);
    });

    it("clamps at upper bound (total - 1)", () => {
      const { fs } = single(radioQ);
      // 3 options, max idx = 2
      fs.handleInput("\x1b[B");
      fs.handleInput("\x1b[B");
      fs.handleInput("\x1b[B"); // already at 2
      expect(fs.cursorIdx).toBe(2);
    });

    it("counts allowOther as extra option", () => {
      const { fs } = single(radioQWithOther);
      // 3 options + Other = 4 total, max idx = 3
      fs.handleInput("\x1b[B");
      fs.handleInput("\x1b[B");
      fs.handleInput("\x1b[B");
      expect(fs.cursorIdx).toBe(3);
      fs.handleInput("\x1b[B"); // clamp
      expect(fs.cursorIdx).toBe(3);
    });
  });

  // ── b) Radio selection ────────────────────────────────────────

  describe("radio selection", () => {
    it("Enter selects option and stores in radioAnswers", () => {
      const { fs } = single(radioQ);
      fs.cursorIdx = 1; // Green
      fs.handleInput("\r"); // Enter
      expect(fs.radioAnswers.get("color")).toEqual({
        value: "green",
        label: "Green",
        wasCustom: false,
      });
      // single-question: advanceTab submits directly
      expect(fs.finished).toBe(true);
    });

    it("Enter on radio in multi-question form advances tab", () => {
      const { fs } = multi([radioQ, checkQ]);
      fs.handleInput("\r"); // select Red
      expect(fs.radioAnswers.get("color")).toEqual({
        value: "red",
        label: "Red",
        wasCustom: false,
      });
      expect(fs.currentTab).toBe(1);
      expect(fs.cursorIdx).toBe(0);
    });
  });

  // ── c) Checkbox toggle ────────────────────────────────────────

  describe("checkbox toggle", () => {
    it("Space toggles option into checkAnswers set", () => {
      const { fs, deps } = single(checkQ);
      fs.cursorIdx = 0; // Apple
      fs.handleInput(" "); // Space
      expect(fs.checkAnswers.get("fruits")?.has("apple")).toBe(true);
      expect(deps.refresh).toHaveBeenCalled();
    });

    it("Space toggles option out of checkAnswers set", () => {
      const { fs } = single(checkQ);
      fs.cursorIdx = 0;
      fs.handleInput(" "); // toggle on
      fs.handleInput(" "); // toggle off
      expect(fs.checkAnswers.get("fruits")?.has("apple")).toBe(false);
    });

    it("multiple options can be selected", () => {
      const { fs } = single(checkQ);
      fs.cursorIdx = 0;
      fs.handleInput(" "); // Apple
      fs.cursorIdx = 2;
      fs.handleInput(" "); // Cherry
      const set = fs.checkAnswers.get("fruits");
      expect(set).toBeDefined();
      expect(set.has("apple")).toBe(true);
      expect(set.has("cherry")).toBe(true);
      expect(set.has("banana")).toBe(false);
    });
  });

  // ── d) Tab switching ──────────────────────────────────────────

  describe("tab switching", () => {
    it("Tab moves to next tab in multi-question form", () => {
      const { fs } = multi([radioQ, checkQ]);
      fs.cursorIdx = 2;
      fs.handleInput("\t"); // Tab
      expect(fs.currentTab).toBe(1);
      expect(fs.cursorIdx).toBe(0);
    });

    it("Right arrow also moves to next tab", () => {
      const { fs } = multi([radioQ, checkQ]);
      fs.handleInput("\x1b[C"); // Right
      expect(fs.currentTab).toBe(1);
    });

    it("Shift+Tab moves to previous tab", () => {
      const { fs } = multi([radioQ, checkQ]);
      fs.handleInput("\t"); // go to tab 1
      fs.handleInput("\x1b[Z"); // Shift+Tab back
      expect(fs.currentTab).toBe(0);
    });

    it("Left arrow also moves to previous tab", () => {
      const { fs } = multi([radioQ, checkQ]);
      fs.handleInput("\t");
      fs.handleInput("\x1b[D"); // Left
      expect(fs.currentTab).toBe(0);
    });

    it("tab wraps around via modular arithmetic", () => {
      const { fs } = multi([radioQ, checkQ]);
      // totalTabs = 3 (2 questions + submit)
      expect(fs.totalTabs).toBe(3);
      fs.switchTab(3); // wraps to 0
      expect(fs.currentTab).toBe(0);
    });

    it("Tab is not available in single-question form", () => {
      const { fs } = single(radioQ);
      fs.cursorIdx = 1;
      fs.handleInput("\t");
      // cursorIdx should stay — Tab has no effect on single radio
      // (it doesn't match any handler, so falls through)
      expect(fs.currentTab).toBe(0);
    });

    it("cursorIdx resets to 0 on tab switch", () => {
      const { fs } = multi([radioQ, checkQ]);
      fs.cursorIdx = 2;
      fs.handleInput("\t");
      expect(fs.cursorIdx).toBe(0);
    });
  });

  // ── e) Other... flow ──────────────────────────────────────────

  describe("Other... flow", () => {
    it("Enter on Other row enters otherMode (radio)", () => {
      const { fs, deps } = single(radioQWithOther);
      fs.cursorIdx = 3; // Other... (index = options.length)
      fs.handleInput("\r");
      expect(fs.otherMode).toBe(true);
      expect(fs.otherQuestionId).toBe("colorOther");
      expect(deps.setEditorText).toHaveBeenCalledWith("");
    });

    it("Escape exits otherMode without saving", () => {
      const { fs, deps } = single(radioQWithOther);
      fs.cursorIdx = 3;
      fs.handleInput("\r"); // enter otherMode
      fs.handleInput("\x1b"); // Escape
      expect(fs.otherMode).toBe(false);
      expect(fs.otherQuestionId).toBeNull();
      expect(deps.setEditorText).toHaveBeenLastCalledWith("");
    });

    it("Enter in otherMode saves radio custom answer and advances", () => {
      const deps = makeDeps();
      (deps.getEditorText as ReturnType<typeof vi.fn>).mockReturnValue("Purple");
      const { fs } = single(radioQWithOther, deps);
      fs.cursorIdx = 3;
      fs.handleInput("\r"); // enter otherMode
      fs.handleInput("\r"); // confirm
      expect(fs.radioAnswers.get("colorOther")).toEqual({
        value: "Purple",
        label: "Purple",
        wasCustom: true,
      });
      expect(fs.otherMode).toBe(false);
    });

    it("Space on checkbox Other row enters otherMode", () => {
      const { fs } = single(checkQWithOther);
      fs.cursorIdx = 3; // Other...
      fs.handleInput(" ");
      expect(fs.otherMode).toBe(true);
      expect(fs.otherQuestionId).toBe("fruitsOther");
    });

    it("Enter in otherMode saves checkbox custom answer", () => {
      const deps = makeDeps();
      (deps.getEditorText as ReturnType<typeof vi.fn>).mockReturnValue("Mango");
      const { fs } = single(checkQWithOther, deps);
      fs.cursorIdx = 3;
      fs.handleInput(" "); // enter otherMode
      fs.handleInput("\r"); // confirm
      expect(fs.checkCustom.get("fruitsOther")).toBe("Mango");
      expect(fs.otherMode).toBe(false);
    });

    it("Tab in otherMode saves and switches tab (multi)", () => {
      const deps = makeDeps();
      (deps.getEditorText as ReturnType<typeof vi.fn>).mockReturnValue("Teal");
      const { fs } = multi([radioQWithOther, checkQ], deps);
      fs.cursorIdx = 3;
      fs.handleInput("\r"); // enter otherMode
      fs.handleInput("\t"); // Tab to next
      expect(fs.otherMode).toBe(false);
      expect(fs.radioAnswers.get("colorOther")).toEqual({
        value: "Teal",
        label: "Teal",
        wasCustom: true,
      });
      expect(fs.currentTab).toBe(1);
    });
  });

  // ── f) Default value initialization ───────────────────────────
  // ── g) Submission and cancellation ────────────────────────────

  describe("submission and cancellation", () => {
    it("finishSubmit(false) builds answers and calls deps.finish", () => {
      const { fs, deps } = single(radioQ);
      fs.radioAnswers.set("color", {
        value: "red",
        label: "Red",
        wasCustom: false,
      });
      fs.finishSubmit(false);
      expect(fs.finished).toBe(true);
      expect(deps.finish).toHaveBeenCalledTimes(1);
      const result = deps.results[0];
      expect(result.cancelled).toBe(false);
      expect(result.answers).toHaveLength(1);
      expect(result.answers[0]).toEqual({
        id: "color",
        type: "radio",
        value: "red",
        wasCustom: false,
      });
    });

    it("finishSubmit(true) sends empty answers with cancelled:true", () => {
      const { fs, deps } = single(radioQ);
      fs.finishSubmit(true);
      expect(fs.finished).toBe(true);
      const result = deps.results[0];
      expect(result.cancelled).toBe(true);
      expect(result.answers).toEqual([]);
    });

    it("finishSubmit is idempotent (second call is no-op)", () => {
      const { fs, deps } = single(radioQ);
      fs.finishSubmit(false);
      fs.finishSubmit(false);
      expect(deps.finish).toHaveBeenCalledTimes(1);
    });

    it("Escape triggers cancellation on radio question", () => {
      const { fs, deps } = single(radioQ);
      fs.handleInput("\x1b");
      expect(fs.finished).toBe(true);
      expect(deps.results[0].cancelled).toBe(true);
    });

    it("buildAnswers includes checkbox with custom value", () => {
      const { fs } = single(checkQ);
      fs.checkAnswers.set("fruits", new Set(["apple"]));
      const _q2: NormalizedQuestion = { ...checkQWithOther, id: "fruits" };
      // Directly set checkCustom to simulate Other input
      fs.checkCustom.set("fruits", "Mango");
      const answers = fs.buildAnswers();
      expect(answers[0].value).toEqual(["apple", "Mango"]);
      expect(answers[0].wasCustom).toBe(true);
    });
  });

  // ── h) Required field validation ──────────────────────────────

  // ── i) Select all / deselect all ──────────────────────────────

  describe("select all / deselect all", () => {
    it("'a' key selects all checkbox options", () => {
      const { fs } = single(checkQ);
      fs.handleInput("a");
      const set = fs.checkAnswers.get("fruits");
      expect(set).toBeDefined();
      expect(set.has("apple")).toBe(true);
      expect(set.has("banana")).toBe(true);
      expect(set.has("cherry")).toBe(true);
    });

    it("'a' key deselects all when all are already selected", () => {
      const { fs } = single(checkQ);
      fs.handleInput("a"); // select all
      fs.handleInput("a"); // deselect all
      const set = fs.checkAnswers.get("fruits");
      expect(set).toBeDefined();
      expect(set.size).toBe(0);
    });

    it("'A' key also works (case insensitive)", () => {
      const { fs } = single(checkQ);
      fs.handleInput("A");
      expect(fs.checkAnswers.get("fruits")?.size).toBe(3);
    });

    it("'a' key is no-op on radio question", () => {
      const { fs, deps } = single(radioQ);
      const refreshCountBefore = (deps.refresh as ReturnType<typeof vi.fn>).mock.calls.length;
      fs.handleInput("a");
      // falls through without calling toggleSelectAll or refresh for 'a'
      const refreshCountAfter = (deps.refresh as ReturnType<typeof vi.fn>).mock.calls.length;
      expect(refreshCountAfter).toBe(refreshCountBefore);
    });
  });

  // ── j) Elaborate ──────────────────────────────────────────────

  describe("elaborate", () => {
    it("'e' key calls deps.requestElaboration for radio option", () => {
      const { fs, deps } = single(radioQ);
      fs.cursorIdx = 1; // Green
      fs.handleInput("e");
      expect(deps.requestElaboration).toHaveBeenCalledWith(radioQ, radioQ.options[1]);
      expect(fs.elaborating.get("color:green")).toBe(true);
    });

    it("'e' key calls deps.requestElaboration for checkbox option", () => {
      const { fs, deps } = single(checkQ);
      fs.cursorIdx = 0; // Apple
      fs.handleInput("e");
      expect(deps.requestElaboration).toHaveBeenCalledWith(checkQ, checkQ.options[0]);
    });

    it("'e' key is no-op on Other row", () => {
      const { fs, deps } = single(radioQWithOther);
      fs.cursorIdx = 3; // Other...
      fs.handleInput("e");
      expect(deps.requestElaboration).not.toHaveBeenCalled();
    });

    it("'e' key is no-op on already-elaborated option", () => {
      const { fs, deps } = single(radioQ);
      fs.cursorIdx = 0;
      fs.elaborations.set("color:red", "Some elaboration");
      fs.handleInput("e");
      expect(deps.requestElaboration).not.toHaveBeenCalled();
    });

    it("'e' key is no-op on currently-elaborating option", () => {
      const { fs, deps } = single(radioQ);
      fs.cursorIdx = 0;
      fs.elaborating.set("color:red", true);
      fs.elaborations.set("color:red", ""); // in-progress marker
      fs.handleInput("e");
      expect(deps.requestElaboration).not.toHaveBeenCalled();
    });
  });

  // ── k) Confirmation flow ──────────────────────────────────────
  describe("submission flow", () => {
    it("single-question: Enter selects and submits directly", () => {
      const { fs, deps } = single(radioQ);
      fs.cursorIdx = 0;
      fs.handleInput("\r"); // Select Red → advanceTab → finishSubmit
      expect(fs.finished).toBe(true);
      expect(deps.results[0].cancelled).toBe(false);
    });

    it("multi-question: Enter on submit tab submits directly when all answered", () => {
      const { fs } = multi([radioQ, optionalCheckQ]);
      fs.radioAnswers.set("color", {
        value: "red",
        label: "Red",
        wasCustom: false,
      });
      const set = new Set<string>();
      set.add("sprinkles");
      fs.checkAnswers.set("extras", set);
      fs.switchTab(2);
      fs.handleInput("\r");
      expect(fs.finished).toBe(true);
    });

    it("multi-question: Enter on submit tab submits even with unanswered questions", () => {
      const { fs, deps } = multi([radioQ, optionalCheckQ]);
      fs.switchTab(2);
      fs.handleInput("\r");
      expect(fs.finished).toBe(true);
      expect(deps.results[0].cancelled).toBe(false);
    });
  });

  // ── l) finished guard ─────────────────────────────────────────

  describe("finished guard", () => {
    it("handleInput is no-op when finished=true", () => {
      const { fs, deps } = single(radioQ);
      fs.finishSubmit(true);
      const callsBefore = (deps.refresh as ReturnType<typeof vi.fn>).mock.calls.length;
      fs.handleInput("\r");
      fs.handleInput("\x1b[B");
      fs.handleInput(" ");
      const callsAfter = (deps.refresh as ReturnType<typeof vi.fn>).mock.calls.length;
      expect(callsAfter).toBe(callsBefore);
    });
  });

  // ── Constructor / metadata ────────────────────────────────────

  describe("constructor", () => {
    it("single question: isMulti=false, totalTabs=1", () => {
      const { fs } = single(radioQ);
      expect(fs.isMulti).toBe(false);
      expect(fs.totalTabs).toBe(1);
    });

    it("multi question: isMulti=true, totalTabs = questions.length + 1", () => {
      const { fs } = multi([radioQ, checkQ]);
      expect(fs.isMulti).toBe(true);
      expect(fs.totalTabs).toBe(3);
    });

    it("stores title and description", () => {
      const { fs } = multi([radioQ]);
      expect(fs.title).toBe("T");
      expect(fs.description).toBe("D");
    });
  });

  // ── Submit tab navigation (multi) ─────────────────────────────

  describe("submit tab navigation (multi)", () => {
    it("Tab on submit tab wraps to first question", () => {
      const { fs } = multi([radioQ, checkQ]);
      fs.switchTab(2); // submit tab
      fs.handleInput("\t");
      expect(fs.currentTab).toBe(0);
    });

    it("Shift+Tab on submit tab goes to last question", () => {
      const { fs } = multi([radioQ, checkQ]);
      fs.switchTab(2);
      fs.handleInput("\x1b[Z");
      expect(fs.currentTab).toBe(1);
    });

    it("Escape on submit tab cancels", () => {
      const { fs, deps } = multi([radioQ, checkQ]);
      fs.switchTab(2);
      fs.handleInput("\x1b");
      expect(fs.finished).toBe(true);
      expect(deps.results[0].cancelled).toBe(true);
    });
  });

  // ── Checkbox Enter advances tab ───────────────────────────────

  describe("checkbox Enter advances", () => {
    it("Enter on checkbox question advances tab", () => {
      const { fs } = single(checkQ);
      fs.handleInput("\r");
      expect(fs.finished).toBe(true);
    });
  });
});
