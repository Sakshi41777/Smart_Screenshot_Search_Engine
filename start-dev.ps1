# start-dev.ps1
Write-Host "Starting React + Electron (Dev Mode)..." -ForegroundColor Cyan

# 1. Start React Dev Server
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd client; npm start" -WorkingDirectory $PSScriptRoot

# 2. Start Electron after waiting a few seconds
Start-Sleep -Seconds 4

# Start Electron in dev mode
Start-Process powershell -ArgumentList "-NoExit", "-Command", "npm run dev" -WorkingDirectory $PSScriptRoot

Write-Host "Development environment started." -ForegroundColor Green
