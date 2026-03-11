# Phase 1: Configuration System - Research

**Researched:** 2026-03-11
**Domain:** JSON configuration parsing, UXP file system, dynamic React component rendering, ComfyUI node filtering
**Confidence:** HIGH

## Summary

This phase implements a JSON-based configuration system that allows users to specify which ComfyUI node parameters should be displayed in the Photoshop plugin UI. The configuration file will be placed alongside the plugin installation, read via UXP Bridge's file system APIs, and used to filter which nodes from a workflow have their parameters rendered in the UI.

**Primary recommendation:** Use a JSON config file (`node-config.json`) in the plugin folder, read via UXP `localFileSystem` API through the existing Bridge pattern. Filter nodes by `class_type` during the workflow parsing phase in `Draw.tsx`, and create a dedicated configuration store in Zustand for managing the loaded config state.

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| CONF-01 | User can specify which nodes to display via JSON config | JSON schema design below; `class_type` array format |
| CONF-02 | Config file placed alongside plugin installation | UXP `plugin:/` URL scheme for read-only plugin folder access |
| CONF-03 | User specifies node names (class_type) in config | ComfyUI uses `class_type` as canonical node identifier; Draw.tsx already parses this |
| CONF-04 | Plugin dynamically renders node parameters based on config | Existing `WorkflowInput` interface and `inputGroups` rendering can be filtered |
| CONF-05 | Unconfigured nodes use workflow default values | Skip adding to `inputGroups`; default values remain in workflow JSON |
| INTG-01 | Config parsing integrates with existing ComfyUI client | Bridge handler `fs.readPluginConfig` to read; Zustand store to cache |

</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zustand | 5.0.11 | State management | Already used for settings/history stores |
| React | 19.2.0 | UI rendering | Existing framework |
| TypeScript | 5.9.3 | Type safety | Project standard |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| zustand/middleware (persist) | 5.0.11 | Optional config caching | If we want to cache parsed config in localStorage |

### New Files to Create
| File | Purpose |
|------|---------|
| `code/webapp/src/stores/configStore.ts` | Zustand store for configuration state |
| `code/webapp/src/services/config.ts` | Config loading and parsing service |
| `PS-plugin/ningleai/node-config.json` | User configuration file (template) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| JSON config file | YAML/TOML | JSON is native to JS, no parser needed; UXP file.read() returns string |
| Zustand store | React Context | Zustand already used; better persistence story |
| plugin:/ URL scheme | plugin-data:/ | plugin:/ is read-only alongside install; plugin-data:/ is for generated data |

**Installation:**
No new packages needed - all functionality uses existing dependencies.

## Architecture Patterns

### Recommended Project Structure
```
PS-plugin/ningleai/
├── node-config.json          # User configuration (NEW)
├── main.js                   # Add fs.readPluginConfig handler
├── manifest.json             # Already has localFileSystem: fullAccess
└── ...

code/webapp/src/
├── services/
│   ├── config.ts             # Config loading service (NEW)
│   ├── comfyui.ts            # Existing - no changes needed
│   └── upload.ts             # Existing - add config bridge call
├── stores/
│   ├── configStore.ts        # Config state (NEW)
│   ├── settingsStore.ts      # Existing
│   └── comfyui.ts            # Existing
└── pages/
    └── Draw.tsx              # Modify to filter inputs by config
```

### Pattern 1: Configuration File Schema
**What:** JSON file placed alongside plugin that specifies which nodes to display
**When to use:** Always - this is the core requirement
**Example:**
```json
{
  "$schema": "./node-config.schema.json",
  "version": "1.0",
  "nodes": [
    {
      "class_type": "KSampler",
      "inputs": ["seed", "steps", "cfg", "sampler_name", "scheduler"]
    },
    {
      "class_type": "CLIPTextEncode",
      "inputs": ["text"]
    },
    {
      "class_type": "LoadImage",
      "inputs": ["image"]
    },
    {
      "class_type": "EmptyLatentImage",
      "inputs": ["width", "height", "batch_size"]
    }
  ]
}
```

**Alternative simpler schema:**
```json
{
  "version": "1.0",
  "displayNodes": [
    "KSampler",
    "CLIPTextEncode",
    "LoadImage",
    "EmptyLatentImage"
  ]
}
```

