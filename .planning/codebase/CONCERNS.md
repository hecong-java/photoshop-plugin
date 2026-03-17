# Codebase Concerns

**Analysis Date:** 2026-03-17

## Tech Debt

### Monolithic Component: Draw.tsx
- Issue: Single 3175-line file containing all workflow management, generation logic, and UI rendering
- Files: `code/webapp/src/pages/Draw.tsx`
- Impact: Difficult to test, maintain, and understand; changes risk introducing regressions
- Fix approach: Extract into smaller modules:
  - `useWorkflowManager.ts` - workflow loading/selection logic
  - `useGeneration.ts` - WebSocket/polling generation flow
  - `useInputState.ts` - input values and caching
  - `WorkflowInputRenderer.tsx` - form rendering
  - `OutputViewer.tsx` - output image display

### Duplicate UUID Generation
- Issue: UUID generation implemented twice with identical logic
- Files: `code/webapp/src/services/upload.ts:42`, `code/webapp/src/hooks/usePSBridge.ts:73`
- Impact: Code duplication, potential inconsistency if one is updated
- Fix approach: Create shared `utils/uuid.ts` and import in both locations

### Console Logging in Production
- Issue: Extensive debug logging left throughout codebase (100+ console.log statements)
- Files: `code/webapp/src/pages/Draw.tsx` (lines 327, 368-373, 394-433, etc.)
- Impact: Performance overhead, exposes internal state to browser console
- Fix approach: Implement logging utility with levels, strip debug logs in production build

### Hardcoded Configuration Values
- Issue: Magic numbers and strings scattered throughout code
- Files: `code/webapp/src/pages/Draw.tsx:2125` (2 minute timeout), `code/webapp/src/services/upload.ts:91` (30s timeout)
- Impact: Difficult to tune, inconsistent timeout handling
- Fix approach: Create `constants/timeouts.ts` and `constants/config.ts`

## Known Bugs

### WebSocket Connection Fallback Race Condition
- Symptoms: Generation may start before WebSocket fallback decision is made
- Files: `code/webapp/src/pages/Draw.tsx:2278-2301`
- Trigger: Slow or failing WebSocket connections
- Workaround: Polling mode eventually kicks in after 5s timeout

### Image Preview Memory Leak
- Symptoms: Blob URLs created for image previews may not be cleaned up on rapid workflow switches
- Files: `code/webapp/src/pages/Draw.tsx:912-916`
- Trigger: Quickly switching between workflows with image inputs
- Workaround: Page refresh clears accumulated blob URLs

## Security Considerations

### Origin Validation Scope
- Risk: Single hardcoded origin in allowed list may not cover all deployment scenarios
- Files: `PS-plugin/ningleai/main.js:1-3`
- Current mitigation: Origin whitelist enforced, wildcard not used
- Recommendations:
  - Move allowed origins to configuration file
  - Support environment-based origin configuration

### localStorage Data Exposure
- Risk: Settings and history stored unencrypted in browser localStorage
- Files: `code/webapp/src/stores/historyStore.ts:287-400`, `code/webapp/src/stores/settingsStore.ts`
- Current mitigation: No sensitive data stored (only URLs and preferences)
- Recommendations:
  - Document what data is persisted
  - Consider encrypting ComfyUI URL if deployed in shared environments

### Bridge Message Timeout
- Risk: 30-second timeout may be insufficient for large file operations
- Files: `code/webapp/src/services/upload.ts:88-91`
- Current mitigation: Timeout is configurable per-request
- Recommendations: Add progress callbacks for long-running operations

## Performance Bottlenecks

### Workflow History Matching Algorithm
- Problem: O(n*m) algorithm loads every workflow JSON to match against history params
- Files: `code/webapp/src/pages/Draw.tsx:596-729`
- Cause: Each workflow requires network fetch and full parse
- Improvement path:
  - Cache parsed workflow metadata in memory
  - Pre-compute node type signatures on workflow load
  - Consider server-side matching if ComfyUI supports it

### Blob URL Management
- Problem: Creating and revoking blob URLs for each image preview
- Files: `code/webapp/src/pages/Draw.tsx:2175-2179`
- Cause: Base64 to blob conversion for every uploaded image
- Improvement path:
  - Reuse blob URLs when same image is re-selected
  - Consider using object URLs directly from File objects where possible

