---
name: terrain-scout
description: Use when starting any non-trivial task where the real constraints, dependencies, and failure modes are unknown. Maps the terrain before work begins: goals, blockers, known unknowns, evidence, and gaps.
---

# Terrain scout

Most failed work dies on terrain nobody mapped: the account that was never created, the version that was never checked, the assumption nobody wrote down. This skill forces the map before the march.

## 1. Fix the target

State the objective as one concrete sentence. State the blocker, if any. List the known unknowns — things already known to be unknown. These become mandatory exploration targets, not footnotes.

## 2. Define "done" observably

Write 1-5 success criteria, each checkable by someone who inspects the result. A criterion that cannot be checked is a wish; rewrite it or flag it.

## 3. Gather evidence with provenance

For every load-bearing claim, record: the claim, its source (URL, doc, artifact, conversation), when it was captured, and a confidence level. Anything below 0.4 confidence may inform exploration but may not anchor a decision.

## 4. Inventory dependencies

List every tool, account, permission, credential, environment, and dataset execution requires, with what breaks without it. The dependency you did not list is the one that stops the mission.

## 5. Run the gap check

Ask, and answer honestly:

- What did we overlook?
- Which assumptions remain unverified?
- Which dependency did we fail to investigate?
- What contradicts what we believe?
- Did we mistake an impressive demonstration for a proven implementation?
- What kills this plan when it meets reality?

For each material gap, either close it with evidence or declare it an explicit blocker. Proceed only when open material gaps are zero or declared.

## 6. Leave a record

Write the map down: evidence, gaps, blockers, and the reasoning behind each decision. The record is the terrain memory; the next session starts from it instead of re-scouting blind.
