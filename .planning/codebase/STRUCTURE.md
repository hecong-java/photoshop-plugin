# Codebase Structure

**Analysis Date:** 2026-03-17

## Directory Layout

```
D:/projects/photoshop-plugin/
├── .claude/                    # Claude AI configuration
├── .git/                       # Git repository
├── .planning/                  # Planning documents (phases, codebase analysis)
│   ├── codebase/               # Generated codebase documentation
│   ├── phases/                 # Implementation phase plans
│   └── quick/                  # Quick fix plans
├── PS-plugin/                  # Photoshop UXP Plugin distribution
│   ├── ningleai/               # Plugin source files
│   │   ├── icons/              # Plugin icons (logo@1x.png, logo@2x.png)
│   │   ├── index.html          # Plugin panel HTML with webview
│   │   ├── main.js             # UXP bridge script (PS operations, network proxy)
│   │   ├── manifest.json       # UXP plugin manifest (permissions, entrypoints)
│   │   └── node-config.json    # Plugin configuration (node display settings)
│   ├── ningleai_PS.ccx         # Packaged plugin file
│   ├── install.bat             # Windows installation script
│   └── uninstall.bat           # Windows uninstallation script
├── code/
│   ├── webapp/                 # React web application
│   │   ├── src/                # Source code
│   │   ├── dist/               # Build output
│   │   ├── public/             # Static assets
│   │   ├── e2e/                # Playwright E2E tests
│   │   ├── mcp-servers/        # MCP server implementation (SSH remote)
│   │   ├── node_modules/       # Dependencies
│   │   └── package.json        # NPM configuration
│   └── workflows/              # ComfyUI workflow JSON files
│       ├── 生成与风格/          # Generation workflows
│       ├── 增强与编辑/          # Enhancement workflows
│       └── 操作与变换/          # Transformation workflows
├── docs/                       # Documentation
└── PS-plugin-*.zip             # Release archives
```

## Directory Purposes

### `PS-plugin/ningleai/`
- Purpose: UXP plugin source files loaded by Photoshop
- Contains: HTML entry, bridge script, manifest, icons, config
- Key files: `main.js` (931 lines - all bridge handlers), `manifest.json` (permissions)

### `code/webapp/src/`
- Purpose: React application source code
- Contains: Components, pages, stores, services, hooks, types
- Key files: `App.tsx`, `main.tsx`, `pages/Draw.tsx`

### `code/webapp/src/components/`
- Purpose: Reusable React components
- Contains: Feature-specific component directories
- Subdirectories:
  - `download/` - Download manager components
  - `history/` - History list and item components
  - `ps/` - Photoshop-specific components (PSImportButton, PSSettings)
  - `upload/` - Image upload and PS export components

### `code/webapp/src/pages/`
- Purpose: Top-level page components (route targets)
- Contains: Draw, History, Settings pages
- Key files: `Draw.tsx` (~600+ lines - main workflow UI)

### `code/webapp/src/stores/`
- Purpose: Zustand state management stores
- Contains: Global state with localStorage persistence
- Key files:
  - `settingsStore.ts` - ComfyUI connection settings
  - `configStore.ts` - Plugin node display configuration
  - `comfyui.ts` - ComfyUI client state (workflows, queue)
  - `historyStore.ts` - Generation history
  - `workflowCacheStore.ts` - Input value caching

### `code/webapp/src/services/`
- Purpose: API clients and business logic services
- Contains: External service integrations
- Key files:
  - `comfyui.ts` - ComfyUI REST API client (~760 lines)
  - `upload.ts` - Bridge communication and file upload
  - `config.ts` - Plugin configuration loader
  - `download.ts` - ZIP download and file manager

### `code/webapp/src/hooks/`
- Purpose: Custom React hooks
- Contains: Bridge communication hooks
- Key files: `usePSBridge.ts`, `useDownload.ts`

### `code/webapp/src/types/`
- Purpose: TypeScript type definitions
- Contains: Shared interfaces
- Key files: `config.ts` (PluginConfig, ConfigNode)

### `code/workflows/`
- Purpose: ComfyUI workflow definitions
- Contains: JSON files organized by category (Chinese directory names)
- Categories:
  - `生成与风格/` - Image generation (Nano Banana, Seedream, outpainting)
  - `增强与编辑/` - Enhancement (4K upscale, watermark removal, product retouch)
  - `操作与变换/` - Operations (single/dual image edit, object removal)

