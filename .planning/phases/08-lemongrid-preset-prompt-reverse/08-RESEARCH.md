# Phase 8: LemonGrid 预设与反推提示词集成 - Research

**Researched:** 2026-05-19
**Domain:** Photoshop Plugin (React + Zustand) -> LemonGrid Platform (FastAPI + PostgreSQL)
**Confidence:** HIGH

## Summary

This phase connects two existing features -- workflow parameter presets (Phase 4) and image prompt reverse engineering (Phase 5) -- to LemonGrid's cluster mode. The critical discovery is that LemonGrid's backend already has both capabilities built as server-side services: `PresetService` with full CRUD REST API (`/api/v1/templates/{id}/presets`) and `PromptReverseService` with a KIE Gemini vision model endpoint (`/api/v1/assets/library/reverse-prompt`). The PS plugin currently uses client-side Bridge filesystem storage for presets and DashScope (Qwen VL) for prompt reverse. This phase creates server-side alternatives for cluster mode while leaving direct mode completely unchanged.

The preset integration is straightforward: the plugin already passes `selectedTemplate.id` as the `workflowName` prop to `PresetToolbar` (line 4436 of Draw.tsx), so the existing preset store already keys by template_id in cluster mode. The change is adding a new `ClusterPresetService` that calls LemonGrid REST endpoints instead of Bridge file handlers, and making `PresetToolbar` switch between them based on `connectionMode`.

The prompt reverse integration requires more design: LemonGrid's `reverse_prompt_for_asset` takes an `asset_id` (server-side reference), not a base64 image. Cluster output images already have `assetId` stored in `ClusterOutputImage`. But input images (uploaded to templates) and history images need asset_id resolution. Additionally, the LemonGrid endpoint returns a richer structure (prompt, prompt_cn, negative_prompt, analysis) compared to DashScope's plain text, so the result modal needs adaptation.

**Primary recommendation:** Create two new service modules (`clusterPresetService.ts` and `clusterPromptReverseService.ts`) that call LemonGrid APIs. Extend `PresetToolbar` and `PromptReverseFlow` to branch on `connectionMode`, routing to the appropriate service. No changes to Bridge handlers or main.js are needed -- all cluster-mode calls go through the existing `lemongridFetch` + `LemonGridClient` infrastructure.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Preset CRUD (Direct Mode) | Plugin filesystem (Bridge) | -- | Already implemented, unchanged |
| Preset CRUD (Cluster Mode) | LemonGrid Backend API | Plugin UI (display) | Server-side persistence, per-user scope, shared presets |
| Prompt Reverse (Direct Mode) | DashScope API (client call) | -- | Already implemented, unchanged |
| Prompt Reverse (Cluster Mode) | LemonGrid Backend (KIE Gemini) | Plugin UI (display) | Server-side image analysis, asset-based input |
| Preset UI rendering | Plugin webview (React) | -- | Same PresetToolbar component, different service layer |
| Prompt reverse UI rendering | Plugin webview (React) | -- | Same PromptReverseFlow component, adapted for cluster results |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Zustand | ^5.0.11 | State management | [VERIFIED: package.json] Project standard |
| React | ^19.2.0 | UI framework | [VERIFIED: package.json] Already in project |
| LemonGridClient | (local) | Cluster API client | [VERIFIED: code/webapp/src/services/lemongrid.ts] Already handles auth, fetch, asset upload |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Vitest | ^4.0.18 | Testing | [VERIFIED: package.json] Already in project |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Separate cluster preset store | Extend presetStore with service switching | Switching keeps store simpler; separate store risks state sync issues. Recommendation: switch in service layer, keep single store |
| Modify LemonGrid prompt reverse to accept base64 | Upload image as temp asset first, then call reverse-prompt | Uploading as temp asset is simpler and matches the existing asset lifecycle |

**Installation:** No new packages needed.

## Architecture Patterns

