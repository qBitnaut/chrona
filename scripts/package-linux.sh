#!/usr/bin/env bash
# Package the built Linux binary as a plain tarball.
#
# This is the artifact for rolling-release distros (Arch in particular): it
# links against the host's webkit2gtk-4.1 rather than carrying its own, which is
# what a current WebKitGTK on Wayland wants.
#
# Usage: scripts/package-linux.sh [output-dir]
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="${1:-$root/dist-linux}"
version="$(grep -m1 '"version"' "$root/package.json" | sed 's/.*: *"\(.*\)".*/\1/')"
name="chrona-$version-linux-x86_64"

# A plain build lands in target/release; a --target build (what CI uses) lands
# in target/<triple>/release.
bin="${CHRONA_BIN:-}"
if [ -z "$bin" ]; then
  for candidate in "$root"/src-tauri/target/release/chrona \
                   "$root"/src-tauri/target/*/release/chrona; do
    [ -x "$candidate" ] && { bin="$candidate"; break; }
  done
fi
[ -n "$bin" ] && [ -x "$bin" ] || {
  echo "no chrona binary found — run 'bun run tauri build' first" >&2; exit 1
}

stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT
pkg="$stage/$name"
mkdir -p "$pkg/icons"

install -Dm755 "$bin" "$pkg/chrona"
for s in 32 128; do
  install -Dm644 "$root/src-tauri/icons/${s}x${s}.png" "$pkg/icons/${s}x${s}.png"
done
install -Dm644 "$root/src-tauri/icons/icon.png" "$pkg/icons/512x512.png"

cat > "$pkg/chrona.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Name=Chrona
Comment=Desktop clock + live weather glass widget
Exec=chrona
Icon=chrona
Terminal=false
Categories=Utility;Clock;
StartupWMClass=chrona
EOF

# Chrona's Mica/Acrylic code is Windows-only (DWM). On Wayland the compositor
# has to supply the glass instead, so these rules are not cosmetic — without
# them the card renders as flat grey.
cat > "$pkg/hyprland-chrona.lua" <<'EOF'
-- Chrona window rules for Hyprland. Append to ~/.config/hypr/hyprland.lua.
--
-- Chrona's Mica/Acrylic backdrop is a Windows DWM feature, so on Wayland the
-- compositor supplies the glass: the card paints a translucent fill and
-- Hyprland blurs the wallpaper underneath it. `xray` is what makes it read as
-- Mica rather than Acrylic — the blur samples the wallpaper only, ignoring
-- windows stacked behind the widget.
--
-- Opting out of dimming matters more than it looks: a desktop widget is never
-- the focused window, so under a default `dim_inactive` + `inactive_opacity`
-- it sits permanently dimmed and the glass reads as flat grey.
--
-- `rounding` must match the card's own radius (18) or the gap between the two
-- shows as bare blur at the corners.
o.window({ class = "^chrona$", title = "^Chrona$" }, {
  tag = "-default-opacity",
  float = true,
  no_initial_focus = true,
  no_dim = true,
  border_size = 0,
  no_shadow = true,
  xray = true,
  rounding = 18,
  opacity = "1 1",
})

-- The Settings window shares the class and must NOT inherit no_initial_focus,
-- or its search field never takes a keystroke. Hyprland matches `title` as a
-- full string, hence the leading `.*`.
o.window({ class = "^chrona$", title = ".*Settings" }, {
  float = true,
  center = true,
})

-- Optional: keep the widget on every workspace.
-- o.window({ class = "^chrona$", title = "^Chrona$" }, { pin = true })
EOF

cat > "$pkg/install.sh" <<'EOF'
#!/usr/bin/env bash
# Install Chrona into ~/.local (no root needed).
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

install -Dm755 "$here/chrona" "$HOME/.local/bin/chrona"
install -Dm644 "$here/chrona.desktop" "$HOME/.local/share/applications/chrona.desktop"
for s in 32 128 512; do
  install -Dm644 "$here/icons/${s}x${s}.png" \
    "$HOME/.local/share/icons/hicolor/${s}x${s}/apps/chrona.png"
done
update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
gtk-update-icon-cache -f -t "$HOME/.local/share/icons/hicolor" 2>/dev/null || true

echo "Installed to ~/.local/bin/chrona"
case ":$PATH:" in
  *":$HOME/.local/bin:"*) ;;
  *) echo "note: ~/.local/bin is not on your PATH" ;;
esac
echo "Hyprland users: append hyprland-chrona.lua to ~/.config/hypr/hyprland.lua"
EOF
chmod +x "$pkg/install.sh"

cat > "$pkg/README.md" <<EOF
# Chrona $version — Linux (x86_64)

Run \`./install.sh\` to install into \`~/.local\`, then launch \`chrona\`.

## Requirements

Arch: \`pacman -S webkit2gtk-4.1 gtk3 libayatana-appindicator\`
(the tray needs libayatana-appindicator; the widget itself runs without it).

## Wayland / Hyprland

Append \`hyprland-chrona.lua\` to \`~/.config/hypr/hyprland.lua\`. Without those
rules the glass renders as flat grey — the compositor, not the app, draws the
blur on Linux.

## Known Linux limitations

- **Mica / Acrylic / blur radius** in Settings do nothing; the compositor owns
  the material. Use the window rule's \`xray\` and your blur settings instead.
- **Window position is not restored** across restarts, and "Reset position"
  does nothing — Wayland does not let a client place itself.
- **Always on top / Pin** are no-ops. Use a Hyprland \`pin\` rule instead.
- **No manual refresh button** (it depends on a hover state WebKitGTK does not
  release on Wayland). Weather still refreshes on its interval.
- **No auto-update on Linux.** The updater only handles AppImages, which this
  build deliberately does not ship. Turn Automatic updates off in Settings.
EOF

mkdir -p "$out"
tar -C "$stage" -czf "$out/$name.tar.gz" "$name"
echo "$out/$name.tar.gz"
