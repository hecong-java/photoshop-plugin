# Testing Patterns

**Analysis Date:** 2026-03-11

## Test Framework

**Runner:**
- Vitest v4.0.18
- Config: Inline in `vite.config.ts` (no separate vitest.config)
- Test UI available: `@vitest/ui`

**Assertion Library:**
- Vitest built-in (`expect`, `describe`, `it`)
- `@testing-library/jest-dom` v6.9.1 for DOM matchers

**Run Commands:**
```bash
npm run test          # Run all unit tests with vitest
npm run test:e2e      # Run E2E tests with Playwright
npm run typecheck     # TypeScript check (no tests)
```

## Test File Organization

**Location:**
- Unit tests: Co-located with source files
- E2E tests: Separate `e2e/` directory at project root

**Naming:**
- Unit tests: `<filename>.test.ts` - e.g., `comfyui.test.ts`
- E2E tests: `<feature>.spec.ts` - e.g., `navigation.spec.ts`

**Structure:**
```
code/webapp/
├── src/
│   └── services/
│       ├── comfyui.ts
│       └── comfyui.test.ts    # Co-located unit test
├── e2e/
│   └── navigation.spec.ts     # E2E tests
└── playwright.config.ts
```

## Test Structure

**Suite Organization:**
```typescript
// From src/services/comfyui.test.ts
import { describe, expect, it } from 'vitest';
import { ComfyUIClient, normalizeBaseUrl, type Fetcher } from './comfyui';

describe('normalizeBaseUrl', () => {
  it('strips trailing slash and keeps protocol', () => {
    expect(normalizeBaseUrl('http://127.0.0.1:8188/')).toBe('http://127.0.0.1:8188');
  });
});

describe('ComfyUIClient', () => {
  it('falls back to /api prefix when /prompt is unavailable on OSS endpoints', async () => {
    // test implementation
  });
});
```

**Patterns:**
- `describe` blocks for grouping related tests
- `it` for individual test cases with descriptive names
- English descriptions (not Chinese) for test names
- Arrange-Act-Assert pattern within tests

## Mocking

**Framework:** Vitest built-in mocker (`@vitest/mocker`)

**Patterns:**
```typescript
// From src/services/comfyui.test.ts
// Mock fetcher for testing API client
const jsonResponse = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('ComfyUIClient', () => {
  it('tests API behavior', async () => {
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
});
```

**What to Mock:**
- Network requests (`fetch`, custom `Fetcher`)
- External dependencies
- Browser APIs when necessary

**What NOT to Mock:**
- Business logic being tested
- Data transformation functions
- Type guards and validators

## Fixtures and Factories

**Test Data:**
```typescript
// Helper functions create test data inline
const jsonResponse = (payload: unknown, status = 200): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
```

**Location:**
- No separate fixture files
- Test data created inline within tests or via helper functions

## Coverage

**Requirements:** None enforced

**View Coverage:**
```bash
npx vitest run --coverage
```

**Note:** Coverage not configured in current setup - would need `@vitest/coverage-v8` or similar

## Test Types

**Unit Tests:**
- Located: `src/**/*.test.ts`
- Scope: Individual functions, classes, and utilities
- Approach: Mock external dependencies, test in isolation
- Example: `src/services/comfyui.test.ts` tests `ComfyUIClient` class

**Integration Tests:**
- Not currently present
- Would test component interactions and store behavior

**E2E Tests:**
- Framework: Playwright v1.58.2
- Config: `playwright.config.ts`
- Browsers: Chromium, Firefox, WebKit
- Base URL: `http://localhost:5173`

```typescript
// From e2e/navigation.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Navigation', () => {
  test('should navigate to draw page', async ({ page }) => {
    await page.goto('/');
    await page.click('a:has-text("Draw")');
    await expect(page.locator('h1')).toContainText('Draw');
  });
});
```

## Common Patterns

**Async Testing:**
```typescript
// Async/await pattern
it('handles async operations', async () => {
  const result = await client.probeEndpoints();
  expect(result.prefixMode).toBe('api');
});
```

**Error Testing:**
```typescript
// Test that errors are thrown correctly
it('throws on invalid URL', () => {
  expect(() => normalizeBaseUrl('')).toThrow();
  expect(() => normalizeBaseUrl('invalid')).toThrow('must start with http');
});
```

**Testing Classes:**
```typescript
// Instantiate with test dependencies
const client = new ComfyUIClient({
  baseUrl: 'http://127.0.0.1:8188',
  fetcher: mockFetcher,
  timeoutMs: 1000,
});
```

## E2E Test Configuration

**Playwright Setup:**
```typescript
// From playwright.config.ts
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

**E2E Test Patterns:**
- Use `test.describe` for grouping
- Use semantic selectors when possible (`h1`, `a:has-text()`)
- Use `page.goto()` for navigation
- Use `expect(locator).toContainText()` for assertions

## Testing Library Setup

**Available:**
- `@testing-library/react` v16.3.2
- `@testing-library/user-event` v14.6.1
- `@testing-library/jest-dom` v6.9.1

**Note:** Testing Library is installed but no React component tests exist yet. When adding:

```typescript
// Example pattern for React component testing
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import '@testing-library/jest-dom';

import { MyComponent } from './MyComponent';

describe('MyComponent', () => {
  it('renders correctly', () => {
    render(<MyComponent />);
    expect(screen.getByText('Expected Text')).toBeInTheDocument();
  });

  it('handles click', async () => {
    const user = userEvent.setup();
    render(<MyComponent />);
    await user.click(screen.getByRole('button'));
    // assert state change
  });
});
```

## Test Coverage Gaps

**Untested Areas:**
- React components (no component tests exist)
- Custom hooks (`useDownload`, `usePSBridge`)
- Zustand stores (`settingsStore`, `historyStore`, `comfyUI` store)
- Services: `upload.ts`, `download.ts`
- Bridge communication logic

**Priority for New Tests:**
1. High: Services that interact with external APIs (`upload.ts`, `download.ts`)
2. Medium: Custom hooks with state management
3. Lower: Simple presentational components

---

*Testing analysis: 2026-03-11*
