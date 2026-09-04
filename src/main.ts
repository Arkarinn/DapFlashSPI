// CMSIS-DAP WebUSB 调试小工具
// 需 Chrome/Edge 等支持 WebUSB 的浏览器, 且页面来自 http://localhost 或 HTTPS
// 仅支持 bulk 传输 (CMSIS-DAP v2); v1 为 HID 接口, 不在本工具范围内

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`缺少元素 #${id}`);
  return el as T;
};

// 常见 CMSIS-DAP 设备, 仅用于列表标注与搜索过滤
const KNOWN_DEVICES: Array<{ vid: number; pid: number; name: string }> = [
  { vid: 0x0d28, pid: 0x0204, name: 'Arm mbed CMSIS-DAP (DAPLink)' },
  { vid: 0x03eb, pid: 0x2111, name: 'Atmel/Microchip EDBG (CMSIS-DAP)' },
  { vid: 0x1fc9, pid: 0x0143, name: 'NXP LPC-Link2 (CMSIS-DAP)' },
];

// 快捷命令 (CMSIS-DAP 命令字节, 点击填入输入框)
const PRESETS: Array<[string, string]> = [
  ['Info·固件版本', '00 04'],
  ['Info·能力', '00 F0'],
  ['Connect·SWD', '02 01'],
  ['SWJ Clock·1MHz', '08 40 42 0F 00'],
  ['ResetTarget', '06'],
];

interface Session {
  device: USBDevice;
  interfaceNumber: number;
  outEp: number;
  inEp: number;
  inSize: number;
}

let devices: USBDevice[] = [];
let session: Session | null = null;

const deviceSelect = $<HTMLSelectElement>('device-select');
const hexInput = $<HTMLInputElement>('hex-input');
const autoRecv = $<HTMLInputElement>('auto-recv');
const statusEl = $('status');
const logEl = $<HTMLElement>('log');
const presetEl = $('presets');

const buttons = {
  addDap: $<HTMLButtonElement>('btn-add-dap'),
  addAny: $<HTMLButtonElement>('btn-add-any'),
  refresh: $<HTMLButtonElement>('btn-refresh'),
  open: $<HTMLButtonElement>('btn-open'),
  close: $<HTMLButtonElement>('btn-close'),
  send: $<HTMLButtonElement>('btn-send'),
  recv: $<HTMLButtonElement>('btn-recv'),
  clearLog: $<HTMLButtonElement>('btn-clear-log'),
};

// ---------- 工具函数 ----------

const err = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');

const hex16 = (n: number): string => n.toString(16).padStart(4, '0').toUpperCase();

function parseHex(text: string): Uint8Array<ArrayBuffer> {
  // 允许空格/逗号/冒号分隔, "0x" 前缀, 以及 "0004" 这类连续偶数位写法
  const tokens = text.replace(/0[xX]/g, ' ').split(/[^0-9a-fA-F]+/).filter((t) => t.length > 0);
  const bytes: number[] = [];
  for (const t of tokens) {
    if (t.length % 2 !== 0) throw new Error(`无效 hex 片段 "${t}" (位数须为偶数)`);
    for (let i = 0; i < t.length; i += 2) bytes.push(parseInt(t.slice(i, i + 2), 16));
  }
  if (bytes.length === 0) throw new Error('请输入要发送的 hex 字节');
  if (bytes.length > 1024) throw new Error('数据过长 (超过 1024 字节)');
  return new Uint8Array(bytes);
}

function label(dev: USBDevice): string {
  const known = KNOWN_DEVICES.find((k) => k.vid === dev.vendorId && k.pid === dev.productId);
  return `${dev.productName || '未知设备'} [${hex16(dev.vendorId)}:${hex16(dev.productId)}]${known ? ` · ${known.name}` : ''}`;
}

function log(msg: string): void {
  const t = new Date();
  const p = (n: number, w: number) => String(n).padStart(w, '0');
  const ts = `${p(t.getHours(), 2)}:${p(t.getMinutes(), 2)}:${p(t.getSeconds(), 2)}.${p(t.getMilliseconds(), 3)}`;
  logEl.textContent = `${logEl.textContent ?? ''}${ts}  ${msg}\n`.slice(-65536);
  logEl.scrollTop = logEl.scrollHeight;
}

function updateUi(): void {
  const dev = devices[deviceSelect.selectedIndex];
  buttons.open.disabled = session !== null || !dev;
  buttons.close.disabled = session === null;
  buttons.send.disabled = session === null;
  buttons.recv.disabled = session === null;
  if (session) {
    statusEl.textContent = `已连接: ${label(session.device)} · 接口 ${session.interfaceNumber} (OUT ep${session.outEp} / IN ep${session.inEp})`;
    statusEl.className = 'ok';
  } else {
    statusEl.textContent = '未打开设备';
    statusEl.className = '';
  }
}

// ---------- 设备列表 ----------

async function refreshDeviceList(): Promise<void> {
  devices = await navigator.usb.getDevices();
  const prev = deviceSelect.selectedIndex;
  deviceSelect.innerHTML = '';
  if (devices.length === 0) {
    const opt = document.createElement('option');
    opt.textContent = '(无已授权设备, 请点击下方"添加设备")';
    opt.disabled = true;
    deviceSelect.appendChild(opt);
  } else {
    for (const d of devices) {
      const opt = document.createElement('option');
      opt.textContent = label(d);
      deviceSelect.appendChild(opt);
    }
    deviceSelect.selectedIndex = Math.max(0, Math.min(prev, devices.length - 1));
  }
  updateUi();
}

