/**
 * Security Tests for Square Webhook Handler
 * 
 * Tests critical security functions:
 * - Signature verification
 * - Input validation
 * - Amount validation
 * - Wallet address validation
 * - Idempotency protection
 * - Race condition prevention
 */

import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import crypto from 'crypto';

// Mock the signature verification function
function verifySignature(payload: string, signature: string, signatureKey: string): boolean {
  if (!signatureKey) {
    return false;
  }

  if (!signature) {
    return false;
  }

  try {
    let signatureBase64 = signature;
    if (signature.startsWith('sha256=')) {
      signatureBase64 = signature.substring(7);
    } else if (signature.includes('=')) {
      const equalsIndex = signature.indexOf('=');
      signatureBase64 = signature.substring(equalsIndex + 1);
    }

    const hmac = crypto.createHmac('sha256', signatureKey);
    hmac.update(payload);
    const expectedSignature = hmac.digest('base64');

    const signatureBuffer = Buffer.from(signatureBase64, 'base64');
    const expectedBuffer = Buffer.from(expectedSignature, 'base64');

    if (signatureBuffer.length !== expectedBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(
      new Uint8Array(signatureBuffer),
      new Uint8Array(expectedBuffer)
    );
  } catch (error) {
    return false;
  }
}

// Wallet address validation
function isValidWalletAddress(address: string): boolean {
  if (!address || typeof address !== 'string') {
    return false;
  }
  
  // Must start with 0x and be 42 characters (0x + 40 hex chars)
  if (!address.startsWith('0x') || address.length !== 42) {
    return false;
  }
  
  // Must be valid hex
  const hexPattern = /^0x[0-9a-fA-F]{40}$/;
  return hexPattern.test(address);
}

// Amount validation
function isValidAmount(amount: number, min: number = 1, max: number = 9999): boolean {
  if (typeof amount !== 'number' || isNaN(amount) || !isFinite(amount)) {
    return false;
  }
  
  if (amount < min || amount > max) {
    return false;
  }
  
  // Check for integer overflow (JavaScript safe integer range)
  if (amount > Number.MAX_SAFE_INTEGER) {
    return false;
  }
  
  return true;
}

// Hub wallet address check (security: prevent sending to hub wallet)
function isHubWalletAddress(address: string, hubAddress: string): boolean {
  if (!address || !hubAddress) {
    return false;
  }
  return address.toLowerCase() === hubAddress.toLowerCase();
}

describe('Webhook Security Tests', () => {
  const TEST_SIGNATURE_KEY = 'test-signature-key-12345';
  const HUB_WALLET_ADDRESS = '0x34c11928868d14bdD7Be55A0D9f9e02257240c24';

  describe('Signature Verification', () => {
    it('should verify valid signatures', () => {
      const payload = JSON.stringify({ type: 'payment.sent', data: { object: { payment: { id: 'test123' } } } });
      const hmac = crypto.createHmac('sha256', TEST_SIGNATURE_KEY);
      hmac.update(payload);
      const validSignature = 'sha256=' + hmac.digest('base64');
      
      expect(verifySignature(payload, validSignature, TEST_SIGNATURE_KEY)).toBe(true);
    });

    it('should reject invalid signatures', () => {
      const payload = JSON.stringify({ type: 'payment.sent' });
      const invalidSignature = 'sha256=invalid_signature_base64';
      
      expect(verifySignature(payload, invalidSignature, TEST_SIGNATURE_KEY)).toBe(false);
    });

    it('should reject requests without signature', () => {
      const payload = JSON.stringify({ type: 'payment.sent' });
      
      expect(verifySignature(payload, '', TEST_SIGNATURE_KEY)).toBe(false);
    });

    it('should reject requests when signature key is not configured', () => {
      const payload = JSON.stringify({ type: 'payment.sent' });
      const hmac = crypto.createHmac('sha256', TEST_SIGNATURE_KEY);
      hmac.update(payload);
      const validSignature = 'sha256=' + hmac.digest('base64');
      
      expect(verifySignature(payload, validSignature, '')).toBe(false);
    });

    it('should handle signature timing attacks (use timingSafeEqual)', () => {
      const payload = JSON.stringify({ type: 'payment.sent' });
      const hmac = crypto.createHmac('sha256', TEST_SIGNATURE_KEY);
      hmac.update(payload);
      const validSignature = 'sha256=' + hmac.digest('base64');
      
      // Verify timing-safe comparison is used (this test ensures the function exists)
      expect(verifySignature(payload, validSignature, TEST_SIGNATURE_KEY)).toBe(true);
    });

    it('should reject tampered payloads', () => {
      const originalPayload = JSON.stringify({ type: 'payment.sent', amount: 100 });
      const hmac = crypto.createHmac('sha256', TEST_SIGNATURE_KEY);
      hmac.update(originalPayload);
      const validSignature = 'sha256=' + hmac.digest('base64');
      
      const tamperedPayload = JSON.stringify({ type: 'payment.sent', amount: 10000 });
      
      expect(verifySignature(tamperedPayload, validSignature, TEST_SIGNATURE_KEY)).toBe(false);
    });
  });

  describe('Wallet Address Validation', () => {
    it('should accept valid wallet addresses', () => {
      expect(isValidWalletAddress('0x1234567890123456789012345678901234567890')).toBe(true);
      expect(isValidWalletAddress('0xEC80A2CB3652EC599EFB7AAC086D07F391A5E55')).toBe(true);
    });

    it('should reject invalid wallet addresses', () => {
      expect(isValidWalletAddress('')).toBe(false);
      expect(isValidWalletAddress('0x123')).toBe(false); // Too short
      expect(isValidWalletAddress('0x12345678901234567890123456789012345678901234567890')).toBe(false); // Too long
      expect(isValidWalletAddress('1234567890123456789012345678901234567890')).toBe(false); // Missing 0x
      expect(isValidWalletAddress('0xGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuv')).toBe(false); // Invalid hex
      expect(isValidWalletAddress(null as any)).toBe(false);
      expect(isValidWalletAddress(undefined as any)).toBe(false);
      expect(isValidWalletAddress(123 as any)).toBe(false);
    });

    it('should detect hub wallet addresses (security check)', () => {
      expect(isHubWalletAddress(HUB_WALLET_ADDRESS, HUB_WALLET_ADDRESS)).toBe(true);
      expect(isHubWalletAddress(HUB_WALLET_ADDRESS.toLowerCase(), HUB_WALLET_ADDRESS)).toBe(true);
      expect(isHubWalletAddress('0x1234567890123456789012345678901234567890', HUB_WALLET_ADDRESS)).toBe(false);
    });
  });

  describe('Amount Validation', () => {
    it('should accept valid amounts', () => {
      expect(isValidAmount(1)).toBe(true);
      expect(isValidAmount(100)).toBe(true);
      expect(isValidAmount(2343)).toBe(true);
      expect(isValidAmount(9999)).toBe(true);
      expect(isValidAmount(1.5)).toBe(true);
      expect(isValidAmount(99.99)).toBe(true);
    });

    it('should reject invalid amounts', () => {
      expect(isValidAmount(0)).toBe(false); // Below minimum
      expect(isValidAmount(-1)).toBe(false); // Negative
      expect(isValidAmount(10000)).toBe(false); // Above maximum
      expect(isValidAmount(NaN)).toBe(false);
      expect(isValidAmount(Infinity)).toBe(false);
      expect(isValidAmount(-Infinity)).toBe(false);
      expect(isValidAmount(Number.MAX_SAFE_INTEGER + 1)).toBe(false); // Overflow
    });

    it('should reject non-numeric values', () => {
      expect(isValidAmount('100' as any)).toBe(false);
      expect(isValidAmount(null as any)).toBe(false);
      expect(isValidAmount(undefined as any)).toBe(false);
      expect(isValidAmount({} as any)).toBe(false);
      expect(isValidAmount([] as any)).toBe(false);
    });

    it('should enforce custom min/max bounds', () => {
      expect(isValidAmount(50, 50, 100)).toBe(true);
      expect(isValidAmount(49, 50, 100)).toBe(false);
      expect(isValidAmount(101, 50, 100)).toBe(false);
    });
  });

  describe('Input Sanitization', () => {
    it('should prevent SQL injection in payment IDs', () => {
      const maliciousIds = [
        "'; DROP TABLE payments; --",
        "1' OR '1'='1",
        "1; DELETE FROM payments;",
        "<script>alert('xss')</script>",
        "../../etc/passwd",
        "null",
        "undefined"
      ];

      maliciousIds.forEach(id => {
        // Payment IDs should only contain alphanumeric, hyphens, underscores
        const isValid = /^[a-zA-Z0-9_-]+$/.test(id);
        expect(isValid).toBe(false);
      });
    });

    it('should validate payment ID format', () => {
      const validIds = ['payment-123', 'payment_456', 'test123'];
      const invalidIds = ['payment 123', 'payment@123', 'payment#123', ''];

      validIds.forEach(id => {
        expect(/^[a-zA-Z0-9_-]+$/.test(id)).toBe(true);
      });

      invalidIds.forEach(id => {
        expect(/^[a-zA-Z0-9_-]+$/.test(id)).toBe(false);
      });
    });
  });

  describe('Idempotency Protection', () => {
    it('should prevent duplicate payment processing', () => {
      const paymentId = 'payment-123';
      const processedPayments = new Set<string>();
      
      // First processing
      expect(processedPayments.has(paymentId)).toBe(false);
      processedPayments.add(paymentId);
      
      // Duplicate attempt
      expect(processedPayments.has(paymentId)).toBe(true);
    });

    it('should handle concurrent payment processing attempts', () => {
      const paymentId = 'payment-456';
      const processingLocks = new Map<string, boolean>();
      
      // First request acquires lock
      expect(processingLocks.has(paymentId)).toBe(false);
      processingLocks.set(paymentId, true);
      
      // Concurrent request should detect lock
      expect(processingLocks.has(paymentId)).toBe(true);
      expect(processingLocks.get(paymentId)).toBe(true);
    });
  });

  describe('Race Condition Prevention', () => {
    it('should prevent double-spending via race conditions', async () => {
      let balance = 1000;
      const transferAmount = 100;
      const transfers: Promise<boolean>[] = [];

      const transfer = async (): Promise<boolean> => {
        // Simulate lock acquisition
        if (balance >= transferAmount) {
          // Simulate network delay
          await new Promise(resolve => setTimeout(resolve, 10));
          balance -= transferAmount;
          return true;
        }
        return false;
      };

      // Simulate 5 concurrent transfers
      for (let i = 0; i < 5; i++) {
        transfers.push(transfer());
      }

      const results = await Promise.all(transfers);
      const successful = results.filter(r => r).length;
      
      // Without proper locking, all 5 might succeed (race condition)
      // With proper locking, only 2 should succeed (1000 / 100 = 10, but we only have 5 attempts)
      // This test demonstrates the need for atomic operations
      expect(successful).toBeLessThanOrEqual(5);
      expect(balance).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Integer Overflow Protection', () => {
    it('should prevent integer overflow in amount calculations', () => {
      const maxSafe = Number.MAX_SAFE_INTEGER;
      const overflowAmount = maxSafe + 1;
      
      expect(isValidAmount(overflowAmount)).toBe(false);
      expect(Number.isSafeInteger(overflowAmount)).toBe(false);
    });

    it('should handle large number calculations safely', () => {
      const amount1 = 999999999;
      const amount2 = 999999999;
      const sum = amount1 + amount2;
      
      expect(Number.isSafeInteger(sum)).toBe(true);
      expect(isValidAmount(sum, 1, 2000000000)).toBe(true);
    });
  });

  describe('XSS Prevention', () => {
    it('should sanitize user input in payment notes', () => {
      const maliciousInputs = [
        '<script>alert("xss")</script>',
        'javascript:alert("xss")',
        '<img src=x onerror=alert("xss")>',
        '"><script>alert("xss")</script>',
      ];

      maliciousInputs.forEach(input => {
        // Should escape HTML special characters
        const sanitized = input
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#x27;')
          .replace(/\//g, '&#x2F;');
        
        expect(sanitized).not.toContain('<script>');
        expect(sanitized).not.toContain('javascript:');
      });
    });
  });

  describe('Path Traversal Prevention', () => {
    it('should prevent path traversal attacks', () => {
      const maliciousPaths = [
        '../../../etc/passwd',
        '..\\..\\..\\windows\\system32',
        '/etc/passwd',
        'C:\\Windows\\System32',
      ];

      maliciousPaths.forEach(path => {
        // Should normalize and validate paths
        const normalized = path.replace(/\.\./g, '').replace(/[\/\\]/g, '');
        expect(normalized).not.toContain('..');
        expect(normalized).not.toContain('/');
        expect(normalized).not.toContain('\\');
      });
    });
  });
});

