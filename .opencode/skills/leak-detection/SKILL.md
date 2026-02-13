---
name: leak-detection
description: Build and maintain secret detection rules, redaction, and dedupe logic.
compatibility: opencode
---

## What I do
- Draft provider-specific regex rules and heuristics.
- Define redaction and hashing policies (never store raw secrets).
- Suggest false-positive mitigations and test fixtures.
- Specify detection coverage and confidence tiers.

## When to use me
Use this skill when designing or updating detection logic, redaction rules,
or provider coverage for API key leaks.

## Expected inputs
- Provider list and examples (if available).
- Current regex rules or match logic.
- Redaction policy requirements.

## Outputs
- A rule specification and examples.
- Redaction and hashing guidance.
- Test cases for high/low confidence matches.

## Constraints
- Never store or log raw secrets.
- Prefer deterministic, explainable rules.
