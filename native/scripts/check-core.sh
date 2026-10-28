#!/bin/sh
set -eu
cd "$(dirname "$0")/.."

# XCTest requires the full Xcode toolchain on macOS.
if [ "$(uname -s)" = Darwin ]; then
  if [ -z "${DEVELOPER_DIR:-}" ] && [ -d /Applications/Xcode.app/Contents/Developer ]; then
    export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
  fi
  exec xcrun swift test --package-path .
fi
exec swift test --package-path .
