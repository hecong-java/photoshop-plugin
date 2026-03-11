# Technology Stack

**Analysis Date:** 2026-03-11

## Languages

**Primary:**
- TypeScript 5.9.3 - Frontend webapp and MCP server development

**Secondary:**
- JavaScript (ES2022) - Photoshop UXP plugin runtime (main.js)

## Runtime

**Environment:**
- Node.js (for MCP server) - Version not specified in project
- Browser/WebView (for React app) - Runs in Vite dev server or embedded in Photoshop UXP

**Package Manager:**
- npm - Lockfile: `package-lock.json` (present)

## Frameworks

**Core:**
- React 19.2.0 - UI framework for webapp
- React Router DOM 7.13.1 - Client-side routing
- Vite 7.3.1 - Build tool and dev server

**Testing:**
- Vitest 4.0.18 - Unit testing framework
- Playwright 1.58.2 - E2E testing framework
- @testing-library/react 16.3.2 - React component testing
- @testing-library/jest-dom 6.9.1 - DOM matchers

**Build/Dev:**
- Vite 7.3.1 with @vitejs/plugin-react 5.1.1 - Development and production builds
- TypeScript 5.9.3 with typescript-eslint 8.48.0 - Type checking and linting

## Key Dependencies

**Critical:**
- zustand 5.0.11 - State management (persist middleware for localStorage)
- fflate 0.8.2 - ZIP file handling (for workflow/package management)
- react-dom 19.2.0 - React DOM rendering

**Infrastructure (MCP Server):**
- @modelcontextprotocol/sdk 1.27.0 - MCP protocol implementation
- ssh2 1.17.0 - SSH client library
- socks 2.8.7 - SOCKS proxy support

**Development:**
- eslint 9.39.1 with plugins - Code linting
- @types/node 24.10.1 - Node.js type definitions
- @types/react 19.2.7, @types/react-dom 19.2.3 - React type definitions

## Configuration

**Environment:**
- TypeScript strict mode enabled
- ES2022 target with ESNext modules
- React JSX transform enabled
- Zustand persist middleware stores settings in localStorage

**Build:**
- `tsconfig.json` - References app and node configs
- `tsconfig.app.json` - Frontend TypeScript config (ES2022, bundler resolution)
- `tsconfig.node.json` - Node.js tooling config
- `vite.config.ts` - Vite dev server configuration (port 5173, host 0.0.0.0)
- `eslint.config.js` - ESLint flat config with React hooks and refresh plugins
- `playwright.config.ts` - E2E test configuration (Chromium, Firefox, WebKit)

## Platform Requirements

**Development:**
- Node.js runtime for npm/Vite
- Modern browser for testing
- Photoshop 2023+ (version 24.1.0+) for UXP plugin testing

**Production:**
- Static file hosting for built webapp (Vite output)
- Photoshop with UXP support for plugin deployment
- ComfyUI server (separate deployment) for AI image generation

---

*Stack analysis: 2026-03-11*
