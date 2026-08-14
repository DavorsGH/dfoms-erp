$envFile = ".env.staging.local"
Get-Content $envFile | ForEach-Object {
  $t = $_.Trim()
  if ($t -and -not $t.StartsWith("#")) {
    $i = $t.IndexOf("=")
    if ($i -gt 0) {
      $k = $t.Substring(0, $i).Trim()
      $v = $t.Substring($i + 1).Trim()
      Set-Item -Path "env:$k" -Value $v
    }
  }
}
npm run start
