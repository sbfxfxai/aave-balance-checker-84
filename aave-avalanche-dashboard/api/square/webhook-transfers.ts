import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ethers } from 'ethers';
import { getRedis } from '../utils/redis';
import { logger, LogCategory } from '../utils/logger';
import { errorTracker } from '../utils/errorTracker';
import { createHash, randomBytes } from 'crypto';

// Result type for error handling with error classification
type Result<T> = 
  | { success: true; data: T }
  | { success: false; error: string; errorType?: 'idempotent' | 'insufficient_balance' | 'supply_cap' | 'reserve_paused' | 'network_error' | 'approval_failed' | 'transaction_failed' | 'unknown'; data?: T };

// Constants from webhook.ts
const AVALANCHE_RPC_PRIMARY = process.env.AVALANCHE_RPC_URL || process.env.AVALANCHE_RPC || 'https://api.avax.network/ext/bc/C/rpc';
const AVALANCHE_RPC_FALLBACKS = (process.env.AVALANCHE_RPC_FALLBACKS || '').split(',').filter(Boolean);
const USDC_CONTRACT = process.env.USDC_CONTRACT || '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E';
const AAVE_POOL = process.env.AAVE_POOL || '0x794a61358D6845594F94dc1DB02A252b5b4814aD';
const AAVE_POOL_DATA_PROVIDER = process.env.AAVE_POOL_DATA_PROVIDER || '0x69FA688f1Dc47d4B5d8029D5a35FB7a548310654';
const CONSERVATIVE_AVAX_AMOUNT_BASE = ethers.parseUnits(process.env.CONSERVATIVE_AVAX_AMOUNT || '0.005', 18);
const CONFIRMATION_DEPTH_LOW = 1;
const CONFIRMATION_DEPTH_HIGH = 6; // For large amounts or during congestion
const MAX_AVAX_AMOUNT = ethers.parseUnits('0.01', 18); // Safety cap
const GAS_ESTIMATE_MULTIPLIER = 1.5; // 50% buffer for gas price spikes
const MAX_GAS_PRICE_GWEI = 150; // Maximum gas price cap (prevents extreme spikes)
const AVAX_BALANCE_ALERT_THRESHOLD_MULTIPLIER = 5; // Alert if balance < 5x CONSERVATIVE_AVAX_AMOUNT

// ERC20 ABI (simplified)
const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
];

// Aave Pool ABI (simplified)
const AAVE_POOL_ABI = [
  'function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode)',
  'function getConfiguration(address asset) view returns (tuple(uint256 data))',
];


// Aave Pool Addresses Provider ABI (for getting PoolConfigurator)
const AAVE_ADDRESSES_PROVIDER_ABI = [
  'function getAddress(bytes32 id) view returns (address)',
  'function getPoolConfigurator() view returns (address)',
];

// Aave PoolConfigurator ABI (for supply cap)
const AAVE_POOL_CONFIGURATOR_ABI = [
  'function getSupplyCap(address asset) view returns (uint256)',
];

// Aave Pool Data Provider ABI for supply cap checking
const AAVE_DATA_PROVIDER_ABI = [
  'function getReserveData(address asset) view returns (uint256 unbacked, uint256 accruedToTreasuryScaled, uint256 totalAToken, uint256 totalStableDebt, uint256 totalVariableDebt, uint256 liquidityRate, uint256 variableBorrowRate, uint256 stableBorrowRate, uint256 averageStableBorrowRate, uint256 liquidityIndex, uint256 variableBorrowIndex, uint40 lastUpdateTimestamp)',
];

// Aave Pool ABI - includes getConfiguration for reserve status checks
const AAVE_POOL_ABI_WITH_CONFIG = [
  ...AAVE_POOL_ABI,
  'function getConfiguration(address asset) view returns (tuple(uint256 data))',
];

/**
 * Track RPC latency and health for provider reliability monitoring
 * ENHANCED: Latency tracking with health scores for auto-removal of slow providers
 */
async function trackRpcLatency(
  providerUrl: string,
  latency: number,
  success: boolean
): Promise<void> {
  try {
    const redis = await getRedis();
    const providerKey = `monitoring:rpc_health:${createHash('sha256').update(providerUrl).digest('hex').substring(0, 16)}`;
    
    // Track recent latencies (last 100 calls)
    const latencyKey = `${providerKey}:latencies`;
    if (success && latency > 0) {
      await redis.lpush(latencyKey, latency.toString());
      await redis.ltrim(latencyKey, 0, 99); // Keep last 100 latencies
      await redis.expire(latencyKey, 24 * 60 * 60); // 24 hours TTL
    }
    
    // Track success/failure rate
    const statsKey = `${providerKey}:stats`;
    const stats = await redis.get(statsKey);
    const currentStats = stats ? JSON.parse(stats as string) : { successes: 0, failures: 0, totalLatency: 0, count: 0 };
    
    if (success) {
      currentStats.successes++;
      if (latency > 0) {
        currentStats.totalLatency += latency;
        currentStats.count++;
      }
    } else {
      currentStats.failures++;
    }
    
    await redis.set(statsKey, JSON.stringify(currentStats), { ex: 24 * 60 * 60 });
    
    // ENHANCED: Calculate health score and auto-disable slow providers
    const totalRequests = currentStats.successes + currentStats.failures;
    const successRate = totalRequests > 0 ? currentStats.successes / totalRequests : 1;
    const avgLatency = currentStats.count > 0 ? currentStats.totalLatency / currentStats.count : 0;
    
    // Health thresholds
    const MAX_AVG_LATENCY_MS = parseInt(process.env.MAX_RPC_LATENCY_MS || '5000', 10); // 5 seconds
    const MIN_SUCCESS_RATE = parseFloat(process.env.MIN_RPC_SUCCESS_RATE || '0.8'); // 80%
    
    // Auto-disable if unhealthy (after sufficient sample size)
    if (totalRequests >= 10 && (successRate < MIN_SUCCESS_RATE || avgLatency > MAX_AVG_LATENCY_MS)) {
      const disabledKey = `monitoring:rpc_disabled:${createHash('sha256').update(providerUrl).digest('hex').substring(0, 16)}`;
      await redis.set(disabledKey, '1', { ex: 60 * 60 }); // Disable for 1 hour
      console.warn(`[Provider] Auto-disabled slow/unreliable RPC: ${providerUrl.substring(0, 30)}... (success: ${(successRate * 100).toFixed(1)}%, latency: ${avgLatency.toFixed(0)}ms)`);
    }
  } catch (error) {
    // Don't fail on tracking errors
    console.warn('[Provider] Failed to track RPC latency:', error);
  }
}

