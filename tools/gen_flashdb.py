# 从解码后的 NeoProgrammer chiplist.xml 生成 src/flashdb.ts
# 用法: python tools/gen_flashdb.py   (先运行 decode_chiplist.py 生成 chiplist.xml)
import pathlib
import xml.etree.ElementTree as ET

HERE = pathlib.Path(__file__).parent
XML = HERE / "chiplist.xml"
OUT = HERE.parent / "src" / "flashdb.ts"

NOR = "SPI_NOR"
# 不支持的编程模式 (SST AAI, 见 chiplist.xml 头部注释), 以及非 3 字节 JEDEC ID 的老芯片
SKIP_PAGES = {"SSTW", "SSTB"}


def prettify_vendor(tag: str) -> str:
    return tag.replace("_", " ").title()


def main() -> None:
    nor = ET.parse(XML).getroot().find(NOR)
    assert nor is not None, "chiplist.xml 缺少 SPI_NOR 分类"
    entries = []
    skipped = {"aai": 0, "id": 0}
    for vendor in nor:
        for ch in vendor:
            cid = (ch.get("id") or "").strip().upper()
            page = ch.get("page") or ""
            size = int(ch.get("size") or 0)
            if page in SKIP_PAGES:
                skipped["aai"] += 1
                continue
            if len(cid) != 6 or size <= 0 or not page.isdigit():
                skipped["id"] += 1
                continue
            entries.append((prettify_vendor(vendor.tag), ch.tag, int(cid, 16), size, int(page)))

    entries.sort(key=lambda e: (e[0].lower(), e[1].lower()))
    lines = []
    for vendor, model, jedec, size, page in entries:
        lines.append(f"  {{ vendor: {vendor!r}, model: {model!r}, jedecId: 0x{jedec:06x}, sizeBytes: {size}, page: {page} }},")

    OUT.write_text(
        "// 本文件由 tools/gen_flashdb.py 自动生成 (数据来源: NeoProgrammer chiplist.dat), 请勿手工编辑\n"
        "export interface FlashInfo {\n"
        "  vendor: string;\n"
        "  model: string;\n"
        "  jedecId: number; // 24 位 JEDEC ID (9F 命令返回的 厂商|类型|容量)\n"
        "  sizeBytes: number;\n"
        "  page: number; // 页大小 (字节), 页编程不跨页\n"
        "}\n\n"
        f"export const FLASH_DB: FlashInfo[] = [\n" + "\n".join(lines) + "\n];\n",
        encoding="utf-8",
    )
    print(f"生成 {len(entries)} 条 → {OUT} (跳过: AAI {skipped['aai']}, 非标准ID {skipped['id']})")


if __name__ == "__main__":
    main()
