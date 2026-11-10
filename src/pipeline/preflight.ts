/**
 * Preflight interrogation. Sun Tzu did not send troops out without a scout;
 * Maxxing does not run lenses without a mission brief that names the objective,
 * the blocker, the known unknowns, and what "done" observably means.
 */

import type { AgentClient } from "../agent/client.js";
import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import type { MissionBrief } from "../core/types.js";
import { extractJson } from "../core/parse.js";
import { slugify } from "../core/ids.js";
import { fillPrompt, loadPrompt } from "../prompts.js";

export interface BriefOverrides {
  blocker?: string;
  knownUnknowns?: string[];
  constraints?: string[];
  successCriteria?: string[];
  tags?: string[];
}

export interface PreflightResult {
  brief: MissionBrief;
  /** True when the user supplied enough detail to skip the interrogation. */
  deterministic: boolean;
}

const BRIEF_SCHEMA = `{
  "objective": "restated, single sentence, concrete",
  "blocker": "the stated obstacle or null",
  "knownUnknowns": ["what the user already knows they do not know"],
  "constraints": ["time, budget, tools, environment, skill limits"],
  "successCriteria": ["observable, checkable conditions that define done"],
  "tags": ["2-5 lowercase domain slugs, e.g. 'docker', 'vue', 'tax-filing'"],
  "assumptions": ["every guess you had to make, stated so the user can correct it"]
}`;

export async function runPreflight(
  client: AgentClient,
  objective: string,
  overrides: BriefOverrides,
  opts: { systemPrompt: string; model: string; maxTurns: number; permissionMode: "default" | "acceptEdits" | "plan" | "bypassPermissions"; canUseTool?: CanUseTool },
): Promise<PreflightResult> {
  const hasOverrides =
    (overrides.successCriteria?.length ?? 0) > 0 ||
    (overrides.knownUnknowns?.length ?? 0) > 0 ||
    (overrides.constraints?.length ?? 0) > 0 ||
    Boolean(overrides.blocker);

  if (hasOverrides) {
    return { brief: buildBrief(objective, overrides), deterministic: true };
  }

  const prompt = fillPrompt(loadPrompt("preflight"), {
    mission: objective,
    schema: BRIEF_SCHEMA,
  });

  const { text } = await client.run(prompt, {
    systemPrompt: opts.systemPrompt,
    model: opts.model,
    maxTurns: opts.maxTurns,
    permissionMode: opts.permissionMode,
    canUseTool: opts.canUseTool,
  });

  const parsed = extractJson<Partial<MissionBrief>>(text);
  if (!parsed || typeof parsed.objective !== "string" || parsed.objective.length === 0) {
    // The interrogation failed to produce structure. Ship a minimal honest
    // brief and let the gate treat the missing detail as a gap.
    const brief = buildBrief(objective, {});
    brief.assumptions.unshift(
      "preflight interrogation output was unparseable; brief was derived from the objective text alone",
    );
    return { brief, deterministic: false };
  }

  return { brief: buildBrief(objective, parsed), deterministic: false };
}

export function buildBrief(objective: string, parsed: Partial<MissionBrief>): MissionBrief {
  const successCriteria =
    parsed.successCriteria && parsed.successCriteria.length > 0
      ? parsed.successCriteria.map(normalizeListItem)
      : [`the objective is accomplished: ${objective}`];
  const assumptions = [...(parsed.assumptions ?? [])];
  if (parsed.successCriteria && parsed.successCriteria.length === 0) {
    assumptions.push("no success criteria were given; derived one from the objective");
  }

  return {
    objective: parsed.objective?.trim() || objective.trim(),
    blocker: parsed.blocker ?? undefined,
    knownUnknowns: (parsed.knownUnknowns ?? []).map(normalizeListItem),
    constraints: (parsed.constraints ?? []).map(normalizeListItem),
    successCriteria,
    tags: normalizeTags(parsed.tags?.length ? parsed.tags : deriveTags(objective)),
    assumptions,
  };
}

function normalizeListItem(item: unknown): string {
  return String(item).trim();
}

function normalizeTags(tags: string[]): string[] {
  const out = new Set<string>();
  for (const tag of tags) {
    const slug = slugify(String(tag));
    if (slug.length > 0) out.add(slug);
  }
  return [...out].slice(0, 6);
}

function deriveTags(objective: string): string[] {
  const words = objective.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4);
  return [...new Set(words)].slice(0, 4);
}
