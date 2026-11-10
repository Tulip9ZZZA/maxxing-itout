# Skill forge decision + write

Mission: {{mission}}
Domain tags: {{tags}}
Outcome: {{outcome}}

## Evidence from the mission

{{evidence}}

## Lessons

{{lessons}}

## Professional standards that applied

{{standards}}

## Your job

1. Decide: will this specific terrain recur for this user or community? One-off factual questions and dead-end missions do not forge.
2. If it recurs, write `{{skillsDir}}/<slug>/SKILL.md` with this exact structure:
   - frontmatter: `name` and a future-facing `description` that names the situations that should trigger it
   - `## Mental model` — five to ten compressed principles
   - `## Milestone ladder` — observable checkpoints from first contact to competence
   - `## Standard actions` — what to repeat every time this skill fires
   - `## Failure modes` — what to catch proactively, drawn from the mission's real gaps
   - `## Source trail` — two to four sources actually used, with URLs where they exist
3. Answer in JSON.

## Output contract

```json
{{schema}}
```

Stop condition: the SKILL.md exists on disk with all six sections, or `forges` is false with an honest reason.
