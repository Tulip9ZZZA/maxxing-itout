/**
 * Synthesis: compress five lens reports into one execution-ready picture.
 * The schema is enforced downstream by the gate (every criterion mapped,
 * every key claim cited, dependencies inventoried), so a lazy synthesis
 * does not survive to execution.
 */

import type { AgentClient } from "../agent/client.js";
import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import type { Evidence, LensReport, MissionBrief, Synthesis } from "../core/types.js";
import { extractJson } from "../core/parse.js";
import { fillPrompt, loadPrompt } from "../prompts.js";

const SYNTHESIS_SCHEMA = `{
  "terrain_summary": "the mapped terrain in one paragraph: what governs success here",
  "key_claims": [{ "evidence_id": "id from the evidence list", "claim": "the claim being relied on" }],
  "dependencies": [{ "type": "tool | account | permission | data | environment | skill", "name": "concrete name", "required_for": "what breaks without it" }],
  "method": "the compressed execution plan: smallest set of moves that accounts for most of the outcome",
  "verification": [{ "criterion": "must match a success criterion from the brief", "method": "how completion will be checked, concretely" }],
  "covered_unknowns": ["known unknowns the lenses actually explored"],
  "pro_standards": ["the professional quality bar this execution must meet"],
  "risks": ["what could still go wrong"]
}`;

export async function synthesize(
  client: AgentClient,
  brief: MissionBrief,
  reports: LensReport[],
  evidence: Evidence[],
  opts: { model: string; maxTurns: number; permissionMode: "default" | "acceptEdits" | "plan" | "bypassPermissions"; allowedTools: string[]; canUseTool?: CanUseTool },
): Promise<Synthesis | null> {
  const prompt = fillPrompt(loadPrompt("synthesis"), {
    mission: brief.objective,
    criteria: brief.successCriteria.map((c) => `- ${c}`).join("\n"),
    knownUnknowns: brief.knownUnknowns.map((u) => `- ${u}`).join("\n") || "(none stated)",
    lensReports: reports
      .map(
        (r) =>
          `### ${r.lens} lens\n${r.summary}\nFindings: ${r.findings.map((f) => f.claim).join(" | ") || "(none)"}\nBlind spots: ${r.blindSpots.join("; ") || "(none stated)"}`,
      )
      .join("\n\n"),
    evidence: evidence.map((e) => `${e.id} [${e.lens}] (conf ${e.confidence.toFixed(2)}) ${e.claim}`).join("\n") || "(none)",
    schema: SYNTHESIS_SCHEMA,
  });

  const { text } = await client.run(prompt, {
    systemPrompt: loadPrompt("synthesis-shared"),
    model: opts.model,
    maxTurns: opts.maxTurns,
    permissionMode: opts.permissionMode,
    allowedTools: opts.allowedTools,
    canUseTool: opts.canUseTool,
  });

  return parseSynthesis(text);
}

export function parseSynthesis(text: string): Synthesis | null {
  const parsed = extractJson<Record<string, unknown>>(text);
  if (!parsed || typeof parsed.terrain_summary !== "string") return null;

  const keyClaims: { evidenceId: string; claim: string }[] = [];
  if (Array.isArray(parsed.key_claims)) {
    for (const raw of parsed.key_claims) {
      const record = raw as Record<string, unknown> | null;
      if (
        record &&
        typeof record.evidence_id === "string" &&
        typeof record.claim === "string" &&
        record.claim.trim().length > 0
      ) {
        keyClaims.push({ evidenceId: record.evidence_id, claim: record.claim.trim() });
      }
    }
  }

  const dependencies: Synthesis["dependencies"] = [];
  if (Array.isArray(parsed.dependencies)) {
    for (const raw of parsed.dependencies) {
      const record = raw as Record<string, unknown> | null;
      if (record && typeof record.name === "string" && typeof record.required_for === "string") {
        dependencies.push({
          type: typeof record.type === "string" ? record.type : "tool",
          name: record.name,
          requiredFor: record.required_for,
        });
      }
    }
  }

  const verification: Synthesis["verification"] = [];
  if (Array.isArray(parsed.verification)) {
    for (const raw of parsed.verification) {
      const record = raw as Record<string, unknown> | null;
      if (record && typeof record.criterion === "string" && typeof record.method === "string") {
        verification.push({ criterion: record.criterion, method: record.method });
      }
    }
  }

  const contradictions: Synthesis["contradictions"] = [];
  if (Array.isArray(parsed.contradictions)) {
    for (const raw of parsed.contradictions) {
      const record = raw as Record<string, unknown> | null;
      if (
        record &&
        typeof record.evidence_id === "string" &&
        typeof record.contradicts_id === "string" &&
        record.evidence_id !== record.contradicts_id
      ) {
        contradictions.push({ evidenceId: record.evidence_id, contradictsId: record.contradicts_id });
      }
    }
  }

  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];

  return {
    terrainSummary: parsed.terrain_summary,
    keyClaims,
    contradictions,
    dependencies,
    method: typeof parsed.method === "string" ? parsed.method : "",
    verification,
    coveredUnknowns: strings(parsed.covered_unknowns),
    proStandards: strings(parsed.pro_standards),
    risks: strings(parsed.risks),
  };
}
