import { test, expect } from '@playwright/test';

// Define window interface for test environment
interface TestWindow extends Window {
  __TILTVAULT_HTML_LOADED__?: boolean;
  React?: unknown;
  __TILTVAULT_MAIN_LOADED__?: boolean;
}

test('App should render without errors', async ({ page }) => {
  // Navigate to the app
  await page.goto('/');
  
  // Wait for the app to load (check for React root or main content)
  await page.waitForLoadState('networkidle');
  
  // Check that the HTML script executed
  const htmlScriptExecuted = await page.evaluate(() => {
    return !!(window as TestWindow).__TILTVAULT_HTML_LOADED__;
  });
  expect(htmlScriptExecuted).toBe(true);
  
  // Check that React loaded
  const reactLoaded = await page.evaluate(() => {
    return !!(window as TestWindow).React;
  });
  expect(reactLoaded).toBe(true);
  
  // Check that the loading screen is hidden (app rendered)
  const loadingScreenHidden = await page.evaluate(() => {
    return document.body.classList.contains('tv-app-loaded');
  });
  expect(loadingScreenHidden).toBe(true);
  
  // Check that there's actual content (not just loading screen)
  const hasContent = await page.evaluate(() => {
    const root = document.getElementById('root');
    if (!root) return false;
    const initialShell = root.querySelector('.tv-initial-shell');
    // Initial shell should be hidden if app loaded
    if (initialShell && window.getComputedStyle(initialShell).display !== 'none') {
      return false;
    }
    // Should have some React content
    return root.children.length > 0;
  });
  expect(hasContent).toBe(true);
  
  // Check for console errors
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });
  
  // Wait a bit for any errors to appear
  await page.waitForTimeout(2000);
  
  // Filter out known non-critical errors (MetaMask, Privy, etc.)
  const criticalErrors = errors.filter(err => 
    !err.includes('MetaMask') && 
    !err.includes('lockdown') &&
    !err.includes('SES') &&
    !err.includes('Content-Security-Policy') &&
    !err.includes('preload') &&
    !err.includes('post message') &&
    !err.includes('auth.privy.io') &&
    !err.includes('Recipient has origin')
  );
  
  if (criticalErrors.length > 0) {
    console.error('Critical errors found:', criticalErrors);
  }
  
  // Should have no critical errors
  expect(criticalErrors.length).toBe(0);
});

test('App should show loading screen initially then render', async ({ page }) => {
  await page.goto('/');
  
  // Initially should have loading screen
  const initialLoading = await page.locator('.tv-initial-loading').first();
  await expect(initialLoading).toBeVisible({ timeout: 1000 });
  
  // Wait for app to load - check for React content or loading screen hidden
  await page.waitForFunction(() => {
    const bodyHasLoaded = document.body.classList.contains('tv-app-loaded');
    const hasReact = !!(window as TestWindow).React;
    const rootHasContent = (document.getElementById('root')?.children.length ?? 0) > 0;
    return bodyHasLoaded || (hasReact && rootHasContent);
  }, { timeout: 15000 });
  
  // Loading screen should be hidden
  const loadingHidden = await page.evaluate(() => {
    const shell = document.querySelector('.tv-initial-shell');
    return shell ? window.getComputedStyle(shell).display === 'none' : true;
  });
  expect(loadingHidden).toBe(true);
});

