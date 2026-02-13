---
name: github-ingestion
description: Design GitHub ingestion pipelines with rate limits, dedupe, and backfill.
compatibility: opencode
---

## What I do
- Plan Events API polling with cursors and backoff.
- Add Search API backfill to reduce missed events.
- Define idempotent job payloads and dedupe strategy.
- Suggest safe retries and queue sizing.

## When to use me
Use this skill when building or tuning the GitHub ingestion layer,
especially for rate limits and reliability.

## Expected inputs
- Desired polling interval and throughput targets.
- Existing queue or worker setup.
- GitHub token strategy (single vs pool).

## Outputs
- Ingestion architecture and job schema.
- Rate limit and retry strategy.
- Dedupe and cursor persistence plan.

## Constraints
- Process only public repositories.
- Respect GitHub API limits and abuse detection.
