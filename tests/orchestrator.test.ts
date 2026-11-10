/**
 * End-to-end orchestrator tests over a scripted fake client — the full
 * Gauntlet, no network, no credentials.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Gauntlet } from "../src/pipeline/orchestrator.js";
import { TerrainStore } from "../src/store/store.js";
import { loadConfig } from "../src/config.js";
import type { MaxxingConfig } from "../src/config.js";
import { buildBrief } from "../src/pipeline/preflight.js";
import {
  FakeClient,
  PREFLIGHT_JSON,
  GATE_CLEAN,
  GATE_REVISE_VERCEL,
  GATE_BLOCKER,
  EXECUTOR_JSON,
  REPAIR_VERCEL,
  synthesisHandler,
  lensHandlerForGoodMission,
  verifierJsonFor,
  type Stage,
} from "./helpers.js";

let dir: string;
let config: MaxxingConfig;
let store: TerrainStore;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "maxxing-orch-"));
  config = {
    ...loadConfig("/nonexistent/no-config.json"),
    home: dir,
    model: "fake-model",
    maxGateRounds: 3,
    minEvidence: 3,
    codeExecution: false,
  };
  store = new TerrainStore(path.join(dir, "terrain.db"));
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

function goodHandler(stage: Stage, lens: string, prompt: string): string {
  switch (stage) {
    case "preflight":
      return PREFLIGHT_JSON;
    case "lens":
      return lensHandlerForGoodMission(stage, lens, prompt);
    case "gap":
      return REPAIR_VERCEL;
    case "synthesis":
      return synthesisHandler(stage, lens, prompt);
    case "gate":
      return GATE_CLEAN;
    case "executor":
      return EXECUTOR_JSON;
    case "verifier":
      return verifierJsonFor(prompt, "verified");
    default:
      throw new Error(`unexpected stage ${stage}`);
  }
}

describe("the Gauntlet — full pipeline over fake agents", () => {
  it("runs preflight → lenses → synthesis → gate pass → execute → verify → done", async () => {
    const client = new FakeClient(goodHandler);
    const gauntlet = new Gauntlet({ client, store, config });
    const outcome = await gauntlet.runMission("deploy my static site to a VPS with HTTPS");

    expect(outcome.phase).toBe("done");
    expect(outcome.verdict).toBe("pass");
    expect(outcome.attemptVerdict).toBe("verified");
    expect(outcome.deliverables).toEqual(["deploy.sh", "checklist.md"]);

    // All five lenses actually ran.
    for (const lens of ["elite", "reverse", "fundamentals", "first-principles", "pro-amateur"]) {
      expect(client.calls.some((c) => c.stage === "lens" && c.lens === lens)).toBe(true);
    }

    // Evidence persisted with provenance.
    const missionId = outcome.missionId;
    expect(store.listEvidence(missionId).length).toBeGreaterThanOrEqual(3);
    expect(store.getSynthesis(missionId)).not.toBeNull();

    // A verified attempt became a lesson for the terrain map.
    const lessons = store.listLessons(missionId);
    expect(lessons.some((l) => l.kind === "worked")).toBe(true);

    // The honest report exists on disk.
    expect(outcome.reportPath).toBeDefined();
    expect(existsSync(outcome.reportPath!)).toBe(true);
  });

  it("gate round 1 finds a material gap, the lens closes it, gate round 2 passes", async () => {
    let gateCalls = 0;
    const client = new FakeClient((stage, lens, prompt) => {
      if (stage === "gate") {
        gateCalls += 1;
        return gateCalls === 1 ? GATE_REVISE_VERCEL : GATE_CLEAN;
      }
      return goodHandler(stage, lens, prompt);
    });
    const gauntlet = new Gauntlet({ client, store, config });
    const outcome = await gauntlet.runMission("deploy my static site to a VPS with HTTPS");

    expect(outcome.phase).toBe("done");
    expect(gateCalls).toBe(2);
    expect(client.callsFor("synthesis")).toBe(2); // re-synthesized after repair

    // The repair evidence landed and the gap was closed by it.
    const evidence = store.listEvidence(outcome.missionId);
    expect(evidence.some((e) => e.claim.includes("Vercel account"))).toBe(true);
    const gaps = store.listGaps(outcome.missionId);
    const vercelGap = gaps.find((g) => g.description.includes("Vercel"));
    expect(vercelGap!.status).toBe("closed");
    expect(store.listGateRounds(outcome.missionId).map((r) => r.verdict)).toEqual(["revise", "pass"]);
  });

  it("a blocker-severity gap blocks execution immediately and says why", async () => {
    const client = new FakeClient((stage, lens, prompt) =>
      stage === "gate" ? GATE_BLOCKER : goodHandler(stage, lens, prompt),
    );
    const gauntlet = new Gauntlet({ client, store, config });
    const outcome = await gauntlet.runMission("deploy my static site to a VPS with HTTPS");

    expect(outcome.phase).toBe("blocked");
    expect(outcome.blockers.length).toBeGreaterThan(0);
    expect(outcome.blockers[0]).toContain("root server access");
    expect(client.callsFor("executor")).toBe(0);

    const report = await import("node:fs").then((fs) => fs.readFileSync(outcome.reportPath!, "utf8"));
    expect(report).toContain("blocked");
    expect(report).toContain("No execution attempt exists");
  });

  it("scout-only missions stop after the gate and never execute", async () => {
    const client = new FakeClient(goodHandler);
    const gauntlet = new Gauntlet({ client, store, config });
    const outcome = await gauntlet.runMission("deploy my static site to a VPS with HTTPS", { scoutOnly: true });

    expect(outcome.phase).toBe("done");
    expect(outcome.verdict).toBe("pass");
    expect(outcome.attemptVerdict).toBeNull();
    expect(client.callsFor("executor")).toBe(0);
    expect(client.callsFor("verifier")).toBe(0);
  });

  it("a mission stuck mid-run resumes from its persisted phase", async () => {
    const id = "msn_resume";
    store.createMission(
      "deploy my static site to a VPS with HTTPS",
      buildBrief("deploy my static site to a VPS with HTTPS", { tags: ["vps", "deployment"] }),
      false,
      id,
      "2026-01-01T00:00:00Z",
    );
    store.updateMission(id, { phase: "lenses" });

    const client = new FakeClient(goodHandler);
    const gauntlet = new Gauntlet({ client, store, config });
    const outcome = await gauntlet.resumeMission(id);

    expect(outcome.phase).toBe("done");
    expect(outcome.verdict).toBe("pass");
    // Resume skipped preflight: no preflight call was made.
    expect(client.callsFor("preflight")).toBe(0);
    expect(client.callsFor("lens")).toBeGreaterThanOrEqual(5);
  });

  it("thin scouting surfaces as a gate gap, then blocks at the round cap", async () => {
    // Only one lens returns findings; the rest return unparseable prose.
    let synthesisCalls = 0;
    const client = new FakeClient((stage, lens, prompt) => {
      if (stage === "lens" && lens !== "elite" && lens !== "gap") return "prose, no json";
      if (stage === "gate") return GATE_CLEAN; // agent finds nothing; deterministic checks must
      if (stage === "synthesis") {
        synthesisCalls += 1;
        return synthesisHandler(stage, lens, prompt);
      }
      return goodHandler(stage, lens, prompt);
    });
    const singleRoundConfig = { ...config, maxGateRounds: 1 };
    const gauntlet = new Gauntlet({ client, store, config: singleRoundConfig });
    const outcome = await gauntlet.runMission("deploy my static site to a VPS with HTTPS");

    expect(outcome.phase).toBe("blocked");
    expect(synthesisCalls).toBeGreaterThanOrEqual(1);
    const gaps = store.listGaps(outcome.missionId);
    const silent = gaps.filter((g) => g.description.includes("lens is silent"));
    expect(silent.length).toBeGreaterThanOrEqual(3);
  });
});
