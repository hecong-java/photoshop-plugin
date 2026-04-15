# Phase 5: Image Prompt Reverse Engineering - Research

**Researched:** 2026-04-15
**Domain:** DashScope VL API integration, right-click context menu, modal UI
**Confidence:** HIGH

## Summary

Phase 5 adds image-to-prompt reverse engineering via Alibaba Cloud DashScope's Qwen VL (Vision-Language) models. Users right-click any image across the app (Draw page inputs, generated outputs, History page), walk through a guided flow (preview -> template selection -> API call), and receive a natural language Chinese prompt description in a modal. The result can be copied to clipboard or filled directly into the current prompt input on the Draw page.

The DashScope API exposes an OpenAI-compatible endpoint that accepts base64-encoded images and returns text completions. The existing `bridgeFetch` pattern in `upload.ts` already provides UXP/browser-adaptive HTTP proxying with custom headers, making DashScope API calls straightforward -- no new npm dependencies are required. Settings for the API key follow the established Zustand + persist pattern in `settingsStore.ts`.

**Primary recommendation:** Reuse `bridgeFetch` for DashScope API calls (it already proxies arbitrary HTTP requests through the UXP Bridge). Create a dedicated `services/dashscope.ts` service, a `stores/promptReverseStore.ts` for UI state, and a global `components/promptReverse/` directory for the context menu, guided flow, and result modal components.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Right-click context menu triggers "Reverse Prompt" on all images
- **D-02:** Guided flow: right-click -> preview confirm -> template select -> API call -> show result
- **D-03:** Right-click menu covers all page images: Draw input images, generated output images, History images; use a global unified context menu component
- **D-04:** Use third-party API (not ComfyUI workflow) for reverse prompting
- **D-05:** API service: Alibaba Cloud Bailian Qwen VL model (DashScope API)
- **D-06:** Output style: CLIP Interrogator-style natural language description (not tag list)
- **D-07:** Default output: Chinese prompts
- **D-08:** Result displayed in modal/popup with text area and action buttons
- **D-09:** Result format: natural language description (not comma-separated tags)
- **D-10:** Two reuse buttons: "Copy to clipboard" and "Fill into current prompt input"
- **D-11:** Use right-clicked image directly as input, no extra selection or upload
- **D-12:** Image sent as Base64 encoding directly to API
- **D-13:** API Key managed in existing Settings page, new "Prompt Reverse" config section
- **D-14:** Network requests adaptive: UXP via Bridge proxy, browser direct (reuse bridgeFetch)
- **D-15:** Multiple preset Prompt templates (detailed description, concise description, composition analysis, style analysis); user selects in guided flow

### Claude's Discretion
- Specific Prompt template content design
- DashScope API request/response format details
- Modal specific UI layout and style
- Right-click menu component implementation approach
- Base64 image size limits and compression strategy
- API call timeout handling and retry strategy
- Error state user prompt copy

