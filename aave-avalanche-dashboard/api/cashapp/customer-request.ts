import type { VercelRequest, VercelResponse } from '@vercel/node';
import { CASHAPP_CONFIG, getCashAppHeaders, generateIdempotencyKey } from './config';

interface CustomerRequestBody {
  amount: number; // Amount in cents
  referenceId: string; // External reference (e.g., wallet address or user ID)
  channel?: 'ONLINE' | 'IN_APP' | 'IN_PERSON';
}

interface CustomerRequestResponse {
  id: string;
  status: string;
  auth_flow_triggers?: {
    qr_code_image_url?: string;
    mobile_url?: string;
    desktop_url?: string;
    refreshes_at?: string;
  };
  grants?: Array<{
    id: string;
    type: string;
    status: string;
  }>;
}

// Create a customer request for Cash App Pay linking
async function createCustomerRequest(
  amount: number,
  referenceId: string,
  channel: string = 'ONLINE'
): Promise<CustomerRequestResponse> {
  const response = await fetch(
    `${CASHAPP_CONFIG.BASE_URL}/customer-request/v1/requests`,
    {
      method: 'POST',
      headers: getCashAppHeaders(true), // Client-side API
      body: JSON.stringify({
        request: {
          actions: [
            {
              amount,
              currency: 'USD',
              scope_id: CASHAPP_CONFIG.MERCHANT_ID || CASHAPP_CONFIG.BRAND_ID || CASHAPP_CONFIG.CLIENT_ID,
              type: 'ONE_TIME_PAYMENT',
            },
          ],
          reference_id: referenceId,
          channel,
        },
        idempotency_key: generateIdempotencyKey(),
      }),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Cash App API error: ${response.status} - ${error}`);
  }

  return response.json();
}

// Retrieve customer request status (for polling)
async function retrieveCustomerRequest(requestId: string): Promise<CustomerRequestResponse> {
  const response = await fetch(
    `${CASHAPP_CONFIG.BASE_URL}/customer-request/v1/requests/${requestId}`,
    {
      method: 'GET',
      headers: getCashAppHeaders(true),
    }
  );

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Cash App API error: ${response.status} - ${error}`);
  }

  return response.json();
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (req.method === 'POST') {
      // Create new customer request
      const { amount, referenceId, channel } = req.body as CustomerRequestBody;

      if (!amount || !referenceId) {
        return res.status(400).json({ error: 'Missing required fields: amount, referenceId' });
      }

      const result = await createCustomerRequest(amount, referenceId, channel);
      
      return res.status(200).json({
        success: true,
        requestId: result.id,
        status: result.status,
        qrCodeUrl: result.auth_flow_triggers?.qr_code_image_url,
        mobileUrl: result.auth_flow_triggers?.mobile_url,
        desktopUrl: result.auth_flow_triggers?.desktop_url,
        refreshesAt: result.auth_flow_triggers?.refreshes_at,
      });
    }

    if (req.method === 'GET') {
      // Retrieve existing customer request (for polling)
      const { requestId } = req.query;

      if (!requestId || typeof requestId !== 'string') {
        return res.status(400).json({ error: 'Missing requestId query parameter' });
      }

      const result = await retrieveCustomerRequest(requestId);
      
      // Extract grant IDs if approved
      const grants = result.grants?.map(g => ({ id: g.id, type: g.type, status: g.status })) || [];
      
      return res.status(200).json({
        success: true,
        requestId: result.id,
        status: result.status,
        qrCodeUrl: result.auth_flow_triggers?.qr_code_image_url,
        mobileUrl: result.auth_flow_triggers?.mobile_url,
        desktopUrl: result.auth_flow_triggers?.desktop_url,
        refreshesAt: result.auth_flow_triggers?.refreshes_at,
        grants,
        isApproved: result.status === 'APPROVED',
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Cash App customer request error:', error);
    return res.status(500).json({
      error: 'Failed to process Cash App request',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
