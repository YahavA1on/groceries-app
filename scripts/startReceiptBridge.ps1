$ErrorActionPreference = 'Stop'

$projectRef = 'erfkngpyauhibcjfsszx'
$repoRoot = Split-Path -Parent $PSScriptRoot
$bridgeSecret = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
$bridgeOut = Join-Path $env:TEMP 'groceries-receipt-bridge.out.log'
$bridgeErr = Join-Path $env:TEMP 'groceries-receipt-bridge.err.log'
$tunnelOut = Join-Path $env:TEMP 'groceries-receipt-tunnel.out.log'
$tunnelErr = Join-Path $env:TEMP 'groceries-receipt-tunnel.err.log'
$bridge = $null
$tunnel = $null

Remove-Item $bridgeOut,$bridgeErr,$tunnelOut,$tunnelErr -ErrorAction SilentlyContinue

try {
  $env:RECEIPT_BRIDGE_SECRET = $bridgeSecret
  $bridge = Start-Process -FilePath 'node.exe' `
    -ArgumentList @('scripts/receiptBridge.js') `
    -WorkingDirectory $repoRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $bridgeOut `
    -RedirectStandardError $bridgeErr `
    -PassThru

  Start-Sleep -Seconds 2
  if ($bridge.HasExited) {
    throw "Receipt bridge failed to start: $(Get-Content $bridgeErr -Raw -ErrorAction SilentlyContinue)"
  }

  $defaultCloudflared = Join-Path $env:LOCALAPPDATA 'groceries-app\cloudflared.exe'
  $cloudflared = if ($env:CLOUDFLARED_PATH) {
    $env:CLOUDFLARED_PATH
  } elseif (Test-Path $defaultCloudflared) {
    $defaultCloudflared
  } else {
    (Get-Command cloudflared.exe -ErrorAction Stop).Source
  }
  $tunnel = Start-Process -FilePath $cloudflared `
    -ArgumentList @('tunnel', '--url', 'http://127.0.0.1:8787', '--no-autoupdate') `
    -WindowStyle Hidden `
    -RedirectStandardOutput $tunnelOut `
    -RedirectStandardError $tunnelErr `
    -PassThru

  $tunnelUrl = ''
  $tunnelReady = $false
  for ($attempt = 0; $attempt -lt 40 -and !$tunnelReady; $attempt += 1) {
    Start-Sleep -Milliseconds 500
    if ($tunnel.HasExited) {
      throw "Receipt tunnel stopped: $(Get-Content $tunnelErr -Raw -ErrorAction SilentlyContinue)"
    }
    $output = (Get-Content $tunnelOut -Raw -ErrorAction SilentlyContinue) + "`n" +
      (Get-Content $tunnelErr -Raw -ErrorAction SilentlyContinue)
    $tunnelUrl = [regex]::Match($output, 'https://[a-zA-Z0-9-]+\.trycloudflare\.com').Value
    $tunnelReady = $tunnelUrl -and $output.Contains('Registered tunnel connection')
  }
  if (!$tunnelReady) { throw 'Receipt tunnel did not establish a registered HTTPS connection.' }

  & npx.cmd supabase secrets set `
    "RECEIPT_BRIDGE_URL=$tunnelUrl" `
    "RECEIPT_BRIDGE_SECRET=$bridgeSecret" `
    --project-ref $projectRef
  if ($LASTEXITCODE -ne 0) { throw 'Could not update Supabase receipt bridge secrets.' }

  Write-Host "Encrypted receipt bridge is online: $tunnelUrl" -ForegroundColor Green
  Write-Host 'Keep this window open. Press Ctrl+C to stop the bridge.'
  Wait-Process -Id $tunnel.Id
} finally {
  if ($tunnel -and !$tunnel.HasExited) { Stop-Process -Id $tunnel.Id -Force }
  if ($bridge -and !$bridge.HasExited) { Stop-Process -Id $bridge.Id -Force }
  Remove-Item Env:RECEIPT_BRIDGE_SECRET -ErrorAction SilentlyContinue
}