### Deferred Ideas (OUT OF SCOPE)
None -- discussion stayed within phase scope
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| D-01 | Right-click trigger on images | Global context menu component (Section: Architecture Patterns) |
| D-02 | Guided multi-step flow | Step-based modal state machine (Section: Architecture Patterns) |
| D-03 | Cross-page image coverage | Image data extraction utility (Section: Code Examples) |
| D-04/05 | DashScope Qwen VL API | API integration details (Section: Standard Stack, Code Examples) |
| D-06/07/09 | Chinese natural language output | Prompt template design (Section: Code Examples) |
| D-08 | Result modal | Modal component pattern (Section: Architecture Patterns) |
| D-10 | Copy + Fill buttons | Clipboard API + Draw store integration (Section: Architecture Patterns) |
| D-11/12 | Base64 image input | Image-to-base64 pipeline (Section: Code Examples) |
| D-13 | Settings page API key | Zustand store extension (Section: Code Examples) |
| D-14 | Bridge/direct adaptive network | bridgeFetch reuse (Section: Don't Hand-Roll) |
| D-15 | Multiple prompt templates | Template definitions (Section: Code Examples) |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zustand | 5.0.12 | State management | Already used in project for all stores |
| react | 19.2.5 | UI framework | Project standard |

### Supporting (No New Dependencies)
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| bridgeFetch (upload.ts) | existing | DashScope HTTP calls | All API calls -- already handles UXP/browser split |
| sendBridgeMessage (upload.ts) | existing | UXP Bridge communication | Only if dedicated Bridge handler is needed |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Raw HTTP via bridgeFetch | OpenAI JS SDK | SDK adds ~200KB dependency for a single endpoint; raw HTTP is 0 cost |
| comfyui.fetch Bridge handler | Dedicated dashscope.fetch handler | Generic handler works; dedicated handler adds clarity but more code in main.js |

**Installation:**
```bash
# No new npm packages required
```

**Version verification:** All versions confirmed from `package.json` and `npm view` on 2026-04-15.

## Architecture Patterns

### Recommended Project Structure
```
code/webapp/src/
├── services/
│   └── dashscope.ts           # DashScope API client (new)
├── stores/
│   ├── promptReverseStore.ts  # Prompt reverse UI state (new)
│   └── settingsStore.ts       # Extended with dashScope section
├── components/
│   └── promptReverse/         # New directory
│       ├── ContextMenu.tsx     # Global right-click menu overlay
│       ├── PromptReverseFlow.tsx  # Multi-step guided flow modal
│       ├── PromptReverseResult.tsx # Result display modal
│       └── PromptReverse.css   # Styles for all above
├── pages/
│   ├── Draw.tsx               # Modified: attach context menu, receive fill
│   ├── History.tsx             # Modified: attach context menu to images
│   └── Settings.tsx            # Modified: add DashScope config section
```

### Pattern 1: DashScope API Service
**What:** Encapsulates DashScope OpenAI-compatible API calls with bridgeFetch for UXP/browser adaptivity.
**When to use:** All VL model API calls for prompt reverse.
**Example:**
```typescript
// Source: https://help.aliyun.com/zh/model-studio/qwen-vl-compatible-with-openai
// services/dashscope.ts

const DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';

export interface DashScopeConfig {
  apiKey: string;
  model: string; // e.g. 'qwen-vl-max'
}

export async function analyzeImage(
  config: DashScopeConfig,
  imageBase64: string,
  prompt: string,
  mimeType: string = 'image/png'
): Promise<string> {
  const response = await bridgeFetch(DASHSCOPE_BASE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: { url: `data:${mimeType};base64,${imageBase64}` },
            },
          ],
        },
      ],
    }),
  }, 60000); // 60s timeout for VL model inference

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error?.message || `DashScope API error: ${response.status}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}
```
[VERIFIED: help.aliyun.com/zh/model-studio/qwen-vl-compatible-with-openai -- official Alibaba Cloud docs confirming endpoint, auth, request/response format]

### Pattern 2: Image-to-Base64 Extraction
**What:** Extracts base64 data from various image sources (img elements with src URLs, blob URLs, data URLs).
**When to use:** When user right-clicks an image and we need to send it to the API.
**Example:**
```typescript
// Extract base64 from an <img> element regardless of its src type
export async function imageElementToBase64(imgElement: HTMLImageElement): Promise<string> {
  // If already a data URL, extract the base64 part
  if (imgElement.src.startsWith('data:')) {
    return imgElement.src.split(',')[1];
  }

  // For blob: or http: URLs, draw to canvas and export
  const canvas = document.createElement('canvas');
  canvas.width = imgElement.naturalWidth;
  canvas.height = imgElement.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(imgElement, 0, 0);
  const dataUrl = canvas.toDataURL('image/png');
  return dataUrl.split(',')[1];
}
```
[ASSUMED] -- canvas approach is standard; cross-origin images may need CORS handling. For ComfyUI images served locally, CORS should be fine. For blob URLs, no CORS issue.

### Pattern 3: Global Right-Click Context Menu
**What:** A single context menu component mounted at app root level, activated by right-click on any image element that has a data attribute.
**When to use:** All pages where images should support "Reverse Prompt".
**Example:**
```tsx
// Attach to images via a custom hook or wrapper
// In app root (e.g., App.tsx or a layout component):
<PromptReverseProvider>
  <Router>...</Router>
</PromptReverseProvider>

// The provider renders the context menu overlay and listens for
// contextmenu events on elements with [data-prompt-reverse] attribute

// On image elements:
<img
  src={imageUrl}
  data-prompt-reverse
  data-image-source="output"  // or "input", "history"
/>
```
[ASSUMED] -- pattern based on standard React context menu implementations.

### Pattern 4: Zustand Store Extension for DashScope Settings
**What:** Extend settingsStore.ts with a dashScope section following the existing pattern.
**When to use:** Adding API key and model selection to Settings page.
**Example:**
```typescript
// Extend in settingsStore.ts:
export interface DashScopeSettings {
  apiKey: string;
  model: string; // 'qwen-vl-max' | 'qwen-vl-plus' | 'qwen3-vl-plus'
}

