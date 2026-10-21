$ErrorActionPreference = 'Stop'

function Resolve-CodePath {
    $candidates = @(
        "$env:LOCALAPPDATA\Programs\Microsoft VS Code\bin\code.cmd",
        "$env:ProgramFiles\Microsoft VS Code\bin\code.cmd",
        "${env:ProgramFiles(x86)}\Microsoft VS Code\bin\code.cmd"
    )
    foreach ($c in $candidates) {
        if ($c -and (Test-Path $c)) {
            return $c
        }
    }
    $cmd = Get-Command code -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source) {
        return $cmd.Source
    }
}

$installedCode = Resolve-CodePath
if ($installedCode) {
    Write-Host "VS Code is already installed: $installedCode"
    exit 0
}

Write-Host "Installing VS Code..."
if (Get-Command winget -ErrorAction SilentlyContinue) {
    winget install --id Microsoft.VisualStudioCode -e --accept-package-agreements --accept-source-agreements
    $installedCode = Resolve-CodePath
    if ($installedCode) {
        Write-Host "VS Code installed: $installedCode"
    }
    exit 0
}

Write-Error "winget is not available. Please install VS Code from https://code.visualstudio.com/Download"
exit 1
