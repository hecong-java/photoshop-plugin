# Technology Stack

**Analysis Date:** 2026-03-17

## Languages

**Primary:**
- TypeScript 5.9.x - Main application code in `code/webapp/src/`
- JavaScript (ES2022) - Photoshop UXP plugin code in `PS-plugin/ningleai/main.js`

**Secondary:**
- JSON - Configuration files, workflow definitions, manifest

## Runtime

**Environment:**
- Node.js (for build tooling)
- Browser (Chrome-based UXP WebView for Photoshop plugin runtime)

**Package Manager:**
- npm
- Lockfile: present (`package-lock.json`)

## Frameworks

**Core:**
- React 19.2.x - UI framework for webapp
- React Router DOM 7.13.x - Client-side routing

**State Management:**
- Zustand 5.0.x - Lightweight state management with persistence middleware

**Build/Dev:**
- Vite 7.3.x - Build tool and dev server
- TypeScript 5.9.x - Type checking and compilation

**Testing:**
- Vitest 4.0.x - Unit test runner
- Playwright 1.58.x - E2E testing
- Testing Library (React 16.3.x, Jest DOM 6.9.x, User Event 14.6.x)

**Linting:**
- ESLint 9.39.x with typescript-eslint 8.48.x
- eslint-plugin-react-hooks 7.0.x
- eslint-plugin-react-refresh 0.4.x

## Key Dependencies

**Critical:**
- `fflate` 0.8.x - ZIP compression for batch downloads (`code/webapp/src/services/download.ts`)
- `zustand` 5.0.x - State management across stores (`code/webapp/src/stores/`)

**Photoshop UXP APIs (plugin side):**
- `photoshop` module (`core`, `action`, `app`) - Photoshop automation
- `uxp.storage` module (`localFileSystem`, `formats`) - File system access
- `uxp.shell` module - System shell integration

## Configuration

**Environment:**
- No `.env` files detected
- Settings stored in localStorage via Zustand persist middleware
- ComfyUI base URL configured dynamically in UI (default: `http://192.168.0.50:8188`)

**Build:**
- `tsconfig.json` - References `tsconfig.app.json` and `tsconfig.node.json`
- `tsconfig.app.json` - ES2022 target, bundler module resolution, strict mode
- `vite.config.ts` - Dev server on port 5173, host 0.0.0.0
- `eslint.config.js` - Flat config with TypeScript and React rules
- `playwright.config.ts` - E2E test configuration for Chromium, Firefox, WebKit

**Plugin Manifest:**
- `PS-plugin/ningleai/manifest.json` - UXP plugin manifest v5
- Requires Photoshop 24.1.0+
- Permissions: network (all domains), webview, localFileSystem (fullAccess), clipboard

## Platform Requirements

**Development:**
- Node.js 18+ (for Vite 7.x and modern tooling)
- npm

**Production:**
- Adobe Photoshop 2023+ (version 24.1.0+)
- ComfyUI server accessible via HTTP (user-configured URL)

---

*Stack analysis: 2026-03-17*
