/**
 * Safety policy wired into the SDK via canUseTool.
 *
 * Hard boundaries, regardless of configuration:
 * - no publishing, pushing, or releasing
 * - no piping remote content into a shell (any shell, any syntax)
 * - no uploading local files to remote endpoints from Bash
 * - no destructive filesystem or disk operations
 * - no reading or transmitting secret material (.env, keys, certs)
 *
 * The Bash checks operate on the command STRING (Bash input carries no
 * file_path), so every denylist entry is written against realistic bypass
 * syntax: flag reordering, alternate shells, process substitution, eval
 * indirection, and subcommand placement.
 */

import type { CanUseTool, PermissionResult } from "@anthropic-ai/claude-agent-sdk";

const GIT_PUSH = /\bgit\b[^|;&]*\s(--no-verify\s+|--force\s+|-f\s+|--dry-run\s+)*push\b/;
const PUBLISH = /\b(npm|pnpm|yarn|bun)\s+((--\S+|-r|-ws)\s+)*publish\b|\btwine\s+upload\b|\bgh\s+(release\s+create|repo\s+create|pr\s+create)\b|\bcargo\s+publish\b|\bdotnet\s+nuget\s+push\b/;
const PIPE_TO_SHELL = /\|\s*(sudo\s+)?(ba|z|da|k|fi)?sh\b|\|\s*(sudo\s+)?sh\b/;
const REMOTE_EXECUTE = /<\(\s*(curl|wget)\b|\beval\s+"?\$?\(?\s*(curl|wget)\b|\bbash\s+-c\s+["']?\s*(curl|wget)\b/;
const REMOTE_UPLOAD = /\b(curl|wget)\b[^|;&]*\s(--data(-binary|-raw|-urlencode)?\s+@|--form\s+[^ ]*=@|-[Ff]\s+[^\s]*=@|-T\s+@|--upload-file\s+@|--header\s+["']?authorization)/i;
const DESTRUCTIVE_SYS = /\bmkfs\b|\bdd\s+if=[^;|]*\sof=\/dev\/|\b(shutdown|reboot|halt)\b/;
const CHMOD_777 = /\bchmod\b[^|;&]*777/;

/** Denylist for whole Bash command strings. Returns a reason or null. */
export function checkBashCommand(command: string): string | null {
  if (commandContainsSecretPath(command)) return "secret files must not be read or transmitted through shell commands";
  if (GIT_PUSH.test(command)) return "git push requires explicit user authorization";
  if (PUBLISH.test(command)) return "publishing requires explicit user authorization";
  if (PIPE_TO_SHELL.test(command)) return "piping remote content into a shell is not allowed";
  if (REMOTE_EXECUTE.test(command)) return "executing remote content via substitution or eval is not allowed";
  if (REMOTE_UPLOAD.test(command)) return "uploading local files to remote endpoints from Bash is not allowed";
  if (hasRmRecursiveForce(command)) return "recursive force deletion is not allowed; delete targets explicitly";
  if (DESTRUCTIVE_SYS.test(command)) return "destructive system operation denied";
  if (CHMOD_777.test(command)) return "chmod 777 is not allowed; use scoped permissions";
  return null;
}

/**
 * Matches `rm` invocations that combine recursion and force in any syntax:
 * -rf, -f -r, -r -f, -fr, -Rf, --recursive --force, --force --recursive.
 */
export function hasRmRecursiveForce(command: string): boolean {
  const rmMatch = /(^|[\s;|(])rm\s+([^;|&]*)/.exec(command);
  if (!rmMatch) return false;
  const args = rmMatch[2] ?? "";
  const shortFlags = [...args.matchAll(/(?:^|\s)-([a-zA-Z]+)/g)].flatMap((m) => [...m[1]!]);
  // args starts at the first flag, so long flags need no leading-space test.
  const recursive =
    /--recursive\b/.test(args) ||
    shortFlags.some((c) => c === "r" || c === "R");
  const force =
    /--force\b/.test(args) ||
    shortFlags.some((c) => c === "f");
  const noPreserveRoot = /--no-preserve-root/.test(args);
  return (recursive && force) || noPreserveRoot;
}

const SECRET_PATH_IN_COMMAND = [
  // `.env` as a path segment or a bare name: after a space, quote, `=`, or `/`.
  // `.env.example` is stripped before these run.
  /(^|[\s'"=/])\.env(\.[\w-]+)?(["'\s]|$)/i,
  /\bid_rsa\b|\bid_ed25519\b|\bid_ecdsa\b/i,
  /\.pem\b(\s|$|["'])/i,
  /["'\s]\S*\.key(\s|$|["'])/i,
];

const BENIGN_ENV_COPY = /^cp\s+"?\S*\.env\.example"?\s+"?\S*\.env"?\s*$/;

const SECRET_PATH_EXEMPT = /\.env\.example\b/i;

/**
 * Scans a shell command for secret paths the Read-tool path check would
 * never see: `cat .env`, `grep TOKEN .env.local`, `scp id_rsa host:`,
 * `curl --data-binary @server.pem https://...`.
 */
export function commandContainsSecretPath(command: string): boolean {
  if (BENIGN_ENV_COPY.test(command.trim())) return false;
  const stripped = stripSecretExemptions(command);
  return SECRET_PATH_IN_COMMAND.some((pattern) => pattern.test(stripped));
}

function stripSecretExemptions(command: string): string {
  return command.replace(SECRET_PATH_EXEMPT, "ENV_EXAMPLE_FILE");
}

const DENIED_PATH_PATTERNS: { pattern: RegExp; reason: string }[] = [
  { pattern: /(^|\/)\.env(\..+)?$/i, reason: "secret files are off-limits; use .env.example as the template" },
  { pattern: /id_rsa|id_ed25519|id_ecdsa|\.pem$|\.key$/i, reason: "key material is off-limits" },
];

/** Denylist for tools that address files directly (Read/Write/Edit/...). */
export function checkPathAccess(filePath: string): string | null {
  if (/(^|\/)\.env\.example$/i.test(filePath)) return null;
  for (const { pattern, reason } of DENIED_PATH_PATTERNS) {
    if (pattern.test(filePath)) return reason;
  }
  return null;
}

/**
 * Build the canUseTool callback for a session. `allowBash` reflects the
 * codeExecution config; when false every shell command is refused up front.
 */
export function makeSafetyPolicy(allowBash: boolean): CanUseTool {
  return async (toolName: string, input: Record<string, unknown>): Promise<PermissionResult> => {
    if (toolName === "Bash") {
      if (!allowBash) {
        return deny("code execution is disabled in config (codeExecution: false)");
      }
      const command = typeof input.command === "string" ? input.command : "";
      const violation = checkBashCommand(command);
      if (violation) return deny(violation);
    }

    const pathCandidate =
      (typeof input.file_path === "string" && input.file_path) ||
      (typeof input.path === "string" && input.path) ||
      (typeof input.notebook_path === "string" && input.notebook_path) ||
      null;
    if (pathCandidate) {
      const violation = checkPathAccess(pathCandidate);
      if (violation) return deny(violation);
    }

    return { behavior: "allow" };
  };
}

function deny(message: string): PermissionResult {
  return { behavior: "deny", message };
}
