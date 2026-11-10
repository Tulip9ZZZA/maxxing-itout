/**
 * THE TERRAIN GATE — layer six.
 *
 * Not a sixth lens. The mandatory filter between scouting and execution.
 * It runs two kinds of inspection:
 *
 * 1. Deterministic checks — code, not vibes. A missing dependency inventory,
 *    a silent lens, an unaddressed blind spot, a success criterion with no
 *    verification plan, a low-confidence claim anchoring the synthesis, an
 *    unresolved contradiction. These fail the gate regardless of what any
 *    model says.
 * 2. A hostile gate-agent pass over the synthesis, answering the nine gate
 *    questions with specific gaps.
 *
 * Every gap is logged. Material gaps route back to the lens that owns them.
 * Only a round with no open material gaps passes.
 */

import type { AgentClient } from "../agent/client.js";
import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import type {
  Evidence,
  GateQuestion,
  GapCandidate,
  GapSeverity,
  LensId,
  LensReport,
  MissionBrief,
  Synthesis,
} from "../core/types.js";
import { GATE_QUESTIONS, LENS_IDS } from "../core/types.js";
import { extractJson, keywordOverlap } from "../core/parse.js";
import { newId, nowIso } from "../core/ids.js";
import { fillPrompt, loadPrompt } from "../prompts.js";
import type { Logger } from "../log.js";
import type { TerrainStore } from "../store/store.js";
import { parseLensReport, type LensRunOptions } from "./lenses.js";

export interface GateCheckInput {
  brief: MissionBrief;
  reports: LensReport[];
  evidence: Evidence[];
  synthesis: Synthesis | null;
  minEvidence: number;
}

export interface GateDecision {
  candidates: GapCandidate[];
  verdict: "pass" | "revise" | "blocked";
  rationale: string;
}

// ---- deterministic checks ----

export function deterministicChecks(input: GateCheckInput): GapCandidate[] {
  const gaps: GapCandidate[] = [];
  const { brief, reports, evidence, synthesis } = input;

  if (!synthesis) {
    gaps.push({
      question: "What could make this entire plan fail when it meets reality?",
      description: "no synthesis exists; there is nothing to execute against",
      severity: "blocker",
      owningLens: "none",
      source: "deterministic",
    });
    return gaps;
  }

  // 1. Every lens must have reported.
  for (const lens of LENS_IDS) {
    const report = reports.find((r) => r.lens === lens);
    if (!report) {
      gaps.push(silentLensGap(lens, "lens produced no report at all"));
    } else if (report.findings.length === 0) {
      gaps.push(silentLensGap(lens, report.summary));
    }
  }

  // 2. Every blind spot must be covered by synthesis (covered unknowns, risks)
  //    or already tracked as a gap. Uncovered blind spots are unverified
  //    assumptions wearing a badge.
  const coverageText = [
    ...synthesis.coveredUnknowns,
    ...synthesis.risks,
  ].join(" \n ");
  for (const report of reports) {
    for (const blindSpot of report.blindSpots) {
      if (!keywordOverlap(blindSpot, coverageText)) {
        gaps.push({
          question: "Which assumptions remain unverified?",
          description: `unaddressed blind spot from ${report.lens} lens: ${blindSpot}`,
          severity: "material",
          owningLens: report.lens,
          source: "deterministic",
        });
      }
    }
  }

  // 3. Dependency inventory must exist and be non-empty. Missions fail on the
  //    account you did not know you needed, not on the code you did not write.
  if (synthesis.dependencies.length === 0) {
    gaps.push({
      question: "Which dependencies, tools, resources, or constraints did we fail to investigate?",
      description: "synthesis lists no dependencies (tools, accounts, permissions, environments); the dependency inventory is missing",
      severity: "material",
      owningLens: "none",
      source: "deterministic",
    });
  }

  // 4. Every success criterion needs a verification method.
  for (const criterion of brief.successCriteria) {
    const mapped = synthesis.verification.some((v) => keywordOverlap(v.criterion, criterion));
    if (!mapped) {
      gaps.push({
        question: "What did we overlook?",
        description: `success criterion has no verification plan: "${criterion}"`,
        severity: "material",
        owningLens: "none",
        source: "deterministic",
      });
    }
  }

  // 5. Unresolved contradictions. Two raw evidence records that contradict
  //    each other mean the terrain is not mapped yet.
  for (const record of evidence) {
    if (record.contradicts.length === 0) continue;
    if (record.status !== "raw") continue;
    for (const peerId of record.contradicts) {
      const peer = evidence.find((e) => e.id === peerId);
      if (peer && peer.status === "raw") {
        gaps.push({
          question: "What contradicts our current understanding?",
          description: `contradiction unresolved between evidence ${record.id} ("${record.claim}") and ${peer.id} ("${peer.claim}")`,
          severity: "material",
          owningLens: record.lens as LensId | "none",
          source: "deterministic",
        });
      }
    }
  }

  // 6. Known unknowns from the brief must be explored or tracked.
  const unknownText = [...synthesis.coveredUnknowns, ...synthesis.risks].join(" \n ");
  for (const unknown of brief.knownUnknowns) {
    if (!keywordOverlap(unknown, unknownText)) {
      gaps.push({
        question: "What important information is missing?",
        description: `known unknown from the brief was never explored: "${unknown}"`,
        severity: "material",
        owningLens: "none",
        source: "deterministic",
      });
    }
  }

  // 7. Evidence thin. Five reports and three facts is a vibe, not terrain.
  if (evidence.length < input.minEvidence) {
    gaps.push({
      question: "What important information is missing?",
      description: `only ${evidence.length} evidence records captured (minimum ${input.minEvidence}); scouting was too thin to trust`,
      severity: "material",
      owningLens: "none",
      source: "deterministic",
    });
  }

  // 8. Misleading-source guard: a synthesis key claim anchored on
  //    low-confidence evidence. Impressive demos die here.
  for (const keyClaim of synthesis.keyClaims) {
    const backing = evidence.find((e) => e.id === keyClaim.evidenceId);
    if (!backing) {
      gaps.push({
        question: "Did we mistake an impressive demonstration for a proven implementation?",
        description: `key claim cites unknown evidence ${keyClaim.evidenceId}: "${keyClaim.claim}"`,
        severity: "material",
        owningLens: "none",
        source: "deterministic",
      });
    } else if (backing.confidence < 0.4) {
      gaps.push({
        question: "Did we mistake an impressive demonstration for a proven implementation?",
        description: `key claim rests on low-confidence evidence ${backing.id} (confidence ${backing.confidence.toFixed(2)}): "${keyClaim.claim}"`,
        severity: "material",
        owningLens: backing.lens as LensId | "none",
        source: "deterministic",
      });
    }
  }

  return gaps;
}

