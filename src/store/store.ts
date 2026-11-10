/**
 * TerrainStore — persistent memory over node:sqlite (Node >= 24, no native deps).
 *
 * Stores missions, evidence with provenance, lens reports, gaps, gate rounds,
 * synthesis, attempts, and lessons. This is the institutional memory that
 * turns Maxxing from a one-shot tool into something that compounds.
 */

import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type {
  Attempt,
  Evidence,
  EvidenceInput,
  EvidenceSource,
  GateRoundRecord,
  Gap,
  GapStatus,
  GapSeverity,
  LensId,
  LensReport,
  Lesson,
  LessonKind,
  MissionBrief,
  MissionRecord,
  Phase,
  Synthesis,
} from "../core/types.js";
import { keywordOverlap } from "../core/parse.js";

export class TerrainStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS missions (
        id TEXT PRIMARY KEY,
        objective TEXT NOT NULL,
        brief TEXT NOT NULL,
        phase TEXT NOT NULL,
        gate_round INTEGER NOT NULL DEFAULT 0,
        scout_only INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS evidence (
        id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL,
        lens TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_url TEXT,
        title TEXT NOT NULL,
        claim TEXT NOT NULL,
        quote TEXT,
        confidence REAL NOT NULL,
        captured_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'raw',
        contradicts TEXT NOT NULL DEFAULT '[]'
      );
      CREATE TABLE IF NOT EXISTS lens_reports (
        mission_id TEXT NOT NULL,
        lens TEXT NOT NULL,
        report TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (mission_id, lens)
      );
      CREATE TABLE IF NOT EXISTS synthesis (
        mission_id TEXT PRIMARY KEY,
        synthesis TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS gaps (
        id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL,
        question TEXT NOT NULL,
        description TEXT NOT NULL,
        severity TEXT NOT NULL,
        owning_lens TEXT NOT NULL,
        source TEXT NOT NULL,
        status TEXT NOT NULL,
        round INTEGER NOT NULL,
        closed_by TEXT,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS gate_rounds (
        mission_id TEXT NOT NULL,
        round INTEGER NOT NULL,
        verdict TEXT NOT NULL,
        rationale TEXT NOT NULL,
        checked_at TEXT NOT NULL,
        PRIMARY KEY (mission_id, round)
      );
      CREATE TABLE IF NOT EXISTS attempts (
        id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL,
        attempt TEXT NOT NULL,
        executed_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS lessons (
        id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL,
        statement TEXT NOT NULL,
        kind TEXT NOT NULL,
        conditions TEXT,
        tags TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
    `);
  }

  // ---- missions ----

  createMission(objective: string, brief: MissionBrief, scoutOnly: boolean, id: string, at: string): MissionRecord {
    this.db
      .prepare(
        `INSERT INTO missions (id, objective, brief, phase, gate_round, scout_only, created_at, updated_at)
         VALUES (?, ?, ?, 'preflight', 0, ?, ?, ?)`,
      )
      .run(id, objective, JSON.stringify(brief), scoutOnly ? 1 : 0, at, at);
    return this.getMission(id)!;
  }

  getMission(id: string): MissionRecord | null {
    const row = this.db.prepare("SELECT * FROM missions WHERE id = ?").get(id) as
      | { id: string; objective: string; brief: string; phase: string; gate_round: number; scout_only: number; created_at: string; updated_at: string }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      objective: row.objective,
      brief: JSON.parse(row.brief) as MissionBrief,
      phase: row.phase as Phase,
      gateRound: row.gate_round,
      scoutOnly: row.scout_only === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  updateMission(id: string, fields: { phase?: Phase; gateRound?: number; brief?: MissionBrief }): void {
    const current = this.getMission(id);
    if (!current) throw new Error(`mission ${id} not found`);
    const phase = fields.phase ?? current.phase;
    const gateRound = fields.gateRound ?? current.gateRound;
    const brief = fields.brief ? JSON.stringify(fields.brief) : JSON.stringify(current.brief);
    this.db
      .prepare("UPDATE missions SET phase = ?, gate_round = ?, brief = ?, updated_at = ? WHERE id = ?")
      .run(phase, gateRound, brief, new Date().toISOString(), id);
  }

  listMissions(): MissionRecord[] {
    const rows = this.db.prepare("SELECT id FROM missions ORDER BY created_at DESC").all() as { id: string }[];
    return rows.map((r) => this.getMission(r.id)!);
  }

  // ---- evidence ----

  saveEvidence(missionId: string, lens: EvidenceSource, input: EvidenceInput, id: string, at: string): Evidence {
    this.db
      .prepare(
        `INSERT INTO evidence (id, mission_id, lens, source_type, source_url, title, claim, quote, confidence, captured_at, status, contradicts)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'raw', ?)`,
      )
      .run(
        id,
        missionId,
        lens,
        input.sourceType,
        input.sourceUrl ?? null,
        input.title,
        input.claim,
        input.quote ?? null,
        clampConfidence(input.confidence),
        at,
        JSON.stringify(input.contradicts ?? []),
      );
    return {
      ...input,
      contradicts: input.contradicts ?? [],
      id,
      missionId,
      lens,
      capturedAt: at,
      status: "raw",
    };
  }

  listEvidence(missionId: string): Evidence[] {
    const rows = this.db
      .prepare("SELECT * FROM evidence WHERE mission_id = ? ORDER BY captured_at")
      .all(missionId) as unknown as EvidenceRow[];
    return rows.map(rowToEvidence);
  }

  /**
   * Record contradiction pairs declared by the synthesizer (or repair runs):
   * each side gets the other's id appended to `contradicts`. Status stays
   * `raw` so the gate's unresolved-contradiction check fires until a repair
   * resolves or rejects one side.
   */
  markContradictions(missionId: string, pairs: { evidenceId: string; contradictsId: string }[]): void {
    for (const pair of pairs) {
      for (const [id, otherId] of [
        [pair.evidenceId, pair.contradictsId],
        [pair.contradictsId, pair.evidenceId],
      ] as const) {
        const row = this.db.prepare("SELECT contradicts FROM evidence WHERE id = ? AND mission_id = ?").get(id, missionId) as
          | { contradicts: string }
          | undefined;
        if (!row) continue;
        const list = JSON.parse(row.contradicts) as string[];
        if (!list.includes(otherId)) {
          list.push(otherId);
          this.db.prepare("UPDATE evidence SET contradicts = ? WHERE id = ?").run(JSON.stringify(list), id);
        }
      }
    }
  }

  // ---- lens reports ----

  saveLensReport(missionId: string, report: LensReport, at: string): void {
    this.db
      .prepare(
        `INSERT INTO lens_reports (mission_id, lens, report, created_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(mission_id, lens) DO UPDATE SET report = excluded.report, created_at = excluded.created_at`,
      )
      .run(missionId, report.lens, JSON.stringify(report), at);
  }

  listLensReports(missionId: string): LensReport[] {
    const rows = this.db
      .prepare("SELECT report FROM lens_reports WHERE mission_id = ?")
      .all(missionId) as { report: string }[];
    return rows.map((r) => JSON.parse(r.report) as LensReport);
  }

  // ---- synthesis ----

  saveSynthesis(missionId: string, synthesis: Synthesis, at: string): void {
    this.db
      .prepare(
        `INSERT INTO synthesis (mission_id, synthesis, created_at) VALUES (?, ?, ?)
         ON CONFLICT(mission_id) DO UPDATE SET synthesis = excluded.synthesis, created_at = excluded.created_at`,
      )
      .run(missionId, JSON.stringify(synthesis), at);
  }

  getSynthesis(missionId: string): Synthesis | null {
    const row = this.db.prepare("SELECT synthesis FROM synthesis WHERE mission_id = ?").get(missionId) as
      | { synthesis: string }
      | undefined;
    return row ? (JSON.parse(row.synthesis) as Synthesis) : null;
  }

  // ---- gaps & gate rounds ----

  saveGap(gap: Gap): void {
    this.db
      .prepare(
        `INSERT INTO gaps (id, mission_id, question, description, severity, owning_lens, source, status, round, closed_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        gap.id,
        gap.missionId,
        gap.question,
        gap.description,
        gap.severity,
        gap.owningLens,
        gap.source,
        gap.status,
        gap.round,
        gap.closedBy ?? null,
        gap.createdAt,
      );
  }

  updateGapStatus(id: string, status: GapStatus, closedBy?: string): void {
    this.db
      .prepare("UPDATE gaps SET status = ?, closed_by = ? WHERE id = ?")
      .run(status, closedBy ?? null, id);
  }

  listGaps(missionId: string, statuses?: GapStatus[]): Gap[] {
    const rows = this.db.prepare("SELECT * FROM gaps WHERE mission_id = ? ORDER BY created_at").all(missionId) as unknown as GapRow[];
    const gaps = rows.map(rowToGap);
    if (!statuses) return gaps;
    return gaps.filter((g) => statuses.includes(g.status));
  }

  saveGateRound(round: GateRoundRecord): void {
    this.db
      .prepare(
        `INSERT INTO gate_rounds (mission_id, round, verdict, rationale, checked_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(mission_id, round) DO UPDATE SET verdict = excluded.verdict, rationale = excluded.rationale, checked_at = excluded.checked_at`,
      )
      .run(round.missionId, round.round, round.verdict, round.rationale, round.checkedAt);
  }

  listGateRounds(missionId: string): GateRoundRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM gate_rounds WHERE mission_id = ? ORDER BY round")
      .all(missionId) as { mission_id: string; round: number; verdict: string; rationale: string; checked_at: string }[];
    return rows.map((r) => ({
      missionId: r.mission_id,
      round: r.round,
      verdict: r.verdict as GateRoundRecord["verdict"],
      rationale: r.rationale,
      gaps: this.listGaps(missionId).filter((g) => g.round === r.round),
      checkedAt: r.checked_at,
    }));
  }

  // ---- attempts ----

  saveAttempt(attempt: Attempt): void {
    // Upsert: verification updates the same attempt record in place.
    this.db
      .prepare(
        `INSERT INTO attempts (id, mission_id, attempt, executed_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET attempt = excluded.attempt`,
      )
      .run(attempt.id, attempt.missionId, JSON.stringify(attempt), attempt.executedAt);
  }

  listAttempts(missionId: string): Attempt[] {
    const rows = this.db
      .prepare("SELECT attempt FROM attempts WHERE mission_id = ? ORDER BY executed_at")
      .all(missionId) as { attempt: string }[];
    return rows.map((r) => JSON.parse(r.attempt) as Attempt);
  }

  // ---- lessons (cross-mission terrain memory) ----

  saveLesson(lesson: Lesson): void {
    this.db
      .prepare(
        "INSERT INTO lessons (id, mission_id, statement, kind, conditions, tags, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        lesson.id,
        lesson.missionId,
        lesson.statement,
        lesson.kind,
        lesson.conditions ?? null,
        JSON.stringify(lesson.tags),
        lesson.createdAt,
      );
  }

  listLessons(missionId?: string): Lesson[] {
    const rows = missionId
      ? (this.db.prepare("SELECT * FROM lessons WHERE mission_id = ? ORDER BY created_at").all(missionId) as unknown as LessonRow[])
      : (this.db.prepare("SELECT * FROM lessons ORDER BY created_at DESC").all() as unknown as LessonRow[]);
    return rows.map(rowToLesson);
  }

  /** Lessons whose tags overlap the requested tags, newest first. */
  findLessonsByTags(tags: string[], limit = 8): Lesson[] {
    if (tags.length === 0) return [];
    const all = this.listLessons();
    const wanted = new Set(tags.map((t) => t.toLowerCase()));
    return all
      .filter((lesson) => lesson.tags.some((t) => wanted.has(t.toLowerCase())))
      .slice(0, limit);
  }

  close(): void {
    this.db.close();
  }
}

// ---- row mapping ----

interface EvidenceRow {
  id: string;
  mission_id: string;
  lens: string;
  source_type: string;
  source_url: string | null;
  title: string;
  claim: string;
  quote: string | null;
  confidence: number;
  captured_at: string;
  status: string;
  contradicts: string;
}

function rowToEvidence(row: EvidenceRow): Evidence {
  return {
    id: row.id,
    missionId: row.mission_id,
    lens: row.lens as EvidenceSource,
    sourceType: row.source_type as Evidence["sourceType"],
    sourceUrl: row.source_url ?? undefined,
    title: row.title,
    claim: row.claim,
    quote: row.quote ?? undefined,
    confidence: row.confidence,
    capturedAt: row.captured_at,
    status: row.status as Evidence["status"],
    contradicts: JSON.parse(row.contradicts) as string[],
  };
}

interface GapRow {
  id: string;
  mission_id: string;
  question: string;
  description: string;
  severity: string;
  owning_lens: string;
  source: string;
  status: string;
  round: number;
  closed_by: string | null;
  created_at: string;
}

function rowToGap(row: GapRow): Gap {
  return {
    id: row.id,
    missionId: row.mission_id,
    question: row.question,
    description: row.description,
    severity: row.severity as GapSeverity,
    owningLens: row.owning_lens as LensId | "none",
    source: row.source as Gap["source"],
    status: row.status as GapStatus,
    round: row.round,
    closedBy: row.closed_by ?? undefined,
    createdAt: row.created_at,
  };
}

interface LessonRow {
  id: string;
  mission_id: string;
  statement: string;
  kind: string;
  conditions: string | null;
  tags: string;
  created_at: string;
}

function rowToLesson(row: LessonRow): Lesson {
  return {
    id: row.id,
    missionId: row.mission_id,
    statement: row.statement,
    kind: row.kind as LessonKind,
    conditions: row.conditions ?? undefined,
    tags: JSON.parse(row.tags) as string[],
    createdAt: row.created_at,
  };
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export { keywordOverlap };
