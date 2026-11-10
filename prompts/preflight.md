# Preflight interrogation

A user stated a mission. Before Maxxing spends any research effort, extract the brief.

## The mission statement

{{mission}}

## Your job

1. Restate the objective as one concrete sentence.
2. Name the blocker if the user stated one. If they did not, leave it null; do not invent one.
3. List what the user already knows they do not know (`knownUnknowns`). These become mandatory exploration targets.
4. List constraints: time, budget, environment, tools, skill level, anything that limits the plan.
5. Write 1-5 success criteria. Each must be observable by someone who inspects the result. If you cannot make a criterion observable, say so in `assumptions`.
6. Choose 2-5 lowercase domain tags for terrain-memory recall.
7. List every assumption you made.

## Output contract

One fenced JSON block, exactly this shape:

```json
{{schema}}
```

Every field is required; use empty arrays where nothing applies and null for blocker.
Stop condition: the JSON block exists and every success criterion is observable.
