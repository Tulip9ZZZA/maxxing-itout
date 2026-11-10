# Verify the attempt

The executor produced these deliverables:

{{deliverables}}

## Success criteria and their checks

For each criterion, run or inspect its check against the artifacts on disk:

{{criteria}}

## Your job

1. Confirm each deliverable exists in the current working directory.
2. For every criterion, execute its check (read files, run commands, open artifacts).
3. Assign an honest verdict per criterion with the evidence for your verdict in `detail`.

## Output contract

```json
{
  "verification": [
    { "criterion": "copy the criterion text exactly", "verdict": "verified | partial | failed | unverified", "detail": "what you ran or inspected and what you saw" }
  ]
}
```

Stop condition: every criterion has a verdict backed by something you actually did this session.
