// CMSIS-DAP Flash Tool
// 设备管理 (WebUSB) + FLASH 操作 (JTAG 模拟 SPI): 读取/擦除/查空/写入/校验/自动匹配
import { FLASH_DB, FlashInfo } from './flashdb.js';
import { Dropdown } from './dropdown.js';
import { CmsisDap, DapError, sleep } from './dap.js';
import { SpiFlash } from './spiflash.js';
import { HexView } from './hexview.js';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`缺少元素 #${id}`);
  return el as T;
};

const deviceListEl = $('device-list');
const statusDot = $('status-dot');
const statusText = $('status-text');
const clkDd = new Dropdown($('clk-dd'));
const flashDd = new Dropdown($('flash-dd'));
const bufInfo = $('buf-info');
const logEl = $<HTMLElement>('log');
const fileInput = $<HTMLInputElement>('file-input');
const hex = new HexView($('hex-view'));

const btn = {
  pair: $<HTMLButtonElement>('btn-pair'),
  refresh: $<HTMLButtonElement>('btn-refresh'),
  open: $<HTMLButtonElement>('btn-open'),
  close: $<HTMLButtonElement>('btn-close'),
  automatch: $<HTMLButtonElement>('btn-automatch'),
  fileOpen: $<HTMLButtonElement>('btn-file-open'),
  save: $<HTMLButtonElement>('btn-save'),
  read: $<HTMLButtonElement>('btn-read'),
  erase: $<HTMLButtonElement>('btn-erase'),
  blank: $<HTMLButtonElement>('btn-blank'),
  write: $<HTMLButtonElement>('btn-write'),
  verify: $<HTMLButtonElement>('btn-verify'),
  clearLog: $<HTMLButtonElement>('btn-clear-log'),
};

const PAGE_SIZE = 256;
const CHIP_ERASE_TIMEOUT_MS = 300_000; // 大容量芯片全片擦除最长可达数分钟
const PAGE_PROG_TIMEOUT_MS = 200;

let devices: USBDevice[] = [];
let selectedIdx = -1;
let dap: CmsisDap | null = null;
let spi: SpiFlash | null = null;
let flashInfo: FlashInfo | null = null;
let buffer: Uint8Array<ArrayBuffer> | null = null;
let busy = false;
let abort = false;
const capsMap = new Map<USBDevice, { jtag?: boolean; swd?: boolean }>();

// ---------- 工具函数 ----------

const err = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const hex16 = (n: number): string => n.toString(16).padStart(4, '0').toUpperCase();

function fmtSize(n: number): string {
  return n >= 1048576 ? `${(n / 1048576).toFixed(n % 1048576 === 0 ? 0 : 1)} MB` : `${(n / 1024).toFixed(0)} KB`;
}

function devLabel(d: USBDevice): string {
  return `${d.productName || '未命名设备'} [${hex16(d.vendorId)}:${hex16(d.productId)}]`;
}

function log(msg: string): void {
  const t = new Date();
  const p = (n: number, w: number) => String(n).padStart(w, '0');
  const ts = `${p(t.getHours(), 2)}:${p(t.getMinutes(), 2)}:${p(t.getSeconds(), 2)}.${p(t.getMilliseconds(), 3)}`;
  logEl.textContent = `${logEl.textContent ?? ''}${ts}  ${msg}\n`.slice(-65536);
  logEl.scrollTop = logEl.scrollHeight;
}

function checkAbort(): void {
  if (abort) throw new Error('已取消');
}

function makeProgress(total: number, what: string): (done: number) => void {
  const t0 = performance.now();
  let lastPct = -100;
  return (done: number) => {
    const pct = total > 0 ? Math.floor((done / total) * 100) : 100;
    if (pct >= lastPct + 5 || done >= total) {
      lastPct = pct;
      const dt = (performance.now() - t0) / 1000;
      log(
        dt > 0.3
          ? `${what}: ${fmtSize(done)} / ${fmtSize(total)} (${pct}%, ${dt.toFixed(1)}s, ${(done / 1024 / dt).toFixed(0)} KB/s)`
          : `${what}: ${fmtSize(done)} / ${fmtSize(total)} (${pct}%)`,
      );
    }
  };
}

