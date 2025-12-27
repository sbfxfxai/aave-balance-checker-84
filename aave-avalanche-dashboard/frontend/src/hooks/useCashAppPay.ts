import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * Cash App Pay Kit SDK Hook
 * 
 * Loads and manages the Cash App Pay Kit SDK for seamless withdrawals.
 * Uses the official SDK from https://kit.cash.app/v1/pay.js
 * 
 * Documentation: https://developer.squareup.com/docs/cash-app-pay
 */

// =============================================================================
// PAY KIT SDK TYPE DEFINITIONS (from official docs)
// =============================================================================

// Customer who approved the request
interface Customer {
  /** Public identifier for the customer on Cash App ($cashtag) */
  cashtag: string;
  /** Unique identifier for this customer issued by Cash App */
  id: string;
}

// Grant detail for approved actions
interface GrantDetail {
  /** When the grant will expire */
  expiresAt: Date;
  /** ID of Grant that can be used to create a payment */
  grantId: string;
}

// Amount to charge
interface Amount {
  /** "USD" is currently the only accepted value */
  currency: 'USD';
  /** The lowest unit of the associated currency (cents for USD) */
  value: number;
}

// Payment action
interface PaymentAction {
  /** The amount to charge the customer (optional) */
  amount?: Amount;
  /** The ID of the client, brand, or merchant account that will charge customers */
  scopeId: string;
}

// On-file action for recurring payments
interface OnFileAction {
  /** ID of the client or brand account that will charge Customers */
  scopeId: string;
  /** Identifier of the account or Customer associated to the on-file action */
  accountReferenceId?: string;
}

// Actions object - at least one must exist
interface Actions {
  payment?: PaymentAction;
  onFile?: OnFileAction;
}

// Customer request details
interface CustomerRequestDetails {
  /** Actions the customer will allow the merchant to perform */
  actions: Actions;
  /** The destination for the customer after approving in Cash App (must be secure URL) */
  redirectURL: string;
  /** A reference to your system (max 1024 characters) */
  referenceId?: string;
}

// Customer request controller returned by customerRequest()
interface CustomerRequestController {
  /** Update the customer request (redirectURL cannot be changed) */
  update: (details: CustomerRequestDetails) => Promise<boolean>;
}

// Render controller returned by render()
interface RenderController {
  /** Begin the authorization flow (if manage was false) */
  begin: () => void;
  /** Remove the Cash App Pay UI from DOM */
  destroy: () => void;
}

// Button options for render()
interface ButtonOptions {
  /** The shape of the Cash App Pay button. Defaults to "round" */
  shape?: 'round' | 'semiround';
  /** The size of the Cash App Pay button. Defaults to "medium" */
  size?: 'medium' | 'small';
  /** The theme of the Cash App Pay button. Defaults to "dark" */
  theme?: 'dark' | 'light';
  /** The width of the Cash App Pay button. Defaults to "static" */
  width?: 'full' | 'static';
}

// Render options
interface RenderOptions {
  /** Button options, or false to not render a button */
  button?: ButtonOptions | false;
  /** If true, Pay Kit will manage beginning the authorization flow. Defaults to true */
  manage?: boolean;
}

// Event types
type PayEventType =
  | 'CUSTOMER_INTERACTION'
  | 'CUSTOMER_DISMISSED'
  | 'CUSTOMER_REQUEST_APPROVED'
  | 'CUSTOMER_REQUEST_DECLINED'
  | 'CUSTOMER_REQUEST_FAILED';

// Customer interaction event data
interface CustomerInteractionData {
  /** True if the customer is using a mobile device where Cash App can be installed */
  isMobile: boolean;
}

// Customer request approved event data
interface CustomerRequestData {
  /** Customer who approved the request */
  customerProfile: Customer;
  /** A map of actions to details about a grant */
  grants: Partial<Record<keyof Actions, GrantDetail>>;
  /** A reference to your system */
  referenceId?: string;
}

// Union type for event data (DECLINED and FAILED events don't receive data)
type PayEventData = CustomerInteractionData | CustomerRequestData | undefined;

// Pay instance interface
interface PayInstance {
  /** Add an event listener */
  addEventListener: (type: PayEventType, listener: (data: PayEventData) => void) => void;
  /** Remove an event listener */
  removeEventListener: (type: PayEventType, listener: (data: PayEventData) => void) => void;
  /** Create a customer request */
  customerRequest: (details: CustomerRequestDetails) => Promise<CustomerRequestController>;
  /** Render the Cash App Pay UI */
  render: (target: string | HTMLElement, options?: RenderOptions) => Promise<RenderController>;
  /** Remove all rendered UI and current customer request */
  restart: () => void;
}

// Extend Window interface for Cash App Pay Kit
declare global {
  interface Window {
    CashApp?: {
      pay: (config: { clientId: string }) => Promise<PayInstance>;
    };
  }
}

// =============================================================================
// HOOK TYPES
// =============================================================================

interface UseCashAppPayOptions {
  clientId: string;
  merchantId: string;
  brandId?: string;
  sandbox?: boolean;
  onApproved?: (data: CustomerRequestData) => void;
  onDeclined?: () => void;
  onFailed?: (error: Record<string, unknown>) => void;
  onDismissed?: () => void;
}

