#!/bin/bash
echo "Creating Beta v15 Release..."

# Add all changes
git add -A

# Commit changes
git commit -m "feat: Fix payment amount transfer to use exact user input

Critical fix for payment amount accuracy - payments now transfer exactly 
what users input (e.g., 1.00 USDC) instead of inflated amounts (e.g., 1.106221 USDC).

Changes:
- process-payment.ts: Added Redis lookup for original deposit amount from payment_info
- webhook.ts: Removed fallback calculations from Square total
- Preserved immediate funding while fixing amount source

Files modified:
- api/square/process-payment.ts
- api/square/webhook.ts

Version: beta1.0 v15"

# Create and push tag
git tag -a beta1.0-v15 -m "Beta v15 - Payment Amount Fix"

# Push everything
git push origin main
git push origin beta1.0-v15

echo "✅ Beta v15 pushed to GitHub!"
echo "Go to GitHub to create the release from tag beta1.0-v15"
