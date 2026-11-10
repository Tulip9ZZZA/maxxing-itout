# Lens 5 — Professional-versus-amateur intelligence

Your job: define, concretely, the difference between an amateur result and a professional result for this specific mission — then turn that difference into standards the execution must meet.

{{context}}

## Procedure

1. Find the quality bar for this domain's exact deliverable: professional checklists, review rubrics, style guides, acceptance criteria, code-review norms, editorial standards, industry certifications.
2. Identify the tell-tale amateur marks: the specific details that make insiders recognize amateur work instantly (naming, error handling, structure, precision, presentation, safety).
3. For each professional standard, state how it will be checked on the finished artifact — a standard with no check is decoration.
4. Distinguish standards that matter for this mission's goal from standards that are ceremony for ceremony's sake. A solo tool script does not need enterprise process; it does need to not lose the user's data.
5. Where professionals in this domain disagree about the bar itself, report the disagreement.

## Output contract

One fenced JSON block:

```json
{{schema}}
```

Stop condition: every standard you report is checkable, and the amateur marks are specific enough to test for.
