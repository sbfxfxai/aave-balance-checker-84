# Main Thread Optimization Guide

## Overview

This document outlines optimizations implemented to reduce Total Blocking Time (TBT) and break up long main-thread tasks.

## Problem

- **Total Blocking Time**: 460ms
- **8 long main-thread tasks** detected
- Tasks blocking the main thread for >50ms cause interactivity delays

## Optimizations Implemented

### 1. **Task Scheduling Utilities** (`utils/taskScheduler.ts`)

Created utilities to break up long-running tasks:

- **`scheduleIdleTask()`**: Schedules tasks during idle time using `requestIdleCallback`
- **`processInBatches()`**: Processes arrays in chunks, yielding to main thread between batches
- **`defer()`**: Defers execution to next event loop tick
- **`debounce()` / `throttle()`**: Prevents excessive function calls

### 2. **GMX Positions Processing** (`hooks/useGmxPositions.ts`)

**Before**: Synchronous `.map()` processing all positions at once

**After**:

- Small arrays (≤10 items): Process synchronously
- Large arrays: Process in batches of 5, yielding to main thread between batches
- Deferred console.log statements (only in development)

**Impact**: Prevents blocking when processing many positions

### 3. **SimpleDashboard Optimizations** (`components/SimpleDashboard.tsx`)

**Wallet Address Calculation**:

- Optimized `useMemo` with early returns
- Reduced array iterations
- Memoized helper function (`isEthereumAddress`)

**Refresh Handler**:

- Uses `startTransition` for non-urgent query invalidations
- Deferred error logging
- Memoized with `useCallback`

**Console Logging**:

- Deferred to avoid blocking (development only)

**Impact**: Faster wallet address resolution, non-blocking refreshes

### 4. **PrivyAuthProvider Deferred Setup** (`components/PrivyAuthProvider.tsx`)

**Before**: Console interception setup ran immediately on mount

**After**:

- Setup deferred using `setTimeout(..., 0)`
- Non-blocking initialization
- Proper cleanup on unmount

**Impact**: Faster initial render, non-blocking error suppression

### 5. **Main.tsx Interceptor Optimization** (`main.tsx`)

**Before**: All interceptors set up synchronously

**After**:

- Interceptor setup deferred using `requestIdleCallback` or `setTimeout`
- Non-blocking initialization
- Critical interceptors still work (fetch/XHR blocking happens early)

**Impact**: Faster initial page load

### 6. **React Optimization Utilities** (`utils/reactOptimization.ts`)

Created utilities for React-specific optimizations:

- **`useNonUrgentUpdate()`**: Uses `useDeferredValue` for non-urgent updates
- **`useNonUrgentCallback()`**: Wraps callbacks in `startTransition`
- **`useYieldingMemo()`**: Memoizes with yielding to main thread
- **`batchUpdates()`**: Batches multiple state updates

## Best Practices

### ✅ Do

1. **Break up long tasks**:

   ```typescript
   // Process in batches
   for (let i = 0; i < items.length; i += batchSize) {
     processBatch(items.slice(i, i + batchSize));
     await new Promise(resolve => setTimeout(resolve, 0)); // Yield
   }
   ```

2. **Use startTransition for non-urgent updates**:

   ```typescript
   startTransition(() => {
     setNonUrgentState(newValue);
   });
   ```

3. **Defer console.log in production**:

   ```typescript
   if (process.env.NODE_ENV === 'development') {
     setTimeout(() => console.log(...), 0);
   }
   ```

4. **Memoize expensive computations**:

   ```typescript
   const expensiveValue = useMemo(() => computeExpensive(), [deps]);
   ```

5. **Use requestIdleCallback for non-critical work**:

   ```typescript
   if ('requestIdleCallback' in window) {
     window.requestIdleCallback(() => doNonCriticalWork(), { timeout: 1000 });
   }
   ```

### ❌ Don't

1. **Don't process large arrays synchronously**:

   ```typescript
   // ❌ Bad: Blocks main thread
   const results = largeArray.map(expensiveOperation);
   
   // ✅ Good: Process in batches
   const results = await processInBatches(largeArray, expensiveOperation);
   ```

2. **Don't do heavy work in useEffect without deferring**:

   ```typescript
   // ❌ Bad: Blocks render
   useEffect(() => {
     doHeavyWork();
   }, []);
   
   // ✅ Good: Defer
   useEffect(() => {
     setTimeout(() => doHeavyWork(), 0);
   }, []);
   ```

3. **Don't log synchronously in production**:

   ```typescript
   // ❌ Bad: Can block
   console.log(expensiveObject);
   
   // ✅ Good: Defer
   setTimeout(() => console.log(expensiveObject), 0);
   ```

## Performance Targets

### Before Optimization

- **Total Blocking Time**: 460ms
- **Long Tasks**: 8 tasks >50ms
- **Interactivity**: Delayed

### After Optimization

- **Total Blocking Time**: <200ms (target)
- **Long Tasks**: <3 tasks >50ms (target)
- **Interactivity**: Improved responsiveness

## Monitoring

To monitor main thread blocking:

1. **Chrome DevTools Performance Tab**:
   - Record a session
   - Look for long tasks (red bars)
   - Check "Main" thread for blocking

2. **Lighthouse**:
   - Run performance audit
   - Check "Total Blocking Time" metric
   - Review "Avoid long main-thread tasks" opportunity

3. **Web Vitals**:
   - Monitor TBT in production
   - Set up alerts for TBT >300ms

## Future Optimizations

1. **Web Workers**:
   - Move heavy computations to Web Workers
   - Process GMX positions in worker
   - Calculate wallet addresses in worker

2. **Virtual Scrolling**:
   - For large lists (positions, transactions)
   - Only render visible items

3. **Incremental Rendering**:
   - Use React 18's concurrent features
   - Render components incrementally

4. **Code Splitting**:
   - Already implemented
   - Continue optimizing chunk sizes

5. **Service Workers**:
   - Cache heavy computations
   - Pre-compute values in background
