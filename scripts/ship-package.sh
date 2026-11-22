#!/usr/bin/env bash
set -euo pipefail

tarball="$(realpath "$1")"
mode="${2:-}"
integrity="sha512-$(openssl dgst -sha512 -binary "$tarball" | openssl base64 -A)"

cd "$(mktemp -d)"

if [ "$mode" = --dry-run ]; then
  pnpm publish "$tarball" --registry "$REGISTRY" --no-git-checks --dry-run
  exit 0
fi

published() {
  pnpm view "$SPEC" dist.integrity --registry "$REGISTRY" 2> /dev/null || true
}

if [[ "$(published)" != sha512-* ]]; then
  pnpm publish "$tarball" --registry "$REGISTRY" --no-git-checks
fi

for _ in {1..30}; do
  held="$(published)"
  if [ "$held" = "$integrity" ]; then
    exit 0
  fi
  if [[ "$held" == sha512-* ]]; then
    break
  fi
  sleep 2
done

echo "::error::GitHub Packages does not hold the released bytes for $SPEC"
exit 1
