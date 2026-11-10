# Evidence and terrain memory — schema

Everything the Gauntlet learns persists in SQLite (`node:sqlite`, WAL mode) at `~/.maxxing/terrain.db` unless `MAXXING_HOME` says otherwise. The store has one job: the next mission starts from the last mission's map.

## Tables

### missions

| Column | Meaning |
| --- | --- |
| `id` | `msn_<hex>` |
| `objective` | raw user objective text |
| `brief` | JSON `MissionBrief`: objective, blocker, known unknowns, constraints, success criteria, tags, assumptions |
| `phase` | preflight · lenses · synthesis · gate · execute · verify · done · blocked |
| `gate_round` | current gate round |
| `scout_only` | stop after the gate |
| timestamps | created/updated |

### evidence

One row per verified-or-attributed fact.

| Column | Meaning |
| --- | --- |
| `id` | `ev_<hex>` |
| `lens` | which lens (or gate/executor/verifier/user/preflight) captured it |
| `source_type` | web · repo · doc · user · agent · execution |
| `source_url` | provenance, when external |
| `title`, `claim`, `quote` | the fact and its backing words |
| `confidence` | 0..1; below 0.4 may not anchor a synthesis key claim (deterministic gate check) |
| `status` | raw · verified · contradicted · stale |
| `contradicts` | JSON array of evidence ids this conflicts with (populated by the synthesizer's declared pairs) |
| `captured_at` | ISO timestamp of capture — the "dates" half of provenance |

### lens_reports

Upsert per `(mission, lens)`: summary, findings, blind spots. Blind spots are first-class — every one must be covered by the synthesis or become a gate gap.

### synthesis

Upsert per mission: terrain summary, key claims (each must cite an existing evidence id), dependency inventory, compressed method, verification map (one per success criterion), covered unknowns, professional standards, risks.

### gaps

| Column | Meaning |
| --- | --- |
| `question` | the gate question that caught it |
| `description` | the specific gap |
| `severity` | material · minor · blocker |
| `owning_lens` | elite · reverse · fundamentals · first-principles · pro-amateur · none |
| `source` | deterministic · gate-agent |
| `status` | open · researching · closed · accepted-blocker |
| `round` | gate round that logged it |
| `closed_by` | evidence ids or rationale |

### gate_rounds

One row per round: verdict, rationale, checked time. Joined with `gaps` by round for the completion report.

### attempts

Upsert per attempt id: summary, deliverable paths, per-criterion verification (`verified` · `partial` · `failed` · `unverified` with a detail field), overall verdict (worst criterion wins).

### lessons

| Column | Meaning |
| --- | --- |
| `statement` | what worked, what failed, or which gap pattern recurs |
| `kind` | worked · failed · condition · gap-pattern |
| `tags` | domain slugs shared with mission briefs |
| `conditions` | when it applies |

Recall: `findLessonsByTags(tags)` returns lessons whose tags overlap the new brief's tags. The lens context injects them, so mission five opens with mission one's scar tissue.

### Where decisions live

The original specification asked for decisions to be preserved. They are kept in three places rather than a dedicated table: the mission brief's `assumptions` array (what was decided without asking), each `gate_rounds.rationale` (why the gate passed, revised, or blocked), and `lessons` (what the decisions turned out to produce). A dedicated decision-log table is on the roadmap; nothing in the current flow makes a decision that is not already captured in one of those three.

## Rules that make it memory instead of a scrap heap

- Evidence stores claims and provenance, not scraped page dumps.
- Every record is queryable by mission, lens, status, or severity.
- The gap log is append-only history: catching a gap is as valuable as closing one.
- Lessons are derived only from verified attempts, failed attempts, and closed material gaps — not from raw scouting prose.
