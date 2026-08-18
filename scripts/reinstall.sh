#!/bin/sh
set -e

npm run tauri build

BUILT="src-tauri/target/release/bundle/macos/Logic Loop.app"
LSREG=/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister

# ponytail: leftover mounted DMG volumes from a past release build also carry
# their own "Logic Loop.app" — stray ghosts in the Apps grid that rm -rf on
# /Applications can never reach. Eject them if any are still mounted.
for v in /Volumes/dmg.*; do
  [ -e "$v/Logic Loop.app" ] && hdiutil eject "$v" -quiet || true
done

rm -rf "/Applications/Logic Loop.app"
cp -R "$BUILT" /Applications/

# ponytail: macOS auto-registers any .app it notices with Launch Services,
# including the raw build output — so after the cp above, BOTH the build
# folder and /Applications show up as separate icons in the Apps grid, even
# though only one is actually "installed". A .metadata_never_index marker in
# target/ doesn't reliably stop this (mdworker seems to need a restart to
# honor it), so instead: wait out Spotlight's own re-index of the build
# folder (~1s, observed) and unregister it last so our call wins the race.
sleep 2
"$LSREG" -u "$BUILT" 2>/dev/null || true
