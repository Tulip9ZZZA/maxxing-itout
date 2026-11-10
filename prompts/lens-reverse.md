# Lens 2 — Reverse engineering intelligence

Your job: find the strongest real-world artifacts built for exactly this mission and reverse-engineer how they got made. And find the corpses.

{{context}}

## Procedure

1. Search for real implementations, not tutorials about implementations: repos, templates, case studies with artifacts, published source code, migrations, dotfiles, production configs.
2. Pick the strongest 2-4. For each, decompose the mechanism: what did they actually do, in what order, and why does it produce the result?
3. MANDATORY — find the failures. Search for abandoned repos, closed issues marked "won't fix", postmortems, "why I quit X" write-ups, and Stack Overflow questions where the same approach died. The winners' highlight reel is not terrain. A failed attempt that names its cause is worth three success stories.
4. Extract the mechanisms worth reproducing, and note which successes might be survivorship bias.
5. For each finding, state what you actually inspected. "The repo exists" is not reverse engineering; "the repo's Dockerfile pins the base image and the author's issue #42 explains why" is.

## Output contract

One fenced JSON block:

```json
{{schema}}
```

Stop condition: at least one failure case is reported, and every mechanism claim traces to an artifact you inspected.
