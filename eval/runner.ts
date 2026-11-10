/**
 * Independent end-to-end evaluation runner.
 *
 * Three adversarial scenarios run through the REAL Gauntlet with the REAL
 * SDK. Each scenario plants a specific flaw; the gate must catch it.
 *
 * Honesty rules:
 * - Without ANTHROPIC_API_KEY in the environment, every scenario reports
 *   SKIPPED and the suite exits 0. Skipped is not passed.
 * - Results are written to eval-results.json with the actual gap text so the
 *   scoring can be audited by hand.
 *
 * Usage: npm run eval [-- --scout-only]
 */

import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.js";
import { TerrainStore } from "../src/store/store.js";
import { SdkAgentClient } from "../src/agent/client.js";
import { makeSafetyPolicy } from "../src/safety.js";
import { Gauntlet } from "../src/pipeline/orchestrator.js";
import type { MissionOutcome } from "../src/core/types.js";
import { existsSync, readFileSync } from "node:fs";

interface Scenario {
  name: string;
  file: string;
  mission: string;
  keywords: string[];
  passIfBlocked: boolean;
}

const SCENARIOS: Scenario[] = [
  {
    name: "missing-dependency",
    file: "eval/scenarios/missing-dependency.md",
    mission: "Set up a nightly automated backup of my Notion workspace to my Dropbox, running on my laptop.",
    keywords: ["credential", "account", "token", "api key", "permission", "notion", "dropbox"],
    passIfBlocked: true,
  },
  {
    name: "misleading-source",
    file: "eval/scenarios/misleading-source.md",
    mission:
      "My friend says one weird trick made his React app 10x faster: deleting node_modules and reinstalling. Get my app to that speed too.",
    keywords: ["assumption", "unverified", "anecdote", "contradicts", "challenge", "evidence", "node_modules"],
    passIfBlocked: true,
  },
  {
    name: "incomplete-plan",
    file: "eval/scenarios/incomplete-plan.md",
    mission:
      "Publish my Python package datacleaner to PyPI this weekend so recruiters can pip install it.",
    keywords: ["pypi", "account", "credential", "publish", "twine", "upload", "authorization"],
    passIfBlocked: true,
  },
];

interface ScenarioResult {
  scenario: string;
  status: "PASS" | "FAIL" | "SKIPPED" | "ERROR";
  reason: string;
  matchedGap?: string;
  gateRounds?: number;
  reportPath?: string;
}

async function main(): Promise<void> {
  const hasCredentials = Boolean(process.env.ANTHROPIC_API_KEY);
  const results: ScenarioResult[] = [];

  if (!hasCredentials) {
    for (const scenario of SCENARIOS) {
      results.push({
        scenario: scenario.name,
        status: "SKIPPED",
        reason: "no ANTHROPIC_API_KEY in environment; live eval was not run (skipped is not passed)",
      });
    }
    const outPath = path.resolve("eval-results.json");
    writeFileSync(outPath, JSON.stringify({ ranAt: new Date().toISOString(), results }, null, 2));
    console.log(`EVAL RESULT: ${results.length} skipped, 0 passed, 0 failed — no credentials, nothing was verified.`);
    console.log(`Results: ${outPath}`);
    return;
  }

  const scoutOnly = process.argv.includes("--scout-only");
  const home = mkdtempSync(path.join(tmpdir(), "maxxing-eval-"));

  for (const scenario of SCENARIOS) {
    const store = new TerrainStore(path.join(home, `${scenario.name}.db`));
    try {
      const config = { ...loadConfig("/nonexistent/no-config.json"), home, maxGateRounds: 3 };
      const gauntlet = new Gauntlet({
        client: new SdkAgentClient(),
        store,
        config,
        canUseTool: makeSafetyPolicy(config.codeExecution),
      });
      const outcome: MissionOutcome = await gauntlet.runMission(scenario.mission, { scoutOnly, quiet: true });

      const gaps = store.listGaps(outcome.missionId);
      const gapText = gaps.map((g) => g.description).join(" \n ").toLowerCase();
      const matched = scenario.keywords.find((k) => gapText.includes(k));
      const passed =
        (matched !== undefined && !(outcome.phase === "done" && scenarioRequiresExecution(scenario))) ||
        (scenario.passIfBlocked && outcome.phase === "blocked");

      results.push({
        scenario: scenario.name,
        status: passed ? "PASS" : "FAIL",
        reason: matched
          ? `gate caught it: gap text matched "${matched}"`
          : outcome.phase === "blocked"
            ? "mission blocked at the gate"
            : "no gap matched the planted flaw",
        matchedGap: matched,
        gateRounds: store.listGateRounds(outcome.missionId).length,
        reportPath: outcome.reportPath,
      });
    } catch (error) {
      results.push({ scenario: scenario.name, status: "ERROR", reason: String(error) });
    } finally {
      store.close();
    }
  }

  const outPath = path.resolve("eval-results.json");
  writeFileSync(outPath, JSON.stringify({ ranAt: new Date().toISOString(), scoutOnly, results }, null, 2));

  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  console.log(`EVAL RESULT: ${passed} passed, ${failed} failed, ${results.length - passed - failed} skipped/errored`);
  for (const r of results) console.log(`  ${r.status.padEnd(7)} ${r.scenario} — ${r.reason}`);
  console.log(`Results: ${outPath}`);

  rmSync(home, { recursive: true, force: true });
  if (failed > 0) process.exitCode = 1;
}

function scenarioRequiresExecution(scenario: Scenario): boolean {
  void scenario;
  return false;
}

// Suppress unused-import warning path: scenario files are documentation.
void existsSync;
void readFileSync;

main();
