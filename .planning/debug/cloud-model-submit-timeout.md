---
status: root_cause_found
trigger: 接口响应超过30秒 断开了（云端模型绘图任务提交）
created: 2026-05-27
updated: 2026-05-27
---

## Symptoms

- **Expected**: Cloud model drawing task submission should complete and return result within reasonable time
- **Actual**: API response exceeds 30 seconds, connection drops with no error message shown to user
- **Error messages**: None - just silent disconnect
- **Timeline**: Was working before, recently started failing
- **Reproduction**: Submit any cloud model drawing task
- **Scope**: Only affects cloud model tasks, not local ComfyUI tasks

## Current Focus

- **hypothesis**: The 30-second default timeout in lemongridFetch is too short for cloud model task submission
- **next_action**: Apply fix - increase timeout for submitTask specifically

## Evidence

- 2026-05-27: `lemongridFetch` in `lemongrid-auth.ts:155` has default timeout of 30000ms (30 seconds)
- 2026-05-27: `LemonGridClient.fetchWithAuth` at `lemongrid.ts:312` calls `lemongridFetch` without overriding timeout - so all task API calls use the 30s default
- 2026-05-27: `submitTask` at `lemongrid.ts:394` calls `fetchJson` which calls `fetchWithAuth` which calls `lemongridFetch` - no timeout override at any level
- 2026-05-27: UXP bridge handler `lemongrid.fetch` at `main.js:1117` also defaults to 30000ms timeout, same issue
- 2026-05-27: Compare with `comfyui.fetch` handler at `main.js:816` which has retry logic with doubled timeout on abort
- 2026-05-27: Browser-mode `doBrowserFetch` at `lemongrid-auth.ts:210` uses AbortController with the 30s timeout, causing AbortError
- 2026-05-27: Draw.tsx catch block at line 3128-3141 does NOT check for AbortError/timeout - falls through to generic "unknown error" message
- 2026-05-27: The `comfyui.uploadImage` at `upload.ts:89` uses 120000ms for uploads but only 30000ms for other calls

## Eliminated

- Not a server-side issue: the server processes the task fine, it just takes longer than 30s to respond
- Not a network connectivity issue: the connection works, just times out

## Resolution

- **root_cause**: The `lemongridFetch` function defaults to a 30-second timeout (`lemongrid-auth.ts:155`). The `submitTask` API call (`lemongrid.ts:394`) flows through `fetchJson -> fetchWithAuth -> lemongridFetch` without any timeout override. Cloud model task submission on the backend can take longer than 30 seconds (server may do synchronous work like workflow validation, parameter resolution, queue assignment before returning the task ID). When the 30s timeout fires, the AbortController aborts the request, and the error handler in Draw.tsx shows only a generic "unknown error" message because it does not check for AbortError/timeout specifically. The same 30s default applies in the UXP bridge handler at `main.js:1117`.

- **fix**: Two changes needed:
  1. In `lemongrid.ts`: Override the timeout in `fetchWithAuth` or add a `submitTask`-specific call that passes a longer timeout (120000ms / 2 minutes) to `lemongridFetch` for task submission. The cleanest approach is to add a `timeout` parameter to `fetchJson` and `fetchWithAuth`, then pass a longer value from `submitTask`.
  2. In `Draw.tsx`: Add a specific check for AbortError/timeout in the catch block so users see a clear "task submission timed out" message instead of a generic error.
  3. In `main.js` `lemongrid.fetch` handler: Add retry logic similar to `comfyui.fetch` for timeout/abort errors.

- **verification**: Submit a cloud model task and confirm it waits up to 2 minutes before timing out, and shows a clear timeout message if it does.
- **files_changed**:
  - code/webapp/src/services/lemongrid.ts
  - code/webapp/src/services/lemongrid-auth.ts
  - code/webapp/src/pages/Draw.tsx
  - PS-plugin/lemongrid/main.js

## Specialist Review

(Not yet reviewed)
