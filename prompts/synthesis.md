# Synthesis — compress the terrain

Mission: {{mission}}

## Success criteria (each needs a verification entry)

{{criteria}}

## Known unknowns from the brief

{{knownUnknowns}}

## Lens reports

{{lensReports}}

## Evidence ledger

{{evidence}}

## Your job

Merge the five lenses into one coherent picture:
1. `terrain_summary` — what actually governs success in this domain, one paragraph.
2. `key_claims` — the load-bearing facts, each citing a real evidence id from the ledger.
3. `dependencies` — the complete inventory (tools, accounts, permissions, data, environments). Empty means you believe execution needs nothing; the gate will treat that as a claim to attack.
4. `method` — the compressed execution plan.
5. `verification` — one check per success criterion, concrete enough to run.
6. `contradictions` — pairs of evidence ids from the ledger that conflict with each other. Declaring a pair is honest terrain-mapping; the gate will hold the mission until the conflict is resolved or rejected.
7. `covered_unknowns`, `pro_standards`, `risks`.

## Output contract

```json
{{schema}}
```

Stop condition: every key claim cites an existing evidence id, every criterion has a verification entry, every contradiction you noticed is declared, and the dependency inventory is honest.
