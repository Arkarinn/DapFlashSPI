// SPI-over-JTAG: 用 DAP_JTAG_Sequence 模拟 SPI (mode 0)
// 引脚映射: TCK=SCK, TMS=CS, TDI=MOSI, TDO=MISO
// JTAG 数据 LSB-first, SPI FLASH 命令 MSB-first → 每字节做位反转
import { CmsisDap, DapError, sleep } from './dap.js';

const REV8 = new Uint8Array(256);
for (let i = 0; i < 256; i++) {
  let r = 0;
  let v = i;
  for (let b = 0; b < 8; b++) {
    r = (r << 1) | (v & 1);
    v >>= 1;
  }
  REV8[i] = r;
}

const rev = (bytes: Uint8Array): Uint8Array => {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = REV8[bytes[i]!]!;
  return out;
};

interface Seq {
  data: Uint8Array; // 该段 TDI 数据 (整段 TMS 恒定, 8 位对齐, ≤8 字节)
  tms: 0 | 1;
  capture: boolean;
}

export class SpiFlash {
  // 单次 SPI 事务 (单 CS 周期) 的最大数据字节数:
  // 包内每 8 字节需 1 字节 sequence info, 另留 命令字节/结尾拉高段/终止符
  readonly dataChunk: number;

  constructor(readonly dap: CmsisDap) {
    const n = Math.floor((dap.pktSize - 4) / 9);
    this.dataChunk = Math.max(4, n * 8 - 4);
  }

  // 一次 SPI 事务: CS 拉低期间输出 out (readFrom 起的字节同时捕获 MISO), 最后 CS 拉高
  async xfer(out: Uint8Array, readFrom: number = out.length): Promise<Uint8Array> {
    const tdi = rev(out);
    const seqs: Seq[] = [];
    const push = (from: number, to: number, capture: boolean): void => {
      for (let s = from; s < to; s += 8) {
        seqs.push({ data: tdi.subarray(s, Math.min(s + 8, to)), tms: 0, capture });
      }
    };
    const cut = Math.min(readFrom, out.length);
    push(0, cut, false);
    push(cut, out.length, true);
    const expect = out.length - cut;

    // 组包: [0x10] ([info][tdi...])* [结尾段: TMS=1, 1位] [0x00 终止]
    let len = 4; // 命令字节 + 结尾段(info+tdi) + 终止符
    for (const s of seqs) len += 1 + s.data.length;
    const pkt = new Uint8Array(len);
    let p = 0;
    pkt[p++] = 0x10;
    for (const s of seqs) {
      pkt[p++] = (s.tms ? 0x40 : 0) | (s.capture ? 0x80 : 0) | ((s.data.length * 8) & 0x3f);
      pkt.set(s.data, p);
      p += s.data.length;
    }
    pkt[p++] = 0x41; // TMS=1, 1 个 TCK (CS 拉高)
    pkt[p++] = 0x00; // 结尾段 TDI (无关)
    pkt[p] = 0x00; // 序列表终止符

    const resp = await this.dap.jtagSequence(pkt, expect);
    return rev(resp);
  }

  // ---- 标准 SPI FLASH 命令 (MSB-first) ----

  // Release Power-Down: 唤醒 (CS 拉低 ≥8 个时钟)
  async wake(): Promise<void> {
    await this.xfer(Uint8Array.of(0xab, 0x00, 0x00, 0x00));
  }

  // 读 JEDEC Manufacturer/Device ID (3 字节)
  async readJedec(): Promise<number> {
    const r = await this.xfer(Uint8Array.of(0x9f, 0x00, 0x00, 0x00), 1);
    return (r[0]! << 16) | (r[1]! << 8) | r[2]!;
  }

  // 读状态寄存器 1 (bit0=WIP)
  async readStatus(): Promise<number> {
    const r = await this.xfer(Uint8Array.of(0x05, 0x00), 1);
    return r[0]!;
  }

  // 轮询 WIP 直到空闲
  async waitWip(timeoutMs: number, pollMs = 250): Promise<void> {
    const t0 = performance.now();
    for (;;) {
      if ((await this.readStatus() & 1) === 0) return;
      if (performance.now() - t0 > timeoutMs) throw new DapError(`等待 WIP 超时 (${timeoutMs} ms)`);
      await sleep(pollMs);
    }
  }

  // 读数据 (单次 ≤ dataChunk)
  async readData(addr: number, len: number): Promise<Uint8Array> {
    const pkt = new Uint8Array(4 + len);
    pkt.set(Uint8Array.of(0x03, (addr >>> 16) & 0xff, (addr >>> 8) & 0xff, addr & 0xff));
    return this.xfer(pkt, 4);
  }

  // 页编程 (单次 ≤ dataChunk, 调用方保证不跨页)
  async pageProgram(addr: number, data: Uint8Array): Promise<void> {
    await this.xfer(Uint8Array.of(0x06)); // Write Enable
    const pkt = new Uint8Array(4 + data.length);
    pkt.set(Uint8Array.of(0x02, (addr >>> 16) & 0xff, (addr >>> 8) & 0xff, addr & 0xff));
    pkt.set(data, 4);
    await this.xfer(pkt);
  }

  // 启动全片擦除 (Write Enable + Chip Erase), 完成与否由调用方轮询 WIP
  async chipEraseStart(): Promise<void> {
    await this.xfer(Uint8Array.of(0x06));
    await this.xfer(Uint8Array.of(0x60));
  }
}
