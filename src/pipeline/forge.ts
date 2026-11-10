/**
 * Skill forge: when a mission's terrain recurs, turn the verified knowledge
 * into a reusable skills/<slug>/SKILL.md following the required structure.
 * Forging is evidence-gated: no evidence, no skill.
 */

import type { AgentClient } from "../agent/client.js";
import type { Attempt, Evidence, Lesson, MissionBrief, Synthesis } from "../core/types.js";
import { extractJson } from "../core/parse.js";
import { slugify } from "../core/ids.js";
import { fillPrompt, loadPrompt } from "../prompts.js";
import type { ExecOpts } from "./execute.js";

export interface ForgeResult {
  forged: boolean;
  skillPath?: string;
  reason: string;
}

const FORGE_SCHEMA = `{
  "slug": "kebab-case skill directory name",
  "forges": true,
  "reason": "one sentence on why this terrain recurs or does not"
}`;

export async function forgeSkill(
  client: AgentClient,
  brief: MissionBrief,
  evidence: Evidence[],
  attempt: Attempt | null,
  lessons: Lesson[],
  synthesis: Synthesis | null,
  opts: ExecOpts & { skillsDir: string },
): Promise<ForgeResult> {
  if (evidence.length === 0) {
    return { forged: false, reason: "no evidence captured; forging would invent a skill" };
  }

  const prompt = fillPrompt(loadPrompt("forge"), {
    mission: brief.objective,
    tags: brief.tags.join(", "),
    evidence: evidence.map((e) => `- (${e.confidence.toFixed(2)}) ${e.claim}`).join("\n"),
    lessons: lessons.map((l) => `- [${l.kind}] ${l.statement}`).join("\n") || "(none)",
    outcome: attempt
      ? `${attempt.verdict}: ${attempt.summary}`
      : "mission completed scouting only; no execution attempt exists",
    standards: synthesis?.proStandards.map((s) => `- ${s}`).join("\n") || "(none)",
    schema: FORGE_SCHEMA,
    skillsDir: opts.skillsDir,
  });

  const { text } = await client.run(prompt, {
    systemPrompt: loadPrompt("forge-shared"),
    model: opts.model,
    maxTurns: opts.maxTurns,
    permissionMode: opts.permissionMode,
    allowedTools: ["Read", "Write", "Edit", "Glob", "Grep"],
    cwd: opts.cwd,
  });

  const parsed = extractJson<{ slug?: unknown; forges?: unknown; reason?: unknown }>(text);
  if (!parsed || parsed.forges !== true) {
    return {
      forged: false,
      reason: typeof parsed?.reason === "string" ? parsed.reason : "forge decision: skill would not recur or add value",
    };
  }

  const slug = typeof parsed.slug === "string" ? slugify(parsed.slug) : slugify(brief.tags[0] ?? "domain");
  if (slug.length === 0) {
    return { forged: false, reason: "could not derive a skill slug" };
  }

  return {
    forged: true,
    skillPath: `${opts.skillsDir}/${slug}/SKILL.md`,
    reason: typeof parsed.reason === "string" ? parsed.reason : "recurring terrain worth a reusable skill",
  };
}
