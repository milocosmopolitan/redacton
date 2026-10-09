#!/usr/bin/env bash
set -euo pipefail

fail() { printf '%s\n' "Redacton: $1" >&2; exit 1; }
[ "$(uname -s)" = Darwin ] && [ "$(uname -m)" = arm64 ] || fail 'This installer supports Apple silicon Macs.'
command -v node >/dev/null 2>&1 || fail 'Install Node.js 22, then run this command again.'
[ "$(node -p 'process.versions.node.split(".")[0]')" = 22 ] || fail 'Use Node.js 22. This installation was tested with 22.16.0.'
command -v claude >/dev/null 2>&1 || fail 'Install Claude Code, then run this command again.'
for command in curl tar shasum mktemp; do
  command -v "$command" >/dev/null 2>&1 || fail "The required command '$command' is missing."
done

install_dir=${REDACTON_INSTALL_DIR:-"$HOME/.local/share/redacton"}
case "$install_dir" in
  /*) ;;
  *) fail 'REDACTON_INSTALL_DIR must be an absolute directory path.' ;;
esac
[ "$install_dir" != / ] && [ "$install_dir" != "$HOME" ] || fail 'Choose a dedicated installation directory.'
mkdir -p "$install_dir"
install_dir=$(cd "$install_dir" && pwd -P)
[ "$install_dir" != / ] && [ "$install_dir" != "$HOME" ] || fail 'Choose a dedicated installation directory.'
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
url='https://github.com/milocosmopolitan/redacton/releases/download/v0.1.0/redacton-0.1.0.tar.gz'
expected='d34c3f707e30907505e4dec9189b2a29de650dba3604c4f21474f60183e63f99'
curl --connect-timeout 10 --max-time 90 --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --tlsv1.2 "$url" -o "$archive" || fail 'Download failed. Your existing installation has been preserved.'
actual=$(shasum -a 256 "$archive")
[ "${actual%% *}" = "$expected" ] || fail 'Download verification failed. Your existing installation has been preserved.'
tar -tzf "$archive" > "$staging/entries" || fail 'The download could not be opened.'
while IFS= read -r entry; do
  case "$entry" in
    redacton-0.1.0/*) ;;
    *) fail 'The download contains an unexpected path.' ;;
  esac
  case "/$entry/" in
    */../*|*/./*|*//*|*\\*) fail 'The download contains an unsafe path.' ;;
  esac
done < "$staging/entries"
tar -tvzf "$archive" > "$staging/details" || fail 'The download could not be inspected.'
while IFS= read -r entry; do
  case "$entry" in
    -*) ;;
    *) fail 'The download contains a link or special file.' ;;
  esac
done < "$staging/details"
tar -xzf "$archive" -C "$staging" || fail 'Installation could not be unpacked.'
[ -f "$staging/redacton-0.1.0/.claude-plugin/plugin.json" ] && [ -f "$staging/redacton-0.1.0/helper/dist/index.js" ] || fail 'The download is incomplete.'
if [ -e "$install_dir/current" ] || [ -L "$install_dir/current" ]; then
  previous="$install_dir/previous-$(date -u +%Y%m%dT%H%M%S)-$$"
  mv "$install_dir/current" "$previous" || fail 'Your existing installation could not be safely preserved.'
fi
mv "$staging/redacton-0.1.0" "$install_dir/current" || fail 'Installation failed. Your previous installation will be restored.'
previous=''
printf '%s\n' 'Redacton is installed. Start Claude Code with:'
printf 'claude --plugin-dir %q\n' "$install_dir/current"
