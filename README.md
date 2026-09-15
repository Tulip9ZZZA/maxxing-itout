# Maxxing itout

> A zero-to-pro acceleration agent for learning unfamiliar skills faster.

Maxxing helps you move from **“I have never done this before”** to a concrete, intermediate-level starting point. It researches unfamiliar domains through multiple lenses, compresses the findings into a practical path, builds an artifact you can use immediately, and can forge a reusable skill for future sessions.

This is an early **V1** built on the [Claude Agent SDK](https://docs.claude.com/en/api/agent-sdk). The repository currently focuses on the agent loop, prompt, configuration, and two core skills. A visual identity and logo can be added later without changing the core architecture.

## The Maxxing Loop

1. **Diagnose** the target, the desired capability, and the learner’s starting point.
2. **Research** through first principles, expert consensus, common failure modes, and fastest-path precedent.
3. **Compress** the research into the smallest set of principles, drills, and checkable milestones that matter most.
4. **Apply / build** a useful plan, checklist, template, starter project, or practice artifact.
5. **Skill-forge** a reusable `SKILL.md` when the domain is recurring or compounding.

## Quick start

### Prerequisites

- Node.js and npm
- Access to the Claude Agent SDK and a configured Anthropic authentication method supported by that SDK
- Web search and file-tool access enabled for the agent session

### Install

```bash
npm install
```

### Run

Pass the learning target as a quoted prompt:

```bash
npx tsx run.ts "I've never touched piano. Get me to intermediate fast."
```

If no prompt is supplied, Maxxing uses a woodworking example:

```bash
npx tsx run.ts
```

> **Cost note:** Running the agent may incur Claude API usage charges according to your Anthropic account and model settings. This repository itself is free to clone and modify.

## What is included

- `SYSTEM_PROMPT.md` — Maxxing’s identity, reasoning loop, tone, and safety boundaries.
- `agent.config.json` — model, tool, skill, and behavior configuration.
- `run.ts` — Node/TypeScript entrypoint for invoking the Claude Agent SDK.
- `skills/deep-research/SKILL.md` — multi-lens research workflow.
- `skills/skill-forge/SKILL.md` — guidance for turning research into reusable skills.

## Extending Maxxing

Add a hand-written skill under `skills/<domain>/SKILL.md`. Skills forged during later sessions can live in the same directory and follow the structure in `skills/skill-forge/SKILL.md`.

To tune behavior, edit `agent.config.json`—especially `behaviorFlags` and the skill list. Keep secrets and provider credentials outside the repository.

## Design principles

- **Evidence before confidence:** current, tool-specific, or version-specific claims should be researched rather than guessed.
- **Action over explanation:** the default output should help the learner do the next useful thing.
- **Progress over vibes:** milestones should describe observable capabilities.
- **Compounding over repetition:** recurring domains should become reusable skills.
- **Safety over speed:** physical and regulated domains require appropriate caveats and professional boundaries.

## Current scope

This V1 intentionally does not include a web UI, persistent database, automated code execution, or a logo asset. Those can be layered onto the current file-based architecture later.

## Contributing

Issues and pull requests are welcome. When proposing a change, explain which part of the Maxxing Loop it improves and include a reproducible example where possible.

For local checks, confirm that the TypeScript entrypoint remains readable and that Markdown contains no credentials or private configuration values.

## License

No license has been added yet. Until a license file is committed, all rights are reserved by the copyright holder. Add an explicit open-source license before encouraging reuse or redistribution.

## Project link

[github.com/Tulip9ZZZA/maxxing-itout](https://github.com/Tulip9ZZZA/maxxing-itout)
