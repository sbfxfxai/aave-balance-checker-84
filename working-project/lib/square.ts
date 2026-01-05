/**
 * Square Payment Processing Integration
 * 
 * Handles USD and Bitcoin deposits via Square API
 * - USD deposits: Credit/debit card processing
 * - Bitcoin deposits: Lightning Network via Square Bitcoin
 */

const SQUARE_API_BASE_URL = import.meta.env.VITE_SQUARE_API_URL || 'https://connect.squareup.com';
const SQUARE_APPLICATION_ID = import.meta.env.VITE_SQUARE_APPLICATION_ID || '';
const SQUARE_ACCESS_TOKEN = import.meta.env.VITE_SQUARE_ACCESS_TOKEN || '';
const SQUARE_LOCATION_ID = import.meta.env.VITE_SQUARE_LOCATION_ID || '';
const SQUARE_ENVIRONMENT = import.meta.env.VITE_SQUARE_ENVIRONMENT || 'sandbox';

// Backend API URL - defaults to same origin if not specified (for production)
// For local dev, set VITE_API_BASE_URL=http://localhost:8000
// For production, set VITE_API_BASE_URL=https://your-backend.vercel.app
// If not set, uses same origin (works if backend is on same domain)
const getApiBaseUrl = () => {
  // Explicit override takes precedence
  if (import.meta.env.VITE_API_BASE_URL) {
    return import.meta.env.VITE_API_BASE_URL;
  }
  
  // Check if we're in browser environment
  if (typeof window === 'undefined') {
    return '';
  }
  
  // In production (Vercel), always use same origin
  // Check if we're on localhost to determine dev vs prod
  const isLocalhost = window.location.hostname === 'localhost' || 
                      window.location.hostname === '127.0.0.1' ||
                      window.location.hostname === '';
  
  if (isLocalhost) {
    // Development - use localhost backend
    return 'http://localhost:8000';
  }
  
  // Production - use same origin (backend on same domain)
  return window.location.origin;
};

// Get API base URL - computed at runtime, not build time
// PRODUCTION: Always uses same origin (no localhost in production!)
// DEVELOPMENT: Uses localhost:8000 only when actually on localhost
const getApiBaseUrlRuntime = () => {
  // Check if we're in browser environment
  if (typeof window === 'undefined') {
    console.warn('[Square] Window not available, cannot determine API URL');
    return '';
  }
  
  const hostname = window.location.hostname;
  const origin = window.location.origin;
  
  // Determine if we're actually on localhost
  const isLocalhost = hostname === 'localhost' || 
                      hostname === '127.0.0.1' ||
                      hostname === '';
  
  // PRODUCTION: Always use same origin (backend on same domain)
  // Never use localhost in production, even if VITE_API_BASE_URL is set
  if (!isLocalhost) {
    console.log('[Square] Production mode - using same origin:', origin);
    return origin;
  }
  
  // DEVELOPMENT: Only use localhost when actually running locally
  // Check VITE_API_BASE_URL, but ignore it if it's localhost and we're in production
  if (import.meta.env.VITE_API_BASE_URL) {
    const overrideUrl = import.meta.env.VITE_API_BASE_URL;
    // Only use override if it's NOT localhost (production override)
    if (!overrideUrl.includes('localhost') && !overrideUrl.includes('127.0.0.1')) {
      console.log('[Square] Using VITE_API_BASE_URL override:', overrideUrl);
      return overrideUrl;
    }
    // If override is localhost but we're in production, ignore it
    console.warn('[Square] Ignoring localhost VITE_API_BASE_URL in production, using same origin');
    return origin;
  }
  
  // Development - use localhost backend
  console.log('[Square] Development mode - using http://localhost:8000');
  return 'http://localhost:8000';
};

// Keep for backward compatibility, but use runtime function in payment calls
const API_BASE_URL = getApiBaseUrl();

