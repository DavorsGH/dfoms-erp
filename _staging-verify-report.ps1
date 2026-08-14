$path = 'C:\Users\HP\OneDrive\3. Davors Facilities\Davors Web Portal DevOps\DFOMS ERP\08 Source Code\dfoms-staging-verify-20260809211130'
$lines = @()
if (-not (Test-Path $path)) {
  $lines += 'FOLDER_MISSING'
} else {
  $item = Get-Item -LiteralPath $path
  $size = (Get-ChildItem -LiteralPath $path -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
  $lines += "Name: $($item.Name)"
  $lines += "Created: $($item.CreationTime)"
  $lines += "LastWrite: $($item.LastWriteTime)"
  $lines += "LastAccess: $($item.LastAccessTime)"
  $lines += ("SizeGB: {0:N2}" -f ($size/1GB))
  $lines += 'Top-level entries:'
  Get-ChildItem -LiteralPath $path -Force | ForEach-Object {
    if ($_.PSIsContainer) {
      $s = (Get-ChildItem $_.FullName -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object Length -Sum).Sum
      $lines += ("  {0}  dir  {1:N1} MB  LastWrite={2}" -f $_.Name, ($s/1MB), $_.LastWriteTime)
    } else {
      $lines += ("  {0}  file {1:N1} MB  LastWrite={2}" -f $_.Name, ($_.Length/1MB), $_.LastWriteTime)
    }
  }
  if (Test-Path (Join-Path $path 'package.json')) {
    $lines += 'HAS package.json'
    $lines += (Get-Content (Join-Path $path 'package.json') -TotalCount 8)
  }
  if (Test-Path (Join-Path $path '.git')) { $lines += 'HAS .git directory' }
  if (Test-Path (Join-Path $path 'README.md')) {
    $lines += 'README excerpt:'
    $lines += (Get-Content (Join-Path $path 'README.md') -TotalCount 5 -ErrorAction SilentlyContinue)
  }
}
$lines | Set-Content -Path (Join-Path (Get-Location) 'staging-verify-report.txt') -Encoding utf8
$lines | Write-Output
