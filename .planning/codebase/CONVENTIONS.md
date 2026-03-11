# Coding Conventions

**Analysis Date:** 2026-03-11

## Naming Patterns

**Files:**
- React components: PascalCase with `.tsx` extension - e.g., `ImageUpload.tsx`, `HistoryList.tsx`
- Services/utilities: camelCase with `.ts` extension - e.g., `comfyui.ts`, `upload.ts`, `download.ts`
- Hooks: camelCase with `use` prefix - e.g., `useDownload.ts`, `usePSBridge.ts`
- Stores: camelCase with `Store` suffix - e.g., `settingsStore.ts`, `historyStore.ts`
- Test files: `.test.ts` suffix co-located with source - e.g., `comfyui.test.ts`
- CSS files: Same name as component, `.css` extension - e.g., `ImageUpload.css`, `Settings.css`

**Functions:**
- Regular functions: camelCase - e.g., `normalizeBaseUrl`, `classifyFetchError`
- React components: PascalCase - e.g., `ImageUpload`, `HistoryList`
- Hooks: `use` prefix - e.g., `useDownload`, `usePSBridge`
- Event handlers: `handle` prefix - e.g., `handleDragEnter`, `handleFileSelect`
- Type guards: `is` prefix - e.g., `isComfyUIError`, `isValidImageFile`
- Utility functions: verbNoun pattern - e.g., `generateDownloadFilename`, `fileToBase64`

**Variables:**
- camelCase for all variables and properties
- UPPER_SNAKE_CASE for constants at module level - e.g., `DEFAULT_TIMEOUT_MS`, `LOCAL_DOWNLOADS_KEY`
- Private class members: no underscore prefix, just camelCase

**Types:**
- Interfaces: PascalCase with `I` optional (not enforced) - e.g., `HistoryItem`, `ComfyUICapabilities`
- Type aliases: PascalCase - e.g., `PrefixMode`, `EndpointStatus`
- Union types: PascalCase - e.g., `PSImportMode = 'pixel' | 'smartObject'`

## Code Style

**Formatting:**
- No Prettier configuration detected - relies on ESLint for formatting
- 2-space indentation (standard for JS/TS)
- Single quotes for strings in most files
- Semicolons used consistently
- Trailing commas in multi-line structures

**Linting:**
- ESLint v9 with flat config format (`eslint.config.js`)
- TypeScript ESLint parser and rules
- React Hooks rules enforced
- React Refresh plugin for Vite HMR
- Global ignores: `dist/` directory
- Target: ES2022, browser globals

**TypeScript Configuration:**
- Strict mode enabled (`strict: true`)
- No unused locals/parameters (`noUnusedLocals`, `noUnusedParameters`)
- No fallthrough cases in switch
- Target: ES2022
- Module: ESNext with bundler resolution
- JSX: react-jsx transform

## Import Organization

**Order:**
1. External packages (React, third-party libraries)
2. Internal services and utilities (relative paths with `../`)
3. CSS files (same-directory imports like `./Component.css`)

**Pattern from codebase:**
```typescript
import { useState, useEffect, useCallback } from 'react';
import { useSettingsStore } from '../stores/settingsStore';
import { ComfyUIClient, type ComfyUICapabilities } from '../services/comfyui';
import './Settings.css';
```

**Path Aliases:**
- Not configured - all imports use relative paths
- Common patterns: `../services/`, `../stores/`, `../hooks/`, `../../services/`

**Type Imports:**
- Use `type` keyword for type-only imports: `import { type ComfyUICapabilities } from '../services/comfyui'`

## Error Handling

**Patterns:**
- Custom error types with discriminators: `ComfyUIError` with `type` field
- Type guard functions: `isComfyUIError(error)` to narrow unknown errors
- Error classification functions: `classifyFetchError()` converts native errors to domain errors
- Try-catch with specific error handling in async operations

**Error Type Definition:**
```typescript
// From src/services/comfyui.ts
export interface ComfyUIError {
  type: ComfyUIErrorType;
  message: string;
  status?: number;
  endpoint?: string;
}

export const isComfyUIError = (error: unknown): error is ComfyUIError => {
  if (!error || typeof error !== 'object') return false;
  const record = error as Record<string, unknown>;
  return typeof record.type === 'string' && typeof record.message === 'string';
};
```

**Component Error Handling:**
```typescript
// From src/components/upload/ImageUpload.tsx
try {
  const filename = await uploadToComfyUI(file);
  setUploadedFilename(filename);
  onImageUpload?.(filename, file);
} catch (error) {
  const err = error instanceof Error ? error : new Error(String(error));
  setError(err.message);
  onError?.(err);
} finally {
  setIsUploading(false);
}
```

## Logging

**Framework:** console (native)

**Patterns:**
- Prefix log messages with module/context in brackets: `console.log('[ComfyUI] Using Bridge proxy...')`
- Use `console.error` for errors with context: `console.error('[Bridge] Rejected response:', response)`
- Chinese UI messages allowed (this is a Chinese-language application)

**When to Log:**
- Bridge communication events
- Service initialization and configuration changes
- Error conditions with full context
- State transitions in complex operations

## Comments

**When to Comment:**
- JSDoc for public API functions and interfaces
- Block comments for file-level documentation
- Inline comments for non-obvious logic or workarounds

**JSDoc/TSDoc:**
```typescript
// From src/services/download.ts
/**
 * Download image from ComfyUI and save to plugin local storage
 * @param imageUrl - ComfyUI /view URL
 * @param filename - Suggested filename
 * @param onProgress - Callback for progress updates
 * @returns Path where file was saved
 */
export async function downloadAndSaveImage(...)
```

**Chinese Comments:**
- Chinese comments are acceptable for domain-specific explanations
- Example: `// 在 UXP 环境中使用 Bridge 代理上传`

## Function Design

**Size:** Functions tend to be focused but can be longer for complex operations (e.g., `ComfyUIClient` methods)

**Parameters:**
- Use options objects for functions with 3+ parameters
- Destructure in function signature for clarity
- Provide default values where appropriate

**Return Values:**
- Async functions return Promises
- Complex returns use typed interfaces
- Error conditions throw or return error objects, not null

**Example:**
```typescript
// From src/services/comfyui.ts
constructor(options: {
  baseUrl: string;
  fetcher?: Fetcher;
  timeoutMs?: number;
  totalProbeTimeoutMs?: number;
}) { ... }
```

## Module Design

**Exports:**
- Named exports preferred over default exports
- Components use default export, utilities use named exports
- Types exported alongside implementations

**Barrel Files:**
- Not used - direct imports from source files
- No `index.ts` re-export files in component directories

**File Organization:**
- One primary export per file for components
- Multiple related exports allowed in service/utility files
- Types defined in same file as implementations

## React Patterns

**Component Structure:**
- Functional components with hooks
- Props interfaces defined above component
- Destructured props in function signature

**State Management:**
- Zustand for global state (stores in `src/stores/`)
- Local useState for component-specific state
- useCallback for stable function references

**Event Handling:**
```typescript
// Pattern: handler functions defined inside component
const handleProbeConnection = useCallback(async () => {
  setIsProbing(true);
  // ...
}, [comfyUI.baseUrl, setComfyUIConnected]);
```

**Store Pattern (Zustand):**
```typescript
// From src/stores/settingsStore.ts
export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      // state
      theme: 'dark',
      // actions
      setTheme: (theme) => set({ theme }),
    }),
    { name: 'Ningleai-settings' }
  )
);
```

---

*Convention analysis: 2026-03-11*
