# PowerShell setup script for Nippo App
Write-Host "Nippo App Setup Starting..." -ForegroundColor Green

Write-Host ""
Write-Host "1. Installing Node.js dependencies..." -ForegroundColor Yellow
npm install

if ($LASTEXITCODE -eq 0) {
    Write-Host "Node.js dependencies installed successfully!" -ForegroundColor Green
} else {
    Write-Host "Failed to install Node.js dependencies" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "2. Installing Python dependencies..." -ForegroundColor Yellow
Set-Location backend
pip install -r requirements.txt

if ($LASTEXITCODE -eq 0) {
    Write-Host "Python dependencies installed successfully!" -ForegroundColor Green
} else {
    Write-Host "Failed to install Python dependencies" -ForegroundColor Red
    Set-Location ..
    exit 1
}

Set-Location ..

Write-Host ""
Write-Host "Setup completed successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "To start the app:" -ForegroundColor Cyan
Write-Host "  npm start" -ForegroundColor White
Write-Host ""
Write-Host "To build:" -ForegroundColor Cyan  
Write-Host "  npm run build" -ForegroundColor White
Write-Host ""

Read-Host "Press Enter to continue"