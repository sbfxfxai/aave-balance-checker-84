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
    <picture>
      {/* AVIF - Best compression, modern browsers */}
      <source
        srcSet="/tiltvault-logo-32w.avif 32w, /tiltvault-logo-64w.avif 64w, /tiltvault-logo-128w.avif 128w"
        sizes="(max-width: 640px) 32px, 40px"
        type="image/avif"
      />
      {/* WebP - Good compression, wide browser support */}
      <source
        srcSet="/tiltvault-logo-32w.webp 32w, /tiltvault-logo-64w.webp 64w, /tiltvault-logo-128w.webp 128w"
        sizes="(max-width: 640px) 32px, 40px"
        type="image/webp"
      />
      {/* PNG fallback - Optimized smaller versions */}
      <source
        srcSet="/tiltvault-logo-32w.png 32w, /tiltvault-logo-64w.png 64w, /tiltvault-logo-128w.png 128w"
        sizes="(max-width: 640px) 32px, 40px"
        type="image/png"
      />
      {/* Final fallback - Start with smallest optimized version */}
      <img
        src="/tiltvault-logo-32w.webp"
        alt="TiltVault"
        className={className}
        width={width}
        height={height}
        loading={loading}
        decoding="async"
        {...(fetchPriority === 'high' && { fetchPriority: 'high' as const })}
        onError={(e) => {
          // Fallback chain: optimized webp -> optimized png -> original
          const target = e.target as HTMLImageElement;
          if (target.src.includes('tiltvault-logo-32w.webp')) {
            target.src = '/tiltvault-logo-32w.png';
          } else if (target.src.includes('tiltvault-logo-32w.png')) {
            target.src = '/tiltvault-logo.png';
          }
        }}
      />
    </picture>
  );
}