function silentLensGap(lens: LensId, detail: string): GapCandidate {
  return {
    question: "What did we overlook?",
    description: `${lens} lens is silent (${detail}); the terrain has an unmapped side`,
    severity: "material",
    owningLens: lens,
    source: "deterministic",
  };
}

// ---- gate agent ----

export interface GateAgentOutput {
  candidates: GapCandidate[];
  rationale: string;
}

export async function runGateAgent(
  client: AgentClient,
  brief: MissionBrief,
  reports: LensReport[],
  evidence: Evidence[],
  synthesis: Synthesis,
  opts: { model: string; maxTurns: number; permissionMode: "default" | "acceptEdits" | "plan" | "bypassPermissions"; allowedTools: string[]; canUseTool?: CanUseTool },
): Promise<GateAgentOutput> {
  const prompt = fillPrompt(loadPrompt("terrain-gate"), {
    mission: brief.objective,
    questions: GATE_QUESTIONS.map((q, i) => `${i + 1}. ${q}`).join("\n"),
    synthesis: JSON.stringify(synthesis, null, 2),
    evidence: evidence.map((e) => `${e.id} [${e.lens}] (conf ${e.confidence.toFixed(2)}) ${e.claim}`).join("\n"),
    lensSummaries: reports.map((r) => `### ${r.lens}\n${r.summary}\nBlind spots: ${r.blindSpots.join("; ") || "none stated"}`).join("\n\n"),
    criteria: brief.successCriteria.map((c) => `- ${c}`).join("\n"),
  });

  const { text } = await client.run(prompt, {
    systemPrompt: loadPrompt("gate-shared"),
    model: opts.model,
    maxTurns: opts.maxTurns,
    permissionMode: opts.permissionMode,
    allowedTools: opts.allowedTools,
    canUseTool: opts.canUseTool,
  });

  return parseGateOutput(text);
}