### Large File Base64 Encoding
- Problem: Images converted to base64 for bridge transport, doubling memory usage
- Files: `PS-plugin/ningleai/main.js:266-275`, `code/webapp/src/services/upload.ts:343-355`
- Cause: Bridge protocol requires serializable data
- Improvement path:
  - Implement chunked transfer for large files
  - Consider binary message protocol if UXP supports it

## Fragile Areas

### Workflow Input Name Parsing
- Files: `code/webapp/src/pages/Draw.tsx:257-286`, `code/webapp/src/pages/Draw.tsx:387-491`
- Why fragile: Relies on `${inputName}_${nodeId}` naming convention; breaks if format changes
- Safe modification: Ensure any name format changes update all parsing locations
- Test coverage: Limited - parsing logic not fully unit tested

### History to Workflow Matching
- Files: `code/webapp/src/pages/Draw.tsx:731-828`
- Why fragile: Depends on workflow structure remaining compatible with saved history params
- Safe modification: Add version field to history entries, implement migration if structure changes
- Test coverage: E2E tests only

### ComfyUI API Version Compatibility
- Files: `code/webapp/src/services/comfyui.ts`
- Why fragile: No version negotiation; assumes specific API structure
- Safe modification: Add API version detection on connect, fail gracefully on mismatch
- Test coverage: Integration tests with mock server

## Scaling Limits

### History Store
- Current capacity: All ComfyUI history entries loaded into memory
- Limit: Browser memory; observed issues at 500+ entries
- Scaling path:
  - Implement pagination or virtualization
  - Add cleanup for entries older than N days

### Workflow Input Count
- Current capacity: Handles 20-30 inputs comfortably
- Limit: React re-renders become slow with 50+ inputs
- Scaling path:
  - Virtualize input list rendering
  - Debounce input change handlers

### Concurrent Generation Queue
- Current capacity: Single WebSocket connection, single generation at a time
- Limit: Multiple rapid submissions may queue indefinitely
- Scaling path:
  - Add queue management UI
  - Implement cancel functionality

## Dependencies at Risk

### React 19.x
- Risk: Very recent major version, ecosystem compatibility still stabilizing
- Impact: Some libraries may have peer dependency warnings
- Migration plan: Monitor for breaking changes in minor releases

### zustand 5.x
- Risk: Major version with API changes from 4.x
- Impact: Persist middleware API changed
- Migration plan: Current usage is compatible; avoid older tutorials

## Missing Critical Features

### Error Recovery UI
- Problem: No retry button when generation fails
- Blocks: User must manually re-trigger generation

### Workflow Validation
- Problem: No validation of workflow structure before submission
- Blocks: Invalid workflows cause cryptic ComfyUI errors

### Offline Mode
- Problem: No indication when ComfyUI connection is lost
- Blocks: Users confused why generation doesn't start

## Test Coverage Gaps

### Workflow Compilation Logic
- What's not tested: `compileWorkflowToPrompt`, `applyInputValuesToPrompt`, `enforceLatestImageInputs`
- Files: `code/webapp/src/pages/Draw.tsx:1668-2029`
- Risk: Edge cases in prompt building could corrupt generation requests
- Priority: High

### Bridge Communication
- What's not tested: `sendBridgeMessage`, `bridgeFetch` error handling
- Files: `code/webapp/src/services/upload.ts:77-214`
- Risk: Network failures may cause silent hangs
- Priority: Medium

### History State Restoration
- What's not tested: `extractInputValuesFromHistoryParams` edge cases
- Files: `code/webapp/src/pages/Draw.tsx:387-491`
- Risk: Rerun/edit may fail to restore correct values
- Priority: Medium

### PS Export/Import Round-Trip
- What's not tested: Full cycle of PS layer export -> ComfyUI -> PS layer import
- Files: `PS-plugin/ningleai/main.js:115-194`, `code/webapp/src/services/upload.ts:216-287`
- Risk: Image quality or dimension issues in production
- Priority: High

---

*Concerns audit: 2026-03-17*