async function addDevice(filters: USBDeviceFilter[]): Promise<void> {
  try {
    const dev = await navigator.usb.requestDevice({ filters });
    log(`已授权: ${label(dev)}`);
    await refreshDeviceList();
    const idx = devices.findIndex(
      (d) => d === dev || (d.vendorId === dev.vendorId && d.productId === dev.productId && d.serialNumber === dev.serialNumber),
    );
    if (idx >= 0) deviceSelect.selectedIndex = idx;
  } catch (e) {
    if ((e as DOMException)?.name === 'NotFoundError') return; // 用户取消了浏览器弹窗
    log(`! 添加设备失败: ${err(e)}`);
  }
  updateUi();
}

// ---------- 打开 / 关闭 ----------

// 寻找带 bulk In/Out 端点的接口, 优先 vendor-specific (class 0xFF), 即 CMSIS-DAP v2 接口
function findDapInterface(dev: USBDevice): Omit<Session, 'device'> | null {
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

async function openSelected(): Promise<void> {
  const dev = devices[deviceSelect.selectedIndex];
  if (!dev || session) return;
  try {
    log(`正在打开 ${label(dev)} …`);
    await dev.open();
    if (!dev.configuration && dev.configurations.length > 0) {
      await dev.selectConfiguration(dev.configurations[0].configurationValue);
    }
    const iface = findDapInterface(dev);
    if (!iface) throw new Error('未找到带 bulk 输入/输出端点的接口 (需要 CMSIS-DAP v2 固件)');
    await dev.claimInterface(iface.interfaceNumber);
    session = { device: dev, ...iface };
    log(`已打开: 接口 ${iface.interfaceNumber}, OUT ep${iface.outEp}, IN ep${iface.inEp} (包长 ${iface.inSize})`);
  } catch (e) {
    try {
      await dev.close();
    } catch {
      /* 忽略 */
    }
    session = null;
    log(`! 打开失败: ${err(e)} (Windows 下 claim 失败通常是缺少 WinUSB 驱动, 见 README)`);
  }
  updateUi();
}

async function closeSession(): Promise<void> {
  if (!session) return;
  const dev = session.device;
  session = null;
  try {
    await dev.close();
    log('设备已关闭');
  } catch (e) {
    log(`! 关闭出错: ${err(e)}`);
  }
  updateUi();
}

// ---------- 收发 ----------

async function doSend(): Promise<void> {
  if (!session) return log('! 未打开设备');
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = parseHex(hexInput.value);
  } catch (e) {
    return log(`! ${err(e)}`);
  }
  try {
    await session.device.transferOut(session.outEp, bytes);
    log(`TX> ${hex(bytes)}`);
    if (autoRecv.checked) await doRecv();
  } catch (e) {
    log(`! 发送失败: ${err(e)}`);
  }
}

async function doRecv(): Promise<void> {
  if (!session) return log('! 未打开设备');
  try {
    const r = await session.device.transferIn(session.inEp, session.inSize);
    if (r.status !== 'ok') return log(`! 接收异常: ${r.status}`);
    if (!r.data) return log('RX< (无数据)');
    const bytes = new Uint8Array(r.data.buffer, r.data.byteOffset, r.data.byteLength);
    log(bytes.length === 0 ? 'RX< (空包)' : `RX< ${hex(bytes)}`);
  } catch (e) {
    log(`! 接收失败: ${err(e)}`);
  }
}

// ---------- 事件绑定 ----------

if (!('usb' in navigator)) {
  log('! 当前浏览器不支持 WebUSB, 请使用 Chrome / Edge (页面需来自 HTTPS 或 localhost)。');
  throw new Error('WebUSB not supported');
}

buttons.addDap.onclick = () => addDevice(KNOWN_DEVICES.map((k) => ({ vendorId: k.vid, productId: k.pid })));
buttons.addAny.onclick = () => addDevice([]);
buttons.refresh.onclick = () => refreshDeviceList();
buttons.open.onclick = openSelected;
buttons.close.onclick = closeSession;
buttons.send.onclick = doSend;
buttons.recv.onclick = doRecv;
buttons.clearLog.onclick = () => {
  logEl.textContent = '';
};
hexInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doSend();
});
deviceSelect.addEventListener('change', updateUi);

navigator.usb.ondisconnect = (e: USBConnectionEvent) => {
  if (session && e.device === session.device) {
    session = null;
    log('! 当前设备已被拔出');
  }
  refreshDeviceList();
};
navigator.usb.onconnect = () => {
  log('检测到 USB 设备接入');
  refreshDeviceList();
};

for (const [name, data] of PRESETS) {
  const b = document.createElement('button');
  b.textContent = name;
  b.className = 'preset';
  b.title = data;
  b.onclick = () => {
    hexInput.value = data;
  };
  presetEl.appendChild(b);
}

log('就绪. 请先"添加设备"并授权, 再选择并打开 (需 Chrome/Edge 浏览器).');
void refreshDeviceList();
