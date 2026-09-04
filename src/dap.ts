// CMSIS-DAP v2 (bulk) 传输层: 打开设备、收发命令包
export class DapError extends Error {}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface DapIface {
  interfaceNumber: number;
  outEp: number;
  inEp: number;
  inSize: number;
}

// 寻找带 bulk In/Out 端点的接口, 优先 vendor-specific (class 0xFF), 即 CMSIS-DAP v2 接口
function findDapInterface(dev: USBDevice): DapIface | null {
  const candidates = (dev.configuration?.interfaces ?? []).flatMap((i) =>
    i.alternates.map((a) => ({ i, a })),
  );
  for (const preferVendor of [true, false]) {
    for (const { i, a } of candidates) {
      if (preferVendor && a.interfaceClass !== 0xff) continue;
      const out = a.endpoints.find((e) => e.type === 'bulk' && e.direction === 'out');
      const inn = a.endpoints.find((e) => e.type === 'bulk' && e.direction === 'in');
      if (out && inn) {
        return { interfaceNumber: i.interfaceNumber, outEp: out.endpointNumber, inEp: inn.endpointNumber, inSize: inn.packetSize };
      }
    }
  }
  return null;
}

export class CmsisDap {
  readonly device: USBDevice;
  pktSize: number; // DAP 命令包长 (字节), 分包依据
  private iface: DapIface;
  private lock: Promise<unknown> = Promise.resolve(); // 串行化 USB 收发

  private constructor(device: USBDevice, iface: DapIface) {
    this.device = device;
    this.iface = iface;
    this.pktSize = iface.inSize;
  }

  static async open(dev: USBDevice): Promise<CmsisDap> {
    await dev.open();
    try {
      if (!dev.configuration && dev.configurations.length > 0) {
        await dev.selectConfiguration(dev.configurations[0].configurationValue);
      }
      const i = findDapInterface(dev);
      if (!i) throw new DapError('未找到 bulk 输入/输出端点 (需要 CMSIS-DAP v2 固件)');
      await dev.claimInterface(i.interfaceNumber);
      const d = new CmsisDap(dev, i);
      const ps = await d.info(0xff); // DAP_Info: 包长
      if (ps !== null && ps >= 64) d.pktSize = ps;
      return d;
    } catch (e) {
      try {
        await dev.close();
      } catch {
        /* 忽略 */
      }
      throw e;
    }
  }

  // 发送一条命令包, 返回去掉状态字节后的响应 (状态非 0 视为错误)
  async cmd(req: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
    const p = this.lock.then(() => this.raw(req));
    this.lock = p.catch(() => undefined);
    return p;
  }

  private async raw(req: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
    if (req.length > this.pktSize) throw new DapError(`命令超出包长 (${req.length} > ${this.pktSize})`);
    const out = await this.device.transferOut(this.iface.outEp, req);
    if (out.status !== 'ok') throw new DapError(`USB 发送失败: ${out.status}`);
    const inn = await this.device.transferIn(this.iface.inEp, this.iface.inSize);
    if (inn.status !== 'ok' || !inn.data) throw new DapError(`USB 接收失败: ${inn.status}`);
    const r = new Uint8Array(inn.data.buffer, inn.data.byteOffset, inn.data.byteLength);
    if (r.length < 1) throw new DapError('DAP 空响应');
    if (r[0] !== 0x00) throw new DapError(`DAP 错误 0x${r[0].toString(16).padStart(2, '0').toUpperCase()}`);
    return r.subarray(1);
  }

  // DAP_Info: 数值型信息 (包长/包数/能力位), 不支持时返回 null
  async info(id: number): Promise<number | null> {
    const r = await this.cmd(Uint8Array.of(0x00, id));
    if (r.length < 2 || r[0] === 0) return null;
    let v = 0;
    for (let i = 1; i <= Math.min(r[0], 4); i++) v |= r[i]! << (8 * (i - 1));
    return v;
  }

  // 能力位 (0xF0): bit0=SWD, bit1=JTAG
  async getCaps(): Promise<{ swd: boolean; jtag: boolean } | null> {
    const v = await this.info(0xf0);
    if (v === null) return null;
    return { swd: !!(v & 1), jtag: !!(v & 2) };
  }

  // DAP_SWJ_Clock: 设置 TCK 频率 (Hz)
  async swjClock(hz: number): Promise<void> {
    await this.cmd(
      Uint8Array.of(0x08, hz & 0xff, (hz >>> 8) & 0xff, (hz >>> 16) & 0xff, (hz >>> 24) & 0xff),
    );
  }

  // DAP_Connect: 进入 JTAG 模式 (TCK=SCK, TMS=CS, TDI=MOSI, TDO=MISO)
  async connectJtag(): Promise<void> {
    const r = await this.cmd(Uint8Array.of(0x02, 0x02));
    if (r.length < 1 || r[0] !== 0x02) throw new DapError('无法进入 JTAG 模式 (固件可能不支持 JTAG)');
  }

  async disconnect(): Promise<void> {
    await this.cmd(Uint8Array.of(0x03));
  }

  // DAP_HostStatus: connected 指示灯
  async hostStatus(on: boolean): Promise<void> {
    await this.cmd(Uint8Array.of(0x01, 0x00, on ? 1 : 0));
  }

  // DAP_JTAG_Sequence: 发送预组好的序列包, 返回捕获的 TDO 数据 (前 expect 字节)
  async jtagSequence(req: Uint8Array<ArrayBuffer>, expect: number): Promise<Uint8Array> {
    const r = await this.cmd(req);
    if (r.length < expect) throw new DapError(`JTAG 序列响应不足 (${r.length}/${expect})`);
    return r.subarray(0, expect);
  }
}
