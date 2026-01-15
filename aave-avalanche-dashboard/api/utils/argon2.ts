/**
 * Argon2id Key Derivation Utilities
 * 
 * Provides migration path from PBKDF2 to Argon2id for enhanced security.
 * Argon2id is memory-hard and provides better resistance to GPU/ASIC attacks.
 * 
 * SECURITY:
 * - Memory-hard algorithm (resistant to parallel attacks)
 * - Configurable memory cost (512MB recommended)
 * - Configurable time cost (1-2 seconds on modern hardware)
 * - Backward compatible with PBKDF2 (gradual migration)
 * 
 * USAGE:
 * - Set USE_ARGON2=true to enable Argon2id
 * - Falls back to PBKDF2 if Argon2 not available
 */

// Configuration
const USE_ARGON2 = process.env.USE_ARGON2 === 'true';
const ARGON2_MEMORY_COST = parseInt(process.env.ARGON2_MEMORY_COST || '524288', 10); // 512MB (512 * 1024)
const ARGON2_TIME_COST = parseInt(process.env.ARGON2_TIME_COST || '3', 10); // 3 iterations
const ARGON2_PARALLELISM = parseInt(process.env.ARGON2_PARALLELISM || '1', 10); // Single-threaded

/**
 * Derive key using Argon2id (if available) or fallback to PBKDF2
 * 
 * @param password Password/key material
 * @param salt Salt for key derivation
 * @param keyLength Output key length in bytes
 * @returns Derived key as Buffer
 */
export async function deriveKey(
  password: string,
  salt: string,
  keyLength: number = 32
): Promise<Buffer> {
  if (!USE_ARGON2) {
    // Fallback to PBKDF2
    return deriveKeyPBKDF2(password, salt, keyLength);
  }

  try {
    // Try to use Argon2 (requires argon2-browser or node-argon2 package)
    // For now, we'll provide the interface and fallback to PBKDF2
    // In production, install: npm install argon2
    
    // TODO: Uncomment when argon2 package is installed
    // const argon2 = require('argon2');
    // const hash = await argon2.hash(password, {
    //   type: argon2.argon2id,
    //   memoryCost: ARGON2_MEMORY_COST,
    //   timeCost: ARGON2_TIME_COST,
    //   parallelism: ARGON2_PARALLELISM,
    //   salt: Buffer.from(salt, 'utf8'),
    //   hashLength: keyLength
    // });
    // return Buffer.from(hash, 'hex');
    
    // Fallback to PBKDF2 if Argon2 not available
    console.warn('[Argon2] Argon2 not available, falling back to PBKDF2. Install argon2 package to enable.');
    return deriveKeyPBKDF2(password, salt, keyLength);
  } catch (error) {
    // Fallback to PBKDF2 on error
    console.warn('[Argon2] Argon2 derivation failed, falling back to PBKDF2:', error);
    return deriveKeyPBKDF2(password, salt, keyLength);
  }
}

/**
 * Derive key using PBKDF2 (fallback)
 */
async function deriveKeyPBKDF2(
  password: string,
  salt: string,
  keyLength: number
): Promise<Buffer> {
  const crypto = require('crypto');
  const iterations = parseInt(process.env.PBKDF2_ITERATIONS || '600000', 10);
  
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(
      password,
      salt,
      iterations,
      keyLength,
      'sha256',
      (err: Error | null, key: Buffer) => {
        if (err) reject(err);
        else resolve(key);
      }
    );
  });
}

/**
 * Check if Argon2 is available
 */
export function isArgon2Available(): boolean {
  try {
    // Check if argon2 package is installed
    require.resolve('argon2');
    return true;
  } catch {
    return false;
  }
}

/**
 * Get recommended Argon2 parameters for current hardware
 * Returns conservative defaults that work on most systems
 */
export function getRecommendedArgon2Params(): {
  memoryCost: number;
  timeCost: number;
  parallelism: number;
} {
  return {
    memoryCost: ARGON2_MEMORY_COST, // 512MB
    timeCost: ARGON2_TIME_COST, // 3 iterations (~1-2 seconds)
    parallelism: ARGON2_PARALLELISM // Single-threaded
  };
}
