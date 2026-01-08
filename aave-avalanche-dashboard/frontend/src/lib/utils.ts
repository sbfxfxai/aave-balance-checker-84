import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format an Ethereum address for display
 * @param address - The full Ethereum address
 * @param chars - Number of characters to show on each side (default: 6)
 * @returns Formatted address like "0x1234...5678"
 */
export function formatAddress(address: string, chars: number = 6): string {
  if (!address) return '';
  if (address.length < chars * 2 + 2) return address;
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

/**
 * Normalize and validate an Ethereum wallet address
 * 
 * This function ensures consistent wallet address format across the application:
 * - Trims whitespace
 * - Converts to lowercase
 * - Validates format (0x prefix, 42 characters total)
 * 
 * @param address - The wallet address to normalize
 * @returns Normalized wallet address (lowercase, trimmed)
 * @throws Error if address is invalid or missing
 * 
 * @example
 * ```ts
 * const normalized = normalizeWalletAddress('0x1234...ABCD');
 * // Returns: '0x1234...abcd'
 * ```
 */
export function normalizeWalletAddress(address: string | null | undefined): string {
  if (!address) {
    throw new Error('Wallet address is required');
  }

  const trimmed = address.trim();
  
  if (!trimmed) {
    throw new Error('Wallet address cannot be empty');
  }

  const normalized = trimmed.toLowerCase();

  // Validate Ethereum address format: 0x followed by 40 hex characters (42 total)
  if (!normalized.startsWith('0x')) {
    throw new Error('Invalid wallet address format: must start with 0x');
  }

  if (normalized.length !== 42) {
    throw new Error(`Invalid wallet address format: expected 42 characters, got ${normalized.length}`);
  }

  // Validate hex characters (0-9, a-f)
  const hexPattern = /^0x[0-9a-f]{40}$/;
  if (!hexPattern.test(normalized)) {
    throw new Error('Invalid wallet address format: contains invalid characters');
  }

  return normalized;
}

/**
 * Get the API base URL for making requests to the backend
 * 
 * This function handles:
 * - Environment variable configuration (VITE_API_BASE_URL)
 * - SSR contexts (returns empty string if window is undefined)
 * - Fallback to current origin in browser contexts
 * 
 * @returns API base URL (e.g., "https://www.tiltvault.com" or "http://localhost:3000")
 * 
 * @example
 * ```ts
 * const apiUrl = getApiBaseUrl();
 * const response = await fetch(`${apiUrl}/api/wallet/balance`);
 * ```
 */
export function getApiBaseUrl(): string {
  // In SSR contexts (like Next.js or during build), window is undefined
  if (typeof window === 'undefined') {
    // Return empty string for relative URLs in SSR, or use env var if available
    return import.meta.env.VITE_API_BASE_URL || '';
  }

  // In browser contexts, prefer environment variable, fallback to current origin
  return import.meta.env.VITE_API_BASE_URL || window.location.origin;
}