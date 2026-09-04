# DapFlashSPI

[English](README.md)

## 目标

- 使用广泛而易得的CMSIS-DAP兼容设备烧写SPI/I2C协议的FLASH和EEPROM。

## 速度

- 取决于设备能力和芯片兼容性，SPI协议时钟速度一般大于10MHz。

## 设备限制

- 支持WebUsb驱动，以便通过浏览器访问。
- 支持JTAG接口，以实现SPI接口。
- 支持SWD接口，以实现I2C接口。

## 浏览器兼容性

- Edge

## 网页工具 (CMSIS-DAP WebUSB 调试器)

仓库根目录即一个纯前端网页工具 (TypeScript + 原生 DOM, 无框架):

- 搜索 / 添加 USB 设备 (内置常见 CMSIS-DAP VID/PID 过滤, 也可列出任意设备)
- 打开 / 关闭设备 (自动定位 bulk 输入/输出端点, 即 CMSIS-DAP v2 接口)
- 以 hex 形式发送 / 接收数据包, 附常用 DAP 命令快捷按钮与时间戳日志

### 在线使用 (GitHub Pages)

仓库附带 GitHub Actions 工作流 (`.github/workflows/pages.yml`), 推送到 `main` 分支自动构建部署:

1. GitHub 仓库 → Settings → Pages → Build and deployment → Source 选择 **GitHub Actions** (只需设置一次)
2. 访问 <https://arkarinn.github.io/DapFlashSPI/>

GitHub Pages 为 HTTPS, 满足 WebUSB 的安全上下文要求, 打开即用。

### 本地运行

编译产物 `out/` 不入库, 本地使用需先构建一次 (需 Node.js):

```bash
npm install
npm run build
npm start                # 启动 http://localhost:5177  (也可: python -m http.server 5177)
```

用 Chrome/Edge 打开 <http://localhost:5177>。

### 注意

- WebUSB 仅 Chrome/Edge 等 Chromium 浏览器支持; 每个设备首次需在页面上授权。
- 仅支持 bulk 传输, 即 CMSIS-DAP v2 固件; v1 (HID) 不支持。
- Windows 下 claim 接口失败通常是未绑定 WinUSB 驱动: DAPLink v2 固件一般通过
  Microsoft OS 描述符自动绑定; 否则可用 [Zadig] 替换 (注意原驱动软件如 Keil/pyOCD 可能无法再访问)。

### 快捷命令

| 按钮 | 字节 | 说明 |
|---|---|---|
| Info·固件版本 | `00 04` | DAP_Info 查询固件版本 |
| Info·能力 | `00 F0` | DAP_Info 查询能力位 |
| Connect·SWD | `02 01` | DAP_Connect 选择 SWD 端口 |
| SWJ Clock·1MHz | `08 40 42 0F 00` | DAP_SWJ_Clock 设 1 MHz |
| ResetTarget | `06` | DAP_ResetTarget 复位目标 |

[Zadig]: https://zadig.akeo.ie/
