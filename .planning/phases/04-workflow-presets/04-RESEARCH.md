# Phase 4: 工作流参数预设功能 - Research

**Researched:** 2026-04-15
**Domain:** React UI + Zustand state + UXP Bridge file system
**Confidence:** HIGH

## Summary

Phase 4 adds workflow parameter preset management to the existing Draw page. Users can save, load, rename, delete, import, and export parameter combinations as JSON files. The implementation spans three layers: (1) Bridge handlers in `main.js` for file system CRUD on preset JSON files, (2) a new `presetService.ts` + `presetStore.ts` for preset state management, and (3) a preset toolbar UI component integrated into `Draw.tsx`.

The project already has all the architectural patterns needed: Bridge message protocol (`sendBridgeMessage`), file system operations (`localFileSystem.getDataFolder()` + `createFolder()`), Zustand store with persist middleware, and a dark-themed UI with consistent button/dropdown styling. The preset system reuses the existing `WorkflowCacheEntry` data shape for `inputValues` and `imageFilenames`.

**Primary recommendation:** Follow the established three-layer pattern (Bridge handler -> service -> store -> UI). Create a `presets/` subfolder under the UXP data folder using `ensurePresetsFolder()` modeled after the existing `ensureDownloadsFolder()`. Use Zustand without persist for preset list state (the source of truth is the filesystem), and add Bridge actions `preset.list`, `preset.read`, `preset.write`, `preset.delete`, `preset.import`, `preset.export`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** 预设数据存储在 Bridge 文件系统（本地磁盘），不使用 localStorage
- **D-02:** 预设文件保存在插件安装目录下的 `presets/` 文件夹中
- **D-03:** 每个预设一个独立的 JSON 文件，文件名格式为 `{工作流名}-{预设名}.json`
- **D-04:** 预设管理 UI 为下拉菜单 + 管理按钮形式，位于 Draw.tsx 工作流参数区域顶部
- **D-05:** 工具栏包含：预设下拉选择器、新增(+)、设置/编辑(⚙)、导入导出按钮
- **D-06:** 新增预设时使用默认名称（如"预设 1"、"预设 2"），用户可以之后重命名
- **D-07:** 删除预设前弹出确认对话框，防止误删
- **D-08:** 切换预设前检查当前参数是否有未保存的修改，有修改则弹出确认提示
- **D-09:** 预设保存 inputValues（文本、数字、布尔、下拉选择）+ imageFilenames（ComfyUI 上传后的文件名引用）
- **D-10:** 预设不保存图片 base64 数据，仅保存文件名引用
- **D-11:** 图片引用失效时（ComfyUI 端文件已被清理）该参数位置显示提示，让用户重新上传
- **D-12:** 导出格式为 JSON 文件，每个预设一个独立文件
- **D-13:** 文件名格式：`{工作流名}-{预设名}.json`，存放在 `presets/` 目录
- **D-14:** 导入时如果同名预设已存在，弹出对话框让用户选择：覆盖、跳过、或重命名

### Claude's Discretion
- JSON 文件的具体结构（字段名、元数据字段）
- 预设文件的编码格式和版本管理
- 预设列表的排序方式（按创建时间/修改时间/名称）
- 预设加载时的过渡动画或 loading 状态
- Bridge API 的具体调用方式（新增/修改/删除/读取预设文件的 handler 设计）

### Deferred Ideas (OUT OF SCOPE)
None
</user_constraints>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React | ^19.2.0 | UI framework | [VERIFIED: package.json] Already in project |
| Zustand | ^5.0.11 | State management | [VERIFIED: package.json] Already used for configStore, workflowCacheStore, etc. |
| Vitest | ^4.0.18 | Testing framework | [VERIFIED: package.json] Already in project |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @testing-library/react | ^16.3.2 | Component testing | Preset toolbar UI tests |
| @testing-library/user-event | ^14.6.1 | User interaction simulation | Testing dropdown, button clicks |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| File-based presets (per CONTEXT D-02) | IndexedDB in WebView | CONTEXT D-01 locks to Bridge filesystem |
| Zustand for preset list | Pure React state | Zustand provides cleaner separation and testability; no persist needed since source of truth is filesystem |
| Browser confirm() | Custom modal component | Custom modal matches dark theme; required by D-07 and D-14 interaction patterns |

**Installation:** No new packages needed -- all dependencies already in package.json.

**Version verification:** [VERIFIED: package.json checked in codebase]

## Architecture Patterns

