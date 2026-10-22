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
if ($element) {
  $rect = $element.Current.BoundingRectangle
  if (-not $rect.IsEmpty) { $bounds = @{ x = [int]$rect.X; y = [int]$rect.Y; width = [int]$rect.Width; height = [int]$rect.Height } }
  $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
  $node = $walker.GetFirstChild($element)
  $count = 0
  while ($node -and $count -lt 40) {
    $name = $node.Current.Name
    $type = $node.Current.ControlType.ProgrammaticName
    if ($node.Current.IsPassword) { $password = $true }
    if ($name) { $tree += ($type + ' ' + $name) }
    $node = $walker.GetNextSibling($node)
    $count++
  }
}
[pscustomobject]@{
  title = $title.ToString()
  processName = $process.ProcessName
  passwordField = $password
  displayAffinity = [int]$affinity
  tree = ($tree -join " | ")
  bounds = $bounds
  selectedText = $element.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::NameProperty)
} | ConvertTo-Json -Compress
`

export function readForeground(run: (command: string, args: string[]) => string = defaultRun): WindowFacts {
  const raw = run(powershell, ['-NoProfile', '-NonInteractive', '-Command', script])
  const parsed = JSON.parse(raw) as Partial<WindowFacts>
  return {
    title: parsed.title ?? '',
    processName: parsed.processName ?? '',
    passwordField: Boolean(parsed.passwordField),
    displayAffinity: Number(parsed.displayAffinity ?? 0),
    tree: parsed.tree ?? '',
    selectedText: parsed.selectedText ?? '',
    bounds: parsed.bounds && Number.isFinite(parsed.bounds.width) ? parsed.bounds : undefined
  }
}

function defaultRun(command: string, args: string[]): string {
  return execFileSync(command, args, { encoding: 'utf8', windowsHide: true, timeout: 8000 })
}
