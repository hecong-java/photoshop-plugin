---
phase: 05-image-prompt-reverse
verified: 2026-04-15T16:55:00Z
status: human_needed
score: 6/6 must-haves verified
human_verification:
  - test: "Right-click any image in Draw or History page and verify the context menu appears with '反推提示词' item"
    expected: "Context menu appears at cursor position with the menu item visible"
    why_human: "Requires running app and browser interaction to verify DOM event handling, overlay positioning, and visual rendering"
  - test: "Complete the full flow: right-click image -> confirm preview -> select template -> wait for analysis -> view result"
    expected: "Modal progresses through all 4 steps, shows loading spinner, then displays AI-generated Chinese text"
    why_human: "End-to-end flow requires live DashScope API call with valid key, browser environment, and visual confirmation of modal transitions"
  - test: "Click '复制到剪贴板' button in result modal and paste into a text editor"
    expected: "The analysis result text is pasted from clipboard"
    why_human: "Clipboard API behavior differs across browsers and UXP environments; requires manual paste verification"
  - test: "Click '填入提示词' button on Draw page and verify the first text input is populated"
    expected: "The CLIPTextEncode prompt textarea shows the analysis result text"
    why_human: "Requires running app with a workflow loaded, verification of DOM state update"
  - test: "Navigate away from Settings page and back, verify DashScope API key and model are retained"
    expected: "API key and model selection persist across page navigation"
    why_human: "Requires running app to verify localStorage persistence and Zustand rehydration"
  - test: "Verify visual appearance of the multi-step modal matches UI-SPEC design (dark theme, spacing, typography)"
    expected: "Modal background #0b1220, 14px border-radius, consistent with design contract"
    why_human: "Visual design verification requires visual inspection in running app"
---

# Phase 5: Image Prompt Reverse Engineering Verification Report