// ---------- 界面状态 ----------

function clkLabel(): string {
  return clkDd.option?.label ?? '';
}

function updateUi(): void {
  const opened = dap !== null;
  const hasSel = devices.length > 0 && selectedIdx >= 0;
  // 忙态硬禁用; 其余状态只做视觉变暗 (dim), 点击时由处理器给出具体日志提示
  const lockables = [btn.pair, btn.refresh, btn.open, btn.close, btn.automatch, btn.read, btn.erase, btn.blank, btn.write, btn.verify, btn.fileOpen, btn.save];
  for (const b of lockables) b.disabled = busy;
  const dim = (b: HTMLButtonElement, on: boolean) => b.classList.toggle('dim', on);
  dim(btn.pair, opened);
  dim(btn.open, opened || !hasSel);
  dim(btn.close, !opened);
  dim(btn.automatch, !opened);
  for (const b of [btn.read, btn.erase, btn.blank]) dim(b, !opened || !flashInfo);
  for (const b of [btn.write, btn.verify]) dim(b, !opened || !flashInfo || !buffer);
  dim(btn.save, !buffer);
  statusDot.className = 'dot ' + (opened ? (busy ? 'warn' : 'ok') : 'err');
  statusText.textContent = opened
    ? `已打开: ${devLabel(dap!.device)} · 包 ${dap!.pktSize}B${flashInfo ? ` · ${flashInfo.model}` : ''}${busy ? ' · 操作中…' : ''}`
    : busy
      ? '操作进行中…'
      : '未打开设备';
}

function updateBufInfo(): void {
  bufInfo.textContent = buffer
    ? `缓冲区 0x00000000 – 0x${(buffer.length - 1).toString(16).padStart(8, '0').toUpperCase()} (${fmtSize(buffer.length)})`
    : '缓冲区为空';
}

function allocBuffer(size: number, reason: string): void {
  if (buffer && buffer.length === size) return;
  buffer = new Uint8Array(size).fill(0xff);
  hex.setData(buffer);
  updateBufInfo();
  log(`${reason}: 缓冲区 ${fmtSize(size)} (0xFF)`);
}

// ---------- 设备管理 ----------

function renderDevices(): void {
  deviceListEl.innerHTML = '';
  if (devices.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'dev-empty';
    empty.textContent = '(无已配对设备, 点击"配对"添加)';
    deviceListEl.appendChild(empty);
    return;
  }
  devices.forEach((d, i) => {
    const row = document.createElement('div');
    row.className = 'dev-item' + (i === selectedIdx ? ' selected' : '');

    const name = document.createElement('span');
    name.className = 'dev-name';
    name.textContent = d.productName || '未命名设备';

    const id = document.createElement('span');
    id.className = 'dev-id';
    id.textContent = `${hex16(d.vendorId)}:${hex16(d.productId)}`;

    row.append(id, name);
    const caps = capsMap.get(d);
    for (const [nm, ok] of [
      ['JTAG', caps?.jtag],
      ['SWD', caps?.swd],
    ] as const) {
      const c = document.createElement('span');
      c.className = 'cap' + (ok === false ? ' no' : '');
      c.title = ok === undefined ? '打开设备后通过 DAP_Info 查询' : '';
      c.textContent = `${nm} ${ok === undefined ? '?' : ok ? '✓' : '✗'}`;
      row.appendChild(c);
    }
    row.onclick = () => {
      selectedIdx = i;
      renderDevices();
      updateUi();
    };
    deviceListEl.appendChild(row);
  });
}

