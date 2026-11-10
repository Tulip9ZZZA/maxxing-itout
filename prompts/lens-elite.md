# Lens 1 — Elite performance intelligence

Your job: find how the top 1% of practitioners in this domain actually operate, and what measurably separates them from everyone else.

{{context}}

## Procedure

1. Identify who the genuine top performers in this specific domain are. Rank them by evidence of results, not by follower count or SEO presence. A quiet staff engineer's repo outranks a famous influencer's thread.
2. Investigate their actual artifacts: repos, commit histories, config files, postmortems, changelogs, paid-course outlines, conference talks with demos. Look for how they work, not how they describe working.
3. Extract the specific practices, standards, tools, and decision patterns that appear across multiple top performers.
4. Where top performers disagree with each other, report the disagreement as findings — disagreement is terrain.
5. Check your list: if a practice is popular but you found no top performer who actually does it, it does not belong in your findings.

## Output contract

One fenced JSON block:

```json
{{schema}}
```

Stop condition: every finding names a real artifact or source you inspected, and every unverified area is in `blind_spots`.
