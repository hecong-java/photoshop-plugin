# Coding Conventions

**Analysis Date:** 2026-03-17

## Naming Patterns

**Files:**
- React components: PascalCase with `.tsx` extension (e.g., `ImageUpload.tsx`, `PSSettings.tsx`)
- Services/utilities: camelCase with `.ts` extension (e.g., `comfyui.ts`, `upload.ts`, `config.ts`)
- Hooks: camelCase with `use` prefix (e.g., `useDownload.ts`, `usePSBridge.ts`)
- Stores: camelCase with `Store` suffix (e.g., `configStore.ts`, `settingsStore.ts`)
- Types: camelCase (e.g., `config.ts` in `types/` directory)
- Test files: Same name as source with `.test.ts` or `.test.tsx` suffix (e.g., `comfyui.test.ts`, `configStore.test.ts`)

**Functions:**
- Regular functions: camelCase (e.g., `normalizeBaseUrl`, `validateConfig`, `sendBridgeMessage`)
- React components: PascalCase (e.g., `ImageUpload`, `PSSettings`, `DownloadManager`)
- Hook factories: camelCase with `use` prefix (e.g., `useDownload`, `useConfigStore`)
- Event handlers: `handle` prefix (e.g., `handleDragEnter`, `handleFileSelect`, `handleChange`)
- Async functions: descriptive verb phrases (e.g., `loadPluginConfig`, `probeEndpoints`, `fetchQueue`)

**Variables:**
- camelCase for local variables and parameters
- SCREAMING_SNAKE_CASE for constants (e.g., `DEFAULT_TIMEOUT_MS`, `OSS_PATHS`, `SKIPPED_NODE_TYPES`)
- Private class members: no special prefix, just TypeScript `private` keyword

**Types:**
- Interfaces: PascalCase with descriptive names (e.g., `ComfyUIClient`, `PluginConfig`, `ConfigNode`)
- Type aliases: PascalCase (e.g., `PrefixMode`, `EndpointStatus`, `Fetcher`)
- Union types: PascalCase (e.g., `PSImportMode = 'pixel' | 'smartObject'`)

## Code Style

**Formatting:**
- No explicit Prettier config detected
- TypeScript strict mode enabled in `tsconfig.app.json`
- ES2022 target with ESNext modules

**Linting:**
- ESLint 9.x with flat config (`eslint.config.js`)
- Extends: `js.configs.recommended`, `typescript-eslint.configs.recommended`
- Plugins: `eslint-plugin-react-hooks`, `eslint-plugin-react-refresh`
- Ignores: `dist/` directory

**Key TypeScript Settings:**
- `strict: true`
- `noUnusedLocals: true`
- `noUnusedParameters: true`
- `noFallthroughCasesInSwitch: true`
- `verbatimModuleSyntax: true`
- JSX: `react-jsx`

## Import Organization

**Order:**
1. React and framework imports
2. Third-party libraries (zustand, react-router-dom)
3. Local services and utilities (relative paths)
4. Local types
5. CSS files

**Pattern Examples:**
```typescript
// 1. React imports
import { useState, useEffect, useRef, useMemo } from 'react';
import type { PSImportMode } from '../../hooks/usePSBridge';

// 2. Third-party
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

// 3. Local services
import { ComfyUIClient, type ComfyUIWorkflowInfo } from '../services/comfyui';
import { uploadToComfyUI, isUXPWebView } from '../services/upload';

// 4. CSS
import './Draw.css';
```

**Path Aliases:**
- Not configured; all imports use relative paths
- Common pattern: `../../services/`, `../stores/`, `../types/`

## Error Handling

**Patterns:**
- Custom error types with discriminated unions (e.g., `ComfyUIError.type`)
- Type guard functions for error classification:
  ```typescript
  export const isComfyUIError = (error: unknown): error is ComfyUIError => {
    if (!error || typeof error !== 'object') return false;
    const record = error as Record<string, unknown>;
    return typeof record.type === 'string' && typeof record.message === 'string';
  };
  ```
- Error normalization utilities (e.g., `toStoreError`, `classifyFetchError`)
- Graceful fallbacks with default values (e.g., `DEFAULT_CONFIG`)
- Bridge transport errors use structured error objects with `code` and `message`

**Async Error Handling:**
- Try-catch with specific error types
- Console logging for debugging (`console.error('[Context]', ...)`)
- Error state in stores (e.g., `error: string | null`)

## Logging

**Framework:** Native `console` API

**Patterns:**
- Prefixed log messages with context in square brackets:
  ```typescript
  console.log('[Config] loadPluginConfig called');
  console.error('[Bridge] Rejected response:', response);
  console.warn('[Draw] Failed to inspect workflow:', error);
  ```
- Used extensively for debugging in services and stores
- Log levels: `log`, `warn`, `error`
- Structured data logging with `JSON.stringify` for complex objects

## Comments

**When to Comment:**
- File-level purpose comments (e.g., `// Bridge communication and upload service`)
- Complex logic explanations
- API response structure documentation
- Configuration descriptions

**JSDoc/TSDoc:**
- Limited usage
- Mostly inline comments for complex logic
- Type definitions serve as primary documentation

**Pattern:**
```typescript
// Configuration service for plugin node display settings

/**
 * Validate and sanitize a config object
 * - Ensures config is an object with nodes array
 * - Filters nodes to only entries with valid class_type (string)
 */
export function validateConfig(config: unknown): PluginConfig { ... }
```

## Function Design

**Size:** Functions vary in length; complex service functions can be 50-100 lines

**Parameters:**
- Options objects for multiple parameters
- Default values via destructuring
- Optional callback parameters (e.g., `onProgress?: (current: number, total: number) => void`)

**Return Values:**
- Async functions return `Promise<T>`
- Error handling returns either throws or returns default values
- Store actions return `void` or `Promise<void>`

**Pattern:**
```typescript
export async function uploadToComfyUI(
  file: File,
  comfyuiUrl = 'http://127.0.0.1:8188',
  prefixMode: 'api' | 'oss' = 'oss'
): Promise<string> { ... }
```

## Module Design

**Exports:**
- Named exports preferred over default exports for utilities
- Default exports for React components
- Re-export types for convenience:
  ```typescript
  export type { PluginConfig, ConfigNode } from '../types/config';
  ```

**Barrel Files:**
- Not used; direct imports from individual files

**Store Pattern (Zustand):**
```typescript
export const useConfigStore = create<ConfigState>()(
  persist(
    (set, get) => ({
      // State
      config: null,
      isLoading: false,

      // Actions
      loadConfig: async () => { ... },
      setConfig: (config) => set({ config }),
    }),
    { name: 'Ningleai-config' }
  )
);
```

## React Patterns

**Component Structure:**
- Functional components with hooks
- Props interfaces defined inline or at top of file
- Event handlers defined inside component body

**State Management:**
- Zustand stores for global state
- Local `useState` for component-local state
- `useCallback` for memoizing handler functions

**Pattern:**
```typescript
export const ImageUpload: React.FC<ImageUploadProps> = ({
  onImageUpload,
  onError,
  accept = 'image/png,image/jpeg,image/jpg,image/webp'
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleDragEnter = (e: React.DragEvent) => { ... };

  return ( ... );
};
```

---

*Convention analysis: 2026-03-17*