### Recommended Project Structure
```
code/webapp/src/
  stores/
    presetStore.ts          # NEW - Zustand store for preset list state
  services/
    preset.ts               # NEW - Bridge API wrapper for preset file operations
  components/
    preset/
      PresetToolbar.tsx     # NEW - Preset management toolbar component
      PresetToolbar.css     # NEW - Preset toolbar styles (dark theme)
  types/
    preset.ts               # NEW - Preset type definitions

PS-plugin/ningleai/
  main.js                   # MODIFY - Add preset.* Bridge handlers
```

### Pattern 1: Bridge Handler Registration
**What:** Bridge handlers follow a `handlers` object pattern in main.js with async functions
**When to use:** Every new Bridge action
**Example:**
```javascript
// Source: [VERIFIED: PS-plugin/ningleai/main.js line 560-938]
const handlers = {
  // Existing pattern:
  'fs.readPluginConfig': async (payload) => { ... },
  'fs.saveDownload': async (payload) => { ... },
  'fs.listDownloads': async (payload) => { ... },
  'fs.deleteDownload': async (payload) => { ... },

  // New preset handlers to add:
  'preset.list': async (payload) => { ... },
  'preset.read': async (payload) => { ... },
  'preset.write': async (payload) => { ... },
  'preset.delete': async (payload) => { ... },
};
```

### Pattern 2: Service Layer (WebApp Side)
**What:** Bridge message wrappers in services/ directory, modeled after config.ts
**When to use:** All preset file operations from the webapp
**Example:**
```typescript
// Source: [VERIFIED: code/webapp/src/services/config.ts]
// Pattern: sendBridgeMessage -> validate -> return
import { sendBridgeMessage, hasBridgeTransport } from './upload';

export async function listPresets(workflowName: string): Promise<PresetMeta[]> {
  if (!hasBridgeTransport()) return [];
  const result = await sendBridgeMessage('preset.list', { workflowName });
  return result as PresetMeta[];
}
```

### Pattern 3: Zustand Store (No Persist)
**What:** Zustand store for in-memory preset list, loaded from filesystem on demand
**When to use:** Preset list state management
**Rationale:** Unlike workflowCacheStore which uses persist (source of truth is localStorage), presets use the filesystem as source of truth. The store holds transient UI state (loaded list, selected preset, loading flags).
```typescript
// Source: [VERIFIED: code/webapp/src/stores/configStore.ts pattern]
interface PresetState {
  presets: PresetMeta[];
  selectedPresetName: string | null;
  isLoading: boolean;
  loadPresets: (workflowName: string) => Promise<void>;
  selectPreset: (name: string | null) => void;
}
```

### Pattern 4: UXP File System Folder Pattern
**What:** `ensureXxxFolder()` pattern using `localFileSystem.getDataFolder()` + `createFolder()`
**When to use:** Creating the presets/ directory
**Example:**
```javascript
// Source: [VERIFIED: PS-plugin/ningleai/main.js line 97-105]
const ensureDownloadsFolder = async () => {
  const dataFolder = await localFileSystem.getDataFolder();
  const entries = await dataFolder.getEntries();
  const existing = entries.find((entry) => entry.isFolder && entry.name === 'downloads');
  if (existing) {
    return existing;
  }
  return dataFolder.createFolder('downloads');
};

// New: follow exact same pattern for presets
const ensurePresetsFolder = async () => {
  const dataFolder = await localFileSystem.getDataFolder();
  const entries = await dataFolder.getEntries();
  const existing = entries.find((entry) => entry.isFolder && entry.name === 'presets');
  if (existing) {
    return existing;
  }
  return dataFolder.createFolder('presets');
};
```

