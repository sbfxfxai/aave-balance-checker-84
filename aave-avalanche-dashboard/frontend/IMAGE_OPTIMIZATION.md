# Image Optimization Guide

## Logo Optimization

The TiltVault logo has been optimized for web performance using responsive images with modern formats (AVIF, WebP) and fallbacks.

### Quick Start

1. **Install dependencies:**
   ```bash
   npm install --save-dev sharp
   ```

2. **Run the optimization script:**
   ```bash
   npm run optimize:logo
   ```

This will generate:
- Multiple sizes: 32px, 64px, 128px, 256px (width)
- Modern formats: AVIF (best compression), WebP (wide support)
- PNG fallbacks: Optimized PNG versions for older browsers
- Optimized default: `tiltvault-logo-optimized.webp` for immediate use

### Expected Results

- **Original:** ~1,800 KB (1848x1587px PNG)
- **Optimized 128px WebP:** ~15-30 KB (estimated 98%+ savings)
- **Optimized 32px AVIF:** ~2-5 KB (estimated 99%+ savings)

### Implementation

All logo images now use the `OptimizedLogo` component which:
- Automatically serves AVIF to modern browsers
- Falls back to WebP for wider support
- Falls back to PNG for older browsers
- Uses responsive `srcset` to serve appropriate sizes
- Prevents layout shift with explicit dimensions

### Files Generated

After running the script, you'll have:
```
public/
  tiltvault-logo.png (original, keep for fallback)
  tiltvault-logo-optimized.webp (default optimized version)
  tiltvault-logo-32w.avif
  tiltvault-logo-32w.webp
  tiltvault-logo-32w.png
  tiltvault-logo-64w.avif
  tiltvault-logo-64w.webp
  tiltvault-logo-64w.png
  tiltvault-logo-128w.avif
  tiltvault-logo-128w.webp
  tiltvault-logo-128w.png
  tiltvault-logo-256w.avif
  tiltvault-logo-256w.webp
  tiltvault-logo-256w.png
```

### Browser Support

- **AVIF:** Chrome 85+, Firefox 93+, Safari 16+
- **WebP:** Chrome 23+, Firefox 65+, Safari 14+, Edge 18+
- **PNG:** Universal fallback

### Performance Impact

- **Before:** 1.8MB logo loaded on every page
- **After:** ~15-30KB loaded (appropriate size for viewport)
- **Estimated savings:** 1,770+ KB per page load
- **LCP improvement:** ~2-3 seconds faster on slow connections

