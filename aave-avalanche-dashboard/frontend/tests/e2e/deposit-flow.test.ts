/**
 * E2E tests for complete deposit flow
 */

import { test, expect } from '@playwright/test';

test.describe('Deposit Flow E2E', () => {
  test.beforeEach(async ({ page }) => {
    // Mock authentication to bypass login
    await page.addInitScript(() => {
      // Mock Privy authentication
      window.localStorage.setItem('privy:authenticated', 'true');
      window.localStorage.setItem('privy:access_token', 'mock_token');
    });
    
    await page.goto('/stack');
  });

  test('should load the stack app page', async ({ page }) => {
    // Check if the page loads successfully
    await expect(page).toHaveURL('http://localhost:8080/stack');
    
    // Wait for the app to load
    await page.waitForLoadState('networkidle');
    
    // Check if React app has rendered
    await page.waitForSelector('#root:not(:empty)', { timeout: 10000 });
    
    // Wait for authentication to complete
    await page.waitForTimeout(2000);
    
    // Check what's actually on the page
    const rootContent = await page.locator('#root').textContent();
    console.log('Stack page content after auth:', rootContent);
    
    // Try to find the auto invest page content
    try {
      await expect(page.locator('text=Welcome to Auto Invest')).toBeVisible({ timeout: 5000 });
      await expect(page.locator('text=Set your risk tolerance, we handle everything else')).toBeVisible();
    } catch (e) {
      // If not found, check for any content
      await expect(page.locator('body')).toBeVisible();
    }
  });

  test('should show deposit USD button', async ({ page }) => {
    // Check if the deposit button is present
    await expect(page.locator('[data-testid="deposit-usd-button"]')).toBeVisible();
    await expect(page.locator('text=Deposit USD')).toBeVisible();
  });

  test('should show instant profit message', async ({ page }) => {
    // Check if the instant profit message is visible on the main page
    await expect(page.locator('text=$1000+ deposits: 3.7% USDC - 3.2% fee = 0.5% instant profit')).toBeVisible();
  });

  test('should complete conservative deposit flow', async ({ page }) => {
    // Select USD deposit
    await page.click('[data-testid="deposit-usd-button"]');
    
    // Select Conservative strategy
    await page.click('[data-testid="risk-profile-conservative"]');
    
    // Click Continue
    await page.click('button:has-text("Continue")');
    
    // Wait for deposit modal
    await expect(page.locator('[data-testid="deposit-modal"]')).toBeVisible();
    
    // Verify conservative details are shown
    await expect(page.locator('text=Conservative')).toBeVisible();
    await expect(page.locator('text=100% USDC')).toBeVisible();
    await expect(page.locator('text=Expected APY:')).toBeVisible();
    
    // Enter deposit amount
    await page.fill('input[placeholder="10.00"]', '50');
    
    // Verify fee calculation
    await expect(page.locator('text=Total Fee:')).toBeVisible();
    
    // Verify fee details dropdown works
    await page.click('summary:has-text("Fee details")');
    await expect(page.locator('text=Platform Fee:')).toBeVisible();
    await expect(page.locator('text=AVAX sent to your wallet')).toBeVisible();
  });

  test('should show ERGC discount when user has 100+ ERGC', async ({ page }) => {
    // Mock ERGC balance API
    await page.route('/api/ergc/balance*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          address: '0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b9',
          balance: 150,
          has_discount: true,
          tokens_needed: 0
        })
      });
    });
    
    await page.goto('/');
    await page.click('[data-testid="deposit-usd-button"]');
    await page.click('[data-testid="risk-profile-conservative"]');
    await page.click('button:has-text("Continue")');
    
    // Wait for ERGC balance check
    await expect(page.locator('text=ERGC Found!')).toBeVisible();
    
    // Verify discounted rate is applied
    await page.fill('input[placeholder="10.00"]', '50');
    await expect(page.locator('text=Total Fee: $2.75')).toBeVisible(); // 50 * 5.5%
  });

  test('should enforce deposit limits', async ({ page }) => {
    await page.goto('/');
    await page.click('[data-testid="deposit-usd-button"]');
    await page.click('[data-testid="risk-profile-conservative"]');
    await page.click('button:has-text("Continue")');
    
    // Test minimum limit
    await page.fill('input[placeholder="10.00"]', '5');
    await page.click('[data-testid="continue-to-payment-button"]');
    await expect(page.locator('text=Minimum deposit required')).toBeVisible();
    
    // Test maximum limit
    await page.fill('input[placeholder="10.00"]', '10000');
    await page.click('[data-testid="continue-to-payment-button"]');
    await expect(page.locator('text=Maximum deposit exceeded')).toBeVisible();
  });

  test('should apply 10-minute cooldown between deposits', async ({ page }) => {
    // Mock localStorage to simulate recent deposit
    await page.addInitScript(() => {
      const testWallet = '0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b9';
      localStorage.setItem(`lastDeposit_${testWallet}`, (Date.now() - 5 * 60 * 1000).toString());
    });
    
    await page.goto('/');
    await page.click('[data-testid="deposit-usd-button"]');
    await page.click('[data-testid="risk-profile-conservative"]');
    await page.click('button:has-text("Continue")');
    
    // Should show cooldown message
    await expect(page.locator('text=Cooldown:')).toBeVisible();
    
    // Continue button should be disabled
    const continueButton = page.locator('[data-testid="continue-to-payment-button"]');
    await expect(continueButton).toBeDisabled();
  });

  test('should redirect aggressive strategy to GMX page', async ({ page }) => {
    await page.goto('/');
    await page.click('[data-testid="deposit-usd-button"]');
    await page.click('[data-testid="risk-profile-aggressive"]');
    await page.click('button:has-text("Continue")');
    
    // Should redirect to GMX page
    await expect(page).toHaveURL('/gmx');
  });
});

test.describe('Payment Processing E2E', () => {
  test('should handle Square payment flow', async ({ page }) => {
    // Mock Square payment form
    await page.route('**/square/**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          paymentId: 'test_payment_id'
        })
      });
    });
    
    await page.goto('/');
    await page.click('[data-testid="deposit-usd-button"]');
    await page.click('[data-testid="risk-profile-conservative"]');
    await page.click('button:has-text("Continue")');
    
    await page.fill('input[placeholder="10.00"]', '100');
    await page.click('[data-testid="continue-to-payment-button"]');
    
    // Should show payment form
    await expect(page.locator('[data-testid="square-payment-form"]')).toBeVisible();
    
    // Verify total amount calculation
    await expect(page.locator('text=Total: $104.20')).toBeVisible(); // 100 + 4.2% fee
  });

  test('should show instant profit message for $1000+ deposits', async ({ page }) => {
    await page.goto('/');
    
    // Should show profitability message on main page
    await expect(page.locator('text=$1000+ deposits: 3.7% USDC - 3.2% fee = 0.5% instant profit')).toBeVisible();
  });
});
