# Codebase Structure

**Analysis Date:** 2026-03-11

## Directory Layout

```
D:/projects/photoshop-plugin/
├── .planning/                    # GSD planning documents
│   └── codebase/                 # Codebase analysis documents
├── PS-plugin/                    # Photoshop UXP plugin package
│   ├── ningleai/                 # Plugin contents
│   │   ├── icons/                # Plugin icons
│   │   ├── index.html            # Plugin panel HTML (WebView container)
│   │   ├── main.js               # UXP bridge script (Photoshop native ops)
│   │   └── manifest.json         # UXP plugin manifest
│   ├── install.bat               # Windows installation script
│   ├── ningleai_PS.ccx           # Compiled plugin package
│   └── 安装说明.txt              # Installation instructions (Chinese)
├── code/
│   └── webapp/                   # React SPA (loaded in WebView)
│       ├── src/                  # Source code
│       │   ├── assets/           # Static assets
│       │   ├── components/       # React components by feature
│       │   ├── hooks/            # Custom React hooks
│       │   ├── pages/            # Page components (routes)
│       │   ├── services/         # API clients and business logic
│       │   └── stores/           # Zustand state stores
│       ├── public/               # Public static files
│       ├── dist/                 # Build output
│       ├── e2e/                  # Playwright E2E tests
│       ├── node_modules/         # Dependencies
│       ├── mcp-servers/          # MCP server implementation (separate project)
│       ├── index.html            # Vite entry HTML
│       ├── vite.config.ts        # Vite configuration
│       ├── tsconfig.json         # TypeScript configuration
│       ├── package.json          # Dependencies and scripts
│       └── playwright.config.ts  # E2E test configuration
└── PS-plugin.zip                 # Plugin distribution archive
```

## Directory Purposes

**`PS-plugin/ningleai/`:**
- Purpose: Photoshop UXP plugin bundle loaded by Photoshop
- Contains: manifest.json (plugin metadata), index.html (WebView), main.js (bridge)
- Key files: `manifest.json`, `main.js`, `index.html`

**`code/webapp/src/components/`:**
- Purpose: Reusable UI components organized by feature
- Contains: React components with co-located CSS
- Subdirectories: `download/`, `history/`, `ps/`, `upload/`
- Key files: `upload/ImageUpload.tsx`, `download/DownloadManager.tsx`, `ps/PsExportButton.tsx`

**`code/webapp/src/services/`:**
- Purpose: External API clients and business logic services
- Contains: TypeScript modules for ComfyUI API, upload, download
- Key files: `comfyui.ts`, `upload.ts`, `download.ts`

**`code/webapp/src/stores/`:**
- Purpose: Global state management with Zustand
- Contains: Store definitions with actions and selectors
- Key files: `settingsStore.ts`, `historyStore.ts`, `comfyui.ts`

**`code/webapp/src/hooks/`:**
- Purpose: Custom React hooks for reusable logic
- Contains: Hooks for PS bridge, downloads
- Key files: `usePSBridge.ts`, `useDownload.ts`

**`code/webapp/src/pages/`:**
- Purpose: Top-level page components for routing
- Contains: Draw, History, Settings pages
- Key files: `Draw.tsx`, `History.tsx`, `Settings.tsx`

## Key File Locations

**Entry Points:**
- `code/webapp/src/main.tsx`: React application entry point
- `code/webapp/src/App.tsx`: Root component with routing
- `PS-plugin/ningleai/index.html`: Plugin panel entry
- `PS-plugin/ningleai/main.js`: UXP bridge script

**Configuration:**
- `code/webapp/vite.config.ts`: Vite build configuration
- `code/webapp/tsconfig.json`: TypeScript project configuration
- `code/webapp/package.json`: Dependencies and npm scripts
- `PS-plugin/ningleai/manifest.json`: UXP plugin manifest

**Core Logic:**
- `code/webapp/src/services/comfyui.ts`: ComfyUI API client (708 lines)
- `code/webapp/src/services/upload.ts`: Upload and bridge communication
- `code/webapp/src/services/download.ts`: Download management
- `PS-plugin/ningleai/main.js`: Photoshop native operations (839 lines)

**State Management:**
- `code/webapp/src/stores/settingsStore.ts`: User settings and ComfyUI connection
- `code/webapp/src/stores/historyStore.ts`: Generation history
- `code/webapp/src/stores/comfyui.ts`: Workflow and endpoint state

**Testing:**
- `code/webapp/src/services/comfyui.test.ts`: Unit tests for ComfyUI client
- `code/webapp/e2e/navigation.spec.ts`: E2E navigation tests

## Naming Conventions

**Files:**
- Components: PascalCase with `.tsx` extension (e.g., `ImageUpload.tsx`)
- Services: camelCase with `.ts` extension (e.g., `comfyui.ts`)
- Stores: camelCase with `Store.ts` suffix (e.g., `settingsStore.ts`)
- Hooks: camelCase with `use` prefix (e.g., `useDownload.ts`)
- CSS: Same name as component with `.css` extension (e.g., `ImageUpload.css`)

**Directories:**
- Feature directories: lowercase (e.g., `download/`, `upload/`, `ps/`)
- Top-level: lowercase (e.g., `components/`, `services/`, `stores/`)

**TypeScript Types:**
- Interfaces: PascalCase with `I` prefix optional (e.g., `DownloadProgress`, `BridgeMessage`)
- Type aliases: PascalCase (e.g., `PrefixMode`, `EndpointStatus`)

## Where to Add New Code

**New Feature:**
- Primary code: `code/webapp/src/components/[feature]/[FeatureName].tsx`
- Tests: `code/webapp/src/components/[feature]/[FeatureName].test.ts`
- Styles: `code/webapp/src/components/[feature]/[FeatureName].css`

**New Service/API Client:**
- Implementation: `code/webapp/src/services/[serviceName].ts`
- Tests: `code/webapp/src/services/[serviceName].test.ts`

**New State/Store:**
- Implementation: `code/webapp/src/stores/[storeName]Store.ts`

**New Page/Route:**
- Component: `code/webapp/src/pages/[PageName].tsx`
- Add route in: `code/webapp/src/App.tsx`

**New Bridge Action:**
- Handler: Add to `handlers` object in `PS-plugin/ningleai/main.js`
- Client function: Add to `code/webapp/src/services/upload.ts` or appropriate service
- Types: Add interface to `code/webapp/src/hooks/usePSBridge.ts` if PS-related

**New Workflow Directory:**
- Location: `code/workflows/[workflow-name]/`
- ComfyUI reads from: `ps-workflows/` directory on ComfyUI server

## Special Directories

**`code/webapp/dist/`:**
- Purpose: Production build output
- Generated: Yes (by `npm run build`)
- Committed: No (in .gitignore)

**`code/webapp/node_modules/`:**
- Purpose: NPM dependencies
- Generated: Yes (by `npm install`)
- Committed: No (in .gitignore)

**`code/webapp/mcp-servers/`:**
- Purpose: MCP (Model Context Protocol) server implementation
- Generated: No
- Committed: Yes (separate git repo embedded)
- Note: Separate Node.js project for AI tool integration

**`PS-plugin/ningleai/icons/`:**
- Purpose: Plugin panel icons for different themes
- Generated: No
- Committed: Yes

---

*Structure analysis: 2026-03-11*
