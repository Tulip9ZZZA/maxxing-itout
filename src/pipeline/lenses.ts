/**
 * The five intelligence lenses, run in parallel. Each lens is an independent
 * scout with its own prompt, its own turn budget, and its own obligation to
 * report what it could NOT verify (blind spots). Lens output that fails to
 * parse becomes a lens with zero findings — the Terrain Gate catches it.
 */

import type { AgentClient } from "../agent/client.js";
import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import type { Evidence, EvidenceInput, LensId, LensReport, MissionBrief } from "../core/types.js";
import { LENS_IDS } from "../core/types.js";
import { extractJson } from "../core/parse.js";
import { newId, nowIso } from "../core/ids.js";
import { fillPrompt, loadPrompt } from "../prompts.js";
import type { Logger } from "../log.js";
import type { TerrainStore } from "../store/store.js";
import type { Lesson } from "../core/types.js";

export interface LensRunOptions {
  model: string;
  maxTurns: number;
  permissionMode: "default" | "acceptEdits" | "plan" | "bypassPermissions";
  allowedTools: string[];
  cwd?: string;
  canUseTool?: CanUseTool;
}

export interface LensRunResult {
  reports: LensReport[];
  evidence: Evidence[];
}

const LENS_REPORT_SCHEMA = `{
  "summary": "what this lens found, in 3-6 sentences",
  "findings": [
    {
      "title": "short label",
      "claim": "the specific fact or mechanism, one sentence",
      "source_type": "web | repo | doc | user | agent",
      "source_url": "url when the claim came from an external source, else omit",
      "quote": "short verbatim quote that backs the claim, when available",
      "confidence": 0.0,
      "contradicts": []
    }
  ],
  "blind_spots": ["specific things this lens could not verify or did not investigate"]
}`;

export async function runLenses(
  client: AgentClient,
  store: TerrainStore,
  log: Logger,
  missionId: string,
  brief: MissionBrief,
  opts: LensRunOptions,
): Promise<LensRunResult> {
  const lessons = store.findLessonsByTags(brief.tags);
  const lensContext = renderBrief(brief) + renderLessons(lessons);

  // On resume, lenses that already reported keep their reports and evidence;
  // only the missing ones run. Prevents duplicate evidence rows.
  const alreadyReported = new Set(store.listLensReports(missionId).map((r) => r.lens));
  const pendingLenses = LENS_IDS.filter((lens) => !alreadyReported.has(lens));

  const tasks = pendingLenses.map(async (lens) => {
    const prompt = fillPrompt(loadPrompt(`lens-${lens}`), {
      context: lensContext,
      schema: LENS_REPORT_SCHEMA,
    });
    try {
      const { text } = await client.run(prompt, {
        systemPrompt: loadPrompt("lens-shared"),
        model: opts.model,
        maxTurns: opts.maxTurns,
        permissionMode: opts.permissionMode,
        allowedTools: opts.allowedTools,
        cwd: opts.cwd,
        canUseTool: opts.canUseTool,
      });
      return parseLensReport(lens, text);
    } catch (error) {
      log.warn(`lens ${lens} failed`, { error: String(error) });
      return failedReport(lens, String(error));
    }
  });

  const settled = await Promise.allSettled(tasks);
  const reports: LensReport[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") {
      reports.push(result.value);
    } else {
      log.error("lens task rejected", { error: String(result.reason) });
    }
  }

  const at = nowIso();
  const evidence: Evidence[] = [];
  for (const report of reports) {
    store.saveLensReport(missionId, report, at);
    for (const finding of report.findings) {
      evidence.push(store.saveEvidence(missionId, report.lens, finding, newId("ev"), at));
    }
  }

  return { reports, evidence };
}

export function parseLensReport(lens: LensId, text: string): LensReport {
  const parsed = extractJson<Record<string, unknown>>(text);
  if (!parsed || !Array.isArray(parsed.findings)) {
    return {
      lens,
      summary: "lens output could not be parsed as JSON",
      findings: [],
      blindSpots: ["entire lens output was unparseable; this lens effectively did not run"],
    };
  }
  const findings: EvidenceInput[] = [];
  for (const raw of parsed.findings) {
    const record = raw as Record<string, unknown> | null;
    if (!record || typeof record.claim !== "string" || record.claim.trim().length === 0) continue;
    findings.push({
      title: typeof record.title === "string" ? record.title : "finding",
      claim: record.claim.trim(),
      sourceType: normalizeSourceType(record.source_type),
      sourceUrl: typeof record.source_url === "string" ? record.source_url : undefined,
      quote: typeof record.quote === "string" ? record.quote : undefined,
      confidence: typeof record.confidence === "number" ? record.confidence : 0.5,
      contradicts: Array.isArray(record.contradicts)
        ? record.contradicts.filter((c): c is string => typeof c === "string")
        : [],
    });
  }
  return {
    lens,
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    findings,
    blindSpots: Array.isArray(parsed.blind_spots)
      ? parsed.blind_spots.filter((b): b is string => typeof b === "string")
      : [],
  };
}

function failedReport(lens: LensId, error: string): LensReport {
  return {
    lens,
    summary: `lens run failed: ${error.slice(0, 200)}`,
    findings: [],
    blindSpots: [`lens run failed with an error; it contributed nothing and must be retried`],
  };
}

function normalizeSourceType(value: unknown): EvidenceInput["sourceType"] {
  return value === "web" || value === "repo" || value === "doc" || value === "user" || value === "agent"
    ? value
    : "agent";
}

export function renderBrief(brief: MissionBrief): string {
  const lines = [
    `## Mission brief`,
    `Objective: ${brief.objective}`,
  ];
  if (brief.blocker) lines.push(`Stated blocker: ${brief.blocker}`);
  if (brief.knownUnknowns.length > 0) {
    lines.push(`Known unknowns:\n${brief.knownUnknowns.map((u) => `- ${u}`).join("\n")}`);
  }
  if (brief.constraints.length > 0) {
    lines.push(`Constraints:\n${brief.constraints.map((c) => `- ${c}`).join("\n")}`);
  }
  lines.push(`Success criteria:\n${brief.successCriteria.map((c) => `- ${c}`).join("\n")}`);
  lines.push(`Domain tags: ${brief.tags.join(", ")}`);
  return lines.join("\n\n");
}

function renderLessons(lessons: Lesson[]): string {
  if (lessons.length === 0) return "";
  return (
    `\n\n## Terrain memory (lessons from previous missions with related tags)\n` +
    lessons.map((l) => `- [${l.kind}] ${l.statement}`).join("\n")
  );
}
