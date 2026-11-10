import { describe, expect, it } from "vitest";
import { loadPrompt, fillPrompt, promptsDir } from "../src/prompts.js";

const EXPECTED_PROMPTS = [
  "preflight",
  "preflight-shared",
  "lens-shared",
  "lens-elite",
  "lens-reverse",
  "lens-fundamentals",
  "lens-first-principles",
  "lens-pro-amateur",
  "synthesis",
  "synthesis-shared",
  "terrain-gate",
  "gate-shared",
  "gap-research",
  "gap-research-shared",
  "executor",
  "executor-shared",
  "verifier",
  "verifier-shared",
  "forge",
  "forge-shared",
];

describe("prompt loading", () => {
  it("finds the prompts directory", () => {
    expect(promptsDir()).toMatch(/prompts$/);
  });

  it("loads every prompt non-empty", () => {
    for (const name of EXPECTED_PROMPTS) {
      const content = loadPrompt(name);
      expect(content.length, `prompt ${name}`).toBeGreaterThan(40);
    }
  });

  it("throws for a missing prompt", () => {
    expect(() => loadPrompt("does-not-exist")).toThrow();
  });

  it("fills variables and rejects missing ones loudly", () => {
    const template = "Mission: {{mission}} Schema: {{schema}}";
    expect(fillPrompt(template, { mission: "m", schema: "s" })).toBe("Mission: m Schema: s");
    expect(() => fillPrompt(template, { mission: "m" })).toThrow(/\{\{schema\}\}/);
  });

  it("each lens prompt names its lens and demands an output contract", () => {
    for (const name of ["lens-elite", "lens-reverse", "lens-fundamentals", "lens-first-principles", "lens-pro-amateur"]) {
      const content = loadPrompt(name);
      expect(content, name).toContain("Output contract");
      expect(content, name).toContain("{{schema}}");
    }
  });

  it("the terrain gate prompt carries all nine questions", () => {
    const content = fillPrompt(loadPrompt("terrain-gate"), {
      mission: "m",
      questions: "q",
      synthesis: "s",
      evidence: "e",
      lensSummaries: "l",
      criteria: "c",
    });
    expect(content).toContain("nine questions");
    expect(content).toContain("hostile");
  });
});
