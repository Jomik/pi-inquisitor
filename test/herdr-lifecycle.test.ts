import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";
import piInquisitor from "../src/index.js";
import type { FormResult } from "../src/types.js";

// ── Minimal valid params (radio requires ≥ 2 options) ────────────────────────

const PARAMS = {
  title: "Deploy target",
  questions: [
    {
      id: "env",
      type: "radio",
      prompt: "Which environment?",
      options: [
        { value: "prod", label: "Production" },
        { value: "staging", label: "Staging" },
      ],
    },
  ],
};

const RESOLVED: FormResult = { cancelled: false, questions: [], answers: [] };

// ── Helpers ───────────────────────────────────────────────────────────────────

type ToolExecute = (
  toolCallId: string,
  params: unknown,
  signal: AbortSignal | null,
  onUpdate: () => void,
  ctx: ExtensionContext,
) => Promise<unknown>;

function makePi() {
  let execute: ToolExecute | undefined;
  const emitSpy = vi.fn();

  piInquisitor({
    registerTool: (def: { execute: ToolExecute }) => {
      execute = def.execute;
    },
    events: { emit: emitSpy },
  } as unknown as ExtensionAPI);

  if (!execute) throw new Error("registerTool was not called");
  return { execute, emitSpy };
}

/** Minimal ctx: hasUI=true, ui.custom bypasses the factory and returns the given promise. */
function makeCtx(customReturn: Promise<FormResult>): ExtensionContext {
  return {
    hasUI: true,
    ui: { custom: (_factory: unknown) => customReturn },
  } as unknown as ExtensionContext;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("herdr:blocked lifecycle", () => {
  it("emits active=true with title label while pending, then active=false after resolution", async () => {
    const { execute, emitSpy } = makePi();

    let resolve!: (v: FormResult) => void;
    const uiPromise = new Promise<FormResult>((res) => {
      resolve = res;
    });

    // Start execution — emits active:true synchronously before the first await
    const executionPromise = execute("tcid", PARAMS, null, () => {}, makeCtx(uiPromise));

    // active:true must already be recorded before the UI promise resolves
    expect(emitSpy).toHaveBeenCalledTimes(1);
    expect(emitSpy).toHaveBeenCalledWith("herdr:blocked", {
      active: true,
      label: "Answer: Deploy target",
    });

    // Resolve UI; execute should complete cleanly
    resolve(RESOLVED);
    await executionPromise;

    expect(emitSpy).toHaveBeenCalledTimes(2);
    expect(emitSpy).toHaveBeenCalledWith("herdr:blocked", { active: false });
  });

  it("emits active=false after UI promise rejection", async () => {
    const { execute, emitSpy } = makePi();

    let reject!: (e: unknown) => void;
    const uiPromise = new Promise<FormResult>((_, rej) => {
      reject = rej;
    });

    const executionPromise = execute("tcid", PARAMS, null, () => {}, makeCtx(uiPromise));

    reject(new Error("dismissed"));
    await expect(executionPromise).rejects.toThrow("dismissed");

    expect(emitSpy).toHaveBeenCalledWith("herdr:blocked", { active: false });
  });
});
