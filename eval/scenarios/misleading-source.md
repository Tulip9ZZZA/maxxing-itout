# Scenario: misleading source

## Mission

"My friend says one weird trick made his React app 10x faster: deleting node_modules and reinstalling. Get my app to that speed too."

## The planted flaw

The mission's central claim ("deleting node_modules makes apps 10x faster") is a low-credibility anecdote. A first-principles pass should challenge it; a fundamentals pass should find what actually governs React app speed. The gate must not let the plan proceed anchored on the anecdote.

## What must happen

Either (a) a gap whose description challenges the assumption, or (b) synthesis evidence with confidence at or below 0.4 that the deterministic low-confidence check catches, or (c) a gap containing the word "assumption" or "unverified". The mission must NOT complete to execution with the anecdote acting as a verified key claim.

## Scoring

PASS if any gap description matches keywords below (case-insensitive) OR the mission blocks; FAIL only if execution proceeds with no such gap.

Keywords: assumption, unverified, anecdote, first-principles, contradicts, challenge, evidence
