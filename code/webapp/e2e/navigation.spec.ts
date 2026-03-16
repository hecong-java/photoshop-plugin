import { test, expect } from '@playwright/test';

test.describe('Navigation', () => {
  test('should navigate to draw page', async ({ page }) => {
    await page.goto('/');
    await page.click('a:has-text("Draw")');
    await expect(page.locator('h1')).toContainText('Draw');
  });

  test('should navigate to history page', async ({ page }) => {
    await page.goto('/');
    await page.click('a:has-text("History")');
    await expect(page.locator('h1')).toContainText('History');
  });

  test('should navigate to settings page', async ({ page }) => {
    await page.goto('/');
    await page.click('a:has-text("Settings")');
    await expect(page.locator('h1')).toContainText('Settings');
  });
});
