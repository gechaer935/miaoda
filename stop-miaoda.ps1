$ErrorActionPreference = 'SilentlyContinue'

$projectRoot = [System.IO.Path]::GetFullPath($PSScriptRoot)
$desktopElectron = Join-Path $projectRoot 'miaoda-desktop\node_modules\electron\dist\electron.exe'
$backendExe = Join-Path $projectRoot 'miaoda-go-server\bin\miaoda-server.exe'
$ports = @(3001, 5174, 5180)
$stopped = New-Object 'System.Collections.Generic.HashSet[int]'

function Stop-MiaodaProcess([int]$processId) {
    if ($processId -le 0 -or $processId -eq $PID -or $stopped.Contains($processId)) {
        return
    }

    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $processId"
    if (-not $process) {
        return
    }

    $commandLine = [string]$process.CommandLine
    $executable = [string]$process.ExecutablePath
    $isMiaoda = $commandLine.IndexOf($projectRoot, [StringComparison]::OrdinalIgnoreCase) -ge 0 `
        -or $executable.Equals($desktopElectron, [StringComparison]::OrdinalIgnoreCase) `
        -or $executable.Equals($backendExe, [StringComparison]::OrdinalIgnoreCase)

    if ($isMiaoda) {
        taskkill.exe /PID $processId /T /F | Out-Null
        [void]$stopped.Add($processId)
    }
}

# Stop this project's listeners first. The project-path check prevents killing
# unrelated applications that happen to use one of the development ports.
foreach ($port in $ports) {
    Get-NetTCPConnection -State Listen -LocalPort $port | ForEach-Object {
        Stop-MiaodaProcess ([int]$_.OwningProcess)
    }
}

# Electron may remain alive after its Vite process exits, so match its exact
# executable path as a second pass.
Get-CimInstance Win32_Process | Where-Object {
    ([string]$_.ExecutablePath).Equals($desktopElectron, [StringComparison]::OrdinalIgnoreCase) `
        -or ([string]$_.ExecutablePath).Equals($backendExe, [StringComparison]::OrdinalIgnoreCase)
} | ForEach-Object {
    Stop-MiaodaProcess ([int]$_.ProcessId)
}

if ($stopped.Count -gt 0) {
    Write-Host "[Miaoda] Stopped $($stopped.Count) old project process group(s)."
} else {
    Write-Host '[Miaoda] No old project processes were running.'
}

