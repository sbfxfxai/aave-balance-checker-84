import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Test setup utilities for API testing
 */
export interface TestConfig {
  environment: 'development' | 'test' | 'production';
  mockResponses: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

export interface MockResponse {
  status: number;
  data: any;
  headers?: Record<string, string>;
}

/**
 * Test setup configuration
 */
export const testConfig: TestConfig = {
  environment: (process.env.NODE_ENV as any) || 'development',
  mockResponses: process.env.MOCK_RESPONSES === 'true',
  logLevel: (process.env.LOG_LEVEL as any) || 'info'
};

/**
 * Mock response generator for testing
 */
export function createMockResponse(status: number, data: any): MockResponse {
  return {
    status,
    data,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  };
}

/**
 * Test helper to simulate API requests
 */
export async function simulateRequest(
  method: string,
  path: string,
  body?: any,
  headers?: Record<string, string>
): Promise<MockResponse> {
  // Mock request simulation
  console.log(`[Test] Simulating ${method} ${path}`, { body, headers });
  
  // Return mock response based on path
  if (path.includes('/health')) {
    return createMockResponse(200, { status: 'healthy', timestamp: new Date().toISOString() });
  }
  
  if (path.includes('/auth')) {
    return createMockResponse(200, { success: true, message: 'Auth test successful' });
  }
  
  return createMockResponse(404, { error: 'Not found' });
}

/**
 * Test data generators
 */
export const testData = {
  email: 'test@example.com',
  walletAddress: '0x1234567890123456789012345678901234567890',
  code: '123456',
  amount: 100,
  currency: 'USD'
};

/**
 * Test utilities
 */
export const testUtils = {
  delay: (ms: number) => new Promise(resolve => setTimeout(resolve, ms)),
  randomString: (length: number) => Math.random().toString(36).substring(2, length + 2),
  randomEmail: () => `test-${Date.now()}@example.com`
};
