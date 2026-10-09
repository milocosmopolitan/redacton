#requires -Version 7.2
# Manual installer probe only. This does not produce release-gate host qualification.
[CmdletBinding()]
param([string]$SourceDirectory = (Get-Location).Path)
$ErrorActionPreference = 'Stop'
$source = [IO.Path]::GetFullPath($SourceDirectory)
$temporary = Join-Path ([IO.Path]::GetTempPath()) ('redacton-wsl-' + [guid]::NewGuid().ToString('N'))
$distro = 'RedactonProbe-' + [guid]::NewGuid().ToString('N')
$stage = 'PREREQUISITES'
$registered = $false
$exitCode = 1
$status = 'failed'
$booted = $false
$rows = @()
$script:wslErrorCode = 'none'
$script:rowFailure = 'unknown'
$runtimeVersion = 'unknown'
$wslVersion = 'unknown'
$architecture = 'unknown'
$failureCategory = 'none'
$script:processPhase = 'NONE'
$script:lastExitCode = $null
$failureProcessPhase = 'NONE'
$failureExitCode = $null
$oldLocal = $env:LOCALAPPDATA
$oldUser = $env:USERPROFILE
$oldConfig = $env:CLAUDE_CONFIG_DIR
$oldPath = $env:PATH
function Invoke-ProbeProcess([string]$Executable, [string[]]$Arguments, [int]$Seconds = 120) {
    $script:processPhase = 'NONE'
    $script:lastExitCode = $null
    $info = [Diagnostics.ProcessStartInfo]::new()
    $info.FileName = $Executable
    $info.UseShellExecute = $false
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    foreach ($argument in $Arguments) { $info.ArgumentList.Add($argument) }
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $info
    try {
        $script:processPhase = 'START'
        if (!$process.Start()) { throw 'PROBE_START_FAILED' }
        $script:processPhase = 'READ'
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        $script:processPhase = 'WAIT'
        if (!$process.WaitForExit($Seconds * 1000)) { $process.Kill($true); $process.WaitForExit(); throw 'PROBE_TIMEOUT' }
        $script:processPhase = 'RESULT'
        $output = $stdout.GetAwaiter().GetResult()
        $errorOutput = $stderr.GetAwaiter().GetResult()
        $script:processPhase = 'EXIT'
        $script:lastExitCode = [int]$process.ExitCode
        if ($process.ExitCode -ne 0) {
            $diagnostic = ($output + $errorOutput).Replace([string][char]0, '')
            if ($diagnostic -match '(?i)0x(80370102|80370114|8007019e)') { $script:wslErrorCode = $Matches[0].ToLowerInvariant() }
            if ($errorOutput -match 'WSL_ROW_(FIXTURES|ARTIFACT_INSTALL|DEFAULT_INSTALL|LAUNCH|VALIDATE|MISSING_CLAUDE|MOUNT_REJECTION|SETTINGS_IDENTITY)') { $script:rowFailure = $Matches[1] }
            throw 'PROBE_EXIT_FAILED'
        }
        return $output.Trim()
    } finally { $process.Dispose() }
}
function Get-ProbeDigest([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    $hash = [Security.Cryptography.SHA256]::Create()
    try { return [Convert]::ToHexString($hash.ComputeHash($stream)).ToLowerInvariant() }
    finally { $stream.Dispose(); $hash.Dispose() }
}
try {
    $stage = 'WSL_LOOKUP'
    $wsl = (Get-Command wsl.exe -CommandType Application | Select-Object -First 1).Path
    $stage = 'NODE_LOOKUP'
    $node = (Get-Command node.exe -CommandType Application | Select-Object -First 1).Path
    $stage = 'CLAUDE_LOOKUP'
    if ($env:CLAUDE_BINARY) {
        if (![IO.Path]::IsPathRooted($env:CLAUDE_BINARY) -or ![IO.File]::Exists($env:CLAUDE_BINARY)) { throw 'PINNED_NATIVE_HOST_UNAVAILABLE' }
        $nativeHost = [IO.Path]::GetFullPath($env:CLAUDE_BINARY)
        if ([IO.Path]::GetFileName($nativeHost) -ne 'claude.exe') { throw 'PINNED_NATIVE_HOST_UNAVAILABLE' }
        $env:PATH = [IO.Path]::GetDirectoryName($nativeHost) + ';' + $oldPath
    }
    $null = Get-Command claude
    $stage = 'WSL_VERSION'
    $versionOutput = (Invoke-ProbeProcess $wsl @('--version')).Replace([string][char]0, '')
    if (($versionOutput -split "`r?`n")[0] -match '([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}(\.[0-9]{1,3})?)') { $wslVersion = $Matches[1] }
    $stage = 'TEMP_DIRECTORY'
    [IO.Directory]::CreateDirectory($temporary) | Out-Null
    $stage = 'ROOTFS_DOWNLOAD'
    $rootfs = Join-Path $temporary 'ubuntu-rootfs.tar.gz'
    $client = [Net.Http.HttpClient]::new()
    $client.Timeout = [TimeSpan]::FromMinutes(5)
    $deadline = [Threading.CancellationTokenSource]::new([TimeSpan]::FromMinutes(5))
    try {
        $response = $client.GetAsync('https://cloud-images.ubuntu.com/wsl/releases/24.04/20240423/ubuntu-noble-wsl-amd64-wsl.rootfs.tar.gz', [Net.Http.HttpCompletionOption]::ResponseHeadersRead, $deadline.Token).GetAwaiter().GetResult()
        try {
            $response.EnsureSuccessStatusCode() | Out-Null
            if ($response.Content.Headers.ContentLength -gt 600MB) { throw 'ROOTFS_SIZE_LIMIT' }
            $rootfsStream = $response.Content.ReadAsStreamAsync($deadline.Token).GetAwaiter().GetResult()
            $file = [IO.File]::Create($rootfs)
            try {
                $buffer = [byte[]]::new(65536)
                $total = 0L
                while (($count = $rootfsStream.ReadAsync($buffer, 0, $buffer.Length, $deadline.Token).GetAwaiter().GetResult()) -gt 0) {
                    $total += $count
                    if ($total -gt 600MB) { throw 'ROOTFS_SIZE_LIMIT' }
                    $file.WriteAsync($buffer, 0, $count, $deadline.Token).GetAwaiter().GetResult()
                }
            } finally { $file.Dispose(); $rootfsStream.Dispose() }
        } finally { $response.Dispose() }
    } finally { $deadline.Dispose(); $client.Dispose() }
    $stage = 'ROOTFS_CHECKSUM'
    if ((Get-ProbeDigest $rootfs) -ne '8251e27ffff381a4af5f41dcb94d867de3e0d9774a9241908ab34555d99315ea') { throw 'ROOTFS_CHECKSUM_FAILED' }
    $stage = 'WSL2_IMPORT'
    # Mark ownership before import so partial registration is also cleaned up.
    $registered = $true
    $null = Invoke-ProbeProcess $wsl @('--import', $distro, (Join-Path $temporary 'distro'), $rootfs, '--version', '2') 180
    $stage = 'WSL2_BOOT'
    $kernel = Invoke-ProbeProcess $wsl @('-d', $distro, '-u', 'root', '--exec', 'uname', '-r')
    if ($kernel -notmatch '(?i)microsoft.*wsl2') { throw 'WSL2_KERNEL_UNVERIFIED' }
    if ($kernel -match '^([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}(\.[0-9]{1,3})?)-') { $runtimeVersion = $Matches[1] }
    $nativeArchitecture = Invoke-ProbeProcess $wsl @('-d', $distro, '-u', 'root', '--exec', 'uname', '-m')
    if ($nativeArchitecture -ne 'x86_64') { throw 'WSL_ARCHITECTURE_UNVERIFIED' }
    $architecture = 'x64'
    $booted = $true
    $stage = 'SOURCE_COPY'
    $bundle = Join-Path $temporary 'source.tar'
    $null = Invoke-ProbeProcess 'tar.exe' @('-cf', $bundle, '-C', $source, 'scripts', 'tests/installers', 'package.json', 'artifacts')
    $linuxTemporary = Invoke-ProbeProcess $wsl @('-d', $distro, '-u', 'root', '--exec', 'wslpath', '-a', '-u', $temporary)
    if ($linuxTemporary -notmatch '^/mnt/[a-z]/') { throw 'WSL_TRANSFER_PATH_UNVERIFIED' }
    $setup = @'
set -euo pipefail
for tool in curl tar xz useradd; do command -v "$tool" >/dev/null; done
useradd -m -s /bin/bash redacton
mkdir -p /home/redacton/work
tar -xf "$1/source.tar" -C /home/redacton/work
chown -R redacton:redacton /home/redacton/work
'@
    [IO.File]::WriteAllText((Join-Path $temporary 'setup.sh'), $setup.Replace("`r", ''), [Text.UTF8Encoding]::new($false))
    $null = Invoke-ProbeProcess $wsl @('-d', $distro, '-u', 'root', '--exec', '/bin/bash', "$linuxTemporary/setup.sh", $linuxTemporary)
    $stage = 'NATIVE_IDENTITY'
    $env:LOCALAPPDATA = Join-Path $temporary 'native-local'
    $env:USERPROFILE = Join-Path $temporary 'native-user'
    $env:CLAUDE_CONFIG_DIR = Join-Path $temporary 'native-claude'
    $version = (Get-Content -Raw -LiteralPath (Join-Path $source 'package.json') | ConvertFrom-Json).version
    $nativeArchive = Join-Path $source "artifacts/redacton-$version.zip"
    $null = Invoke-ProbeProcess 'powershell.exe' @('-NoProfile', '-NonInteractive', '-File', (Join-Path $source 'scripts/install.ps1'), '-ReleaseVersion', $version, '-ArchiveSha256', (Get-ProbeDigest $nativeArchive), '-ArchivePath', $nativeArchive)
    $nativeCurrent = Join-Path $env:LOCALAPPDATA 'Redacton/current'
    if (![IO.File]::Exists((Join-Path $nativeCurrent 'package.json'))) { throw 'NATIVE_INSTALL_IDENTITY_FAILED' }
    $nativeSettings = Join-Path $env:USERPROFILE '.config/redacton'
    [IO.Directory]::CreateDirectory($nativeSettings) | Out-Null
    [IO.File]::WriteAllText((Join-Path $nativeSettings 'identity'), 'native-only')
    [IO.File]::WriteAllText((Join-Path $nativeCurrent 'identity'), 'native-only')
    $runner = @'
set -euo pipefail
[ "$(id -u)" -ne 0 ]
cd /home/redacton/work
export CLAUDE_CONFIG_DIR="$HOME/claude-config"
export CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 DISABLE_AUTOUPDATER=1
unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN CLAUDE_CODE_OAUTH_TOKEN
mkdir -p "$HOME/nodes" "$HOME/.config/redacton"
printf '%s' wsl-only > "$HOME/.config/redacton/identity"
for item in '22.16.0:f4cb75bb036f0d0eddf6b79d9596df1aaab9ddccd6a20bf489be5abe9467e84e' '24.21.0:fd8e59d5a511510f6a298afb548f18c7d2b1be404d8b4a27d94fbe49f56cb2d6'; do
 version=${item%%:*}; digest=${item#*:}; archive="node-v$version-linux-x64.tar.xz"
 curl --fail --silent --show-error --proto '=https' --tlsv1.2 --max-time 180 "https://nodejs.org/dist/v$version/$archive" -o "$HOME/nodes/$archive"
 printf '%s  %s\n' "$digest" "$HOME/nodes/$archive" | sha256sum -c - >/dev/null
 tar -xJf "$HOME/nodes/$archive" -C "$HOME/nodes"
 rm "$HOME/nodes/$archive"
done
export PATH="$HOME/nodes/node-v22.16.0-linux-x64/bin:/usr/bin:/bin"
node scripts/install-ci-host.mjs "$HOME/host" >/dev/null
'@
    [IO.File]::WriteAllText((Join-Path $temporary 'prepare.sh'), $runner.Replace("`r", ''), [Text.UTF8Encoding]::new($false))
    $stage = 'LINUX_PREREQUISITES'
    $null = Invoke-ProbeProcess $wsl @('-d', $distro, '-u', 'redacton', '--exec', '/bin/bash', "$linuxTemporary/prepare.sh") 600
    $rowScript = @'
set -euo pipefail
step=FIXTURES
trap 'printf "WSL_ROW_%s\n" "$step" >&2' ERR
[ "$(id -u)" -ne 0 ]
cd /home/redacton/work
export PATH="$HOME/nodes/node-v$1-linux-x64/bin:$HOME/host:/usr/bin:/bin"
node -e 'if(process.platform!=="linux" || process.arch!=="x64" || process.versions.node!==process.argv[1])process.exit(1)' "$1"
export CLAUDE_CONFIG_DIR="$HOME/claude-config" CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 DISABLE_AUTOUPDATER=1
unset ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN CLAUDE_CODE_OAUTH_TOKEN
node --test tests/installers/*.test.mjs >/dev/null
step=ARTIFACT_INSTALL
node scripts/verify-installed-artifact.mjs >/dev/null
release=$(node -p 'JSON.parse(require("fs").readFileSync("package.json")).version')
artifact="$PWD/artifacts/redacton-$release.tar.gz"
digest=$(node -e 'const fs=require("fs"),c=require("crypto");console.log(c.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$artifact")
export REDACTON_RELEASE_VERSION="$release" REDACTON_ARCHIVE_SHA256="$digest" REDACTON_ARCHIVE_PATH="$artifact"
unset REDACTON_INSTALL_DIR XDG_DATA_HOME
step=DEFAULT_INSTALL
output=$(bash scripts/install.sh)
[ -f "$HOME/.local/share/redacton/current/package.json" ]
printf '%s' wsl-only > "$HOME/.local/share/redacton/current/identity"
launch=$(printf '%s\n' "$output" | tail -n 1)
# Execute exactly the emitted quoting, with a non-model CLI operation.
step=LAUNCH
eval "$launch --version" >/dev/null
step=VALIDATE
claude plugin validate --strict "$HOME/.local/share/redacton/current" >/dev/null
step=MISSING_CLAUDE
if PATH="$HOME/nodes/node-v$1-linux-x64/bin:/usr/bin:/bin" bash scripts/install.sh > "$HOME/missing-claude.out" 2>&1; then exit 1; fi
grep -q 'Install Claude Code' "$HOME/missing-claude.out"
[ "$(cat "$HOME/.local/share/redacton/current/identity")" = wsl-only ]
step=MOUNT_REJECTION
if REDACTON_INSTALL_DIR="$2/rejected-install" bash scripts/install.sh > "$HOME/mounted-install.out" 2>&1; then exit 1; fi
grep -q 'WSL installation must use the Linux filesystem' "$HOME/mounted-install.out"
step=SETTINGS_IDENTITY
[ "$(cat "$HOME/.config/redacton/identity")" = wsl-only ]
'@
    [IO.File]::WriteAllText((Join-Path $temporary 'row.sh'), $rowScript.Replace("`r", ''), [Text.UTF8Encoding]::new($false))
    foreach ($nodeVersion in @('22.16.0', '24.21.0')) {
        $stage = if ($nodeVersion -eq '22.16.0') { 'NODE22_INSTALLATION' } else { 'NODE24_INSTALLATION' }
        $script:rowFailure = 'unknown'
        try {
            $null = Invoke-ProbeProcess $wsl @('-d', $distro, '-u', 'redacton', '--exec', '/bin/bash', "$linuxTemporary/row.sh", $nodeVersion, $linuxTemporary) 240
            $rows += @{ node = $nodeVersion; status = 'passed'; stage = 'COMPLETE' }
        } catch {
            $failureProcessPhase = $script:processPhase
            $failureExitCode = $script:lastExitCode
            $rows += @{ node = $nodeVersion; status = 'failed'; stage = $script:rowFailure; processPhase = $script:processPhase; exitCode = $script:lastExitCode }
        }
    }
    $stage = 'IDENTITY_SEPARATION'
    if ([IO.File]::ReadAllText((Join-Path $nativeSettings 'identity')) -ne 'native-only' -or [IO.File]::ReadAllText((Join-Path $nativeCurrent 'identity')) -ne 'native-only') { throw 'NATIVE_IDENTITY_CHANGED' }
    if (($rows | Where-Object status -eq 'failed').Count -gt 0) { $stage = 'INSTALLATION_ROWS'; throw 'INSTALLATION_ROW_FAILED' }
    $status = 'passed'
    $stage = 'COMPLETE'
    $exitCode = 0
} catch {
    if ($stage -ne 'INSTALLATION_ROWS') {
        $failureProcessPhase = $script:processPhase
        $failureExitCode = $script:lastExitCode
    }
    $failureCategory = switch ($_.Exception.GetType().Name) {
        'CommandNotFoundException' { 'COMMAND_NOT_FOUND' }
        'ParameterBindingException' { 'PARAMETER_BINDING' }
        'MethodInvocationException' { 'METHOD_INVOCATION' }
        'RuntimeException' { 'REJECTED' }
        default { 'OTHER' }
    }
    if (($stage -in 'WSL2_IMPORT', 'WSL2_BOOT') -and ($script:wslErrorCode -in '0x80370102', '0x80370114', '0x8007019e')) { $status = 'blocked' }
    [Console]::Error.WriteLine("WSL_PROBE_$stage")
} finally {
    $env:LOCALAPPDATA = $oldLocal
    $env:USERPROFILE = $oldUser
    $env:CLAUDE_CONFIG_DIR = $oldConfig
    $env:PATH = $oldPath
    if ($registered) {
        try {
            $existing = Invoke-ProbeProcess 'wsl.exe' @('--list', '--quiet') 60
            # WSL's list output can contain UTF-16 NULs and a decoded BOM.
            $names = $existing.Replace([string][char]0, '') -split "`r?`n" | ForEach-Object { $_.Trim([char[]]@([char]0xfeff, [char]0xfffd, [char]32, [char]13, [char]10)) }
            if ($names -contains $distro) { $null = Invoke-ProbeProcess 'wsl.exe' @('--unregister', $distro) 60 }
        }
        catch {
            if ($status -eq 'passed') { $failureProcessPhase = $script:processPhase; $failureExitCode = $script:lastExitCode }
            $status = 'failed'; $stage = 'CLEANUP'; $exitCode = 1; [Console]::Error.WriteLine('WSL_PROBE_CLEANUP')
        }
    }
    try { if ([IO.Directory]::Exists($temporary)) { [IO.Directory]::Delete($temporary, $true) } }
    catch { $status = 'failed'; $stage = 'CLEANUP'; $exitCode = 1; [Console]::Error.WriteLine('WSL_PROBE_CLEANUP') }
    $report = @{ schemaVersion = 1; check = 'wsl2-installation-only'; status = $status; stage = $stage; failureCategory = $failureCategory; failureProcessPhase = $failureProcessPhase; failureExitCode = $failureExitCode; actualWsl2Boot = $booted; wslVersion = $wslVersion; linuxKernelVersion = $runtimeVersion; architecture = $architecture; prerequisiteErrorCode = $script:wslErrorCode; rows = @($rows); releaseQualification = 'not-inferred' } | ConvertTo-Json -Depth 4 -Compress
    $results = Join-Path $source 'qualification/results'
    [IO.Directory]::CreateDirectory($results) | Out-Null
    [IO.File]::WriteAllText((Join-Path $results 'wsl-installation.json'), $report)
    Write-Output $report
}
exit $exitCode
