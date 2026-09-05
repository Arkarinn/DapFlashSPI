# DapFlashSPI

[English](README.md)

## 目标

- 使用广泛而易得的CMSIS-DAP兼容设备烧写SPI协议的FLASH。

## 速度

- 取决于设备能力和芯片兼容性，SPI协议时钟速度一般大于10MHz。

## 设备限制

- 支持WebUsb驱动，以便通过浏览器访问。
- 支持JTAG接口，以实现SPI接口。

## 浏览器兼容性

- Edge

## 使用方法

- 点击配对，在浏览器弹窗中选择要用的设备。
- 选中设备，点击打开。
- 选择FLASH型号或点击自动匹配。
- 选择时钟速度。
- 开始读/写。

## 在线使用 (GitHub Pages)

仓库附带 GitHub Actions 工作流 (`.github/workflows/pages.yml`), 推送到 `main` 分支自动构建部署:

1. GitHub 仓库 → Settings → Pages → Build and deployment → Source 选择 **GitHub Actions** (只需设置一次)
2. 访问 <https://arkarinn.github.io/DapFlashSPI/>

GitHub Pages 为 HTTPS, 满足 WebUSB 的安全上下文要求, 打开即用。
注意: 内嵌浏览器 (Electron) 无法弹出 USB 授权窗口, 设备配对需在真正的浏览器窗口中进行。

## 本地运行

编译产物 `out/` 不入库, 本地使用需先构建一次 (需 Node.js):

```bash
npm install
npm run build
npm start                # 启动 http://localhost:5177  (也可: python -m http.server 5177)
```

然后浏览器打开 <http://localhost:5177>。

## 芯片数据库

型号库含 **816 颗 SPI NOR** (37 家厂商, Winbond / Macronix / GigaDevice / Micron / ISSI 等),
来源为 NeoProgrammer (CH341A 编程器软件) 的加密芯片库 `chiplist.dat`, 解码后导入:

```bash
python tools/decode_chiplist.py    # 解码 (RC4 分块 + zlib) → tools/chiplist.xml
python tools/gen_flashdb.py        # 生成 src/flashdb.ts
```

未包含: SST AAI 编程模式芯片 (35 颗) 与非 3 字节 JEDEC ID 的老芯片 (44 颗)。

## 技术说明

- 仅支持 **CMSIS-DAP v2** (bulk 传输), v1 (HID) 不支持。
  Windows 下若打开时 claim 接口失败, 通常是设备未绑定 WinUSB 驱动: 多数固件通过
  Microsoft OS 描述符自动绑定; 否则可用 [Zadig] 替换 (注意原驱动软件可能无法再访问)。
  设备被 Keil 等调试软件占用时同样无法打开, 请先关闭占用程序。
- SPI 经 JTAG 实现, 引脚映射: TCK→SCK, TMS→CS, TDI→MOSI, TDO→MISO;
  JTAG 为 LSB-first 而 SPI 命令为 MSB-first, 每字节做位反转;
  数据读写按 DAP 包长自动组包分包。
- 大于 16MB 的芯片自动进入 4 字节地址模式 (0xB7 进入 / 0xE9 退出,
  读 0x13 / 编程 0x12), 关闭设备前恢复 3 字节模式, 最大支持 256MB。
- 协议命令编号按现行官方固件 (`Include/DAP.h`), 如 SWJ_Clock=0x11、JTAG_Sequence=0x14,
  响应首字节为命令 ID 回显; 修改固件相关代码时建议对照 CMSIS-DAP 官方源码。

[Zadig]: https://zadig.akeo.ie/
