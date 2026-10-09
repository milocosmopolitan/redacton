#requires -Version 7.2
# Boot capability only. This does not qualify a Node row or a release.
[CmdletBinding()]
param()
$ErrorActionPreference = 'Stop'
$temporary = Join-Path ([IO.Path]::GetTempPath()) ('redacton-arm-' + [guid]::NewGuid().ToString('N'))
$distro = 'RedactonArmProbe-' + [guid]::NewGuid().ToString('N')
$clock = [Diagnostics.Stopwatch]::StartNew()
$stage = 'NATIVE_IDENTITY'
$status = 'failed'
$code = 'PROBE_FAILED'
$exitCode = 1
$ownedImport = $false
$wsl = $null
$script:lastExit = $null
$script:hresult = $null
$script:knownPrerequisite = $false
$script:wslError = 'NONE'
$report = [ordered]@{ schemaVersion = 1; status = 'failed'; stage = 'NATIVE_IDENTITY'; code = 'PROBE_FAILED'; nativeArm64 = $false; componentsReady = $false; rebootPending = $false; responsePresent = $false; responseValid = $false; wslAvailable = $false; ownershipVerified = $false; rootfsVerified = $false; imported = $false; wsl2Boot = $false; linuxArm64 = $false; cleanupPassed = $false; processExitCode = $null; wslHresult = $null; wslError = 'NONE' }
function Invoke-Bounded([string]$Executable, [string[]]$Arguments, [int]$Seconds, [switch]$Cleanup, [string]$ComponentPath) {
    $script:lastExit = $null
    if (!$Cleanup) {
        $Seconds = [Math]::Min($Seconds, [Math]::Floor(220 - $clock.Elapsed.TotalSeconds))
        if ($Seconds -lt 1) { throw 'DEADLINE' }
    }
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $Executable
    $info.UseShellExecute = $false
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    if ($ComponentPath) { $info.Environment['REDACTON_COMPONENT_RESPONSE'] = $ComponentPath }
    foreach ($argument in $Arguments) { $info.ArgumentList.Add($argument) }
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $info
    try {
        if (!$process.Start()) { throw 'START' }
        $out = [RedactonArmProbe.Native]::ReadBounded($process.StandardOutput)
        $err = [RedactonArmProbe.Native]::ReadBounded($process.StandardError)
        if (!$process.WaitForExit($Seconds * 1000)) { throw 'TIMEOUT' }
        if (![Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]@($out, $err), 2000)) { throw 'READ_TIMEOUT' }
        $output = $out.GetAwaiter().GetResult().Replace([string][char]0, '')
        $errorOutput = $err.GetAwaiter().GetResult().Replace([string][char]0, '')
        $script:lastExit = [int]$process.ExitCode
        if ($process.ExitCode -ne 0) {
            $diagnostic = $output + $errorOutput
            if ($diagnostic -match '(?i)(?<![0-9a-f])0x([0-9a-f]{8})(?![0-9a-f])') {
                $hex = $Matches[1].ToLowerInvariant()
                $script:hresult = [Convert]::ToUInt32($hex, 16)
                $script:knownPrerequisite = $hex -in @('80370102', '80370114', '8007019e')
            }
            foreach ($identifier in @('WSL_E_DEFAULT_DISTRO_NOT_FOUND', 'WSL_E_DISTRO_NOT_FOUND', 'WSL_E_WSL_OPTIONAL_COMPONENT_REQUIRED', 'WSL_E_WSL_NOT_INSTALLED', 'HCS_E_HYPERV_NOT_INSTALLED', 'REGDB_E_CLASSNOTREG')) {
                if ($diagnostic -match ('(?<![A-Z0-9_])' + $identifier + '(?![A-Z0-9_])')) { $script:wslError = $identifier; break }
            }
            throw 'EXIT'
        }
        return $output.Trim()
    } finally {
        try { if (!$process.HasExited) { $process.Kill($true); $null = $process.WaitForExit(2000) } } catch { }
        $process.Dispose()
    }
}
try {
    [IO.Directory]::CreateDirectory($temporary) | Out-Null
    Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
namespace RedactonArmProbe {
  public static class Native {
    [StructLayout(LayoutKind.Sequential)] struct SystemInfo {
      public ushort architecture, reserved; public uint pageSize;
      public IntPtr minimum, maximum; public UIntPtr mask;
      public uint processors, type, granularity; public ushort level, revision;
    }
    [DllImport("kernel32.dll")] static extern void GetNativeSystemInfo(out SystemInfo info);
    public static bool IsArm64() { SystemInfo info; GetNativeSystemInfo(out info); return info.architecture == 12; }
    [DllImport("Api-ms-win-wsl-api-l1-1-0.dll", CharSet = CharSet.Unicode, ExactSpelling = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool WslIsDistributionRegistered(string distributionName);
    public static async Task<string> ReadBounded(StreamReader reader) {
      var result = new StringBuilder(); var buffer = new char[2048]; int count;
      while ((count = await reader.ReadAsync(buffer, 0, buffer.Length)) > 0) {
        if (result.Length + count > 65536) throw new InvalidDataException();
        result.Append(buffer, 0, count);
      }
      return result.ToString();
    }
  }
}
'@
    $report.nativeArm64 = [RedactonArmProbe.Native]::IsArm64()
    if (!$report.nativeArm64) { throw 'IDENTITY' }
    $stage = 'COMPONENT_QUERY'
    $code = 'COMPONENT_QUERY_FAILED'
    # Host rendering is not a data channel. Only this child's owned JSON is read.
    $componentPath = Join-Path $temporary 'components.json'
    $componentCommand = @'
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$WarningPreference='SilentlyContinue'
$InformationPreference='SilentlyContinue'
try {
    $a=Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux
    $b=Get-WindowsOptionalFeature -Online -FeatureName VirtualMachinePlatform
    $allowed=@('Enabled','Disabled','EnablePending','DisablePending','DisabledWithPayloadRemoved')
    if ([string]$a.State -notin $allowed -or [string]$b.State -notin $allowed) { throw 'STATE' }
    $response=[ordered]@{componentsReady=[bool]($a.State -eq 'Enabled' -and $b.State -eq 'Enabled');rebootPending=[bool]($a.State -match 'Pending' -or $b.State -match 'Pending')}
    [IO.File]::WriteAllText($env:REDACTON_COMPONENT_RESPONSE,($response | ConvertTo-Json -Compress),[Text.UTF8Encoding]::new($false))
} catch { [Console]::Error.WriteLine('COMPONENT_QUERY_FAILED'); exit 1 }
'@
    $null = Invoke-Bounded (Join-Path $PSHOME 'pwsh.exe') @('-NoProfile', '-NonInteractive', '-Command', $componentCommand) 15 -ComponentPath $componentPath
    $stage = 'COMPONENT_RESPONSE'
    $code = 'COMPONENT_RESPONSE_INVALID'
    $report.responsePresent = [IO.File]::Exists($componentPath)
    if (!$report.responsePresent) { throw 'COMPONENT_RESPONSE' }
    if (([IO.File]::GetAttributes($componentPath) -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or ([IO.FileInfo]::new($componentPath)).Length -gt 1024) { throw 'COMPONENT_RESPONSE' }
    $components = [IO.File]::ReadAllText($componentPath)
    if ($components -cnotmatch '^\{"componentsReady":(true|false),"rebootPending":(true|false)\}$') { throw 'COMPONENT_RESPONSE' }
    $report.componentsReady = $Matches[1] -ceq 'true'
    $report.rebootPending = $Matches[2] -ceq 'true'
    $report.responseValid = $true
    $code = 'PROBE_FAILED'
    if (!$report.componentsReady -or $report.rebootPending) { $status = 'blocked'; $code = 'IMAGE_COMPONENTS_NOT_READY'; $exitCode = 2; throw 'BLOCKED' }
    $stage = 'WSL_LOOKUP'
    $wsl = Join-Path $env:SystemRoot 'System32/wsl.exe'
    $report.wslAvailable = [IO.File]::Exists($wsl)
    if (!$report.wslAvailable) { $status = 'blocked'; $code = 'IMAGE_WSL_UNAVAILABLE'; $exitCode = 2; throw 'BLOCKED' }
    $stage = 'OWNERSHIP'
    # Native name lookup distinguishes this UUID without requiring a default distro.
    if ([RedactonArmProbe.Native]::WslIsDistributionRegistered($distro)) { $code = 'OWNERSHIP_COLLISION'; throw 'COLLISION' }
    $report.ownershipVerified = $true
    $stage = 'ROOTFS_DOWNLOAD'
    $rootfs = Join-Path $temporary 'rootfs.tar.gz'
    $client = [Net.Http.HttpClient]::new()
    $seconds = [Math]::Min(100, [Math]::Floor(220 - $clock.Elapsed.TotalSeconds))
    if ($seconds -lt 1) { throw 'DEADLINE' }
    $deadline = [Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds($seconds))
    try {
        $response = $client.GetAsync('https://cloud-images.ubuntu.com/wsl/releases/24.04/20240423/ubuntu-noble-wsl-arm64-wsl.rootfs.tar.gz', [Net.Http.HttpCompletionOption]::ResponseHeadersRead, $deadline.Token).GetAwaiter().GetResult()
        try {
            $response.EnsureSuccessStatusCode() | Out-Null
            if ($response.Content.Headers.ContentLength -gt 600MB) { throw 'SIZE' }
            $stream = $response.Content.ReadAsStreamAsync($deadline.Token).GetAwaiter().GetResult()
            $file = [IO.File]::Create($rootfs)
            try {
                $buffer = [byte[]]::new(65536); $total = 0L
                while (($count = $stream.ReadAsync($buffer, 0, $buffer.Length, $deadline.Token).GetAwaiter().GetResult()) -gt 0) {
                    $total += $count
                    if ($total -gt 600MB) { throw 'SIZE' }
                    $file.WriteAsync($buffer, 0, $count, $deadline.Token).GetAwaiter().GetResult()
                }
            } finally { $file.Dispose(); $stream.Dispose() }
        } finally { $response.Dispose() }
    } finally { $deadline.Dispose(); $client.Dispose() }
    $stage = 'ROOTFS_CHECKSUM'
    $stream = [IO.File]::OpenRead($rootfs); $hash = [Security.Cryptography.SHA256]::Create()
    try { $digest = [Convert]::ToHexString($hash.ComputeHash($stream)).ToLowerInvariant() }
    finally { $stream.Dispose(); $hash.Dispose() }
    $report.rootfsVerified = $digest -eq 'fecec1d9b7b750c12c109edb49c13c1006f4a2efabb9b8bf341f11c4c9f2ef11'
    if (!$report.rootfsVerified) { throw 'CHECKSUM' }
    $stage = 'WSL2_IMPORT'
    $ownedImport = $true
    $null = Invoke-Bounded $wsl @('--import', $distro, (Join-Path $temporary 'distro'), $rootfs, '--version', '2') 60
    $report.imported = $true
    $stage = 'WSL2_BOOT'
    $kernel = Invoke-Bounded $wsl @('-d', $distro, '-u', 'root', '--exec', 'uname', '-r') 15
    $report.wsl2Boot = $kernel -match '(?i)microsoft.*wsl2'
    if (!$report.wsl2Boot) { throw 'KERNEL' }
    $stage = 'LINUX_IDENTITY'
    $report.linuxArm64 = (Invoke-Bounded $wsl @('-d', $distro, '-u', 'root', '--exec', 'uname', '-m') 15) -eq 'aarch64'
    if (!$report.linuxArm64) { throw 'ARCHITECTURE' }
    $status = 'passed'; $code = 'OWNED_WSL2_ARM64_BOOTED'; $exitCode = 0
} catch {
    if ($script:knownPrerequisite -and $stage -in @('WSL2_IMPORT', 'WSL2_BOOT', 'LINUX_IDENTITY')) { $status = 'blocked'; $code = 'IMAGE_WSL2_PREREQUISITE_UNAVAILABLE'; $exitCode = 2 }
    $report.processExitCode = $script:lastExit
    $report.wslHresult = $script:hresult
    $report.wslError = $script:wslError
} finally {
    $report.status = $status; $report.stage = $stage; $report.code = $code
    try {
        if ($ownedImport) {
            # An import can fail before registration. Only the exact owned identity is removed.
            if ([RedactonArmProbe.Native]::WslIsDistributionRegistered($distro)) {
                $null = Invoke-Bounded $wsl @('--unregister', $distro) 10 -Cleanup
                if ([RedactonArmProbe.Native]::WslIsDistributionRegistered($distro)) { throw 'CLEANUP' }
            }
        }
        if ([IO.Directory]::Exists($temporary)) { [IO.Directory]::Delete($temporary, $true) }
        $report.cleanupPassed = $true
    } catch { $report.status = 'failed'; $report.code = 'OWNED_CLEANUP_FAILED'; $exitCode = 1 }
    try {
        $output = Join-Path $PSScriptRoot '../qualification/results/wsl-arm-capability.json'
        [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($output)) | Out-Null
        [IO.File]::WriteAllText($output, ($report | ConvertTo-Json -Compress), [Text.UTF8Encoding]::new($false))
        [Console]::WriteLine(($report | ConvertTo-Json -Compress))
    } catch { [Console]::Error.WriteLine('WSL_ARM_REPORT_FAILED'); $exitCode = 1 }
}
exit $exitCode
