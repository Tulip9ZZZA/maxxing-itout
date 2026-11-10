/**
 * CLI. Hand-rolled argument parsing — the command surface is small enough
 * that a dependency would be heavier than the code it replaces.
 *
 *   maxxing run "objective" [--scout-only] [--rounds N] [--config path] [--json] [--quiet]
 *   maxxing resume <mission-id> [--json] [--quiet]
 *   maxxing map [--json]
 *   maxxing report <mission-id>
 *   maxxing lessons [--json]
 *   maxxing forge <mission-id>
 *   maxxing config
 */

import path from "node:path";
import { existsSync, readFileSync } from "node:fs";
import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk";
import { loadConfig, missionDir, type MaxxingConfig } from "./config.js";
import { TerrainStore } from "./store/store.js";
import { SdkAgentClient } from "./agent/client.js";
import { makeSafetyPolicy } from "./safety.js";
import { Gauntlet } from "./pipeline/orchestrator.js";
import { forgeSkill } from "./pipeline/forge.js";
import { consoleLogger } from "./log.js";
import type { MissionOutcome } from "./core/types.js";

export interface ParsedArgs {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2);
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  let command = "run";

  const knownCommands = new Set(["run", "resume", "map", "report", "lessons", "forge", "config", "help"]);
  let first = true;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else if (first && knownCommands.has(arg)) {
      command = arg;
      first = false;
    } else {
      positional.push(arg);
      first = false;
    }
  }
  return { command, positional, flags };
}

export async function main(argv: string[] = process.argv): Promise<void> {
  const parsed = parseArgs(argv);

  if (parsed.command === "help" || parsed.flags.help === true) {
    printHelp();
    return;
  }

  let config: MaxxingConfig;
  try {
    config = loadConfig(typeof parsed.flags.config === "string" ? parsed.flags.config : undefined);
  } catch (error) {
    fail(`configuration error: ${String(error)}`);
  }

  const canUseTool: CanUseTool = makeSafetyPolicy(config.codeExecution);

  if (parsed.command === "config") {
    printJson(config);
    return;
  }

  const store = new TerrainStore(path.join(config.home, "terrain.db"));

  try {
    switch (parsed.command) {
      case "run": {
        const objective = parsed.positional.join(" ").trim();
        if (objective.length === 0) fail('usage: maxxing run "your mission"');
        if (typeof parsed.flags.rounds === "string") {
          const rounds = Number(parsed.flags.rounds);
          if (!Number.isInteger(rounds) || rounds < 1 || rounds > 10) fail("--rounds must be an integer 1-10");
          config.maxGateRounds = rounds;
        }
        const gauntlet = new Gauntlet({ client: new SdkAgentClient(), store, config, canUseTool });
        const outcome = await gauntlet.runMission(objective, {
          scoutOnly: parsed.flags["scout-only"] === true,
          quiet: parsed.flags.quiet === true,
        });
        finishRun(outcome, parsed.flags.json === true);
        break;
      }
      case "resume": {
        const missionId = parsed.positional[0];
        if (!missionId) fail("usage: maxxing resume <mission-id>");
        const gauntlet = new Gauntlet({ client: new SdkAgentClient(), store, config, canUseTool });
        const outcome = await gauntlet.resumeMission(missionId, { quiet: parsed.flags.quiet === true });
        finishRun(outcome, parsed.flags.json === true);
        break;
      }
      case "map": {
        const missions = store.listMissions();
        const lessons = store.listLessons();
        if (parsed.flags.json === true) {
          printJson({
            missions: missions.map((m) => ({
              id: m.id,
              objective: m.objective,
              phase: m.phase,
              gateRound: m.gateRound,
              scoutOnly: m.scoutOnly,
            })),
            lessonCount: lessons.length,
          });
        } else {
          process.stderr.write(`Terrain map: ${missions.length} mission(s), ${lessons.length} lesson(s)\n`);
          for (const mission of missions) {
            process.stderr.write(`  ${mission.id}  [${mission.phase}]  ${mission.objective.slice(0, 80)}\n`);
          }
        }
        break;
      }
      case "report": {
        const missionId = parsed.positional[0];
        if (!missionId) fail("usage: maxxing report <mission-id>");
        const reportPath = path.join(missionDir(config, missionId), "report.md");
        if (!existsSync(reportPath)) fail(`no report for mission ${missionId} at ${reportPath}`);
        process.stdout.write(readFileSync(reportPath, "utf8"));
        break;
      }
      case "forge": {
        const missionId = parsed.positional[0];
        if (!missionId) fail("usage: maxxing forge <mission-id>");
        const mission = store.getMission(missionId);
        if (!mission) fail(`mission ${missionId} not found`);
        const attempts = store.listAttempts(missionId);
        const attempt = attempts.length > 0 ? attempts[attempts.length - 1]! : null;
        const gauntletConfig = config;
        const result = await forgeSkill(
          new SdkAgentClient(),
          mission.brief,
          store.listEvidence(missionId),
          attempt,
          store.listLessons(missionId),
          store.getSynthesis(missionId),
          {
            model: gauntletConfig.model,
            maxTurns: gauntletConfig.maxTurnsPerExecutor,
            permissionMode: gauntletConfig.permissionMode,
            cwd: process.cwd(),
            codeExecution: false,
            canUseTool,
            skillsDir: path.join(process.cwd(), "skills"),
          },
        );
        if (parsed.flags.json === true) {
          printJson(result);
        } else {
          process.stderr.write(`${result.forged ? "forged" : "not forged"}: ${result.reason}\n`);
          if (result.skillPath) process.stderr.write(`skill: ${result.skillPath}\n`);
        }
        if (!result.forged) process.exitCode = 1;
        break;
      }
      case "lessons": {
        const lessons = store.listLessons();
        if (parsed.flags.json === true) {
          printJson(lessons);
        } else {
          for (const lesson of lessons) {
            process.stderr.write(`[${lesson.kind}] (${lesson.tags.join(",")}) ${lesson.statement}\n`);
          }
        }
        break;
      }
      default:
        printHelp();
    }
  } finally {
    store.close();
  }
}

function finishRun(outcome: MissionOutcome, asJson: boolean): void {
  if (asJson) {
    printJson(outcome);
  } else {
    process.stderr.write(`\nMission ${outcome.phase}.\n`);
    process.stderr.write(JSON.stringify(outcome, null, 2) + "\n");
  }
  if (outcome.phase === "blocked") process.exitCode = 2;
}

function printJson(value: unknown): void {
  process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

function fail(message: string): never {
  process.stderr.write(`error: ${message}\n`);
  process.exit(2);
}

function printHelp(): void {
  process.stdout.write(`maxxing — scout the terrain, close the gaps, execute.

Commands:
  run "objective"   Run the full Gauntlet: preflight, five lenses, synthesis,
                    Terrain Gate, execution, verification.
    --scout-only    Stop after the Terrain Gate passes; no execution.
    --rounds N      Terrain Gate revise-loop cap (1-10, default 3).
    --json          Machine-readable outcome on stdout.
    --quiet         Suppress event logging.
  resume <id>       Resume a mission from its persisted phase.
  map               List missions and lesson counts (the terrain map).
  report <id>       Print a mission's completion report.
  lessons           Print all terrain lessons.
  forge <id>        Forge a reusable skill from a completed mission's terrain
                    (evidence-gated; refuses when the research was thin).
  config            Print the resolved configuration.

Configuration: maxxing.config.json in the working directory, or MAXXING_HOME,
MAXXING_MODEL, MAXXING_MAX_GATE_ROUNDS, MAXXING_PERMISSION_MODE env vars.
`);
}