## Key File Locations

### Entry Points
- `PS-plugin/ningleai/index.html`: Plugin panel HTML entry
- `PS-plugin/ningleai/main.js`: UXP bridge script (all PS operations)
- `code/webapp/src/main.tsx`: React app entry point
- `code/webapp/src/App.tsx`: Root component with router

### Configuration
- `PS-plugin/ningleai/manifest.json`: UXP plugin manifest (permissions, panel config)
- `PS-plugin/ningleai/node-config.json`: Node display configuration
- `code/webapp/package.json`: NPM dependencies and scripts
- `code/webapp/vite.config.ts`: Vite build configuration
- `code/webapp/tsconfig.json`: TypeScript configuration

### Core Logic
- `code/webapp/src/services/comfyui.ts`: ComfyUI API client class
- `code/webapp/src/services/upload.ts`: Bridge message protocol
- `code/webapp/src/stores/settingsStore.ts`: Persistent settings
- `code/webapp/src/pages/Draw.tsx`: Main workflow execution UI

### Testing
- `code/webapp/src/**/*.test.ts`: Unit tests (co-located with source)
- `code/webapp/e2e/*.spec.ts`: Playwright E2E tests
- `code/webapp/playwright.config.ts`: E2E test configuration

## Naming Conventions

### Files
- React components: PascalCase with `.tsx` extension (e.g., `ImageUpload.tsx`)
- Services/utilities: camelCase with `.ts` extension (e.g., `comfyui.ts`)
- Stores: camelCase with `Store` suffix (e.g., `settingsStore.ts`)
- Tests: Same as source with `.test.ts` suffix (e.g., `comfyui.test.ts`)
- Styles: Same as component with `.css` suffix (e.g., `Draw.css`)

### Directories
- Component directories: lowercase (e.g., `upload/`, `history/`)
- Page directories: flat structure in `pages/`
- Store directories: flat structure in `stores/`
- Workflow categories: Chinese names (e.g., `生成与风格/`)

### Code
- Components: PascalCase (e.g., `PsExportButton`)
- Hooks: camelCase with `use` prefix (e.g., `usePSBridge`)
- Stores: camelCase with `use...Store` pattern (e.g., `useSettingsStore`)
- Services: PascalCase classes (e.g., `ComfyUIClient`), camelCase functions

## Where to Add New Code

### New Feature (UI + Logic)
- Primary code: `code/webapp/src/pages/` for page, `code/webapp/src/components/` for reusable components
- State: `code/webapp/src/stores/` if global state needed
- API: `code/webapp/src/services/` for external integrations
- Tests: `code/webapp/src/__tests__/` or co-located `.test.ts`

### New Bridge Handler
- Implementation: `PS-plugin/ningleai/main.js` - add to `handlers` object
- WebApp interface: `code/webapp/src/services/upload.ts` - add helper function
- Types: `code/webapp/src/hooks/usePSBridge.ts` if React hook needed

### New Workflow
- JSON file: `code/workflows/<category>/<workflow-name>.json`
- No code changes needed - workflows loaded dynamically from ComfyUI

### New Component
- Reusable: `code/webapp/src/components/<feature>/<ComponentName>.tsx`
- Styles: `code/webapp/src/components/<feature>/<ComponentName>.css`
- Page-specific: Inline in page file or `code/webapp/src/pages/` directory

### Utility Functions
- Shared helpers: `code/webapp/src/services/` for API-related
- Type definitions: `code/webapp/src/types/`

## Special Directories

### `.planning/`
- Purpose: GSD planning system documents
- Generated: Yes (by GSD commands)
- Committed: Yes (tracks planning history)

### `code/webapp/dist/`
- Purpose: Production build output
- Generated: Yes (by `npm run build`)
- Committed: No (build artifact)

### `code/webapp/node_modules/`
- Purpose: NPM dependencies
- Generated: Yes (by `npm install`)
- Committed: No (in .gitignore)

### `code/webapp/mcp-servers/`
- Purpose: MCP server for remote operations
- Generated: No
- Committed: Yes (submodule or separate project)

---

*Structure analysis: 2026-03-17*