**Phase Goal:** Image Prompt Reverse Engineering -- right-click any image to generate a natural language description using DashScope VL models
**Verified:** 2026-04-15T16:55:00Z
**Status:** human_needed
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| #   | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| 1   | DashScope API client formats requests correctly with base64 image and text prompt | VERIFIED | dashscope.ts L124-157: bridgeFetch to DASHSCOPE_BASE_URL with POST, Authorization Bearer header, JSON body with model + messages array containing text + image_url content types, 60000ms timeout |
| 2   | Prompt templates produce Chinese natural language descriptions, not tag lists | VERIFIED | dashscope.ts L35-64: 4 templates (detailed, concise, composition, style) all have Chinese systemPrompt text directing natural language output, explicitly stating "不要使用标签或列表格式" |
| 3   | DashScope API calls work in both UXP and browser environments without CORS issues | VERIFIED | dashscope.ts L4: imports bridgeFetch from upload.ts which handles UXP/browser adaptation; PromptReverseFlow.tsx L44 calls analyzeImage which uses bridgeFetch |
| 4   | API key is never included in error messages or console logs | VERIFIED | dashscope.ts L167: `rawMessage.replaceAll(config.apiKey, '***')` sanitizes key from server error messages; no console.log in dashscope.ts; 19 tests pass including specific test for key sanitization |
| 5   | User can enter and save a DashScope API key in the Settings page | VERIFIED | Settings.tsx L167-173: type="password" input bound to dashScope.apiKey via setDashScopeApiKey; settingsStore.ts L77-78: setDashScopeApiKey action updates persisted state |
| 6   | User can select a DashScope model (Qwen VL Max, Qwen VL Plus, Qwen3 VL Plus) | VERIFIED | Settings.tsx L178-186: select element with DASHSCOPE_MODELS.map producing 3 options; bound to dashScope.model via setDashScopeModel |
| 7   | API key and model selection persist across page navigation (Zustand persist) | VERIFIED | settingsStore.ts L89: `dashScope: state.dashScope` in partialize; 7 store tests pass including persistence test |
| 8   | Settings page shows configured/unconfigured status badge for DashScope | VERIFIED | Settings.tsx L160-162: connection-status span with 'connected'/'disconnected' class based on dashScope.apiKey truthiness, showing '已配置'/'未配置' |
| 9   | Right-clicking an image with data-prompt-reverse shows context menu with '反推提示词' item | VERIFIED | PromptReverseProvider.tsx L18: closest('img[data-prompt-reverse]') selector; ContextMenu.tsx L61: "反推提示词" button text |
| 10  | Context menu appears at cursor position, clamped to viewport | VERIFIED | ContextMenu.tsx L25-29: getBoundingClientRect + Math.min clamping with 8px margin; ContextMenu.tsx L55: inline style left/top positioning |
| 11  | Context menu dismisses on click outside, Escape key, scroll, or item click | VERIFIED | ContextMenu.tsx L47: overlay onClick=onDismiss; L35-36: Escape keydown listener; PromptReverseProvider.tsx L29-31: scroll and resize dismiss listeners |
| 12  | PromptReverseStore manages the flow state machine: closed -> preview -> template -> loading -> result | VERIFIED | promptReverseStore.ts L5: FlowStep type with 5 states; L38-49: startFlow sets preview; L52-53: selectTemplate sets template; L56: setLoading; L60: setResult sets result; 10 tests pass |
| 13  | Image element is extracted and converted to base64 when context menu item is clicked | VERIFIED | PromptReverseProvider.tsx L50: `imageElementToBase64(imgElement)` called in handleMenuAction; result passed to startFlow |
| 14  | Multi-step modal guides user: preview -> template selection -> loading -> result | VERIFIED | PromptReverseFlow.tsx L88-195: conditional rendering per step (preview L106-118, template L121-151, loading L154-164, result L167-195) |
| 15  | User can select from 4 prompt templates (detailed, concise, composition, style) | VERIFIED | PromptReverseFlow.tsx L128-139: PROMPT_TEMPLATES.map renders 4 template cards in grid with select highlighting |
| 16  | Result modal shows analysis text with Copy and Fill buttons | VERIFIED | PromptReverseFlow.tsx L180: result text div; L184: '填入提示词' button (when isDrawPage); L187: '复制到剪贴板' button |
| 17  | Copy button copies result text to clipboard | VERIFIED | PromptReverseFlow.tsx L62: navigator.clipboard.writeText(result); L66-71: document.execCommand fallback |
| 18  | Fill button inserts result text into Draw page prompt input | VERIFIED | Draw.tsx L1867-1873: handleFillPrompt finds first text input via sortedWorkflowInputs and calls handleInputChange; Draw.tsx L3487: `<PromptReverseFlow onFillPrompt={handleFillPrompt} />` |
| 19  | All images across Draw and History pages have data-prompt-reverse attribute | VERIFIED | Draw.tsx: 4 data-prompt-reverse (L3127, L3234, L3254, L3295); HistoryItem.tsx: 3 data-prompt-reverse (L81, L98, L147) |
| 20  | PromptReverseProvider wraps Routes in App.tsx for global coverage | VERIFIED | App.tsx L38-45: PromptReverseProvider wrapping all Routes inside main.content |

