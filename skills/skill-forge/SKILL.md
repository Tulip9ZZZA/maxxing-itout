---
name: skill-forge
description: Use this when a researched domain is recurring or compounding, or when the user asks to remember a method or make it a skill.
---

# Skill Forge

Turn useful research into a reusable capability instead of a one-off answer.

## When to forge

Forge a skill when the user will return to the domain, when each session should build on the last, or when the user explicitly asks to remember a method. Do not forge a skill for a one-off factual question.

## Required skill structure

Create `skills/<domain-slug>/SKILL.md` with:

1. Frontmatter containing a name and a future-facing trigger description.
2. A compressed mental model with five to ten high-value principles.
3. A milestone ladder with observable checkpoints from beginner to advanced.
4. Standard drills or next actions that should be repeated whenever the skill fires.
5. Known failure modes to catch proactively.
6. A source trail with two to four references actually used in the research.

## Process

1. Slugify the domain.
2. Write the skill from the research already completed this turn.
3. Tell the user what was created and where it lives.
4. Let the normal skill-search flow surface it in future sessions.
