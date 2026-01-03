/**
 * Jest setup file for API tests
 */

import { jest } from '@jest/globals';

// Mock environment variables
process.env.AVALANCHE_RPC_URL = 'https://api.avax.network/ext/bc/C/rpc';
process.env.ERGC_CONTRACT = '0xDC353b94284E7d3aEAB2588CEA3082b9b87C184B';
process.env.SQUARE_ACCESS_TOKEN = 'test_token';
process.env.SQUARE_LOCATION_ID = 'test_location';
process.env.SQUARE_WEBHOOK_SIGNATURE_KEY = 'test_signature_key';

// Increase timeout for async operations
jest.setTimeout(30000);
