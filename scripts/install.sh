#!/usr/bin/env bash
set -euo pipefail

fail() { printf '%s\n' "Redacton: $1" >&2; exit 1; }
platform=$(uname -s)
architecture=$(uname -m)
case "$platform:$architecture" in
  Darwin:arm64|Darwin:x86_64|Linux:x86_64|Linux:aarch64|Linux:arm64) ;;
  *) fail 'Supported installer targets are macOS x64/ARM64 and Linux x64/ARM64.' ;;
esac
# Historical release stays pinned; candidate portable releases require an explicit digest.
release=${REDACTON_RELEASE_VERSION:-0.1.0}
if [ "$release" = 0.1.0 ]; then
  [ "$platform:$architecture" = Darwin:arm64 ] || fail 'The historical release is qualified only for macOS ARM64. Use a new candidate release for other targets.'
fi
expected=${REDACTON_ARCHIVE_SHA256:-}
if [ -z "$expected" ]; then
  [ "$release:$platform:$architecture" = '0.1.0:Darwin:arm64' ] || fail 'No qualified release is pinned for this target. Supply a reviewed candidate release version and SHA-256 for local qualification.'
  expected='d34c3f707e30907505e4dec9189b2a29de650dba3604c4f21474f60183e63f99'
fi
[[ "$release" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[A-Za-z0-9.-]+)?$ ]] || fail 'Invalid release version.'
[[ "$expected" =~ ^[a-f0-9]{64}$ ]] || fail 'REDACTON_ARCHIVE_SHA256 must contain an exact lowercase SHA-256.'
command -v node >/dev/null 2>&1 || fail 'Install Node.js 22, then run this command again.'
if [ "$platform" = Linux ]; then
  node -e 'const v=process.report.getReport().header.glibcVersionRuntime; if(!v)process.exit(1); const [a,b]=v.split(".").map(Number); process.exit(a>2 || a===2 && b>=31 ? 0 : 1)' || fail 'Linux candidates require glibc 2.31+. musl is not qualified.'
fi
node -e 'const [major,minor,patch]=process.versions.node.split(".").map(Number); process.exit((major===22 && (minor>16 || minor===16 && patch>=0)) || (major===24 && minor>=21) ? 0 : 1)' || fail 'Use Node.js 22.16.0+ (22.x) or 24.21.0+ (24.x). These measured versions do not qualify other platforms.'
if [ "$release" = 0.1.0 ]; then
  [ "$(node -p 'process.versions.node.split(".")[0]')" = 22 ] || fail 'The historical release requires Node.js 22.'
fi
command -v claude >/dev/null 2>&1 || fail 'Install Claude Code, then run this command again.'
for command in curl tar mktemp; do
  command -v "$command" >/dev/null 2>&1 || fail "The required command '$command' is missing."
done

