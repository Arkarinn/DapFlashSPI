// 轻量自绘下拉框: 原生 <select> 的弹层在 Electron/WebView 环境 (高 DPI) 下渲染异常, 故自绘
// 支持可选的关键字过滤 (大量选项时使用)
export interface DdOption {
  value: string;
  label: string;
}

export interface DropdownConfig {
  filter?: boolean;
}

interface Closeable {
  close(): void;
}

let openDd: Closeable | null = null;

// 点击组件外部 / 按 Esc 关闭当前展开的下拉
document.addEventListener('pointerdown', (e) => {
  if (openDd && !(e.target as HTMLElement).closest('.dd')) openDd.close();
}, true);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && openDd) openDd.close();
});

export class Dropdown {
  readonly root: HTMLElement;
  private btn: HTMLButtonElement;
  private labelEl: HTMLElement;
  private menu: HTMLElement;
  private filterBox: HTMLInputElement | null = null;
  private opts: DdOption[] = [];
  private idx = -1;
  private _disabled = false;
  onchange: ((o: DdOption) => void) | null = null;

  constructor(parent: HTMLElement, config: DropdownConfig = {}) {
    this.root = document.createElement('div');
    this.root.className = 'dd';

    this.btn = document.createElement('button');
    this.btn.type = 'button';
    this.btn.className = 'dd-btn';
    this.labelEl = document.createElement('span');
    this.labelEl.className = 'dd-label';
    const caret = document.createElement('span');
    caret.className = 'dd-caret';
    caret.textContent = '▾';
    this.btn.append(this.labelEl, caret);

    this.menu = document.createElement('div');
    this.menu.className = 'dd-menu';
    if (config.filter) {
      this.filterBox = document.createElement('input');
      this.filterBox.type = 'text';
      this.filterBox.className = 'dd-filter';
      this.filterBox.placeholder = '输入关键字过滤, 回车选第一项…';
      this.filterBox.spellcheck = false;
      this.filterBox.addEventListener('input', () => this.renderItems(this.filterBox!.value));
      this.filterBox.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          const first = this.menu.querySelector('.dd-item');
          if (first instanceof HTMLElement) first.click();
        }
      });
      this.menu.appendChild(this.filterBox);
    }

    this.root.append(this.btn, this.menu);
    parent.appendChild(this.root);

    this.btn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault(); // 防止外层 <label> 默认行为向按钮再次转发 click 导致 toggle 两次
      this.toggle();
    });
  }

  setOptions(opts: DdOption[], selected?: string): void {
    this.opts = opts;
    const init = selected !== undefined ? opts.findIndex((o) => o.value === selected) : 0;
    this.select(opts.length ? Math.max(0, init) : -1, false);
  }

  get option(): DdOption | null {
    return this.opts[this.idx] ?? null;
  }

  set disabled(b: boolean) {
    this._disabled = b;
    this.root.classList.toggle('disabled', b);
    if (b) this.close();
  }

  select(i: number, fire = true): void {
    this.idx = i;
    this.renderItems(this.filterBox?.value ?? '');
    const o = this.opts[i];
    this.labelEl.textContent = o ? o.label : '';
    if (o && fire) this.onchange?.(o);
  }

  // 按关键字重建菜单项 (空关键字 = 全部)
  private renderItems(query: string): void {
    for (const el of Array.from(this.menu.children)) {
      if (el !== this.filterBox) el.remove();
    }
    const q = query.trim().toLowerCase();
    this.opts.forEach((o, i) => {
      if (q && !o.label.toLowerCase().includes(q)) return;
      const item = document.createElement('div');
      item.className = 'dd-item' + (i === this.idx ? ' sel' : '');
      item.textContent = o.label;
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        this.select(i);
        this.close();
      });
      this.menu.appendChild(item);
    });
  }

  private toggle(): void {
    if (this._disabled) return;
    if (openDd === this) {
      this.close();
      return;
    }
    openDd?.close();
    this.root.classList.add('open');
    openDd = this;
    if (this.filterBox) {
      this.filterBox.value = '';
      this.renderItems('');
      setTimeout(() => this.filterBox?.focus(), 0);
    }
    (this.menu.querySelector('.dd-item.sel') as HTMLElement | null)?.scrollIntoView({ block: 'nearest' });
  }

  close(): void {
    this.root.classList.remove('open');
    if (openDd === this) openDd = null;
  }
}
