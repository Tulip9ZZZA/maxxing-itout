/**
 * Configuration: defaults < maxxing.config.json < environment.
 *
 * Every knob exists because something needed it. Nothing here is speculative.
 */

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";

export interface MaxxingConfig {
  /** Model for every agent call. */
  model: string;
  /** Terrain Gate revise loop cap. Unresolved material gaps at the cap become blockers. */
  maxGateRounds: number;
  /** Agentic turns allowed per lens scouting run. */
  maxTurnsPerLens: number;
  /** Agentic turns allowed for execute/verify runs. */
  maxTurnsPerExecutor: number;
  /** Minimum evidence records required for a non-trivial mission to pass the gate. */
  minEvidence: number;
  /** SDK permission mode. */
  permissionMode: "default" | "acceptEdits" | "plan" | "bypassPermissions";
  /** Root for the terrain store and mission artifacts. */
  home: string;
  /** Allow the executor to run shell commands (guarded by the safety policy). */
  codeExecution: boolean;
  /** Allow WebSearch/WebFetch during scouting. */
  webScout: boolean;
}

export const DEFAULT_CONFIG: Readonly<MaxxingConfig> = Object.freeze({
  model: "claude-sonnet-4-6",
  maxGateRounds: 3,
  maxTurnsPerLens: 24,
  maxTurnsPerExecutor: 48,
  minEvidence: 3,
  permissionMode: "acceptEdits",
  home: path.join(os.homedir(), ".maxxing"),
  codeExecution: true,
  webScout: true,
});

export class ConfigError extends Error {}

export function loadConfig(configPath?: string): MaxxingConfig {
  let fileConfig: Partial<MaxxingConfig> = {};
  // Only an explicitly passed path or a real maxxing.config.json is loaded.
  // The example file is documentation and is never auto-applied.
  const candidates = configPath
    ? [configPath]
    : [path.join(process.cwd(), "maxxing.config.json")];

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    try {
      fileConfig = JSON.parse(readFileSync(candidate, "utf8")) as Partial<MaxxingConfig>;
    } catch (error) {
      throw new ConfigError(`Config file ${candidate} is not valid JSON: ${String(error)}`);
    }
    break;
  }

  const merged: MaxxingConfig = { ...DEFAULT_CONFIG, ...fileConfig };

  if (process.env.MAXXING_MODEL) merged.model = process.env.MAXXING_MODEL;
  if (process.env.MAXXING_HOME) merged.home = process.env.MAXXING_HOME;
  if (process.env.MAXXING_MAX_GATE_ROUNDS) {
    merged.maxGateRounds = Number(process.env.MAXXING_MAX_GATE_ROUNDS);
  }
  if (process.env.MAXXING_PERMISSION_MODE) {
    const mode = process.env.MAXXING_PERMISSION_MODE as MaxxingConfig["permissionMode"];
    if (["default", "acceptEdits", "plan", "bypassPermissions"].includes(mode)) {
      merged.permissionMode = mode;
    }
  }

  validate(merged);
  return merged;
}

function validate(config: MaxxingConfig): void {
  if (!Number.isInteger(config.maxGateRounds) || config.maxGateRounds < 1 || config.maxGateRounds > 10) {
    throw new ConfigError("maxGateRounds must be an integer between 1 and 10");
  }
  if (!Number.isInteger(config.maxTurnsPerLens) || config.maxTurnsPerLens < 1) {
    throw new ConfigError("maxTurnsPerLens must be a positive integer");
  }
  if (!Number.isInteger(config.minEvidence) || config.minEvidence < 0) {
    throw new ConfigError("minEvidence must be a non-negative integer");
  }
  if (!config.model || typeof config.model !== "string") {
    throw new ConfigError("model must be a non-empty string");
  }
}

export function missionDir(config: MaxxingConfig, missionId: string): string {
  return path.join(config.home, "missions", missionId);
}
