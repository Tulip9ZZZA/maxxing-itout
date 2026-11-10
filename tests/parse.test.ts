import { describe, expect, it } from "vitest";
import { extractJson, keywordOverlap } from "../src/core/parse.js";

describe("extractJson", () => {
  it("parses a fenced json block", () => {
    const text = 'Sure!\n```json\n{"a": 1}\n```\nDone.';
    expect(extractJson(text)).toEqual({ a: 1 });
  });

  it("parses a fenced block without the json tag", () => {
    const text = '```\n{"a": [1, 2]}\n```';
    expect(extractJson(text)).toEqual({ a: [1, 2] });
  });

  it("parses bare JSON embedded in prose", () => {
    const text = 'The result is {"gaps": [], "rationale": "clean"} as requested.';
    expect(extractJson(text)).toEqual({ gaps: [], rationale: "clean" });
  });

  it("repairs trailing commas", () => {
    const text = '```json\n{"a": [1, 2,], "b": "x",}\n```';
    expect(extractJson(text)).toEqual({ a: [1, 2], b: "x" });
  });

  it("handles braces inside strings", () => {
    const text = '```json\n{"s": "a } brace"}\n```';
    expect(extractJson(text)).toEqual({ s: "a } brace" });
  });

  it("returns null for garbage", () => {
    expect(extractJson("no structure here at all")).toBeNull();
    expect(extractJson("```json\n{broken\n```")).toBeNull();
    expect(extractJson("")).toBeNull();
  });

  it("prefers the first fenced block when multiple exist", () => {
    const text = '```json\n{"first": true}\n```\nthen\n```json\n{"second": true}\n```';
    expect(extractJson(text)).toEqual({ first: true });
  });
});

describe("keywordOverlap", () => {
  it("matches shared words of 4+ chars", () => {
    expect(keywordOverlap("the Vercel account is missing", "creating a Vercel account")).toBe(true);
  });

  it("ignores short words", () => {
    expect(keywordOverlap("a to of", "a to of the")).toBe(false);
  });

  it("does not match unrelated text", () => {
    expect(keywordOverlap("docker caching", "vercel billing")).toBe(false);
  });
});
