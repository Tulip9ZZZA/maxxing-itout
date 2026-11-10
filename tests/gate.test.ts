/**
 * THE ADVERSARIAL TERRAIN GATE SUITE.
 *
 * Every test plants a specific flaw a real mission could contain — missing
 * dependency, silent lens, misleading source, unmapped verification,
 * unresolved contradiction — and asserts the gate refuses to pass it.
 */

import { describe, expect, it } from "vitest";
import {
  decideVerdict,
  deterministicChecks,
  parseGateOutput,
} from "../src/pipeline/gate.js";
import { parseLensReport } from "../src/pipeline/lenses.js";
import { parseSynthesis } from "../src/pipeline/synthesize.js";
import type {
  Evidence,
  LensReport,
  MissionBrief,
  Synthesis,
} from "../src/core/types.js";
import { LENS_IDS } from "../src/core/types.js";
import { buildBrief } from "../src/pipeline/preflight.js";

const BRIEF: MissionBrief = buildBrief("deploy the user's static site to a VPS with HTTPS", {
  successCriteria: ["site reachable over HTTPS on the user's domain"],
  knownUnknowns: ["which VPS provider fits the budget"],
  tags: ["vps"],
});

function evidence(id: string, claim: string, confidence = 0.8, lens = "elite"): Evidence {
  return {
    id,
    missionId: "msn_test",
    lens: lens as Evidence["lens"],
    sourceType: "web",
    title: id,
    claim,
    confidence,
    capturedAt: "t",
    status: "raw",
    contradicts: [],
  };
}

function report(lens: string, claims: string[], blindSpots: string[] = []): LensReport {
  return {
    lens: lens as LensReport["lens"],
    summary: "observed terrain",
    findings: claims.map((claim, i) => ({
      title: `f${i}`,
      claim,
      sourceType: "web",
      confidence: 0.8,
      contradicts: [],
    })),
    blindSpots,
  };
}

function synthesis(overrides: Partial<Synthesis> = {}): Synthesis {
  return {
    terrainSummary: "terrain",
    keyClaims: [{ evidenceId: "ev_1", claim: "certbot provisions certificates" }],
    contradictions: [],
    dependencies: [{ type: "account", name: "VPS account", requiredFor: "server" }],
    method: "provision, DNS, nginx, certbot, deploy",
    verification: [{ criterion: "site reachable over HTTPS on the user's domain", method: "curl -I" }],
    coveredUnknowns: ["which VPS provider fits the budget"],
    proStandards: ["redirect HTTP to HTTPS"],
    risks: [],
    ...overrides,
  };
}

function allReports(): LensReport[] {
  return LENS_IDS.map((lens) =>
    report(lens, [
      `${lens}: the standard HTTPS path on a VPS uses certbot and DNS must point at the server first`,
    ]),
  );
}

function baseEvidence(): Evidence[] {
  return [
    evidence("ev_1", "certbot provisions Let's Encrypt certificates on a VPS"),
    evidence("ev_2", "a VPS requires an account with a provider"),
    evidence("ev_3", "DNS must point at the server before certificate issuance"),
  ];
}

function cleanInput() {
  return {
    brief: BRIEF,
    reports: allReports(),
    evidence: baseEvidence(),
    synthesis: synthesis(),
    minEvidence: 3,
  };
}

describe("deterministic gate checks — the gate must catch planted flaws", () => {
  it("1. a clean, well-mapped mission passes with no gaps", () => {
    const gaps = deterministicChecks(cleanInput());
    expect(gaps).toEqual([]);
    expect(decideVerdict(gaps, 1, 3).verdict).toBe("pass");
  });

  it("2. MISSING DEPENDENCY: empty dependency inventory is a material gap", () => {
    const gaps = deterministicChecks({
      ...cleanInput(),
      synthesis: synthesis({ dependencies: [] }),
    });
    const hit = gaps.find((g) => g.description.includes("dependency inventory is missing"));
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe("material");
  });

  it("3. SILENT LENS: a lens with zero findings is a material gap owned by that lens", () => {
    const reports = allReports();
    reports[2] = report("fundamentals", []);
    const gaps = deterministicChecks({ ...cleanInput(), reports });
    const hit = gaps.find((g) => g.description.startsWith("fundamentals lens is silent"));
    expect(hit).toBeDefined();
    expect(hit!.owningLens).toBe("fundamentals");
    expect(hit!.severity).toBe("material");
  });

  it("4. UNVERIFIED ASSUMPTION: an unaddressed lens blind spot is a material gap", () => {
    const reports = allReports();
    reports[0] = report("elite", ["top operators use certbot"], ["docker image caching behavior on this VPS is unverified"]);
    const gaps = deterministicChecks({ ...cleanInput(), reports });
    const hit = gaps.find((g) => g.description.includes("unaddressed blind spot from elite"));
    expect(hit).toBeDefined();
    expect(hit!.owningLens).toBe("elite");
  });

  it("5. MISLEADING SOURCE: a key claim anchored on low-confidence evidence is rejected", () => {
    const ev = [evidence("ev_1", "some blog says this works", 0.2), evidence("ev_2", "fact two"), evidence("ev_3", "fact three")];
    const gaps = deterministicChecks({
      ...cleanInput(),
      evidence: ev,
      synthesis: synthesis(),
    });
    const hit = gaps.find((g) => g.description.includes("low-confidence evidence ev_1"));
    expect(hit).toBeDefined();
    expect(hit!.question).toContain("impressive demonstration");
  });

  it("6. FABRICATED CITATION: a key claim citing evidence that does not exist is a material gap", () => {
    const gaps = deterministicChecks({
      ...cleanInput(),
      synthesis: synthesis({ keyClaims: [{ evidenceId: "ev_fabricated", claim: "made up" }] }),
    });
    const hit = gaps.find((g) => g.description.includes("cites unknown evidence ev_fabricated"));
    expect(hit).toBeDefined();
  });

  it("7. INCOMPLETE PLAN: a success criterion with no verification method is a material gap", () => {
    const gaps = deterministicChecks({
      ...cleanInput(),
      brief: buildBrief("deploy", { successCriteria: ["site reachable over HTTPS", "costs under $10/month"], tags: ["vps"] }),
    });
    const hit = gaps.find((g) => g.description.includes("no verification plan") && g.description.includes("costs under $10/month"));
    expect(hit).toBeDefined();
  });

  it("8. CONTRADICTION: unresolved contradictory evidence blocks the pass", () => {
    const ev = baseEvidence();
    ev[0] = { ...ev[0]!, contradicts: ["ev_2"] };
    const gaps = deterministicChecks({ ...cleanInput(), evidence: ev });
    const hit = gaps.find((g) => g.description.includes("contradiction unresolved"));
    expect(hit).toBeDefined();
    expect(hit!.severity).toBe("material");
  });

  it("9. UNEXPLORED UNKNOWN: a known unknown the lenses never touched is a material gap", () => {
    const gaps = deterministicChecks({
      ...cleanInput(),
      synthesis: synthesis({ coveredUnknowns: [] }),
    });
    const hit = gaps.find((g) => g.description.includes("never explored"));
    expect(hit).toBeDefined();
  });

  it("10. THIN SCOUTING: below the evidence floor is a material gap", () => {
    const gaps = deterministicChecks({ ...cleanInput(), evidence: baseEvidence().slice(0, 1) });
    const hit = gaps.find((g) => g.description.includes("scouting was too thin"));
    expect(hit).toBeDefined();
  });

  it("11. NO SYNTHESIS: blocker", () => {
    const gaps = deterministicChecks({ ...cleanInput(), synthesis: null });
    expect(gaps).toHaveLength(1);
    expect(gaps[0]!.severity).toBe("blocker");
  });
});

