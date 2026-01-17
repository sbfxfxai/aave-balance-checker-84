import { ethers } from 'ethers';
import { getApiBaseUrl } from '@/lib/utils';

interface MorphoWithdrawRequest {
  walletAddress: string;
  withdrawAll?: boolean;
  eurcAmount?: string;
  daiAmount?: string;
}

export interface MorphoWithdrawResponse {
  success: boolean;
  message: string;
  results?: Array<{
    vault: string;
    txHash?: string;
    shares?: string;
    success: boolean;
    error?: string;
    note?: string;
  }>;
  withdrawalId?: string;
  txHash?: string;
  explorerUrl?: string;
  error?: string;
  note?: string;
}

/**
 * Withdraw all funds from Morpho vaults
 */
export async function withdrawFromMorpho(
  walletAddress: string,
  withdrawAll: boolean = true,
  eurcAmount?: string,
  daiAmount?: string
): Promise<MorphoWithdrawResponse> {
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/morpho/withdraw`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        walletAddress,
        withdrawAll,
        eurcAmount,
        daiAmount,
      } as MorphoWithdrawRequest),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Withdrawal failed');
    }

    return data as MorphoWithdrawResponse;
  } catch (error) {
    console.error('[MorphoWithdraw] Error:', error);
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Unknown error occurred',
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Get withdrawal estimate (gas fees, expected amounts)
 */
export async function getMorphoWithdrawEstimate(
  walletAddress: string,
  withdrawAll: boolean = true,
  eurcAmount?: string,
  daiAmount?: string
): Promise<{
  success: boolean;
  gasEstimate?: string;
  eurcReceiveAmount?: string;
  daiReceiveAmount?: string;
  totalUsdValue?: string;
  error?: string;
}> {
  try {
    const response = await fetch(`${getApiBaseUrl()}/api/morpho/withdraw-estimate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        walletAddress,
        withdrawAll,
        eurcAmount,
        daiAmount,
      } as MorphoWithdrawRequest),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Estimate failed');
    }

    return {
      success: true,
      gasEstimate: data.gasEstimate,
      eurcReceiveAmount: data.eurcReceiveAmount,
      daiReceiveAmount: data.daiReceiveAmount,
      totalUsdValue: data.totalUsdValue,
    };
  } catch (error) {
    console.error('[MorphoWithdrawEstimate] Error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}
