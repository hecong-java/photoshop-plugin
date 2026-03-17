# Testing Patterns

**Analysis Date:** 2026-03-17

## Test Framework

**Runner:**
- Vitest 4.0.18
- Config: Inline in `package.json` scripts (no separate vitest.config)
- UI available via `@vitest/ui`

**Assertion Library:**
- Vitest built-in assertions (`expect`)
- `@testing-library/jest-dom` for DOM matchers

**Run Commands:**
```bash
npm run test              # Run all tests (vitest)
npm run test:e2e          # Run E2E tests (playwright test)
```

## Test File Organization

**Location:**
- Co-located with source files (e.g., `src/services/comfyui.test.ts` next to `src/services/comfyui.ts`)
- E2E tests in separate `e2e/` directory

**Naming:**
- Unit tests: `[source].test.ts` or `[source].test.tsx`
- E2E tests: `[feature].spec.ts`

**Structure:**
```
code/webapp/
├── src/
│   ├── services/
│   │   ├── comfyui.ts
│   │   ├── comfyui.test.ts
│   │   ├── config.ts
│   │   └── config.test.ts
│   └── stores/
│       ├── configStore.ts
│       └── configStore.test.ts
└── e2e/
    └── navigation.spec.ts
```

## Test Structure

**Suite Organization:**
```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

describe('loadPluginConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return DEFAULT_CONFIG when no bridge transport', async () => {
    vi.spyOn(upload, 'hasBridgeTransport').mockReturnValue(false);
    const result = await loadPluginConfig();
    expect(result).toEqual(DEFAULT_CONFIG);
  });
});
```

**Patterns:**
- `describe` blocks for grouping related tests
- `beforeEach` for setup and mock clearing
- `afterEach` for cleanup
- Nested `describe` for sub-features

## Mocking

**Framework:** Vitest built-in mocking (`vi`)

**Patterns:**
```typescript
// Module mocking
vi.mock('./upload', () => ({
  sendBridgeMessage: vi.fn(),
  hasBridgeTransport: vi.fn(),
}));

// Spy on specific functions
vi.spyOn(upload, 'hasBridgeTransport').mockReturnValue(false);
vi.spyOn(upload, 'sendBridgeMessage').mockResolvedValue({
  exists: true,
  data: { ... },
});

// Mock rejection
vi.spyOn(upload, 'sendBridgeMessage').mockRejectedValue(new Error('Bridge error'));

// Clear all mocks
beforeEach(() => {
  vi.clearAllMocks();
});
```

**What to Mock:**
- External dependencies (services, API calls)
- Bridge transport (`hasBridgeTransport`, `sendBridgeMessage`)
- Network requests (`fetch`)

**What NOT to Mock:**
- Pure utility functions being tested
- Data validation logic
- Type guards

**Custom Mock Implementations:**
```typescript
// For testing async state transitions
let resolveFn: (value: PluginConfig) => void;
vi.mocked(configService.loadPluginConfig).mockImplementation(
  () => new Promise<PluginConfig>((resolve) => {
    resolveFn = resolve;
  })
);
```

## Fixtures and Factories

**Test Data:**
```typescript
// Inline test data
const mockConfig = {
  version: '1.0',
  nodes: [{ class_type: 'KSampler' }],
};

// Helper functions for creating test data
const jsonResponse = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });

// Custom fetcher mock for ComfyUI client
const fetcher: Fetcher = async (input) => {
  const url = String(input);
  if (url.endsWith('/api/prompt')) {
    return jsonResponse({ prompt_id: 'ok' });
  }
  return jsonResponse({ ok: true });
};
```

**Location:**
- Inline within test files
- No separate fixture directory

**Store State Reset:**
```typescript
beforeEach(() => {
  // Reset store state between tests
  useConfigStore.setState({
    config: null,
    isLoading: false,
    error: null,
    loadedAt: null,
  });
});
```

## Coverage

**Requirements:** None enforced

