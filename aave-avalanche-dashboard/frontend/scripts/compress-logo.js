#!/usr/bin/env node

/**
 * Compress and optimize tiltvault-logo.png in place
 * 
 * This script optimizes the original PNG file by:
 * 1. Reducing file size while maintaining quality
 * 2. Optimizing PNG compression
 * 3. Removing unnecessary metadata
 * 
 * Requirements:
 * - Install sharp: npm install --save-dev sharp
 * 
 * Usage:
 *   npm run compress:logo
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logoPath = path.join(__dirname, '../public/tiltvault-logo.png');
const backupPath = path.join(__dirname, '../public/tiltvault-logo-backup.png');

async function compressLogo() {
  console.log('🖼️  Compressing tiltvault-logo.png...\n');

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

  if (!fs.existsSync(logoPath)) {
    console.error(`❌ Logo not found at: ${logoPath}`);
    process.exit(1);
  }

  // Get original file size
  const originalStats = fs.statSync(logoPath);
  const originalSize = originalStats.size;
  console.log(`📐 Original: ${(originalSize / 1024).toFixed(2)}KB\n`);

  // Create backup
  console.log('💾 Creating backup...');
  fs.copyFileSync(logoPath, backupPath);
  console.log(`   Backup saved to: tiltvault-logo-backup.png\n`);

  try {
    // Read and optimize the image
    const image = sharp(logoPath);
    const metadata = await image.metadata();
    
    console.log(`📊 Image info: ${metadata.width}x${metadata.height}px, ${metadata.format}\n`);

    // Optimize PNG with aggressive compression
    // Keep original dimensions but optimize compression
    await image
      .png({
        compressionLevel: 9,        // Maximum compression (0-9)
        quality: 90,                // Quality (1-100)
        palette: true,               // Use palette if beneficial
        effort: 10,                  // Compression effort (1-10, higher = slower but better)
        colors: 256,                 // Limit colors if beneficial
      })
      .toFile(logoPath + '.tmp');

    // Replace original with optimized version
    fs.renameSync(logoPath + '.tmp', logoPath);

    // Get new file size
    const newStats = fs.statSync(logoPath);
    const newSize = newStats.size;
    const savings = ((1 - newSize / originalSize) * 100).toFixed(1);
    const savingsKB = ((originalSize - newSize) / 1024).toFixed(2);

    console.log('✅ Compression complete!\n');
    console.log('📊 Results:');
    console.log(`   Original: ${(originalSize / 1024).toFixed(2)}KB`);
    console.log(`   Optimized: ${(newSize / 1024).toFixed(2)}KB`);
    console.log(`   Savings: ${savingsKB}KB (${savings}%)\n`);

    // If savings are minimal, try WebP conversion for comparison
    console.log('🔄 Trying WebP conversion for comparison...');
    const webpPath = logoPath.replace('.png', '.webp');
    await image
      .webp({ quality: 90, effort: 6 })
      .toFile(webpPath);

    const webpStats = fs.statSync(webpPath);
    const webpSavings = ((1 - webpStats.size / originalSize) * 100).toFixed(1);
    
    console.log(`   WebP version: ${(webpStats.size / 1024).toFixed(2)}KB (${webpSavings}% savings)`);
    console.log(`   WebP saved as: tiltvault-logo.webp (optional alternative)\n`);

    console.log('✨ Logo compression complete!');
    console.log(`   Original backed up to: tiltvault-logo-backup.png`);
    console.log(`   Optimized PNG: tiltvault-logo.png`);
    console.log(`   Optional WebP: tiltvault-logo.webp\n`);

  } catch (error) {
    console.error('❌ Compression failed:', error);
    // Restore backup if compression failed
    if (fs.existsSync(backupPath)) {
      console.log('🔄 Restoring backup...');
      fs.copyFileSync(backupPath, logoPath);
      console.log('✅ Original file restored.');
    }
    process.exit(1);
  }
}

compressLogo().catch((error) => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});

