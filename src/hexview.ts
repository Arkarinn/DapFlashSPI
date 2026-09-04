// 大数据量十六进制视图: 虚拟滚动, 只渲染可视窗口附近的行
// 布局: 顶部占位行 + 可视行 + 底部占位行; 超大数据按比例压缩总滚动高度
export class HexView {
  private wrap: HTMLElement;
  private empty: HTMLElement;
  private table: HTMLTableElement | null = null;
  private body: HTMLTableSectionElement | null = null;
  private top: HTMLTableRowElement | null = null;
  private bottom: HTMLTableRowElement | null = null;
  private data: Uint8Array | null = null;
  private rows = 0;
  private rowH = 20; // 首次渲染后实测校准
  private raf = 0;
  private winStart = -1;
  private winCount = 0;
  private readonly MAX_SCROLL = 8_000_000; // 浏览器滚动高度上限保护

  constructor(container: HTMLElement) {
    this.wrap = container;
    this.empty = document.createElement('div');
    this.empty.className = 'dev-empty';
    this.empty.textContent = '（无数据: 选择 FLASH 型号、自动匹配或打开文件后显示）';
    container.appendChild(this.empty);
    container.addEventListener('scroll', () => {
      if (!this.raf) {
        this.raf = requestAnimationFrame(() => {
          this.raf = 0;
          this.update();
        });
      }
    });
  }

  setData(data: Uint8Array | null): void {
    this.data = data && data.length > 0 ? data : null;
    if (this.table) {
      this.table.remove();
      this.table = null;
      this.body = this.top = this.bottom = null;
    }
    this.winStart = -1;
    this.winCount = 0;
    this.wrap.scrollTop = 0;
    if (!this.data) {
      this.empty.style.display = '';
      return;
    }
    this.empty.style.display = 'none';
    this.rows = Math.ceil(this.data.length / 16);

    const t = document.createElement('table');
    t.className = 'hex';
    const head = t.createTHead().insertRow();
    for (const label of ['地址', ...Array.from({ length: 16 }, (_, i) => i.toString(16).toUpperCase())]) {
      const th = document.createElement('th');
      th.textContent = label;
      head.appendChild(th);
    }
    this.body = t.createTBody();
    this.top = this.body.insertRow();
    this.top.appendChild(spacerCell());
    this.bottom = this.body.insertRow();
    this.bottom.appendChild(spacerCell());

    this.table = t;
    this.wrap.appendChild(t);
    this.update();
  }

  private update(): void {
    const d = this.data;
    if (!d || !this.body || !this.top || !this.bottom) return;
    const total = this.rows;
    const layoutH = Math.min(total * this.rowH, this.MAX_SCROLL);
    const count = Math.max(20, Math.ceil(this.wrap.clientHeight / this.rowH) + 4);
    // 满量程映射: scrollTop 0 → 首行, 滚动到底 → 最后一行 (大数据时高度按比例压缩)
    const maxScroll = Math.max(1, this.wrap.scrollHeight - this.wrap.clientHeight);
    const first = Math.max(0, Math.min(total - 1, Math.round((this.wrap.scrollTop / maxScroll) * Math.max(0, total - count))));
    const last = Math.min(total, first + count);
    if (first === this.winStart && last - first === this.winCount) return;
    this.winStart = first;
    this.winCount = last - first;

    while (this.top.nextElementSibling && this.top.nextElementSibling !== this.bottom) {
      this.body.removeChild(this.top.nextElementSibling);
    }
    const frag = document.createDocumentFragment();
    for (let r = first; r < last; r++) {
      const tr = document.createElement('tr');
      const a = document.createElement('td');
      a.textContent = (r * 16).toString(16).padStart(8, '0').toUpperCase();
      tr.appendChild(a);
      for (let i = 0; i < 16; i++) {
        const td = document.createElement('td');
        const v = d[r * 16 + i];
        td.textContent = v === undefined ? '' : v.toString(16).padStart(2, '0').toUpperCase();
        tr.appendChild(td);
      }
      frag.appendChild(tr);
    }
    this.body.insertBefore(frag, this.bottom);

    // 用首行实测高度校准 (含边框)
    const probe = this.top.nextElementSibling;
    if (probe instanceof HTMLTableRowElement) {
      const h = probe.getBoundingClientRect().height;
      if (h > 4 && Math.abs(h - this.rowH) > 0.5) this.rowH = h;
    }
    const unit = layoutH / total; // 每行布局高度 (大数据时被压缩)
    (this.top.firstChild as HTMLElement).style.height = `${Math.round(first * unit)}px`;
    (this.bottom.firstChild as HTMLElement).style.height = `${Math.round(Math.max(0, layoutH - (first + this.winCount) * unit))}px`;
  }
}

function spacerCell(): HTMLTableCellElement {
  const td = document.createElement('td');
  td.colSpan = 17;
  td.style.padding = '0';
  td.style.border = '0';
  return td;
}
