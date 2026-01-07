# Quick script to start dev server
# Run this in PowerShell: .\RUN_DEV.ps1

Write-Host "`n🚀 Starting TiltVault Development Server`n" -ForegroundColor Green

# Navigate to frontend directory
Set-Location frontend

# Check if node_modules exists
if (-not (Test-Path "node_modules")) {
    Write-Host "⚠️  node_modules not found. Installing dependencies...`n" -ForegroundColor Yellow
    npm install
    Write-Host "`n✅ Dependencies installed`n" -ForegroundColor Green
}

# Start dev server
Write-Host "Starting Vite dev server...`n" -ForegroundColor Cyan
npm run dev

