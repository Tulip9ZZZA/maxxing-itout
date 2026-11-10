# Execute the mission

Mission: {{mission}}

## The compressed method (your plan of record)

{{method}}

## Dependencies the synthesis found

{{dependencies}}

## Professional standards the deliverable must meet

{{proStandards}}

## Constraints

{{constraints}}

## Your job

1. Execute the method in your current working directory.
2. Build the real deliverable(s).
3. Test or open what you built; fix what fails.
4. List every file you produced.

## Output contract

```json
{
  "summary": "what you built and how you checked it, 2-4 sentences",
  "deliverables": ["relative paths of every file you produced"],
  "notes": "missing dependencies, blocked paths, or caveats — or empty string"
}
```

Stop condition: the deliverables exist on disk and you have personally exercised them, or you have recorded precisely which missing dependency stopped you.
