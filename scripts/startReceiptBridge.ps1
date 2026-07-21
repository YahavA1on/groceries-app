$ErrorActionPreference = 'Stop'

$projectRef = 'erfkngpyauhibcjfsszx'
$repoRoot = Split-Path -Parent $PSScriptRoot
$bridgeSecret = [guid]::NewGuid().ToString('N') + [guid]::NewGuid().ToString('N')
$bridgeOut = Join-Path $env:TEMP 'groceries-receipt-bridge.out.log'
$bridgeErr = Join-Path $env:TEMP 'groceries-receipt-bridge.err.log'
$tunnelOut = Join-Path $env:TEMP 'groceries-receipt-tunnel.out.log'
$tunnelErr = Join-Path $env:TEMP 'groceries-receipt-tunnel.err.log'
$tunnelUrlFile = Join-Path $env:TEMP 'groceries-receipt-tunnel.url'
$defaultCloudflared = Join-Path $env:LOCALAPPDATA 'groceries-app\cloudflared.exe'
$bridge = $null
$tunnel = $null

try {
  $existingBridge = Invoke-WebRequest `
    -Uri 'http://127.0.0.1:8787/health' `
    -UseBasicParsing `
    -TimeoutSec 2
  if ($existingBridge.StatusCode -eq 200 -and $existingBridge.Content.Trim() -eq 'ok') {
    $savedTunnelUrl = if (Test-Path $tunnelUrlFile) { (Get-Content $tunnelUrlFile -Raw).Trim() } else { '' }
    try {
      $publicHealth = Invoke-WebRequest -Uri "$savedTunnelUrl/health" -UseBasicParsing -TimeoutSec 5
      if ($publicHealth.StatusCode -eq 200 -and $publicHealth.Content.Trim() -eq 'ok') {
        Write-Host "The encrypted receipt bridge is already online: $savedTunnelUrl" -ForegroundColor Green
        exit 0
      }
    } catch {
      Write-Warning 'The local bridge is running but its public tunnel expired. Restarting both.'
    }

    $existingConnection = Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($existingConnection) { Stop-Process -Id $existingConnection.OwningProcess -Force -ErrorAction SilentlyContinue }
    Get-Process cloudflared -ErrorAction SilentlyContinue |
      Where-Object { $_.Path -eq $defaultCloudflared } |
      Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
  }
} catch {
  # No healthy bridge is listening, so continue with a normal startup.
}

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

  $cloudflared = if ($env:CLOUDFLARED_PATH) {
    $env:CLOUDFLARED_PATH
  } elseif (Test-Path $defaultCloudflared) {
    $defaultCloudflared
  } else {
    (Get-Command cloudflared.exe -ErrorAction Stop).Source
  }
  $tunnelUrl = ''
  $tunnelReady = $false
  $lastTunnelError = ''
  for ($tunnelAttempt = 1; $tunnelAttempt -le 5 -and !$tunnelReady; $tunnelAttempt += 1) {
    Remove-Item $tunnelOut,$tunnelErr -ErrorAction SilentlyContinue
    $tunnel = Start-Process -FilePath $cloudflared `
      -ArgumentList @('tunnel', '--url', 'http://127.0.0.1:8787', '--no-autoupdate') `
      -WindowStyle Hidden `
      -RedirectStandardOutput $tunnelOut `
      -RedirectStandardError $tunnelErr `
      -PassThru

    for ($pollAttempt = 0; $pollAttempt -lt 40 -and !$tunnelReady; $pollAttempt += 1) {
      Start-Sleep -Milliseconds 500
      $output = (Get-Content $tunnelOut -Raw -ErrorAction SilentlyContinue) + "`n" +
        (Get-Content $tunnelErr -Raw -ErrorAction SilentlyContinue)
      $tunnelUrl = [regex]::Match($output, 'https://[a-zA-Z0-9-]+\.trycloudflare\.com').Value
      $tunnelReady = $tunnelUrl -and $output.Contains('Registered tunnel connection')
      if ($tunnel.HasExited) {
        $lastTunnelError = (Get-Content $tunnelErr -Raw -ErrorAction SilentlyContinue).Trim()
        break
      }
    }

    if (!$tunnelReady) {
      if ($tunnel -and !$tunnel.HasExited) { Stop-Process -Id $tunnel.Id -Force }
      if (!$lastTunnelError) { $lastTunnelError = 'Tunnel registration timed out.' }
      if ($tunnelAttempt -lt 5) {
        $delay = [math]::Min(16, [math]::Pow(2, $tunnelAttempt))
        Write-Warning "Tunnel attempt $tunnelAttempt failed. Retrying in $delay seconds."
        Start-Sleep -Seconds $delay
      }
    }
  }
  if (!$tunnelReady) {
    throw "Receipt tunnel failed after 5 attempts: $lastTunnelError"
  }

  & npx.cmd supabase secrets set `
    "RECEIPT_BRIDGE_URL=$tunnelUrl" `
    "RECEIPT_BRIDGE_SECRET=$bridgeSecret" `
    --project-ref $projectRef
  if ($LASTEXITCODE -ne 0) { throw 'Could not update Supabase receipt bridge secrets.' }

  Set-Content -Path $tunnelUrlFile -Value $tunnelUrl -NoNewline

  Write-Host "Encrypted receipt bridge is online: $tunnelUrl" -ForegroundColor Green
  Write-Host 'Keep this window open. Press Ctrl+C to stop the bridge.'
  Wait-Process -Id $tunnel.Id
} finally {
  if ($tunnel -and !$tunnel.HasExited) { Stop-Process -Id $tunnel.Id -Force }
  if ($bridge -and !$bridge.HasExited) { Stop-Process -Id $bridge.Id -Force }
  Remove-Item Env:RECEIPT_BRIDGE_SECRET -ErrorAction SilentlyContinue
}
