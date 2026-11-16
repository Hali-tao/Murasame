# Windows PowerShell 5.1 compatible. Dot-source exposes the function for isolated tests.
function Get-MurasameFileHash([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    $sha = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '') }
    finally { $sha.Dispose(); $stream.Dispose() }
}

function Remove-MurasameProfile {
    param([Parameter(Mandatory = $true)][string]$ProfilePath)
    $ErrorActionPreference = 'Stop'
    $root = [IO.Path]::GetFullPath($ProfilePath).TrimEnd('\')
    if ([IO.Path]::GetFileName($root) -ne 'murasame-desktop') { throw 'Unexpected profile directory' }
    if (-not [IO.Directory]::Exists($root)) { return }
    $backup = $root + '.uninstall-backup-' + [Guid]::NewGuid().ToString('N')
    $handles = New-Object 'System.Collections.Generic.List[System.IO.FileStream]'
    $files = @()
    try {
        # Reject junctions before descending; never follow links outside the profile.
        $pending = New-Object 'System.Collections.Generic.Queue[string]'
        $pending.Enqueue($root)
        $directories = @()
        while ($pending.Count -gt 0) {
            $directory = $pending.Dequeue()
            $item = Get-Item -LiteralPath $directory -Force
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Profile contains a directory link' }
            $directories += $directory
            foreach ($child in Get-ChildItem -LiteralPath $directory -Force) {
                if ($child.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Profile contains a file link' }
                if ($child.PSIsContainer) { $pending.Enqueue($child.FullName) }
                else { $files += $child.FullName }
            }
        }
        # Acquire every file before writing a backup or deleting anything. A running
        # SQLite connection, including WAL/SHM, makes this fail without changing data.
        foreach ($file in $files) {
            $handles.Add([IO.File]::Open($file, 'Open', 'Read', 'None'))
        }
        foreach ($directory in $directories) {
            [IO.Directory]::CreateDirectory($backup + $directory.Substring($root.Length)) | Out-Null
        }
        for ($i = 0; $i -lt $files.Count; $i++) {
            $destination = $backup + $files[$i].Substring($root.Length)
            $output = [IO.File]::Create($destination)
            try { $handles[$i].CopyTo($output) } finally { $output.Dispose() }
            $handles[$i].Position = 0
            $sha = [Security.Cryptography.SHA256]::Create()
            try { $expected = [BitConverter]::ToString($sha.ComputeHash($handles[$i])).Replace('-', '') }
            finally { $sha.Dispose() }
            if ((Get-MurasameFileHash $destination) -ne $expected) { throw 'Backup verification failed' }
        }
    } catch {
        # Even an incomplete backup is retained; never recursively delete on a failed preflight.
        throw "Profile unchanged. Close Murasame and retry. Backup (if created): $backup. $($_.Exception.Message)"
    } finally {
        foreach ($handle in $handles) { $handle.Dispose() }
    }
    try {
        Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction Stop
        if (Test-Path -LiteralPath $root) { throw 'Profile deletion incomplete' }
    } catch {
        $failure = $_.Exception.Message
        try {
            foreach ($directory in $directories) { [IO.Directory]::CreateDirectory($directory) | Out-Null }
            foreach ($file in $files) {
                $saved = $backup + $file.Substring($root.Length)
                # A locked but unchanged file need not be overwritten.
                if ((Test-Path -LiteralPath $file) -and ((Get-MurasameFileHash $file) -eq (Get-MurasameFileHash $saved))) { continue }
                [IO.File]::Copy($saved, $file, $true)
                if ((Get-MurasameFileHash $file) -ne (Get-MurasameFileHash $saved)) { throw 'Restoration verification failed' }
            }
        } catch {
            throw "Deletion and restoration failed. Complete verified recovery copy: $backup. Do not discard it. $($_.Exception.Message)"
        }
        throw "Deletion failed; profile restored. Complete recovery copy retained: $backup. $failure"
    }
    # Only after all original data was intentionally removed may the backup be removed.
    try { Remove-Item -LiteralPath $backup -Recurse -Force -ErrorAction Stop }
    catch { throw "Profile removed, but backup cleanup failed. Remaining data: $backup. $($_.Exception.Message)" }
}

if ($MyInvocation.InvocationName -ne '.') {
    try {
        Remove-MurasameProfile -ProfilePath (Join-Path ([Environment]::GetFolderPath('ApplicationData')) 'murasame-desktop')
        exit 0
    } catch {
        Write-Output $_.Exception.Message
        exit 1
    }
}
