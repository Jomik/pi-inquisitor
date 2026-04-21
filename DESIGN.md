# pi-inquisitor Design

## Problem

LLMs ask users questions constantly — which framework, what database, deploy where. Plain-text questions in conversation produce sloppy answers: typos, ambiguity, the LLM guessing what "the second one" means. Worse, when users don't know the trade-offs between options, they leave the TUI to research — breaking flow and losing context.

We need a structured question tool that makes decisions fast, unambiguous, and informed.

## Principles

1. **Structured over free-form** — the tool exists for picking from options, not collecting prose. When the LLM needs free-form input, it asks in conversation. Two question types: radio (single-select) and checkbox (multi-select). Nothing else.
2. **Never trap the user** — every question has escape hatches by default. "Other..." with inline text input (`allowOther: true`). Skipping questions is always allowed. The user is never forced to pick a bad fit or cancel the entire form.
3. **Decide without leaving** — the elaborate feature (`E` key) streams Pros/Cons/Best-when analysis inline, using the session's full context. No tab-switching, no browser, no lost state.
4. **Clean signal back to the LLM** — results are machine-readable. Radio returns a string, checkbox returns a string array. Custom answers carry `wasCustom: true`. Skipped questions return `(none selected)`. The LLM never has to parse prose.
5. **Minimal surface** — one tool (`ask_user`), two question types, no configuration. The schema is the documentation.

## API Surface

### Tool

```
ask_user({
  title?: string,              // form title
  description?: string,        // context shown under title
  questions: [{
    id: string,                // unique identifier
    type: "radio" | "checkbox",
    prompt: string,            // question text
    label?: string,            // tab bar label (defaults to Q1, Q2...)
    options: [{               // at least 2 required
      value: string,
      label: string,
      description?: string,    // help text below label
      recommended?: boolean,   // badge
    }],
    allowOther?: boolean,      // "Other..." option (default: true)
  }],
})
```

Returns plain text to the LLM (one line per question, values comma-separated for checkboxes). Custom "Other..." answers are prefixed with `(wrote)` so the LLM knows the user typed their own value. A structured `FormResult` with full details is included for session reconstruction.

### Elaborate

Press `E` on a focused option. Streams a terse 3-line analysis:

```
Pros: <one sentence>
Cons: <one sentence>
Best when: <one sentence>
```

Uses the session's system prompt and full conversation history for context. One-shot per option — pressing `E` again is a no-op. 15-second timeout. All streams abort when the form closes.

### Navigation

| Key | Action |
|---|---|
| ↑/↓ | Navigate options |
| Tab / Shift+Tab, ←/→ | Switch questions (multi-question forms) |
| Space | Toggle checkbox / select radio |
| Enter | Select and advance (radio) / advance (checkbox) / submit (final tab) |
| A | Select all / deselect all (checkboxes) |
| E | Elaborate on focused option |
| Esc | Cancel form |
## Decisions

### No text question type

The tool is for structured selection — picking from concrete options with machine-readable results. Every question requires at least two predefined options. Free-form text belongs in conversation, where the LLM already handles it well. Adding a text type would expand the schema, add a rendering mode, and produce ambiguous results the LLM has to parse. Two types keep it simple.

### Escape hatches are structural, not opt-in

`allowOther` defaults to true. Skipping is always allowed. This is enforced in normalization, not left to the LLM's prompt discipline. When the LLM's options miss the mark, the user can say so — `wasCustom: true` or `(none selected)` gives clear signal back.

### Elaborate streams inline, not in a panel

Elaboration text appears directly below the option's label, not in a side panel or modal. This keeps the user's eye on the option list and avoids TUI complexity. The trade-off is vertical space — long elaborations push other options off-screen. Scroll indicators (↑/↓) mitigate this.

### One-shot elaboration

Each option can be elaborated exactly once. Re-pressing `E` is a no-op. This avoids redundant LLM calls and keeps the UI predictable — elaboration text is stable once rendered.

## Dependencies

| Package | Purpose |
|---|---|
| `@mariozechner/pi-coding-agent` | ExtensionAPI, tool registration |
| `@mariozechner/pi-tui` | Editor, Key, Text, theme utilities |
| `@mariozechner/pi-ai` | streamSimple, StringEnum, Message types |
| `@sinclair/typebox` | Parameter schema definitions |
