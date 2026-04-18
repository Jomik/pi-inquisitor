/**
 * pi-inquisitor — Interactive form tool for pi
 *
 * Registers the `ask_user` tool that the LLM can call to ask the user
 * one or more questions using rich form controls: radio buttons
 * and checkboxes.
 *
 * Question types:
 *   - radio:    Single-select from options
 *   - checkbox: Multi-select from options (pick all that apply)
 *
 * Each radio/checkbox question can include an "Other..." option that
 * lets the user type a custom answer.
 *
 * Elaborate:
 *   - Press E on any radio/checkbox option to request an AI-generated
 *     elaboration with trade-offs. The elaboration streams into the
 *     option's description area while the UI stays open.
 *
 * Navigation:
 *   - Tab / Shift+Tab to move between questions
 *   - Up/Down to navigate options within a question
 *   - Space to toggle checkboxes
 *   - A to select all / deselect all checkboxes
 *   - Enter to select radio / advance
 *   - E to elaborate on the focused option
 *   - Esc to cancel
 */

import type { Message, SimpleStreamOptions } from "@mariozechner/pi-ai";
import { streamSimple } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ThemeColor } from "@mariozechner/pi-coding-agent";
import { Editor, type EditorTheme, Text, truncateToWidth, visibleWidth, wrapTextWithAnsi } from "@mariozechner/pi-tui";

import { buildElaborationContext } from "./elaborate.js";
import type { FormDeps } from "./form-state.js";
import { FormState } from "./form-state.js";
import { errorResult, normalize, validateQuestions } from "./helpers.js";
import { AskUserParams } from "./schema.js";
import { SYM } from "./symbols.js";
import type { FormResult, NormalizedQuestion, Question } from "./types.js";

// ─── Scroll helpers ──────────────────────────────────────────────────────────

function getViewportHeight(): number {
  // Reserve 2 lines for status bar / margins
  return (process.stdout.rows || 24) - 2;
}

function applyScroll(
  allLines: string[],
  cursorLine: number,
  scrollOffset: number,
  viewportHeight: number,
  width: number,
  theme: { fg: (color: ThemeColor, s: string) => string },
): { lines: string[]; newOffset: number } {
  if (allLines.length <= viewportHeight) {
    return { lines: allLines, newOffset: 0 };
  }

  let offset = scrollOffset;

  // Adjust offset to keep cursor visible
  if (cursorLine < offset) {
    offset = cursorLine;
  } else if (cursorLine >= offset + viewportHeight) {
    offset = cursorLine - viewportHeight + 1;
  }

  // Clamp offset
  offset = Math.max(0, Math.min(offset, allLines.length - viewportHeight));

  const visible = allLines.slice(offset, offset + viewportHeight);

  // Add scroll indicators, truncating the base line to make room
  if (offset > 0) {
    const above = offset;
    const suffix = `  ${theme.fg("dim", `↑ ${above} more`)}`;
    const suffixW = visibleWidth(suffix);
    visible[0] = `${truncateToWidth(visible[0], width - suffixW)}${suffix}`;
  }
  if (offset + viewportHeight < allLines.length) {
    const below = allLines.length - (offset + viewportHeight);
    const last = visible.length - 1;
    const suffix = `  ${theme.fg("dim", `↓ ${below} more`)}`;
    const suffixW = visibleWidth(suffix);
    visible[last] = `${truncateToWidth(visible[last], width - suffixW)}${suffix}`;
  }

  return { lines: visible, newOffset: offset };
}

// ─── Extension ───────────────────────────────────────────────────────────────

