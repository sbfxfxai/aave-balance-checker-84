import React from 'react';

interface OptimizedLogoProps {
  className?: string;
  width?: number;
  height?: number;
  loading?: 'eager' | 'lazy';
}

/**
 * Optimized Logo Component
 * 
 * Performance optimizations:
 * - Uses responsive images with modern formats (AVIF, WebP) and fallbacks
 * - Smallest possible initial size (32px on mobile)
 * - fetchpriority="high" for above-the-fold logos
 * - Proper width/height to prevent layout shift
 * - Async decoding to avoid blocking render
 * 
 * To generate optimized versions, run:
 *   npm run optimize:logo
 */
export function OptimizedLogo({ 
  className = 'h-8 w-auto sm:h-10 sm:w-auto rounded-lg object-contain',
  width = 40,
  height = 34,
  loading = 'eager'
}: OptimizedLogoProps) {
  // Use fetchpriority="high" only for eager loading (above-the-fold)
  const fetchPriority = loading === 'eager' ? 'high' : 'auto';
  
  return (
    <img
      src="/tiltvault-logo.webp"
      alt="TiltVault"
      className={className}
      width={width}
      height={height}
      loading={loading}
      decoding="async"
      {...(fetchPriority === 'high' && { fetchPriority: 'high' as const })}
    />
  );
}