async function refreshDevices(): Promise<void> {
  devices = await navigator.usb.getDevices();
  if (selectedIdx >= devices.length) selectedIdx = devices.length - 1;
  if (selectedIdx < 0 && devices.length > 0) selectedIdx = 0; // 页面加载后自动选中首个设备
  renderDevices();
  updateUi();
}

async function opOpen(): Promise<void> {
  const dev = devices[selectedIdx];
  if (!dev) throw new Error('未选择设备');
  log(`正在打开 ${devLabel(dev)} …`);
  try {
    dap = await CmsisDap.open(dev, (s) => log(`  · ${s}`));
    log('  · 设置 SWJ 时钟 …');
    await dap.swjClock(Number(clkDd.option?.value ?? 10000) * 1000);
    log('  · 连接 JTAG …');
    await dap.connectJtag();
    // 不主动查询能力位 (DAP_Info 0xF0): 个别固件会因此复位;
    // JTAG 支持以连接成功为准, SWD 保持未知
    capsMap.set(dev, { jtag: true });
    renderDevices();
    try {
      await dap.hostStatus(true); // LED 指示, 纯装饰, 失败不影响
    } catch {
      /* 忽略 */
    }
    spi = new SpiFlash(dap);
    log(`已就绪: 包长 ${dap.pktSize}B, 单次事务 ${spi.dataChunk}B, JTAG 已连接, ${clkLabel()}`);
  } catch (e) {
    if (dap) {
      try {
        await dap.device.close();
      } catch {
        /* 忽略 */
      }
    }
    dap = null;
    spi = null;
    const msg = err(e);
    const hint = /claim|denied|busy/i.test(msg)
      ? ' — 设备可能被其他程序占用 (如正在调试的 Keil/IDE), 或接口缺少 WinUSB 驱动 (见 README)'
      : msg.includes('超时')
        ? ' — 设备接受了请求但无应答, 可尝试重新插拔'
        : '';
    log(`! 打开失败: ${msg}${hint}`);
  }
  updateUi();
}

async function opClose(): Promise<void> {
  if (!dap) throw new Error('设备未打开');
  const dev = dap.device;
  try {
    await dap.disconnect();
    await dap.hostStatus(false);
    await dev.close();
    log('设备已关闭');
  } catch (e) {
    log(`! 关闭出错: ${err(e)}`);
    try {
      await dev.close();
    } catch {
      /* 忽略 */
    }
  }
  dap = null;
  spi = null;
  updateUi();
}

// ---------- FLASH 操作 ----------

function requireSpi(): SpiFlash {
  if (!spi) throw new Error('设备未打开');
  return spi;
}

function requireFlash(): { spi: SpiFlash; model: FlashInfo } {
  const s = requireSpi();
  if (!flashInfo) throw new Error('请先选择 FLASH 型号 (或使用自动匹配)');
  return { spi: s, model: flashInfo };
}

async function applyClock(): Promise<void> {
  await requireSpi().dap.swjClock(Number(clkDd.option?.value ?? 10000) * 1000);
  log(`SWJ 时钟: ${clkLabel()}`);
}

async function onFlashSelected(value: string): Promise<void> {
  if (value === '') {
    flashInfo = null;
    log('未选择 FLASH 型号');
  } else {
    flashInfo = FLASH_DB[Number(value)] ?? null;
    if (flashInfo) {
      allocBuffer(flashInfo.sizeBytes, `型号 ${flashInfo.vendor} ${flashInfo.model} (${fmtSize(flashInfo.sizeBytes)})`);
    }
  }
  updateUi();
}

async function opAutomatch(): Promise<void> {
  const s = requireSpi();
  await s.dap.swjClock(100_000);
  log('自动匹配: 时钟降至 100 kHz, 唤醒 FLASH …');
  await s.wake();
  const id = await s.readJedec();
  const idStr = id.toString(16).padStart(6, '0').toUpperCase();
  const m = FLASH_DB.find((f) => f.jedecId === id);
  if (m) {
    flashDd.select(FLASH_DB.indexOf(m) + 1, false);
    await onFlashSelected(String(FLASH_DB.indexOf(m)));
    await applyClock();
    log(`自动匹配成功: JEDEC ${idStr} → ${m.vendor} ${m.model}, 时钟已恢复`);
  } else {
    await applyClock();
    log(`! JEDEC ID ${idStr} 未在型号库中找到 (可在 src/flashdb.ts 中补充)`);
  }
}

