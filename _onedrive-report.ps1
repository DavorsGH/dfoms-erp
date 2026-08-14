$lines = @('=== OneDrive Files On-Demand investigation ===')

$regPaths = @(
  'HKCU:\Software\Microsoft\OneDrive',
  'HKCU:\Software\Microsoft\OneDrive\Accounts\Business1',
  'HKCU:\Software\Microsoft\OneDrive\Accounts\Personal'
)
foreach ($reg in $regPaths) {
  if (Test-Path $reg) {
    $lines += "--- $reg ---"
    $props = Get-ItemProperty -Path $reg -ErrorAction SilentlyContinue
    if ($props) {
      $props.PSObject.Properties |
        Where-Object { $_.Name -notmatch '^PS' } |
        ForEach-Object { $lines += ("  $($_.Name) = $($_.Value)") }
    }
  }
}

$od = Get-ItemProperty -Path 'HKCU:\Software\Microsoft\OneDrive' -ErrorAction SilentlyContinue
if ($od) {
  $lines += '--- Files On-Demand related keys (filtered) ---'
  $od.PSObject.Properties |
    Where-Object { $_.Name -match 'Demand|Hydration|Placeholder|OD' } |
    ForEach-Object { $lines += ("  $($_.Name) = $($_.Value)") }
}

$sample = 'C:\Users\HP\OneDrive\3. Davors Facilities\Davors Web Portal DevOps\DFOMS ERP\08 Source Code\dfoms-erp-app\package.json'
if (Test-Path $sample) {
  $fi = Get-Item $sample
  $lines += "Sample package.json Attributes: $($fi.Attributes)"
  $rp = cmd /c "fsutil reparsepoint query `"$sample`" 2>&1"
  $lines += "fsutil reparsepoint: $rp"
}

$proc = Get-Process -Name OneDrive -ErrorAction SilentlyContinue | Select-Object -First 1
if ($proc) { $lines += "OneDrive.exe path: $($proc.Path)" } else { $lines += 'OneDrive.exe not running' }

$lines | Set-Content -Path (Join-Path (Get-Location) 'onedrive-report.txt') -Encoding utf8
$lines | Write-Output
