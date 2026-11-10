param(
    [Parameter(Mandatory)] [string] $OutputDirectory,
    [string] $WinSWPath
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$destination = [IO.Path]::GetFullPath($OutputDirectory)
$projectPrefix = $root.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
if ($destination.TrimEnd('\', '/') -ieq $root -or
    $destination.StartsWith($projectPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Choose a staging directory outside the source workspace.'
}
if (Test-Path -LiteralPath $destination) {
    if (-not (Test-Path -LiteralPath $destination -PathType Container) -or
        (Get-ChildItem -LiteralPath $destination -Force | Select-Object -First 1)) {
        throw 'Choose an empty staging directory.'
    }
} else {
    New-Item -ItemType Directory -Path $destination | Out-Null
}

Push-Location -LiteralPath $root
try {
    pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw 'Dependency install failed.' }
    pnpm build
    if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }

    foreach ($entry in @('server', 'shared', 'dist', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml')) {
        Copy-Item -LiteralPath (Join-Path $root $entry) -Destination $destination -Recurse
    }
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'BCSController.xml') -Destination $destination
    if ($WinSWPath) {
        Copy-Item -LiteralPath (Resolve-Path -LiteralPath $WinSWPath).Path -Destination (Join-Path $destination 'BCSController.exe')
    }
} finally {
    Pop-Location
}

Push-Location -LiteralPath $destination
try {
    pnpm install --prod --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw 'Production dependency install failed.' }
} finally {
    Pop-Location
}
Write-Output "Windows service staged at $destination"

