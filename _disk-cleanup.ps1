$ErrorActionPreference = 'Continue'
$report = @()

function Add-Line($s) { script:report += $s; Write-Output $s }

$before = (Get-PSDrive C).Free
Add-Line "=== BEFORE ==="
Add-Line ("C: Free GB before: {0:N2}" -f ($before/1GB))

Add-Line ""
Add-Line "=== 1) Clearing LOCALAPPDATA\Temp ==="
$temp = Join-Path $env:LOCALAPPDATA 'Temp'
$deleted = 0
$failed = 0
$freedBytes = 0
Get-ChildItem -LiteralPath $temp -Force -ErrorAction SilentlyContinue | ForEach-Object {
  try {
    $size = (Get-ChildItem $_.FullName -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
    Remove-Item -LiteralPath $_.FullName -Recurse -Force -ErrorAction Stop
    $deleted++
    if ($size) { $freedBytes += $size }
  } catch {
    $failed++
  }
}
Add-Line ("Temp entries removed: $deleted, failed/skipped: $failed, approx freed GB: {0:N2}" -f ($freedBytes/1GB))

Add-Line ""
Add-Line "=== 2) npm cache clean --force ==="
npm cache clean --force 2>&1 | ForEach-Object { Add-Line $_ }

Add-Line ""
Add-Line "=== 3) Delete dfoms-erp-app .next ==="
$next = 'C:\Users\HP\OneDrive\3. Davors Facilities\Davors Web Portal DevOps\DFOMS ERP\08 Source Code\dfoms-erp-app\.next'
if (Test-Path $next) {
  cmd /c "rmdir /s /q `"$next`"" 2>&1 | ForEach-Object { Add-Line $_ }
  Add-Line (".next exists after: $(Test-Path $next)")
} else {
  Add-Line ".next already absent"
}

Add-Line ""
Add-Line "=== AFTER ==="
$after = (Get-PSDrive C).Free
Add-Line ("C: Free GB after: {0:N2}" -f ($after/1GB))
Add-Line ("Freed GB (delta): {0:N2}" -f (($after - $before)/1GB))

$out = Join-Path (Get-Location) 'cleanup-report.txt'
$report | Set-Content -Path $out -Encoding utf8
