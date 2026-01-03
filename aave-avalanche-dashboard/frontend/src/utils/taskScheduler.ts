/**
 * Task Scheduler Utilities
 * 
 * Helps break up long-running tasks to prevent blocking the main thread.
 * Uses requestIdleCallback when available, falls back to setTimeout.
 */

/**
 * Schedules a task to run during idle time (non-blocking)
 * @param callback Function to execute during idle time
 * @param timeout Maximum time to wait before executing (fallback)
 */
export function scheduleIdleTask(
  callback: () => void,
  timeout: number = 5000
): void {
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    window.requestIdleCallback(callback, { timeout });
  } else {
    // Fallback: use setTimeout with small delay to yield to main thread
    setTimeout(callback, 0);
  }
}

/**
 * Breaks up an array processing task into smaller chunks
 * Processes items in batches during idle time to prevent blocking
 * 
 * @param items Array to process
 * @param processor Function to process each item
 * @param batchSize Number of items to process per batch
 * @param onProgress Optional callback for progress updates
 * @returns Promise that resolves when all items are processed
 */
export async function processInBatches<T, R>(
  items: T[],
  processor: (item: T, index: number) => R,
  batchSize: number = 10,
  onProgress?: (processed: number, total: number) => void
): Promise<R[]> {
  const results: R[] = [];
  let processed = 0;

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    
    // Process batch synchronously
    const batchResults = batch.map((item, batchIndex) => 
      processor(item, i + batchIndex)
    );
    results.push(...batchResults);
    processed += batch.length;

    // Yield to main thread after each batch
    if (i + batchSize < items.length) {
      await new Promise<void>((resolve) => {
        scheduleIdleTask(() => resolve(), 100);
      });
    }

    // Report progress if callback provided
    if (onProgress) {
      onProgress(processed, items.length);
    }
  }

  return results;
}

/**
 * Defers execution of a function to the next event loop tick
 * Useful for breaking up synchronous work
 */
export function defer(callback: () => void): void {
  setTimeout(callback, 0);
}

/**
 * Creates a debounced version of a function
 * Useful for expensive operations that might be called frequently
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout | null = null;
  
  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      timeout = null;
      func(...args);
    };
    
    if (timeout) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(later, wait);
  };
}

/**
 * Throttles a function to execute at most once per interval
 */
export function throttle<T extends (...args: any[]) => any>(
  func: T,
  limit: number
): (...args: Parameters<T>) => void {
  let inThrottle: boolean;
  
  return function executedFunction(...args: Parameters<T>) {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

