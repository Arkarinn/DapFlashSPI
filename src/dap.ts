// CMSIS-DAP v2 (bulk) 传输层命令
export const DAP_CMD = {
  info: 0x00,
  hostStatus: 0x01,
  connect: 0x02,
  disconnect: 0x03,
  writeAbort: 0x08,
  delay: 0x09,
  resetTarget: 0x0a,
  swjPins: 0x10,
  swjClock: 0x11,
  swjSequence: 0x12,
  jtagSequence: 0x14,
} as const;

// DAP_Info ID
export const DAP_INFO = {
  vendor: 0x01,
  product: 0x02,
  serNum: 0x03,
  fwVer: 0x04,
  deviceVendor: 0x05,
  deviceName: 0x06,
  capabilities: 0xf0,
  packetCount: 0xfe,
  packetSize: 0xff,
} as const;

export class DapError extends Error { }

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface DapIface {
  interfaceNumber: number;
  outEp: number;
  inEp: number;
  inSize: number;
}

// 列出带 bulk In/Out 端点的接口, 优先 vendor-specific (class 0xFF), 即 CMSIS-DAP v2 接口
function listDapInterfaces(dev: USBDevice): DapIface[] {
  const out: DapIface[] = [];
  const candidates = (dev.configuration?.interfaces ?? []).flatMap((i) =>
    i.alternates.map((a) => ({ i, a })),
  );
  for (const preferVendor of [true, false]) {
    for (const { i, a } of candidates) {
      if (preferVendor !== (a.interfaceClass === 0xff)) continue;
      if (out.some((o) => o.interfaceNumber === i.interfaceNumber)) continue;
      const epOut = a.endpoints.find((e) => e.type === 'bulk' && e.direction === 'out');
      const epIn = a.endpoints.find((e) => e.type === 'bulk' && e.direction === 'in');
      if (epOut && epIn) {
        out.push({ interfaceNumber: i.interfaceNumber, outEp: epOut.endpointNumber, inEp: epIn.endpointNumber, inSize: epIn.packetSize });
      }
    }
  }
  return out;
}

export class CmsisDap {
  readonly device: USBDevice;
  pktSize: number; // DAP 命令包长 (字节), 分包依据
  private iface: DapIface;
  private lock: Promise<unknown> = Promise.resolve(); // 串行化 USB 收发
  private broken = false; // 传输超时/错误后标记, 防止继续使用

  private constructor(device: USBDevice, iface: DapIface) {
    this.device = device;
    this.iface = iface;
    this.pktSize = iface.inSize;
  }

