$ErrorActionPreference = 'Stop'

$ip = Get-NetIPConfiguration |
    Where-Object {
        $_.NetAdapter.Status -eq 'Up' -and
        $_.IPv4DefaultGateway -ne $null -and
        $_.InterfaceAlias -notmatch 'Meta|VPN|Loopback'
    } |
    ForEach-Object { $_.IPv4Address.IPAddress } |
    Where-Object { $_ -match '^\d{1,3}(\.\d{1,3}){3}$' } |
    Select-Object -First 1

if (-not $ip) {
    exit 1
}

[Console]::Out.Write($ip.Trim())