### System Architecture Diagram

```
PresetToolbar / PromptReverseFlow (React UI)
  |
  +--[connectionMode === 'direct']--+
  |                                  |
  |    Direct Mode Services          |    Cluster Mode Services
  |    (existing, unchanged)         |    (NEW this phase)
  |                                  |
  |    preset.ts                     |    clusterPresetService.ts
  |    -> Bridge handlers            |    -> LemonGridClient
  |    -> UXP filesystem             |    -> /api/v1/templates/{id}/presets/*
  |                                  |
  |    dashscope.ts                  |    clusterPromptReverseService.ts
  |    -> bridgeFetch                |    -> LemonGridClient
  |    -> DashScope API              |    -> /api/v1/assets/library/reverse-prompt
  |                                  |
  +----------------------------------+
```

### Recommended Project Structure
```
code/webapp/src/
  services/
    clusterPresetService.ts       # NEW - LemonGrid preset CRUD via REST
    clusterPromptReverseService.ts # NEW - LemonGrid image analysis via REST
    preset.ts                     # UNCHANGED - Direct mode preset service
    dashscope.ts                  # UNCHANGED - Direct mode prompt reverse
    lemongrid.ts                  # UNCHANGED - LemonGridClient (already has all needed methods)
  stores/
    presetStore.ts                # MODIFY - Add cluster preset loading
    promptReverseStore.ts         # MODIFY - Add cluster result handling
  components/
    preset/
      PresetToolbar.tsx           # MODIFY - Branch service calls on connectionMode
    promptReverse/
      PromptReverseFlow.tsx       # MODIFY - Branch analysis calls on connectionMode
      ClusterResultView.tsx       # NEW - Display structured LemonGrid reverse result
  pages/
    Draw.tsx                      # MODIFY - Wire cluster preset/prompt into cluster mode UI
```

### Pattern 1: Service Layer Switching by connectionMode
**What:** Create parallel service modules for cluster mode, switch at the component level based on `connectionMode`.
**When to use:** Every operation that differs between direct and cluster mode.
**Example:**
```typescript
// Source: [DESIGNED - follows existing preset.ts and lemongrid.ts patterns]
// In PresetToolbar or a hook:
const connectionMode = useSettingsStore((s) => s.connectionMode);

const loadPresets = connectionMode === 'cluster'
  ? clusterPresetService.listPresets
  : presetService.listPresets;
```

### Pattern 2: LemonGrid Preset API Client
**What:** Call LemonGrid REST endpoints for preset CRUD in cluster mode.
**When to use:** All cluster-mode preset operations.
**API endpoints** [VERIFIED: D:\projects\LemonGrid\LemonGrid\fluxcore-backend\app\api\v1\templates.py lines 432-501]:
- `GET /api/v1/templates/{template_id}/presets` -- list presets (with scope visibility)
- `POST /api/v1/templates/{template_id}/presets` -- create preset
- `PUT /api/v1/templates/{template_id}/presets/{preset_id}` -- update preset
- `DELETE /api/v1/templates/{template_id}/presets/{preset_id}` -- delete preset

**Example:**
```typescript
// Source: [VERIFIED: LemonGrid backend templates.py + schemas/__init__.py]
import { LemonGridClient } from './lemongrid';
import { useLemonGridStore } from '../stores/lemongridStore';

interface ClusterPreset {
  id: string;
  template_id: string;
  name: string;
  parameters: Record<string, unknown>;
  scope: 'personal' | 'shared';
  owner_id: string | null;
  created_at: string;
  updated_at: string;
}

async function listClusterPresets(templateId: string): Promise<ClusterPreset[]> {
  const serverUrl = useLemonGridStore.getState().serverUrl;
  const client = new LemonGridClient({ serverUrl });
  // GET /api/v1/templates/{template_id}/presets?page_size=100
  const response = await (client as any).fetchJson<{items: ClusterPreset[]; total: number}>(
    `/api/v1/templates/${templateId}/presets?page_size=100`
  );
  return response.items;
}
```

