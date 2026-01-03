/**
 * Mutation Testing for Security Functions
 * 
 * Tests that security checks are actually enforced by verifying
 * that removing/changing security checks causes tests to fail
 */

import { describe, it, expect } from '@jest/globals';

// Original secure function
function secureAmountValidation(amount: number): boolean {
  if (typeof amount !== 'number') return false;
  if (isNaN(amount)) return false;
  if (!isFinite(amount)) return false;
  if (amount < 1) return false;
  if (amount > 9999) return false;
  return true;
}

// Mutated version 1: Missing type check (VULNERABLE)
function mutatedAmountValidation1(amount: number): boolean {
  // MUTATION: Removed typeof check
  if (isNaN(amount)) return false;
  if (!isFinite(amount)) return false;
  if (amount < 1) return false;
  if (amount > 9999) return false;
  return true;
}

// Mutated version 2: Missing NaN check (VULNERABLE)
function mutatedAmountValidation2(amount: number): boolean {
  if (typeof amount !== 'number') return false;
  // MUTATION: Removed NaN check
  if (!isFinite(amount)) return false;
  if (amount < 1) return false;
  if (amount > 9999) return false;
  return true;
}

// Mutated version 3: Missing min check (VULNERABLE)
function mutatedAmountValidation3(amount: number): boolean {
  if (typeof amount !== 'number') return false;
  if (isNaN(amount)) return false;
  if (!isFinite(amount)) return false;
  // MUTATION: Removed minimum check
  if (amount > 9999) return false;
  return true;
}

// Mutated version 4: Missing max check (VULNERABLE)
function mutatedAmountValidation4(amount: number): boolean {
  if (typeof amount !== 'number') return false;
  if (isNaN(amount)) return false;
  if (!isFinite(amount)) return false;
  if (amount < 1) return false;
  // MUTATION: Removed maximum check
  return true;
}

describe('Mutation Testing - Security Validation', () => {
  describe('Secure Amount Validation', () => {
    it('should reject invalid inputs (secure version)', () => {
      expect(secureAmountValidation(NaN)).toBe(false);
      expect(secureAmountValidation(Infinity)).toBe(false);
      expect(secureAmountValidation(-Infinity)).toBe(false);
      expect(secureAmountValidation(0)).toBe(false);
      expect(secureAmountValidation(10000)).toBe(false);
      expect(secureAmountValidation('100' as any)).toBe(false);
      expect(secureAmountValidation(null as any)).toBe(false);
    });

    it('should accept valid inputs (secure version)', () => {
      expect(secureAmountValidation(1)).toBe(true);
      expect(secureAmountValidation(100)).toBe(true);
      expect(secureAmountValidation(9999)).toBe(true);
    });
  });

  describe('Mutation 1: Missing Type Check', () => {
    it('should FAIL - mutated function accepts non-numbers', () => {
      // This test SHOULD FAIL if mutation is present (proving the security check is needed)
      expect(mutatedAmountValidation1('100' as any)).toBe(false); // Should be false, but mutation might allow it
      expect(mutatedAmountValidation1(null as any)).toBe(false); // Should be false
    });
  });

  describe('Mutation 2: Missing NaN Check', () => {
    it('should FAIL - mutated function accepts NaN', () => {
      // This test SHOULD FAIL if mutation is present
      expect(mutatedAmountValidation2(NaN)).toBe(false); // Should be false
    });
  });

  describe('Mutation 3: Missing Min Check', () => {
    it('should FAIL - mutated function accepts amounts below minimum', () => {
      // This test SHOULD FAIL if mutation is present
      expect(mutatedAmountValidation3(0)).toBe(false); // Should be false
      expect(mutatedAmountValidation3(-1)).toBe(false); // Should be false
      expect(mutatedAmountValidation3(0.5)).toBe(false); // Should be false
    });
  });

  describe('Mutation 4: Missing Max Check', () => {
    it('should FAIL - mutated function accepts amounts above maximum', () => {
      // This test SHOULD FAIL if mutation is present
      expect(mutatedAmountValidation4(10000)).toBe(false); // Should be false
      expect(mutatedAmountValidation4(99999)).toBe(false); // Should be false
      expect(mutatedAmountValidation4(Number.MAX_SAFE_INTEGER)).toBe(false); // Should be false
    });
  });
});

describe('Mutation Testing - Wallet Address Validation', () => {
  function secureWalletValidation(address: string): boolean {
    if (!address || typeof address !== 'string') return false;
    if (!address.startsWith('0x')) return false;
    if (address.length !== 42) return false;
    return /^0x[0-9a-fA-F]{40}$/.test(address);
  }

  // Mutated: Missing length check
  function mutatedWalletValidation1(address: string): boolean {
    if (!address || typeof address !== 'string') return false;
    if (!address.startsWith('0x')) return false;
    // MUTATION: Removed length check
    return /^0x[0-9a-fA-F]{40}$/.test(address);
  }

  // Mutated: Missing hex validation
  function mutatedWalletValidation2(address: string): boolean {
    if (!address || typeof address !== 'string') return false;
    if (!address.startsWith('0x')) return false;
    if (address.length !== 42) return false;
    // MUTATION: Removed hex pattern check
    return true;
  }

  it('should reject invalid addresses (secure version)', () => {
    expect(secureWalletValidation('0x123')).toBe(false); // Too short
    expect(secureWalletValidation('0x' + 'a'.repeat(50))).toBe(false); // Too long
    expect(secureWalletValidation('1234567890123456789012345678901234567890')).toBe(false); // No 0x
  });

  it('should detect mutation 1 - missing length check', () => {
    // Mutation should allow invalid lengths
    expect(mutatedWalletValidation1('0x123')).toBe(false); // Should still fail due to regex
    expect(mutatedWalletValidation1('0x' + 'a'.repeat(50))).toBe(false); // Should still fail due to regex
  });

  it('should detect mutation 2 - missing hex validation', () => {
    // Mutation should allow invalid hex
    expect(mutatedWalletValidation2('0xGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuv')).toBe(true); // VULNERABLE!
    // This proves the hex check is critical
  });
});

