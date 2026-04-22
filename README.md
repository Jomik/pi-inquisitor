# pi-inquisitor

Interactive form tool for [pi](https://github.com/mariozechner/pi-coding-agent). Ask the user structured questions with radio buttons and checkboxes — with inline AI elaboration.

## Why

LLMs ask users questions constantly — which framework, what database, deploy where. Plain-text questions produce sloppy answers: typos, ambiguity, the LLM guessing what "the second one" means. pi-inquisitor gives the LLM one tool (`ask_user`) that presents structured forms and returns clean, machine-readable results.

## Install

```bash
pi install npm:pi-inquisitor
```

Or try it without installing:

```bash
pi -e npm:pi-inquisitor
```

## How it works

The LLM calls `ask_user` with a list of questions. Each question is either `radio` (single-select) or `checkbox` (multi-select) with predefined options. The user picks from the options in an interactive TUI form and the result goes back to the LLM as plain text.

<!-- TODO: add a GIF showing the form in action -->

### Tool

```json
{
  "title": "Database choice",
  "questions": [
    {
      "id": "db",
      "type": "radio",
      "prompt": "Which database?",
      "options": [
        { "value": "postgres", "label": "PostgreSQL", "recommended": true },
        { "value": "sqlite", "label": "SQLite" },
        { "value": "mongo", "label": "MongoDB" }
      ]
    }
  ]
}
```

### Question types

| Type | Description |
|------|-------------|
| `radio` | Single-select. Enter picks the focused option. |
| `checkbox` | Multi-select. Space toggles, Enter advances. |

Every question gets an "Other..." option by default (`allowOther: true`) so the user can type a custom answer. Options support `description` (help text) and `recommended` (badge).

### Elaborate

Press **E** on any option to stream a terse AI-generated analysis inline:

```
Pros: <one sentence>
Cons: <one sentence>
Best when: <one sentence>
```

Uses the session's system prompt and full conversation history for context. One-shot per option, 15-second timeout.

### Navigation

| Key | Action |
|-----|--------|
| ↑/↓ | Navigate options |
| Tab / Shift+Tab, ←/→ | Switch questions (multi-question forms) |
| Space | Toggle checkbox / select radio |
| Enter | Select and advance (radio) / advance (checkbox) / submit (final tab) |
| A | Select all / deselect all (checkboxes) |
| E | Elaborate on focused option |
| Esc | Cancel form |