async function opRead(): Promise<void> {
  const { spi: s, model } = requireFlash();
  allocBuffer(model.sizeBytes, `读取 ${model.model}`);
  const buf = buffer!;
  const prog = makeProgress(buf.length, '读取');
  let addr = 0;
  while (addr < buf.length) {
    checkAbort();
    const n = Math.min(s.dataChunk, buf.length - addr);
    buf.set(await s.readData(addr, n), addr);
    addr += n;
    prog(addr);
  }
  hex.setData(buf);
  log(`读取完成: ${fmtSize(buf.length)}`);
}

async function opErase(): Promise<void> {
  const { spi: s, model } = requireFlash();
  log(`全片擦除 ${model.model} (最长可至数分钟, Esc 可停止轮询)…`);
  await s.chipEraseStart();
  const t0 = performance.now();
  let tick = 0;
  for (;;) {
    checkAbort();
    if ((await s.readStatus() & 1) === 0) break;
    if (performance.now() - t0 > CHIP_ERASE_TIMEOUT_MS) throw new DapError('擦除超时 (WIP 仍为忙)');
    await sleep(250);
    if (++tick % 20 === 0) log(`擦除中… ${((performance.now() - t0) / 1000).toFixed(0)}s`);
  }
  log(`擦除完成 (${((performance.now() - t0) / 1000).toFixed(1)}s)`);
}

async function opBlank(): Promise<void> {
  const { spi: s, model } = requireFlash();
  const prog = makeProgress(model.sizeBytes, '查空');
  let addr = 0;
  let bad = -1;
  let badVal = 0;
  while (addr < model.sizeBytes) {
    checkAbort();
    const n = Math.min(s.dataChunk, model.sizeBytes - addr);
    const r = await s.readData(addr, n);
    for (let i = 0; i < n; i++) {
      if (r[i] !== 0xff) {
        bad = addr + i;
        badVal = r[i]!;
        break;
      }
    }
    if (bad >= 0) break;
    addr += n;
    prog(addr);
  }
  log(
    bad < 0
      ? '查空通过: 全片 0xFF'
      : `! 查空失败: 0x${bad.toString(16).padStart(8, '0').toUpperCase()} 处为 0x${badVal.toString(16).padStart(2, '0').toUpperCase()}`,
  );
}

async function opWrite(): Promise<void> {
  const { spi: s } = requireFlash();
  const buf = buffer!;
  const pages = Math.ceil(buf.length / PAGE_SIZE);
  const prog = makeProgress(buf.length, '写入');
  let written = 0;
  let skipped = 0;
  for (let p = 0; p < pages; p++) {
    checkAbort();
    const page = buf.subarray(p * PAGE_SIZE, Math.min((p + 1) * PAGE_SIZE, buf.length));
    let ff = true;
    for (const b of page) {
      if (b !== 0xff) {
        ff = false;
        break;
      }
    }
    if (ff) {
      skipped++;
    } else {
      for (let off = 0; off < page.length; off += s.dataChunk) {
        checkAbort();
        await s.pageProgram(p * PAGE_SIZE + off, page.subarray(off, Math.min(off + s.dataChunk, page.length)));
        await s.waitWip(PAGE_PROG_TIMEOUT_MS, 5);
      }
      written++;
    }
    prog((p + 1) * PAGE_SIZE > buf.length ? buf.length : (p + 1) * PAGE_SIZE);
  }
  log(`写入完成: ${written} 页写入, ${skipped} 页全 0xFF 跳过`);
}

