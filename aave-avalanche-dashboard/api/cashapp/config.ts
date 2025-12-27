// Cash App Pay API Configuration
// Sandbox: https://sandbox.api.cash.app
// Production: https://api.cash.app

export const CASHAPP_CONFIG = {
  // API Base URLs
  SANDBOX_URL: 'https://sandbox.api.cash.app',
  PRODUCTION_URL: 'https://api.cash.app',
  
  // Use sandbox by default, switch to production when ready
  get BASE_URL() {
    return process.env.CASHAPP_ENVIRONMENT === 'production' 
      ? this.PRODUCTION_URL 
      : this.SANDBOX_URL;
  },
  
  // API Credentials (set in environment variables)
  get API_CREDENTIALS() {
    return process.env.CASHAPP_API_CREDENTIALS || '';
  },
  
  get CLIENT_ID() {
    return process.env.CASHAPP_CLIENT_ID || '';
  },
  
  // Brand and Merchant IDs (created once, stored in env)
  get BRAND_ID() {
    return process.env.CASHAPP_BRAND_ID || '';
  },
  
  get MERCHANT_ID() {
    return process.env.CASHAPP_MERCHANT_ID || '';
  },
  
  // Region header
  REGION: 'PDX',
  
  // Sandbox signature bypass
  get SIGNATURE_HEADER() {
    return process.env.CASHAPP_ENVIRONMENT === 'production'
      ? undefined // Real signature required in production
      : 'sandbox:skip-signature-check';
  },
};

// Helper to generate idempotency keys
export function generateIdempotencyKey(): string {
  return crypto.randomUUID();
}

// Common headers for Cash App API requests
export function getCashAppHeaders(isClientSide = false): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Accept': 'application/json',
    'X-Region': CASHAPP_CONFIG.REGION,
  };
  
  if (isClientSide) {
    headers['Authorization'] = `Client ${CASHAPP_CONFIG.CLIENT_ID}`;
  } else {
    headers['Authorization'] = CASHAPP_CONFIG.API_CREDENTIALS;
  }
  
  // Add signature bypass for sandbox
  const sig = CASHAPP_CONFIG.SIGNATURE_HEADER;
  if (sig) {
    headers['x-signature'] = sig;
  }
  
  return headers;
}
