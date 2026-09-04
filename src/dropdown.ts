// 轻量自绘下拉框: 原生 <select> 的弹层在 Electron/WebView 环境 (高 DPI) 下渲染异常, 故自绘
export interface DdOption {
  value: string;
  label: string;
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
  private opts: DdOption[] = [];
  private idx = -1;
  private _disabled = false;
  onchange: ((o: DdOption) => void) | null = null;

  constructor(parent: HTMLElement) {
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
    this.menu.innerHTML = '';
    opts.forEach((o, i) => {
      const item = document.createElement('div');
      item.className = 'dd-item';
      item.textContent = o.label;
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        this.select(i);
        this.close();
      });
      this.menu.appendChild(item);
    });
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
    Array.from(this.menu.children, (c, j) => c.classList.toggle('sel', j === i));
    const o = this.opts[i];
    this.labelEl.textContent = o ? o.label : '';
    if (o && fire) this.onchange?.(o);
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
    (this.menu.querySelector('.dd-item.sel') as HTMLElement | null)?.scrollIntoView({ block: 'nearest' });
  }

  close(): void {
    this.root.classList.remove('open');
    if (openDd === this) openDd = null;
  }
}
