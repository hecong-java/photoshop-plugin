---
status: partial
phase: 09-lemongrid-task-queue
source: [09-VERIFICATION.md]
started: 2026-05-20T12:00:00Z
updated: 2026-05-20T12:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Cluster queue badge rendering
expected: When in Cluster Mode with tasks in the platform queue, a badge appears in the preview section header showing "平台: X 运行中 · Y 排队中 · ~Z分钟" format with green dot
result: [pending]

### 2. Per-task ETA display for QUEUED tasks
expected: QUEUED tasks in MiniTaskList show green "~X分钟" ETA text in both collapsed header and expanded detail views. ETA refreshes every 30 seconds.
result: [pending]

### 3. Direct Mode queue badge unaffected
expected: Switching back to Direct Mode shows only the original queue badge. No cluster badge appears. No polling occurs.
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