export function parseGateOutput(text: string): GateAgentOutput {
  const parsed = extractJson<{
    gaps?: {
      question?: unknown;
      description?: unknown;
      severity?: unknown;
      owning_lens?: unknown;
    }[];
    rationale?: unknown;
  }>(text);

  if (!parsed || !Array.isArray(parsed.gaps)) {
    return {
      candidates: [
        {
          question: "What did we overlook?",
          description: "gate agent output was unparseable; only deterministic checks ran this round",
          severity: "minor",
          owningLens: "none",
          source: "gate-agent",
        },
      ],
      rationale: "gate output unparseable",
    };
  }

  const candidates: GapCandidate[] = [];
  for (const raw of parsed.gaps) {
    if (!raw || typeof raw.description !== "string" || raw.description.trim().length === 0) continue;
    candidates.push({
      question: normalizeQuestion(raw.question),
      description: raw.description.trim(),
      severity: normalizeSeverity(raw.severity),
      owningLens: normalizeLens(raw.owning_lens),
      source: "gate-agent",
    });
  }

  return {
    candidates,
    rationale: typeof parsed.rationale === "string" ? parsed.rationale : "",
  };
}

function normalizeQuestion(value: unknown): GateQuestion {
  if (typeof value === "string") {
    const found = GATE_QUESTIONS.find((q) => q.toLowerCase() === value.trim().toLowerCase());
    if (found) return found;
  }
  return "What did we overlook?";
}

function normalizeSeverity(value: unknown): GapSeverity {
  return value === "minor" || value === "blocker" || value === "material" ? value : "material";
}

function normalizeLens(value: unknown): LensId | "none" {
  if (typeof value === "string" && (LENS_IDS as readonly string[]).includes(value)) {
    return value as LensId;
  }
  return "none";
}

// ---- verdict ----

export function decideVerdict(
  candidates: GapCandidate[],
  round: number,
  maxRounds: number,
): { verdict: "pass" | "revise" | "blocked"; rationale: string } {
  const blockers = candidates.filter((g) => g.severity === "blocker");
  const material = candidates.filter((g) => g.severity === "material");

  if (blockers.length > 0) {
    return {
      verdict: "blocked",
      rationale: `${blockers.length} fatal gap(s): ${blockers.map((g) => g.description).join(" | ").slice(0, 400)}`,
    };
  }
  if (material.length > 0) {
    if (round >= maxRounds) {
      return {
        verdict: "blocked",
        rationale: `${material.length} material gap(s) remain after ${round} round(s); they become explicit blockers`,
      };
    }
    return {
      verdict: "revise",
      rationale: `${material.length} material gap(s) routed back to their owning lenses`,
    };
  }
  return {
    verdict: "pass",
    rationale:
      candidates.length > 0
        ? `pass with ${candidates.length} minor gap(s) logged to the terrain map`
        : "pass: no gaps found this round",
  };
}

// ---- gap-targeted re-research ----

export interface RepairResult {
  evidence: Evidence[];
  closedGapIds: string[];
}

export async function repairGaps(
  client: AgentClient,
  store: TerrainStore,
  log: Logger,
  missionId: string,
  brief: MissionBrief,
  gaps: { id: string; description: string; owningLens: LensId | "none" }[],
  opts: LensRunOptions,
): Promise<RepairResult> {
  const result: RepairResult = { evidence: [], closedGapIds: [] };
  const at = nowIso();

  for (const gap of gaps) {
    const lens: LensId = gap.owningLens === "none" ? "first-principles" : gap.owningLens;
    log.info(`gate round: re-scouting ${lens} lens for gap`, { gap: gap.description.slice(0, 120) });

    const evidenceList = store.listEvidence(missionId)
      .map((e) => `${e.id} [${e.lens}] (conf ${e.confidence.toFixed(2)}) ${e.claim}`)
      .join("\n");
    const prompt = fillPrompt(loadPrompt("gap-research"), {
      mission: brief.objective,
      gap: gap.description,
      context: `Objective: ${brief.objective}\nConstraints: ${brief.constraints.join("; ") || "none stated"}\n\nEvidence ledger:\n${evidenceList || "(none yet)"}`,
      schema: LENS_REPORT_SCHEMA_IN_GAP,
    });

    try {
      const { text } = await client.run(prompt, {
        systemPrompt: loadPrompt("gap-research-shared"),
        model: opts.model,
        maxTurns: opts.maxTurns,
        permissionMode: opts.permissionMode,
        allowedTools: opts.allowedTools,
        cwd: opts.cwd,
        canUseTool: opts.canUseTool,
      });
      const report = parseLensReport(lens, text);
      store.saveLensReport(missionId, report, at);
      const newEvidence: Evidence[] = [];
      for (const finding of report.findings) {
        newEvidence.push(store.saveEvidence(missionId, lens, finding, newId("ev"), at));
      }
      result.evidence.push(...newEvidence);

      const relevant = newEvidence.some((e) => keywordOverlap(e.claim, gap.description));
      if (relevant) {
        result.closedGapIds.push(gap.id);
        store.updateGapStatus(gap.id, "closed", newEvidence.map((e) => e.id).join(","));
      } else {
        store.updateGapStatus(gap.id, "open");
      }
    } catch (error) {
      log.warn(`gap repair run failed for ${lens}`, { error: String(error) });
      store.updateGapStatus(gap.id, "open");
    }
  }

  return result;
}

