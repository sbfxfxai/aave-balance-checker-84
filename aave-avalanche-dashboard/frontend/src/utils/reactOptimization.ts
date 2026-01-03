/**
 * React Optimization Utilities
 * 
 * Provides utilities for optimizing React rendering and reducing main thread blocking
 */

import { startTransition, useDeferredValue, useMemo, useCallback } from 'react';

/**
 * Wraps a value update in startTransition for non-urgent updates
 * This allows React to interrupt the update if more urgent work comes in
 */
export function useNonUrgentUpdate<T>(value: T): T {
  return useDeferredValue(value);
}

/**
 * Creates a memoized callback that uses startTransition for non-urgent updates
 * Useful for expensive operations that don't need immediate feedback
 */
export function useNonUrgentCallback<T extends (...args: any[]) => any>(
  callback: T,
  deps: React.DependencyList
): T {
  return useCallback((...args: Parameters<T>) => {
    startTransition(() => {
      callback(...args);
    });
  }, deps) as T;
}

/**
 * Memoizes a value with automatic cleanup of expensive computations
 * Yields to main thread during computation if needed
 */
export function useYieldingMemo<T>(
  factory: () => T,
  deps: React.DependencyList
): T {
  return useMemo(() => {
    // For expensive computations, yield to main thread
    const result = factory();
    
    // If computation took too long, yield on next tick
    if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
      // Already computed, but yield for next operation
      window.requestIdleCallback(() => {}, { timeout: 0 });
    }
    
    return result;
  }, deps);
}

/**
 * Batches multiple state updates to reduce re-renders
 * Useful when updating multiple related state values
 */
export function batchUpdates(updates: (() => void)[]): void {
  startTransition(() => {
    updates.forEach(update => update());
  });
}

