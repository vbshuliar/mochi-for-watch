#!/bin/sh
set -eu
cd "$(dirname "$0")/../.."
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
xcrun swift build --package-path native
products=$(xcrun swift build --package-path native --show-bin-path)
render_dir=$(mktemp -d /tmp/mochi-artwork.XXXXXX)
trap 'rm -rf "$render_dir"' EXIT
xcrun swiftc -parse-as-library -I "$products" "$products/MochiCore.o" \
  native/Shared/MochiView.swift native/scripts/render-icon.swift -o "$render_dir/render"
"$render_dir/render" "$PWD"