**Score:** 20/20 truths verified (automated checks pass; 6 require human visual/runtime confirmation)

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `code/webapp/src/services/dashscope.ts` | DashScope API client and prompt template definitions | VERIFIED | 176 lines; exports analyzeImage, imageElementToBase64, PROMPT_TEMPLATES (4), DASHSCOPE_MODELS (3), DEFAULT_MODEL, DASHSCOPE_BASE_URL, MAX_IMAGE_DIMENSION, DashScopeConfig, PromptTemplate |
| `code/webapp/src/services/__tests__/dashscope.test.ts` | Unit tests for DashScope service | VERIFIED | 19 tests all passing; covers templates, models, analyzeImage request/response, error handling, key sanitization, image extraction |
| `code/webapp/src/stores/settingsStore.ts` | Extended with dashScope state and setters | VERIFIED | DashScopeSettings interface, dashScope state, setDashScopeApiKey/setDashScopeModel actions, partialize entry |
| `code/webapp/src/pages/Settings.tsx` | DashScope config card in settings grid | VERIFIED | dashscope-config card with password input, model select, status badge |
| `code/webapp/src/pages/Settings.css` | DashScope config card styles | VERIFIED | .dashscope-config styles at L168 and L174 |
| `code/webapp/src/stores/__tests__/settingsStore.test.ts` | Tests for DashScope settings state | VERIFIED | 7 tests all passing |
| `code/webapp/src/stores/promptReverseStore.ts` | Flow state machine store | VERIFIED | 84 lines; usePromptReverseStore, FlowStep type, full state machine with abort handling |
| `code/webapp/src/stores/__tests__/promptReverseStore.test.ts` | Tests for prompt reverse store | VERIFIED | 10 tests all passing |
| `code/webapp/src/components/promptReverse/ContextMenu.tsx` | Right-click context menu overlay | VERIFIED | 66 lines; viewport clamped positioning, Escape dismiss, "反推提示词" button |
| `code/webapp/src/components/promptReverse/ContextMenu.css` | Context menu styling | VERIFIED | 35 lines; z-index 1500, dark theme, hover effects |
| `code/webapp/src/components/promptReverse/PromptReverseProvider.tsx` | Global right-click event listener provider | VERIFIED | 77 lines; contextmenu listener on img[data-prompt-reverse], image extraction, scroll/resize dismiss |
| `code/webapp/src/components/promptReverse/PromptReverseFlow.tsx` | Multi-step modal component | VERIFIED | 199 lines; 4 step views, template grid, analyzeImage call, copy/fill handlers |
| `code/webapp/src/components/promptReverse/PromptReverseFlow.css` | Modal styles | VERIFIED | 237 lines; follows UI-SPEC design contract |
| `code/webapp/src/App.tsx` | PromptReverseProvider wrapping Routes | VERIFIED | L6: import, L38-45: wrapping all Routes |
| `code/webapp/src/pages/Draw.tsx` | data-prompt-reverse + handleFillPrompt + PromptReverseFlow | VERIFIED | 4 data-prompt-reverse attributes, handleFillPrompt at L1867, PromptReverseFlow with onFillPrompt at L3487 |
| `code/webapp/src/components/history/HistoryItem.tsx` | data-prompt-reverse on history images | VERIFIED | 3 data-prompt-reverse attributes (L81, L98, L147) |
| `code/webapp/src/pages/History.tsx` | PromptReverseFlow rendered | VERIFIED | L9: import, L189: `<PromptReverseFlow />` |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| dashscope.ts | upload.ts | import bridgeFetch | WIRED | L4: `import { bridgeFetch } from './upload'`; L130: `bridgeFetch(DASHSCOPE_BASE_URL, ...)` |
| PromptReverseProvider.tsx | promptReverseStore.ts | usePromptReverseStore | WIRED | L3: import, L14: `usePromptReverseStore((state) => state.startFlow)` |
| PromptReverseProvider.tsx | dashscope.ts | imageElementToBase64 | WIRED | L4: import, L50: `await imageElementToBase64(imgElement)` |
| PromptReverseFlow.tsx | promptReverseStore.ts | reads step, result, error; calls actions | WIRED | L2: import; L10-22: reads step/imagePreviewUrl/imageBase64/selectedTemplate/result/error, calls selectTemplate/setLoading/setResult/setError/reset/setAbortController/getActiveTemplate |
| PromptReverseFlow.tsx | dashscope.ts | analyzeImage for API call | WIRED | L4: import, L44: `await analyzeImage({ apiKey, model }, imageBase64, template.systemPrompt)` |
| PromptReverseFlow.tsx | settingsStore.ts | useSettingsStore dashScope state | WIRED | L3: import, L23: `useSettingsStore((s) => s.dashScope)` |
| Settings.tsx | settingsStore.ts | useSettingsStore dashScope state | WIRED | L12-14: dashScope/setDashScopeApiKey/setDashScopeModel from useSettingsStore |
| Settings.tsx | dashscope.ts | DASHSCOPE_MODELS for select options | WIRED | L4: import, L185: `DASHSCOPE_MODELS.map((m) => ...)` |
| Draw.tsx | PromptReverseFlow.tsx | onFillPrompt callback | WIRED | L13: import, L1867: handleFillPrompt definition, L3487: `<PromptReverseFlow onFillPrompt={handleFillPrompt} />` |
| History.tsx | PromptReverseFlow.tsx | renders PromptReverseFlow | WIRED | L9: import, L189: `<PromptReverseFlow />` |
| App.tsx | PromptReverseProvider.tsx | wraps Routes | WIRED | L6: import, L38: `<PromptReverseProvider>` wrapping all Routes |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| PromptReverseFlow.tsx | result (from store) | analyzeImage via dashScope API | Yes -- real DashScope API response | FLOWING |
| PromptReverseFlow.tsx | dashScope (from settingsStore) | localStorage via Zustand persist | Yes -- user-entered API key + model | FLOWING |
| PromptReverseFlow.tsx | imageBase64 (from store) | imageElementToBase64 from right-clicked image | Yes -- real canvas/DOM extraction | FLOWING |
| Draw.tsx | handleFillPrompt -> handleInputChange | result text from PromptReverseFlow | Yes -- passes text to sortedWorkflowInputs first text input | FLOWING |
| ContextMenu.tsx | menuPosition (x, y) | e.clientX/e.clientY from MouseEvent | Yes -- real cursor coordinates | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| DashScope service tests all pass | `cd code/webapp && npx vitest run src/services/__tests__/dashscope.test.ts` | 19/19 passed | PASS |
| Settings store tests all pass | `cd code/webapp && npx vitest run src/stores/__tests__/settingsStore.test.ts` | 7/7 passed | PASS |
| Prompt reverse store tests all pass | `cd code/webapp && npx vitest run src/stores/__tests__/promptReverseStore.test.ts` | 10/10 passed | PASS |
| TypeScript compilation clean | `cd code/webapp && npx tsc --noEmit` | Exit 0, no errors | PASS |
| No dangerouslySetInnerHTML in prompt reverse components | grep check | 0 matches | PASS |
| No console.log in dashscope service | grep check | 0 matches | PASS |
| No TODO/FIXME/PLACEHOLDER in new code | grep check | 0 matches | PASS |

