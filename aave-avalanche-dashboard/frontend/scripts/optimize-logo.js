#!/usr/bin/env node

/**
 * Logo Image Optimization Script
 * 
 * This script optimizes the TiltVault logo for web use by:
 * 1. Creating multiple sizes (32px, 64px, 128px, 256px)
 * 2. Converting to WebP format (better compression)
 * 3. Creating AVIF versions (best compression, modern browsers)
 * 
 * Requirements:
 * - Install sharp: npm install --save-dev sharp
 * 
 * Usage:
 *   npm run optimize:logo
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const inputPath = path.join(__dirname, '../public/tiltvault-logo.png');
const outputDir = path.join(__dirname, '../public');

// Sizes for responsive images (width in pixels)
// Aspect ratio: 1848/1587 ≈ 1.164
const sizes = [
  { width: 32, height: 28 },   // Small (mobile header)
  { width: 64, height: 55 },   // Medium (tablet header)
  { width: 128, height: 110 }, // Large (desktop header)
  { width: 256, height: 220 }, // XL (high DPI)
];

async function optimizeLogo() {
  console.log('🖼️  Optimizing TiltVault logo...\n');

  // Check if sharp is available
  let sharp;
  try {
    const sharpModule = await import('sharp');
    sharp = sharpModule.default;
  } catch (e) {
    console.error('❌ Error: sharp is not installed.');
    console.error('   Install it with: npm install --save-dev sharp');
    process.exit(1);
  }

  if (!fs.existsSync(inputPath)) {
    console.error(`❌ Logo not found at: ${inputPath}`);
    process.exit(1);
  }

  const image = sharp(inputPath);
  const metadata = await image.metadata();
  console.log(`📐 Original: ${metadata.width}x${metadata.height}px, ${(metadata.size / 1024).toFixed(2)}KB\n`);

  // Create optimized versions
  for (const size of sizes) {
    const baseName = `tiltvault-logo-${size.width}w`;
    
    // WebP version (better compression, wide browser support)
    await image
      .clone()
      .resize(size.width, size.height, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: 85, effort: 6 })
      .toFile(path.join(outputDir, `${baseName}.webp`));
    
    // AVIF version (best compression, modern browsers)
    await image
      .clone()
      .resize(size.width, size.height, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .avif({ quality: 80, effort: 6 })
      .toFile(path.join(outputDir, `${baseName}.avif`));
    
    // PNG fallback (smaller optimized version)
    await image
      .clone()
      .resize(size.width, size.height, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9, quality: 90 })
      .toFile(path.join(outputDir, `${baseName}.png`));

    const webpStats = fs.statSync(path.join(outputDir, `${baseName}.webp`));
    const avifStats = fs.statSync(path.join(outputDir, `${baseName}.avif`));
    const pngStats = fs.statSync(path.join(outputDir, `${baseName}.png`));
    
    console.log(`✅ ${size.width}x${size.height}px:`);
    console.log(`   WebP: ${(webpStats.size / 1024).toFixed(2)}KB`);
    console.log(`   AVIF: ${(avifStats.size / 1024).toFixed(2)}KB`);
    console.log(`   PNG:  ${(pngStats.size / 1024).toFixed(2)}KB\n`);
  }

  // Create a small optimized version of the original for immediate use
  await image
    .clone()
    .resize(128, 110, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .webp({ quality: 85, effort: 6 })
    .toFile(path.join(outputDir, 'tiltvault-logo-optimized.webp'));

  const optimizedStats = fs.statSync(path.join(outputDir, 'tiltvault-logo-optimized.webp'));
  const originalStats = fs.statSync(inputPath);
  const savings = ((1 - optimizedStats.size / originalStats.size) * 100).toFixed(1);
  
  console.log('📊 Optimization Summary:');
  console.log(`   Original: ${(originalStats.size / 1024).toFixed(2)}KB`);
  console.log(`   Optimized (128px WebP): ${(optimizedStats.size / 1024).toFixed(2)}KB`);
  console.log(`   Savings: ${savings}%\n`);
  console.log('✨ Logo optimization complete!');
  console.log('   Update image tags to use the optimized versions with srcset.');
}

optimizeLogo().catch((error) => {
  console.error('❌ Optimization failed:', error);
  process.exit(1);
});

