# Ralph Voice Assets

Place the following assets in this directory:

## Required Assets

- `icon.icns` - macOS app icon (512x512 or 1024x1024)
- `tray-icon.png` - Menu bar icon (18x18 for standard, 36x36 for Retina)

## Creating Icons

### App Icon (icon.icns)
1. Create a 1024x1024 PNG
2. Use `iconutil` to convert:
   ```bash
   mkdir icon.iconset
   sips -z 16 16 icon.png --out icon.iconset/icon_16x16.png
   sips -z 32 32 icon.png --out icon.iconset/icon_16x16@2x.png
   sips -z 32 32 icon.png --out icon.iconset/icon_32x32.png
   sips -z 64 64 icon.png --out icon.iconset/icon_32x32@2x.png
   sips -z 128 128 icon.png --out icon.iconset/icon_128x128.png
   sips -z 256 256 icon.png --out icon.iconset/icon_128x128@2x.png
   sips -z 256 256 icon.png --out icon.iconset/icon_256x256.png
   sips -z 512 512 icon.png --out icon.iconset/icon_256x256@2x.png
   sips -z 512 512 icon.png --out icon.iconset/icon_512x512.png
   sips -z 1024 1024 icon.png --out icon.iconset/icon_512x512@2x.png
   iconutil -c icns icon.iconset
   ```

### Tray Icon (tray-icon.png)
- Use a monochrome design
- Works best as white/transparent for dark mode
- Template images work best on macOS
