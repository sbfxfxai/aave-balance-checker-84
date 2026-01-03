// Square Payment Service
// Based on working food app implementation

// Type definitions for Square Web SDK
interface SquareTokenizeResult {
  status: string;
  token?: string;
  errors?: {
    detail: string;
    field?: string;
    type?: string;
  }[];
}

interface SquareCard {
  tokenize(): Promise<SquareTokenizeResult>;
  attach(selector: string): Promise<void>;
  destroy(): void;
}

interface SquarePayments {
  card(): Promise<SquareCard>;
}

interface SquareSDK {
  payments(applicationId: string, locationId: string): SquarePayments;
}

interface PaymentResponse {
  success: boolean;
  paymentId?: string;
  error?: string;
}

export class SquarePaymentService {
  private payments: SquarePayments | null = null;
  private card: SquareCard | null = null;

  private async loadSquareSdk(): Promise<void> {
    // Check if SDK is already loaded
    if (window.Square) {
      return;
    }

    // Load Square Web Payments SDK following official Quickstart pattern
    // Official SDK URL: https://web.squarecdn.com/v1/square.js
    const environment = (
      import.meta.env.VITE_SQUARE_ENVIRONMENT as string | undefined
    )?.trim() ?? 'production';
    
    // Use production SDK URL (sandbox uses same URL but different credentials)
    const sdkUrl = 'https://web.squarecdn.com/v1/square.js';
    
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = sdkUrl;
      script.async = true;
      script.crossOrigin = 'anonymous';
      
      script.onload = () => {
        if (!window.Square) {
          reject(new Error('Square SDK loaded but window.Square is not available'));
          return;
        }
        resolve();
      };
      
      script.onerror = () => {
        reject(new Error(`Failed to load Square Web SDK from ${sdkUrl}`));
      };
      
      document.head.appendChild(script);
    });
  }

  async initialize(config?: {
    applicationId?: string;
    locationId?: string;
    environment?: string;
  }): Promise<void> {
    if (!window.Square) {
      await this.loadSquareSdk();
    }

    const applicationId =
      (config?.applicationId ?? (import.meta.env.VITE_SQUARE_APPLICATION_ID as string | undefined))
        ?.trim();
    const locationId =
      (config?.locationId ?? (import.meta.env.VITE_SQUARE_LOCATION_ID as string | undefined))
        ?.trim();
    const environment =
      config?.environment ??
      ((import.meta.env.VITE_SQUARE_ENVIRONMENT as string | undefined)?.trim() ?? 'production');

    console.log('Square initialization:', {
      applicationId: applicationId
        ? `${applicationId.substring(0, 10)}...`
        : 'missing',
      locationId: locationId ? `${locationId.substring(0, 8)}...` : 'missing',
      environment,
    });

    if (!applicationId) {
      throw new Error('Square Application ID not configured');
    }

    if (!locationId) {
      throw new Error('Square Location ID not configured');
    }

    try {
      console.log('Initializing Square payments...');
      console.log('Square SDK version info:', window.Square);
      
      // Initialize Square Payments following official Quickstart pattern
      // payments(applicationId, locationId) returns a Payments object
      if (!window.Square || !window.Square.payments) {
        throw new Error('Square SDK not loaded correctly. window.Square.payments is not available.');
      }
      
      this.payments = window.Square.payments(applicationId, locationId);
      
      if (!this.payments) {
        throw new Error('Failed to create Square Payments instance');
      }
      
      console.log('Square Web Payments SDK initialized successfully');
      console.log('Available payment methods:', Object.keys(this.payments));
    } catch (error) {
      console.error('Failed to initialize Square payments:', error);
      throw error;
    }
  }

  async initializeCard(containerId: string): Promise<void> {
    if (!this.payments) {
      await this.initialize();
    }

    // TypeScript guard: ensure payments is initialized
    if (!this.payments) {
      throw new Error('Square Payments not initialized');
    }

    try {
      console.log('Creating Square card form...');
      
      // Create card payment method following official Quickstart pattern
      // card() returns a Promise<Card> object
      this.card = await this.payments.card();
      
      if (!this.card) {
        throw new Error('Failed to create Square Card instance');
      }
      
      console.log('Card form created, attaching to:', containerId);
      
      // Attach card form to DOM element
      // Official pattern: card.attach('#card-container')
      const containerSelector = `#${containerId}`;
      await this.card.attach(containerSelector);
      
      console.log('Square card form attached successfully');
    } catch (error) {
      console.error('Failed to initialize card form:', error);
      throw error;
    }
  }

  async tokenizeCard(): Promise<string> {
    if (!this.card) {
      throw new Error('Card form not initialized');
    }

    try {
      // Tokenize card following official Quickstart pattern
      // tokenize() returns Promise<TokenizeResult>
      // Result format: { status: 'OK' | 'FAILURE', token?: string, errors?: Array }
      const result = await this.card.tokenize();

      if (result.status === 'OK' && result.token) {
        console.log('Card tokenized successfully');
        console.log('Token preview:', result.token.substring(0, 20) + '...');
        return result.token;
      } else {
        // Handle tokenization errors
        const errorMessage = result.errors?.[0]?.detail ?? 'Card tokenization failed';
        console.error('Card tokenization failed:', {
          status: result.status,
          errors: result.errors,
          message: errorMessage,
        });
        throw new Error(errorMessage);
      }
    } catch (error) {
      console.error('Error tokenizing card:', error);
      throw error;
    }
  }

  async processPayment(
    token: string,
    amount: number,
    orderId: string,
    riskProfile?: string,
    includeErgc?: boolean,
    walletAddress?: string,
    userEmail?: string,
    paymentId?: string
  ): Promise<PaymentResponse> {
    try {
      // Use same origin for API calls (works in production)
      const apiUrl = '/api/square/process-payment';
      
      // CRITICAL: Validate wallet address format before sending to backend
      // The payment note MUST include the correct wallet address for webhook lookup
      let validatedWalletAddress = walletAddress;
      if (walletAddress) {
        const normalized = walletAddress.trim().toLowerCase();
        if (normalized.startsWith('0x') && normalized.length === 42) {
          validatedWalletAddress = normalized;
          console.log('[SquarePayment] ✅ Wallet address validated:', validatedWalletAddress);
        } else {
          console.error('[SquarePayment] ❌ Invalid wallet address format:', walletAddress);
          console.error('[SquarePayment] ❌ Expected: 0x followed by 40 hex characters (42 total)');
          console.error('[SquarePayment] ❌ Got:', {
            startsWith0x: walletAddress.startsWith('0x'),
            length: walletAddress.length,
            address: walletAddress
          });
          // Don't fail - backend will validate and log warning
          validatedWalletAddress = walletAddress; // Pass as-is, backend will handle validation
        }
      } else {
        console.warn('[SquarePayment] ⚠️ No wallet address provided');
      }
      
      console.log('Processing payment:', {
        token: token.substring(0, 20) + '...',
        amount,
        orderId,
        apiUrl,
        includeErgc,
        walletAddress: validatedWalletAddress,
        userEmail,
      });

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          source_id: token,
          amount: amount,
          currency: 'USD',
          idempotency_key: orderId,
          risk_profile: riskProfile,
          include_ergc: includeErgc ? 100 : 0, // 100 ERGC if buying
          wallet_address: validatedWalletAddress, // Use validated/normalized wallet address
          user_email: userEmail,
          payment_id: paymentId, // Include paymentId in request
        }),
      });

      // Get response text first to check if it's JSON
      const responseText = await response.text();
      const contentType = response.headers.get('content-type') || '';
      const isJson = contentType.includes('application/json');
      
      console.log('Payment API response:', {
        status: response.status,
        statusText: response.statusText,
        contentType,
        isJson,
        responseText: responseText.substring(0, 200),
      });

      // If not JSON, handle as error immediately
      if (!isJson) {
        console.error('Payment API returned non-JSON response:', {
          status: response.status,
          contentType,
          responseText: responseText.substring(0, 500),
        });
        
        if (response.status === 404) {
          throw new Error(
            'Payment endpoint not found (404). Please verify the backend is deployed and the route /api/square/process-payment exists.'
          );
        }
        
        if (response.status === 500) {
          // Try to extract error message from HTML or plain text
          const errorMatch = responseText.match(/FUNCTION_INVOCATION_FAILED|Internal server error|error/i);
          const errorMsg = errorMatch 
            ? `Server error: ${errorMatch[0]}`
            : `Server error (${response.status}). Please check the backend logs.`;
          throw new Error(errorMsg);
        }
        
        throw new Error(
          `Payment API returned invalid response (${response.status}): ${responseText.substring(0, 100)}`
        );
      }

      let result: PaymentResponse & { error?: string };
      
      try {
        result = JSON.parse(responseText) as PaymentResponse & {
          error?: string;
        };
      } catch (parseError) {
        // Response claims to be JSON but isn't valid JSON
        console.error('Failed to parse JSON response:', parseError);
        console.error('Response text:', responseText);
        
        throw new Error(
          `Payment API returned invalid JSON (${response.status}): ${responseText.substring(0, 100)}`
        );
      }

      if (!response.ok) {
        console.error('Payment API error:', result);
        throw new Error(result.error ?? `Payment processing failed (${response.status})`);
      }

      if (result.success) {
        console.log('Payment processed successfully:', result.paymentId);
        return result;
      } else {
        throw new Error(result.error ?? 'Payment failed');
      }
    } catch (error) {
      console.error('Payment processing error:', error);
      throw error;
    }
  }

  destroy(): void {
    if (this.card) {
      this.card.destroy();
      this.card = null;
    }
  }
}

// Singleton instance
export const squarePaymentService = new SquarePaymentService();

// Type definitions for Square Web SDK
declare global {
  interface Window {
    Square: SquareSDK;
  }
}