### Pattern 3: LemonGrid Prompt Reverse via Asset Upload
**What:** For cluster mode prompt reverse, upload the image as a LemonGrid asset, then call the reverse-prompt endpoint.
**When to use:** Right-click prompt reverse on cluster output images, input images, or history images.
**Key constraint:** LemonGrid `reverse_prompt_for_asset` requires an `asset_id` that exists in the LemonGrid asset library [VERIFIED: D:\projects\LemonGrid\LemonGrid\fluxcore-backend\app\services\prompt_reverse_service.py line 80-82].

**API endpoint** [VERIFIED: D:\projects\LemonGrid\LemonGrid\fluxcore-backend\app\api\v1\assets.py lines 641-663]:
- `POST /api/v1/assets/library/reverse-prompt` with `{ asset_id: UUID }`

**Response format:**
```json
{
  "prompt": "English prompt for AI generation",
  "prompt_cn": "Chinese prompt for AI generation",
  "negative_prompt": "English negative prompt keywords",
  "analysis": {
    "subject": "...",
    "composition": "...",
    "lighting": "...",
    "color_palette": "...",
    "mood": "...",
    "style": "...",
    "technical": "..."
  }
}
```

### Pattern 4: Asset ID Resolution for Cluster Images
**What:** For cluster output images, the assetId is already stored in `ClusterOutputImage.assetId`. For input images or arbitrary images, upload to LemonGrid asset API first.
**When to use:** When user right-clicks any image in cluster mode.
**Example:**
```typescript
// For cluster output images:
const outputImage = clusterOutputImages[index]; // already has .assetId
const assetId = outputImage.assetId;

// For arbitrary images (input uploads, etc.):
const file = new File([blob], 'reverse-input.png', { type: 'image/png' });
const { id: assetId } = await client.uploadAsset(file, 'REFERENCE');
```

