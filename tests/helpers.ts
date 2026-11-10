/**
 * Shared test fixtures: a scripted AgentClient fake and canned mission JSON.
 *
 * The fake dispatches on the system prompt (each pipeline stage has a distinct
 * one) so tests drive the real orchestrator end to end without network access.
 */

import type { AgentClient, AgentRunOptions } from "../src/agent/client.js";
import { LENS_IDS, type LensId } from "../src/core/types.js";

export type Stage =
  | "preflight"
  | "lens"
  | "synthesis"
  | "gate"
  | "gap"
  | "executor"
  | "verifier"
  | "forge"
  | "unknown";

export function stageOf(systemPrompt: string): Stage {
  if (systemPrompt.includes("first scout")) return "preflight";
  if (systemPrompt.includes("Maxxing verifier")) return "verifier";
  if (systemPrompt.includes("Maxxing executor")) return "executor";
  // The lens check must precede the gate check: lens-shared tells the lens
  // that "the Terrain Gate will catch" hidden blind spots.
  if (systemPrompt.includes("intelligence lens")) return "lens";
  // Specific to gate-shared.md; gap-research-shared also mentions the gate.
  if (systemPrompt.includes("You are the Terrain Gate")) return "gate";
  if (systemPrompt.includes("material gap survived")) return "gap";
  if (systemPrompt.includes("synthesizer")) return "synthesis";
  if (systemPrompt.includes("skill forge")) return "forge";
  return "unknown";
}

export function lensOf(prompt: string): LensId | "gap" | "unknown" {
  if (prompt.includes("Gap-targeted re-research")) return "gap";
  if (prompt.includes("Lens 1")) return "elite";
  if (prompt.includes("Lens 2")) return "reverse";
  if (prompt.includes("Lens 3")) return "fundamentals";
  if (prompt.includes("Lens 4")) return "first-principles";
  if (prompt.includes("Lens 5")) return "pro-amateur";
  return "unknown";
}

export class FakeClient implements AgentClient {
  readonly calls: { stage: Stage; lens: string; prompt: string; systemPrompt: string }[] = [];
  constructor(
    private readonly handler: (stage: Stage, lens: string, prompt: string) => string,
  ) {}

  async run(prompt: string, opts: AgentRunOptions): Promise<{ text: string }> {
    const stage = stageOf(opts.systemPrompt);
    const lens = stage === "lens" ? lensOf(prompt) : stage === "gap" ? "gap" : "";
    this.calls.push({ stage, lens, prompt, systemPrompt: opts.systemPrompt });
    return { text: this.handler(stage, lens, prompt) };
  }

  callsFor(stage: Stage): number {
    return this.calls.filter((c) => c.stage === stage).length;
  }
}

export function lensReportJson(claims: string[]): string {
  return JSON.stringify({
    summary: "terrain observed",
    findings: claims.map((claim, i) => ({
      title: `finding ${i + 1}`,
      claim,
      source_type: "web",
      source_url: "https://example.com/source",
      quote: "backing quote",
      confidence: 0.8,
      contradicts: [],
    })),
    blind_spots: [],
  });
}

export const PREFLIGHT_JSON = JSON.stringify({
  objective: "deploy the user's static site to a VPS with HTTPS",
  blocker: "user has never administered a server",
  knownUnknowns: ["which VPS provider fits the budget"],
  constraints: ["budget under $10/month", "one evening"],
  successCriteria: ["site reachable over HTTPS on the user's domain"],
  tags: ["vps", "deployment"],
  assumptions: ["user already owns a domain"],
});

export const GATE_CLEAN = JSON.stringify({ gaps: [], rationale: "terrain is mapped" });

export const GATE_REVISE_VERCEL = JSON.stringify({
  gaps: [
    {
      question: "Which dependencies, tools, resources, or constraints did we fail to investigate?",
      description: "the plan assumes a Vercel account exists; nothing verified the user has one",
      severity: "material",
      owning_lens: "elite",
    },
  ],
  rationale: "one account dependency unverified",
});

export const GATE_BLOCKER = JSON.stringify({
  gaps: [
    {
      question: "What could make this entire plan fail when it meets reality?",
      description: "the mission requires root server access the user cannot obtain; the plan cannot proceed at all",
      severity: "blocker",
      owning_lens: "none",
    },
  ],
  rationale: "fatal dependency",
});

export const REPAIR_VERCEL = JSON.stringify({
  summary: "checked account requirement",
  findings: [
    {
      title: "account needed",
      claim: "deploying to Vercel requires creating a Vercel account with an email address",
      source_type: "doc",
      confidence: 0.9,
    },
  ],
  blind_spots: [],
});

export const EXECUTOR_JSON = JSON.stringify({
  summary: "built the deployment script and checklist",
  deliverables: ["deploy.sh", "checklist.md"],
  notes: "",
});

/** Build a verifier response covering every criterion found in the prompt. */
export function verifierJsonFor(prompt: string, verdict: string): string {
  const criteria = [...prompt.matchAll(/criterion: (.+)/g)].map((m) => m[1]!.trim());
  return JSON.stringify({
    verification: criteria.map((criterion) => ({
      criterion,
      verdict,
      detail: "inspected the artifact directly",
    })),
  });
}

/** Synthesis handler: cites evidence ids actually present in the prompt ledger. */
export function synthesisHandler(_stage: Stage, _lens: string, prompt: string): string {
  const ids = [...prompt.matchAll(/^(ev_[0-9a-f]+) \[/gm)].map((m) => m[1]!);
  const cite = ids[0] ?? "ev_missing";
  return JSON.stringify({
    terrain_summary: "deployment terrain is well mapped; HTTPS via certbot is the standard path",
    key_claims: [{ evidence_id: cite, claim: "certbot provisions Let's Encrypt certificates on a VPS" }],
    contradictions: [],
    dependencies: [
      { type: "account", name: "VPS provider account", required_for: "without it there is no server" },
      { type: "data", name: "user's domain name", required_for: "DNS and certificate issuance" },
    ],
    method: "provision VPS, point DNS, install nginx, run certbot, deploy static files",
    verification: [{ criterion: "site reachable over HTTPS on the user's domain", method: "curl -I https://domain from a clean shell" }],
    covered_unknowns: ["which VPS provider fits the budget"],
    pro_standards: ["redirect all HTTP traffic to HTTPS"],
    risks: ["DNS propagation delay"],
  });
}

export function lensHandlerForGoodMission(stage: Stage, lens: string, prompt: string): string {
  void stage;
  if (lens === "gap" || stage === "gap") return REPAIR_VERCEL;
  switch (lens) {
    case "elite":
      return lensReportJson([
        "top operators provision infrastructure as code even for single servers",
        "the standard HTTPS path on a VPS is certbot with nginx",
      ]);
    case "reverse":
      return lensReportJson([
        "a well-known static-site deploy repo provisions nginx via a single script",
        "an abandoned deploy repo failed because it ignored DNS propagation time",
      ]);
    case "fundamentals":
      return lensReportJson([
        "a VPS requires an account with a provider before any deployment",
        "HTTPS requires a domain name under the user's control",
      ]);
    case "first-principles":
      return lensReportJson([
        "certificate issuance requires domain control, so DNS must point at the server first",
      ]);
    case "pro-amateur":
      return lensReportJson([
        "professionals redirect all HTTP traffic to HTTPS and automate renewal",
      ]);
    default:
      return lensReportJson(["generic finding"]);
  }
}

export const ALL_LENTS = LENS_IDS;