interface SettingsState {
  // ... existing fields
  dashScope: DashScopeSettings;
  setDashScopeApiKey: (key: string) => void;
  setDashScopeModel: (model: string) => void;
}

// In partialize, add:
partialize: (state) => ({
  // ... existing
  dashScope: state.dashScope,
}),
```
[VERIFIED: settingsStore.ts -- pattern confirmed by reading existing code]

### Pattern 5: Multi-Step Guided Flow State Machine
**What:** A state machine managing the steps: image preview -> template selection -> loading -> result display.
**When to use:** Inside the PromptReverseFlow modal component.
**Example:**
```typescript
type FlowStep = 'preview' | 'template' | 'loading' | 'result';

interface PromptReverseState {
  step: FlowStep;
  imageBase64: string | null;
  imagePreviewUrl: string | null;
  selectedTemplate: string | null;
  result: string | null;
  error: string | null;
  // actions
  startFlow: (imageBase64: string, previewUrl: string) => void;
  selectTemplate: (templateId: string) => void;
  setResult: (result: string) => void;
  setError: (error: string) => void;
  reset: () => void;
}
```
[ASSUMED] -- straightforward state machine for multi-step UI flows.

### Anti-Patterns to Avoid
- **Don't install OpenAI SDK for a single endpoint:** The DashScope OpenAI-compatible endpoint is a standard REST API. Raw fetch via bridgeFetch is sufficient and avoids dependency bloat.
- **Don't create per-page context menu implementations:** Use a single global context menu provider mounted at app root, not duplicate implementations in Draw.tsx and History.tsx.
- **Don't send full-resolution images without size checks:** VL models have token limits; oversized images waste tokens and may hit API limits. Add image resizing when dimensions exceed 2048px.
- **Don't hardcode the DashScope base URL in multiple places:** Centralize in the service module.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP client for DashScope | Custom fetch wrapper with UXP detection | `bridgeFetch` from upload.ts | Already handles UXP/browser split, timeout, retry, binary response |
| State persistence for API key | Custom localStorage wrapper | Zustand `persist` middleware | Already used project-wide, handles serialization |
| Modal overlay component | Custom portal implementation | Follow ConfirmDialog.tsx pattern | Proven pattern in the codebase |
| Clipboard copy | document.execCommand fallback | `navigator.clipboard.writeText` with fallback | Standard pattern, already used in History.tsx |

**Key insight:** The `comfyui.fetch` Bridge handler in `main.js` (line 781) is already a generic HTTP proxy. It accepts arbitrary URL, method, headers, and body. DashScope API calls can reuse this handler directly -- the `bridgeFetch` function in `upload.ts` wraps it perfectly. No new Bridge handler is needed in main.js unless we want to add special DashScope-specific error handling.

## Common Pitfalls

### Pitfall 1: Cross-Origin Canvas Taint
**What goes wrong:** Drawing a cross-origin image to canvas taints it, making `toDataURL()` throw a SecurityError.
**Why it happens:** Browser security policy prevents reading pixel data from images loaded from different origins without CORS headers.
**How to avoid:** For ComfyUI images (same-network or local), CORS is typically enabled. For blob: URLs (generated by the app), no CORS issue. Add a try-catch and fall back to fetching the image via bridgeFetch if canvas extraction fails.
**Warning signs:** `SecurityError: The operation is insecure` when calling `canvas.toDataURL()`.

### Pitfall 2: Base64 Image Size Limits
**What goes wrong:** DashScope API has input token limits. Very large images (e.g., 4K screenshots) generate huge base64 strings that may exceed request size limits or consume excessive tokens.
**Why it happens:** Base64 encoding increases size by ~33%. A 4K PNG can easily be 20MB+, becoming ~27MB as base64.
**How to avoid:** Resize images to max 2048px on the longest side before encoding. Use canvas `toDataURL('image/jpeg', 0.85)` for compression instead of PNG when the image doesn't need transparency.
**Warning signs:** API returns 400 or timeout on large images.

### Pitfall 3: API Key Security
**What goes wrong:** API key stored in localStorage is accessible to any script in the page, including browser extensions.
**Why it happens:** Zustand persist with localStorage is convenient but not encrypted.
**How to avoid:** This is acceptable for a local tool (Photoshop plugin). The API key is user-owned and the app runs in a trusted environment. Just don't log or expose the key in UI.
**Warning signs:** API key appearing in console logs or error messages.

### Pitfall 4: Race Conditions in Multi-Step Flow
**What goes wrong:** User clicks "Reverse Prompt" on a second image while the first is still loading.
**Why it happens:** Asynchronous API calls don't cancel previous requests automatically.
**How to avoid:** Store an AbortController in the promptReverseStore. When a new flow starts, abort the previous one. Disable the context menu trigger while a flow is active, or replace the in-progress flow.
**Warning signs:** Result from request A appears when user is viewing request B's preview.

### Pitfall 5: Bridge Timeout for VL Model Inference
**What goes wrong:** VL model inference can take 10-30 seconds. The default bridgeFetch timeout is 30 seconds.
**Why it happens:** Complex images with detailed analysis prompts require significant processing time.
**How to avoid:** Set bridgeFetch timeout to 60 seconds for DashScope calls. Show a progress indicator in the modal. Consider using the streaming API for real-time text generation feedback.
**Warning signs:** Frequent timeout errors in UXP environment.

## Code Examples

Verified patterns from official sources:

### DashScope API Request Format
```typescript
// Source: https://help.aliyun.com/zh/model-studio/qwen-vl-compatible-with-openai
// OpenAI-compatible endpoint -- confirmed from official Alibaba Cloud docs