### Pattern 2: Bridge Handler for Config Reading
**What:** UXP main.js handler to read config file from plugin folder
**When to use:** When WebView needs to read plugin-adjacent files
**Example:**
```javascript
// In PS-plugin/ningleai/main.js handlers object
'fs.readPluginConfig': async (payload) => {
  const { filename = 'node-config.json' } = payload || {};
  try {
    const { localFileSystem } = require('uxp').storage;

    // plugin:/ is read-only, points to plugin installation folder
    const configFile = await localFileSystem.getEntryWithUrl(`plugin:/${filename}`);

    if (!configFile || !configFile.isFile) {
      return { exists: false, data: null };
    }

    const content = await configFile.read();
    const config = JSON.parse(content);

    return { exists: true, data: config };
  } catch (error) {
    // File doesn't exist or parse error
    return {
      exists: false,
      data: null,
      error: error.message || 'Failed to read config'
    };
  }
},
```

**Source:** [Adobe UXP Filesystem Operations](https://developer.adobe.com/premiere-pro/uxp/resources/recipes/filesystem-operations/)

### Pattern 3: Config Store with Zustand
**What:** Zustand store to manage loaded configuration state
**When to use:** When components need access to config for filtering
**Example:**
```typescript
// code/webapp/src/stores/configStore.ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface NodeConfig {
  class_type: string;
  inputs?: string[]; // If undefined, show all inputs for this node
}

export interface PluginConfig {
  version: string;
  nodes: NodeConfig[];
}

interface ConfigState {
  config: PluginConfig | null;
  isLoading: boolean;
  error: string | null;
  loadedAt: string | null;

  // Computed helper
  shouldDisplayNode: (classType: string) => boolean;
  getAllowedInputs: (classType: string) => string[] | null;

  // Actions
  loadConfig: () => Promise<void>;
  setConfig: (config: PluginConfig | null) => void;
  clearError: () => void;
}

const DEFAULT_CONFIG: PluginConfig = {
  version: '1.0',
  nodes: [], // Empty = show all nodes (fallback behavior)
};

export const useConfigStore = create<ConfigState>()(
  persist(
    (set, get) => ({
      config: null,
      isLoading: false,
      error: null,
      loadedAt: null,

      shouldDisplayNode: (classType: string) => {
        const { config } = get();
        if (!config || config.nodes.length === 0) return true; // Show all if no config
        return config.nodes.some(n => n.class_type === classType);
      },

      getAllowedInputs: (classType: string) => {
        const { config } = get();
        if (!config || config.nodes.length === 0) return null; // All inputs allowed
        const nodeConfig = config.nodes.find(n => n.class_type === classType);
        return nodeConfig?.inputs ?? null; // null = all inputs, array = specific inputs
      },

      loadConfig: async () => {
        set({ isLoading: true, error: null });
        try {
          const { sendBridgeMessage, hasBridgeTransport } = await import('../services/upload');

          if (!hasBridgeTransport()) {
            // Browser dev mode - use default config
            set({ config: DEFAULT_CONFIG, isLoading: false, loadedAt: new Date().toISOString() });
            return;
          }

          const result = await sendBridgeMessage('fs.readPluginConfig', {
            filename: 'node-config.json'
          }) as { exists: boolean; data: PluginConfig | null; error?: string };

          if (result.exists && result.data) {
            set({
              config: result.data,
              isLoading: false,
              loadedAt: new Date().toISOString()
            });
          } else {
            // No config file - use default (show all)
            set({
              config: DEFAULT_CONFIG,
              isLoading: false,
              loadedAt: new Date().toISOString()
            });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to load config';
          set({ error: message, isLoading: false });
          // Fallback to showing all nodes
          set({ config: DEFAULT_CONFIG });
        }
      },

      setConfig: (config) => set({ config }),
      clearError: () => set({ error: null }),
    }),
    {
      name: 'Ningleai-config',
      partialize: (state) => ({
        config: state.config,
        loadedAt: state.loadedAt,
      }),
    }
  )
);
```

### Pattern 4: Filtering Inputs in Draw.tsx
**What:** Modify existing input parsing to filter based on config
**When to use:** When building the `sortedWorkflowInputs` array
**Example:**
```typescript
// In Draw.tsx, after parsing inputs but before rendering
import { useConfigStore } from '../stores/configStore';

// Inside the component:
const { shouldDisplayNode, getAllowedInputs } = useConfigStore();

// When building sortedWorkflowInputs, filter by config:
const filteredInputs = useMemo(() => {
  return sortedWorkflowInputs.filter(input => {
    const classType = input.classType;
    if (!classType) return true; // Show if no classType info

    if (!shouldDisplayNode(classType)) {
      return false; // Hide entire node
    }

    const allowedInputs = getAllowedInputs(classType);
    if (allowedInputs === null) {
      return true; // Show all inputs for this node
    }

    // Only show if input name is in allowed list
    return allowedInputs.includes(input.name);
  });
}, [sortedWorkflowInputs, shouldDisplayNode, getAllowedInputs]);
```

### Anti-Patterns to Avoid
- **Don't read config on every render:** Load once at startup, cache in Zustand store
- **Don't block UI while loading config:** Show all nodes initially, filter after config loads
- **Don't throw errors on missing config:** Fall back to showing all nodes gracefully
- **Don't hardcode node types:** Use config exclusively for filtering logic

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| File reading in WebView | Direct file access | Bridge + localFileSystem | WebView has no file access; Bridge proxies to UXP |
| Config schema validation | Custom validator | TypeScript interfaces + optional runtime check | Type safety sufficient for internal config |
| State persistence | Custom storage | Zustand persist middleware | Already used, battle-tested |

**Key insight:** The existing Bridge pattern is the correct abstraction. Extend it with a new handler rather than creating a new communication mechanism.

## Common Pitfalls

### Pitfall 1: Config File Not Found
**What goes wrong:** Plugin crashes or shows error when config file is missing
**Why it happens:** Developer assumes config always exists
**How to avoid:** Always return a valid default config; treat missing file as "show all nodes"
**Warning signs:** Error messages in console about JSON parsing; empty UI

### Pitfall 2: Invalid JSON in Config File
**What goes wrong:** JSON.parse throws, crashes plugin
**Why it happens:** User edits config manually and makes syntax error
**How to avoid:** Wrap JSON.parse in try-catch; return default config on parse error
**Warning signs:** SyntaxError in console; unexpected "show all" behavior

### Pitfall 3: Case Sensitivity in class_type
**What goes wrong:** "KSampler" in config doesn't match "ksampler" in workflow
**Why it happens:** ComfyUI node types are case-sensitive; users may not know
**How to avoid:** Document exact class_type names; consider case-insensitive matching with warning
**Warning signs:** Nodes not showing when expected

### Pitfall 4: Config Loaded After Initial Render
**What goes wrong:** UI renders with all nodes, then suddenly filters down
**Why it happens:** Async config load completes after initial render
**How to avoid:** Show loading state; or accept brief flash as acceptable UX
**Warning signs:** UI "jumping" after load

### Pitfall 5: Breaking Existing Workflow Behavior
**What goes wrong:** Workflows that worked before now fail to submit
**Why it happens:** Filtering UI inputs doesn't mean filtering workflow JSON
**How to avoid:** Config only affects UI display; workflow submission uses full workflow JSON with defaults
**Warning signs:** Missing parameters in submitted prompts

## Code Examples

### Config Loading Service
```typescript
// code/webapp/src/services/config.ts
import { sendBridgeMessage, hasBridgeTransport } from './upload';

export interface NodeConfigEntry {
  class_type: string;
  inputs?: string[];
}

export interface PluginConfig {
  version: string;
  nodes: NodeConfigEntry[];
}

const DEFAULT_CONFIG: PluginConfig = {
  version: '1.0',
  nodes: [],
};

export async function loadPluginConfig(): Promise<PluginConfig> {
  if (!hasBridgeTransport()) {
    console.log('[Config] No bridge transport, using default config');
    return DEFAULT_CONFIG;
  }

  try {
    const result = await sendBridgeMessage('fs.readPluginConfig', {
      filename: 'node-config.json'
    }) as { exists: boolean; data: PluginConfig | null; error?: string };

    if (result.exists && result.data) {
      console.log('[Config] Loaded config with', result.data.nodes?.length ?? 0, 'node entries');
      return validateConfig(result.data);
    }

    console.log('[Config] No config file found, using default');
    return DEFAULT_CONFIG;
  } catch (error) {
    console.error('[Config] Failed to load config:', error);
    return DEFAULT_CONFIG;
  }
}

function validateConfig(config: unknown): PluginConfig {
  if (!config || typeof config !== 'object') {
    return DEFAULT_CONFIG;
  }

  const c = config as Record<string, unknown>;

  if (!Array.isArray(c.nodes)) {
    return DEFAULT_CONFIG;
  }

  const nodes: NodeConfigEntry[] = c.nodes
    .filter((n): n is Record<string, unknown> => n && typeof n === 'object' && typeof n.class_type === 'string')
    .map(n => ({
      class_type: String(n.class_type),
      inputs: Array.isArray(n.inputs)
        ? n.inputs.filter((i): i is string => typeof i === 'string')
        : undefined,
    }));

  return {
    version: typeof c.version === 'string' ? c.version : '1.0',
    nodes,
  };
}
```

### Example Config File
```json
{
  "$comment": "ComfyUI Node Display Configuration for Photoshop Plugin",
  "version": "1.0",
  "nodes": [
    {
      "class_type": "KSampler",
      "inputs": ["seed", "steps", "cfg", "sampler_name", "scheduler", "denoise"]
    },
    {
      "class_type": "CLIPTextEncode",
      "inputs": ["text"]
    },
    {
      "class_type": "CLIPTextEncodePositive",
      "inputs": ["text"]
    },
    {
      "class_type": "CLIPTextEncodeNegative",
      "inputs": ["text"]
    },
    {
      "class_type": "LoadImage",
      "inputs": ["image"]
    },
    {
      "class_type": "EmptyLatentImage",
      "inputs": ["width", "height", "batch_size"]
    },
    {
      "class_type": "VAEDecode"
    },
    {
      "class_type": "SaveImage"
    }
  ]
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Hardcoded node types | JSON config file | This phase | Users customize without code changes |
| localStorage only | Bridge + localStorage | This phase | Config lives with plugin, survives browser data clear |

**Deprecated/outdated:**
- N/A (new feature)

## Open Questions

1. **Should config support regex patterns for class_type?**
   - What we know: Current design uses exact string matching
   - What's unclear: If users want to match "KSampler.*" patterns
   - Recommendation: Start with exact matching; add patterns if requested

2. **Should we validate config against known ComfyUI node types?**
   - What we know: ComfyUI has `/object_info` endpoint with all node types
   - What's unclear: If we should warn on unknown class_type values
   - Recommendation: Optional enhancement; log warning but don't block

3. **Should config reload be supported without plugin restart?**
   - What we know: Config loads at startup
   - What's unclear: If users want hot-reload during development
   - Recommendation: Add "Reload Config" button in Settings page (Phase 2)

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.18 |
| Config file | `vitest.config.ts` (not found, may use vite.config.ts defaults) |
| Quick run command | `npm test` or `npx vitest run` |
| Full suite command | `npx vitest run --coverage` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CONF-01 | JSON config specifies nodes to display | unit | `npx vitest run config.test.ts` | No - Wave 0 |
| CONF-02 | Config file read from plugin folder | integration | `npx vitest run config.test.ts` | No - Wave 0 |
| CONF-03 | class_type used for node identification | unit | `npx vitest run config.test.ts` | No - Wave 0 |
| CONF-04 | Dynamic render based on config | unit | `npx vitest run config.test.ts` | No - Wave 0 |
| CONF-05 | Unconfigured nodes use defaults | unit | `npx vitest run config.test.ts` | No - Wave 0 |
| INTG-01 | Config integrates with ComfyUI client | integration | `npx vitest run config.test.ts` | No - Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run related tests`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `code/webapp/src/services/config.test.ts` - unit tests for config loading
- [ ] `code/webapp/src/stores/configStore.test.ts` - unit tests for store behavior
- [ ] Mock bridge handler for testing - may need to add to test setup

## Sources

### Primary (HIGH confidence)
- [Adobe UXP Filesystem Operations](https://developer.adobe.com/premiere-pro/uxp/resources/recipes/filesystem-operations/) - localFileSystem API, URL schemes (plugin:/, plugin-data:/)
- Existing codebase: `Draw.tsx` - workflow input parsing patterns
- Existing codebase: `upload.ts` - Bridge communication patterns
- Existing codebase: `main.js` - Bridge handler patterns

### Secondary (MEDIUM confidence)
- [Zustand Persist Middleware](https://zustand.docs.pmnd.rs/reference/middlewares/persist) - Official docs for persist pattern
- [ComfyUI API Documentation](https://docs.comfy.org/custom-nodes/v3_migration) - Node schema and class_type usage

### Tertiary (LOW confidence)
- N/A - all critical info from primary sources

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Uses existing libraries already in project
- Architecture: HIGH - Extends existing patterns (Bridge, Zustand stores)
- Pitfalls: HIGH - Based on common patterns and existing codebase analysis

**Research date:** 2026-03-11
**Valid until:** 90 days (stable APIs, established patterns)