**View Coverage:**
```bash
npm run test -- --coverage
```

## Test Types

**Unit Tests:**
- Scope: Individual functions, utilities, store actions
- Location: Co-located with source (`src/**/*.test.ts`)
- Examples:
  - `comfyui.test.ts` - API client, URL normalization, error handling
  - `config.test.ts` - Config loading, validation
  - `configStore.test.ts` - Zustand store actions

**Integration Tests:**
- Scope: Store interactions with services
- Pattern: Mock service layer, test store behavior

**E2E Tests:**
- Framework: Playwright 1.58.2
- Config: `playwright.config.ts`
- Browsers: Chromium, Firefox, WebKit
- Location: `e2e/*.spec.ts`

## E2E Test Configuration

**Config File:** `playwright.config.ts`

```typescript
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
});
```

## Common Patterns

**Async Testing:**
```typescript
it('should populate store from service', async () => {
  vi.mocked(configService.loadPluginConfig).mockResolvedValue(mockConfig);
  await useConfigStore.getState().loadConfig();
  const state = useConfigStore.getState();
  expect(state.config).toEqual(mockConfig);
});

// Testing loading state during async operation
it('should set isLoading to true during load', async () => {
  let resolveFn: (value: PluginConfig) => void;
  vi.mocked(configService.loadPluginConfig).mockImplementation(
    () => new Promise((resolve) => { resolveFn = resolve; })
  );
  const loadPromise = useConfigStore.getState().loadConfig();
  expect(useConfigStore.getState().isLoading).toBe(true);
  resolveFn!({ version: '1.0', nodes: [] });
  await loadPromise;
  expect(useConfigStore.getState().isLoading).toBe(false);
});
```

**Error Testing:**
```typescript
it('should return DEFAULT_CONFIG on bridge error', async () => {
  vi.spyOn(upload, 'hasBridgeTransport').mockReturnValue(true);
  vi.spyOn(upload, 'sendBridgeMessage').mockRejectedValue(new Error('Bridge error'));
  const result = await loadPluginConfig();
  expect(result).toEqual(DEFAULT_CONFIG);
});

it('should filter invalid node entries', () => {
  const input = {
    version: '1.0',
    nodes: [
      { class_type: 'ValidNode' },
      { class_type: '' }, // Empty - invalid
      { class_type: 123 }, // Non-string - invalid
      null, // Null - invalid
    ],
  };
  const result = validateConfig(input);
  expect(result.nodes).toHaveLength(1);
  expect(result.nodes[0].class_type).toBe('ValidNode');
});
```

**Testing with Mock Fetcher:**
```typescript
it('falls back to /api prefix when /prompt is unavailable', async () => {
  const fetcher: Fetcher = async (input) => {
    const url = String(input);
    if (url.endsWith('/api/prompt')) {
      return jsonResponse({ prompt_id: 'ok' });
    }
    if (url.endsWith('/prompt')) {
      return new Response(null, { status: 404 });
    }
    return jsonResponse({ ok: true });
  };

  const client = new ComfyUIClient({
    baseUrl: 'http://127.0.0.1:8188',
    fetcher,
    timeoutMs: 1000,
    totalProbeTimeoutMs: 5000,
  });

  const capabilities = await client.probeEndpoints();
  expect(capabilities.prefixMode).toBe('api');
});
```

**Playwright E2E Pattern:**
```typescript
import { test, expect } from '@playwright/test';

test.describe('Navigation', () => {
  test('should navigate to draw page', async ({ page }) => {
    await page.goto('/');
    await page.click('a:has-text("Draw")');
    await expect(page.locator('h1')).toContainText('Draw');
  });
});
```

## Test Coverage Gaps

**Untested Areas:**
- React components (no component tests found)
- Hooks (no hook tests found)
- Download service
- Upload service
- Workflow execution flow

**Priority for Adding Tests:**
1. Core business logic in services
2. Store state management
3. React component rendering
4. Hook behavior

---

*Testing analysis: 2026-03-17*
