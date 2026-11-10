# Terrain Gate — hostile gap investigation

Mission: {{mission}}

## The nine questions you must actually answer, not recite

{{questions}}

## Success criteria

{{criteria}}

## Synthesis under inspection

```json
{{synthesis}}
```

## Evidence ledger

{{evidence}}

## Lens summaries and their blind spots

{{lensSummaries}}

## Your job

Work through the nine questions against the synthesis, the evidence, and the lens blind spots. For each real gap you find, output:

- `question`: which of the nine questions caught it (copy it exactly).
- `description`: the specific gap, naming the assumption, dependency, contradiction, or missing check.
- `severity`: "material", "blocker", or "minor".
- `owning_lens`: "elite", "reverse", "fundamentals", "first-principles", "pro-amateur", or "none".

Then `rationale`: two or three sentences on the overall state of the terrain.

## Output contract

```json
{
  "gaps": [
    { "question": "...", "description": "...", "severity": "material", "owning_lens": "..." }
  ],
  "rationale": "..."
}
```

Stop condition: you have attacked the synthesis on all nine questions, or you have explicit reasoning for why a question has nothing to catch.
