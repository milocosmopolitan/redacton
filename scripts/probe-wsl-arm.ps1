#requires -Version 7.2
# Disposable ARM runner runtime/boot probe, optionally exporting exact-source host rows.
# Boot observations alone never qualify a Node row or a release.
[CmdletBinding()]
param([switch]$HostQualification)
$ErrorActionPreference = 'Stop'
$temporary = Join-Path ([IO.Path]::GetTempPath()) ('redacton-arm-' + [guid]::NewGuid().ToString('N'))
$distro = 'RedactonArmProbe-' + [guid]::NewGuid().ToString('N')
$clock = [Diagnostics.Stopwatch]::StartNew()
$operationBudget = if ($HostQualification) { 3300 } else { 220 }
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
$script:wslDiagnostic = 'UNKNOWN'
$script:stdoutCharacters = 0
$script:stderrCharacters = 0
$report = [ordered]@{ schemaVersion = 1; status = 'failed'; stage = 'NATIVE_IDENTITY'; code = 'PROBE_FAILED'; nativeArm64 = $false; componentsReady = $false; rebootPending = $false; responsePresent = $false; responseValid = $false; wslAvailable = $false; ownershipVerified = $false; rootfsVerified = $false; imported = $false; wsl2Boot = $false; linuxArm64 = $false; cleanupPassed = $false; processExitCode = $null; wslHresult = $null; wslError = 'NONE' }
$report.priorRuntimeExitCode = $null; $report.priorRuntimeDiagnostic = 'UNKNOWN'; $report.priorRuntimeVersion = $null
$report.runtimeInstallExitCode = $null; $report.runtimePinned = $false
$report.componentsUnchanged = $false
$report.hostQualification = [bool]$HostQualification
$report.hostRows = @()
$report.wslDiagnostic = 'UNKNOWN'; $report.stdoutCharacters = 0; $report.stderrCharacters = 0
$sourceSha = $env:PRODUCT_SOURCE
$lockSha256 = $null
$artifactSha256 = $null
function Invoke-Bounded([string]$Executable, [string[]]$Arguments, [int]$Seconds, [switch]$Cleanup, [string]$ComponentPath, [switch]$AllowFailure) {
    $script:lastExit = $null
    $script:hresult = $null; $script:knownPrerequisite = $false; $script:wslError = 'NONE'
    $script:wslDiagnostic = 'UNKNOWN'; $script:stdoutCharacters = 0; $script:stderrCharacters = 0
    if (!$Cleanup) {
        $Seconds = [Math]::Min($Seconds, [Math]::Floor($operationBudget - $clock.Elapsed.TotalSeconds))
        if ($Seconds -lt 1) { throw 'DEADLINE' }
    }
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $Executable
    $info.UseShellExecute = $false
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    if ($ComponentPath) { $info.Environment['REDACTON_COMPONENT_RESPONSE'] = $ComponentPath }
    $info.Environment['WSL_UTF8'] = '1'
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
        $script:stdoutCharacters = $output.Length
        $script:stderrCharacters = $errorOutput.Length
        $diagnostic = $output + $errorOutput
        $script:wslDiagnostic = if ($diagnostic -match '(?i)Windows Subsystem for Linux must be updated to the latest version to proceed') { 'UPDATE_REQUIRED' } elseif ($diagnostic -match '(?i)Press any key to install Windows Subsystem for Linux') { 'INSTALL_PROMPT' } elseif ($diagnostic -match '(?i)Invalid command line argument|Invalid usage') { 'INVALID_USAGE' } elseif ($diagnostic -match '(?i)Usage:\s*wsl(?:\.exe)?') { 'USAGE_HELP' } else { 'UNKNOWN' }
        if ($process.ExitCode -ne 0) {
            if ($diagnostic -match '(?i)(?<![0-9a-f])0x([0-9a-f]{8})(?![0-9a-f])') {
                $hex = $Matches[1].ToLowerInvariant()
                $script:hresult = [Convert]::ToUInt32($hex, 16)
                $script:knownPrerequisite = $hex -in @('80370102', '80370114', '8007019e')
            }
            foreach ($identifier in @('WSL_E_DEFAULT_DISTRO_NOT_FOUND', 'WSL_E_DISTRO_NOT_FOUND', 'WSL_E_WSL_OPTIONAL_COMPONENT_REQUIRED', 'WSL_E_WSL_NOT_INSTALLED', 'HCS_E_HYPERV_NOT_INSTALLED', 'REGDB_E_CLASSNOTREG')) {
                if ($diagnostic -match ('(?<![A-Z0-9_])' + $identifier + '(?![A-Z0-9_])')) { $script:wslError = $identifier; break }
            }
            if (!$AllowFailure) { throw 'EXIT' }
        }
        return $output.Trim()
    } finally {
        try { if (!$process.HasExited) { $process.Kill($true); $null = $process.WaitForExit(2000) } } catch { }
        $process.Dispose()
    }
}
function Get-BoundedDigest([string]$Path) {
    $stream = [IO.File]::OpenRead($Path); $hash = [Security.Cryptography.SHA256]::Create()
    try { return [Convert]::ToHexString($hash.ComputeHash($stream)).ToLowerInvariant() }
    finally { $stream.Dispose(); $hash.Dispose() }
}
function Get-BoundedDownload([string]$Url, [string]$Path, [long]$Limit, [int]$Seconds) {
    $seconds = [Math]::Min($Seconds, [Math]::Floor($operationBudget - $clock.Elapsed.TotalSeconds))
    if ($seconds -lt 1) { throw 'DEADLINE' }
    $client = [Net.Http.HttpClient]::new()
    $deadline = [Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds($seconds))
    try {
        $response = $client.GetAsync($Url, [Net.Http.HttpCompletionOption]::ResponseHeadersRead, $deadline.Token).GetAwaiter().GetResult()
        try {
            $response.EnsureSuccessStatusCode() | Out-Null
            if ($response.Content.Headers.ContentLength -gt $Limit) { throw 'SIZE' }
            $stream = $response.Content.ReadAsStreamAsync($deadline.Token).GetAwaiter().GetResult()
            $file = [IO.File]::Create($Path)
            try {
                $buffer = [byte[]]::new(65536); $total = 0L
                while (($count = $stream.ReadAsync($buffer, 0, $buffer.Length, $deadline.Token).GetAwaiter().GetResult()) -gt 0) {
                    $total += $count
                    if ($total -gt $Limit) { throw 'SIZE' }
                    $null = $file.WriteAsync($buffer, 0, $count, $deadline.Token).GetAwaiter().GetResult()
                }
            } finally { $file.Dispose(); $stream.Dispose() }
        } finally { $response.Dispose() }
    } finally { $deadline.Dispose(); $client.Dispose() }
}
function Invoke-ArmHostQualification {
    $script:stage = 'HOST_CANONICAL_ARTIFACT'
    $sourceDirectory = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
    $artifactDirectory = Join-Path $sourceDirectory 'artifacts'
    if ($sourceSha -cnotmatch '^[a-f0-9]{40}$') { throw 'SOURCE_IDENTITY' }
    $node = (Get-Command node.exe -CommandType Application | Select-Object -First 1).Path
    $identity = (Invoke-Bounded $node @((Join-Path $PSScriptRoot 'qualify-wsl-host.mjs'), '--canonical-identity', $artifactDirectory, $sourceSha) 20) | ConvertFrom-Json
    $script:lockSha256 = $identity.lockSha256
    $script:artifactSha256 = $identity.artifactSha256
    $report.productSource = $sourceSha
    $report.artifactSha256 = $identity.artifactSha256
    $script:stage = 'HOST_DRIVER_TRANSFER'
    $bundle = Join-Path $temporary 'driver.tar'
    $null = Invoke-Bounded (Join-Path $env:SystemRoot 'System32/tar.exe') @('-cf', $bundle, '-C', $sourceDirectory, 'scripts', 'artifacts') 20
    $linuxTemporary = Invoke-Bounded $wsl @('-d', $distro, '-u', 'root', '--exec', 'wslpath', '-a', '-u', $temporary) 10
    if ($linuxTemporary -notmatch '^/mnt/[a-z]/') { throw 'TRANSFER_PATH' }
    $prepare = @'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
timeout 180 apt-get -qq -o Acquire::Retries=1 -o Acquire::http::Timeout=30 update >/dev/null
timeout 180 apt-get -qq -y --no-install-recommends -o Acquire::Retries=1 -o Acquire::http::Timeout=30 install python3-pip git curl xz-utils ca-certificates >/dev/null
useradd -m -s /bin/bash redacton
mkdir -p /home/redacton/driver
tar -xf "$1/driver.tar" -C /home/redacton/driver
chown -R redacton:redacton /home/redacton/driver
'@
    [IO.File]::WriteAllText((Join-Path $temporary 'prepare.sh'), $prepare.Replace("`r", ''), [Text.UTF8Encoding]::new($false))
    $script:stage = 'HOST_LINUX_PREREQUISITES'
    $null = Invoke-Bounded $wsl @('-d', $distro, '-u', 'root', '--exec', '/bin/bash', "$linuxTemporary/prepare.sh", $linuxTemporary) 400
    $bootstrap = @'
set -euo pipefail
[ "$(id -u)" -ne 0 ]
[ "$(uname -m)" = aarch64 ]
[ "$(findmnt -n -o FSTYPE -T "$HOME")" = ext4 ]
unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN CLAUDE_CODE_OAUTH_TOKEN GIT_ASKPASS SSH_ASKPASS
export GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_TERMINAL_PROMPT=0
export CLAUDE_CONFIG_DIR="$HOME/host-config" CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 DISABLE_AUTOUPDATER=1
mkdir -p "$HOME/nodes"
for item in '22.16.0:eab80cb88f8fda1e65f5e8d0420c9809bdb320b03fd34976ab7161b6e703b910' '24.21.0:6ad1325edbdb5649c379b75a237147a666c95d4f9ae8d340fef2d1575d289ad2'; do
 version=${item%%:*}; digest=${item#*:}; archive="node-v$version-linux-arm64.tar.xz"
 curl --fail --silent --show-error --proto '=https' --tlsv1.2 --max-time 120 --max-filesize 100000000 "https://nodejs.org/dist/v$version/$archive" -o "$HOME/nodes/$archive"
 printf '%s  %s\n' "$digest" "$HOME/nodes/$archive" | sha256sum -c - >/dev/null
 tar -xJf "$HOME/nodes/$archive" -C "$HOME/nodes"
 rm "$HOME/nodes/$archive"
done
export PATH="$HOME/nodes/node-v22.16.0-linux-arm64/bin:/usr/bin:/bin"
node -e 'if(process.platform!=="linux" || process.arch!=="arm64" || process.versions.node!=="22.16.0")process.exit(1)'
node "$HOME/driver/scripts/install-ci-host.mjs" "$HOME/host" >/dev/null
'@
    [IO.File]::WriteAllText((Join-Path $temporary 'bootstrap.sh'), $bootstrap.Replace("`r", ''), [Text.UTF8Encoding]::new($false))
    $script:stage = 'HOST_PINNED_RUNTIMES'
    $null = Invoke-Bounded $wsl @('-d', $distro, '-u', 'redacton', '--exec', '/bin/bash', "$linuxTemporary/bootstrap.sh") 450
    $script:stage = 'HOST_ALL_GATES'
    $hostOutput = Invoke-Bounded $wsl @('-d', $distro, '-u', 'redacton', '--exec', '/home/redacton/nodes/node-v22.16.0-linux-arm64/bin/node', '/home/redacton/driver/scripts/qualify-wsl-host.mjs', $sourceSha, $lockSha256, $artifactSha256, '/home/redacton/driver/artifacts', 'arm64') 2200 -AllowFailure
    $hostBundle = Join-Path $temporary 'host-export.json'
    [IO.File]::WriteAllText($hostBundle, $hostOutput, [Text.UTF8Encoding]::new($false))
    $validated = Invoke-Bounded $node @((Join-Path $PSScriptRoot 'qualify-wsl-host.mjs'), '--validate-export', $hostBundle, $sourceSha, $artifactSha256, 'arm64') 10
    $hostValue = $validated | ConvertFrom-Json
    $destination = Join-Path $sourceDirectory 'qualification/results/wsl-arm-host'
    [IO.Directory]::CreateDirectory($destination) | Out-Null
    [IO.File]::WriteAllText((Join-Path $destination 'wsl-host-summary.json'), $validated, [Text.UTF8Encoding]::new($false))
    foreach ($row in $hostValue.rows) {
        $report.hostRows += @{ node = $row.node; status = $row.status; phase = $row.phase }
        if ($row.record) { [IO.File]::WriteAllText((Join-Path $destination ('wsl-arm64-' + $row.node.Split('.')[0] + '.json')), ($row.record | ConvertTo-Json -Depth 8 -Compress), [Text.UTF8Encoding]::new($false)) }
    }
    if (@($hostValue.rows | Where-Object status -ne 'passed').Count -gt 0) { throw 'HOST_ROWS_INCOMPLETE' }
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
        if (result.Length + count > 524288) throw new InvalidDataException();
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
    $stage = 'PRIOR_RUNTIME'
    $prior = Invoke-Bounded $wsl @('--version') 10 -AllowFailure
    $report.priorRuntimeExitCode = $script:lastExit
    $report.priorRuntimeDiagnostic = $script:wslDiagnostic
    $report.priorRuntimeVersion = $null
    if (($prior -split '\r?\n')[0] -match '(?<![0-9])([0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}(?:\.[0-9]{1,4})?)(?![0-9])') { $report.priorRuntimeVersion = $Matches[1]; $report.priorRuntimeDiagnostic = 'VERSION_PRESENT' }
    $stage = 'RUNTIME_DOWNLOAD'
    $msi = Join-Path $temporary 'wsl-arm64.msi'
    Get-BoundedDownload 'https://github.com/microsoft/WSL/releases/download/3.0.1/wsl.3.0.1.0.arm64.msi' $msi 350MB 100
    $stage = 'RUNTIME_CHECKSUM'
    if ((Get-BoundedDigest $msi) -ne '857ddbb335ec7d05ffa71d0fd2203750c0e8fc29bb164f8a95db92bd7bba4263') { throw 'RUNTIME_CHECKSUM' }
    $stage = 'RUNTIME_INSTALL'
    $null = Invoke-Bounded (Join-Path $env:SystemRoot 'System32/msiexec.exe') @('/i', $msi, '/qn', '/norestart', 'REBOOT=ReallySuppress') 120 -AllowFailure
    $report.runtimeInstallExitCode = $script:lastExit
    if ($script:lastExit -eq 3010) { $status = 'blocked'; $code = 'RUNTIME_REBOOT_REQUIRED'; $exitCode = 2; throw 'BLOCKED' }
    if ($script:lastExit -ne 0) { throw 'RUNTIME_INSTALL' }
    $stage = 'RUNTIME_VERSION'
    $installed = Invoke-Bounded $wsl @('--version') 10
    if (($installed -split '\r?\n')[0] -notmatch '(?<![0-9])3\.0\.1(?:\.0)?(?![0-9])') { throw 'RUNTIME_VERSION' }
    $report.runtimePinned = $true
    $stage = 'RUNTIME_COMPONENTS'
    [IO.File]::Delete($componentPath)
    $null = Invoke-Bounded (Join-Path $PSHOME 'pwsh.exe') @('-NoProfile', '-NonInteractive', '-Command', $componentCommand) 15 -ComponentPath $componentPath
    if (![IO.File]::Exists($componentPath) -or ([IO.File]::GetAttributes($componentPath) -band [IO.FileAttributes]::ReparsePoint) -ne 0 -or ([IO.FileInfo]::new($componentPath)).Length -gt 1024) { throw 'RUNTIME_COMPONENTS' }
    $report.componentsUnchanged = [IO.File]::ReadAllText($componentPath) -ceq '{"componentsReady":true,"rebootPending":false}'
    if (!$report.componentsUnchanged) { throw 'RUNTIME_COMPONENTS' }
    $script:hresult = $null; $script:knownPrerequisite = $false; $script:wslError = 'NONE'
    $stage = 'ROOTFS_DOWNLOAD'
    $rootfs = Join-Path $temporary 'rootfs.tar.gz'
    Get-BoundedDownload 'https://cloud-images.ubuntu.com/wsl/releases/24.04/20240423/ubuntu-noble-wsl-arm64-wsl.rootfs.tar.gz' $rootfs 600MB 100
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
    if ($HostQualification) { Invoke-ArmHostQualification }
    $status = 'passed'; $code = if ($HostQualification) { 'ALL_ARM_HOST_ROWS_PASSED' } else { 'OWNED_WSL2_ARM64_BOOTED' }; $exitCode = 0
} catch {
    if ($script:knownPrerequisite -and $stage -in @('WSL2_IMPORT', 'WSL2_BOOT', 'LINUX_IDENTITY')) { $status = 'blocked'; $code = 'IMAGE_WSL2_PREREQUISITE_UNAVAILABLE'; $exitCode = 2 }
    $report.processExitCode = $script:lastExit
    $report.wslHresult = $script:hresult
    $report.wslError = $script:wslError
    $report.wslDiagnostic = $script:wslDiagnostic
    $report.stdoutCharacters = $script:stdoutCharacters
    $report.stderrCharacters = $script:stderrCharacters
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