### Anti-Patterns to Avoid
- **Do NOT modify Bridge handlers or main.js:** All cluster-mode API calls use `lemongridFetch` + `LemonGridClient`, not Bridge. Bridge is only for direct mode filesystem operations.
- **Do NOT change direct mode behavior:** Direct mode preset and prompt reverse must remain completely unchanged. Use `connectionMode` branching, not shared code paths.
- **Do NOT call DashScope from cluster mode:** Cluster mode uses LemonGrid's KIE Gemini backend. DashScope API key is a direct-mode-only concern.
- **Do NOT add LemonGrid preset API methods to `LemonGridClient` class:** Keep `LemonGridClient` focused on template/task/asset operations. Create a separate `clusterPresetService.ts` that uses `LemonGridClient.fetchJson` internally (expose a thin wrapper or use the client's `fetchWithAuth`).
- **Do NOT store cluster presets in Bridge filesystem:** Cluster presets persist on the LemonGrid server via its PostgreSQL database. The local filesystem is only for direct mode presets.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Server-side preset storage | Custom API endpoints in LemonGrid backend | Existing `PresetService` + REST API | [VERIFIED: preset_service.py + templates.py] Full CRUD with scope-based visibility already built |
| Server-side image analysis | Custom vision model integration | Existing `PromptReverseService.reverse_prompt_for_asset` | [VERIFIED: prompt_reverse_service.py] KIE Gemini integration with structured output already built |
| Preset scope/visibility | Client-side filtering | Server `list_presets` with role-based visibility | [VERIFIED: preset_service.py line 76-118] Admin sees all; users see shared + own personal |
| Asset upload for prompt reverse | Custom upload mechanism | `LemonGridClient.uploadAsset()` | Already handles UXP Bridge proxy and browser direct upload |

**Key insight:** LemonGrid backend already has both features fully implemented. This phase is a thin client integration layer in the PS plugin, not a backend development phase.

## Common Pitfalls

### Pitfall 1: Preset Parameter Format Mismatch
**What goes wrong:** Direct mode presets store `inputValues` as flat key-value pairs (`{ "prompt_1": "text", "seed": 42 }`). Cluster mode LemonGrid presets use `parameters` in `{"node_id.input_name": "value"}` format per the schema comment.
**Why it happens:** The LemonGrid `ParameterPreset.parameters` column uses JSONB described as `{"node_id.input_name": "value"}` format, but the PS plugin's `templateParams` is a flat `{ input_name: value }` dict (without node_id prefix).
**How to avoid:** When creating cluster presets, store `templateParams` directly as the `parameters` value. The LemonGrid backend does not enforce the `node_id.input_name` key format -- it stores arbitrary JSONB. The format comment is descriptive, not prescriptive. Verify by checking what the LemonGrid frontend already stores.
**Warning signs:** Preset parameters lost or malformed after round-trip through LemonGrid API.

### Pitfall 2: Prompt Reverse on Cluster Images Without Asset ID
**What goes wrong:** User right-clicks a cluster output image in the preview strip, but the image's `src` is a blob URL created from `URL.createObjectURL(blob)`. The `PromptReverseProvider` tries to extract base64 from the `<img>` element via canvas, which works for blob URLs but there's no associated `assetId` to pass to LemonGrid.
**Why it happens:** The `PromptReverseProvider` uses `imageElementToBase64(imgElement)` which works on any visible image. But for cluster mode, we need the `assetId`, not the base64.
**How to avoid:** Option A: Store the mapping from blob URL to assetId in a lookup table. Option B: Use `data-asset-id` attribute on cluster images and read it in the context menu handler. Option B is simpler and more reliable.
**Warning signs:** Cluster mode prompt reverse fails with "asset not found" or uploads the same image twice.

### Pitfall 3: PresetToolbar Already Uses template_id as Key
**What goes wrong:** Double-wrapping or mismatched key format when integrating cluster preset service.
**Why it happens:** Draw.tsx already passes `selectedTemplate.id` as `workflowName` to `PresetToolbar` (line 4436). The existing `presetStore.loadPresets(workflowName)` call at line 502 already loads with `selectedTemplate.id`.
**How to avoid:** In cluster mode, `presetStore.loadPresets` should call `clusterPresetService.listPresets` instead of `presetService.listPresets(workflowName)`. The template_id flows through as the key in both cases.
**Warning signs:** Presets not loading in cluster mode, or wrong presets showing for a template.

### Pitfall 4: LemonGrid Prompt Reverse Returns Structured Data, Not Plain Text
**What goes wrong:** The existing `PromptReverseFlow` component expects a plain text result (from DashScope). LemonGrid returns `{ prompt, prompt_cn, negative_prompt, analysis }` -- a structured object.
**Why it happens:** DashScope returns whatever text the Qwen VL model generates. LemonGrid's KIE Gemini returns structured JSON with specific fields.
**How to avoid:** In cluster mode, display the structured result differently: show `prompt_cn` as the primary result, with collapsible sections for `prompt` (English), `negative_prompt`, and `analysis` breakdown. The "copy" and "fill prompt" buttons should use `prompt_cn` by default.
**Warning signs:** Structured result displayed as raw JSON string instead of formatted.

### Pitfall 5: Race Condition Between Preset Store Modes
**What goes wrong:** User switches from direct to cluster mode while presets are loading, causing the store to receive direct-mode presets for a cluster template.
**Why it happens:** `presetStore.loadPresets` is async. If mode switches mid-flight, the response handler writes stale data.
**How to avoid:** Use a generation counter or abort controller pattern. Alternatively, clear the preset store on mode switch before loading the new mode's presets (which the existing `clearSelection()` call already partially handles).
**Warning signs:** Wrong presets appear briefly after mode switch.

### Pitfall 6: Import/Export Not Available for Cluster Presets
**What goes wrong:** User expects to import/export presets in cluster mode, but the import/export UI shows native file picker which doesn't apply to server-side presets.
**Why it happens:** Import/export in direct mode uses Bridge file picker (`getFileForOpening`/`getFileForSaving`). Cluster mode presets are server-side and can't be exported as local files.
**How to avoid:** In cluster mode, either: (A) hide import/export buttons, (B) implement export as downloading JSON from the server, or (C) keep buttons but show "not available in cluster mode" toast. Option A is simplest and most honest.
**Warning signs:** Import/export buttons crash or do nothing in cluster mode.

## Code Examples

### Cluster Preset Service
```typescript
// Source: [VERIFIED: LemonGrid backend templates.py presets API + schemas/__init__.py]
// code/webapp/src/services/clusterPresetService.ts
import { useLemonGridStore } from '../stores/lemongridStore';
import { ensureValidToken } from './lemongrid-auth';
import { lemongridFetch } from './lemongrid-auth';

export interface ClusterPresetMeta {
  id: string;
  template_id: string;
  name: string;
  parameters: Record<string, unknown>;
  scope: 'personal' | 'shared';
  owner_id: string | null;
  created_at: string;
  updated_at: string;
}

async function getServerUrl(): Promise<string> {
  await ensureValidToken();
  return useLemonGridStore.getState().serverUrl.replace(/\/+$/, '');
}

export async function listPresets(templateId: string): Promise<ClusterPresetMeta[]> {
  const serverUrl = await getServerUrl();
  const response = await lemongridFetch(
    `${serverUrl}/api/v1/templates/${templateId}/presets?page_size=100`
  );
  if (!response.ok) throw new Error(`List presets failed: ${response.status}`);
  const data = await response.json();
  return data.items || [];
}

export async function createPreset(
  templateId: string,
  name: string,
  parameters: Record<string, unknown>,
  scope: 'personal' | 'shared' = 'personal'
): Promise<ClusterPresetMeta> {
  const serverUrl = await getServerUrl();
  const response = await lemongridFetch(
    `${serverUrl}/api/v1/templates/${templateId}/presets`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ template_id: templateId, name, parameters, scope }),
    }
  );
  if (!response.ok) {
    if (response.status === 409) throw new Error('PRESET_NAME_CONFLICT');
    throw new Error(`Create preset failed: ${response.status}`);
  }
  return response.json();
}

export async function updatePreset(
  templateId: string,
  presetId: string,
  data: { name?: string; parameters?: Record<string, unknown>; scope?: string }
): Promise<ClusterPresetMeta> {
  const serverUrl = await getServerUrl();
  const response = await lemongridFetch(
    `${serverUrl}/api/v1/templates/${templateId}/presets/${presetId}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }
  );
  if (!response.ok) throw new Error(`Update preset failed: ${response.status}`);
  return response.json();
}

