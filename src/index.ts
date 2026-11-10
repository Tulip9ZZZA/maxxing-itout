#!/usr/bin/env node
/**
 * Maxxing V2 entrypoint.
 *
 *   maxxing run "get my app deployed to a VPS with HTTPS, tonight"
 */

import { main } from "./cli.js";

main().catch((error: unknown) => {
  process.stderr.write(`maxxing failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
