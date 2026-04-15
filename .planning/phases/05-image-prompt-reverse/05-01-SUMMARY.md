---
phase: 05-image-prompt-reverse
plan: 01
subsystem: api
tags: [dashscope, qwen-vl, base64, bridgeFetch, prompt-templates]

# Dependency graph
requires:
  - phase: none
    provides: "Standalone service layer, no prior phase dependencies"
provides:
  - "DashScope API client (analyzeImage) with bridgeFetch integration"
  - "4 Chinese prompt templates (detailed, concise, composition, style)"
  - "3 Qwen VL model definitions with default selection"
  - "imageElementToBase64 utility with data URL extraction, canvas drawing, and 2048px resize"
  - "API key sanitization in error messages"
affects: [05-image-prompt-reverse]

# Tech tracking
tech-stack:
  added: []
  patterns: ["DashScope OpenAI-compatible API via bridgeFetch", "API key sanitization via replaceAll in error paths", "Canvas-based image resize with MAX_IMAGE_DIMENSION constant"]

key-files:
  created:
    - code/webapp/src/services/dashscope.ts
    - code/webapp/src/services/__tests__/dashscope.test.ts
  modified: []

key-decisions:
  - "Used replaceAll to sanitize API key from server error messages, mitigating T-05-01"
  - "Mocked globalThis.document for canvas tests instead of adding jsdom dependency"
  - "Always pass width/height to drawImage for consistent canvas rendering"

patterns-established:
  - "DashScope API pattern: bridgeFetch with 60s timeout, Bearer auth, OpenAI-compatible request body"
  - "Image extraction pattern: data URL shortcut, canvas fallback with resize, cross-origin error handling"

requirements-completed: [D-04, D-05, D-06, D-07, D-09, D-14, D-15]

# Metrics
duration: 9min
completed: 2026-04-15
---

# Phase 5 Plan 01: DashScope Service Layer Summary

**DashScope API client with 4 Chinese prompt templates, image-to-base64 utility with 2048px resize, and security-hardened error handling**

## Performance

- **Duration:** 9 min
- **Started:** 2026-04-15T07:51:36Z
- **Completed:** 2026-04-15T08:00:57Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- DashScope API client using bridgeFetch with 60s timeout and Bearer token authorization
- 4 Chinese prompt templates for image description (detailed, concise, composition analysis, style analysis)
- imageElementToBase64 utility handling data URLs, canvas drawing, and proportional resize for images exceeding 2048px
- API key never appears in error messages (replaceAll sanitization for server-echoed keys)
- 19 unit tests all passing

## Task Commits

Each task was committed atomically (TDD workflow):

1. **Task 1 RED: Failing tests for DashScope service** - `b3a51c8` (test)
2. **Task 1 GREEN: DashScope API service and prompt templates** - `3fdfdd2` (feat)

_Note: TDD task with RED and GREEN commits. No REFACTOR needed -- code was clean after implementation._

## Files Created/Modified
- `code/webapp/src/services/dashscope.ts` - DashScope API client, prompt templates, image-to-base64 utility
- `code/webapp/src/services/__tests__/dashscope.test.ts` - 19 unit tests covering all exports and behaviors

## Decisions Made
- Used `replaceAll(config.apiKey, '***')` to sanitize API keys from server error messages -- the server might echo back the key in error responses
- Mocked `globalThis.document` for canvas tests instead of adding jsdom as a test dependency -- keeps the dependency footprint minimal
- Canvas `drawImage` always called with explicit width/height parameters for consistency across resize and non-resize paths

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Security] API key sanitization in error messages**
- **Found during:** Task 1 (TDD GREEN phase)
- **Issue:** The original plan code passed server error messages directly to thrown errors. The server could echo back the API key in its error message, leaking it to calling code or logs (threat T-05-01).
- **Fix:** Added `rawMessage.replaceAll(config.apiKey, '***')` before throwing, ensuring the key is redacted even if the server includes it.
- **Files modified:** code/webapp/src/services/dashscope.ts
- **Verification:** Test confirms secret key does not appear in error message when server includes it
- **Committed in:** 3fdfdd2 (Task 1 GREEN commit)

**2. [Rule 3 - Blocking] Test environment lacked document global**
- **Found during:** Task 1 (TDD GREEN phase)
- **Issue:** Canvas tests used `vi.spyOn(document, 'createElement')` but `document` is undefined in Node.js test environment. Initial attempt to use `@vitest-environment jsdom` failed because jsdom is not installed.
- **Fix:** Replaced jsdom approach with `globalThis.document` mock stubbing in beforeEach/afterEach, avoiding any new dependencies.
- **Files modified:** code/webapp/src/services/__tests__/dashscope.test.ts
- **Verification:** All 19 tests pass including 5 canvas-based tests
- **Committed in:** 3fdfdd2 (Task 1 GREEN commit)

**3. [Rule 1 - Bug] Test assertion mismatch for drawImage call signature**
- **Found during:** Task 1 (TDD GREEN phase)
- **Issue:** Test expected `drawImage(img, 0, 0)` but implementation calls `drawImage(img, 0, 0, width, height)` always (even when no resize needed). This is intentional -- the canvas is set to width/height, so drawImage must match.
- **Fix:** Updated test assertion to `toHaveBeenCalledWith(img, 0, 0, 100, 200)` matching actual call.
- **Files modified:** code/webapp/src/services/__tests__/dashscope.test.ts
- **Verification:** All 19 tests pass
- **Committed in:** 3fdfdd2 (Task 1 GREEN commit)

---

**Total deviations:** 3 auto-fixed (1 security, 1 blocking, 1 bug)
**Impact on plan:** All auto-fixes necessary for correctness and security. No scope creep.

## Issues Encountered
None beyond the deviations documented above.

## User Setup Required
None - no external service configuration required. API key configuration will be added in a subsequent plan (Settings page integration).

## Next Phase Readiness
- DashScope service layer complete and tested, ready for Plans 02-04 to build upon
- Plan 02 can import `analyzeImage`, `imageElementToBase64`, `PROMPT_TEMPLATES`, and `DASHSCOPE_MODELS` from `services/dashscope.ts`
- Plan 03 (Settings) will need to reference `DASHSCOPE_MODELS` and `DEFAULT_MODEL` for the model selection UI
- No blockers for subsequent plans

## Self-Check: PASSED

- FOUND: code/webapp/src/services/dashscope.ts
- FOUND: code/webapp/src/services/__tests__/dashscope.test.ts
- FOUND: .planning/phases/05-image-prompt-reverse/05-01-SUMMARY.md
- FOUND: b3a51c8 (RED commit)
- FOUND: 3fdfdd2 (GREEN commit)

---
*Phase: 05-image-prompt-reverse*
*Completed: 2026-04-15*
