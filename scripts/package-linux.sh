#!/bin/sh
set -eu

if [ "$(uname -s)" != Linux ] || [ "$(uname -m)" != x86_64 ]; then
  echo "El paquete se genera en Linux x86_64." >&2
  exit 1
fi

cd "$(dirname "$0")/.."
version="$(node -p 'require("./package.json").version')"
destination="${1:-./stark-dinac_${version}_amd64.deb}"
root="$(mktemp -d)"
trap 'rm -rf "$root"' EXIT
app="$root/opt/stark-dinac"
install -d "$root/DEBIAN" "$app/resources/app/apps/desktop" \
  "$root/usr/bin" "$root/usr/share/applications" \
  "$root/usr/share/pixmaps"
cp -a node_modules/electron/dist/. "$app/"
rm -f "$app/resources/default_app.asar"
install -m 0644 apps/desktop/main.mjs apps/desktop/preload.cjs apps/desktop/logo.png \
  "$app/resources/app/apps/desktop/"
cp -a dist-desktop "$app/resources/app/"
printf '{"name":"stark-dinac","version":"%s","main":"apps/desktop/main.mjs"}\n' "$version" \
  > "$app/resources/app/package.json"
install -m 0644 apps/desktop/logo.png "$root/usr/share/pixmaps/stark-dinac.png"

cat > "$root/usr/bin/stark-dinac" <<'LAUNCHER'
#!/bin/sh
exec /opt/stark-dinac/electron "$@"
LAUNCHER
chmod 0755 "$root/usr/bin/stark-dinac"

cat > "$root/usr/share/applications/stark-dinac.desktop" <<'DESKTOP'
[Desktop Entry]
Type=Application
Name=Stark Dinac
Comment=Controla el escritorio con gestos de la mano
Exec=stark-dinac
Icon=stark-dinac
Terminal=false
Categories=Utility;Accessibility;
DESKTOP

cat > "$root/DEBIAN/control" <<CONTROL
Package: stark-dinac
Version: $version
Section: utils
Priority: optional
Architecture: amd64
Depends: xdotool, libgtk-3-0t64 | libgtk-3-0, libasound2t64 | libasound2, libnss3, libgbm1, libxss1, libx11-xcb1, libxkbcommon0, libxcomposite1, libxdamage1, libxfixes3, libxrandr2, libatk-bridge2.0-0t64 | libatk-bridge2.0-0, libcups2t64 | libcups2, libdrm2, libxcb1
Maintainer: Stark Dinac contributors
Description: Control gestual del escritorio X11 mediante una cámara
 Mueve el puntero, haz clic y arrastra ventanas con una mano.
CONTROL

dpkg-deb --root-owner-group -Zzstd --build "$root" "$destination"