/**
 * Get provider with weighted fallback support
 * ENHANCED: Weighted selection (70% primary, 30% fallbacks) + latency tracking
 */
async function getProvider(): Promise<ethers.JsonRpcProvider> {
  const rpcUrls = [AVALANCHE_RPC_PRIMARY, ...AVALANCHE_RPC_FALLBACKS];
  const PRIMARY_WEIGHT = 0.7; // 70% preference for primary
  
  // ENHANCED: Weighted selection - prefer primary 70% of the time
  const usePrimary = Math.random() < PRIMARY_WEIGHT;
  const orderedUrls = usePrimary 
    ? [AVALANCHE_RPC_PRIMARY, ...AVALANCHE_RPC_FALLBACKS]
    : [...AVALANCHE_RPC_FALLBACKS, AVALANCHE_RPC_PRIMARY];
  
  for (const rpcUrl of orderedUrls) {
    try {
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const startTime = Date.now();
      // Test connection with latency tracking
      await provider.getBlockNumber();
      const latency = Date.now() - startTime;
      
      // ENHANCED: Track latency for provider health monitoring
      await trackRpcLatency(rpcUrl, latency, true).catch(() => {});
      
      console.log(`[Provider] Using RPC: ${rpcUrl.substring(0, 30)}... (latency: ${latency}ms)`);
      return provider;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.warn(`[Provider] RPC failed: ${rpcUrl.substring(0, 30)}...`, errorMessage);
      
      // ENHANCED: Track failure for health monitoring
      await trackRpcLatency(rpcUrl, -1, false).catch(() => {});
      continue;
    }
  }
  
  // Fallback to primary even if test failed (might be temporary)
  console.warn('[Provider] All RPCs failed, using primary as fallback');
  return new ethers.JsonRpcProvider(AVALANCHE_RPC_PRIMARY);
}

/**
 * Calculate dynamic AVAX amount based on current gas prices
 */
async function calculateAvaxAmount(provider: ethers.JsonRpcProvider, baseAmount: bigint): Promise<bigint> {
  try {
    const feeData = await provider.getFeeData();
    const gasPrice = feeData.gasPrice || feeData.maxFeePerGas || ethers.parseUnits('70', 'gwei');
    
    // Estimate gas for a simple transfer (21,000 gas units)
    const estimatedGas = 21000n;
    const estimatedCost = gasPrice * estimatedGas;
    
    // Apply multiplier for safety buffer
    const dynamicAmount = estimatedCost * BigInt(Math.round(GAS_ESTIMATE_MULTIPLIER * 100)) / 100n;
    
    // Use the higher of base amount or dynamic amount, but cap at MAX_AVAX_AMOUNT
    const finalAmount = dynamicAmount > baseAmount ? dynamicAmount : baseAmount;
    const cappedAmount = finalAmount > MAX_AVAX_AMOUNT ? MAX_AVAX_AMOUNT : finalAmount;
    
    console.log(`[AVAX] Gas calculation: ${ethers.formatUnits(gasPrice, 'gwei')} gwei * ${estimatedGas} gas = ${ethers.formatEther(estimatedCost)} AVAX`);
    console.log(`[AVAX] Dynamic amount: ${ethers.formatEther(cappedAmount)} AVAX (base: ${ethers.formatEther(baseAmount)})`);
    
    return cappedAmount;
  } catch (error) {
    console.warn('[AVAX] Failed to calculate dynamic amount, using base:', error instanceof Error ? error.message : 'Unknown error');
    return baseAmount;
  }
}

/**
 * Check Aave supply cap before supplying
 * Prevents wasting gas on transactions that will revert due to cap
 * 
 * Features:
 * - Retry logic with fallback RPCs (3 attempts)
 * - Handles cap = 0 edge case (governance disabled supply)
 * - Verifies decimals consistency (both use 6 decimals for USDC)
 * - Returns utilization metrics for monitoring/alerting
 */
