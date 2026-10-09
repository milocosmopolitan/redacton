# Candidate installer. Native Windows host qualification is a separate gate.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][ValidatePattern('^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$')][string]$ReleaseVersion,
    [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{64}$')][string]$ArchiveSha256,
    [string]$ArchivePath,
    [string]$InstallDirectory = (Join-Path $env:LOCALAPPDATA 'Redacton')
)
$ErrorActionPreference = 'Stop'
$staging = $null
$previous = $null
$current = $null
$stage = 'PLATFORM'
$exitCode = 0
$safeNodePlatform = 'unknown'
$safeNodeArchitecture = 'unknown'
$safeNodeVersion = 'unknown'
function Get-RedactonFileDigest([string]$FilePath) {
    # Stream through Framework cryptography, without optional module autoloading.
    $stream = [IO.File]::OpenRead($FilePath)
    $algorithm = $null
    try {
        $algorithm = [Security.Cryptography.SHA256]::Create()
        return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '').ToLowerInvariant()
    } finally {
        $stream.Dispose()
        if ($algorithm) { $algorithm.Dispose() }
    }
}
try {
    # Windows PowerShell 5.1 may not load the RuntimeInformation facade. Native OS
    # architecture remains visible even when PowerShell runs under WOW64.
    $osArchitecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
    if ($env:OS -ne 'Windows_NT' -or $osArchitecture -ne 'AMD64') { throw 'Use native Windows x64 PowerShell. WSL uses install.sh in its Linux filesystem.' }
    if ($ReleaseVersion -eq '0.1.0') { throw 'Historical release is not a Windows artifact. Supply a new reviewed candidate release.' }
    $stage = 'NODE_LOOKUP'
    $node = (Get-Command node.exe -CommandType Application | Select-Object -First 1).Path
    if (!$node) { throw 'Native Node executable is unavailable.' }
    $stage = 'CLAUDE_LOOKUP'
    $null = Get-Command claude
    $stage = 'NODE_PLATFORM_INVOKE'
    $nodePlatform = & $node -p 'process.platform' 2>$null
    $stage = 'NODE_PLATFORM_VALIDATE'
    if ($nodePlatform -in 'win32', 'linux', 'darwin') { $safeNodePlatform = $nodePlatform }
    if ($LASTEXITCODE -ne 0 -or $nodePlatform -ne 'win32') { throw 'Use native Windows Node.js.' }
    $stage = 'NODE_ARCHITECTURE_INVOKE'
    $nodeArchitecture = & $node -p 'process.arch' 2>$null
    $stage = 'NODE_ARCHITECTURE_VALIDATE'
    if ($nodeArchitecture -in 'x64', 'arm64') { $safeNodeArchitecture = $nodeArchitecture }
    if ($LASTEXITCODE -ne 0 -or $nodeArchitecture -ne 'x64') { throw 'Use native x64 Node.js.' }
    $stage = 'NODE_VERSION_INVOKE'
    $nodeVersion = & $node -p 'process.versions.node' 2>$null
    $stage = 'NODE_VERSION_VALIDATE'
    if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^\d{1,3}\.\d{1,3}\.\d{1,3}$') { throw 'Invalid Node version.' }
    $safeNodeVersion = $nodeVersion
    $versionParts = $nodeVersion.Split('.')
    $nodeMajor = [int]$versionParts[0]
    $nodeMinor = [int]$versionParts[1]
    if (!(($nodeMajor -eq 22 -and $nodeMinor -ge 16) -or ($nodeMajor -eq 24 -and $nodeMinor -ge 21))) { throw 'Use Node 22.16.0+ (22.x) or 24.21.0+ (24.x).' }
    $stage = 'INSTALL_DIRECTORY'
    if (![IO.Path]::IsPathRooted($InstallDirectory)) { throw 'Use an absolute dedicated directory.' }
    $InstallDirectory = [IO.Path]::GetFullPath($InstallDirectory).TrimEnd('\')
    if ($InstallDirectory -eq [IO.Path]::GetPathRoot($InstallDirectory).TrimEnd('\') -or $InstallDirectory -eq $env:USERPROFILE) { throw 'Use a dedicated directory.' }
    New-Item -ItemType Directory -Path $InstallDirectory -Force | Out-Null
    if ((Get-Item -LiteralPath $InstallDirectory).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Install directory must not be a link.' }
    $staging = Join-Path $InstallDirectory ('.install-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $staging | Out-Null
    $archive = Join-Path $staging 'plugin.zip'
    $stage = 'DOWNLOAD'
    if ($ArchivePath) { Copy-Item -LiteralPath $ArchivePath -Destination $archive }
    else {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri "https://github.com/milocosmopolitan/redacton/releases/download/v$ReleaseVersion/redacton-$ReleaseVersion.zip" -OutFile $archive -UseBasicParsing -TimeoutSec 90
    }
    $stage = 'ARCHIVE_CHECKSUM_READ'
    $archiveDigest = Get-RedactonFileDigest $archive
    $stage = 'ARCHIVE_CHECKSUM_MATCH'
    if ($archiveDigest -ne $ArchiveSha256) { throw 'Archive checksum mismatch.' }
    $stage = 'ARCHIVE_INSPECTION'
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($archive)
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    try {
        foreach ($entry in $zip.Entries) {
            $name = $entry.FullName
            if (!$name.StartsWith("redacton-$ReleaseVersion/", [StringComparison]::Ordinal) -or $name.Contains('\') -or $name.Contains(':') -or !$seen.Add($name)) { throw 'Unsafe or duplicate archive path.' }
            foreach ($part in $name.TrimEnd('/').Split('/')) {
                if (!$part -or $part -in '.', '..' -or $part.EndsWith('.') -or $part.EndsWith(' ') -or $part -match '[<>"|?*\x00-\x1f]' -or $part -match '^(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)') { throw 'Unsafe Windows archive path.' }
            }
            $kind = ($entry.ExternalAttributes -shr 16) -band 61440
            if ($kind -ne 0 -and $kind -ne 32768 -and $kind -ne 16384) { throw 'Archive link or special file.' }
            if ([IO.Path]::GetFullPath((Join-Path $staging $name)).Length -gt 240) { throw 'Choose a shorter install directory.' }
        }
        $stage = 'EXTRACTION'
        foreach ($entry in $zip.Entries) {
            $destination = Join-Path $staging $entry.FullName
            if ($entry.FullName.EndsWith('/')) { New-Item -ItemType Directory -Path $destination -Force | Out-Null }
            else {
                New-Item -ItemType Directory -Path ([IO.Path]::GetDirectoryName($destination)) -Force | Out-Null
                [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destination, $false)
            }
        }
    } finally { $zip.Dispose() }
    $stage = 'INTERNAL_MANIFEST_READ'
    $root = Join-Path $staging "redacton-$ReleaseVersion"
    $manifestPath = Join-Path $root 'SHA256SUMS'
    $manifestLines = [IO.File]::ReadAllLines($manifestPath, [Text.Encoding]::UTF8)
    $listed = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($line in $manifestLines) {
        $stage = 'INTERNAL_MANIFEST_VALIDATE'
        if ($line -notmatch '^([a-f0-9]{64})  (.+)$') { throw 'Invalid internal checksums.' }
        $hash = $Matches[1]; $name = $Matches[2]
        if ($name.Contains('\') -or $name.Contains(':') -or $name.StartsWith('/') -or $name.Split('/') -contains '..' -or $name.Split('/') -contains '.' -or $name.Split('/') -contains '' -or !$listed.Add($name)) { throw 'Unsafe checksum path.' }
        $stage = 'INTERNAL_CHECKSUM_READ'
        $fileDigest = Get-RedactonFileDigest (Join-Path $root $name)
        $stage = 'INTERNAL_CHECKSUM_MATCH'
        if ($fileDigest -ne $hash) { throw 'File checksum mismatch.' }
    }
    $stage = 'INTERNAL_FILE_SET'
    $files = [IO.Directory]::GetFiles($root, '*', [IO.SearchOption]::AllDirectories)
    if (($files.Length - 1) -ne $listed.Count) { throw 'Unlisted files.' }
    foreach ($file in $files) {
        if ($file -eq $manifestPath) { continue }
        $relative = $file.Substring($root.Length + 1).Replace('\', '/')
        if (!$listed.Contains($relative)) { throw 'Unlisted file.' }
    }
    # Node constructs argv and enforces timeout without invoking a shell or model task.
    $probe = @'
const cp=require('node:child_process'),path=require('node:path');
try {
 const root=process.argv[1];
 const r=cp.spawnSync(process.execPath,[path.join(root,'helper/dist/index.js')],{cwd:root,input:JSON.stringify({protocolVersion:1,requestId:'install_check',operation:'self-check',policyId:'credentials-alpha1'}),encoding:'utf8',timeout:10000,maxBuffer:65536});
 if(r.status!==0||r.stderr!=='')throw Error();
 const p=JSON.parse(r.stdout);
 if(p.status!=='ok'||p.requestId!=='install_check'||p.engineVersion!=='0.1.0-beta.14'||p.artifact!=='wasm')throw Error();
}catch{process.exit(1)}
'@
    $stage = 'SELF_CHECK'
    $null = & $node -e $probe $root 2>$null
    if ($LASTEXITCODE -ne 0) { throw 'Readiness self-check failed.' }
    $stage = 'ACTIVATION'
    $current = Join-Path $InstallDirectory 'current'
    if (Test-Path -LiteralPath $current) {
        $previous = Join-Path $InstallDirectory ('.previous-' + [guid]::NewGuid().ToString('N'))
        Move-Item -LiteralPath $current -Destination $previous
    }
    Move-Item -LiteralPath $root -Destination $current
    if ($previous) { Remove-Item -LiteralPath $previous -Recurse -Force; $previous = $null }
    Write-Output 'Candidate installed. PowerShell tool output is outside Redacton Bash interception coverage.'
    Write-Output ("claude --plugin-dir '" + $current.Replace("'", "''") + "'")
} catch {
    # Emit only a finite stage and fixed guidance, never exception text or paths.
    $category = switch ($_.Exception.GetType().Name) {
        'CommandNotFoundException' { 'COMMAND_NOT_FOUND' }
        'ParameterBindingException' { 'PARAMETER_BINDING' }
        'ParameterBindingValidationException' { 'PARAMETER_BINDING' }
        'MethodInvocationException' { 'METHOD_INVOCATION' }
        'RuntimeException' { 'REJECTED' }
        default { 'OTHER' }
    }
    [Console]::Error.WriteLine("Redacton: INSTALL_$stage failed category=$category. Node platform=$safeNodePlatform arch=$safeNodeArchitecture version=$safeNodeVersion. Check Node/Claude prerequisites, reviewed archive digest and a writable short path. Existing installation preserved.")
    $exitCode = 1
} finally {
    try {
        if ($previous -and !(Test-Path -LiteralPath $current)) { Move-Item -LiteralPath $previous -Destination $current }
    } catch {
        [Console]::Error.WriteLine('Redacton: INSTALL_ROLLBACK failed. Previous installation remains in its backup directory; restore it before launching.')
        $exitCode = 1
    }
    try {
        if ($staging -and (Test-Path -LiteralPath $staging)) { Remove-Item -LiteralPath $staging -Recurse -Force }
    } catch {
        [Console]::Error.WriteLine('Redacton: INSTALL_CLEANUP failed. Temporary installation data remains in the dedicated installation directory.')
        $exitCode = 1
    }
}
exit $exitCode
