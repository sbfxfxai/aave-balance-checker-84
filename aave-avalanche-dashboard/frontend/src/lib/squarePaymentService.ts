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
    if (window.Square) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://web.squarecdn.com/v1/square.js';
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Square Web SDK'));
      document.head.appendChild(script);
    });
  }

  async initialize(): Promise<void> {
    if (!window.Square) {
      await this.loadSquareSdk();
    }

    const applicationId = (
      import.meta.env.VITE_SQUARE_APPLICATION_ID as string | undefined
    )?.trim();
    const locationId = (
      import.meta.env.VITE_SQUARE_LOCATION_ID as string | undefined
    )?.trim();
    const environment =
      (
        import.meta.env.VITE_SQUARE_ENVIRONMENT as string | undefined
      )?.trim() ?? 'production';

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
      this.payments = window.Square.payments(applicationId, locationId);
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

    try {
      console.log('Creating Square card form...');
      this.card = await this.payments.card();
      console.log('Card form created, attaching to:', containerId);
      await this.card.attach(`#${containerId}`);
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
      const result = await this.card.tokenize();

      if (result.status === 'OK' && result.token) {
        console.log('Card tokenized successfully');
        return result.token;
      } else {
        console.error('Card tokenization failed:', result.errors);
        throw new Error(
          result.errors?.[0]?.detail ?? 'Card tokenization failed'
        );
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
    riskProfile?: string
  ): Promise<PaymentResponse> {
    try {
      // Use same origin for API calls (works in production)
      const apiUrl = '/api/square/process-payment';
      
      console.log('Processing payment:', {
        token: token.substring(0, 20) + '...',
        amount,
        orderId,
        apiUrl,
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
        }),
      });

      // Get response text first to check if it's JSON
      const responseText = await response.text();
      console.log('Payment API response:', {
        status: response.status,
        statusText: response.statusText,
        contentType: response.headers.get('content-type'),
        responseText: responseText.substring(0, 200),
      });

      let result: PaymentResponse & { error?: string };
      
      try {
        result = JSON.parse(responseText) as PaymentResponse & {
          error?: string;
        };
      } catch (parseError) {
        // Response is not JSON - likely HTML error page
        console.error('Failed to parse JSON response:', parseError);
        console.error('Response text:', responseText);
        
        if (response.status === 404) {
          throw new Error(
            'Payment endpoint not found (404). Please verify the backend is deployed and the route /api/square/process-payment exists.'
          );
        }
        
        throw new Error(
          `Payment API returned invalid response (${response.status}): ${responseText.substring(0, 100)}`
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

