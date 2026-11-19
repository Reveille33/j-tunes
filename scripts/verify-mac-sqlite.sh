#!/bin/sh
# Confirm each packaged Mac app loads a better-sqlite3 binary of that app's arch.
set -eu

root=${1:-release}
fail=0

check() {
  app=$1
  expected=$2
  node=$app/Contents/Resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node
  exe=$app/Contents/MacOS/j-Tunes

  echo "=== $app ==="
  if [ ! -f "$node" ]; then
    echo "missing $node"
    find "$app" -name '*.node' -print || true
    fail=1
    return
  fi

  file "$exe"
  file "$node"
  file "$exe" | grep -q "$expected" || {
    echo "executable is not $expected"
    fail=1
  }
  file "$node" | grep -q "$expected" || {
    echo "better-sqlite3 is not $expected"
    fail=1
  }
}

check "$root/mac-arm64/j-Tunes.app" arm64
check "$root/mac/j-Tunes.app" x86_64

echo "=== artifacts ==="
ls -lh "$root"/*.dmg "$root"/*.zip

exit "$fail"