async function opVerify(): Promise<void> {
  const { spi: s } = requireFlash();
  const buf = buffer!;
  const prog = makeProgress(buf.length, '校验');
  const diffs: number[] = [];
  let addr = 0;
  while (addr < buf.length) {
    checkAbort();
    const n = Math.min(s.dataChunk, buf.length - addr);
    const r = await s.readData(addr, n);
    for (let i = 0; i < n; i++) {
      if (r[i] !== buf[addr + i] && diffs.length < 8) diffs.push(addr + i);
    }
    addr += n;
    prog(addr);
    if (diffs.length >= 8) break;
  }
  if (diffs.length === 0) {
    log(`校验通过: ${fmtSize(buf.length)} 全部一致`);
  } else {
    log(`! 校验失败, 首个差异 @ 0x${diffs[0]!.toString(16).padStart(8, '0').toUpperCase()} (期望 ${buf[diffs[0]!]!.toString(16).padStart(2, '0').toUpperCase()})`);
  }
}

async function runOp(name: string, fn: () => Promise<void>): Promise<void> {
  if (busy) return;
  busy = true;
  abort = false;
  updateUi();
  try {
    await fn();
  } catch (e) {
    log(`! ${name}: ${err(e)}`);
  } finally {
    busy = false;
    updateUi();
  }
}

// ---------- 文件 ----------

fileInput.addEventListener('change', async () => {
  const f = fileInput.files?.[0];
  fileInput.value = '';
  if (!f || busy) return;
  try {
    const data = new Uint8Array(await f.arrayBuffer());
    if (flashInfo && data.length > flashInfo.sizeBytes) {
      log(`! 文件 ${fmtSize(data.length)} 超过 ${flashInfo.model} 容量 ${fmtSize(flashInfo.sizeBytes)}`);
      return;
    }
    buffer = data;
    hex.setData(buffer);
    updateBufInfo();
    log(`已载入 ${f.name} (${fmtSize(data.length)})`);
    updateUi();
  } catch (e) {
    log(`! 读取文件失败: ${err(e)}`);
  }
});

