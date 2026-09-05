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

- 打开GitPages
- 点击配对，在浏览器弹窗中选择要用的设备。
- 选中设备，点击打开。
- 选择FLASH型号或点击自动匹配。
- 选择时钟速度。
- 开始读/写。

## 本地运行

```bash
npm install
npm run build
npm start      # 启动 http://localhost:5177  (或: python -m http.server 5177)
```

浏览器打开 <http://localhost:5177>。

## 芯片数据库

型号库含 **816 颗 SPI NOR** (37 家厂商, Winbond / Macronix / GigaDevice / Micron / ISSI 等),
来源为 NeoProgrammer (CH341A 编程器软件) 的加密芯片库 `chiplist.dat`, 解码后导入:

```bash
python tools/decode_chiplist.py    # 解码 (RC4 分块 + zlib) → tools/chiplist.xml
python tools/gen_flashdb.py        # 生成 src/flashdb.ts
```

未包含: SST AAI 编程模式芯片 (35 颗) 与非 3 字节 JEDEC ID 的老芯片 (44 颗)。

## 说明

- 本项目由ZCode@GLM 5.3生成。
- 仅支持 **CMSIS-DAP v2** (bulk 传输), v1 (HID) 不支持。
  设备被 Keil 等调试软件占用时无法打开, 先关闭程序。
- SPI 经 JTAG 实现, 引脚映射: TCK→SCK, TMS→CS, TDI→MOSI, TDO→MISO;
  JTAG 为 LSB-first 而 SPI 命令为 MSB-first, 每字节做位反转;
  数据读写按 DAP 包长自动组包分包。
- 大于 16MB 的芯片自动进入 4 字节地址模式 (0xB7 进入 / 0xE9 退出,读 0x13 / 编程 0x12)。
  关闭设备前恢复 3 字节模式, 最大支持 256MB。

## 命令字与协议格式

### SPI FLASH 命令字

| 命令 | 命令字 | 格式与说明 |
| --- | --- | --- |
| 写使能 WREN | `0x06` | 单字节, 置位 WEL (每次编程/擦除前) |
| 读状态 RDSR | `0x05` | `[05]` + 1 哑元 → 1 字节; bit0=WIP 忙标志, bit1=WEL |
| 读 JEDEC ID | `0x9F` | `[9F]` + 3 哑元 → 3 字节 (厂商 / 类型 / 容量), 自动匹配依据 |
| 读数据 | `0x03` / `0x13`* | `[03, A23..A16, A15..A8, A7..A0]` + N 哑元 → N 字节 |
| 页编程 | `0x02` / `0x12`* | `[02, 地址, 数据...]`; 不跨页, 单次 ≤ 页大小 |
| 全片擦除 | `0x60` | 单字节 (`0xC7` 等价), 之后轮询 WIP 直至完成 |
| 唤醒 | `0xAB` | `[AB]` + 3 哑元, 释放掉电模式 |
| 4 字节地址模式 | `0xB7` / `0xE9` | 进入 / 退出; 仅 >16MB 芯片使用 |

\* 4 字节地址模式下使用带 * 的命令字, 且地址扩展为 4 字节 (`A31..A24` 起头)。

### CMSIS-DAP 命令字 (v2 bulk)

| 命令 | 命令字 | 说明 |
| --- | --- | --- |
| DAP_Info | `0x00` | `[00, 信息ID]` → `[回显, 长度, 数据]`; `0xF0` 能力位, `0x03` 序列号, `0xFF` 包长 |
| DAP_HostStatus | `0x01` | `[01, 0, 1]` 点亮连接 LED |
| DAP_Connect | `0x02` | `[02, 2]` 进入 JTAG 模式 → `[回显, 2]` |
| DAP_Disconnect | `0x03` | 断开连接 |
| DAP_SWJ_Clock | `0x11` | `[11, 频率Hz 小端4字节]` 设置 TCK 频率 |
| DAP_JTAG_Sequence | `0x14` | 位流发生器, 格式见下 |

### 协议格式

- **USB 传输**: 每个 DAP 命令为一个 bulk OUT 包, 响应为一个 bulk IN 包;
  响应首字节为命令 ID 回显, 多数命令随后跟一字节状态 (`0x00` OK / `0xFF` 错误)。
- **JTAG_Sequence 请求**: `[0x14][序列个数]([序列info][TDI数据])*`;
  `info` = bit7 TDO 捕获使能, bit6 TMS 电平, bit[5:0] TCK 个数 (0 表示 64)。
  响应: `[0x14][0x00][捕获的 TDO 数据...]`。
- **SPI 事务 → JTAG 序列**: 引脚 TCK=SCK / TMS=CS / TDI=MOSI / TDO=MISO;
  CS 拉低期间把 SPI 数据按每 8 字节一段拆成序列 (TDI 为位反转后的字节, 捕获从读起始字节开始),
  末尾补一段 TMS=1 的单个 TCK 将 CS 拉高; 收到的 TDO 再逐字节位反转还原为 MSB-first。

## 链接

- [CMSIS-DAP](https://github.com/ARM-software/CMSIS-DAP)
- [DAPLink](https://github.com/ARMmbed/DAPLink)
- [ZCode](https://zcode.z.ai/cn)
