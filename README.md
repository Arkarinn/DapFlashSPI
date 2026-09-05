# DapFlashSPI

[简体中文](README.zh.md)

## Goal

- Program SPI FLASH with widely available and easily accessible CMSIS-DAP compatible devices.

## Speed

- Depends on device capability and chip compatibility. The SPI protocol clock speed is generally greater than 10 MHz.

## Device Limitations

- Requires a WebUSB driver for browser access.
- Requires a JTAG interface to implement the SPI interface.

## Browser Compatibility

- Edge

## Usage

- Click "Pair" and select the device in the browser dialog.
- Select the device and click "Open".
- Pick a FLASH model, or click "Auto Match".
- Choose the clock speed.
- Start reading / writing.

## Online (GitHub Pages)

A GitHub Actions workflow (`.github/workflows/pages.yml`) builds and deploys automatically on push to `main`:

1. GitHub → Settings → Pages → Build and deployment → Source: **GitHub Actions** (one-time setup)
2. Open <https://arkarinn.github.io/DapFlashSPI/>

GitHub Pages serves over HTTPS, which satisfies WebUSB's secure-context requirement.
Note: embedded browsers (Electron) cannot show the USB permission dialog — pairing
must be done in a real browser window.

## Run Locally

The compiled `out/` is not committed, so build it once (needs Node.js):

```bash
npm install
npm run build
npm start                # serve at http://localhost:5177  (or: python -m http.server 5177)
```

Then open <http://localhost:5177> in your browser.

## Chip Database

The model database contains **816 SPI NOR chips** from 37 vendors
(Winbond / Macronix / GigaDevice / Micron / ISSI, ...).
It was imported from the encrypted `chiplist.dat` of NeoProgrammer (CH341A programmer software):

```bash
python tools/decode_chiplist.py    # decode (chunked RC4 + zlib) → tools/chiplist.xml
python tools/gen_flashdb.py        # generate src/flashdb.ts
```

Excluded: SST AAI-programming chips (35) and legacy chips with non-3-byte JEDEC IDs (44).

## Technical Notes

- **CMSIS-DAP v2 (bulk) only**; v1 (HID) devices are not supported.
  On Windows, a "claim interface" failure at open usually means the device has no WinUSB
  driver bound: most firmwares auto-bind via Microsoft OS descriptors; otherwise use [Zadig]
  (beware: replacing the driver may break access from Keil/pyOCD).
  A device held by a debugger (Keil etc.) also cannot be opened — close it first.
- SPI is implemented over JTAG with the pin mapping TCK→SCK, TMS→CS, TDI→MOSI, TDO→MISO.
  JTAG shifts LSB-first while SPI commands are MSB-first, so every byte is bit-reversed.
  Read/write transfers are automatically packetized according to the DAP packet size.
- Chips larger than 16 MB automatically enter 4-byte address mode
  (0xB7 enter / 0xE9 exit, read 0x13 / page program 0x12); 3-byte mode is restored before
  the device is closed. Up to 256 MB is supported.
- Command IDs follow the current official firmware (`Include/DAP.h`) — e.g.
  SWJ_Clock=0x11, JTAG_Sequence=0x14 — and the first response byte echoes the command ID.
  When touching firmware-related code, cross-check against the official CMSIS-DAP sources.

[Zadig]: https://zadig.akeo.ie/
