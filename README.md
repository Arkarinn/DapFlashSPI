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

- Generated with ZCode@GLM 5.3.
- **CMSIS-DAP v2 (bulk) only**; v1 (HID) devices are not supported.
  A device held by a debugger (Keil etc.) cannot be opened — close it first.
- SPI is implemented over JTAG with the pin mapping TCK→SCK, TMS→CS, TDI→MOSI, TDO→MISO.
  JTAG shifts LSB-first while SPI commands are MSB-first, so every byte is bit-reversed.
  Read/write transfers are automatically packetized according to the DAP packet size.
- Chips larger than 16 MB automatically enter 4-byte address mode
  (0xB7 enter / 0xE9 exit, read 0x13 / page program 0x12);
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

\* In 4-byte address mode the marked opcode is used and the address is 4 bytes (starting with `A31..A24`).

### CMSIS-DAP Commands (v2 bulk)

| Command | Opcode | Notes |
| --- | --- | --- |
| DAP_Info | `0x00` | `[00, info ID]` → `[echo, length, data]`; `0xF0` capabilities, `0x03` serial number, `0xFF` packet size |
| DAP_HostStatus | `0x01` | `[01, 0, 1]` turns on the connected LED |
| DAP_Connect | `0x02` | `[02, 2]` enters JTAG mode → `[echo, 2]` |
| DAP_Disconnect | `0x03` | Disconnects |
| DAP_SWJ_Clock | `0x11` | `[11, clock Hz, 4 bytes LE]` sets the TCK frequency |
| DAP_JTAG_Sequence | `0x14` | Bit-stream generator, format below |

### Protocol Formats

- **USB transport**: each DAP command is one bulk OUT packet, its response one bulk IN packet.
  The first response byte echoes the command ID; most commands follow with a status byte
  (`0x00` OK / `0xFF` error).
- **JTAG_Sequence request**: `[0x14][sequence count]([sequence info][TDI data])*`;
  `info` = bit7 TDO-capture enable, bit6 TMS level, bits[5:0] TCK count (0 means 64).
  Response: `[0x14][0x00][captured TDO data...]`.
- **SPI transaction → JTAG sequences**: pins TCK=SCK / TMS=CS / TDI=MOSI / TDO=MISO.
  While CS is low, the SPI payload is split into one sequence per 8 bytes
  (TDI bytes are bit-reversed; capture starts at the first byte to be read), and a final
  single-TCK sequence with TMS=1 raises CS. Captured TDO bytes are bit-reversed back to MSB-first.

## Links

- [CMSIS-DAP](https://github.com/ARM-software/CMSIS-DAP)
- [DAPLink](https://github.com/ARMmbed/DAPLink)
- [ZCode](https://zcode.z.ai/cn)
