import { runCommandAsync, type DockerRunner } from '../isolation/docker-runtime'
import { execFileSync } from 'node:child_process'
import { join } from 'node:path'
import type { WindowFacts } from './screen-policy'

const powershell = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')

const script = `
Add-Type -AssemblyName UIAutomationClient
Add-Type @"
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class Fg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool GetWindowDisplayAffinity(IntPtr h, out uint affinity);
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO info);
  [DllImport("user32.dll")] public static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
  [DllImport("user32.dll")] public static extern bool GetMonitorInfo(IntPtr h, ref MONITORINFO info);
  public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  public struct RECT { public int left, top, right, bottom; }
  public struct MONITORINFO { public int cbSize; public RECT monitor; public RECT work; public uint flags; }
  public static long IdleMilliseconds() { var info = new LASTINPUTINFO(); info.cbSize = (uint)Marshal.SizeOf(info); if (!GetLastInputInfo(ref info)) return -1; return unchecked((uint)Environment.TickCount - info.dwTime); }
  public static int[] MonitorBounds(IntPtr window) { var info = new MONITORINFO(); info.cbSize = Marshal.SizeOf(info); if (!GetMonitorInfo(MonitorFromWindow(window, 2), ref info)) return null; return new int[] { info.monitor.left, info.monitor.top, info.monitor.right, info.monitor.bottom }; }
}
"@
$handle = [Fg]::GetForegroundWindow()
$title = New-Object System.Text.StringBuilder 512
[void][Fg]::GetWindowText($handle, $title, $title.Capacity)
$pidValue = [uint32]0
[void][Fg]::GetWindowThreadProcessId($handle, [ref]$pidValue)
$affinity = [uint32]0
[void][Fg]::GetWindowDisplayAffinity($handle, [ref]$affinity)
$process = Get-Process -Id $pidValue -ErrorAction SilentlyContinue
$element = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
$tree = @()
$password = $false
$bounds = $null
$incomplete = $true
$selected = ''
$fullscreen = $null
if ($element) {
  $rect = $element.Current.BoundingRectangle
  if (-not $rect.IsEmpty) { $bounds = @{ x = [int]$rect.X; y = [int]$rect.Y; width = [int]$rect.Width; height = [int]$rect.Height } }
  $monitorBounds = [Fg]::MonitorBounds($handle)
  if ($monitorBounds -and $bounds) { $fullscreen = ($bounds.x -le $monitorBounds[0] + 8 -and $bounds.y -le $monitorBounds[1] + 8 -and $bounds.x + $bounds.width -ge $monitorBounds[2] - 8 -and $bounds.y + $bounds.height -ge $monitorBounds[3] - 8) }
  $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
  $queue = New-Object System.Collections.Queue
  $queue.Enqueue(@{ node = $element; depth = 0 })
  $count = 0
  $incomplete = $false
  while ($queue.Count -gt 0 -and $count -lt 600) {
    $entry = $queue.Dequeue()
    $node = $entry.node
    try {
      if ($node.Current.IsPassword -and -not $node.Current.IsOffscreen) { $password = $true }
      $name = $node.Current.Name
      if ($name -and -not $node.Current.IsPassword) { $tree += ($node.Current.ControlType.ProgrammaticName + ' ' + $name) }
      $child = $walker.GetFirstChild($node)
      if ($entry.depth -ge 30 -and $child) { $incomplete = $true }
      while ($child -and $entry.depth -lt 30) {
        if ($queue.Count -ge 600) { $incomplete = $true; break }
        $queue.Enqueue(@{ node = $child; depth = $entry.depth + 1 })
        $child = $walker.GetNextSibling($child)
      }
    } catch { $incomplete = $true }
    $count++
  }
  if ($queue.Count -gt 0) { $incomplete = $true }
  $selected = ''
  try {
    $pattern = $null
    if ($element.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern, [ref]$pattern)) {
      $selected = (($pattern.GetSelection() | ForEach-Object { $_.GetText(4000) }) -join ' ')
    }
  } catch { }

}
[pscustomobject]@{
  windowId = $handle.ToInt64().ToString()
  processId = [int]$pidValue
  title = $title.ToString()
  idleMs = [Fg]::IdleMilliseconds()
  fullscreen = $fullscreen
  processName = $process.ProcessName
  passwordField = $password
  displayAffinity = [int]$affinity
  tree = ($tree -join " | ")
  bounds = $bounds
  selectedText = $selected
  sensitiveScanComplete = (-not $incomplete)
} | ConvertTo-Json -Compress
`

export function readForeground(run: (command: string, args: string[]) => string = defaultRun): WindowFacts {
  const raw = run(powershell, ['-NoProfile', '-NonInteractive', '-Command', script])
  const parsed = JSON.parse(raw) as Partial<WindowFacts>
  return {
    windowId: typeof parsed.windowId === 'string' ? parsed.windowId : undefined,
    processId: typeof parsed.processId === 'number' ? parsed.processId : undefined,
    title: parsed.title ?? '',
    idleMs: typeof parsed.idleMs === 'number' && parsed.idleMs >= 0 ? parsed.idleMs : undefined,
    fullscreen: typeof parsed.fullscreen === 'boolean' ? parsed.fullscreen : undefined,
    processName: parsed.processName ?? '',
    passwordField: Boolean(parsed.passwordField),
    displayAffinity: Number(parsed.displayAffinity ?? 0),
    tree: parsed.tree ?? '',
    selectedText: parsed.selectedText ?? '',
    sensitiveScanComplete: parsed.sensitiveScanComplete === true,
    bounds: parsed.bounds && Number.isFinite(parsed.bounds.width) ? parsed.bounds : undefined
  }
}

function defaultRun(command: string, args: string[]): string {
  return execFileSync(command, args, { encoding: 'utf8', windowsHide: true, timeout: 8000 })
}

export async function readForegroundAsync(run: DockerRunner = runCommandAsync, signal?: AbortSignal): Promise<WindowFacts> {
  const raw = await run(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], { timeoutMs: 8000, signal })
  return readForeground(() => raw)
}
