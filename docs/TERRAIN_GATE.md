# The Terrain Gate — specification

Layer six is the mandatory filter between scouting and execution. It is not a peer of the five lenses; it owns them. Anything the lenses produced survives only if it clears the gate.

## Contract

Input: the mission brief, the five lens reports, all captured evidence, the current synthesis, the round number, the round cap, the evidence floor.

Output: a verdict (`pass` | `revise` | `blocked`), a set of gap records, and a rationale.

Guarantees:

1. A mission with any open material gap never reaches the executor.
2. Every gap names the gate question that caught it, its severity, and its owning lens.
3. Every gap is persisted, including gaps on a pass (as closed/minor). The gap log is the terrain map.
4. The revise loop is capped. At the cap, unresolved material gaps become explicit blockers with their descriptions — the user gets a straight answer, not a confident blur.
5. Deterministic checks cannot be argued away by the model.

## Deterministic checks

Implemented in `src/pipeline/gate.ts` (`deterministicChecks`). Each check is paired with an adversarial test in `tests/gate.test.ts`.

| # | Check | Severity | Catches |
| --- | --- | --- | --- |
| 1 | Synthesis missing | blocker | Nothing to execute against |
| 2 | Lens produced no report / zero findings | material, owned by that lens | Silent scouting; unparseable output |
| 3 | Lens blind spot not covered by synthesis unknowns/risks | material, owned by that lens | Unverified assumptions wearing a badge |
| 4 | Dependency inventory empty | material | The account/tool you did not know you needed |
| 5 | Success criterion without a verification entry | material | Plans that cannot be checked |
| 6 | Contradicting evidence both still `raw` | material | Terrain that is not mapped yet |
| 7 | Brief's known unknown absent from covered unknowns | material | Declared ignorance nobody explored |
| 8 | Evidence count below the floor | material | Five reports, three facts: a vibe |
| 9 | Key claim citing unknown evidence | material | Fabricated citations |
| 10 | Key claim on evidence with confidence < 0.4 | material | Impressive demonstrations mistaken for proven implementations |

Coverage tests use keyword overlap (words ≥ 4 chars) between the blind spot / unknown / criterion text and the synthesis coverage. This is deliberately conservative: a blind spot is only "covered" when the synthesis names it in shared words.

## The hostile pass

The gate agent (`prompts/terrain-gate.md`) receives the synthesis, the evidence ledger, the lens summaries with their blind spots, and the nine questions from the original specification:

1. What did we overlook?
2. Which assumptions remain unverified?
3. What important information is missing?
4. Which dependencies, tools, resources, or constraints did we fail to investigate?
5. What contradicts our current understanding?
6. Did we reverse-engineer the right examples?
7. Did we neglect something fundamental?
8. Did we mistake an impressive demonstration for a proven implementation?
9. What could make this entire plan fail when it meets reality?

Its output is a JSON gap list. The parser normalizes severities and lens names (unknown values become `material` and `none`, never dropped) and degrades to a minor "unparseable" gap if the agent answers in prose — the deterministic checks have already run either way.

Unparseable gate output is deliberately **not** a pass and **not** a block: deterministic checks alone decide the round, and the incident is logged.

## Verdicts

| Candidates | Below cap | At cap |
| --- | --- | --- |
| Any blocker severity | blocked | blocked |
| Material gaps present | revise | blocked (gaps become explicit blockers) |
| Minor gaps only | pass (logged) | pass (logged) |
| Empty | pass | pass |

## The revise loop

Material gaps route to `repairGaps`: each owning lens gets a targeted prompt naming the gap (not its whole brief again), with the instruction that a finding must address the gap head-on. A repair closes a gap when new evidence shares keywords with the gap description; otherwise the gap stays open and counts at the next round. After repair, the synthesis is rebuilt from all reports and all evidence, and the gate runs again with `round + 1`.

## Design rationale

The specification's phrase "do not allow a weak research result to pass simply because the five lenses produced a large amount of information" is implemented as a mechanical rule: volume never enters the verdict. Only the checks above do. The gate is the layer that makes the difference between a tool that generates confident noise and one that scouts terrain — so it is the one component whose failure modes are all tested.