### Requirements Coverage

| Requirement | Description | Source Plan | Status | Evidence |
| ----------- | ----------- | ---------- | ------ | -------- |
| D-01 | Right-click menu triggers "反推提示词" on images | Plan 03 | SATISFIED | PromptReverseProvider.tsx L18 targets img[data-prompt-reverse]; ContextMenu.tsx L61 shows "反推提示词" |
| D-02 | Step-by-step guided flow: preview -> template -> API -> result | Plan 03, 04 | SATISFIED | promptReverseStore.ts state machine; PromptReverseFlow.tsx 4 step views |
| D-03 | Right-click menu covers all pages (Draw input/output, History) | Plan 04 | SATISFIED | Draw.tsx: 4 data-prompt-reverse; HistoryItem.tsx: 3 data-prompt-reverse; App.tsx: PromptReverseProvider wraps all Routes |
| D-04 | Uses third-party API, not ComfyUI workflow | Plan 01 | SATISFIED | dashscope.ts calls DashScope API via bridgeFetch, completely independent of ComfyUI |
| D-05 | Uses Alibaba Cloud DashScope Qwen VL model | Plan 01 | SATISFIED | DASHSCOPE_BASE_URL = dashscope.aliyuncs.com; DASHSCOPE_MODELS with qwen-vl-max/plus/qwen3-vl-plus |
| D-06 | Result style is natural language description (not tag list) | Plan 01 | SATISFIED | All 4 systemPrompts direct natural language output; detailed template explicitly says "不要使用标签或列表格式" |
| D-07 | Default output is Chinese prompts | Plan 01 | SATISFIED | All systemPrompts contain "请用中文" directives |
| D-08 | Result shown in modal/popup with text and action buttons | Plan 04 | SATISFIED | PromptReverseFlow.tsx result step with prompt-reverse-result-text, copy button, fill button, retry, close |
| D-09 | Result format is natural language (not comma-separated tags) | Plan 01 | SATISFIED | System prompts explicitly direct natural language output format |
| D-10 | Two reuse buttons: copy to clipboard and fill into prompt input | Plan 04 | SATISFIED | PromptReverseFlow.tsx L187: copy button; L184: fill button (on Draw page); L62: clipboard.writeText; L77-81: onFillPrompt handler |
| D-11 | Directly uses right-clicked image as input, no extra selection | Plan 03 | SATISFIED | PromptReverseProvider.tsx L50: imageElementToBase64 on targetImageRef.current from right-click |
| D-12 | Image sent as Base64 to API | Plan 01 | SATISFIED | dashscope.ts L148: `data:${mimeType};base64,${imageBase64}` in image_url content |
| D-13 | API Key managed in Settings page with new "提示词反推" config area | Plan 02 | SATISFIED | Settings.tsx L157: dashscope-config card with API key input and model selector |
| D-14 | Network requests adapt: UXP via Bridge proxy, browser direct (bridgeFetch) | Plan 01 | SATISFIED | dashscope.ts imports bridgeFetch from upload.ts which handles UXP/browser adaptation |
| D-15 | Multiple preset prompt templates (detailed, concise, composition, style) | Plan 01, 04 | SATISFIED | PROMPT_TEMPLATES with 4 entries; PromptReverseFlow.tsx template grid with selectable cards |

