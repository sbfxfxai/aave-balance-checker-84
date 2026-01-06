#!/usr/bin/env node
/**
 * Run Mythril security analysis on compiled contracts
 * Windows-compatible version using Node.js
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const CONTRACTS = [
  'TiltVaultManager',
  'TiltVaultManagerFixed',
  'TiltVaultManagerV2'
];

function runMythril() {
  console.log('🔍 Running Mythril Security Analysis...\n');

  // Check if contracts are compiled
  if (!fs.existsSync('artifacts')) {
    console.log('⚠️  Contracts not compiled. Compiling now...');
    execSync('npm run compile', { stdio: 'inherit' });
  }

  // Create reports directory
  if (!fs.existsSync('reports')) {
    fs.mkdirSync('reports', { recursive: true });
  }

  let totalIssues = 0;

  for (const contract of CONTRACTS) {
    console.log('━'.repeat(80));
    console.log(`Analyzing: ${contract}`);
    console.log('━'.repeat(80));

    const artifactPath = path.join('artifacts', 'contracts', 'src', `${contract}.sol`, `${contract}.json`);

    if (!fs.existsSync(artifactPath)) {
      console.log(`⚠️  Artifact not found: ${artifactPath}`);
      console.log(`   Skipping ${contract}\n`);
      continue;
    }

    const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
    const bytecode = artifact.deployedBytecode || artifact.bytecode || '';

    if (!bytecode || bytecode === '0x') {
      console.log('⚠️  No bytecode found in artifact');
      console.log(`   Skipping ${contract}\n`);
      continue;
    }

    const reportFile = path.join('reports', `mythril-${contract}.md`);

    try {
      console.log('Running Mythril analysis...');
      
      // Run Mythril - analyze the Solidity file directly
      const solPath = path.join('src', `${contract}.sol`);
      
      if (fs.existsSync(solPath)) {
        execSync(
          `myth analyze "${solPath}" --execution-timeout 300 --max-depth 12 --solv 0.8.20 --format markdown --output "${reportFile}"`,
          { stdio: 'inherit', cwd: process.cwd() }
        );
      } else {
        console.log(`⚠️  Solidity file not found: ${solPath}`);
        console.log(`   Skipping ${contract}\n`);
        continue;
      }

      if (fs.existsSync(reportFile)) {
        const reportContent = fs.readFileSync(reportFile, 'utf8');
        const issues = (reportContent.match(/SWC-\d+/g) || []).length;
        totalIssues += issues;
        console.log(`✅ Analysis complete. Found ${issues} issues.`);
        console.log(`   Report saved to: ${reportFile}`);
      } else {
        console.log('⚠️  No report generated');
      }
    } catch (error) {
      console.log(`⚠️  Error analyzing ${contract}:`, error.message);
      // Continue with other contracts
    }

    console.log('');
  }

  console.log('━'.repeat(80));
  console.log('📊 Summary');
  console.log('━'.repeat(80));
  console.log(`Total issues found: ${totalIssues}`);
  console.log('Reports saved to: reports/');
  console.log('');
  console.log('Review the reports and fix critical/high severity issues before deployment.');
}

// Check if Mythril is installed
try {
  execSync('myth --version', { stdio: 'ignore' });
  runMythril();
} catch (error) {
  console.error('❌ Mythril is not installed.');
  console.error('');
  console.error('Install Mythril:');
  console.error('  pip install mythril');
  console.error('');
  console.error('Or install all audit tools:');
  console.error('  pip install -r requirements-audit.txt');
  process.exit(1);
}