# WSL uses the Linux namespace, separate from native Windows local application data.
if [ "$platform" = Darwin ]; then default_dir="$HOME/Library/Application Support/Redacton"; else default_dir="${XDG_DATA_HOME:-$HOME/.local/share}/redacton"; fi
if [ "$release" = 0.1.0 ]; then default_dir="$HOME/.local/share/redacton"; fi
install_dir=${REDACTON_INSTALL_DIR:-"$default_dir"}
case "$install_dir" in
  /*) ;;
  *) fail 'REDACTON_INSTALL_DIR must be an absolute directory path.' ;;
esac
[ "$install_dir" != / ] && [ "$install_dir" != "$HOME" ] || fail 'Choose a dedicated installation directory.'
mkdir -p "$install_dir"
install_dir=$(cd "$install_dir" && pwd -P)
[ "$install_dir" != / ] && [ "$install_dir" != "$HOME" ] || fail 'Choose a dedicated installation directory.'
if [ "$platform" = Linux ] && node -e 'process.exit(require("node:fs").readFileSync("/proc/sys/kernel/osrelease","utf8").toLowerCase().includes("microsoft") ? 0 : 1)'; then
  case "$install_dir" in
    /mnt/*) fail 'WSL installation must use the Linux filesystem, not a mounted Windows drive.' ;;
  esac
fi
staging=$(mktemp -d "$install_dir/.install.XXXXXX")
previous=''
cleanup() {
  if [ -n "$previous" ] && [ ! -e "$install_dir/current" ] && [ ! -L "$install_dir/current" ]; then
    mv "$previous" "$install_dir/current" || true
  fi
  rm -rf "$staging"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM

archive="$staging/plugin.tar.gz"
url="https://github.com/milocosmopolitan/redacton/releases/download/v$release/redacton-$release.tar.gz"
if [ -n "${REDACTON_ARCHIVE_PATH:-}" ]; then
  [ -f "$REDACTON_ARCHIVE_PATH" ] || fail 'Candidate archive is missing.'
  cp "$REDACTON_ARCHIVE_PATH" "$archive"
else
curl --connect-timeout 10 --max-time 90 --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --tlsv1.2 "$url" -o "$archive" || fail 'Download failed. Your existing installation has been preserved.'
fi
actual=$(node -e 'const fs=require("node:fs"),crypto=require("node:crypto"); console.log(crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"))' "$archive")
[ "$actual" = "$expected" ] || fail 'Download verification failed. Your existing installation has been preserved.'
tar -tzf "$archive" > "$staging/entries" || fail 'The download could not be opened.'
node -e 'const fs=require("node:fs"),seen=new Set(); for(const name of fs.readFileSync(process.argv[1],"utf8").trimEnd().split("\n")){const key=name.replace(/\/$/,"").toLowerCase(); if(seen.has(key))process.exit(1); seen.add(key)}' "$staging/entries" || fail 'The archive contains duplicate or case-colliding paths.'
while IFS= read -r entry; do
  case "$entry" in
    "redacton-$release/"*) ;;
    *) fail 'The download contains an unexpected path.' ;;
  esac
  entry=${entry%/}
  case "/$entry/" in
    */../*|*/./*|*//*|*\\*) fail 'The download contains an unsafe path.' ;;
  esac
done < "$staging/entries"
tar -tvzf "$archive" > "$staging/details" || fail 'The download could not be inspected.'
while IFS= read -r entry; do
  case "$entry" in
    -*|d*) ;;
    *) fail 'The download contains a link or special file.' ;;
  esac
done < "$staging/details"
tar -xzf "$archive" -C "$staging" || fail 'Installation could not be unpacked.'
[ -f "$staging/redacton-$release/.claude-plugin/plugin.json" ] && [ -f "$staging/redacton-$release/helper/dist/index.js" ] || fail 'The download is incomplete.'
# Verify every installed file before any existing installation is moved.
node --input-type=commonjs - "$staging/redacton-$release" "$release" <<'NODE'
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto'), cp = require('node:child_process');
const root = process.argv[2];
try {
  const actual = new Set();
  function walk(dir) {
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name), stat = fs.lstatSync(file);
      if (stat.isSymbolicLink()) throw Error();
      if (stat.isDirectory()) walk(file);
      else if (stat.isFile()) actual.add(path.relative(root, file).split(path.sep).join('/'));
      else throw Error();
    }
  }
  walk(root);
  actual.delete('SHA256SUMS');
  const listed = new Set();
  for (const line of fs.readFileSync(path.join(root, 'SHA256SUMS'), 'utf8').trim().split('\n')) {
    const match = /^([a-f0-9]{64})  (.+)$/.exec(line);
    if (!match) throw Error();
    const [, hash, name] = match;
    if (name.startsWith('/') || name.includes('\\') || name.split('/').some(p => !p || p === '.' || p === '..') || listed.has(name) || !actual.has(name)) throw Error();
    if (crypto.createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex') !== hash) throw Error();
    listed.add(name);
  }
  if (listed.size !== actual.size) throw Error();
  const check = cp.spawnSync(process.execPath, [path.join(root, 'helper/dist/index.js')], {
    cwd: root, input: JSON.stringify({protocolVersion:1,requestId:'install_check',operation:'self-check',policyId:'credentials-alpha1'}), encoding:'utf8', timeout:10000, maxBuffer:65536,
  });
  if (check.status !== 0 || check.stderr !== '') throw Error();
  const reply = JSON.parse(check.stdout);
  if (reply.status !== 'ok' || reply.requestId !== 'install_check' || reply.engineVersion !== '0.1.0-beta.14' || !['addon','wasm'].includes(reply.artifact)) throw Error();
  if (process.argv[3] !== '0.1.0' && reply.artifact !== 'wasm') throw Error();
} catch {
  console.error('Redacton: Artifact integrity/readiness check failed. Existing installation preserved.');
  process.exit(1);
}
NODE
if [ -e "$install_dir/current" ] || [ -L "$install_dir/current" ]; then
  previous="$install_dir/previous-$(date -u +%Y%m%dT%H%M%S)-$$"
  mv "$install_dir/current" "$previous" || fail 'Your existing installation could not be safely preserved.'
fi
mv "$staging/redacton-$release" "$install_dir/current" || fail 'Installation failed. Your previous installation will be restored.'
if [ -n "$previous" ]; then rm -rf "$previous"; fi
previous=''
printf '%s\n' 'Redacton is installed. Start Claude Code with:'
printf 'claude --plugin-dir %q\n' "$install_dir/current"
