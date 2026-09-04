// CMSIS-DAP Flash Tool — 界面原型
// 按 TODO.md 设计; 仅实现界面与互锁, 操作函数为占位 (标注 [未实现]/[演示])
import { FLASH_DB } from './flashdb.js';
import { Dropdown } from './dropdown.js';

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
const hexView = $('hex-view');
const bufInfo = $('buf-info');
const logEl = $<HTMLElement>('log');

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

// 需要设备处于打开状态的按钮 (互锁)
const NEEDS_OPEN: HTMLButtonElement[] = [
  btn.automatch, btn.read, btn.erase, btn.blank, btn.write, btn.verify,
];

let devices: USBDevice[] = [];
let selectedIdx = -1;
let openState = false; // 界面演示状态; 实际打开/claim/连接待实现

// 演示数据: 1KB 全 0xFF (空 FLASH 常态), 后续由 读取/打开文件 填充
const BUFFER = new Uint8Array(1024).fill(0xff);

// ---------- 工具函数 ----------

const err = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const hex16 = (n: number): string => n.toString(16).padStart(4, '0').toUpperCase();
const hex8 = (n: number): string => n.toString(16).padStart(2, '0').toUpperCase();

function fmtSize(n: number): string {
  return n >= 1048576 ? `${n / 1048576} MB` : `${n / 1024} KB`;
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

    // 是否支持 JTAG/SWD: 打开后经 DAP_Info 查询 (待实现)
    for (const cap of ['JTAG ?', 'SWD ?']) {
      const c = document.createElement('span');
      c.className = 'cap';
      c.title = '打开后通过 DAP_Info 查询';
      c.textContent = cap;
      row.appendChild(c);
    }
    row.prepend(id, name);
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
  selectedIdx = Math.min(selectedIdx, devices.length - 1);
  renderDevices();
  updateUi();
}

// ---------- FLASH 操作 ----------

function renderHex(buf: Uint8Array): void {
  const table = document.createElement('table');
  table.className = 'hex';
  const head = table.createTHead().insertRow();
  for (const label of ['地址', ...Array.from({ length: 16 }, (_, i) => i.toString(16).toUpperCase())]) {
    const th = document.createElement('th');
    th.textContent = label;
    head.appendChild(th);
  }
  const body = table.createTBody();
  for (let off = 0; off < buf.length; off += 16) {
    const row = body.insertRow();
    row.insertCell().textContent = off.toString(16).padStart(8, '0').toUpperCase();
    for (let i = 0; i < 16; i++) row.insertCell().textContent = hex8(buf[off + i]!);
  }
  hexView.innerHTML = '';
  hexView.appendChild(table);
  bufInfo.textContent =
    `缓冲区 0x00000000 – 0x${(buf.length - 1).toString(16).padStart(8, '0').toUpperCase()}` +
    ` (${fmtSize(buf.length)}, 演示数据)`;
}

// ---------- 操作函数 (占位, 待实现) ----------

btn.open.onclick = () => {
  const d = devices[selectedIdx];
  if (!d || openState) return;
  openState = true;
  log(`[演示] 打开 ${devLabel(d)}: claim 接口/定位端点/DAP 连接待实现`);
  updateUi();
};

btn.close.onclick = () => {
  if (!openState) return;
  const d = devices[selectedIdx];
  openState = false;
  log(`[演示] 关闭 ${d ? devLabel(d) : ''}`);
  updateUi();
};

btn.automatch.onclick = () => {
  log(`[未实现] 自动匹配: 降至低速读取 JEDEC ID, 在型号库 (${FLASH_DB.length} 条) 中匹配并调整时钟`);
};

btn.fileOpen.onclick = () => log('[未实现] 打开文件 → 载入数据缓冲区');
btn.save.onclick = () => log('[未实现] 保存数据缓冲区 → 文件');
btn.read.onclick = () => log('[未实现] 读取: JTAG_seq 按 SPI 时序读 FLASH, 按包长自动分包');
btn.erase.onclick = () => log('[未实现] 擦除 (Chip Erase)');
btn.blank.onclick = () => log('[未实现] 查空: 检查缓冲区是否全 0xFF');
btn.write.onclick = () => log('[未实现] 写入: Page Program 按页编程');
btn.verify.onclick = () => log('[未实现] 校验: 回读与缓冲区比对');

// ---------- 界面状态 ----------

function updateUi(): void {
  const has = devices.length > 0 && selectedIdx >= 0;
  btn.open.disabled = openState || !has;
  btn.close.disabled = !openState;
  for (const b of NEEDS_OPEN) b.disabled = !openState;
  statusDot.className = openState ? 'dot ok' : 'dot err';
  const d = devices[selectedIdx];
  statusText.textContent = openState && d ? `已打开: ${devLabel(d)}` : '未打开设备';
}

// ---------- 事件绑定 ----------

if (!('usb' in navigator)) {
  log('! 当前浏览器不支持 WebUSB, 请使用 Chrome / Edge (页面需来自 HTTPS 或 localhost)。');
  throw new Error('WebUSB not supported');
}

btn.pair.onclick = async () => {
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
    if ((e as DOMException)?.name !== 'NotFoundError') log(`! 配对失败: ${err(e)}`);
  }
};

btn.refresh.onclick = () => refreshDevices();
btn.clearLog.onclick = () => {
  logEl.textContent = '';
};

navigator.usb.ondisconnect = (e: USBConnectionEvent) => {
  log(`设备移除: ${devLabel(e.device)}`);
  if (openState && devices[selectedIdx] === e.device) openState = false;
  void refreshDevices();
};
navigator.usb.onconnect = (e: USBConnectionEvent) => {
  log(`设备接入: ${devLabel(e.device)}`);
  void refreshDevices();
};

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

log('CMSIS-DAP Flash Tool 就绪 (界面原型, 操作函数为占位).');
renderHex(BUFFER);
void refreshDevices();
