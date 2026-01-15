/**
 * Test Endpoint for Aave Supply Flow
 * 
 * Provides HTTP endpoints for testing:
 * - Supply cap validation
 * - Error classification
 * - Transaction flow simulation
 * - Position status transitions
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  testSupplyCapValidation,
  testErrorClassification,
  simulateTransactionFlow,
  testPositionStatusTransitions,
  generateTestReport
} from './test-utilities';
import { ethers } from 'ethers';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<VercelResponse> {
  // Require authentication
  const authToken = req.headers.authorization?.replace('Bearer ', '');
  const expectedToken = process.env.TEST_ENDPOINT_TOKEN;

  if (expectedToken && authToken !== expectedToken) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized'
    });
  }

  const { test } = req.query;
  const params = req.query;

  try {
    switch (test) {
      case 'supply-cap':
        const amount = params.amount ? parseFloat(Array.isArray(params.amount) ? params.amount[0] : params.amount) : 1000;
        const mockCap = params.mockCap ? BigInt(Array.isArray(params.mockCap) ? params.mockCap[0] : params.mockCap) : undefined;
        const result = await testSupplyCapValidation(
          ethers.parseUnits(amount.toString(), 6),
          mockCap
        );
        return res.status(200).json({ success: true, result });

      case 'error-classification':
        const errorMessages = params.messages
          ? (Array.isArray(params.messages) ? params.messages[0] : params.messages).split(',')
          : [
              'Supply cap exceeded',
              'Insufficient balance',
              'USDC approval failed'
            ];
        const classifications = testErrorClassification(errorMessages);
        return res.status(200).json({ success: true, classifications });

      case 'flow-simulation':
        const scenario = params.scenario 
          ? (Array.isArray(params.scenario) ? params.scenario[0] : params.scenario) as 'success' | 'cap_exceeded' | 'insufficient_balance' | 'network_error'
          : 'success';
        const simulation = await simulateTransactionFlow(scenario);
        return res.status(200).json({ success: true, simulation });

      case 'status-transitions':
        const transitions = testPositionStatusTransitions();
        return res.status(200).json({ success: true, transitions });

      case 'full-report':
        const report = await generateTestReport();
        return res.status(200).json({ success: true, report });

      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid test type',
          availableTests: [
            'supply-cap',
            'error-classification',
            'flow-simulation',
            'status-transitions',
            'full-report'
          ]
        });
    }
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Test failed'
    });
  }
}