function saveBuffer(): void {
  if (!buffer) return;
  const t = new Date();
  const p = (n: number, w: number) => String(n).padStart(w, '0');
  const name = `flash_${t.getFullYear()}${p(t.getMonth() + 1, 2)}${p(t.getDate(), 2)}_${p(t.getHours(), 2)}${p(t.getMinutes(), 2)}${p(t.getSeconds(), 2)}.bin`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([buffer], { type: 'application/octet-stream' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  log(`已保存 ${name} (${fmtSize(buffer.length)})`);
}

// ---------- 事件绑定 ----------

if (!('usb' in navigator)) {
  log('! 当前浏览器不支持 WebUSB, 请使用 Chrome / Edge (页面需来自 HTTPS 或 localhost)。');
  throw new Error('WebUSB not supported');
}

btn.pair.onclick = async () => {
  if (busy) return;
  if (dap) return log('! 设备已打开, 请先关闭');
  try {
    const d = await navigator.usb.requestDevice({ filters: [] });
    log(`已配对: ${devLabel(d)}`);
    await refreshDevices();
    const idx = devices.findIndex(
      (x) => x === d || (x.vendorId === d.vendorId && x.productId === d.productId && x.serialNumber === d.serialNumber),
    );
    if (idx >= 0) {
      selectedIdx = idx;
      renderDevices();
      updateUi();
    }
  } catch (e) {
    if ((e as DOMException)?.name === 'NotFoundError') {
      log('! 未选择设备 (若未弹出选择框: 内嵌浏览器不支持 USB 授权, 请改用 Chrome 或 Edge)');
      return;
    }
    log(`! 配对失败: ${err(e)}`);
  }
};

btn.refresh.onclick = () => {
  if (!busy) void refreshDevices();
};
btn.open.onclick = () => {
  if (busy) return;
  if (dap) return log('! 设备已处于打开状态');
  if (!devices[selectedIdx]) return log('! 未选择设备: 请先点击"配对"授权并选中列表中的设备 (授权弹窗需 Chrome / Edge)');
  runOp('打开设备', opOpen);
};
btn.close.onclick = () => {
  if (busy || !dap) {
    if (!busy && !dap) log('! 设备未打开');
    return;
  }
  runOp('关闭设备', opClose);
};
btn.automatch.onclick = () => {
  if (busy) return;
  if (!dap) return log('! 请先打开设备');
  runOp('自动匹配', opAutomatch);
};
// 返回 true 表示不满足条件 (busy 时静默, 其余情况已输出日志说明原因)
const devGuard = (): boolean => {
  if (busy) return true;
  if (!dap) {
    log('! 请先打开设备');
    return true;
  }
  return false;
};
const modelGuard = (): boolean => {
  if (!flashInfo) {
    log('! 请先选择 FLASH 型号 (或使用自动匹配)');
    return true;
  }
  return false;
};
btn.read.onclick = () => { if (devGuard() || modelGuard()) return; runOp('读取', opRead); };
btn.erase.onclick = () => { if (devGuard() || modelGuard()) return; runOp('擦除', opErase); };
btn.blank.onclick = () => { if (devGuard() || modelGuard()) return; runOp('查空', opBlank); };
btn.write.onclick = () => {
  if (devGuard() || modelGuard()) return;
  if (!buffer) return log('! 缓冲区为空: 请先读取 FLASH 或打开文件');
  runOp('写入', opWrite);
};
btn.verify.onclick = () => {
  if (devGuard() || modelGuard()) return;
  if (!buffer) return log('! 缓冲区为空: 请先读取 FLASH 或打开文件');
  runOp('校验', opVerify);
};
btn.fileOpen.onclick = () => {
  if (!busy) fileInput.click();
};
btn.save.onclick = () => {
  if (busy) return;
  if (!buffer) return log('! 缓冲区为空: 请先读取 FLASH 或打开文件');
  saveBuffer();
};
btn.clearLog.onclick = () => {
  logEl.textContent = '';
};

clkDd.onchange = () => {
  if (dap && !busy) void applyClock().catch((e) => log(`! ${err(e)}`));
};
flashDd.onchange = (o) => {
  void onFlashSelected(o.value).catch((e) => log(`! ${err(e)}`));
};

navigator.usb.ondisconnect = (e: USBConnectionEvent) => {
  log(`设备移除: ${devLabel(e.device)}`);
  if (dap && e.device === dap.device) {
    dap = null;
    spi = null;
    log('! 当前设备已被拔出');
  }
  void refreshDevices();
};
navigator.usb.onconnect = (e: USBConnectionEvent) => {
  log(`设备接入: ${devLabel(e.device)}`);
  void refreshDevices();
};

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && busy) {
    abort = true;
    log('收到取消请求, 正在停止…');
  }
});

// ---------- 初始化 ----------

clkDd.setOptions(
  [
    { value: '100', label: '100 kHz' },
    { value: '500', label: '500 kHz' },
    { value: '1000', label: '1 MHz' },
    { value: '2000', label: '2 MHz' },
    { value: '5000', label: '5 MHz' },
    { value: '10000', label: '10 MHz' },
    { value: '20000', label: '20 MHz' },
  ],
  '10000',
);

flashDd.setOptions([
  { value: '', label: '（请选择 FLASH 型号）' },
  ...FLASH_DB.map((f, i) => ({
    value: String(i),
    label: `${f.vendor} ${f.model} · ${fmtSize(f.sizeBytes)} · JEDEC ${f.jedecId.toString(16).padStart(6, '0').toUpperCase()}`,
  })),
]);

log('CMSIS-DAP Flash Tool 就绪.');
updateBufInfo();
void refreshDevices().then(() => {
  if (devices.length === 0) log('提示: 尚无已授权设备, 请点击"配对"并在浏览器弹窗中选择设备 (推荐 Chrome / Edge).');
});
