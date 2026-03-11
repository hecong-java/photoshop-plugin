# Codebase Concerns

**Analysis Date:** 2026-03-11

## Tech Debt

**Draw.tsx Component Size:**
- Issue: Single file contains 2736 lines, mixing UI, state management, WebSocket handling, workflow parsing, and business logic
- Files: `D:/projects/photoshop-plugin/code/webapp/src/pages/Draw.tsx`
- Impact: Difficult to maintain, test, and understand; high cognitive load; changes risky
- Fix approach: Extract into smaller modules - workflow parsing utilities, WebSocket management hook, input rendering components, generation state management

**Duplicate Bridge Communication Logic:**
- Issue: Bridge message handling duplicated between `upload.ts` and `usePSBridge.ts` with separate pending request maps and listeners
- Files: `D:/projects/photoshop-plugin/code/webapp/src/services/upload.ts`, `D:/projects/photoshop-plugin/code/webapp/src/hooks/usePSBridge.ts`
- Impact: Risk of inconsistent behavior, duplicate event listeners, maintenance burden
- Fix approach: Consolidate into single bridge service module; export unified API

**Hardcoded Allowed Origins:**
- Issue: `ALLOWED_ORIGINS` in main.js contains hardcoded development URL
- Files: `D:/projects/photoshop-plugin/PS-plugin/ningleai/main.js` (line 1-3)
- Impact: Security risk in production; requires code changes for different environments
- Fix approach: Configure via manifest or environment-specific configuration

**Type Safety Gaps with `any`:**
- Issue: Multiple uses of `any` type in critical data handling (WebSocket messages, workflow nodes, images)
- Files: `D:/projects/photoshop-plugin/code/webapp/src/pages/Draw.tsx` (lines 1383, 1389, 1396, 1403, 1601, 1608, 1618, 1634, 1659, 2024, 2084)
- Impact: Runtime errors possible; IDE support weakened; refactoring riskier
- Fix approach: Define proper TypeScript interfaces for ComfyUI workflow JSON schema, WebSocket messages, and image output structures

## Known Bugs

**Silent Error Handling:**
- Symptoms: Multiple empty catch blocks silently swallow errors without logging or user notification
- Files: `D:/projects/photoshop-plugin/code/webapp/src/stores/historyStore.ts` (lines 264, 345), `D:/projects/photoshop-plugin/code/webapp/src/services/comfyui.ts` (line 659), `D:/projects/photoshop-plugin/code/webapp/src/pages/Draw.tsx` (lines 609, 617, 2027)
- Trigger: JSON parsing failures, localStorage operations, WebSocket message parsing
- Workaround: None visible to user

**History Action State Race Condition:**
- Symptoms: `hasHandledHistoryAction` ref used to prevent duplicate execution but may not handle navigation correctly
- Files: `D:/projects/photoshop-plugin/code/webapp/src/pages/Draw.tsx` (line 233)
- Trigger: Rapid navigation between history and draw pages with rerun/edit actions
- Workaround: None

## Security Considerations

**Origin Validation:**
- Risk: Hardcoded development origin in production code could allow unauthorized message sources if not updated
- Files: `D:/projects/photoshop-plugin/PS-plugin/ningleai/main.js` (lines 1-3, 826-831)
- Current mitigation: Origin check exists but uses hardcoded list
- Recommendations: Move allowed origins to configuration; use manifest permissions; validate message structure before processing

**LocalStorage Data Exposure:**
- Risk: Settings including ComfyUI base URL stored in localStorage via zustand persist
- Files: `D:/projects/photoshop-plugin/code/webapp/src/stores/settingsStore.ts` (lines 39-74)
- Current mitigation: None - standard browser storage
- Recommendations: Consider if URLs contain sensitive tokens; document storage behavior for users

**File System Permissions:**
- Risk: Plugin requests `fullAccess` to local filesystem
- Files: `D:/projects/photoshop-plugin/PS-plugin/ningleai/manifest.json` (line 109)
- Current mitigation: User must install plugin explicitly
- Recommendations: Review if full access is necessary; scope to specific directories if possible

## Performance Bottlenecks

**Workflow List Processing:**
- Problem: Each workflow selection triggers multiple fetch operations and JSON parsing of potentially large workflow files
- Files: `D:/projects/photoshop-plugin/code/webapp/src/pages/Draw.tsx` (findBestMatchingWorkflow, compileWorkflowToPrompt functions)
- Cause: No caching of parsed workflow structures; re-parsing on every interaction
- Improvement path: Implement workflow parsing cache; memoize compiled prompts; lazy load workflow details

**History Image URL Generation:**
- Problem: `getViewUrl` called repeatedly for same images without memoization
- Files: `D:/projects/photoshop-plugin/code/webapp/src/stores/historyStore.ts` (extractHistoryImage function, lines 77-157)
- Cause: Fresh URL generation on every history fetch
- Improvement path: Cache generated URLs keyed by filename/subfolder/type combination