  static async open(dev: USBDevice, log?: (s: string) => void): Promise<CmsisDap> {
    await dev.open();
    log?.('USB 已打开');
    try {
      if (!dev.configuration && dev.configurations.length > 0) {
        await dev.selectConfiguration(dev.configurations[0].configurationValue);
      }
      const list = listDapInterfaces(dev);
      if (list.length === 0) throw new DapError('未找到 bulk 输入/输出端点 (需要 CMSIS-DAP v2 固件)');
      // 逐个接口探测: claim 后用短超时 DAP_Info 验证是否为 DAP 命令接口
      let lastErr: unknown = null;
      for (const i of list) {
        try {
          await dev.claimInterface(i.interfaceNumber);
          log?.(`接口 ${i.interfaceNumber} 已占用 (OUT ep${i.outEp} / IN ep${i.inEp})`);
          const d = new CmsisDap(dev, i);
          const ps = await d.info(DAP_INFO.packetSize, 1000); // 探测
          if (ps !== null && ps >= 64) d.pktSize = ps;
          log?.(`DAP_Info 应答正常, 包长 ${d.pktSize}B`);
          return d;
        } catch (e) {
          lastErr = e;
          log?.(`接口 ${i.interfaceNumber} 不可用: ${e instanceof Error ? e.message : String(e)}`);
          try {
            await dev.releaseInterface(i.interfaceNumber);
          } catch {
            /* 忽略 */
          }
        }
      }
      throw lastErr ?? new DapError('没有可用的 DAP 接口');
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
  async cmd(req: Uint8Array<ArrayBuffer>, timeoutMs = 5000): Promise<Uint8Array> {
    if (this.broken) throw new DapError('传输已中断, 请关闭设备后重新打开');
    const p = this.lock.then(() => this.raw(req, timeoutMs));
    this.lock = p.catch(() => undefined);
    return p;
  }

  private async raw(req: Uint8Array<ArrayBuffer>, timeoutMs: number): Promise<Uint8Array> {
    if (req.length > this.pktSize) throw new DapError(`命令超出包长 (${req.length} > ${this.pktSize})`);
    try {
      const out = await this.withTimeout(this.device.transferOut(this.iface.outEp, req), timeoutMs, 'USB 发送');
      if (out.status !== 'ok') throw new DapError(`USB 发送失败: ${out.status}`);
      const inn = await this.withTimeout(this.device.transferIn(this.iface.inEp, this.pktSize), timeoutMs, 'USB 接收');
      if (inn.status !== 'ok' || !inn.data) throw new DapError(`USB 接收失败: ${inn.status}`);
      const r = new Uint8Array(inn.data.buffer, inn.data.byteOffset, inn.data.byteLength);
      if (r.length < 1) throw new DapError('DAP 空响应');
      // 响应首字节是命令 ID 回显 (官方固件 DAP.c: *response++ = *request), 校验以防失步
      if (r[0] !== req[0]) {
        throw new DapError(`DAP 响应不匹配: 发送 0x${req[0].toString(16)} 收到 0x${r[0].toString(16)}`);
      }
      return r.subarray(1);
    } catch (e) {
      // 一次失败后传输状态不可信 (可能仍有挂起的 transferIn), 标记并尝试强制关闭
      this.broken = true;
      void this.device.close().catch(() => undefined);
      throw e;
    }
  }

  private withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const id = setTimeout(() => reject(new DapError(`${what}超时 (${ms} ms), 设备无响应`)), ms);
      p.then(
        (v) => {
          clearTimeout(id);
          resolve(v);
        },
        (e) => {
          clearTimeout(id);
          reject(e);
        },
      );
    });
  }

  // DAP_Info: 数值型信息 (包长/包数/能力位), 不支持时返回 null
  async info(id: number, timeoutMs?: number): Promise<number | null> {
    const r = await this.cmd(Uint8Array.of(DAP_CMD.info, id), timeoutMs);
    if (r.length < 2 || r[0] === 0) return null;
    let v = 0;
    for (let i = 1; i <= Math.min(r[0], 4); i++) v |= r[i]! << (8 * (i - 1));
    return v;
  }

  // DAP_Info: 字符串型信息 (序列号/固件版本等), 不支持或为空时返回 null
  async infoStr(id: number, timeoutMs?: number): Promise<string | null> {
    const r = await this.cmd(Uint8Array.of(DAP_CMD.info, id), timeoutMs);
    if (r.length < 2 || r[0] === 0) return null;
    let s = '';
    for (let i = 1; i <= r[0] && i < r.length; i++) s += String.fromCharCode(r[i]!);
    s = s.trim();
    return s || null;
  }

  // 能力位: bit0=SWD, bit1=JTAG
  async getCaps(): Promise<{ swd: boolean; jtag: boolean } | null> {
    const v = await this.info(DAP_INFO.capabilities);
    if (v === null) return null;
    return { swd: !!(v & 1), jtag: !!(v & 2) };
  }

  // 多数命令 payload 首字节为 DAP_OK(0x00)/DAP_ERROR(0xFF)
  private static expectOk(r: Uint8Array, what: string): void {
    if (r.length < 1 || r[0] !== 0x00) {
      throw new DapError(`${what}失败 (0x${(r[0] ?? -1).toString(16).padStart(2, '0').toUpperCase()})`);
    }
  }

  // DAP_SWJ_Clock: 设置 TCK 频率 (Hz)
  async swjClock(hz: number): Promise<void> {
    const r = await this.cmd(
      Uint8Array.of(DAP_CMD.swjClock, hz & 0xff, (hz >>> 8) & 0xff, (hz >>> 16) & 0xff, (hz >>> 24) & 0xff),
    );
    CmsisDap.expectOk(r, '设置时钟');
  }

  // DAP_Connect: 进入 JTAG 模式 (TCK=SCK, TMS=CS, TDI=MOSI, TDO=MISO)
  async connectJtag(): Promise<void> {
    const r = await this.cmd(Uint8Array.of(0x02, 0x02));
    if (r.length < 1 || r[0] !== 0x02) throw new DapError('无法进入 JTAG 模式, 固件可能不支持 JTAG');
  }

  async disconnect(): Promise<void> {
    CmsisDap.expectOk(await this.cmd(Uint8Array.of(0x03)), '断开');
  }

  // DAP_HostStatus: connected 指示灯
  async hostStatus(on: boolean): Promise<void> {
    CmsisDap.expectOk(await this.cmd(Uint8Array.of(0x01, 0x00, on ? 1 : 0)), '指示灯');
  }

  // DAP_JTAG_Sequence: 发送预组好的序列包, 返回捕获的 TDO 数据 (前 expect 字节)
  // 响应 payload = [DAP_OK][TDO...], 请求 = [0x10][序列个数]([info][tdi...])*
  async jtagSequence(req: Uint8Array<ArrayBuffer>, expect: number): Promise<Uint8Array> {
    const r = await this.cmd(req);
    CmsisDap.expectOk(r, 'JTAG 序列');
    if (r.length < 1 + expect) throw new DapError(`JTAG 序列响应长度不足 (${r.length - 1}/${expect})`);
    return r.subarray(1, 1 + expect);
  }
}
