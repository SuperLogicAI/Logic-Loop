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
# though only one is actually "installed". Unregistering it (lsregister -u)
# doesn't stick as long as the file still exists on disk — Spotlight just
# re-registers it later. The only reliable fix is removing the file itself;
# it's build packaging output, safe to delete, `tauri build` recreates it
# fresh next run. (docs/TESTING.md's "open the raw build" step runs right
# after its own `tauri build`, before reinstall touches it — unaffected.)
"$LSREG" -u "$BUILT" 2>/dev/null || true
rm -rf "$BUILT"
