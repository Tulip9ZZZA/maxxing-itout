/**
 * Logger: human-readable lines to stderr, structured ndjson to the mission log.
 *
 * stderr keeps stdout clean for --json consumers.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

export type LogFields = Record<string, unknown>;

export interface Logger {
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  event(event: string, fields?: LogFields): void;
  readonly logFile?: string;
}

const REDACT_KEYS = /(api[_-]?key|token|secret|password|authorization)/i;

function redact(fields: LogFields | undefined): LogFields {
  if (!fields) return {};
  const out: LogFields = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = REDACT_KEYS.test(key) ? "[redacted]" : value;
  }
  return out;
}

export function consoleLogger(missionLogDir?: string): Logger {
  let logFile: string | undefined;
  if (missionLogDir) {
    mkdirSync(missionLogDir, { recursive: true });
    logFile = path.join(missionLogDir, "log.ndjson");
  }

  const write = (level: string, message: string, fields?: LogFields): void => {
    const safeFields = redact(fields);
    const line =
      Object.keys(safeFields).length > 0
        ? `${level}  ${message}  ${JSON.stringify(safeFields)}`
        : `${level}  ${message}`;
    process.stderr.write(`${line}\n`);
    if (logFile) {
      appendFileSync(
        logFile,
        JSON.stringify({ ts: new Date().toISOString(), level, message, ...safeFields }) + "\n",
      );
    }
  };

  return {
    info: (m, f) => write("info", m, f),
    warn: (m, f) => write("warn", m, f),
    error: (m, f) => write("error", m, f),
    event: (event, f) => write("event", event, f),
    logFile,
  };
}

export function silentLogger(): Logger {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
    event: () => {},
  };
}