describe("verdict logic", () => {
  const material = {
    question: "What did we overlook?",
    description: "material gap",
    severity: "material" as const,
    owningLens: "none" as const,
    source: "deterministic" as const,
  };
  const minor = { ...material, severity: "minor" as const };
  const blocker = { ...material, severity: "blocker" as const };

  it("material gaps mean revise below the cap", () => {
    expect(decideVerdict([material], 1, 3).verdict).toBe("revise");
  });

  it("material gaps at the cap become explicit blockers", () => {
    const decision = decideVerdict([material], 3, 3);
    expect(decision.verdict).toBe("blocked");
    expect(decision.rationale).toContain("explicit blockers");
  });

  it("a blocker-severity gap blocks immediately, even in round one", () => {
    expect(decideVerdict([blocker], 1, 5).verdict).toBe("blocked");
  });

  it("minor gaps alone pass, logged", () => {
    const decision = decideVerdict([minor], 1, 3);
    expect(decision.verdict).toBe("pass");
    expect(decision.rationale).toContain("minor");
  });
});

describe("gate agent output parsing", () => {
  it("normalizes valid gaps", () => {
    const out = parseGateOutput('```json\n{"gaps": [{"question": "What did we overlook?", "description": "d", "severity": "minor", "owning_lens": "reverse"}], "rationale": "r"}\n```');
    expect(out.candidates).toHaveLength(1);
    expect(out.candidates[0]).toMatchObject({ severity: "minor", owningLens: "reverse", source: "gate-agent" });
  });

  it("repairs unknown lens names and severities instead of crashing", () => {
    const out = parseGateOutput('{"gaps": [{"question": "nonsense", "description": "d", "severity": "huge", "owning_lens": "meteor"}]}');
    expect(out.candidates[0]!.owningLens).toBe("none");
    expect(out.candidates[0]!.severity).toBe("material");
  });

  it("unparseable gate output degrades to a minor gap, never a fake pass", () => {
    const out = parseGateOutput("the gate has opinions but no JSON");
    expect(out.candidates[0]!.severity).toBe("minor");
    expect(out.candidates[0]!.description).toContain("unparseable");
  });
});

describe("pipeline parsers", () => {
  it("lens report with snake_case JSON parses into camelCase domain types", () => {
    const report = parseLensReport("elite", '```json\n{"summary": "s", "findings": [{"title": "t", "claim": "c", "source_type": "web", "confidence": 0.7}], "blind_spots": ["b"]}\n```');
    expect(report.findings[0]).toMatchObject({ claim: "c", confidence: 0.7, sourceType: "web" });
    expect(report.blindSpots).toEqual(["b"]);
  });

  it("garbage lens output becomes a silent-lens report, not a crash", () => {
    const report = parseLensReport("reverse", "prose only");
    expect(report.findings).toHaveLength(0);
    expect(report.blindSpots[0]).toContain("unparseable");
  });

  it("synthesis parser maps snake_case and drops malformed entries", () => {
    const s = parseSynthesis('{"terrain_summary": "t", "key_claims": [{"evidence_id": "ev_1", "claim": "c"}, {"claim": "no id"}], "dependencies": [{"type": "account", "name": "n", "required_for": "r"}, {"name": "incomplete"}], "verification": [{"criterion": "c", "method": "m"}], "covered_unknowns": ["u"], "pro_standards": ["p"], "risks": []}');
    expect(s).not.toBeNull();
    expect(s!.keyClaims).toHaveLength(1);
    expect(s!.dependencies).toHaveLength(1);
    expect(s!.verification).toHaveLength(1);
  });
});