// Endpoint: POST https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
// Auth: Authorization: Bearer <DASHSCOPE_API_KEY>
// Content-Type: application/json

// Request body:
{
  "model": "qwen-vl-max",           // or qwen-vl-plus, qwen3-vl-plus
  "messages": [
    {
      "role": "user",
      "content": [
        { "type": "text", "text": "请详细描述这张图片的内容" },
        {
          "type": "image_url",
          "image_url": {
            "url": "data:image/png;base64,iVBOR..."
          }
        }
      ]
    }
  ]
}

// Response body:
{
  "choices": [
    {
      "message": {
        "role": "assistant",
        "content": "这张图片展示了..."
      },
      "finish_reason": "stop"
    }
  ],
  "usage": {
    "prompt_tokens": 1234,
    "completion_tokens": 567,
    "total_tokens": 1801
  },
  "model": "qwen-vl-max"
}
```
[VERIFIED: help.aliyun.com official docs]

### DashScope Available Models
```typescript
// Source: https://help.aliyun.com/zh/model-studio/qwen-vl-compatible-with-openai
export const DASHSCOPE_MODELS = [
  { id: 'qwen-vl-max', name: 'Qwen VL Max', description: '最强视觉理解能力' },
  { id: 'qwen-vl-plus', name: 'Qwen VL Plus', description: '均衡性能与成本' },
  { id: 'qwen3-vl-plus', name: 'Qwen3 VL Plus', description: '最新一代 VL 模型' },
] as const;

export const DEFAULT_MODEL = 'qwen-vl-plus';
```
[VERIFIED: help.aliyun.com official docs]

### Prompt Template Definitions
```typescript
// Source: [ASSUMED] -- template content designed for Chinese natural language output
export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
}

export const PROMPT_TEMPLATES: PromptTemplate[] = [
  {
    id: 'detailed',
    name: '详细描述',
    description: '全面描述图片内容、构图、色彩和风格',
    systemPrompt: '你是一个专业的图像描述专家。请用中文详细描述这张图片的内容，包括：主体内容、构图方式、色彩搭配、光影效果、艺术风格。输出格式为一段流畅的自然语言描述，不要使用标签或列表格式。',
  },
  {
    id: 'concise',
    name: '简洁描述',
    description: '用一两句话概括图片内容',
    systemPrompt: '请用中文简洁地描述这张图片的内容，用一到两句话概括最重要的视觉元素和整体氛围。',
  },
  {
    id: 'composition',
    name: '构图分析',
    description: '分析图片的构图和视觉层次',
    systemPrompt: '你是一个专业的摄影构图分析师。请用中文分析这张图片的构图方式、视觉层次、前景/背景关系、视觉引导线、以及拍摄角度。输出为自然语言描述。',
  },
  {
    id: 'style',
    name: '风格分析',
    description: '分析图片的艺术风格和视觉特征',
    systemPrompt: '你是一个专业的艺术风格分析师。请用中文分析这张图片的艺术风格、视觉特征、可能使用的创作技法、以及它让你联想到的艺术流派或艺术家风格。输出为自然语言描述。',
  },
];
```
[ASSUMED] -- template content is at Claude's discretion per CONTEXT.md

### Fill Prompt into Draw Page Input
```typescript
// How to fill the reverse-engineered prompt into the Draw page prompt input
// The Draw page stores prompt text in inputValues with keys like "text_<nodeId>"
// for CLIPTextEncode nodes. We need to find the first text input and set it.

