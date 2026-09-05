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

- Open the GitHub Pages site.
- Click "Pair" and select the device in the browser dialog.
- Select the device and click "Open".
- Pick a FLASH model, or click "Auto Match".
- Choose the clock speed.
- Start reading / writing.

## Run Locally

```bash
npm install
npm run build
npm start      # serve at http://localhost:5177  (or: python -m http.server 5177)
```

Then open <http://localhost:5177> in your browser.

## Chip Database

The model database contains **816 SPI NOR chips** from 37 vendors
(Winbond / Macronix / GigaDevice / Micron / ISSI, ...), imported from the encrypted
`chiplist.dat` of NeoProgrammer (CH341A programmer software):

```bash
python tools/decode_chiplist.py    # decode (chunked RC4 + zlib) → tools/chiplist.xml
python tools/gen_flashdb.py        # generate src/flashdb.ts
```

Excluded: SST AAI-programming chips (35) and legacy chips with non-3-byte JEDEC IDs (44).

## Notes

- Generated with ZCode(GLM 5.3).
- **CMSIS-DAP v2 (bulk) only**; v1 (HID) devices are not supported.
  A device held by a debugger (Keil etc.) cannot be opened — close it first.
- SPI is implemented over JTAG with the pin mapping TCK→SCK, TMS→CS, TDI→MOSI, TDO→MISO.
  JTAG shifts LSB-first while SPI commands are MSB-first, so every byte is bit-reversed.
  Read/write transfers are automatically packetized according to the DAP packet size.
- Chips larger than 16 MB automatically enter 4-byte address mode;
  3-byte mode is restored before the device is closed. Up to 256 MB is supported.

## Command Set and Protocol Formats

### SPI FLASH Commands

| Command | Opcode | Format / Notes |
| --- | --- | --- |
| Write Enable (WREN) | `0x06` | Single byte, sets WEL (before each program/erase) |
| Read Status (RDSR) | `0x05` | `[05]` + 1 dummy → 1 byte; bit0 = WIP (busy), bit1 = WEL |
| Read JEDEC ID | `0x9F` | `[9F]` + 3 dummies → 3 bytes (vendor / type / capacity); used by auto match |
| Read Data | `0x03` / `0x13`* | `[03, A23..A16, A15..A8, A7..A0]` + N dummies → N bytes |
| Page Program | `0x02` / `0x12`* | `[02, addr, data...]`; must not cross a page, ≤ page size per transaction |
| Chip Erase | `0x60` | Single byte (`0xC7` equivalent); poll WIP until done |
| Release Power-down | `0xAB` | `[AB]` + 3 dummies, wakes the chip |
| 4-byte address mode | `0xB7` / `0xE9` | Enter / exit; used for >16 MB chips only |

\* In 4-byte address mode the marked opcode is used and the address is 4 bytes.

## Links

- [CMSIS-DAP](https://github.com/ARM-software/CMSIS-DAP)
- [DAPLink](https://github.com/ARMmbed/DAPLink)
- [ZCode](https://zcode.z.ai/cn)