All 15 requirements (D-01 through D-15) are accounted for and have implementation evidence.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| Draw.tsx | 1873 | handleFillPrompt useCallback missing handleInputChange in deps array | Info | handleInputChange uses callback-form setter so stale closure won't cause incorrect behavior; but ESLint exhaustive-deps would flag it |

No blocker or warning anti-patterns found. All code is substantive, wired, and free of TODOs, placeholders, stubs, or security leaks.

### Human Verification Required

### 1. Right-click Context Menu Interaction

**Test:** Right-click any image in Draw or History page and verify the context menu appears with '反推提示词' item
**Expected:** Context menu appears at cursor position with the menu item visible and clickable
**Why human:** Requires running app and browser interaction to verify DOM event handling, overlay positioning, and visual rendering

### 2. Full End-to-End Flow

**Test:** Complete the full flow: right-click image -> confirm preview -> select template -> wait for analysis -> view result
**Expected:** Modal progresses through all 4 steps, shows loading spinner during API call, then displays AI-generated Chinese text
**Why human:** End-to-end flow requires live DashScope API call with valid key, browser environment, and visual confirmation of modal transitions

### 3. Copy to Clipboard

**Test:** Click '复制到剪贴板' button in result modal and paste into a text editor
**Expected:** The analysis result text is successfully pasted from clipboard
**Why human:** Clipboard API behavior differs across browsers and UXP environments; requires manual paste verification

### 4. Fill Into Prompt

**Test:** Click '填入提示词' button on Draw page and verify the first text input is populated
**Expected:** The CLIPTextEncode prompt textarea shows the analysis result text
**Why human:** Requires running app with a workflow loaded and verification of DOM state update

### 5. Settings Persistence

**Test:** Enter API key in Settings, navigate to Draw and back to Settings
**Expected:** API key and model selection are retained across page navigation
**Why human:** Requires running app to verify localStorage persistence and Zustand rehydration

### 6. Visual Design Compliance

**Test:** Verify visual appearance of the multi-step modal matches UI-SPEC design (dark theme, spacing, typography)
**Expected:** Modal background #0b1220, 14px border-radius, consistent typography, 2x2 template grid
**Why human:** Visual design verification requires visual inspection in running app

### Gaps Summary

No code gaps found. All 17 artifacts exist, are substantive (no stubs), are properly wired, and have real data flowing through them. All 36 unit tests pass. TypeScript compilation is clean. No security anti-patterns detected (no dangerouslySetInnerHTML, no API key leakage in console.log or error messages).

The implementation is complete from a code perspective. Six human verification items are needed to confirm runtime behavior in the actual browser/UXP environment.

---

_Verified: 2026-04-15T16:55:00Z_
_Verifier: Claude (gsd-verifier)_
