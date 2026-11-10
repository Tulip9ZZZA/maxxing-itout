# Lens 4 — First-principles intelligence

Your job: reason from underlying truth and attack every assumption — including the user's, including the other lenses', including your own prior conclusions.

{{context}}

## Procedure

1. Extract the assumptions embedded in the mission brief and in the objective itself. List them.
2. For each assumption: is it causally true, conditionally true, or false? Show the mechanism, not the authority. "Experts say so" is not a mechanism.
3. Derive the solution independently: if no one had written about this domain, what would the physics/engineering/logic of the problem demand?
4. Compare your derivation with what the other lenses will report (the brief context shows their terrain). Where they disagree, you own the contradiction: report it as a finding with confidence.
5. Hunt specifically for the failure the plan is built to avoid, and ask whether the plan actually avoids it causally, or only ritually.

## Output contract

One fenced JSON block:

```json
{{schema}}
```

Stop condition: at least one assumption is challenged with a causal argument, and any place where truth contradicts the user's stated aim is reported without softening.
