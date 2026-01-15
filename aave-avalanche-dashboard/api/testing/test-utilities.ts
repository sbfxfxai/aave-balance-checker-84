/**
 * Testing Utilities for Aave Supply Flow
 * 
 * Provides utilities for:
 * - Simulating supply cap scenarios
 * - Testing error paths
 * - Validating transaction flows
 * - Mocking Aave contracts
 */

import { ethers } from 'ethers';
import { logger, LogCategory } from '../utils/logger';

// Test configuration
const AVALANCHE_RPC = process.env.AVALANCHE_RPC_URL || 'https://api.avax.network/ext/bc/C/rpc';
const USDC_CONTRACT = process.env.USDC_CONTRACT || '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E';
const AAVE_POOL = process.env.AAVE_POOL || '0x794a61358D6845594F94dc1DB02A252b5b4814aD';
const AAVE_POOL_DATA_PROVIDER = process.env.AAVE_POOL_DATA_PROVIDER || '0x69FA688f1Dc47d4B5d8029D5a35FB7a548310654';

/**
 * Test supply cap validation
 */
export async function testSupplyCapValidation(
  usdcAmount: bigint,
  mockCap?: bigint
): Promise<{
  success: boolean;
  currentSupply: string;
  supplyCap: string | null;
  projectedTotal: string;
  utilizationPercent: number | null;
  wouldExceed: boolean;
}> {
  try {
    const provider = new ethers.JsonRpcProvider(AVALANCHE_RPC);
    const dataProvider = new ethers.Contract(
      AAVE_POOL_DATA_PROVIDER,
      ['function getReserveData(address asset) view returns (uint256 unbacked, uint256 accruedToTreasuryScaled, uint256 totalAToken, uint256 totalStableDebt, uint256 totalVariableDebt, uint256 liquidityRate, uint256 variableBorrowRate, uint256 stableBorrowRate, uint256 averageStableBorrowRate, uint256 liquidityIndex, uint256 variableBorrowIndex, uint40 lastUpdateTimestamp)'],
      provider
    );

    const reserveData = await dataProvider.getReserveData(USDC_CONTRACT);
    const currentSupply = reserveData.totalAToken as bigint;
    
    // Use mock cap if provided, otherwise query real cap
    let supplyCap: bigint | null = mockCap || null;
    
    if (!supplyCap) {
      // Try to get real cap
      try {
        const addressesProvider = new ethers.Contract(
          process.env.AAVE_ADDRESSES_PROVIDER || '0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb',
          [
            'function getAddress(bytes32 id) view returns (address)',
            'function getPoolConfigurator() view returns (address)'
          ],
          provider
        );
        
        // Use the specific getPoolConfigurator() method instead of generic getAddress()
        const poolConfiguratorAddress = await addressesProvider.getPoolConfigurator();
        
        if (poolConfiguratorAddress && poolConfiguratorAddress !== ethers.ZeroAddress) {
          const poolConfigurator = new ethers.Contract(
            poolConfiguratorAddress,
            ['function getSupplyCap(address asset) view returns (uint256)'],
            provider
          );
          
          supplyCap = await poolConfigurator.getSupplyCap(USDC_CONTRACT) as bigint;
        }
      } catch (error) {
        logger.warn('Could not retrieve supply cap for test', LogCategory.API, {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }

    const projectedTotal = currentSupply + usdcAmount;
    const utilizationPercent = supplyCap && supplyCap > 0n
      ? (Number(projectedTotal) / Number(supplyCap)) * 100
      : null;
    
    const wouldExceed = supplyCap ? projectedTotal > supplyCap : false;

    return {
      success: true,
      currentSupply: ethers.formatUnits(currentSupply, 6),
      supplyCap: supplyCap ? ethers.formatUnits(supplyCap, 6) : null,
      projectedTotal: ethers.formatUnits(projectedTotal, 6),
      utilizationPercent,
      wouldExceed
    };
  } catch (error) {
    logger.error('Supply cap validation test failed', LogCategory.API, {
      error: error instanceof Error ? error.message : String(error)
    });

    return {
      success: false,
      currentSupply: '0',
      supplyCap: null,
      projectedTotal: '0',
      utilizationPercent: null,
      wouldExceed: false
    };
  }
}

/**
 * Test error classification
 */
export function testErrorClassification(errorMessages: string[]): Record<string, string> {
  const classifications: Record<string, string> = {};

  errorMessages.forEach(msg => {
    let classification = 'unknown';
    
    const lower = msg.toLowerCase();
    if (lower.includes('supply cap') || lower.includes('cap exceeded') || lower.includes('51')) {
      classification = 'supply_cap';
    } else if (lower.includes('insufficient') || lower.includes('balance')) {
      classification = 'insufficient_balance';
    } else if (lower.includes('approval') || lower.includes('allowance')) {
      classification = 'approval_failed';
    } else if (lower.includes('network') || lower.includes('timeout') || lower.includes('econnrefused')) {
      classification = 'network_error';
    } else if (lower.includes('revert') || lower.includes('failed')) {
      classification = 'transaction_failed';
    }

    classifications[msg] = classification;
  });

  return classifications;
}

/**
 * Simulate transaction flow with various scenarios
 */
export async function simulateTransactionFlow(scenario: 'success' | 'cap_exceeded' | 'insufficient_balance' | 'network_error'): Promise<{
  success: boolean;
  steps: Array<{ step: string; success: boolean; error?: string }>;
  finalStatus: string;
}> {
  const steps: Array<{ step: string; success: boolean; error?: string }> = [];

  // Step 1: AVAX Transfer
  steps.push({
    step: 'AVAX Transfer',
    success: scenario !== 'network_error'
  });

  if (scenario === 'network_error') {
    return {
      success: false,
      steps,
      finalStatus: 'failed'
    };
  }

  // Step 2: Supply Cap Check
  if (scenario === 'cap_exceeded') {
    steps.push({
      step: 'Supply Cap Validation',
      success: false,
      error: 'Supply cap would be exceeded'
    });
    return {
      success: false,
      steps,
      finalStatus: 'gas_sent_cap_failed'
    };
  }

  steps.push({
    step: 'Supply Cap Validation',
    success: true
  });

  // Step 3: Balance Check
  if (scenario === 'insufficient_balance') {
    steps.push({
      step: 'Balance Check',
      success: false,
      error: 'Insufficient USDC in hub wallet'
    });
    return {
      success: false,
      steps,
      finalStatus: 'failed'
    };
  }

  steps.push({
    step: 'Balance Check',
    success: true
  });

  // Step 4: Approval
  steps.push({
    step: 'USDC Approval',
    success: true
  });

  // Step 5: Supply
  steps.push({
    step: 'Aave Supply',
    success: true
  });

  return {
    success: true,
    steps,
    finalStatus: 'active'
  };
}

/**
 * Test position status transitions
 */
export function testPositionStatusTransitions(): Array<{
  from: string;
  to: string;
  trigger: string;
  valid: boolean;
}> {
  const validTransitions: Record<string, string[]> = {
    'pending': ['executing', 'avax_sent', 'failed'],
    'executing': ['avax_sent', 'active', 'failed'],
    'avax_sent': ['active', 'supply_failed', 'gas_sent_cap_failed', 'failed'],
    'supply_failed': ['failed_refund_pending'],
    'gas_sent_cap_failed': ['failed_refund_pending'],
    'active': ['withdrawn', 'closed'],
    'failed': [],
    'failed_refund_pending': ['closed']
  };

  const transitions: Array<{ from: string; to: string; trigger: string; valid: boolean }> = [];

  Object.entries(validTransitions).forEach(([from, toStates]) => {
    toStates.forEach(to => {
      transitions.push({
        from,
        to,
        trigger: `Transaction ${to === 'active' ? 'succeeds' : 'fails'}`,
        valid: true
      });
    });

    // Test invalid transitions
    const allStates = Object.keys(validTransitions);
    allStates.forEach(to => {
      if (!toStates.includes(to) && from !== to) {
        transitions.push({
          from,
          to,
          trigger: 'Invalid transition attempt',
          valid: false
        });
      }
    });
  });

  return transitions;
}

/**
 * Generate test report
 */
export async function generateTestReport(): Promise<{
  supplyCapTest: Awaited<ReturnType<typeof testSupplyCapValidation>>;
  errorClassification: ReturnType<typeof testErrorClassification>;
  flowSimulations: Array<Awaited<ReturnType<typeof simulateTransactionFlow>>>;
  statusTransitions: ReturnType<typeof testPositionStatusTransitions>;
}> {
  const errorMessages = [
    'Supply cap exceeded',
    'Insufficient balance',
    'USDC approval failed',
    'Network timeout',
    'Transaction reverted',
    'Unknown error'
  ];

  const scenarios: Array<'success' | 'cap_exceeded' | 'insufficient_balance' | 'network_error'> = [
    'success',
    'cap_exceeded',
    'insufficient_balance',
    'network_error'
  ];

  const [supplyCapTest, ...flowSimulations] = await Promise.all([
    testSupplyCapValidation(ethers.parseUnits('1000', 6)), // Test with 1000 USDC
    ...scenarios.map(s => simulateTransactionFlow(s))
  ]);

  return {
    supplyCapTest,
    errorClassification: testErrorClassification(errorMessages),
    flowSimulations,
    statusTransitions: testPositionStatusTransitions()
  };
}
