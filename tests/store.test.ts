import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { TerrainStore } from "../src/store/store.js";
import { buildBrief } from "../src/pipeline/preflight.js";

let dir: string;
let store: TerrainStore;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "maxxing-store-"));
  store = new TerrainStore(path.join(dir, "terrain.db"));
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("TerrainStore", () => {
  it("creates and retrieves missions", () => {
    const brief = buildBrief("deploy a site", {});
    const mission = store.createMission("deploy a site", brief, false, "msn_1", "2026-01-01T00:00:00Z");
    expect(mission.id).toBe("msn_1");
    expect(mission.phase).toBe("preflight");
    expect(mission.brief.objective).toBe("deploy a site");

    store.updateMission("msn_1", { phase: "gate", gateRound: 2 });
    const updated = store.getMission("msn_1")!;
    expect(updated.phase).toBe("gate");
    expect(updated.gateRound).toBe(2);
  });

  it("persists evidence with provenance", () => {
    const evidence = store.saveEvidence(
      "msn_1",
      "elite",
      {
        title: "certbot path",
        claim: "certbot provisions Let's Encrypt certificates",
        sourceType: "doc",
        sourceUrl: "https://example.com/certbot",
        confidence: 0.9,
      },
      "ev_1",
      "2026-01-01T00:00:00Z",
    );
    const all = store.listEvidence("msn_1");
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      id: "ev_1",
      lens: "elite",
      confidence: 0.9,
      sourceUrl: "https://example.com/certbot",
      status: "raw",
    });
    expect(evidence.contradicts).toEqual([]);
  });

  it("round-trips lens reports and synthesis", () => {
    store.saveLensReport("msn_1", { lens: "elite", summary: "s", findings: [], blindSpots: ["b1"] }, "t");
    store.saveSynthesis(
      "msn_1",
      {
        terrainSummary: "t",
        keyClaims: [],
        contradictions: [],
        dependencies: [{ type: "account", name: "VPS", requiredFor: "server" }],
        method: "m",
        verification: [{ criterion: "c", method: "m" }],
        coveredUnknowns: [],
        proStandards: [],
        risks: [],
      },
      "t",
    );
    expect(store.listLensReports("msn_1")[0]!.blindSpots).toEqual(["b1"]);
    expect(store.getSynthesis("msn_1")!.dependencies).toHaveLength(1);
  });

  it("tracks gaps and gate rounds", () => {
    store.saveGap({
      id: "gap_1",
      missionId: "msn_1",
      question: "What did we overlook?",
      description: "d",
      severity: "material",
      owningLens: "elite",
      source: "deterministic",
      status: "open",
      round: 1,
      createdAt: "t",
    });
    expect(store.listGaps("msn_1", ["open"])).toHaveLength(1);
    store.updateGapStatus("gap_1", "closed", "ev_9");
    const closed = store.listGaps("msn_1")[0]!;
    expect(closed.status).toBe("closed");
    expect(closed.closedBy).toBe("ev_9");

    store.saveGateRound({ missionId: "msn_1", round: 1, verdict: "revise", rationale: "r", gaps: [], checkedAt: "t" });
    expect(store.listGateRounds("msn_1")).toHaveLength(1);
  });

  it("stores attempts and lessons; recalls lessons by tag overlap", () => {
    store.saveLesson({
      id: "lsn_1",
      missionId: "msn_1",
      statement: "DNS propagation took longer than planned",
      kind: "failed",
      tags: ["vps", "dns"],
      createdAt: "t",
    });
    store.saveLesson({
      id: "lsn_2",
      missionId: "msn_2",
      statement: "unrelated lesson",
      kind: "worked",
      tags: ["cooking"],
      createdAt: "t",
    });

    const recalled = store.findLessonsByTags(["vps"]);
    expect(recalled).toHaveLength(1);
    expect(recalled[0]!.statement).toContain("DNS");
    expect(store.findLessonsByTags(["deployment"])).toHaveLength(0);
  });

  it("lists missions newest first", () => {
    store.createMission("a", buildBrief("a", {}), false, "msn_a", "2026-01-01T00:00:00Z");
    store.createMission("b", buildBrief("b", {}), false, "msn_b", "2026-01-02T00:00:00Z");
    const missions = store.listMissions();
    expect(missions.map((m) => m.id)).toEqual(["msn_b", "msn_a"]);
  });
});
