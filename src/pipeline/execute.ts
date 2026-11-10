/**
 * Execution and verification.
 *
 * Execute: the agent produces real deliverables in the mission directory.
 * Minimal-knowledge mandate: it gets the compressed method and the
 * professional standards, never a curriculum.
 *
 * Verify: a separate agent inspects the artifacts against each success
 * criterion's verification method and returns an honest per-criterion
 * verdict. The executor never grades its own work.
 */

import type { AgentClient } from "../agent/client.js";
import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import type { Attempt, AttemptVerdict, CriterionVerdict, MissionBrief, Synthesis } from "../core/types.js";
import { extractJson } from "../core/parse.js";
import { newId, nowIso } from "../core/ids.js";
import { fillPrompt, loadPrompt } from "../prompts.js";
import type { Logger } from "../log.js";
import type { TerrainStore } from "../store/store.js";

export interface ExecOpts {
  model: string;
  maxTurns: number;
  permissionMode: "default" | "acceptEdits" | "plan" | "bypassPermissions";
  cwd: string;
  codeExecution: boolean;
  canUseTool?: CanUseTool;
}

export async function executeMission(
  client: AgentClient,
  store: TerrainStore,
  log: Logger,
  missionId: string,
  brief: MissionBrief,
  synthesis: Synthesis,
  opts: ExecOpts,
): Promise<Attempt> {
  const allowedTools = ["Read", "Write", "Edit", "Glob", "Grep", ...(opts.codeExecution ? ["Bash"] : [])];
  const prompt = fillPrompt(loadPrompt("executor"), {
    mission: brief.objective,
    method: synthesis.method,
    dependencies: synthesis.dependencies.map((d) => `- [${d.type}] ${d.name} — required for: ${d.requiredFor}`).join("\n"),
    proStandards: synthesis.proStandards.map((s) => `- ${s}`).join("\n") || "- deliver something a professional would accept",
    constraints: brief.constraints.map((c) => `- ${c}`).join("\n") || "(none stated)",
  });

  const { text } = await client.run(prompt, {
    systemPrompt: loadPrompt("executor-shared"),
    model: opts.model,
    maxTurns: opts.maxTurns,
    permissionMode: opts.permissionMode,
    allowedTools,
    cwd: opts.cwd,
    canUseTool: opts.canUseTool,
  });

  const parsed = extractJson<{ summary?: unknown; deliverables?: unknown }>(text);
  const deliverables = Array.isArray(parsed?.deliverables)
    ? parsed.deliverables.filter((d): d is string => typeof d === "string")
    : [];
  const summary = typeof parsed?.summary === "string" ? parsed.summary : "execution produced no structured summary";

  const attempt: Attempt = {
    id: newId("try"),
    missionId,
    summary,
    deliverables,
    verification: [],
    verdict: "unverified",
    executedAt: nowIso(),
  };
  store.saveAttempt(attempt);
  log.info("execution finished", { deliverables: deliverables.length });
  return attempt;
}

const WORST_FIRST: AttemptVerdict[] = ["failed", "partial", "unverified", "verified"];

export function worstVerdict(verdicts: AttemptVerdict[]): AttemptVerdict {
  for (const candidate of WORST_FIRST) {
    if (verdicts.includes(candidate)) return candidate;
  }
  return "unverified";
}

export async function verifyAttempt(
  client: AgentClient,
  store: TerrainStore,
  log: Logger,
  attempt: Attempt,
  synthesis: Synthesis,
  opts: ExecOpts,
): Promise<Attempt> {
  const allowedTools = ["Read", "Glob", "Grep", ...(opts.codeExecution ? ["Bash"] : [])];
  const prompt = fillPrompt(loadPrompt("verifier"), {
    deliverables: attempt.deliverables.map((d) => `- ${d}`).join("\n") || "(none listed)",
    criteria: synthesis.verification.map((v) => `- criterion: ${v.criterion}\n  check: ${v.method}`).join("\n"),
  });

  const { text } = await client.run(prompt, {
    systemPrompt: loadPrompt("verifier-shared"),
    model: opts.model,
    maxTurns: opts.maxTurns,
    permissionMode: opts.permissionMode,
    allowedTools,
    cwd: opts.cwd,
    canUseTool: opts.canUseTool,
  });

  const parsed = extractJson<{ verification?: { criterion?: unknown; verdict?: unknown; detail?: unknown }[] }>(text);
  const rawVerdicts = Array.isArray(parsed?.verification) ? parsed.verification : [];

  const verification: CriterionVerdict[] = synthesis.verification.map((v) => {
    const match = rawVerdicts.find((r) => typeof r?.criterion === "string" && r.criterion.trim() === v.criterion.trim());
    const verdict = normalizeVerdict(match?.verdict);
    const detail = typeof match?.detail === "string" ? match.detail : "verifier did not report a detail for this criterion";
    return { criterion: v.criterion, method: v.method, verdict, detail };
  });

  const updated: Attempt = {
    ...attempt,
    verification,
    verdict: verification.length > 0 ? worstVerdict(verification.map((v) => v.verdict)) : "unverified",
  };
  store.saveAttempt(updated);
  log.event(`verification: ${updated.verdict}`, { criteria: verification.length });
  return updated;
}

function normalizeVerdict(value: unknown): AttemptVerdict {
  return value === "verified" || value === "partial" || value === "failed" ? value : "unverified";
}