// Validate Square configuration
export function validateSquareConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  if (!SQUARE_APPLICATION_ID) {
    errors.push('Square Application ID is missing');
  }
  
  // Note: SQUARE_ACCESS_TOKEN is backend-only, not needed in frontend validation
  // if (!SQUARE_ACCESS_TOKEN) {
  //   errors.push('Square Access Token is missing');
  // }
  
  if (!SQUARE_LOCATION_ID) {
    errors.push('Square Location ID is missing');
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

// Log configuration status (without exposing sensitive data)
if (typeof window !== 'undefined') {
  const config = validateSquareConfig();
  if (config.valid) {
    console.log(`[Square] Configuration loaded - Environment: ${SQUARE_ENVIRONMENT}`);
    console.log(`[Square] Application ID: ${SQUARE_APPLICATION_ID.substring(0, 10)}...`);
    console.log(`[Square] Location ID: ${SQUARE_LOCATION_ID}`);
  } else {
    console.warn('[Square] Configuration incomplete:', config.errors);
  }
}

export interface SquarePaymentRequest {
  type: 'usd' | 'bitcoin';
  amount: number;
  riskProfile: string;
  sourceId?: string; // For card payments (from Square payment form)
  email?: string;
  customerId?: string;
}

export interface SquarePaymentResponse {
  success: boolean;
  paymentId?: string;
  orderId?: string;
  transactionId?: string;
  error?: string;
  message?: string;
}

/**
 * Process a Square payment (USD or Bitcoin)
 */
export async function processSquarePayment(
  request: SquarePaymentRequest
): Promise<SquarePaymentResponse> {
  try {
    // Validate configuration
    const configCheck = validateSquareConfig();
    if (!configCheck.valid) {
      throw new Error(`Square API not configured: ${configCheck.errors.join(', ')}`);
    }

    console.log(`[Square] Processing ${request.type.toUpperCase()} payment:`, {
      amount: request.amount,
      riskProfile: request.riskProfile,
      environment: SQUARE_ENVIRONMENT,
    });

    if (request.type === 'usd') {
      return await processUSDPayment(request);
    } else {
      return await processBitcoinPayment(request);
    }
  } catch (error: unknown) {
    console.error('Square payment processing error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Payment processing failed',
    };
  }
}

/**
 * Process USD payment via Square Payments API
 * NOTE: Square API doesn't allow direct browser calls due to CORS.
 * This function calls our backend endpoint which then calls Square API.
 */
async function processUSDPayment(
  request: SquarePaymentRequest
): Promise<SquarePaymentResponse> {
  try {
    if (!request.sourceId) {
      throw new Error('Payment token (sourceId) is required');
    }

    // Get API URL at runtime (not build time) to ensure correct URL in production
    const runtimeApiBaseUrl = getApiBaseUrlRuntime();
    const backendUrl = `${runtimeApiBaseUrl}/api/square/process-payment`;
    
    // Log detailed information for debugging
    const debugInfo = {
      backendUrl,
      runtimeApiBaseUrl,
      buildTimeApiBaseUrl: API_BASE_URL,
      currentOrigin: typeof window !== 'undefined' ? window.location.origin : 'N/A',
      hostname: typeof window !== 'undefined' ? window.location.hostname : 'N/A',
      isLocalhost: typeof window !== 'undefined' ? 
        (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') : 'N/A',
      amount: request.amount,
      hasToken: !!request.sourceId,
      environment: import.meta.env.MODE,
      isDev: import.meta.env.DEV,
      viteApiBaseUrl: import.meta.env.VITE_API_BASE_URL || 'not set',
    };
    
    console.log('[Square] Calling backend payment endpoint:', debugInfo);
    
    // Warn if using localhost in production
    if (runtimeApiBaseUrl.includes('localhost') && typeof window !== 'undefined' && 
        !window.location.hostname.includes('localhost')) {
      console.error('[Square] ERROR: Using localhost backend URL in production!', {
        hostname: window.location.hostname,
        runtimeApiBaseUrl,
      });
    }

    // Call backend endpoint instead of Square API directly (CORS protection)
    let response: Response;
    try {
      response = await fetch(backendUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          source_id: request.sourceId, // Token from Square card.tokenize()
          amount: request.amount,
          currency: 'USD',
          risk_profile: request.riskProfile,
          idempotency_key: `${Date.now()}-${Math.random()}`,
        }),
      });
    } catch (fetchError: unknown) {
      console.error('[Square] Fetch error:', fetchError);
      // Network error - backend might not be accessible
      if (fetchError instanceof Error && 
          (fetchError.message?.includes('Failed to fetch') || fetchError.name === 'TypeError')) {
        throw new Error(
          `Cannot reach backend at ${backendUrl}. ` +
          `Please verify the backend is deployed and accessible. ` +
          `If backend is on different domain, set VITE_API_BASE_URL environment variable.`
        );
      }
      throw fetchError;
    }

    if (!response.ok) {
      let errorData: { detail?: string; error?: string; message?: string; errors?: Array<{ detail?: string; message?: string }> } = {};
      let errorMessage = '';
      
      try {
        const responseText = await response.text();
        console.error('[Square] Backend error response text:', responseText);
        
        if (responseText) {
          try {
            errorData = JSON.parse(responseText) as { detail?: string; error?: string; message?: string; errors?: Array<{ detail?: string; message?: string }> };
          } catch {
            // Not JSON, use as plain text
            errorData = { detail: responseText };
          }
        }
      } catch (e) {
        console.error('[Square] Error reading error response:', e);
        errorData = { detail: `HTTP ${response.status} ${response.statusText || ''}` };
      }
      
      // Extract error message from FastAPI error format
      if (errorData.detail) {
        errorMessage = errorData.detail;
      } else if (errorData.errors && Array.isArray(errorData.errors) && errorData.errors.length > 0) {
        errorMessage = errorData.errors[0].detail || errorData.errors[0].message || 'Payment failed';
      } else if (errorData.error) {
        errorMessage = errorData.error;
      } else if (errorData.message) {
        errorMessage = errorData.message;
      }
      
      // Provide specific messages for common status codes
      if (response.status === 404) {
        errorMessage = errorMessage || 'Backend endpoint not found (404). Please verify the backend is deployed and the route /api/square/process-payment exists.';
      } else if (response.status === 500) {
        errorMessage = errorMessage || 'Backend server error. This may indicate missing Square API credentials (SQUARE_ACCESS_TOKEN or SQUARE_LOCATION_ID) or a server configuration issue.';
      } else if (response.status === 503) {
        errorMessage = errorMessage || 'Service unavailable. Cannot connect to Square API.';
      } else if (response.status === 504) {
        errorMessage = errorMessage || 'Request timeout. Square API did not respond in time.';
      } else {
        errorMessage = errorMessage || `Payment failed (${response.status})`;
      }
      
      console.error('[Square] Backend error response:', {
        status: response.status,
        statusText: response.statusText,
        errorData,
        extractedMessage: errorMessage,
        url: backendUrl,
      });
      throw new Error(errorMessage);
    }

    const data = await response.json();
    
    return {
      success: true,
      paymentId: data.payment_id,
      orderId: data.order_id,
      transactionId: data.transaction_id,
      message: data.message || 'USD payment processed successfully',
    };
  } catch (error: unknown) {
    console.error('[Square] USD payment error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'USD payment processing failed',
    };
  }
}