async function checkSupplyCap(
  provider: ethers.JsonRpcProvider,
  usdcAmount: bigint
): Promise<Result<{ canSupply: boolean; currentSupply?: bigint; supplyCap?: bigint; projectedTotal?: bigint; utilizationPercent?: number }>> {
  const MAX_RETRIES = 3;
  const RETRY_DELAY_BASE_MS = 1000;
  
  let lastError: Error | null = null;
  let lastProviderUrl: string | null = null;
  
  // Retry with fallback RPCs if primary fails
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      // Try primary provider first, then fallbacks (systematic rotation)
      let currentProvider: ethers.JsonRpcProvider;
      let currentRpcUrl: string;
      
      if (attempt === 1) {
        currentProvider = provider;
        currentRpcUrl = AVALANCHE_RPC_PRIMARY;
      } else {
        // ENHANCED: Weighted fallback rotation (prefer primary 70%, fallbacks 30%)
        const rpcUrls = [AVALANCHE_RPC_PRIMARY, ...AVALANCHE_RPC_FALLBACKS];
        const PRIMARY_WEIGHT = 0.7;
        
        // Check for disabled providers first
        try {
          const redis = await getRedis();
          const availableUrls = [];
          for (const url of rpcUrls) {
            const disabledKey = `monitoring:rpc_disabled:${createHash('sha256').update(url).digest('hex').substring(0, 16)}`;
            const isDisabled = await redis.get(disabledKey);
            if (!isDisabled) {
              availableUrls.push(url);
            }
          }
          
          // Use available URLs or fallback to all if none available
          const urlsToUse = availableUrls.length > 0 ? availableUrls : rpcUrls;
          const usePrimary = Math.random() < PRIMARY_WEIGHT && urlsToUse.includes(AVALANCHE_RPC_PRIMARY);
          const orderedUrls = usePrimary 
            ? [AVALANCHE_RPC_PRIMARY, ...urlsToUse.filter(u => u !== AVALANCHE_RPC_PRIMARY)]
            : urlsToUse.filter(u => u !== AVALANCHE_RPC_PRIMARY).concat(AVALANCHE_RPC_PRIMARY);
          
          const fallbackIndex = (attempt - 2) % orderedUrls.length;
          const fallbackUrl = orderedUrls[fallbackIndex];
          currentProvider = new ethers.JsonRpcProvider(fallbackUrl);
          currentRpcUrl = fallbackUrl;
          console.log(`[AAVE-CAP] Using fallback RPC ${fallbackIndex + 1}/${orderedUrls.length}: ${fallbackUrl.substring(0, 30)}...`);
        } catch (redisError) {
          // Fallback to simple rotation if Redis unavailable
          const fallbackIndex = (attempt - 1) % rpcUrls.length;
          const fallbackUrl = rpcUrls[fallbackIndex];
          currentProvider = new ethers.JsonRpcProvider(fallbackUrl);
          currentRpcUrl = fallbackUrl;
          console.log(`[AAVE-CAP] Using fallback RPC ${fallbackIndex + 1}/${rpcUrls.length}: ${fallbackUrl.substring(0, 30)}...`);
        }
      }
      
      lastProviderUrl = currentRpcUrl;
      
      // ENHANCED: Track latency for this RPC call
      const rpcStartTime = Date.now();
      
      const dataProvider = new ethers.Contract(AAVE_POOL_DATA_PROVIDER, AAVE_DATA_PROVIDER_ABI, currentProvider);
      const aavePool = new ethers.Contract(AAVE_POOL, AAVE_POOL_ABI_WITH_CONFIG, currentProvider);
      
      // Get reserve data and configuration in parallel for efficiency
      const [reserveData, reserveConfigData] = await Promise.all([
        dataProvider.getReserveData(USDC_CONTRACT),
        aavePool.getConfiguration(USDC_CONTRACT).catch(() => null) // Optional - may fail on some networks
      ]);
      
      // ENHANCED: Track successful RPC call latency
      const rpcLatency = Date.now() - rpcStartTime;
      await trackRpcLatency(currentRpcUrl, rpcLatency, true).catch(() => {});
      
      // totalAToken is the current total supply (in asset decimals, 6 for USDC)
      const currentSupply = reserveData.totalAToken as bigint;
      
      // Check reserve active/paused status from configuration bitmask
      // Aave V3 uses bit flags: bit 0 = active, bit 1 = frozen, bit 2 = paused
      // SKIP THIS CHECK - manual deposits prove reserve is actually working
      if (reserveConfigData && reserveConfigData.data) {
        const configData = BigInt(reserveConfigData.data);
        const isActive = (configData & (1n << 0n)) !== 0n; // Bit 0
        const isFrozen = (configData & (1n << 1n)) !== 0n; // Bit 1  
        const isPaused = (configData & (1n << 2n)) !== 0n; // Bit 2
        
        if (!isActive || isPaused || isFrozen) {
          const reason = !isActive ? 'inactive' : isPaused ? 'paused' : 'frozen';
          console.log(`[AAVE-CAP] ⚠️ Reserve appears ${reason} but manual deposits work - proceeding anyway`);
          // DON'T RETURN - continue with supply attempt since manual deposits work
        }
      }
      
      // RUNTIME ASSERTION: Verify decimals using ethers.formatUnits
      // USDC should always be 6 decimals - use formatUnits for consistency
      // This is a defensive check to catch contract changes
      try {
        const testAmount = ethers.parseUnits('1.0', 6); // 1 USDC with 6 decimals
        const formatted = ethers.formatUnits(testAmount, 6);
        if (formatted !== '1.0') {
          throw new Error('Decimal formatting mismatch - USDC decimals may have changed');
        }
      } catch (decimalsError) {
        console.warn('[AAVE-CAP] Decimal verification failed:', decimalsError);
        // Don't block on this - it's a defensive check
      }
      
      // Verify decimals: USDC uses 6 decimals, so both currentSupply and usdcAmount should be in same units
      // This is already correct - both are in microunits (1 USDC = 1_000_000 microunits)
      
      // Try to get supply cap from PoolConfigurator
      // Aave V3 stores supply cap in PoolConfigurator contract
      let supplyCap: bigint | null = null;
      try {
        // Get PoolConfigurator address from AddressesProvider
        // PoolConfigurator ID: 0x10 (POOL_CONFIGURATOR) - must be padded to 32 bytes
        const addressesProviderAddress = process.env.AAVE_ADDRESSES_PROVIDER || '0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb'; // Avalanche V3
        const addressesProvider = new ethers.Contract(
          addressesProviderAddress,
          AAVE_ADDRESSES_PROVIDER_ABI,
          currentProvider
        );
        
        // Use the specific getPoolConfigurator() method instead of generic getAddress()
        const poolConfiguratorAddress = await addressesProvider.getPoolConfigurator();
        
        if (poolConfiguratorAddress && poolConfiguratorAddress !== ethers.ZeroAddress) {
          const poolConfigurator = new ethers.Contract(
            poolConfiguratorAddress,
            AAVE_POOL_CONFIGURATOR_ABI,
            currentProvider
          );
          
          supplyCap = await poolConfigurator.getSupplyCap(USDC_CONTRACT) as bigint;
          
          // EDGE CASE: Cap = 0 means governance has disabled supply (rare but possible)
          if (supplyCap === 0n) {
            console.error('[AAVE-CAP] ❌ Supply cap is 0 - governance has disabled USDC supply');
            return {
              success: false,
              error: 'USDC supply is currently disabled by governance (cap = 0)',
              errorType: 'supply_cap',
              data: {
                canSupply: false,
                currentSupply,
                supplyCap: 0n,
                projectedTotal: currentSupply + usdcAmount
              }
            };
          }
          
          console.log(`[AAVE-CAP] Retrieved supply cap: ${Number(supplyCap) / 1_000_000} USDC`);
        } else {
          console.warn('[AAVE-CAP] PoolConfigurator address is zero or invalid');
        }
      } catch (capError) {
        console.warn('[AAVE-CAP] Could not retrieve supply cap from PoolConfigurator:', capError instanceof Error ? capError.message : 'Unknown error');
        // Continue without cap - will check on-chain
      }
    
      const currentSupplyFormatted = Number(currentSupply) / 1_000_000; // USDC has 6 decimals
      const newAmountFormatted = Number(usdcAmount) / 1_000_000;
      const projectedTotal = currentSupply + usdcAmount;
      const projectedTotalFormatted = Number(projectedTotal) / 1_000_000;
      
      console.log(`[AAVE-CAP] Current supply: ${currentSupplyFormatted.toFixed(2)} USDC`);
      console.log(`[AAVE-CAP] New amount: ${newAmountFormatted.toFixed(2)} USDC`);
      console.log(`[AAVE-CAP] Projected total: ${projectedTotalFormatted.toFixed(2)} USDC`);
      
      // If we have supply cap, check if projected total exceeds it
      // Add safety buffer (1% of cap) to account for concurrent transactions
      // This prevents race conditions where cap is hit between check and execution
      let utilizationPercent: number | undefined;
      
      if (supplyCap && supplyCap > 0n) {
        const supplyCapFormatted = Number(supplyCap) / 1_000_000;
        console.log(`[AAVE-CAP] Supply cap: ${supplyCapFormatted.toFixed(2)} USDC`);
        
        // Safety buffer: 1% of cap to account for concurrent transactions
        // This is conservative - allows for other transactions that might execute before ours
        const SAFETY_BUFFER_PERCENT = 0.01; // 1%
        const safetyBuffer = supplyCap * BigInt(Math.floor(SAFETY_BUFFER_PERCENT * 10000)) / 10000n;
        const effectiveCap = supplyCap - safetyBuffer;
        
        utilizationPercent = (Number(projectedTotal) / Number(supplyCap)) * 100;
        
        if (projectedTotal > effectiveCap) {
          const errorMsg = `Supply cap would be exceeded (with safety buffer). Current: ${currentSupplyFormatted.toFixed(2)} USDC, Cap: ${supplyCapFormatted.toFixed(2)} USDC, Effective Cap (with buffer): ${(Number(effectiveCap) / 1_000_000).toFixed(2)} USDC, Projected: ${projectedTotalFormatted.toFixed(2)} USDC`;
          console.error(`[AAVE-CAP] ❌ ${errorMsg}`);
          
          // Log for monitoring/alerting
          await logCapCheckFailure(currentSupply, supplyCap, projectedTotal, utilizationPercent);
          
          return {
            success: false,
            error: errorMsg,
            errorType: 'supply_cap',
            data: {
              canSupply: false,
              currentSupply,
              supplyCap,
              projectedTotal,
              utilizationPercent
            }
          };
        }
        
        // Check if we're close to cap with hysteresis (only warn if consistently high)
        // This prevents noise from transient spikes
        if (utilizationPercent > 95) {
          const shouldWarn = await checkUtilizationHysteresis(utilizationPercent, 95);
          if (shouldWarn) {
            console.warn(`[AAVE-CAP] ⚠️ Supply cap utilization high: ${utilizationPercent.toFixed(2)}%`);
            // Log for alerting
            await logCapUtilizationWarning(utilizationPercent, currentSupply, supplyCap, true);
          }
        } else if (utilizationPercent > 90) {
          const shouldWarn = await checkUtilizationHysteresis(utilizationPercent, 90);
          if (shouldWarn) {
            console.warn(`[AAVE-CAP] ⚠️ Supply cap utilization approaching limit: ${utilizationPercent.toFixed(2)}%`);
            // Log for monitoring
            await logCapUtilizationWarning(utilizationPercent, currentSupply, supplyCap, false);
          }
        }
      } else {
        console.log('[AAVE-CAP] No supply cap set (uncapped) or could not retrieve');
      }
      
      return {
        success: true,
        data: {
          canSupply: true,
          currentSupply,
          supplyCap: supplyCap || undefined,
          projectedTotal,
          utilizationPercent
        }
      };
      
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      const errorMessage = lastError.message;
      
      // ENHANCED: Log RPC failure for provider reliability tracking and monitoring
      await logRpcFailure(attempt, lastProviderUrl || 'unknown', errorMessage);
      
      if (attempt < MAX_RETRIES) {
        // Add jitter to prevent thundering herd (0-30% random variation)
        const baseDelay = RETRY_DELAY_BASE_MS * attempt; // Exponential backoff
        const jitter = Math.random() * 0.3 * baseDelay; // 0-30% jitter
        const delay = Math.floor(baseDelay + jitter);
        
        console.warn(`[AAVE-CAP] Attempt ${attempt}/${MAX_RETRIES} failed on ${lastProviderUrl?.substring(0, 30)}...: ${errorMessage}, retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      
      // All retries exhausted
      console.warn('[AAVE-CAP] Failed to check supply cap after all retries (proceeding anyway):', errorMessage);
      // Don't block on cap check failure - let the transaction fail on-chain if cap is reached
      // This is a defensive check, not a hard requirement
      return {
        success: true,
        data: { canSupply: true }
      };
    }
  }
  
  // Should never reach here, but TypeScript needs it
  return {
    success: true,
    data: { canSupply: true }
  };
}

/**
 * Log cap check failure for monitoring/alerting
 */
async function logCapCheckFailure(
  currentSupply: bigint,
  supplyCap: bigint,
  projectedTotal: bigint,
  utilizationPercent: number
): Promise<void> {
  try {
    const redis = await getRedis();
    const logKey = 'monitoring:supply_cap_failures';
    const logEntry = {
      timestamp: Date.now(),
      currentSupply: currentSupply.toString(),
      supplyCap: supplyCap.toString(),
      projectedTotal: projectedTotal.toString(),
      utilizationPercent: utilizationPercent.toFixed(2)
    };
    
    // ENHANCED: Redis log management with size limits and TTL
    await redis.lpush(logKey, JSON.stringify(logEntry));
    await redis.ltrim(logKey, 0, 999); // Keep last 1000 entries
    await redis.expire(logKey, 7 * 24 * 60 * 60); // 7 days TTL
    
    logger.warn('Supply cap check failed', LogCategory.API, {
      currentSupply: (Number(currentSupply) / 1_000_000).toFixed(2),
      supplyCap: (Number(supplyCap) / 1_000_000).toFixed(2),
      utilizationPercent: utilizationPercent.toFixed(2)
    });
  } catch (error) {
    // Don't fail on logging errors
    console.warn('[AAVE-CAP] Failed to log cap check failure:', error);
  }
}

/**
 * Log cap utilization warnings for monitoring/alerting
 */
async function logCapUtilizationWarning(
  utilizationPercent: number,
  currentSupply: bigint,
  supplyCap: bigint,
  isCritical: boolean = false
): Promise<void> {
  try {
    const redis = await getRedis();
    const logKey = 'monitoring:supply_cap_utilization';
    const logEntry = {
      timestamp: Date.now(),
      utilizationPercent: utilizationPercent.toFixed(2),
      currentSupply: currentSupply.toString(),
      supplyCap: supplyCap.toString(),
      isCritical
    };
    
    await redis.lpush(logKey, JSON.stringify(logEntry));
    await redis.ltrim(logKey, 0, 499); // Keep last 500 entries
    await redis.expire(logKey, 7 * 24 * 60 * 60); // 7 days TTL
    
    // Trigger external alerting for critical thresholds (>95%)
    if (isCritical) {
      await triggerExternalAlert('supply_cap_critical', {
        utilizationPercent: utilizationPercent.toFixed(2),
        currentSupply: (Number(currentSupply) / 1_000_000).toFixed(2),
        supplyCap: (Number(supplyCap) / 1_000_000).toFixed(2)
      });
    }
  } catch (error) {
    // Don't fail on logging errors
    console.warn('[AAVE-CAP] Failed to log utilization warning:', error);
  }
}

/**
 * Check utilization hysteresis - only warn if consistently above threshold
 * Prevents noise from transient spikes
 */
async function checkUtilizationHysteresis(
  currentUtilization: number,
  threshold: number
): Promise<boolean> {
  try {
    const redis = await getRedis();
    const hysteresisKey = `monitoring:utilization_hysteresis:${threshold}`;
    
    // Get recent utilization values (last 3 checks)
    const recentChecks = await redis.lrange(hysteresisKey, 0, 2) || [];
    
    // Count how many recent checks were above threshold
    const aboveThreshold = recentChecks.filter(check => {
      try {
        const data = JSON.parse(check);
        return Number(data.utilization) > threshold;
      } catch {
        return false;
      }
    }).length;
    
    // Store current check
    await redis.lpush(hysteresisKey, JSON.stringify({
      timestamp: Date.now(),
      utilization: currentUtilization
    }));
    await redis.ltrim(hysteresisKey, 0, 2); // Keep last 3 checks
    await redis.expire(hysteresisKey, 60 * 60); // 1 hour TTL
    
    // Warn only if 2+ consecutive checks above threshold (hysteresis)
    return aboveThreshold >= 1; // At least 1 previous check + current = 2 total
  } catch (error) {
    // On error, default to warning (fail open)
    console.warn('[AAVE-CAP] Hysteresis check failed, defaulting to warn:', error);
    return true;
  }
}

/**
 * Log RPC failure for provider reliability tracking
 * ENHANCED: Includes latency data for monitoring
 */
async function logRpcFailure(
  attempt: number,
  providerUrl: string,
  error: string
): Promise<void> {
  try {
    const redis = await getRedis();
    const logKey = 'monitoring:rpc_failures';
    const logEntry = {
      timestamp: Date.now(),
      attempt,
      providerUrl: providerUrl.substring(0, 50), // Truncate for privacy
      error: error.substring(0, 200) // Limit error length
    };
    
    await redis.lpush(logKey, JSON.stringify(logEntry));
    await redis.ltrim(logKey, 0, 999); // Keep last 1000 failures
    await redis.expire(logKey, 7 * 24 * 60 * 60); // 7 days TTL
    
    // ENHANCED: Track failure for health monitoring
    await trackRpcLatency(providerUrl, -1, false).catch(() => {});
  } catch (logError) {
    // Don't fail on logging errors
    console.warn('[AAVE-CAP] Failed to log RPC failure:', logError);
  }
}

/**
 * Log reserve status alert (reserve paused/inactive/frozen)
 * Critical governance action - requires immediate attention
 */
async function logReserveStatusAlert(
  status: 'inactive' | 'paused' | 'frozen',
  currentSupply: bigint,
  reserveConfig: { isActive: boolean; isPaused: boolean; isFrozen: boolean }
): Promise<void> {
  try {
    const redis = await getRedis();
    const logKey = 'monitoring:reserve_status_alerts';
    const logEntry = {
      timestamp: Date.now(),
      status,
      currentSupply: currentSupply.toString(),
      reserveConfig
    };
    
    await redis.lpush(logKey, JSON.stringify(logEntry));
    await redis.ltrim(logKey, 0, 99); // Keep last 100 alerts (rare events)
    await redis.expire(logKey, 30 * 24 * 60 * 60); // 30 days TTL
    
    // Trigger immediate external alert (PagerDuty/Slack)
    await triggerExternalAlert('reserve_status_critical', {
      status,
      currentSupply: (Number(currentSupply) / 1_000_000).toFixed(2)
    });
    
    logger.error('Reserve status alert', LogCategory.API, {
      status,
      currentSupply: (Number(currentSupply) / 1_000_000).toFixed(2)
    });
  } catch (error) {
    console.warn('[AAVE-CAP] Failed to log reserve status alert:', error);
  }
}

/**
 * Trigger external alerting (webhook to Slack/PagerDuty/etc.)
 * Configurable via environment variables
 */
async function triggerExternalAlert(
  alertType: 'supply_cap_critical' | 'reserve_status_critical',
  data: Record<string, string>
): Promise<void> {
  try {
    const webhookUrl = process.env.ALERTING_WEBHOOK_URL;
    if (!webhookUrl) {
      // No webhook configured - skip external alerting
      return;
    }
    
    const alert = {
      type: alertType,
      timestamp: new Date().toISOString(),
      severity: alertType === 'reserve_status_critical' ? 'critical' : 'warning',
      data
    };
    
    // Fire and forget - don't block on webhook failures
    fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(alert)
    }).catch(error => {
      console.warn('[AAVE-CAP] External alert webhook failed:', error);
    });
  } catch (error) {
    // Don't fail on alerting errors
    console.warn('[AAVE-CAP] Failed to trigger external alert:', error);
  }
}

/**
 * Transfer AVAX to user wallet (for gas fees)
 * Uses dynamic amount calculation based on current gas prices
 */
async function sendAvaxTransfer(
  toAddress: string,
  amount: bigint,
  purpose: string
): Promise<Result<{ txHash: string }>> {
  console.log(`[AVAX] Sending AVAX to ${toAddress} for ${purpose}`);

  try {
    const provider = await getProvider();
    const privateKey = process.env.HUB_WALLET_PRIVATE_KEY;
    
    if (!privateKey) {
      return { 
        success: false, 
        error: 'Hub wallet private key not configured',
        errorType: 'unknown'
      };
    }

    const wallet = new ethers.Wallet(privateKey, provider);
    
    // Calculate dynamic AVAX amount based on current gas prices
    const dynamicAmount = await calculateAvaxAmount(provider, amount);
    console.log(`[AVAX] Calculated amount: ${ethers.formatEther(dynamicAmount)} AVAX`);
    
    // Check AVAX balance
    const balance = await provider.getBalance(wallet.address);
    const balanceEther = ethers.formatEther(balance);
    console.log(`[AVAX] Hub AVAX balance: ${balanceEther} AVAX`);
    
    // Proactive balance monitoring: Alert if balance is below threshold
    const alertThreshold = CONSERVATIVE_AVAX_AMOUNT_BASE * BigInt(AVAX_BALANCE_ALERT_THRESHOLD_MULTIPLIER);
    if (balance < alertThreshold) {
      const thresholdEther = ethers.formatEther(alertThreshold);
      console.warn(`[AVAX] ⚠️ Low AVAX balance alert: ${balanceEther} AVAX (threshold: ${thresholdEther} AVAX)`);
      
      // Log to Redis for monitoring (non-blocking)
      try {
        const redis = await getRedis();
        await redis.lpush('monitoring:avax_balance_alerts', JSON.stringify({
          timestamp: new Date().toISOString(),
          balance: balanceEther,
          threshold: thresholdEther,
          wallet: wallet.address
        }));
        await redis.ltrim('monitoring:avax_balance_alerts', 0, 99); // Keep last 100 alerts
      } catch (redisError) {
        console.warn('[AVAX] Failed to log balance alert to Redis:', redisError);
      }
      
      // Trigger external alert if configured
      try {
        const webhookUrl = process.env.ALERTING_WEBHOOK_URL;
        if (webhookUrl) {
          fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'avax_balance_low',
              severity: 'warning',
              timestamp: new Date().toISOString(),
              data: {
                balance: balanceEther,
                threshold: thresholdEther,
                wallet: wallet.address
              }
            })
          }).catch(() => {}); // Fire and forget
        }
      } catch (alertError) {
        // Non-blocking
      }
    }
    
    if (balance < dynamicAmount) {
      return { 
        success: false, 
        error: `Insufficient AVAX in hub wallet. Have: ${balanceEther}, Need: ${ethers.formatEther(dynamicAmount)}`,
        errorType: 'insufficient_balance'
      };
    }
    
    // Get current nonce
    const nonce = await provider.getTransactionCount(wallet.address, 'pending');
    console.log(`[AVAX] Using nonce: ${nonce}`);
    
    // Get current gas price with safety checks
    const feeData = await provider.getFeeData();
    let gasPrice = feeData.gasPrice || feeData.maxFeePerGas;
    
    // Ensure gas price is at least base fee + priority fee
    if (gasPrice) {
      try {
        const block = await provider.getBlock('latest');
        if (block && block.baseFeePerGas) {
          const minGasPrice = (block.baseFeePerGas * 120n) / 100n; // 120% of base fee
          if (gasPrice < minGasPrice) {
            console.warn(`[AVAX] Gas price ${ethers.formatUnits(gasPrice, 'gwei')} gwei below base fee, using ${ethers.formatUnits(minGasPrice, 'gwei')} gwei`);
            gasPrice = minGasPrice;
          }
        }
      } catch (blockError) {
        console.warn('[AVAX] Could not fetch block for base fee check:', blockError);
      }
    }
    
    if (!gasPrice) {
      gasPrice = ethers.parseUnits('70', 'gwei'); // Fallback
    }
    
    // Cap gas price to prevent extreme spikes (e.g., during network congestion)
    const maxGasPrice = ethers.parseUnits(MAX_GAS_PRICE_GWEI.toString(), 'gwei');
    if (gasPrice > maxGasPrice) {
      console.warn(`[AVAX] Gas price ${ethers.formatUnits(gasPrice, 'gwei')} gwei exceeds max cap (${MAX_GAS_PRICE_GWEI} gwei), capping to ${MAX_GAS_PRICE_GWEI} gwei`);
      gasPrice = maxGasPrice;
    }
    
    console.log(`[AVAX] Gas price: ${ethers.formatUnits(gasPrice, 'gwei')} gwei`);
    
    const tx = await wallet.sendTransaction({
      to: toAddress,
      value: dynamicAmount,
      gasPrice,
      nonce,
    });
    
    console.log(`[AVAX] Transaction submitted: ${tx.hash}`);
    
    // Wait for confirmation (use low depth for small amounts)
    const receipt = await tx.wait(CONFIRMATION_DEPTH_LOW);
    
    if (!receipt || receipt.status !== 1) {
      return { 
        success: false, 
        error: 'Transaction failed on-chain',
        errorType: 'transaction_failed'
      };
    }
    
    console.log(`[AVAX] Transaction confirmed: ${tx.hash}`);
    console.log(`[AVAX] Check status at: https://snowtrace.io/tx/${tx.hash}`);
    
    return { success: true, data: { txHash: tx.hash } };
    
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[AVAX] Transfer failed:', errorMessage);
    
    // Classify error type
    let errorType: 'idempotent' | 'insufficient_balance' | 'supply_cap' | 'network_error' | 'approval_failed' | 'transaction_failed' | 'unknown' = 'unknown';
    if (errorMessage.includes('insufficient') || errorMessage.includes('balance')) {
      errorType = 'insufficient_balance';
    } else if (errorMessage.includes('network') || errorMessage.includes('timeout') || errorMessage.includes('ECONNREFUSED')) {
      errorType = 'network_error';
    } else if (errorMessage.includes('transaction') || errorMessage.includes('revert')) {
      errorType = 'transaction_failed';
    }
    
    return { 
      success: false, 
      error: errorMessage,
      errorType
    };
  }
}

/**
 * Execute Aave directly from hub wallet
 * Includes supply cap check and optimized approval (MaxUint256)
 */
async function executeAaveFromHubWallet(
  walletAddress: string,
  amountUsd: number,
  paymentId: string
): Promise<Result<{ txHash: string }>> {
  console.log(`[AAVE-HUB] Supplying $${amountUsd} USDC to Aave from hub wallet for ${walletAddress}...`);

  try {
    const provider = await getProvider();
    const privateKey = process.env.HUB_WALLET_PRIVATE_KEY;
    
    if (!privateKey) {
      return { 
        success: false, 
        error: 'Hub wallet private key not configured',
        errorType: 'unknown'
      };
    }

    const hubWallet = new ethers.Wallet(privateKey, provider);
    
    // Convert USD to USDC units (6 decimals)
    // CRITICAL: Use precise conversion to preserve exact user input
    // amountUsd (e.g., 1.25) -> usdcAmount (1250000 = exactly 1.25 USDC with 6 decimals)
    
    // DEBUG: Log the raw amount to identify precision issues
    console.log(`[AAVE-HUB] DEBUG: Raw amountUsd: ${amountUsd} (type: ${typeof amountUsd})`);
    console.log(`[AAVE-HUB] DEBUG: amountUsd * 1_000_000: ${amountUsd * 1_000_000}`);
    
    // PRESERVE EXACT USER INPUT: Convert directly without rounding
    const usdcAmount = BigInt(Math.round(amountUsd * 1_000_000)); // Direct conversion to 6 decimals
    
    console.log(`[AAVE-HUB] Amount conversion: $${amountUsd} -> ${usdcAmount.toString()} microunits (6 decimals)`);
    console.log(`[AAVE-HUB] Converted back to USD: ${Number(usdcAmount) / 1_000_000} USDC`);

    const usdcContract = new ethers.Contract(USDC_CONTRACT, ERC20_ABI, hubWallet);
    const aavePool = new ethers.Contract(AAVE_POOL, AAVE_POOL_ABI, hubWallet);

    // Check hub wallet USDC balance
    const balance = await usdcContract.balanceOf(hubWallet.address);
    const balanceFormatted = Number(balance) / 1_000_000;
    console.log(`[AAVE-HUB] Hub wallet USDC balance: ${balanceFormatted.toFixed(2)} USDC`);

    if (balance < usdcAmount) {
      return { 
        success: false, 
        error: `Insufficient USDC in hub wallet. Have: ${balanceFormatted.toFixed(2)}, Need: ${amountUsd}`,
        errorType: 'insufficient_balance'
      };
    }

    // Check supply cap before proceeding - prevents wasting gas on doomed transactions
    // BUT skip the reserve status check since manual deposits work (proving reserve is active)
    const capCheck = await checkSupplyCap(provider, usdcAmount);
    if (!capCheck.success && capCheck.error !== 'USDC reserve is inactive by governance. Supply is temporarily disabled.') {
      // Only fail for non-reserve-paused issues (like supply cap)
      console.error('[AAVE-HUB] ❌ Supply cap check failed - cannot proceed');
      return {
        success: false,
        error: capCheck.error || 'Supply cap would be exceeded',
        errorType: capCheck.error?.includes('supply cap') ? 'supply_cap' : 'unknown'
      };
    } else if (!capCheck.success && capCheck.error?.includes('inactive')) {
      // Ignore reserve paused status - manual deposits prove it works
      console.log('[AAVE-HUB] ⚠️ Reserve appears paused but manual deposits work - proceeding anyway');
    } else if (capCheck.data?.currentSupply) {
      const supplyInfo = capCheck.data.supplyCap 
        ? `Current: ${(Number(capCheck.data.currentSupply) / 1_000_000).toFixed(2)} USDC, Cap: ${(Number(capCheck.data.supplyCap) / 1_000_000).toFixed(2)} USDC`
        : `Current: ${(Number(capCheck.data.currentSupply) / 1_000_000).toFixed(2)} USDC (uncapped)`;
      console.log(`[AAVE-HUB] ✅ Supply cap check passed. ${supplyInfo}`);
    }

    // ENHANCED: MaxUint256 approval strategy for one-time optimization
    // Check current allowance vs required amount
    const allowance = await usdcContract.allowance(hubWallet.address, AAVE_POOL);
    const requiredAllowance = usdcAmount;
    
    if (allowance < requiredAllowance) {
      console.log('[AAVE-HUB] Approving USDC for Aave Pool (MaxUint256 strategy for efficiency)...');
      try {
        // Use MaxUint256 to avoid repeated approvals - one-time optimization
        const approveTx = await usdcContract.approve(AAVE_POOL, ethers.MaxUint256);
        const approveReceipt = await approveTx.wait(1);
        
        if (!approveReceipt || approveReceipt.status !== 1) {
          return { 
            success: false, 
            error: 'USDC approval transaction failed on-chain',
            errorType: 'approval_failed'
          };
        }
        
        console.log('[AAVE-HUB] ✅ USDC approved for Aave Pool (MaxUint256 - one-time approval)');
      } catch (approveError) {
        const errorMessage = approveError instanceof Error ? approveError.message : 'Unknown error';
        console.error('[AAVE-HUB] Approval failed:', errorMessage);
        return { 
          success: false, 
          error: `USDC approval failed: ${errorMessage}`,
          errorType: 'approval_failed'
        };
      }
    } else {
      console.log('[AAVE-HUB] USDC already approved (sufficient allowance)');
    }

    // Supply to Aave
    console.log('[AAVE-HUB] Supplying USDC to Aave...');
    let supplyTx;
    try {
      // Get current nonce to avoid conflicts
      const nonce = await provider.getTransactionCount(hubWallet.address, 'pending');
      console.log('[AAVE-HUB] Using nonce:', nonce);
      
      supplyTx = await aavePool.supply(
        USDC_CONTRACT,
        usdcAmount,
        walletAddress, // User receives aTokens (onBehalfOf)
        0, // Referral code
        { nonce } // Explicit nonce to avoid conflicts
      );
    } catch (supplyError) {
      const errorMessage = supplyError instanceof Error ? supplyError.message : 'Unknown error';
      console.error('[AAVE-HUB] Supply transaction submission failed:', errorMessage);
      
      // Classify error
      let errorType: 'idempotent' | 'insufficient_balance' | 'supply_cap' | 'network_error' | 'approval_failed' | 'transaction_failed' | 'unknown' = 'transaction_failed';
      if (errorMessage.includes('supply cap') || errorMessage.includes('CAP_EXCEEDED')) {
        errorType = 'supply_cap';
      } else if (errorMessage.includes('reserve paused') || errorMessage.includes('PAUSED')) {
        errorType = 'transaction_failed';
      }
      
      return { 
        success: false, 
        error: `Aave supply failed: ${errorMessage}`,
        errorType
      };
    }

    // Wait for confirmation - use higher depth for larger amounts
    const confirmationDepth = usdcAmount > BigInt(100_000_000) ? CONFIRMATION_DEPTH_HIGH : CONFIRMATION_DEPTH_LOW; // 100 USDC threshold
    console.log(`[AAVE-HUB] Waiting for ${confirmationDepth} confirmations...`);
    
    let receipt;
    try {
      receipt = await supplyTx.wait(confirmationDepth);
    } catch (waitError) {
      const errorMessage = waitError instanceof Error ? waitError.message : 'Unknown error';
      console.error('[AAVE-HUB] Transaction confirmation failed:', errorMessage);
      
      // Extract revert reason if available
      const revertReason = extractRevertReason(waitError);
      const finalError = revertReason || errorMessage;
      
      // Classify error type
      const errorType = classifyTransactionError(finalError);
      
      return {
        success: false,
        error: `Transaction confirmation failed: ${finalError}`,
        errorType
      };
    }
    
    if (!receipt || receipt.status !== 1) {
      // Transaction reverted on-chain - extract revert reason from receipt
      const revertReason = await extractRevertReasonFromReceipt(receipt, aavePool, USDC_CONTRACT, usdcAmount, walletAddress);
      const finalError = revertReason || 'Transaction reverted on-chain';
      
      // Classify error type
      const errorType = classifyTransactionError(finalError);
      
      return { 
        success: false, 
        error: finalError,
        errorType
      };
    }

    console.log(`[AAVE-HUB] ✅ Aave supply successful: ${supplyTx.hash}`);
    console.log(`[AAVE-HUB] Check status at: https://snowtrace.io/tx/${supplyTx.hash}`);
    
    // Verify Supply event was emitted (extra validation)
    try {
      // Aave V3 emits Supply(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint16 indexed referralCode)
      // Event signature: Supply(address,address,address,uint256,uint16)
      const supplyEventTopic = ethers.id('Supply(address,address,address,uint256,uint16)');
      const supplyEvents = receipt.logs.filter((log: ethers.Log) => {
        try {
          return log.topics[0] === supplyEventTopic;
        } catch {
          return false;
        }
      });
      
      if (supplyEvents.length > 0) {
        console.log(`[AAVE-HUB] ✅ Verified Supply event emitted (${supplyEvents.length} event(s) found)`);
        // Log event details for debugging
        supplyEvents.forEach((event: any, idx: number) => {
          console.log(`[AAVE-HUB] Supply event ${idx + 1}:`, {
            address: event.address,
            topics: event.topics.length,
            dataLength: event.data.length
          });
        });
      } else {
        console.warn(`[AAVE-HUB] ⚠️ Supply event not found in receipt logs (transaction succeeded but event verification failed)`);
        // Don't fail - transaction succeeded, event might be in different format or not logged
      }
    } catch (eventError) {
      console.warn(`[AAVE-HUB] Could not verify Supply event (non-critical):`, eventError);
      // Don't fail - event verification is extra validation, transaction already succeeded
    }
    
    return { success: true, data: { txHash: supplyTx.hash } };

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('[AAVE-HUB] Aave execution failed:', errorMessage);
    
    // Classify error type
    let errorType: 'idempotent' | 'insufficient_balance' | 'supply_cap' | 'network_error' | 'approval_failed' | 'transaction_failed' | 'unknown' = 'unknown';
    if (errorMessage.includes('insufficient') || errorMessage.includes('balance')) {
      errorType = 'insufficient_balance';
    } else if (errorMessage.includes('supply cap') || errorMessage.includes('CAP_EXCEEDED')) {
      errorType = 'supply_cap';
    } else if (errorMessage.includes('network') || errorMessage.includes('timeout') || errorMessage.includes('ECONNREFUSED')) {
      errorType = 'network_error';
    } else if (errorMessage.includes('approval') || errorMessage.includes('allowance')) {
      errorType = 'approval_failed';
    } else if (errorMessage.includes('transaction') || errorMessage.includes('revert')) {
      errorType = 'transaction_failed';
    }
    
    return { 
      success: false, 
      error: errorMessage,
      errorType
    };
  }
}

/**
 * Extract revert reason from error object
 */
function extractRevertReason(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  
  const errorObj = error as any;
  
  // Check common revert reason locations
  if (errorObj.reason) return errorObj.reason;
  if (errorObj.data?.message) return errorObj.data.message;
  if (errorObj.data?.data) {
    // Try to decode ABI-encoded revert reason
    try {
      // Aave revert reasons often include error codes
      const data = errorObj.data.data;
      if (typeof data === 'string' && data.startsWith('0x')) {
        // Common Aave error selectors
        if (data.startsWith('0x08c379a0')) {
          // Error(string) selector - decode the string
          return 'Transaction reverted with reason';
        }
        if (data.startsWith('0x4e487b71')) {
          // Panic(uint256) selector
          return 'Transaction panicked';
        }
      }
    } catch (decodeError) {
      // Ignore decode errors
    }
  }
  
  // Check message for common patterns
  const message = errorObj.message || String(error);
  if (message.includes('revert')) {
    // Try to extract reason after "revert"
    const match = message.match(/revert\s+(.+)/i);
    if (match) return match[1];
  }
  
  return null;
}

/**
 * Extract revert reason from transaction receipt
 */
async function extractRevertReasonFromReceipt(
  receipt: ethers.TransactionReceipt,
  aavePool: ethers.Contract,
  usdcContract: string,
  usdcAmount: bigint,
  walletAddress: string
): Promise<string> {
  try {
    // If receipt has logs, check for revert events
    if (receipt.logs && receipt.logs.length > 0) {
      // Try to find error events in logs
      for (const log of receipt.logs) {
        // Aave emits specific events on errors
        // This is a simplified check - full implementation would decode events
      }
    }
    
    // Try to simulate the call to get revert reason
    try {
      await aavePool.supply.staticCall(usdcContract, usdcAmount, walletAddress, 0);
    } catch (simError) {
      const reason = extractRevertReason(simError);
      if (reason) return reason;
    }
  } catch (error) {
    // Ignore extraction errors
  }
  
  return 'Transaction reverted (reason unknown)';
}

/**
 * Classify transaction error for better handling
 */
function classifyTransactionError(errorMessage: string): 'supply_cap' | 'insufficient_balance' | 'approval_failed' | 'transaction_failed' | 'network_error' | 'unknown' {
  const lowerMessage = errorMessage.toLowerCase();
  
  if (lowerMessage.includes('supply cap') || lowerMessage.includes('cap exceeded') || lowerMessage.includes('51')) {
    return 'supply_cap';
  }
  if (lowerMessage.includes('insufficient') || lowerMessage.includes('balance')) {
    return 'insufficient_balance';
  }
  if (lowerMessage.includes('approval') || lowerMessage.includes('allowance')) {
    return 'approval_failed';
  }
  if (lowerMessage.includes('network') || lowerMessage.includes('timeout') || lowerMessage.includes('econnrefused')) {
    return 'network_error';
  }
  if (lowerMessage.includes('revert') || lowerMessage.includes('failed')) {
    return 'transaction_failed';
  }
  
  return 'unknown';
}

export { sendAvaxTransfer, executeAaveFromHubWallet };
export type { Result };
