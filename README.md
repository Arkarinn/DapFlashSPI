# DapFlashSPI

[简体中文](README.zh.md)

## Goal

- Use widely available and easily accessible CMSIS-DAP compatible devices to program FLASH and EEPROM with SPI/I2C protocols.

## Speed

- Depends on device capability and chip compatibility. The SPI protocol clock speed is generally greater than 10 MHz.

## Device Limitations

- Supports WebUSB driver for browser access.
- Supports JTAG interface to implement SPI interface.
- Supports SWD interface to implement I2C interface.

## Browser Compatibility

- Edge

## Web Tool (CMSIS-DAP WebUSB Debugger)

The repo root is a pure-frontend web tool (TypeScript + native DOM, no framework):

- Search / add USB devices (built-in CMSIS-DAP VID/PID filter, or list any device)
- Open / close a device (auto-locates bulk IN/OUT endpoints, i.e. CMSIS-DAP v2)
- Send / receive hex packets, with common DAP command shortcuts and a timestamped log

### Online (GitHub Pages)

A GitHub Actions workflow (`.github/workflows/pages.yml`) builds and deploys automatically on push to `main`:

1. GitHub → Settings → Pages → Build and deployment → Source: **GitHub Actions** (one-time setup)
2. Open <https://arkarinn.github.io/DapFlashSPI/>

GitHub Pages serves over HTTPS, which satisfies WebUSB's secure-context requirement.

### Run Locally

WebUSB requires the page to come from `localhost` or HTTPS.
The compiled `out/` is not committed, so build it once (needs Node.js):

```bash
npm install
npm run build
npm start                # serve at http://localhost:5177  (or: python -m http.server 5177)
```

Then open <http://localhost:5177> with Chrome/Edge.

### Notes

- WebUSB works in Chromium browsers only (Chrome/Edge); each device must be authorized once through the picker on the page.
- Bulk transfer only — CMSIS-DAP v2 firmware. v1 (HID-only) devices are not supported.
- On Windows, a "claim interface" failure usually means the device has no WinUSB driver bound:
  most DAPLink v2 firmwares auto-bind via Microsoft OS descriptors; otherwise use [Zadig]
  (beware: replacing the driver may break access from Keil/pyOCD).

### Shortcut Commands

| Button | Bytes | Description |
|---|---|---|
| Info·固件版本 | `00 04` | DAP_Info: firmware version |
| Info·能力 | `00 F0` | DAP_Info: capability bits |
| Connect·SWD | `02 01` | DAP_Connect: select SWD port |
| SWJ Clock·1MHz | `08 40 42 0F 00` | DAP_SWJ_Clock: set 1 MHz |
| ResetTarget | `06` | DAP_ResetTarget: reset target |

[Zadig]: https://zadig.akeo.ie/