export async function deletePreset(templateId: string, presetId: string): Promise<void> {
  const serverUrl = await getServerUrl();
  const response = await lemongridFetch(
    `${serverUrl}/api/v1/templates/${templateId}/presets/${presetId}`,
    { method: 'DELETE' }
  );
  if (!response.ok && response.status !== 204) throw new Error(`Delete preset failed: ${response.status}`);
}
```

### Cluster Prompt Reverse Service
```typescript
// Source: [VERIFIED: LemonGrid backend assets.py line 641-663 + prompt_reverse_service.py]
// code/webapp/src/services/clusterPromptReverseService.ts
import { useLemonGridStore } from '../stores/lemongridStore';
import { lemongridFetch } from './lemongrid-auth';
import { LemonGridClient } from './lemongrid';
import { isUXPWebView } from './upload';

export interface ClusterReversePromptResult {
  prompt: string;
  prompt_cn: string;
  negative_prompt: string;
  analysis: {
    subject: string;
    composition: string;
    lighting: string;
    color_palette: string;
    mood: string;
    style: string;
    technical: string;
  };
}

/**
 * Reverse prompt using LemonGrid's KIE Gemini backend.
 * Requires an asset_id that exists in the LemonGrid asset library.
 */
export async function reversePromptFromAsset(
  assetId: string
): Promise<ClusterReversePromptResult> {
  const serverUrl = useLemonGridStore.getState().serverUrl.replace(/\/+$/, '');
  const response = await lemongridFetch(
    `${serverUrl}/api/v1/assets/library/reverse-prompt`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ asset_id: assetId }),
    }
  );
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Reverse prompt failed: ${response.status} - ${errorText}`);
  }
  return response.json();
}

/**
 * Upload a blob as a temporary LemonGrid asset for prompt reverse.
 * Returns the asset_id for use with reversePromptFromAsset.
 */
export async function uploadForReversePrompt(
  imageBlob: Blob,
  filename: string = 'reverse-input.png'
): Promise<string> {
  const serverUrl = useLemonGridStore.getState().serverUrl;
  const client = new LemonGridClient({ serverUrl });
  const file = new File([imageBlob], filename, { type: imageBlob.type || 'image/png' });
  const { id } = await client.uploadAsset(file, 'REFERENCE');
  return id;
}
```

