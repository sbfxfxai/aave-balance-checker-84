#!/bin/bash
# Run Mythril security analysis on compiled contracts

set -e

echo "🔍 Running Mythril Security Analysis..."
echo ""

# Check if contracts are compiled
if [ ! -d "artifacts" ]; then
    echo "⚠️  Contracts not compiled. Compiling now..."
    npm run compile
fi

# Create reports directory
mkdir -p reports

# Analyze each contract
CONTRACTS=(
    "TiltVaultManager"
    "TiltVaultManagerFixed"
    "TiltVaultManagerV2"
)

TOTAL_ISSUES=0

for CONTRACT in "${CONTRACTS[@]}"; do
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Analyzing: $CONTRACT"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    # Find the contract artifact
    ARTIFACT_PATH="artifacts/contracts/src/${CONTRACT}.sol/${CONTRACT}.json"
    
    if [ ! -f "$ARTIFACT_PATH" ]; then
        echo "⚠️  Artifact not found: $ARTIFACT_PATH"
        echo "   Skipping $CONTRACT"
        echo ""
        continue
    fi
    
    # Extract bytecode from artifact
    BYTECODE=$(node -e "const artifact = require('./$ARTIFACT_PATH'); console.log(artifact.deployedBytecode || artifact.bytecode || '')")
    
    if [ -z "$BYTECODE" ] || [ "$BYTECODE" == "0x" ]; then
        echo "⚠️  No bytecode found in artifact"
        echo "   Skipping $CONTRACT"
        echo ""
        continue
    fi
    
    # Run Mythril analysis
    REPORT_FILE="reports/mythril-${CONTRACT}.md"
    
    echo "Running Mythril analysis..."
    myth analyze "$ARTIFACT_PATH" \
        --execution-timeout 300 \
        --max-depth 12 \
        --solv 0.8.20 \
        --format markdown \
        --output "$REPORT_FILE" || true
    
    if [ -f "$REPORT_FILE" ]; then
        ISSUES=$(grep -c "SWC-" "$REPORT_FILE" || echo "0")
        TOTAL_ISSUES=$((TOTAL_ISSUES + ISSUES))
        echo "✅ Analysis complete. Found $ISSUES issues."
        echo "   Report saved to: $REPORT_FILE"
    else
        echo "⚠️  No report generated"
    fi
    
    echo ""
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📊 Summary"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Total issues found: $TOTAL_ISSUES"
echo "Reports saved to: reports/"
echo ""
echo "Review the reports and fix critical/high severity issues before deployment."

