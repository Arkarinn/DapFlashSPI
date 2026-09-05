// SPI-over-JTAG: 用 DAP_JTAG_Sequence 模拟 SPI (mode 0)
// 引脚映射: TCK=SCK, TMS=CS, TDI=MOSI, TDO=MISO
// JTAG 数据 LSB-first, SPI FLASH 命令 MSB-first → 每字节做位反转
import { CmsisDap, DAP_CMD, DapError, sleep } from './dap.js';

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
    // 序列个数是单字节 (≤255, 含结尾拉高段), 据此约束每次事务的数据量
    const n = Math.min(254, Math.floor((dap.pktSize - 4) / 9));
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
    seqs.push({ data: new Uint8Array([0]), tms: 1, capture: false }); // 结尾段: TMS=1 拉高 CS (1 个 TCK)
    const expect = out.length - cut;

    // 组包: [0x14][序列个数]([info][tdi...])*  (官方固件 DAP_JTAG_Sequence 格式)
    let len = 2;
    for (const s of seqs) len += 1 + s.data.length;
    const pkt = new Uint8Array(len);
    let p = 0;
    pkt[p++] = DAP_CMD.jtagSequence;
    pkt[p++] = seqs.length;
    for (const s of seqs) {
      pkt[p++] = (s.tms ? 0x40 : 0) | (s.capture ? 0x80 : 0) | ((s.data.length * 8) & 0x3f);
      pkt.set(s.data, p);
      p += s.data.length;
    }

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
    for (; ;) {
      if ((await this.readStatus() & 1) === 0) return;
      if (performance.now() - t0 > timeoutMs) throw new DapError(`等待 WIP 超时 (${timeoutMs} ms)`);
      await sleep(pollMs);
    }
  }

  // ---- 3B/4B 地址模式 ----
  // >16MB 芯片必须用 4 字节地址: 0xB7 进入 / 0xE9 退出, 并改用 4 字节命令变体 (读 0x13 / 编程 0x12)。
  // 上电默认均为 3B 模式; 个别 >256Mbit 芯片默认 4B, 对其强制发 0xB7 亦无害。
  private addr4: boolean | null = null; // null = 本会话尚未同步

  // 按芯片容量同步地址模式; 返回 null 表示无需切换, 否则返回当前是否 4B
  async syncAddressMode(sizeBytes: number): Promise<boolean | null> {
    const want4 = sizeBytes > 0x1000000;
    if (this.addr4 === want4) return null;
    if (want4 || this.addr4 === true) {
      await this.xfer(Uint8Array.of(want4 ? 0xb7 : 0xe9));
    }
    this.addr4 = want4;
    return want4;
  }

  // 地址命令头: [命令][地址 3 或 4 字节]
  private addrHeader(cmd3: number, cmd4: number, addr: number): Uint8Array {
    return this.addr4
      ? Uint8Array.of(cmd4, (addr >>> 24) & 0xff, (addr >>> 16) & 0xff, (addr >>> 8) & 0xff, addr & 0xff)
      : Uint8Array.of(cmd3, (addr >>> 16) & 0xff, (addr >>> 8) & 0xff, addr & 0xff);
  }

  // 读数据 (单次 ≤ dataChunk)
  async readData(addr: number, len: number): Promise<Uint8Array> {
    const hdr = this.addrHeader(0x03, 0x13, addr);
    const pkt = new Uint8Array(hdr.length + len);
    pkt.set(hdr);
    return this.xfer(pkt, hdr.length);
  }

  // 页编程 (单次 ≤ dataChunk, 调用方保证不跨页)
  async pageProgram(addr: number, data: Uint8Array): Promise<void> {
    await this.xfer(Uint8Array.of(0x06)); // Write Enable
    const hdr = this.addrHeader(0x02, 0x12, addr);
    const pkt = new Uint8Array(hdr.length + data.length);
    pkt.set(hdr);
    pkt.set(data, hdr.length);
    await this.xfer(pkt);
  }

  // 启动全片擦除 (Write Enable + Chip Erase), 完成与否由调用方轮询 WIP
  async chipEraseStart(): Promise<void> {
    await this.xfer(Uint8Array.of(0x06));
    await this.xfer(Uint8Array.of(0x60));
  }
}