const LENS_REPORT_SCHEMA_IN_GAP = `{
  "summary": "what you found addressing the gap",
  "findings": [{ "title": "short label", "claim": "specific fact addressing the gap", "source_type": "web | repo | doc | user | agent", "source_url": "url or omit", "quote": "backing quote or omit", "confidence": 0.0, "contradicts": [] }],
  "blind_spots": ["what you still could not verify"]
}`;

// ---- orchestrating one gate round ----

export interface GateRoundResult {
  verdict: "pass" | "revise" | "blocked";
  rationale: string;
  gaps: import("../core/types.js").Gap[];
  evidence: Evidence[];
  round: number;
}

export async function runGateRound(
  client: AgentClient,
  store: TerrainStore,
  log: Logger,
  missionId: string,
  brief: MissionBrief,
  reports: LensReport[],
  synthesis: Synthesis,
  round: number,
  maxRounds: number,
  minEvidence: number,
  opts: { model: string; maxTurns: number; permissionMode: "default" | "acceptEdits" | "plan" | "bypassPermissions"; allowedTools: string[]; canUseTool?: CanUseTool },
): Promise<GateRoundResult> {
  const evidence = store.listEvidence(missionId);
  const deterministic = deterministicChecks({ brief, reports, evidence, synthesis, minEvidence });

  // The hostile pass is mandatory. If it cannot run (agent death, turn
  // exhaustion, unparseable refusal), the round does NOT pass on deterministic
  // checks alone — a silent hostile layer is not the same as its approval.
  let agentOutput: GateAgentOutput;
  try {
    agentOutput = await runGateAgent(client, brief, reports, evidence, synthesis, opts);
  } catch (error) {
    log.error("gate agent failed; blocking the round", { error: String(error).slice(0, 200) });
    const at = nowIso();
    const failedRound: import("../core/types.js").GateRoundRecord = {
      missionId, round, verdict: "blocked",
      rationale: `gate agent failed (${String(error).slice(0, 120)}); the hostile pass did not run, so nothing passed`,
      gaps: [], checkedAt: at,
    };
    store.saveGateRound(failedRound);
    return { verdict: "blocked", rationale: failedRound.rationale, gaps: [], evidence: [], round };
  }
  log.info(`gate agent found ${agentOutput.candidates.length} gap(s)`, { rationale: agentOutput.rationale.slice(0, 200) });

  const candidates = dedupeCandidates([...deterministic, ...agentOutput.candidates]);
  const decision = decideVerdict(candidates, round, maxRounds);

  const at = nowIso();
  const gaps: import("../core/types.js").Gap[] = candidates.map((candidate) => {
    const gap: import("../core/types.js").Gap = {
      id: newId("gap"),
      missionId,
      question: candidate.question,
      description: candidate.description,
      severity: candidate.severity,
      owningLens: candidate.owningLens,
      source: candidate.source,
      status: decision.verdict === "pass" ? "closed" : "open",
      round,
      createdAt: at,
      closedBy: decision.verdict === "pass" ? "gate passed with gap logged" : undefined,
    };
    store.saveGap(gap);
    return gap;
  });

  store.saveGateRound({ missionId, round, verdict: decision.verdict, rationale: decision.rationale, gaps, checkedAt: at });
  log.event(`gate round ${round}: ${decision.verdict}`, { material: candidates.filter((c) => c.severity === "material").length });

  return {
    verdict: decision.verdict,
    rationale: decision.rationale,
    gaps,
    evidence: [],
    round,
  };
}

function dedupeCandidates(candidates: GapCandidate[]): GapCandidate[] {
  const seen = new Set<string>();
  const out: GapCandidate[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.question}::${candidate.owningLens}::${candidate.description.toLowerCase().slice(0, 60)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out;
}