/**
 * Process Bitcoin payment via Square Bitcoin API
 */
async function processBitcoinPayment(
  request: SquarePaymentRequest
): Promise<SquarePaymentResponse> {
  try {
    // Square Bitcoin payments use Lightning Network
    // This is a placeholder - actual implementation depends on Square's Bitcoin API
    
    // For now, return a mock success response
    // In production, integrate with Square's Bitcoin payment endpoints
    
    console.log('Bitcoin payment request:', {
      amount: request.amount,
      riskProfile: request.riskProfile,
    });

    // TODO: Implement actual Square Bitcoin API integration
    // Square Bitcoin API documentation: https://developer.squareup.com/docs/bitcoin-api
    
    return {
      success: true,
      paymentId: `btc-${Date.now()}`,
      message: 'Bitcoin payment initiated (Lightning Network)',
    };
  } catch (error: unknown) {
    console.error('Bitcoin payment error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Bitcoin payment processing failed',
    };
  }
}

/**
 * Create a Square payment form nonce (for card payments)
 * This should be called from the frontend using Square's Web Payments SDK
 */
export async function createPaymentNonce(cardData: {
  cardNumber: string;
  cvv: string;
  expirationDate: string;
  postalCode: string;
}): Promise<string> {
  // In production, use Square's Web Payments SDK to create a payment nonce
  // This is a placeholder - actual implementation requires Square's frontend SDK
  
  console.warn('createPaymentNonce: Use Square Web Payments SDK in production');
  
  // Return mock nonce for development
  return 'cnon:card-nonce-ok';
}

/**
 * Verify a Square payment status
 */
export async function verifyPaymentStatus(
  paymentId: string
): Promise<{ status: string; verified: boolean }> {
  try {
    const response = await fetch(`${SQUARE_API_BASE_URL}/v2/payments/${paymentId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
        'Square-Version': '2024-01-18',
      },
    });

    if (!response.ok) {
      throw new Error('Failed to verify payment');
    }

    const data = await response.json();
    
    return {
      status: data.payment?.status || 'UNKNOWN',
      verified: data.payment?.status === 'COMPLETED',
    };
  } catch (error: unknown) {
    console.error('Payment verification error:', error);
    return {
      status: 'ERROR',
      verified: false,
    };
  }
}

/**
 * Get Square API configuration for frontend
 */
export function getSquareConfig() {
  return {
    applicationId: SQUARE_APPLICATION_ID,
    locationId: SQUARE_LOCATION_ID,
    environment: SQUARE_ENVIRONMENT, // 'sandbox' or 'production'
    apiUrl: SQUARE_API_BASE_URL,
    // Square Web Payments SDK URL based on environment
    sdkUrl: SQUARE_ENVIRONMENT === 'production' 
      ? 'https://web.squarecdn.com/v1/square.js'
      : 'https://sandbox.web.squarecdn.com/v1/square.js',
  };
}

/**
 * Check if Square is configured and ready for production use
 */
export function isSquareConfigured(): boolean {
  return validateSquareConfig().valid;
}