### PresetToolbar Connection Mode Branching
```typescript
// Source: [DESIGNED - extends existing PresetToolbar.tsx]
// Inside PresetToolbar component, before existing preset operations:
const connectionMode = useSettingsStore((s) => s.connectionMode);
const isCluster = connectionMode === 'cluster';

// Replace direct presetService calls with mode-aware wrappers:
const loadPresetsForMode = useCallback(async (key: string) => {
  if (isCluster) {
    // clusterPresetService returns ClusterPresetMeta[], convert to PresetMeta[]
    const clusterPresets = await clusterPresetService.listPresets(key);
    return clusterPresets.map(p => ({
      filename: p.id,        // use preset ID as filename equivalent
      name: p.name,
      workflowName: p.template_id,
      updatedAt: p.updated_at,
      createdAt: p.created_at,
    }));
  }
  return presetService.listPresets(key);
}, [isCluster]);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Local filesystem presets only | Server-side presets with LemonGrid API | Phase 8 | Presets persist across devices for cluster users |
| DashScope Qwen VL for prompt reverse | KIE Gemini via LemonGrid backend | Phase 8 | Cluster mode uses server-side vision model; no client API key needed |
| Flat text prompt reverse result | Structured result (prompt, negative_prompt, analysis) | Phase 8 | Richer result display in cluster mode |

**Deprecated/outdated:**
- None -- direct mode approaches remain valid and unchanged.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | LemonGrid `ParameterPreset.parameters` JSONB column stores arbitrary dict format, not strictly `{"node_id.input_name": "value"}` | Preset Pitfall 1 | Parameters lost if backend validates format |
| A2 | LemonGrid backend is deployed and accessible from plugin network | Environment | Cannot test cluster preset/prompt features |
| A3 | `LemonGridClient.fetchJson` can be reused for preset endpoints (currently private) | Code Examples | Need to expose as public method or duplicate fetch logic |
| A4 | LemonGrid `reverse-prompt` endpoint works with assets uploaded via `REFERENCE` library_type | Prompt Reverse | Assets might need specific library_type for reverse-prompt eligibility |
| A5 | `ensureValidToken` is called before every cluster preset/prompt operation, ensuring auth is valid | Services | 401 errors during preset/prompt operations |
| A6 | The LemonGrid `list_presets` endpoint returns all user-visible presets in a single page with `page_size=100` | Preset Service | Pagination needed if users have >100 presets per template |

## Open Questions

1. **LemonGridClient.fetchJson visibility**
   - What we know: `fetchJson` is a private method on `LemonGridClient`. Cluster preset service needs authenticated fetch.
   - What's unclear: Whether to expose `fetchJson` as public, or create a standalone helper using `lemongridFetch` + `ensureValidToken` directly.
   - Recommendation: Use `lemongridFetch` + `ensureValidToken` directly in the service (as shown in code examples), avoiding `LemonGridClient` internal changes. This is simpler and already proven in `lemongrid-auth.ts`.

2. **Cluster preset import/export**
   - What we know: Direct mode uses native file picker (Bridge). Cluster mode stores presets server-side.
   - What's unclear: Whether users need to export cluster presets to files.
   - Recommendation: Disable import/export buttons in cluster mode. Server-side presets are already persistent and device-independent. If needed later, export can download JSON and import can parse and create server-side presets.

3. **Prompt reverse on cluster input images (not outputs)**
   - What we know: Cluster output images have `assetId` from download flow. Input images are uploaded via `LemonGridClient.uploadAsset` and get an asset_id during submit.
   - What's unclear: Whether input image asset_ids are stored and accessible after template submission, or only during the submission flow.
   - Recommendation: When user right-clicks an input image in cluster mode, re-upload the image as a temp asset and call reverse-prompt. Slight overhead but reliable.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| LemonGrid Backend | Cluster preset + prompt reverse | Needs deployment | -- | Use direct mode |
| Node.js | Build tooling | Yes | 24.13.1 | -- |
| npm | Package management | Yes | 11.8.0 | -- |
| Vitest | Testing | Yes | 4.0.18 | -- |

**Missing dependencies with no fallback:**
- LemonGrid backend deployment required for cluster mode testing. Direct mode continues to work independently.

**Missing dependencies with fallback:**
- None -- all code-level dependencies are already in the project.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.18 |
| Config file | Inline in package.json |
| Quick run command | `cd code/webapp && npx vitest run --reporter=verbose` |
| Full suite command | `cd code/webapp && npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SC-1 | Cluster mode preset CRUD via LemonGrid API | unit | `cd code/webapp && npx vitest run src/services/__tests__/clusterPresetService.test.ts` | Wave 0 |
| SC-2 | Preset data persists on LemonGrid server | integration | Manual verification against LemonGrid backend | N/A |
| SC-3 | Cluster mode prompt reverse via LemonGrid API | unit | `cd code/webapp && npx vitest run src/services/__tests__/clusterPromptReverseService.test.ts` | Wave 0 |
| SC-4 | Prompt reverse uses LemonGrid image analysis | integration | Manual verification | N/A |
| SC-5 | Direct and cluster modes work independently | unit | `cd code/webapp && npx vitest run src/components/__tests__/PresetToolbar.test.tsx` | Wave 0 |

