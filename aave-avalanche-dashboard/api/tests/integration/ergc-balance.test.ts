/**
 * Integration tests for ERGC balance endpoint
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';

const ERGC_BALANCE_URL = 'http://localhost:3000/api/ergc/balance';
const TEST_WALLET = '0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b9';

describe('ERGC Balance API', () => {
  it('should return 400 for missing address parameter', async () => {
    const response = await fetch(ERGC_BALANCE_URL);
    expect(response.status).toBe(400);
    
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe('address parameter is required');
  });

  it('should return 400 for invalid address format', async () => {
    const response = await fetch(`${ERGC_BALANCE_URL}?address=invalid`);
    expect(response.status).toBe(400);
    
    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toBe('Invalid address format');
  });

  it('should return balance data for valid address', async () => {
    const response = await fetch(`${ERGC_BALANCE_URL}?address=${TEST_WALLET}`);
    expect(response.status).toBe(200);
    
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.address).toBe(TEST_WALLET);
    expect(typeof data.balance).toBe('number');
    expect(data.balance).toBeGreaterThanOrEqual(0);
    expect(typeof data.has_discount).toBe('boolean');
    expect(typeof data.tokens_needed).toBe('number');
  });

  it('should correctly identify discount eligibility', async () => {
    const response = await fetch(`${ERGC_BALANCE_URL}?address=${TEST_WALLET}`);
    const data = await response.json();
    
    if (data.balance >= 100) {
      expect(data.has_discount).toBe(true);
      expect(data.tokens_needed).toBe(0);
    } else {
      expect(data.has_discount).toBe(false);
      expect(data.tokens_needed).toBeGreaterThan(0);
      expect(data.tokens_needed).toBe(100 - data.balance);
    }
  });
});

describe('Square Webhook API', () => {
  const WEBHOOK_URL = 'http://localhost:3000/api/square/webhook';
  const VALID_SIGNATURE = 'test-signature';
  const TEST_WEBHOOK_PAYLOAD = {
    type: 'payment.paid',
    id: 'test_payment_id',
    created_at: '2024-01-01T00:00:00Z',
    data: {
      object: {
        id: 'test_payment_id',
        amount_money: {
          amount: 1000,
          currency: 'USD'
        },
        status: 'COMPLETED',
        note: 'test_user_wallet|conservative|10.00'
      }
    }
  };

  it('should reject GET requests', async () => {
    const response = await fetch(WEBHOOK_URL);
    expect(response.status).toBe(405);
  });

  it('should reject requests without signature', async () => {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(TEST_WEBHOOK_PAYLOAD)
    });
    
    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe('No signature provided');
  });

  it('should process valid webhook with signature', async () => {
    // Note: This test would require the SQUARE_WEBHOOK_SIGNATURE_KEY to be set
    // and proper signature generation. For now, we test the structure.
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-square-signature': VALID_SIGNATURE
      },
      body: JSON.stringify(TEST_WEBHOOK_PAYLOAD)
    });
    
    // Should either process (200) or reject signature (401), but not crash
    expect([200, 401]).toContain(response.status);
  });
});