export default function piInquisitor(pi: ExtensionAPI) {
  pi.registerTool({
    name: "ask_user",
    label: "Ask User",
    description:
      "Ask the user one or more questions using an interactive form. Supports radio (single-select) and checkbox (multi-select) questions.",
    promptSnippet: "Ask the user interactive questions with radio or checkbox inputs",
    promptGuidelines: [],
    parameters: AskUserParams,

    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      if (!ctx.hasUI) {
        return errorResult("Error: UI not available (running in non-interactive mode)");
      }

      const validationError = validateQuestions(params.questions as Question[]);
      if (validationError) {
        return errorResult(validationError);
      }

      const questions = normalize(params.questions as Question[]);

      const result = await ctx.ui.custom<FormResult>((tui, theme, _kb, done) => {
        // ── Editor setup ──────────────────────────────────────
        const editorTheme: EditorTheme = {
          borderColor: (s) => theme.fg("accent", s),
          selectList: {
            selectedPrefix: (t) => theme.fg("accent", t),
            selectedText: (t) => theme.fg("accent", t),
            description: (t) => theme.fg("muted", t),
            scrollInfo: (t) => theme.fg("dim", t),
            noMatch: (t) => theme.fg("warning", t),
          },
        };
        const editor = new Editor(tui, editorTheme);

        // ── Elaboration infrastructure ────────────────────────
        let spinnerInterval: ReturnType<typeof setInterval> | null = null;
        const elabAbort = new AbortController();

        function startSpinner() {
          if (spinnerInterval) return;
          spinnerInterval = setInterval(() => {
            state.spinnerFrame = (state.spinnerFrame + 1) % SYM.spinner.length;
            deps.refresh();
          }, 80);
        }

        function stopSpinnerIfDone() {
          if (spinnerInterval && state.elaborating.size === 0) {
            clearInterval(spinnerInterval);
            spinnerInterval = null;
          }
        }

        async function elaborate(q: NormalizedQuestion, opt: { value: string; label: string; description?: string }) {
          const key = state.elabKey(q.id, opt.value);
          const model = ctx.model;
          if (!model) {
            state.elaborations.set(key, "(no model available)");
            state.elaborating.delete(key);
            stopSpinnerIfDone();
            deps.refresh();
            return;
          }

          const sessionSystemPrompt = ctx.getSystemPrompt();
          const conversationMessages: Message[] = [];
          for (const entry of ctx.sessionManager.getEntries()) {
            if (entry.type === "message") {
              conversationMessages.push(entry.message as Message);
            }
          }
          const { systemPrompt, messages } = buildElaborationContext(sessionSystemPrompt, conversationMessages, q, opt);

          try {
            const auth = await ctx.modelRegistry.getApiKeyAndHeaders(model);
            if (!auth.ok) {
              state.elaborations.set(key, "(auth failed)");
              return;
            }
            const timeoutSignal = AbortSignal.timeout(15_000);
            const combinedSignal = AbortSignal.any([elabAbort.signal, timeoutSignal]);
            const streamOpts: SimpleStreamOptions = {
              apiKey: auth.apiKey,
              ...(auth.headers ? { headers: auth.headers } : {}),
              signal: combinedSignal,
            };
            const stream = streamSimple(model, { systemPrompt, messages }, streamOpts);
            let streamError: string | undefined;
            for await (const event of stream) {
              if (event.type === "text_delta") {
                state.elaborations.set(key, (state.elaborations.get(key) || "") + event.delta);
                deps.refresh();
              } else if (event.type === "error") {
                streamError = event.error?.errorMessage || event.reason || "unknown error";
                break;
              } else if (event.type === "done") {
                break;
              }
            }
            if (streamError) {
              const existing = state.elaborations.get(key);
              state.elaborations.set(
                key,
                existing ? `${existing}\n(failed: ${streamError})` : `(failed: ${streamError})`,
              );
            }
          } catch (e) {
            if (elabAbort.signal.aborted) return;
            const msg = e instanceof Error ? e.message : String(e);
            const existing = state.elaborations.get(key);
            state.elaborations.set(key, existing ? `${existing}\n(failed: ${msg})` : `(failed: ${msg})`);
          } finally {
            state.elaborating.delete(key);
            stopSpinnerIfDone();
            deps.refresh();
          }
        }

        // ── FormState deps ───────────────────────────────────
        let cachedLines: string[] | undefined;

        const deps: FormDeps = {
          getEditorText: () => editor.getText(),
          setEditorText: (text) => editor.setText(text),
          forwardToEditor: (data) => editor.handleInput(data),
          requestElaboration: (q, opt) => {
            startSpinner();
            elaborate(q, opt).catch(() => {});
          },
          refresh: () => {
            cachedLines = undefined;
            tui.requestRender();
          },
          finish: (result) => {
            if (spinnerInterval) {
              clearInterval(spinnerInterval);
              spinnerInterval = null;
            }
            elabAbort.abort();
            done(result);
          },
        };

        const state = new FormState(questions, { title: params.title, description: params.description }, deps);

        // Wire abort signal
        if (signal) {
          const onAbort = () => state.finishSubmit(true);
          if (signal.aborted) {
            onAbort();
          } else {
            signal.addEventListener("abort", onAbort, { once: true });
          }
        }

        // Wire editor submit
        editor.onSubmit = (_value) => {
          if (state.otherMode && state.otherQuestionId) {
            state.saveOtherModeText();
            state.advanceTab();
          }
        };

        // ── Render ───────────────────────────────────────────

        function render(width: number): string[] {
          if (cachedLines) return cachedLines;

          const lines: string[] = [];
          const maxW = Math.min(width, 120);
          let cursorLine = -1; // track which line the cursor option is on
          const add = (s: string) => lines.push(truncateToWidth(s, maxW));
          const addWrapped = (s: string) => {
            for (const line of wrapTextWithAnsi(s, maxW - 1)) lines.push(line);
          };
          const hr = () => add(theme.fg("accent", "─".repeat(maxW)));

          hr();

          // Title & description
          if (params.title) {
            addWrapped(` ${theme.fg("accent", theme.bold(params.title))}`);
          }
          if (params.description) {
            addWrapped(` ${theme.fg("muted", params.description)}`);
          }
          if (params.title || params.description) lines.push("");

          // Tab bar (multi-question)
          if (state.isMulti) {
            const tabs: string[] = [];
            for (let i = 0; i < questions.length; i++) {
              const isActive = i === state.currentTab;
              const answered = state.isAnswered(questions[i]);
              const lbl = questions[i].label;
              const icon = answered ? theme.fg("success", SYM.check) : theme.fg("dim", SYM.dot);
              const text = ` ${icon} ${lbl} `;
              tabs.push(
                isActive
                  ? theme.bg("selectedBg", theme.fg("text", text))
                  : theme.fg(answered ? "success" : "muted", text),
              );
            }
            const isSubmitTab = state.currentTab === questions.length;
            const canSubmit = state.allAnswered();
            const submitText = ` ${SYM.submit} Submit `;
            tabs.push(
              isSubmitTab
                ? theme.bg("selectedBg", theme.fg("text", submitText))
                : theme.fg(canSubmit ? "success" : "dim", submitText),
            );
            add(` ${tabs.join(theme.fg("dim", "│"))}`);
            lines.push("");
          }

          const q = state.curQ();

          // ── Submit tab ───────────────────────────────────
          if (state.isMulti && state.currentTab === questions.length) {
            add(` ${theme.fg("accent", theme.bold("Review & Submit"))}`);
            lines.push("");

            for (const question of questions) {
              const label = theme.fg("muted", `${question.label}:`);
              if (question.type === "radio") {
                const a = state.radioAnswers.get(question.id);
                if (a) {
                  const prefix = a.wasCustom ? theme.fg("dim", "(wrote) ") : "";
                  add(` ${label} ${prefix}${a.label}`);
                } else {
                  add(` ${label} ${theme.fg("warning", "(unanswered)")}`);
                }
              } else {
                const set = state.checkAnswers.get(question.id) ?? new Set();
                const custom = state.checkCustom.get(question.id)?.trim();
                const all = [...set];
                if (custom) all.push(`${theme.fg("dim", "(wrote)")} ${custom}`);
                if (all.length) {
                  add(` ${label} ${all.join(", ")}`);
                } else {
                  add(` ${label} ${theme.fg("warning", "(unanswered)")}`);
                }
              }
            }

            lines.push("");
            if (!state.allAnswered()) {
              add(
                ` ${theme.fg("warning", "Some questions are unanswered.")} ${theme.fg("dim", "Press Enter to submit anyway")}`,
              );
            } else {
              add(` ${theme.fg("success", "Press Enter to submit")}`);
            }

            lines.push("");
            add(theme.fg("dim", " Tab/←→ navigate questions • Enter submit • Esc cancel"));
            hr();
            cachedLines = lines;
            return lines;
          }

          if (!q) {
            hr();
            cachedLines = lines;
            return lines;
          }

          // ── Question prompt ──────────────────────────────
          const typeTag = q.type === "radio" ? theme.fg("dim", "[single-select]") : theme.fg("dim", "[multi-select]");

          addWrapped(` ${theme.fg("text", theme.bold(q.prompt))} ${typeTag}`);
          lines.push("");

          // ── Radio options ────────────────────────────────
          if (q.type === "radio") {
            const selected = state.radioAnswers.get(q.id);
            for (let i = 0; i < q.options.length; i++) {
              const opt = q.options[i];
              const isCursor = i === state.cursorIdx;
              const isSelected = selected?.value === opt.value && !selected.wasCustom;
              const bullet = isSelected ? theme.fg("accent", SYM.radioOn) : theme.fg("dim", SYM.radioOff);
              const pointer = isCursor ? theme.fg("accent", SYM.pointer) : " ";
              const color: ThemeColor = isCursor ? "accent" : isSelected ? "text" : "muted";
              const recBadge = opt.recommended ? ` ${theme.fg("success", "(recommended)")}` : "";
              const key = state.elabKey(q.id, opt.value);
              const isElaborating = state.elaborating.get(key);
              const elabText = state.elaborations.get(key);
              const spinnerSuffix = isElaborating ? ` ${theme.fg("accent", SYM.spinner[state.spinnerFrame])}` : "";
              if (isCursor) cursorLine = lines.length;
              add(` ${pointer} ${bullet} ${theme.fg(color, opt.label)}${recBadge}${spinnerSuffix}`);
              if (opt.description) {
                addWrapped(`      ${theme.fg("dim", opt.description)}`);
              }
              if (elabText) {
                for (const elabLine of elabText.trim().split("\n")) {
                  if (!elabLine.trim()) continue;
                  for (const wl of wrapTextWithAnsi(theme.fg("muted", elabLine), maxW - 7)) {
                    lines.push(`      ${wl}`);
                  }
                }
              }
            }

            if (q.allowOther) {
              lines.push("");
              const otherIdx = q.options.length;
              const isCursor = state.cursorIdx === otherIdx;
              const isSelected = selected?.wasCustom === true;
              const bullet = isSelected ? theme.fg("accent", SYM.radioOn) : theme.fg("dim", SYM.radioOff);
              const pointer = isCursor ? theme.fg("accent", SYM.pointer) : " ";
              const label = isSelected ? `Other: ${selected.label}` : "Other...";
              if (isCursor) cursorLine = lines.length;
              add(` ${pointer} ${bullet} ${theme.fg(isCursor ? "accent" : "muted", label)}`);

              if (state.otherMode) {
                lines.push("");
                add(` ${theme.fg("muted", "  Your answer:")}`);
                for (const line of editor.render(maxW - 6)) {
                  add(`   ${line}`);
                }
                cursorLine = lines.length - 1;
              }
            }
          }

          // ── Checkbox options ─────────────────────────────
          if (q.type === "checkbox") {
            const set = state.checkAnswers.get(q.id) ?? new Set();
            for (let i = 0; i < q.options.length; i++) {
              const opt = q.options[i];
              const isCursor = i === state.cursorIdx;
              const isChecked = set.has(opt.value);
              const box = isChecked ? theme.fg("accent", SYM.checkOn) : theme.fg("dim", SYM.checkOff);
              const pointer = isCursor ? theme.fg("accent", SYM.pointer) : " ";
              const color: ThemeColor = isCursor ? "accent" : isChecked ? "text" : "muted";
              const recBadge = opt.recommended ? ` ${theme.fg("success", "(recommended)")}` : "";
              const key = state.elabKey(q.id, opt.value);
              const isElaborating = state.elaborating.get(key);
              const elabText = state.elaborations.get(key);
              const spinnerSuffix = isElaborating ? ` ${theme.fg("accent", SYM.spinner[state.spinnerFrame])}` : "";
              if (isCursor) cursorLine = lines.length;
              add(` ${pointer} ${box} ${theme.fg(color, opt.label)}${recBadge}${spinnerSuffix}`);
              if (opt.description) {
                addWrapped(`      ${theme.fg("dim", opt.description)}`);
              }
              if (elabText) {
                for (const elabLine of elabText.trim().split("\n")) {
                  if (!elabLine.trim()) continue;
                  for (const wl of wrapTextWithAnsi(theme.fg("muted", elabLine), maxW - 7)) {
                    lines.push(`      ${wl}`);
                  }
                }
              }
            }

            if (q.allowOther) {
              lines.push("");
              const otherIdx = q.options.length;
              const isCursor = state.cursorIdx === otherIdx;
              const custom = state.checkCustom.get(q.id)?.trim();
              const box = custom ? theme.fg("accent", SYM.checkOn) : theme.fg("dim", SYM.checkOff);
              const pointer = isCursor ? theme.fg("accent", SYM.pointer) : " ";
              const label = custom ? `Other: ${custom}` : "Other...";
              if (isCursor) cursorLine = lines.length;
              add(` ${pointer} ${box} ${theme.fg(isCursor ? "accent" : "muted", label)}`);

              if (state.otherMode) {
                lines.push("");
                add(` ${theme.fg("muted", "  Your answer:")}`);
                for (const line of editor.render(maxW - 6)) {
                  add(`   ${line}`);
                }
                cursorLine = lines.length - 1;
              }
            }
          }

          // ── Footer ───────────────────────────────────────
          lines.push("");
          if (state.otherMode) {
            add(theme.fg("dim", " Enter submit • Esc go back"));
          } else if (q.type === "checkbox") {
            const nav = state.isMulti ? "Tab/←→ navigate • " : "";
            add(
              theme.fg(
                "dim",
                ` ↑↓ navigate • Space toggle • A select all • E elaborate • ${nav}Enter ${state.isMulti ? "next" : "submit"} • Esc cancel`,
              ),
            );
          } else {
            const nav = state.isMulti ? "Tab/←→ navigate • " : "";
            add(theme.fg("dim", ` ↑↓ navigate • E elaborate • ${nav}Enter select • Esc cancel`));
          }
          hr();

          // Apply scroll if content exceeds viewport
          const viewportHeight = getViewportHeight();
          if (cursorLine >= 0 && lines.length > viewportHeight) {
            const { lines: scrolled, newOffset } = applyScroll(
              lines,
              cursorLine,
              state.scrollOffset,
              viewportHeight,
              width,
              theme,
            );
            state.scrollOffset = newOffset;
            cachedLines = scrolled;
            return scrolled;
          }

          state.scrollOffset = 0;
          cachedLines = lines;
          return lines;
        }

        return {
          render,
          invalidate: () => {
            cachedLines = undefined;
          },
          handleInput: (data: string) => state.handleInput(data),
        };
      });

      // ── Format result ────────────────────────────────────────

      if (result.cancelled) {
        return {
          content: [{ type: "text", text: "User cancelled the form" }],
          details: result,
        };
      }

      const answerLines: string[] = [];
      for (const a of result.answers) {
        const q = questions.find((q) => q.id === a.id);
        const label = q?.label || a.id;
        if (a.type === "radio") {
          const prefix = a.wasCustom ? "(wrote) " : "";
          const display = a.value || "(none selected)";
          answerLines.push(`${label}: ${prefix}${display}`);
        } else {
          const values = Array.isArray(a.value) ? a.value : [a.value];
          const prefix = a.wasCustom ? "(wrote) " : "";
          if (values.length === 0) {
            answerLines.push(`${label}: (none selected)`);
          } else {
            answerLines.push(`${label}: ${prefix}${values.join(", ")}`);
          }
        }
      }

      return {
        content: [{ type: "text", text: answerLines.join("\n") }],
        details: result,
      };
    },

    // ── Custom rendering ─────────────────────────────────────────

    renderCall(args, theme, _context) {
      const qs = (args.questions as Question[]) || [];
      const title = args.title as string | undefined;
      let text = theme.fg("toolTitle", theme.bold("ask_user "));
      if (title) {
        text += `${theme.fg("accent", title)} `;
      }
      text += theme.fg("muted", `${qs.length} question${qs.length !== 1 ? "s" : ""}`);
      const types = [...new Set(qs.map((q) => q.type))].join(", ");
      if (types) {
        text += theme.fg("dim", ` (${types})`);
      }
      return new Text(text, 0, 0);
    },

    renderResult(result, _options, theme, _context) {
      const details = result.details as FormResult | undefined;
      if (!details) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text : "", 0, 0);
      }

      if (details.cancelled) {
        return new Text(theme.fg("warning", "Cancelled"), 0, 0);
      }

      const lines = details.answers.map((a) => {
        const q = details.questions.find((q) => q.id === a.id);
        const label = q?.label || a.id;

        if (a.type === "radio") {
          const prefix = a.wasCustom ? theme.fg("dim", "(wrote) ") : "";
          return `${theme.fg("success", SYM.check)} ${theme.fg("accent", label)}: ${prefix}${a.value || theme.fg("dim", "(none selected)")}`;
        }
        const values = Array.isArray(a.value) ? a.value : [a.value];
        const prefix = a.wasCustom ? theme.fg("dim", "(wrote) ") : "";
        const displayStr = values.length ? `${prefix}${values.join(", ")}` : theme.fg("dim", "(none selected)");
        return `${theme.fg("success", SYM.check)} ${theme.fg("accent", label)}: ${displayStr}`;
      });

      return new Text(lines.join("\n"), 0, 0);
    },
  });
}
