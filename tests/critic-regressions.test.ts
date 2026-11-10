/**
 * Regression tests for the weaknesses the independent critics found:
 * resume laundering, gate fail-open, unreachable contradiction checks,
 * duplicate evidence on resume, and forge wiring.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Gauntlet } from "../src/pipeline/orchestrator.js";
import { TerrainStore } from "../src/store/store.js";
import { loadConfig } from "../src/config.js";
import type { MaxxingConfig } from "../src/config.js";
import { buildBrief } from "../src/pipeline/preflight.js";
import { deterministicChecks, runGateRound } from "../src/pipeline/gate.js";
import { forgeSkill } from "../src/pipeline/forge.js";
import type { Evidence, LensReport, MissionBrief, Synthesis } from "../src/core/types.js";
import { LENS_IDS } from "../src/core/types.js";
import {
  FakeClient,
  PREFLIGHT_JSON,
  GATE_REVISE_VERCEL,
  GATE_CLEAN,
  REPAIR_VERCEL,
  EXECUTOR_JSON,
  synthesisHandler,
  lensHandlerForGoodMission,
  verifierJsonFor,
  lensReportJson,
  type Stage,
} from "./helpers.js";

let dir: string;
let config: MaxxingConfig;
let store: TerrainStore;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "maxxing-critic-"));
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
    case "preflight": return PREFLIGHT_JSON;
    case "lens": return lensHandlerForGoodMission(stage, lens, prompt);
    case "gap": return REPAIR_VERCEL;
    case "synthesis": return synthesisHandler(stage, lens, prompt);
    case "gate": return GATE_CLEAN;
    case "executor": return EXECUTOR_JSON;
    case "verifier": return verifierJsonFor(prompt, "verified");
    default: throw new Error(`unexpected stage ${stage}`);
  }
}

describe("critic regression: resume semantics", () => {
  it("resuming a BLOCKED mission re-runs the gate instead of laundering it to done", async () => {
    const id = "msn_blocked";
    store.createMission(
      "deploy my static site to a VPS with HTTPS",
      buildBrief("deploy my static site to a VPS with HTTPS", { tags: ["vps"] }),
      false,
      id,
      "2026-01-01T00:00:00Z",
    );
    store.updateMission(id, { phase: "blocked", gateRound: 1 });
    // Seed the terrain the resume needs: reports + synthesis.
    for (const lens of LENS_IDS) {
      store.saveLensReport(id, {
        lens,
        summary: "s",
        findings: [{ title: "t", claim: `finding for ${lens}: HTTPS needs certbot`, sourceType: "web", confidence: 0.8 }],
        blindSpots: [],
      }, "t");
      for (const f of [{ title: "t", claim: `finding for ${lens}: HTTPS needs certbot`, sourceType: "web" as const, confidence: 0.8 }]) {
        store.saveEvidence(id, lens, f, `ev_${lens}`, "t");
      }
    }
    store.saveSynthesis(id, {
      terrainSummary: "t",
      keyClaims: [{ evidenceId: "ev_elite", claim: "c" }],
      contradictions: [],
      dependencies: [{ type: "account", name: "VPS", requiredFor: "server" }],
      method: "m",
      verification: [{ criterion: "site reachable over HTTPS on the user's domain", method: "curl" }],
      coveredUnknowns: [],
      proStandards: [],
      risks: [],
    }, "t");

    let gateCalls = 0;
    const client = new FakeClient((stage, lens, prompt) => {
      if (stage === "gate") {
        gateCalls += 1;
        // Round 1 of the resumed gate still finds the account gap; the repair
        // closes it; round 2 passes; execution then proceeds.
        return gateCalls === 1 ? GATE_REVISE_VERCEL : GATE_CLEAN;
      }
      return goodHandler(stage, lens, prompt);
    });
    const gauntlet = new Gauntlet({ client, store, config });
    const outcome = await gauntlet.resumeMission(id);

    expect(outcome.phase).toBe("done");
    expect(gateCalls).toBeGreaterThanOrEqual(2); // the gate actually re-ran
    expect(client.callsFor("executor")).toBe(1); // and execution proceeded after the pass
  });

  it("resuming from 'lenses' does not duplicate evidence for lenses that already reported", async () => {
    const id = "msn_partial";
    store.createMission(
      "deploy my static site to a VPS with HTTPS",
      buildBrief("deploy my static site to a VPS with HTTPS", {
        tags: ["vps"],
        successCriteria: ["site reachable over HTTPS on the user's domain"],
      }),
      false,
      id,
      "2026-01-01T00:00:00Z",
    );
    store.updateMission(id, { phase: "lenses" });
    // The elite lens already completed before the crash.
    store.saveLensReport(id, {
      lens: "elite",
      summary: "s",
      findings: [{ title: "t", claim: "elite already scouted: HTTPS needs certbot", sourceType: "web", confidence: 0.8 }],
      blindSpots: [],
    }, "t");
    store.saveEvidence(id, "elite", { title: "t", claim: "elite already scouted: HTTPS needs certbot", sourceType: "web", confidence: 0.8 }, "ev_pre", "t");

    const client = new FakeClient(goodHandler);
    const gauntlet = new Gauntlet({ client, store, config });
    const outcome = await gauntlet.resumeMission(id);

    expect(outcome.phase).toBe("done");
    // The pre-seeded elite lens did not re-run: its original claim appears once.
    // (A later repair run may add NEW elite evidence; that is correct behavior.)
    const eliteClaims = store.listEvidence(id).filter((e) => e.lens === "elite");
    expect(eliteClaims.filter((e) => e.claim.includes("elite already scouted"))).toHaveLength(1);
    expect(client.calls.some((c) => c.stage === "lens" && c.lens === "elite")).toBe(false);
    expect(client.calls.some((c) => c.stage === "lens" && c.lens === "reverse")).toBe(true);
  });
});

describe("critic regression: the hostile pass cannot fail open", () => {
  it("a gate agent that dies mid-round BLOCKS the round instead of passing", async () => {
    const brief = buildBrief("deploy", { successCriteria: ["c"], tags: ["vps"] });
    const synthesis: Synthesis = {
      terrainSummary: "t",
      keyClaims: [],
      contradictions: [],
      dependencies: [{ type: "account", name: "n", requiredFor: "r" }],
      method: "m",
      verification: [{ criterion: "c", method: "m" }],
      coveredUnknowns: [],
      proStandards: [],
      risks: [],
    };
    const reports: LensReport[] = LENS_IDS.map((lens) => ({
      lens,
      summary: "s",
      findings: [{ title: "t", claim: `finding for ${lens}`, sourceType: "web", confidence: 0.8 }],
      blindSpots: [],
    }));

    const client = new FakeClient(() => {
      throw new Error("agent run failed: error_max_turns");
    });
    const result = await runGateRound(
      client, store, { info() {}, warn() {}, error() {}, event() {} },
      "msn_gatefail", brief, reports, synthesis, 1, 3, 3,
      { model: "m", maxTurns: 2, permissionMode: "acceptEdits", allowedTools: [] },
    );

    expect(result.verdict).toBe("blocked");
    expect(result.rationale).toContain("hostile pass did not run");
  });

  it("a synthesis-declared contradiction reaches the deterministic check", () => {
    const brief: MissionBrief = buildBrief("deploy", { successCriteria: ["site reachable over HTTPS on the user's domain"], knownUnknowns: [], tags: ["vps"] });
    const evidence: Evidence[] = [
      { id: "ev_1", missionId: "m", lens: "elite", sourceType: "web", title: "a", claim: "certbot works unattended", confidence: 0.9, capturedAt: "t", status: "raw", contradicts: ["ev_2"] },
      { id: "ev_2", missionId: "m", lens: "reverse", sourceType: "web", title: "b", claim: "certbot requires interaction", confidence: 0.9, capturedAt: "t", status: "raw", contradicts: ["ev_1"] },
    ];
    // Round-trip through the store's contradiction marker, as the orchestrator does.
    store.saveEvidence("m", "elite", { title: "a", claim: "certbot works unattended", sourceType: "web", confidence: 0.9 }, "ev_1", "t");
    store.saveEvidence("m", "reverse", { title: "b", claim: "certbot requires interaction", sourceType: "web", confidence: 0.9 }, "ev_2", "t");
    store.markContradictions("m", [{ evidenceId: "ev_1", contradictsId: "ev_2" }]);

    const gaps = deterministicChecks({
      brief,
      reports: LENS_IDS.map((lens) => ({ lens, summary: "s", findings: [{ title: "t", claim: `finding for ${lens}`, sourceType: "web", confidence: 0.8 }], blindSpots: [] })),
      evidence: store.listEvidence("m"),
      synthesis: {
        terrainSummary: "t",
        keyClaims: [{ evidenceId: "ev_1", claim: "c" }],
        contradictions: [{ evidenceId: "ev_1", contradictsId: "ev_2" }],
        dependencies: [{ type: "account", name: "n", requiredFor: "r" }],
        method: "m",
        verification: [{ criterion: "site reachable over HTTPS on the user's domain", method: "m" }],
        coveredUnknowns: [],
        proStandards: [],
        risks: [],
      },
      minEvidence: 2,
    });

    const hit = gaps.find((g) => g.description.includes("contradiction unresolved"));
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe("material");
  });
});

describe("critic regression: forge is wired", () => {
  it("forges when evidence exists and the forge agent decides to", async () => {
    const missionId = "msn_forge";
    store.saveEvidence(missionId, "elite", { title: "t", claim: "verified terrain: HTTPS needs certbot", sourceType: "web", confidence: 0.9 }, "ev_1", "t");
    const client = new FakeClient((_stage, _lens, _prompt) =>
      JSON.stringify({ slug: "vps-https-deploy", forges: true, reason: "recurs" }));
    const result = await forgeSkill(
      client,
      buildBrief("deploy with HTTPS", { tags: ["vps"] }),
      store.listEvidence(missionId),
      null,
      [],
      null,
      { model: "m", maxTurns: 2, permissionMode: "acceptEdits", cwd: dir, codeExecution: false, skillsDir: path.join(dir, "skills") },
    );
    expect(result.forged).toBe(true);
    expect(result.skillPath).toContain("vps-https-deploy");
  });

  it("refuses to forge on zero evidence", async () => {
    const client = new FakeClient(() => { throw new Error("must not be called"); });
    const result = await forgeSkill(
      client,
      buildBrief("deploy", { tags: ["vps"] }),
      [],
      null,
      [],
      null,
      { model: "m", maxTurns: 2, permissionMode: "acceptEdits", cwd: dir, codeExecution: false, skillsDir: path.join(dir, "skills") },
    );
    expect(result.forged).toBe(false);
    expect(result.reason).toContain("no evidence");
  });
});
