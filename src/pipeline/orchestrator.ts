/**
 * The Gauntlet — the orchestrating state machine.
 *
 * preflight → lenses (parallel) → synthesis → TERRAIN GATE (revise loop,
 * capped) → [scout-only stop] → execute → verify → lessons → done.
 *
 * Every phase transition is persisted before the next phase starts, so a
 * crashed run resumes exactly where it stopped. Completion reports separate
 * what was verified from what was not.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import type { AgentClient } from "../agent/client.js";
import type { MaxxingConfig } from "../config.js";
import { missionDir } from "../config.js";
import { consoleLogger, silentLogger, type Logger } from "../log.js";
import type { TerrainStore } from "../store/store.js";
import type {
  Attempt,
  Evidence,
  GateVerdict,
  Lesson,
  MissionOutcome,
  MissionRecord,
  MissionBrief,
  Synthesis,
  LensReport,
} from "../core/types.js";
import { newId, nowIso } from "../core/ids.js";
import { runPreflight, type BriefOverrides } from "./preflight.js";
import { runLenses } from "./lenses.js";
import { synthesize } from "./synthesize.js";
import { repairGaps, runGateRound } from "./gate.js";
import { executeMission, verifyAttempt } from "./execute.js";
import { loadPrompt, fillPrompt } from "../prompts.js";

export interface OrchestratorDeps {
  client: AgentClient;
  store: TerrainStore;
  config: MaxxingConfig;
  canUseTool?: CanUseTool;
  log?: Logger;
}

export interface RunFlags {
  scoutOnly?: boolean;
  briefOverrides?: BriefOverrides;
  quiet?: boolean;
}

const SCOUT_TOOLS = ["WebSearch", "WebFetch", "Read", "Glob", "Grep"];
const GATE_TOOLS = ["Read", "Glob", "Grep"];

export class Gauntlet {
  private readonly client: AgentClient;
  private readonly store: TerrainStore;
  private readonly config: MaxxingConfig;
  private readonly canUseTool?: CanUseTool;
  private readonly log: Logger;

  constructor(deps: OrchestratorDeps) {
    this.client = deps.client;
    this.store = deps.store;
    this.config = deps.config;
    this.canUseTool = deps.canUseTool;
    this.log = deps.log ?? silentLogger();
  }

  private scoutOpts() {
    return {
      model: this.config.model,
      maxTurns: this.config.maxTurnsPerLens,
      permissionMode: this.config.permissionMode,
      allowedTools: this.config.webScout ? SCOUT_TOOLS : ["Read", "Glob", "Grep"],
      cwd: process.cwd(),
      canUseTool: this.canUseTool,
    };
  }

  private execOpts(dir: string) {
    return {
      model: this.config.model,
      maxTurns: this.config.maxTurnsPerExecutor,
      permissionMode: this.config.permissionMode,
      cwd: dir,
      codeExecution: this.config.codeExecution,
      canUseTool: this.canUseTool,
    };
  }

  async runMission(objective: string, flags: RunFlags = {}): Promise<MissionOutcome> {
    const id = newId("msn");
    const at = nowIso();
    mkdirSync(missionDir(this.config, id), { recursive: true });
    const logger = flags.quiet ? silentLogger() : consoleLogger(missionDir(this.config, id));
    this.log.event(`mission ${id} starting`, { objective: objective.slice(0, 120) });

    const preflight = await runPreflight(this.client, objective, flags.briefOverrides ?? {}, {
      systemPrompt: loadPrompt("preflight-shared"),
      model: this.config.model,
      maxTurns: this.config.maxTurnsPerLens,
      permissionMode: this.config.permissionMode,
      canUseTool: this.canUseTool,
    });
    const mission = this.store.createMission(objective, preflight.brief, flags.scoutOnly === true, id, at);
    this.store.updateMission(id, { phase: "lenses" });
    logger.event("preflight complete", { assumptions: preflight.brief.assumptions.length });

    return this.runFromPhase(mission, logger);
  }

  async resumeMission(missionId: string, flags: RunFlags = {}): Promise<MissionOutcome> {
    const mission = this.store.getMission(missionId);
    if (!mission) throw new Error(`mission ${missionId} not found`);
    const logger = flags.quiet ? silentLogger() : consoleLogger(missionDir(this.config, missionId));
    logger.event(`resuming mission at phase ${mission.phase}`, {});
    return this.runFromPhase(mission, logger);
  }

  private async runFromPhase(mission: MissionRecord, logger: Logger): Promise<MissionOutcome> {
    let brief = mission.brief;
    let reports: LensReport[] = [];
    let synthesis: Synthesis | null = null;
    let attempt: Attempt | null = null;
    let verdict: GateVerdict | null = null;

    const dir = missionDir(this.config, mission.id);
    mkdirSync(dir, { recursive: true });

    if (mission.phase === "preflight") {
      const preflight = await runPreflight(this.client, mission.objective, {}, {
        systemPrompt: loadPrompt("preflight-shared"),
        model: this.config.model,
        maxTurns: this.config.maxTurnsPerLens,
        permissionMode: this.config.permissionMode,
      });
      brief = preflight.brief;
      this.store.updateMission(mission.id, { phase: "lenses", brief });
    }

    if (["preflight", "lenses"].includes(mission.phase)) {
      logger.event("scouting: five lenses in parallel", { model: this.config.model });
      const lensResult = await runLenses(this.client, this.store, logger, mission.id, brief, this.scoutOpts());
      reports = lensResult.reports;
      this.store.updateMission(mission.id, { phase: "synthesis" });
    } else {
      reports = this.store.listLensReports(mission.id);
    }

    if (["preflight", "lenses", "synthesis"].includes(mission.phase)) {
      const evidence = this.store.listEvidence(mission.id);
      synthesis = await synthesize(this.client, brief, reports, evidence, this.scoutOpts());
      if (synthesis) {
        this.store.saveSynthesis(mission.id, synthesis, nowIso());
        this.store.markContradictions(mission.id, synthesis.contradictions);
      } else {
        logger.warn("synthesis unparseable; the gate will block on it");
      }
      this.store.updateMission(mission.id, { phase: "gate", gateRound: 0 });
    } else {
      synthesis = this.store.getSynthesis(mission.id);
    }

    // ---- THE TERRAIN GATE ----
    // A mission persisted as "blocked" re-enters the gate on resume: the user
    // may have closed the blocker (created the account, granted the access),
    // and the gate is the component that verifies that.
    if (["preflight", "lenses", "synthesis", "gate", "blocked"].includes(mission.phase)) {
      if (synthesis === null) {
        verdict = "blocked";
        this.store.updateMission(mission.id, { phase: "blocked" });
        return this.finish(mission.id, brief, "blocked", verdict, attempt, logger);
      }

      let round = mission.phase === "gate" ? mission.gateRound : 0;

      while (round < this.config.maxGateRounds) {
        round += 1;
        this.store.updateMission(mission.id, { gateRound: round });
        const gateResult = await runGateRound(
          this.client, this.store, logger, mission.id, brief, reports, synthesis,
          round, this.config.maxGateRounds, this.config.minEvidence,
          { ...this.scoutOpts(), allowedTools: GATE_TOOLS },
        );
        verdict = gateResult.verdict;

        if (gateResult.verdict === "pass") break;

        const openMaterial = gateResult.gaps.filter((g) => g.severity === "material" && g.status === "open");
        if (gateResult.verdict === "blocked" || openMaterial.length === 0) {
          this.store.updateMission(mission.id, { phase: "blocked" });
          return this.finish(mission.id, brief, "blocked", verdict, attempt, logger);
        }

        // Round the gate to its owning lenses. Only material gaps route back.
        const repair = await repairGaps(
          this.client, this.store, logger, mission.id, brief,
          openMaterial.map((g) => ({ id: g.id, description: g.description, owningLens: g.owningLens })),
          this.scoutOpts(),
        );
        reports = this.store.listLensReports(mission.id);
        const allEvidence = this.store.listEvidence(mission.id);
        synthesis = await synthesize(this.client, brief, reports, allEvidence, this.scoutOpts());
        if (synthesis) {
          this.store.saveSynthesis(mission.id, synthesis, nowIso());
          this.store.markContradictions(mission.id, synthesis.contradictions);
        } else {
          logger.warn("re-synthesis unparseable; next gate round will block");
          this.store.updateMission(mission.id, { phase: "blocked" });
          return this.finish(mission.id, brief, "blocked", "blocked", attempt, logger);
        }
      }

      if (verdict !== "pass") {
        this.store.updateMission(mission.id, { phase: "blocked" });
        return this.finish(mission.id, brief, "blocked", verdict, attempt, logger);
      }
      this.store.updateMission(mission.id, { phase: mission.scoutOnly ? "done" : "execute" });
    }

    const storedRound = this.store.getMission(mission.id);
    if (storedRound?.scoutOnly && verdict === "pass") {
      return this.finish(mission.id, brief, "done", verdict, attempt, logger);
    }

    // ---- EXECUTE ----
    // "blocked" is in this list because a resumed blocked mission carries the
    // stale phase in `mission` — reaching this block means the gate above just
    // passed, which is the only condition under which execution may start.
    if (["preflight", "lenses", "synthesis", "gate", "execute", "blocked"].includes(mission.phase)) {
      if (!synthesis) {
        this.store.updateMission(mission.id, { phase: "blocked" });
        return this.finish(mission.id, brief, "blocked", "blocked", attempt, logger);
      }
      logger.event("gate passed: executing");
      try {
        attempt = await executeMission(this.client, this.store, logger, mission.id, brief, synthesis, this.execOpts(dir));
      } catch (error) {
        logger.error("executor failed; blocking with the reason", { error: String(error).slice(0, 200) });
        this.store.updateMission(mission.id, { phase: "blocked" });
        return this.finish(mission.id, brief, "blocked", "blocked", attempt, logger);
      }
      this.store.updateMission(mission.id, { phase: "verify" });
    } else if (mission.phase === "verify" || mission.phase === "done") {
      const attempts = this.store.listAttempts(mission.id);
      attempt = attempts.length > 0 ? attempts[attempts.length - 1]! : null;
      synthesis = synthesis ?? this.store.getSynthesis(mission.id);
    }

    // ---- VERIFY ----
    if (synthesis && attempt && attempt.verification.length === 0 && mission.phase !== "done") {
      try {
        attempt = await verifyAttempt(this.client, this.store, logger, attempt, synthesis, this.execOpts(dir));
      } catch (error) {
        logger.error("verifier failed; the attempt stays unverified", { error: String(error).slice(0, 200) });
      }
    }

    this.store.updateMission(mission.id, { phase: "done" });
    return this.finish(mission.id, brief, "done", verdict, attempt, logger);
  }

  /** Extract lessons and write the honest completion report. */
  private async finish(
    missionId: string,
    brief: MissionBrief,
    phase: "done" | "blocked",
    verdict: GateVerdict | null,
    attempt: Attempt | null,
    logger: Logger,
  ): Promise<MissionOutcome> {
    const gaps = this.store.listGaps(missionId);
    const existingLessons = this.store.listLessons(missionId);
    const lessons: Lesson[] = [];
    const at = nowIso();
    const alreadyLogged = (statement: string): boolean =>
      existingLessons.some((l) => l.statement === statement);

    for (const gap of gaps.filter((g) => g.severity === "material" && g.status === "closed")) {
      const statement = `terrain gap caught and closed at the gate: ${gap.description}`;
      if (!alreadyLogged(statement)) {
        lessons.push({
          id: newId("lsn"),
          missionId,
          statement,
          kind: "gap-pattern",
          tags: brief.tags,
          createdAt: at,
        });
      }
    }
    if (attempt) {
      const workedStatement = `verified execution: ${attempt.summary.slice(0, 300)}`;
      const failedStatement = `execution failed verification: ${attempt.summary.slice(0, 300)}`;
      if (attempt.verdict === "verified" && !alreadyLogged(workedStatement)) {
        lessons.push({
          id: newId("lsn"),
          missionId,
          statement: workedStatement,
          kind: "worked",
          conditions: attempt.deliverables.join(", ") || undefined,
          tags: brief.tags,
          createdAt: at,
        });
      } else if (attempt.verdict === "failed" && !alreadyLogged(failedStatement)) {
        lessons.push({
          id: newId("lsn"),
          missionId,
          statement: failedStatement,
          kind: "failed",
          conditions: attempt.verification.map((v) => `${v.criterion} -> ${v.detail}`).join("; ").slice(0, 400) || undefined,
          tags: brief.tags,
          createdAt: at,
        });
      }
    }
    for (const lesson of lessons) this.store.saveLesson(lesson);

    const openMaterialGaps = gaps.filter((g) => g.severity === "material" && (g.status === "open" || g.status === "accepted-blocker")).length;
    const blockers = gaps
      .filter((g) => g.severity === "blocker" || (phase === "blocked" && g.severity === "material" && g.status !== "closed"))
      .map((g) => g.description);
    const outcome: MissionOutcome = {
      missionId,
      phase,
      verdict,
      blockers,
      openMaterialGaps,
      attemptVerdict: attempt?.verdict ?? null,
      deliverables: attempt?.deliverables ?? [],
      lessons: this.store.listLessons(missionId).length,
    };

    const reportPath = this.writeReport(missionId, brief, outcome, attempt);
    logger.event(`mission ${phase}`, { report: reportPath });
    return { ...outcome, reportPath };
  }

  private writeReport(
    missionId: string,
    brief: MissionBrief,
    outcome: MissionOutcome,
    attempt: Attempt | null,
  ): string {
    const evidence = this.store.listEvidence(missionId);
    const rounds = this.store.listGateRounds(missionId);
    const gaps = this.store.listGaps(missionId);
    const lessons = this.store.listLessons(missionId);
    const lines: string[] = [];

    lines.push(`# Maxxing completion report — ${missionId}`);
    lines.push("");
    lines.push(`Objective: ${brief.objective}`);
    lines.push(`Outcome: ${outcome.phase}${outcome.verdict ? ` (gate: ${outcome.verdict})` : ""}`);
    const record = this.store.getMission(missionId);
    lines.push(`Scout-only run: ${record?.scoutOnly ? "yes" : "no"}`);
    lines.push("");
    lines.push("## Verified vs unverified");
    lines.push("");
    if (attempt) {
      lines.push(`Execution attempt: ${attempt.verdict.toUpperCase()}`);
      for (const v of attempt.verification) {
        lines.push(`- [${v.verdict}] ${v.criterion} — ${v.detail}`);
      }
    } else {
      lines.push("No execution attempt exists. Nothing about the mission outcome is verified by execution.");
    }
    lines.push("");
    lines.push("## Gate rounds");
    for (const round of rounds) {
      lines.push(`- round ${round.round}: ${round.verdict} — ${round.rationale}`);
    }
    lines.push("");
    lines.push(`## Gaps (${gaps.length})`);
    for (const gap of gaps) {
      lines.push(`- [${gap.severity}/${gap.status}] ${gap.question} — ${gap.description}`);
    }
    lines.push("");
    lines.push(`## Evidence (${evidence.length})`);
    for (const record of evidence) {
      lines.push(`- ${record.id} [${record.lens}] (conf ${record.confidence.toFixed(2)}) ${record.claim}${record.sourceUrl ? ` — ${record.sourceUrl}` : ""}`);
    }
    lines.push("");
    lines.push(`## Lessons (${lessons.length})`);
    for (const lesson of lessons) {
      lines.push(`- [${lesson.kind}] ${lesson.statement}`);
    }
    lines.push("");
    lines.push("## Assumptions made without asking you");
    for (const assumption of brief.assumptions) {
      lines.push(`- ${assumption}`);
    }

    const reportPath = path.join(missionDir(this.config, missionId), "report.md");
    writeFileSync(reportPath, lines.join("\n"), "utf8");
    return reportPath;
  }
}
