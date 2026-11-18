<p align="center">
  <img src="logo.svg" width="128" height="128" alt="Super Scroll Switcher" />
</p>

# Super Scroll Switcher (GNOME Shell 51)

Lightweight extension for **GNOME Shell 51 (Wayland)** that remaps `Super + Scroll` behavior:

- **`Super + Scroll`**: Opens the Overview, cycles focus across open windows on the current workspace on each scroll step, and activates the focused window when `Super` is released.
- **`Super + Shift + Scroll`**: Keeps GNOME's native workspace switching.

## Local Installation

```bash
ln -s /home/holmes/dev/super-scroll-switcher ~/.local/share/gnome-shell/extensions/super-scroll-switcher@emn-f.github.io
gnome-extensions enable super-scroll-switcher@emn-f.github.io
```

> On **Wayland** sessions, log out and log back in after creating the symlink for the first time so GNOME Shell discovers the extension.

## Packaging for extensions.gnome.org

```bash
gnome-extensions pack /home/holmes/dev/super-scroll-switcher --force --out-dir=/home/holmes/dev/super-scroll-switcher
```