### Sampling Rate
- **Per task commit:** `cd code/webapp && npx vitest run --reporter=verbose`
- **Per wave merge:** `cd code/webapp && npx vitest run`
- **Phase gate:** Full suite green + manual cluster mode testing with LemonGrid backend

### Wave 0 Gaps
- [ ] `code/webapp/src/services/__tests__/clusterPresetService.test.ts` -- cluster preset service tests
- [ ] `code/webapp/src/services/__tests__/clusterPromptReverseService.test.ts` -- cluster prompt reverse tests
- [ ] No new framework install needed

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | LemonGrid JWT auth required for all cluster API calls |
| V3 Session Management | yes | Token refresh via ensureValidToken before every API call |
| V4 Access Control | yes | Server-side scope-based preset visibility (personal/shared) |
| V5 Input Validation | yes | LemonGrid Pydantic schemas validate all preset/prompt inputs server-side |
| V6 Cryptography | yes | HTTPS + JWT Bearer tokens for all cluster API calls |

### Known Threat Patterns for Cluster Integration

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Unauthorized preset access | Information Disclosure | Server-side visibility filter (personal vs shared) per PresetService |
| Preset injection (tampered parameters) | Tampering | Server-side Pydantic validation; client parameters are simple key-value pairs |
| Asset ID forgery for prompt reverse | Spoofing | Server validates asset_id exists and user has access before processing |
| Prompt reverse rate abuse | Denial of Service | LemonGrid API usage logging (ApiUsageLog) enables rate limiting |

