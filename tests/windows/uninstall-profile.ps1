$ErrorActionPreference = 'Stop'
. "$PSScriptRoot\..\..\build\remove-profile.ps1"
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('murasame-uninstall-test-' + [Guid]::NewGuid().ToString('N'))
$names = @('murasame.db', 'murasame.db-wal', 'murasame.db-shm', 'murasame-db-key.json', 'Local State', 'nested\memory.txt')
function Assert-Profile([string]$root) {
    foreach ($name in $names) {
        if ([IO.File]::ReadAllText((Join-Path $root $name)) -ne "synthetic $name") { throw "Changed file: $name" }
    }
}
try {
    foreach ($scenario in @('success', 'locked-db', 'locked-key', 'locked-local-state', 'partial-delete', 'backup-verification')) {
        $parent = Join-Path $fixture $scenario
        $root = Join-Path $parent 'murasame-desktop'
        [IO.Directory]::CreateDirectory((Join-Path $root 'nested')) | Out-Null
        foreach ($name in $names) { [IO.File]::WriteAllText((Join-Path $root $name), "synthetic $name") }
        $lock = $null
        $failed = $false
        if ($scenario -eq 'locked-db') { $lock = [IO.File]::Open((Join-Path $root 'murasame.db'), 'Open', 'ReadWrite', 'None') }
        if ($scenario -eq 'locked-key') { $lock = [IO.File]::Open((Join-Path $root 'murasame-db-key.json'), 'Open', 'ReadWrite', 'None') }
        if ($scenario -eq 'locked-local-state') { $lock = [IO.File]::Open((Join-Path $root 'Local State'), 'Open', 'ReadWrite', 'None') }
        if ($scenario -eq 'partial-delete') {
            # Fault at the real destructive boundary after removing a key and database.
            function Remove-Item {
                param($LiteralPath, [switch]$Recurse, [switch]$Force, $ErrorAction)
                [IO.File]::Delete((Join-Path $LiteralPath 'murasame.db'))
                [IO.File]::Delete((Join-Path $LiteralPath 'murasame-db-key.json'))
                throw 'Injected mid-delete IO failure'
            }
        }
        if ($scenario -eq 'backup-verification') {
            function Get-MurasameFileHash { param($Path); return 'incorrect-copy' }
        }
        try { Remove-MurasameProfile $root }
        catch { $failed = $true; Write-Output $_.Exception.Message }
        finally {
            if ($lock) { $lock.Dispose() }
            if ($scenario -eq 'partial-delete') { Microsoft.PowerShell.Management\Remove-Item Function:\Remove-Item }
            if ($scenario -eq 'backup-verification') { . "$PSScriptRoot\..\..\build\remove-profile.ps1" }
        }
        if ($scenario -eq 'success') {
            if ($failed -or (Test-Path $root) -or (Get-ChildItem $parent -Force)) { throw 'Successful deletion left data' }
        } else {
            if (-not $failed) { throw "Expected failure: $scenario" }
            Assert-Profile $root
            if ($scenario -eq 'partial-delete') {
                $backup = @(Get-ChildItem $parent -Directory | Where-Object Name -like '*.uninstall-backup-*')
                if ($backup.Count -ne 1) { throw 'Missing recovery copy' }
                Assert-Profile $backup[0].FullName
            }
        }
        Write-Output "PASS $scenario"
    }
    Remove-MurasameProfile (Join-Path $fixture 'absent\murasame-desktop')
    Write-Output 'PASS absent'
} finally {
    $resolved = [IO.Path]::GetFullPath($fixture)
    if (-not $resolved.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath()), [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($resolved) -notlike 'murasame-uninstall-test-*') { throw 'Unsafe test cleanup path' }
    Microsoft.PowerShell.Management\Remove-Item -LiteralPath $resolved -Recurse -Force -ErrorAction SilentlyContinue
}