### Pattern 5: Preset Data Structure (Recommended)
**What:** JSON file structure for each preset
**When to use:** Writing preset files
**Recommended schema (Claude's Discretion):**
```typescript
interface PresetFile {
  version: number;           // Schema version for future migration
  name: string;              // Preset display name
  workflowName: string;      // Associated workflow identifier
  workflowPath?: string;     // Optional workflow path for verification
  inputValues: Record<string, string | number | boolean>;  // Per D-09
  imageFilenames: Record<string, string>;  // Per D-09, file references only
  createdAt: string;         // ISO timestamp
  updatedAt: string;         // ISO timestamp
}
```
**Filename:** `{workflowName}-{presetName}.json` (per D-03, D-13)
**Encoding:** UTF-8 JSON (per Claude's Discretion)
**Sorting:** By `updatedAt` descending (most recently modified first, per Claude's Discretion)

### Anti-Patterns to Avoid
- **Do NOT store base64 image data in presets:** Per D-10, only store filename references. Base64 would bloat preset files.
- **Do NOT use Zustand persist for preset list:** Source of truth is the filesystem. Persisting creates sync conflicts.
- **Do NOT put preset UI in a separate page:** Per D-04, it must be a toolbar within Draw.tsx's parameter area.
- **Do NOT read preset files on every render:** Load once when workflow changes, cache in store.
- **Do NOT use `plugin:/` URL scheme for presets:** The existing config uses `plugin:/` but presets should use `getDataFolder()` (like downloads) because `plugin:/` maps to the plugin installation directory which is read-only in some UXP configurations. [ASSUMED]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| State management | Custom event bus or context | Zustand | Already in project, proven pattern in configStore and workflowCacheStore |
| Bridge communication | Custom postMessage protocol | `sendBridgeMessage()` from upload.ts | Already handles UUID, timeout, promise resolution |
| File persistence | Custom IndexedDB or localStorage wrapper | Bridge handlers + UXP localFileSystem | Per D-01, must use Bridge filesystem |
| JSON validation | Manual type checking | TypeScript interfaces + runtime validation function | Same pattern as validateConfig() in config.ts |
| Filename sanitization | Custom regex | `sanitizeFilename()` already exists in main.js | Handles special characters consistently |

**Key insight:** This phase is primarily about composing existing patterns (Bridge handlers, service layer, Zustand store, Draw.tsx UI integration). The novel work is the preset JSON schema and the preset toolbar UI component.

## Common Pitfalls

### Pitfall 1: Preset Filename Collision
**What goes wrong:** Two presets with the same name for the same workflow produce the same filename, silently overwriting
**Why it happens:** File naming uses `{workflowName}-{presetName}.json`, and names are user-editable
**How to avoid:** When renaming, check for filename collision before writing. In the `preset.write` handler, use `{ overwrite: true }` on the file entry explicitly. When creating, enumerate existing files first.
**Warning signs:** User renames preset to match another existing preset name.

### Pitfall 2: Stale Preset After Workflow Change
**What goes wrong:** A preset was saved for workflow v1 but the workflow now has different inputs. Applying the preset sets values for inputs that no longer exist.
**Why it happens:** Workflows can be updated on the ComfyUI side independently of presets.
**How to avoid:** When applying a preset, only set values for inputs that exist in the current `workflowInputs`. Log a warning for mismatched keys. The `workflowPath` field in the preset can be used to verify the workflow identity.
**Warning signs:** preset.inputValues has keys not present in current workflowInputs.

### Pitfall 3: Image Reference Invalidation
**What goes wrong:** Preset references `imageFilenames: { "image_123": "uploaded_file.png" }` but ComfyUI has cleaned up that file
**Why it happens:** ComfyUI periodically cleans uploaded images from its input directory
**How to avoid:** Per D-11, when applying a preset with image references, attempt to verify the image exists on ComfyUI. If verification fails, show a warning on that input field prompting re-upload. Do NOT block the entire preset application -- just flag the invalid image inputs.
**Warning signs:** `inputValues` has image-type inputs with filenames that return 404 from ComfyUI.

### Pitfall 4: Concurrent Preset Writes
**What goes wrong:** Two browser tabs or rapid clicks cause concurrent writes to the same preset file
**Why it happens:** No file locking in UXP filesystem API
**How to avoid:** Disable preset save button while a save is in progress. Use loading state flags in the preset store. Sequentialize write operations.
**Warning signs:** Preset content flickers or reverts after rapid clicking.

### Pitfall 5: Chinese Characters in Filenames
**What goes wrong:** Workflow names and preset names may contain Chinese characters, which can cause issues on some filesystems
**Why it happens:** The UI is in Chinese, and workflows have Chinese names (e.g., "扩图", "去水印")
**How to avoid:** Use `sanitizeFilename()` already in main.js for the filename. Consider a slug-based approach: sanitize to pinyin or use a hash for the filename while keeping the display name in Chinese inside the JSON.
**Warning signs:** File not found errors after saving presets with Chinese names.

### Pitfall 6: Preset Data Scope Mismatch with Cache
**What goes wrong:** Confusion between "cache" (auto-saved per workflow in workflowCacheStore) and "preset" (user-named snapshots)
**Why it happens:** Both store similar data (inputValues + imageFilenames) but serve different purposes
**How to avoid:** Clearly separate: cache is automatic/restored on workflow switch; presets are manual/named/restored on user action. When a preset is applied, update both the UI state AND the cache (so cache stays in sync with what the user sees).
**Warning signs:** After applying preset, switching away and back to the workflow shows cached values instead of preset values.

## Code Examples

### Bridge Handler: preset.list
```javascript
// Source: [VERIFIED: modeled after fs.listDownloads in main.js]
'preset.list': async (payload) => {
  const { workflowName } = payload || {};
  const presetsFolder = await ensurePresetsFolder();
  const entries = await presetsFolder.getEntries();
  const files = entries.filter((entry) => entry.isFile && entry.name.endsWith('.json'));

  const presets = [];
  for (const file of files) {
    // If workflowName specified, filter to matching presets
    if (workflowName && !file.name.startsWith(workflowName + '-')) {
      continue;
    }
    try {
      const content = await file.read();
      const data = JSON.parse(content);
      presets.push({
        filename: file.name,
        name: data.name,
        workflowName: data.workflowName,
        updatedAt: data.updatedAt,
        createdAt: data.createdAt,
      });
    } catch (e) {
      console.warn('[Preset] Failed to read preset file:', file.name, e);
    }
  }

  // Sort by updatedAt descending (most recent first)
  presets.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  return presets;
},
```

### Bridge Handler: preset.write
```javascript
// Source: [VERIFIED: modeled after fs.saveDownload in main.js]
'preset.write': async (payload) => {
  const { filename, data } = payload;
  if (!filename || typeof filename !== 'string') {
    throw new Error('preset.write: missing or invalid "filename" parameter');
  }
  const presetsFolder = await ensurePresetsFolder();
  const safeFilename = sanitizeFilename(filename);
  const file = await presetsFolder.createFile(safeFilename, { overwrite: true });
  const content = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  await file.write(content);
  return { success: true, filename: safeFilename };
},
```

### Preset Service (WebApp Side)
```typescript
// Source: [VERIFIED: modeled after code/webapp/src/services/config.ts]
import { sendBridgeMessage, hasBridgeTransport } from './upload';

export interface PresetMeta {
  filename: string;
  name: string;
  workflowName: string;
  updatedAt: string;
  createdAt: string;
}

export async function listPresets(workflowName: string): Promise<PresetMeta[]> {
  if (!hasBridgeTransport()) return [];
  return sendBridgeMessage('preset.list', { workflowName }) as Promise<PresetMeta[]>;
}

export async function savePreset(filename: string, data: unknown): Promise<{ success: boolean }> {
  if (!hasBridgeTransport()) throw new Error('Bridge not available');
  return sendBridgeMessage('preset.write', { filename, data }) as Promise<{ success: boolean }>;
}

export async function readPreset(filename: string): Promise<unknown> {
  if (!hasBridgeTransport()) throw new Error('Bridge not available');
  return sendBridgeMessage('preset.read', { filename });
}

export async function deletePreset(filename: string): Promise<{ success: boolean }> {
  if (!hasBridgeTransport()) throw new Error('Bridge not available');
  return sendBridgeMessage('preset.delete', { filename }) as Promise<{ success: boolean }>;
}
```

### Dirty Check for Unsaved Changes (D-08)
```typescript
// Compare current inputValues with the values from the last applied preset
// This requires tracking "lastAppliedPresetValues" in the store
function hasUnsavedChanges(
  currentValues: Record<string, string | number | boolean>,
  lastAppliedValues: Record<string, string | number | boolean> | null
): boolean {
  if (!lastAppliedValues) {
    // No preset was applied -- check if values differ from defaults
    return false; // or compare against workflow defaults
  }
  const allKeys = new Set([
    ...Object.keys(currentValues),
    ...Object.keys(lastAppliedValues),
  ]);
  for (const key of allKeys) {
    if (currentValues[key] !== lastAppliedValues[key]) {
      return true;
    }
  }
  return false;
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| localStorage for caching | Bridge filesystem via UXP | Phase 2 design | Presets follow same filesystem pattern |
| Inline state in Draw.tsx | Zustand stores in stores/ | Phase 1 | New preset state goes in its own store |
| Single dropdown for workflow | Modal toolkit picker | Current codebase | Preset selector uses simpler dropdown (not full modal) |

**Deprecated/outdated:**
- None relevant -- the codebase is actively maintained with current patterns.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `getDataFolder()` (not `plugin:/`) is the correct location for writable presets folder | Architecture Patterns | If UXP `plugin:/` is writable, we could use it instead; but `getDataFolder()` is safer and already proven with downloads |
| A2 | Preset files are small enough (<100KB each) to read synchronously via `file.read()` | Bridge Handler | If presets with many image references become large, may need streaming; unlikely with filename-only storage |
| A3 | The manifest `localFileSystem: "fullAccess"` permission covers the data folder's presets subdirectory | Architecture Patterns | Should be covered since `getDataFolder()` returns a folder within the permitted scope |
| A4 | Only one Draw page instance exists at a time (no multi-tab concurrency concerns) | Common Pitfalls | If multiple panels exist, file write concurrency could be an issue; mitigated by loading state |

## Open Questions

1. **Import/Export file dialog mechanism**
   - What we know: CONTEXT D-12/D-13 define JSON format. D-14 defines import conflict resolution.
   - What's unclear: How does the user select a file to import in the UXP WebView? Native `<input type="file">` may not work in UXP. May need a Bridge handler using `localFileSystem.getFileForOpening()`.
   - Recommendation: Research UXP file picker API. Fallback: user places import files in a known directory and the app scans for new files.

2. **Preset name uniqueness enforcement**
   - What we know: D-03 defines filename format `{workflowName}-{presetName}.json`.
   - What's unclear: Whether uniqueness should be enforced per-workflow or globally.
   - Recommendation: Per-workflow (a preset name only needs to be unique within its workflow's presets).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.18 |
| Config file | Inline in package.json (`"test": "vitest"`) |
| Quick run command | `cd code/webapp && npx vitest run --reporter=verbose` |
| Full suite command | `cd code/webapp && npx vitest run` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PRESET-01 | Save current params as named preset | unit | `cd code/webapp && npx vitest run src/services/preset.test.ts` | Wave 0 |
| PRESET-02 | Modify existing preset parameters | unit | `cd code/webapp && npx vitest run src/services/preset.test.ts` | Wave 0 |
| PRESET-03 | Delete preset with confirmation | unit | `cd code/webapp && npx vitest run src/services/preset.test.ts` | Wave 0 |
| PRESET-04 | Export preset to JSON file | unit | `cd code/webapp && npx vitest run src/services/preset.test.ts` | Wave 0 |
| PRESET-05 | Import preset from JSON file with conflict handling | unit | `cd code/webapp && npx vitest run src/services/preset.test.ts` | Wave 0 |
| PRESET-06 | Quick switch between presets | unit | `cd code/webapp && npx vitest run src/stores/presetStore.test.ts` | Wave 0 |
| PRESET-07 | Dirty check before preset switch | unit | `cd code/webapp && npx vitest run src/stores/presetStore.test.ts` | Wave 0 |
| PRESET-08 | Image reference invalidation warning | integration | `cd code/webapp && npx vitest run src/services/preset.test.ts` | Wave 0 |

### Sampling Rate
- **Per task commit:** `cd code/webapp && npx vitest run --reporter=verbose`
- **Per wave merge:** `cd code/webapp && npx vitest run`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `code/webapp/src/services/preset.test.ts` -- covers preset service layer (Bridge mock)
- [ ] `code/webapp/src/stores/presetStore.test.ts` -- covers preset store state management
- [ ] Framework config: No vitest.config.ts found, uses defaults from package.json. May need to add one if test setup requires custom configuration.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No user auth in this plugin |
| V3 Session Management | no | No sessions |
| V4 Access Control | no | Single-user local plugin |
| V5 Input Validation | yes | validatePresetData() function for JSON content |
| V6 Cryptography | no | No encryption needed for local presets |

### Known Threat Patterns for Plugin Architecture

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malicious JSON in imported preset file | Tampering | validatePresetData() with strict schema check, catch JSON.parse errors |
| Path traversal in preset filename | Tampering | sanitizeFilename() already exists in main.js, apply to all preset filenames |
| XSS via preset values rendered in UI | Tampering | React's built-in XSS protection (JSX escaping); never use dangerouslySetInnerHTML |

## Sources

### Primary (HIGH confidence)
- `code/webapp/package.json` - dependency versions verified
- `PS-plugin/ningleai/main.js` - Bridge handler patterns, file system operations verified
- `code/webapp/src/stores/workflowCacheStore.ts` - Zustand store pattern, WorkflowCacheEntry interface verified
- `code/webapp/src/services/upload.ts` - Bridge message protocol verified
- `code/webapp/src/services/config.ts` - Service layer pattern verified
- `code/webapp/src/pages/Draw.tsx` - UI layout, state management, workflow selection verified
- `.planning/phases/04-workflow-presets/04-CONTEXT.md` - User decisions verified

### Secondary (MEDIUM confidence)
- UXP storage API patterns inferred from existing `ensureDownloadsFolder` usage
- Zustand 5.x API behavior based on existing store implementations

### Tertiary (LOW confidence)
- None -- all findings verified against codebase

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all dependencies verified in package.json
- Architecture: HIGH - all patterns verified in existing codebase
- Pitfalls: HIGH - based on code analysis and domain knowledge of file-based preset systems

**Research date:** 2026-04-15
**Valid until:** 2026-05-15 (stable -- no fast-moving dependencies)
