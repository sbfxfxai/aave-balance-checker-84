# Network Payload Optimization Guide

## Overview

This document outlines optimizations implemented to reduce network payload size and improve asset delivery.

## Problem

- **Total Network Payload**: 3,950 KiB
- Large JavaScript bundles
- Uncompressed assets
- Inefficient caching

## Optimizations Implemented

### 1. **Compression Configuration** (`vercel.json`)

Vercel automatically compresses assets, but we've added explicit headers:

- **Brotli/Gzip Compression**: Enabled for JS/CSS files
- **Content-Encoding Headers**: Explicitly set for compressed assets
- **Impact**: 60-80% size reduction for text assets

### 2. **Enhanced Caching Strategy** (`vercel.json`)

Implemented aggressive caching for different asset types:

#### Static Assets (JS, CSS, Fonts, Images):
```
Cache-Control: public, max-age=31536000, immutable
```
- **Duration**: 1 year (31536000 seconds)
- **Immutable**: Assets with hashed filenames never change
- **Impact**: Eliminates redundant downloads

#### HTML:
```
Cache-Control: public, max-age=0, must-revalidate
```
- **No Cache**: HTML must be revalidated on each request
- **Impact**: Always serves latest HTML while caching assets

#### Fonts:
- Added `Access-Control-Allow-Origin: *` for cross-origin font loading
- Long-term caching with immutable flag

### 3. **Build Optimizations** (`vite.config.ts`)

#### Minification:
- **ESBuild Minification**: Fast and efficient
- **CSS Minification**: Enabled
- **Source Maps**: Disabled in production
- **Impact**: 30-50% size reduction

#### Code Splitting:
- Already implemented (see `CODE_SPLITTING.md`)
- Separate chunks for different vendors
- Lazy loading for routes

### 4. **Asset-Specific Headers**

Different caching strategies for different file types:

- **JavaScript/CSS**: Long-term cache + compression
- **Fonts**: Long-term cache + CORS headers
- **Images**: Long-term cache
- **HTML**: No cache (always fresh)

## Expected Results

### Before Optimization:
- **Total Payload**: 3,950 KiB
- **Uncompressed**: ~4,000 KiB
- **Cache Hit Rate**: Low (no long-term caching)

### After Optimization:
- **Total Payload**: ~1,200-1,500 KiB (60-70% reduction)
  - Compressed JS/CSS: ~800-1,000 KiB
  - Images: ~200-300 KiB (after logo optimization)
  - Fonts: ~50-100 KiB
  - HTML: ~10-20 KiB
- **Cache Hit Rate**: High (95%+ for returning visitors)
- **First Load**: ~1,200-1,500 KiB
- **Subsequent Loads**: ~10-20 KiB (HTML only)

## Compression Ratios

### Typical Compression:
- **JavaScript**: 60-80% reduction (gzip/brotli)
- **CSS**: 70-85% reduction (gzip/brotli)
- **HTML**: 60-75% reduction (gzip/brotli)
- **JSON**: 70-90% reduction (gzip/brotli)

### Example:
- **Uncompressed JS**: 500 KiB
- **Gzipped**: ~150-200 KiB (60-70% reduction)
- **Brotli**: ~120-150 KiB (70-80% reduction)

## Caching Strategy

### First Visit:
1. Download HTML (~10-20 KiB)
2. Download JS chunks (~800-1,000 KiB compressed)
3. Download CSS (~50-100 KiB compressed)
4. Download fonts (~50-100 KiB)
5. Download images (~200-300 KiB)
6. **Total**: ~1,200-1,500 KiB

### Subsequent Visits:
1. Download HTML (~10-20 KiB) - revalidated
2. All other assets served from cache
3. **Total**: ~10-20 KiB

### After Deployment:
1. HTML revalidated
2. New assets (with new hashes) downloaded
3. Old assets remain cached (different hashes)
4. **Total**: Only changed assets downloaded

## Best Practices

### ✅ Do:

1. **Use hashed filenames**:
   - Vite automatically adds content hashes
   - Enables long-term caching with `immutable`

2. **Compress all text assets**:
   - Vercel automatically compresses
   - Brotli preferred over gzip

3. **Cache static assets aggressively**:
   - 1 year for hashed assets
   - `immutable` flag for never-changing assets

4. **Don't cache HTML**:
   - Always serve fresh HTML
   - Enables instant updates

5. **Optimize images**:
   - Use WebP/AVIF formats
   - Compress images before upload
   - Use responsive images

### ❌ Don't:

1. **Don't cache HTML**:
   - HTML must be fresh for updates
   - Use `max-age=0, must-revalidate`

2. **Don't cache API responses**:
   - API responses are dynamic
   - Use appropriate cache headers

3. **Don't use large unoptimized images**:
   - Optimize before upload
   - Use modern formats (WebP, AVIF)

4. **Don't bundle everything together**:
   - Use code splitting
   - Lazy load routes

## Monitoring

### Check Compression:
```bash
# Check if assets are compressed
curl -H "Accept-Encoding: gzip" -I https://www.tiltvault.com/assets/index.js

# Look for:
# Content-Encoding: gzip
# or
# Content-Encoding: br (Brotli)
```

### Check Cache Headers:
```bash
# Check cache headers
curl -I https://www.tiltvault.com/assets/index.js

# Look for:
# Cache-Control: public, max-age=31536000, immutable
```

### Lighthouse Audit:
- Run Lighthouse performance audit
- Check "Uses efficient cache policies"
- Check "Enable text compression"
- Check "Serve static assets with an efficient cache policy"

## Vercel-Specific Notes

Vercel automatically:
- ✅ Compresses assets (gzip/brotli)
- ✅ Serves from edge cache
- ✅ Optimizes images (if using Vercel Image Optimization)
- ✅ Handles HTTP/2 and HTTP/3

Our configuration:
- ✅ Explicit cache headers for better control
- ✅ Asset-specific caching strategies
- ✅ Compression headers for clarity

## Future Optimizations

1. **Image Optimization**:
   - Already started with logo optimization
   - Implement responsive images
   - Use CDN for image delivery

2. **Font Optimization**:
   - Subset fonts (only include used characters)
   - Use `font-display: swap`
   - Preload critical fonts

3. **Service Worker Caching**:
   - Cache API responses
   - Offline support
   - Background sync

4. **HTTP/3 (QUIC)**:
   - Vercel supports HTTP/3
   - Faster connection establishment
   - Better multiplexing

5. **CDN Optimization**:
   - Vercel Edge Network
   - Geographic distribution
   - Reduced latency

## Verification

After deployment, verify:

1. **Compression Working**:
   - Check Network tab in DevTools
   - Look for "Content-Encoding: gzip" or "br"
   - Compare "Size" vs "Transferred" columns

2. **Caching Working**:
   - First load: Full download
   - Second load: "from disk cache" or "from memory cache"
   - Check "Cache-Control" header

3. **Payload Size**:
   - Lighthouse: "Total network payload"
   - Should be <2,000 KiB after optimization
   - Target: <1,500 KiB