**WebSocket Reconnection:**
- Problem: WebSocket created fresh for each generation; no connection pooling or reuse
- Files: `D:/projects/photoshop-plugin/code/webapp/src/pages/Draw.tsx` (lines 230, 286-291)
- Cause: WebSocket closed in finally block after each generation
- Improvement path: Maintain persistent WebSocket connection with reconnect logic

## Fragile Areas

**ComfyUI API Version Compatibility:**
- Files: `D:/projects/photoshop-plugin/code/webapp/src/services/comfyui.ts`, `D:/projects/photoshop-plugin/PS-plugin/ningleai/main.js`
- Why fragile: Relies on specific ComfyUI API endpoints and response formats that may change
- Safe modification: Add version detection; implement adapter pattern for API changes
- Test coverage: Only basic probe endpoint test exists (`comfyui.test.ts`)

**Workflow JSON Schema Assumptions:**
- Files: `D:/projects/photoshop-plugin/code/webapp/src/pages/Draw.tsx` (compileWorkflowToPrompt, extractWorkflowInputs)
- Why fragile: Assumes specific node structure, widget ordering, and input naming conventions
- Safe modification: Add schema validation; handle missing/extra fields gracefully
- Test coverage: No unit tests for workflow parsing logic

**UXP Bridge Transport:**
- Files: `D:/projects/photoshop-plugin/code/webapp/src/services/upload.ts`, `D:/projects/photoshop-plugin/PS-plugin/ningleai/main.js`
- Why fragile: Depends on UXP-specific APIs and message passing behavior
- Safe modification: Add comprehensive error handling; timeout management; connection state tracking
- Test coverage: No automated tests for bridge communication

## Scaling Limits

**LocalStorage Capacity:**
- Current capacity: ~5-10MB depending on browser
- Limit: History items with large output records may exceed quota
- Scaling path: Implement data rotation; offload to IndexedDB; compress stored data

**Concurrent Generations:**
- Current capacity: Single generation at a time (isGenerating flag)
- Limit: Cannot queue or parallelize multiple workflow executions
- Scaling path: Implement generation queue with status tracking

**Workflow File Size:**
- Current capacity: Entire workflow JSON loaded into memory
- Limit: Very large workflows with many nodes may cause UI lag
- Scaling path: Implement lazy loading; virtual scrolling for workflow picker

## Dependencies at Risk

**fflate (zip library):**
- Risk: Used for ZIP download functionality but has breaking changes between versions
- Impact: Download as ZIP feature would fail
- Migration plan: Pin version; test thoroughly before upgrades; have fallback to individual downloads

**React 19.x:**
- Risk: Using latest React version which may have ecosystem compatibility issues
- Impact: Third-party component libraries may not be compatible
- Migration plan: Test all dependencies; maintain lockfile; review changelogs before React updates

## Missing Critical Features

**Error Boundary:**
- Problem: No React error boundary to catch and display component errors gracefully
- Blocks: User sees blank screen instead of helpful error message on component crash

**Offline Mode:**
- Problem: No handling for network disconnection during generation
- Blocks: Users cannot work offline; no indication when ComfyUI is unreachable

**Generation Cancellation:**
- Problem: No way to cancel in-progress generation
- Blocks: Users must wait for completion or refresh page

## Test Coverage Gaps

**Workflow Parsing Logic:**
- What's not tested: compileWorkflowToPrompt, extractWorkflowInputs, sanitizePromptGraph functions
- Files: `D:/projects/photoshop-plugin/code/webapp/src/pages/Draw.tsx`
- Risk: Changes to workflow format may break silently
- Priority: High - core functionality with no automated tests

**Bridge Communication:**
- What's not tested: sendBridgeMessage, bridgeFetch, all main.js handlers
- Files: `D:/projects/photoshop-plugin/code/webapp/src/services/upload.ts`, `D:/projects/photoshop-plugin/PS-plugin/ningleai/main.js`
- Risk: Communication failures go undetected until manual testing
- Priority: High - critical for Photoshop integration

**History State Management:**
- What's not tested: addLocalDownload, removeLocalDownload, deleteItem, clearAll operations
- Files: `D:/projects/photoshop-plugin/code/webapp/src/stores/historyStore.ts`
- Risk: Data corruption or loss may occur without detection
- Priority: Medium - user data operations

**E2E Tests:**
- What's not tested: Complete generation workflow, Photoshop integration, settings persistence
- Files: `D:/projects/photoshop-plugin/code/webapp/e2e/navigation.spec.ts` (only basic navigation)
- Risk: Integration issues not caught before release
- Priority: Medium - only 3 basic navigation tests exist

**Component Tests:**
- What's not tested: Draw, Settings, History pages; all custom components
- Files: No component test files found
- Risk: UI regressions not caught
- Priority: Medium - testing-library dependencies present but unused

---

*Concerns audit: 2026-03-11*
