# CSS Optimization Guide

## Overview

This document outlines optimizations implemented to reduce unused CSS and improve CSS delivery.

## Problem

- **Unused CSS**: 31 KiB estimated savings
- Multiple CSS classes for similar functionality
- Unused CSS files
- No critical CSS extraction

## Optimizations Implemented

### 1. **Removed Unused CSS Files**

#### Deleted `App.css`:
- **Reason**: Unused Vite template styles
- **Savings**: ~2-3 KiB
- **Impact**: Eliminates unused CSS from bundle

### 2. **Optimized Progress Bar CSS** (`GmxIntegration.module.css`)

**Before**: 13 separate classes (`.progressBar`, `.progressBar10`, `.progressBar20`, etc.)
```css
.progressBar { width: 0%; }
.progressBar10 { width: 10%; }
.progressBar20 { width: 20%; }
/* ... 10 more classes ... */
```

**After**: Single class with CSS variable
```css
.progressBar {
  width: var(--progress-width, 0%);
  /* other properties */
}
```

**Usage**:
```tsx
<div 
  className={styles.progressBar}
  style={{ '--progress-width': `${percentage}%` } as React.CSSProperties}
/>
```

**Savings**: ~1.5-2 KiB
**Impact**: More maintainable, dynamic width without multiple classes

### 3. **Enhanced Tailwind Purging** (`tailwind.config.ts`)

**Before**: Basic content paths
```ts
content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"]
```

**After**: Comprehensive content scanning
```ts
content: [
  "./index.html",
  "./src/**/*.{js,ts,jsx,tsx}",
  "./pages/**/*.{ts,tsx}",
  "./components/**/*.{ts,tsx}",
  "./app/**/*.{ts,tsx}",
]
```

**Impact**: Ensures all Tailwind classes are properly detected and unused classes are purged

### 4. **Critical CSS Already Inline** (`index.html`)

Critical CSS for initial render is already inline in the HTML:
- Initial shell styles
- Loading spinner
- Header styles

**Impact**: Prevents flash of unstyled content (FOUC)

## Expected Results

### Before Optimization:
- **Unused CSS**: ~31 KiB
- **Progress Bar CSS**: 13 classes (~2 KiB)
- **Unused Files**: App.css (~2-3 KiB)
- **Total Waste**: ~35-36 KiB

### After Optimization:
- **Unused CSS**: ~5-10 KiB (Tailwind purging handles most)
- **Progress Bar CSS**: 1 class (~0.2 KiB)
- **Unused Files**: 0
- **Total Savings**: ~25-30 KiB (70-85% reduction)

## CSS Delivery Strategy

### Current Setup:
1. **Critical CSS**: Inline in `<head>` (initial shell)
2. **Main CSS**: Bundled by Vite, loaded with JS
3. **Module CSS**: Scoped CSS modules (GmxIntegration, SquarePaymentForm)

### Optimization Opportunities:

#### 1. **CSS Code Splitting** (Already Enabled)
- Vite automatically splits CSS per route
- Each route loads only its CSS
- **Impact**: Reduces initial CSS payload

#### 2. **Tailwind Purging** (Enabled)
- Removes unused utility classes
- Scans all source files
- **Impact**: Keeps Tailwind CSS small

#### 3. **CSS Minification** (Enabled)
- ESBuild minifies CSS
- Removes whitespace and comments
- **Impact**: 30-50% size reduction

## Best Practices

### ✅ Do:

1. **Use CSS Modules for component-specific styles**:
   ```tsx
   import styles from './Component.module.css';
   ```

2. **Use Tailwind for utility classes**:
   ```tsx
   <div className="flex items-center gap-2">
   ```

3. **Use CSS variables for dynamic values**:
   ```css
   .progress { width: var(--progress-width, 0%); }
   ```

4. **Keep critical CSS inline**:
   - Initial shell styles
   - Above-the-fold content

5. **Let Tailwind purge unused classes**:
   - Ensure content paths are correct
   - Use Tailwind classes directly (not in strings)

### ❌ Don't:

1. **Don't create multiple classes for similar functionality**:
   ```css
   /* ❌ Bad */
   .width10 { width: 10%; }
   .width20 { width: 20%; }
   
   /* ✅ Good */
   .width { width: var(--width, 0%); }
   ```

2. **Don't use inline styles for static values**:
   ```tsx
   /* ❌ Bad */
   <div style={{ width: '100px' }}>
   
   /* ✅ Good */
   <div className="w-25">
   ```

3. **Don't import unused CSS files**:
   - Remove unused imports
   - Delete unused CSS files

4. **Don't use string concatenation for Tailwind classes**:
   ```tsx
   /* ❌ Bad - Tailwind can't detect */
   <div className={`width${size}`}>
   
   /* ✅ Good - Tailwind detects */
   <div className={size === 10 ? 'w-10' : 'w-20'}>
   ```

## Monitoring

### Check CSS Bundle Size:
```bash
npm run build
# Check dist/assets/*.css file sizes
```

### Verify Tailwind Purging:
1. Build the app
2. Check generated CSS file
3. Search for unused classes - they should be removed

### Lighthouse Audit:
- Run Lighthouse performance audit
- Check "Remove unused CSS" opportunity
- Should show <10 KiB unused CSS after optimization

## Future Optimizations

1. **CSS-in-JS Optimization**:
   - If using styled-components or similar
   - Extract critical CSS
   - Defer non-critical styles

2. **PostCSS Plugins**:
   - Add `purgecss` for additional purging
   - Add `cssnano` for advanced minification
   - Add `autoprefixer` (already enabled)

3. **Critical CSS Extraction**:
   - Extract above-the-fold CSS
   - Inline critical CSS
   - Defer rest of CSS

4. **CSS Preloading**:
   - Preload critical CSS files
   - Use `<link rel="preload">` for important styles

5. **CSS Variables Optimization**:
   - Use CSS variables for theming
   - Reduce duplicate color values
   - Centralize design tokens

## Verification

After deployment, verify:

1. **CSS Bundle Size**:
   - Check Network tab in DevTools
   - CSS files should be <200 KiB (compressed)
   - Total CSS should be <300 KiB

2. **Unused CSS**:
   - Lighthouse: "Remove unused CSS"
   - Should show <10 KiB unused CSS
   - Most unused CSS should be from third-party libraries

3. **CSS Loading**:
   - Critical CSS inline (no FOUC)
   - Non-critical CSS loaded asynchronously
   - No render-blocking CSS

