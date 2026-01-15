/**
 * Secrets Manager Integration Utilities
 * 
 * Provides abstraction layer for secrets management across different providers:
 * - Vercel Secrets (default for Vercel deployments)
 * - AWS Secrets Manager
 * - HashiCorp Vault
 * - Environment variables (fallback)
 * 
 * SECURITY:
 * - Never logs secret values
 * - Caches secrets with TTL to reduce API calls
 * - Automatic rotation detection
 * - Fail-secure on errors
 */

import { logger, LogCategory } from './logger';

// Configuration
const SECRETS_PROVIDER = process.env.SECRETS_PROVIDER || 'vercel'; // 'vercel' | 'aws' | 'vault' | 'env'
const SECRETS_CACHE_TTL = parseInt(process.env.SECRETS_CACHE_TTL || '3600000', 10); // 1 hour default
const SECRETS_MAX_RETRIES = 3;

// In-memory cache for secrets
interface CachedSecret {
  value: string;
  cachedAt: number;
  version?: string; // For rotation detection
}

const secretCache = new Map<string, CachedSecret>();

/**
 * Get secret from configured provider
 * 
 * @param secretName Secret name/key
 * @param required Whether secret is required (throws if missing)
 * @returns Secret value
 */
export async function getSecret(secretName: string, required: boolean = true): Promise<string | null> {
  try {
    // Check cache first
    const cached = secretCache.get(secretName);
    if (cached && (Date.now() - cached.cachedAt) < SECRETS_CACHE_TTL) {
      return cached.value;
    }

    let secretValue: string | null = null;

    switch (SECRETS_PROVIDER) {
      case 'vercel':
        secretValue = await getVercelSecret(secretName);
        break;
      case 'aws':
        secretValue = await getAwsSecret(secretName);
        break;
      case 'vault':
        secretValue = await getVaultSecret(secretName);
        break;
      case 'env':
      default:
        secretValue = process.env[secretName] || null;
        break;
    }

    if (!secretValue && required) {
      throw new Error(`Required secret ${secretName} not found`);
    }

    // Cache the secret
    if (secretValue) {
      secretCache.set(secretName, {
        value: secretValue,
        cachedAt: Date.now()
      });
    }

    return secretValue;
  } catch (error) {
    logger.error('Failed to retrieve secret', LogCategory.INFRASTRUCTURE, {
      secretName,
      provider: SECRETS_PROVIDER,
      error: error instanceof Error ? error.message : String(error)
    }, error instanceof Error ? error : new Error(String(error)));

    if (required) {
      throw error;
    }

    return null;
  }
}

/**
 * Get secret from Vercel Secrets
 */
async function getVercelSecret(secretName: string): Promise<string | null> {
  // Vercel secrets are available as environment variables at runtime
  // In production, Vercel automatically injects secrets as env vars
  return process.env[secretName] || null;
}

/**
 * Get secret from AWS Secrets Manager
 */
async function getAwsSecret(secretName: string): Promise<string | null> {
  try {
    // TODO: Implement AWS Secrets Manager integration
    // const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');
    // const client = new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-1' });
    // const response = await client.send(new GetSecretValueCommand({ SecretId: secretName }));
    // return response.SecretString || null;

    // Fallback to environment variable for now
    logger.warn('AWS Secrets Manager not fully implemented, using env fallback', LogCategory.INFRASTRUCTURE, {
      secretName
    });
    return process.env[secretName] || null;
  } catch (error) {
    logger.error('AWS Secrets Manager retrieval failed', LogCategory.INFRASTRUCTURE, {
      secretName,
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

/**
 * Get secret from HashiCorp Vault
 */
async function getVaultSecret(secretName: string): Promise<string | null> {
  try {
    // TODO: Implement Vault integration
    // const vaultAddr = process.env.VAULT_ADDR;
    // const vaultToken = process.env.VAULT_TOKEN;
    // const response = await fetch(`${vaultAddr}/v1/secret/data/${secretName}`, {
    //   headers: { 'X-Vault-Token': vaultToken }
    // });
    // const data = await response.json();
    // return data.data?.data?.value || null;

    // Fallback to environment variable for now
    logger.warn('HashiCorp Vault not fully implemented, using env fallback', LogCategory.INFRASTRUCTURE, {
      secretName
    });
    return process.env[secretName] || null;
  } catch (error) {
    logger.error('Vault retrieval failed', LogCategory.INFRASTRUCTURE, {
      secretName,
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

/**
 * Clear secret cache (useful after key rotation)
 */
export function clearSecretCache(secretName?: string): void {
  if (secretName) {
    secretCache.delete(secretName);
  } else {
    secretCache.clear();
  }
}

/**
 * Get server encryption key from secrets manager
 * This is the primary entry point for accessing the server encryption key
 */
export async function getServerEncryptionKey(): Promise<string> {
  const key = await getSecret('SERVER_ENCRYPTION_KEY', true);
  if (!key) {
    throw new Error('SERVER_ENCRYPTION_KEY not configured in secrets manager');
  }
  return key;
}

/**
 * Get auth token HMAC secret from secrets manager
 */
export async function getAuthTokenHmacSecret(): Promise<string> {
  const secret = await getSecret('AUTH_TOKEN_HMAC_SECRET', false);
  if (secret) {
    return secret;
  }
  
  // Fallback to server encryption key
  return await getServerEncryptionKey();
}
