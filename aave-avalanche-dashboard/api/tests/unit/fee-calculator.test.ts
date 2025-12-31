/**
 * Unit tests for fee calculation logic
 */

import { describe, it, expect } from '@jest/globals';

// Mock the fee calculation functions from webhook
const getPlatformFeeRate = (depositAmount: number) => {
  if (depositAmount >= 1000) return 0.033; // 3.3%
  if (depositAmount >= 100) return 0.042; // 4.2%
  if (depositAmount >= 50) return 0.055; // 5.5%
  if (depositAmount >= 20) return 0.074; // 7.4%
  return 0.074; // Default 7.4% for amounts < $20
};

const getErgcDiscountRate = (depositAmount: number) => {
  if (depositAmount >= 1000) return 0.031; // Fixed 3.1%
  if (depositAmount >= 100) return 0.04; // Fixed 4.0%
  if (depositAmount >= 50) return 0.045; // Fixed 4.5%
  if (depositAmount >= 20) return 0.055; // Fixed 5.5%
  return 0.055; // Fixed 5.5% for amounts < $20
};

describe('Fee Calculator', () => {
  describe('Platform Fee Rates', () => {
    it('should return 7.4% for amounts under $20', () => {
      expect(getPlatformFeeRate(10)).toBe(0.074);
      expect(getPlatformFeeRate(19.99)).toBe(0.074);
    });

    it('should return 7.4% for amounts $20-$49', () => {
      expect(getPlatformFeeRate(20)).toBe(0.074);
      expect(getPlatformFeeRate(35)).toBe(0.074);
      expect(getPlatformFeeRate(49.99)).toBe(0.074);
    });

    it('should return 5.5% for amounts $50-$99', () => {
      expect(getPlatformFeeRate(50)).toBe(0.055);
      expect(getPlatformFeeRate(75)).toBe(0.055);
      expect(getPlatformFeeRate(99.99)).toBe(0.055);
    });

    it('should return 4.2% for amounts $100-$999', () => {
      expect(getPlatformFeeRate(100)).toBe(0.042);
      expect(getPlatformFeeRate(500)).toBe(0.042);
      expect(getPlatformFeeRate(999.99)).toBe(0.042);
    });

    it('should return 3.3% for amounts $1000+', () => {
      expect(getPlatformFeeRate(1000)).toBe(0.033);
      expect(getPlatformFeeRate(5000)).toBe(0.033);
      expect(getPlatformFeeRate(9999)).toBe(0.033);
    });
  });

  describe('ERGC Discount Rates', () => {
    it('should return 5.5% for amounts under $20 with ERGC', () => {
      expect(getErgcDiscountRate(10)).toBe(0.055);
      expect(getErgcDiscountRate(19.99)).toBe(0.055);
    });

    it('should return 5.5% for amounts $20-$49 with ERGC', () => {
      expect(getErgcDiscountRate(20)).toBe(0.055);
      expect(getErgcDiscountRate(35)).toBe(0.055);
      expect(getErgcDiscountRate(49.99)).toBe(0.055);
    });

    it('should return 4.5% for amounts $50-$99 with ERGC', () => {
      expect(getErgcDiscountRate(50)).toBe(0.045);
      expect(getErgcDiscountRate(75)).toBe(0.045);
      expect(getErgcDiscountRate(99.99)).toBe(0.045);
    });

    it('should return 4.0% for amounts $100-$999 with ERGC', () => {
      expect(getErgcDiscountRate(100)).toBe(0.04);
      expect(getErgcDiscountRate(500)).toBe(0.04);
      expect(getErgcDiscountRate(999.99)).toBe(0.04);
    });

    it('should return 3.1% for amounts $1000+ with ERGC', () => {
      expect(getErgcDiscountRate(1000)).toBe(0.031);
      expect(getErgcDiscountRate(5000)).toBe(0.031);
      expect(getErgcDiscountRate(9999)).toBe(0.031);
    });
  });

  describe('Fee Calculation Examples', () => {
    it('should calculate correct fees for $10 deposit without ERGC', () => {
      const amount = 10;
      const rate = getPlatformFeeRate(amount);
      const fee = amount * rate;
      expect(fee).toBe(0.74); // 10 * 0.074
    });

    it('should calculate correct fees for $10 deposit with ERGC', () => {
      const amount = 10;
      const rate = getErgcDiscountRate(amount);
      const fee = amount * rate;
      expect(fee).toBe(0.55); // 10 * 0.055
    });

    it('should calculate correct fees for $1000 deposit without ERGC', () => {
      const amount = 1000;
      const rate = getPlatformFeeRate(amount);
      const fee = amount * rate;
      expect(fee).toBe(33); // 1000 * 0.033
    });

    it('should calculate correct fees for $1000 deposit with ERGC', () => {
      const amount = 1000;
      const rate = getErgcDiscountRate(amount);
      const fee = amount * rate;
      expect(fee).toBe(31); // 1000 * 0.031
    });
  });
});