// In Draw.tsx or via a callback passed from Draw:
const handleFillPrompt = (resultText: string) => {
  // Find the first text-type input (CLIPTextEncode node prompt)
  const firstTextInput = workflowInputs.find(input => input.type === 'text');
  if (firstTextInput) {
    handleInputChange(firstTextInput.name, resultText);
  }
};
```
[VERIFIED: Draw.tsx code inspection -- text inputs use handleInputChange with input.name key]

### Settings Page Extension Pattern
```tsx
// Following the existing Settings.tsx card pattern:
<div className="settings-card dashscope-config">
  <div className="card-header">
    <h2>提示词反推</h2>
    <span className={`connection-status ${apiKey ? 'connected' : 'disconnected'}`}>
      {apiKey ? '已配置' : '未配置'}
    </span>
  </div>
  <div className="connection-form">
    <div className="form-group">
      <label htmlFor="dashscope-key">API Key</label>
      <input
        id="dashscope-key"
        type="password"
        value={dashScope.apiKey}
        onChange={(e) => setDashScopeApiKey(e.target.value)}
        placeholder="sk-..."
        className="text-input"
      />
    </div>
    <div className="form-group">
      <label htmlFor="dashscope-model">模型</label>
      <select
        id="dashscope-model"
        value={dashScope.model}
        onChange={(e) => setDashScopeModel(e.target.value)}
      >
        {DASHSCOPE_MODELS.map(m => (
          <option key={m.id} value={m.id}>{m.name}</option>
        ))}
      </select>
    </div>
  </div>
</div>
```
[VERIFIED: Settings.tsx pattern confirmed by code inspection]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| CLIP Interrogator (local) | Cloud VL APIs (Qwen VL, GPT-4V) | 2024+ | No local GPU needed, better Chinese language support |
| DashScope native API | OpenAI-compatible API | 2024+ | Simpler integration, standard format |
| Tag-based output | Natural language description | 2024+ | Better for prompt input, more contextual |

**Deprecated/outdated:**
- DashScope native API (non-OpenAI-compatible): Replaced by the `/compatible-mode/v1` endpoint. Use the OpenAI-compatible endpoint instead.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `bridgeFetch` can proxy requests to `dashscope.aliyuncs.com` without CORS issues in browser mode | Architecture Patterns | Medium -- if browser CORS blocks it, need to add DashScope URL to Vite proxy config or always route through Bridge |
| A2 | Canvas image extraction works for all image sources in the app (blob URLs, ComfyUI URLs, data URLs) | Pattern 2 | Medium -- cross-origin ComfyUI images may taint canvas; fallback via bridgeFetch needed |
| A3 | Default bridgeFetch timeout (30s) is too short for VL inference; 60s is sufficient | Pitfall 5 | Low -- can be adjusted at call site |
| A4 | Prompt template content will produce high-quality Chinese natural language descriptions | Code Examples | Low -- templates can be iterated on; this is at Claude's discretion |
| A5 | No need for streaming API response; non-streaming is sufficient for UX | Architecture | Low -- streaming could be added later for real-time text display |
| A6 | `comfyui.fetch` Bridge handler in main.js does not need modification for DashScope requests | Don't Hand-Roll | Low -- the handler is generic; verified it accepts arbitrary URL, headers, body |

**Claims requiring user confirmation:** None critical. A1 (CORS) should be tested early in implementation.

## Open Questions

1. **CORS in browser-only mode**
   - What we know: UXP mode uses Bridge proxy (no CORS). `bridgeFetch` works for arbitrary URLs.
   - What's unclear: In standalone browser mode (dev/production webapp without UXP), `bridgeFetch` falls back to `window.fetch`, which IS subject to CORS from `dashscope.aliyuncs.com`.
   - Recommendation: Add a Vite dev proxy for `/api/dashscope` during development. For production browser-only use, the DashScope API likely supports CORS from browser origins (needs verification). If not, always use Bridge when available and show a CORS error message in browser-only mode.

2. **Image size optimization thresholds**
   - What we know: VL models have token limits; large images cost more tokens and time.
   - What's unclear: Optimal max dimension for Qwen VL models. DashScope docs suggest images up to ~10MB total.
   - Recommendation: Resize to max 2048px longest side, JPEG quality 0.85 for non-transparent images, PNG for transparent. This is a reasonable default that can be tuned.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| DashScope API | Image analysis | External | N/A | No fallback -- feature requires API |
| Node.js | Build/dev | Yes | v22+ | -- |
| npm | Package management | Yes | 10+ | -- |
| Vitest | Testing | Yes | 4.0.18 | -- |
| Canvas API | Image resize/base64 | Browser | Built-in | -- |

**Missing dependencies with no fallback:**
- DashScope API Key: Must be provided by user in Settings. Feature is non-functional without it.

**Missing dependencies with fallback:**
- None -- all runtime dependencies are browser-native or project-internal.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.18 |
| Config file | None (uses vitest defaults via `npm test`) |
| Quick run command | `cd code/webapp && npx vitest run --reporter=verbose` |
| Full suite command | `cd code/webapp && npm test -- --run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| D-04/05 | DashScope API client formats request correctly | unit | `npx vitest run src/services/__tests__/dashscope.test.ts` | No -- Wave 0 |
| D-15 | Prompt templates have valid structure | unit | `npx vitest run src/services/__tests__/dashscope.test.ts` | No -- Wave 0 |
| D-13 | Settings store persists DashScope config | unit | `npx vitest run src/stores/__tests__/settingsStore.test.ts` | No -- Wave 0 |
| D-02 | PromptReverseStore state machine transitions | unit | `npx vitest run src/stores/__tests__/promptReverseStore.test.ts` | No -- Wave 0 |