## Sources

### Primary (HIGH confidence)
- `code/webapp/src/stores/presetStore.ts` -- Current preset state management, verified complete
- `code/webapp/src/services/preset.ts` -- Current preset service (Bridge), verified complete
- `code/webapp/src/types/preset.ts` -- Preset type definitions, verified
- `code/webapp/src/components/preset/PresetToolbar.tsx` -- Preset UI component, verified complete
- `code/webapp/src/services/dashscope.ts` -- DashScope API client, verified complete
- `code/webapp/src/stores/promptReverseStore.ts` -- Prompt reverse state management, verified
- `code/webapp/src/components/promptReverse/PromptReverseFlow.tsx` -- Prompt reverse modal, verified
- `code/webapp/src/components/promptReverse/ContextMenu.tsx` -- Right-click menu, verified
- `code/webapp/src/components/promptReverse/PromptReverseProvider.tsx` -- Global context menu provider, verified
- `code/webapp/src/services/lemongrid.ts` -- LemonGridClient with template/task/asset methods, verified
- `code/webapp/src/services/lemongrid-auth.ts` -- Auth service with lemongridFetch, ensureValidToken, verified
- `code/webapp/src/stores/lemongridStore.ts` -- LemonGrid state with auth, tasks, clusterOutputImages, verified
- `code/webapp/src/pages/Draw.tsx` -- Main page with connectionMode branching, verified (5040+ lines)
- `D:\projects\LemonGrid\LemonGrid\fluxcore-backend\app\api\v1\templates.py` -- Preset REST endpoints (lines 430-501)
- `D:\projects\LemonGrid\LemonGrid\fluxcore-backend\app\services\preset_service.py` -- PresetService CRUD with scope visibility
- `D:\projects\LemonGrid\LemonGrid\fluxcore-backend\app\models\parameter_preset.py` -- ParameterPreset model
- `D:\projects\LemonGrid\LemonGrid\fluxcore-backend\app\api\v1\assets.py` -- Reverse prompt endpoint (lines 632-663)
- `D:\projects\LemonGrid\LemonGrid\fluxcore-backend\app\services\prompt_reverse_service.py` -- KIE Gemini integration
- `D:\projects\LemonGrid\LemonGrid\fluxcore-backend\app\schemas\__init__.py` -- PresetCreate/Update/Response schemas (lines 770-808)

### Secondary (MEDIUM confidence)
- `.planning/phases/04-workflow-presets/04-CONTEXT.md` -- Phase 4 design decisions
- `.planning/phases/04-workflow-presets/04-RESEARCH.md` -- Phase 4 research (preset architecture)
- `.planning/phases/05-image-prompt-reverse/05-CONTEXT.md` -- Phase 5 design decisions
- `.planning/phases/06-lemongrid-integration/06-CONTEXT.md` -- Phase 6 LemonGrid integration decisions
- `.planning/phases/06-lemongrid-integration/06-RESEARCH.md` -- Phase 6 research (LemonGrid API details)

### Tertiary (LOW confidence)
- None -- all findings verified against source code

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new dependencies, all infrastructure already in place
- Architecture: HIGH -- LemonGrid backend APIs verified, existing plugin code fully analyzed
- Pitfalls: HIGH -- based on verified code analysis (preset format, asset_id flow, result structure differences)
- API compatibility: HIGH -- LemonGrid preset and prompt reverse endpoints verified from source code

**Research date:** 2026-05-19
**Valid until:** 2026-06-19 (stable -- core APIs are established, plugin infrastructure unchanged)
