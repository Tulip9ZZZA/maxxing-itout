/**
 * Maxxing V2 domain types.
 *
 * Everything the Gauntlet produces is one of these records, and every record
 * is persisted. If a type changes shape, update the store schema in the same
 * commit — the two files are one unit.
 */

export const LENS_IDS = [
  "elite",
  "reverse",
  "fundamentals",
  "first-principles",
  "pro-amateur",
] as const;

export type LensId = (typeof LENS_IDS)[number];

/** Sources that are not one of the five intelligence lenses. */
export type NonLensSource = "gate" | "executor" | "verifier" | "user" | "preflight";

export type EvidenceSource = LensId | NonLensSource;

export type EvidenceSourceType =
  | "web"
  | "repo"
  | "doc"
  | "user"
  | "agent"
  | "execution";

export type EvidenceStatus = "raw" | "verified" | "contradicted" | "stale";

/** A single verified-or-attributed fact captured during scouting. */
export interface EvidenceInput {
  title: string;
  claim: string;
  sourceType: EvidenceSourceType;
  sourceUrl?: string;
  quote?: string;
  /** 0..1. Below 0.4 the claim may not anchor a synthesis key claim. */
  confidence: number;
  /** IDs of other evidence this contradicts. */
  contradicts?: string[];
}

export interface Evidence extends EvidenceInput {
  id: string;
  missionId: string;
  lens: EvidenceSource;
  capturedAt: string;
  status: EvidenceStatus;
  contradicts: string[];
}

export interface MissionBrief {
  objective: string;
  /** What is blocking the user right now, if stated. */
  blocker?: string;
  /** Things the user already knows they do not know. */
  knownUnknowns: string[];
  constraints: string[];
  /** Observable conditions that define "done". At least one. */
  successCriteria: string[];
  /** Domain slugs used for terrain-memory recall. */
  tags: string[];
  /** Assumptions the preflight had to make without asking the user. */
  assumptions: string[];
}

export interface LensReport {
  lens: LensId;
  summary: string;
  findings: EvidenceInput[];
  /** What this lens could not verify. Every entry must be addressed by the gate. */
  blindSpots: string[];
}

export type GapSeverity = "material" | "minor" | "blocker";
export type GapStatus = "open" | "researching" | "closed" | "accepted-blocker";

export interface Gap {
  id: string;
  missionId: string;
  /** The gate question that caught this. */
  question: string;
  description: string;
  severity: GapSeverity;
  owningLens: LensId | "none";
  source: "deterministic" | "gate-agent";
  status: GapStatus;
  round: number;
  /** Evidence id or rationale when closed. */
  closedBy?: string;
  createdAt: string;
}

export interface GapCandidate {
  question: string;
  description: string;
  severity: GapSeverity;
  owningLens: LensId | "none";
  source: "deterministic" | "gate-agent";
}

export interface Synthesis {
  terrainSummary: string;
  /** Every key claim must cite an evidence id captured this mission. */
  keyClaims: { evidenceId: string; claim: string }[];
  /** Pairs of evidence ids that contradict each other. Applied to the store
   *  before the gate runs so the deterministic contradiction check can fire. */
  contradictions: { evidenceId: string; contradictsId: string }[];
  /** Tools, accounts, permissions, data, environments required to execute. */
  dependencies: { type: string; name: string; requiredFor: string }[];
  /** The compressed execution plan. */
  method: string;
  /** One verification method per success criterion, same order and count. */
  verification: { criterion: string; method: string }[];
  /** Known unknowns from the brief that the lenses actually explored. */
  coveredUnknowns: string[];
  proStandards: string[];
  risks: string[];
}

export type GateVerdict = "pass" | "revise" | "blocked";

export interface GateRoundRecord {
  missionId: string;
  round: number;
  verdict: GateVerdict;
  rationale: string;
  gaps: Gap[];
  checkedAt: string;
}

export type AttemptVerdict = "verified" | "partial" | "failed" | "unverified";

export interface CriterionVerdict {
  criterion: string;
  method: string;
  verdict: AttemptVerdict;
  detail: string;
}

export interface Attempt {
  id: string;
  missionId: string;
  summary: string;
  deliverables: string[];
  verification: CriterionVerdict[];
  verdict: AttemptVerdict;
  executedAt: string;
}

export type LessonKind = "worked" | "failed" | "condition" | "gap-pattern";

export interface Lesson {
  id: string;
  missionId: string;
  statement: string;
  kind: LessonKind;
  conditions?: string;
  tags: string[];
  createdAt: string;
}

export type Phase =
  | "preflight"
  | "lenses"
  | "synthesis"
  | "gate"
  | "execute"
  | "verify"
  | "done"
  | "blocked";

export interface MissionRecord {
  id: string;
  objective: string;
  brief: MissionBrief;
  phase: Phase;
  gateRound: number;
  scoutOnly: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MissionOutcome {
  missionId: string;
  phase: Phase;
  verdict: GateVerdict | null;
  blockers: string[];
  openMaterialGaps: number;
  attemptVerdict: AttemptVerdict | null;
  deliverables: string[];
  lessons: number;
  reportPath?: string;
}

export const GATE_QUESTIONS = [
  "What did we overlook?",
  "Which assumptions remain unverified?",
  "What important information is missing?",
  "Which dependencies, tools, resources, or constraints did we fail to investigate?",
  "What contradicts our current understanding?",
  "Did we reverse-engineer the right examples?",
  "Did we neglect something fundamental?",
  "Did we mistake an impressive demonstration for a proven implementation?",
  "What could make this entire plan fail when it meets reality?",
] as const;

export type GateQuestion = (typeof GATE_QUESTIONS)[number];