### Sampling Rate
- **Per task commit:** `cd code/webapp && npx vitest run --reporter=verbose`
- **Per wave merge:** `cd code/webapp && npm test -- --run`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `src/services/__tests__/dashscope.test.ts` -- DashScope API client unit tests
- [ ] `src/stores/__tests__/promptReverseStore.test.ts` -- prompt reverse store state machine tests
- [ ] `src/stores/__tests__/settingsStore.test.ts` -- extended settings store with dashScope section

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | API key handled by DashScope, not user auth |
| V3 Session Management | no | No sessions involved |
| V4 Access Control | no | Local app, single user |
| V5 Input Validation | yes | Validate base64 image data, sanitize API responses |
| V6 Cryptography | no | HTTPS for API calls (handled by DashScope) |

### Known Threat Patterns for React + API Key

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| API key exposure in localStorage | Information Disclosure | Acceptable for local tool; don't log or display key |
| XSS stealing API key | Tampering | React's JSX escaping prevents most XSS; no dangerouslySetInnerHTML |
| API response injection | Tampering | Validate response structure before rendering |

## Sources

### Primary (HIGH confidence)
- `help.aliyun.com/zh/model-studio/qwen-vl-compatible-with-openai` -- DashScope OpenAI-compatible VL API endpoint, auth, request/response format, available models
- `code/webapp/src/services/upload.ts` -- bridgeFetch implementation, sendBridgeMessage, UXP detection
- `code/webapp/src/stores/settingsStore.ts` -- Zustand persist pattern for settings
- `PS-plugin/ningleai/main.js` -- Bridge handler architecture, `comfyui.fetch` generic HTTP proxy

### Secondary (MEDIUM confidence)
- `code/webapp/src/pages/Draw.tsx` -- Prompt input integration points, image output structure
- `code/webapp/src/pages/Settings.tsx` -- Settings page card layout pattern
- `code/webapp/src/pages/History.tsx` -- History image rendering, right-click target identification
- `code/webapp/src/components/preset/ConfirmDialog.tsx` -- Modal overlay pattern

### Tertiary (LOW confidence)
- Image-to-base64 extraction via canvas -- standard browser API, not specifically verified against all image sources in the app
- DashScope CORS policy for browser-origin requests -- not verified, may need Vite proxy

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all verified from codebase
- Architecture: HIGH -- follows established patterns in the codebase
- API integration: HIGH -- DashScope OpenAI-compatible endpoint verified from official docs
- Pitfalls: MEDIUM -- CORS and image size issues need testing during implementation
- Prompt templates: MEDIUM -- content is at Claude's discretion, quality TBD

**Research date:** 2026-04-15
**Valid until:** 2026-05-15 (stable -- DashScope API is mature)