interface UseCashAppPayReturn {
  isLoaded: boolean;
  isLoading: boolean;
  error: string | null;
  payInstance: PayInstance | null;
  createPaymentRequest: (amount: number, referenceId: string) => Promise<void>;
  renderButton: (selector: string, options?: ButtonOptions) => Promise<void>;
  restart: () => void;
  approvalData: CustomerRequestData | null;
}

export function useCashAppPay(options: UseCashAppPayOptions): UseCashAppPayReturn {
  const {
    clientId,
    merchantId,
    brandId,
    sandbox = true,
    onApproved,
    onDeclined,
    onFailed,
    onDismissed,
  } = options;

  const [isLoaded, setIsLoaded] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [approvalData, setApprovalData] = useState<CustomerRequestData | null>(null);
  const payInstanceRef = useRef<PayInstance | null>(null);
  const scriptLoadedRef = useRef(false);

  // Load the Pay Kit script
  useEffect(() => {
    if (scriptLoadedRef.current || !clientId) return;

    const loadScript = async () => {
      setIsLoading(true);
      setError(null);

      try {
        // Check if script already exists
        const existingScript = document.querySelector(
          `script[src*="kit.cash.app"]`
        );

        if (!existingScript) {
          const script = document.createElement('script');
          script.src = sandbox
            ? 'https://sandbox.kit.cash.app/v1/pay.js'
            : 'https://kit.cash.app/v1/pay.js';
          script.async = true;

          await new Promise<void>((resolve, reject) => {
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Failed to load Cash App Pay Kit'));
            document.head.appendChild(script);
          });
        }

        // Wait for CashApp to be available
        let attempts = 0;
        while (!window.CashApp && attempts < 50) {
          await new Promise(resolve => setTimeout(resolve, 100));
          attempts++;
        }

        if (!window.CashApp) {
          throw new Error('Cash App Pay Kit failed to initialize');
        }

        // Initialize Pay Kit
        const pay = await window.CashApp.pay({ clientId });
        payInstanceRef.current = pay;

        // Set up event listeners
        pay.addEventListener('CUSTOMER_REQUEST_APPROVED', (data) => {
          const requestData = data as CustomerRequestData;
          console.log('[CashApp] Request approved:', requestData);
          setApprovalData(requestData);
          onApproved?.(requestData);
        });

        pay.addEventListener('CUSTOMER_REQUEST_DECLINED', () => {
          console.log('[CashApp] Request declined');
          onDeclined?.();
        });

        pay.addEventListener('CUSTOMER_REQUEST_FAILED', (data) => {
          console.error('[CashApp] Request failed:', data);
          setError('Cash App request failed');
          onFailed?.(data as unknown as Record<string, unknown>);
        });

        pay.addEventListener('CUSTOMER_DISMISSED', () => {
          console.log('[CashApp] Customer dismissed');
          onDismissed?.();
        });

        scriptLoadedRef.current = true;
        setIsLoaded(true);
        console.log('[CashApp] Pay Kit initialized successfully');

      } catch (err) {
        console.error('[CashApp] Failed to load Pay Kit:', err);
        setError(err instanceof Error ? err.message : 'Failed to load Cash App Pay');
      } finally {
        setIsLoading(false);
      }
    };

    loadScript();
  }, [clientId, sandbox, onApproved, onDeclined, onFailed, onDismissed]);

  // Create a payment request
  const createPaymentRequest = useCallback(async (amount: number, referenceId: string) => {
    if (!payInstanceRef.current) {
      throw new Error('Cash App Pay Kit not initialized');
    }

    const details: CustomerRequestDetails = {
      referenceId,
      redirectURL: window.location.href,
      actions: {
        payment: {
          amount: {
            currency: 'USD',
            value: Math.round(amount * 100), // Convert to cents
          },
          scopeId: merchantId,
        },
      },
    };

    // Add on-file action if brand ID is provided (for recurring payments)
    if (brandId) {
      details.actions.onFile = {
        scopeId: brandId,
        accountReferenceId: referenceId,
      };
    }

    await payInstanceRef.current.customerRequest(details);
  }, [merchantId, brandId]);

  // Render the Cash App Pay button
  const renderButton = useCallback(async (selector: string, buttonOptions?: any) => {
    if (!payInstanceRef.current) {
      throw new Error('Cash App Pay Kit not initialized');
    }

    await payInstanceRef.current.render(selector, {
      button: {
        shape: 'semiround',
        size: 'medium',
        theme: 'dark',
        width: 'full',
        ...buttonOptions,
      },
    });
  }, []);

  // Restart Pay Kit (for new orders)
  const restart = useCallback(() => {
    if (payInstanceRef.current) {
      payInstanceRef.current.restart();
      setApprovalData(null);
    }
  }, []);

  return {
    isLoaded,
    isLoading,
    error,
    payInstance: payInstanceRef.current,
    createPaymentRequest,
    renderButton,
    restart,
    approvalData,
  };
}
