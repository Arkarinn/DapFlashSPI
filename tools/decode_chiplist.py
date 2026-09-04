# NeoProgrammer chiplist.dat 解码器 (算法来自社区逆向: RC4分块 + zlib)
import base64
import hashlib
import pathlib
import struct
import sys
import zlib

INPUT = pathlib.Path(__file__).parent.parent / "chiplist.dat"
OUTPUT = pathlib.Path(__file__).with_name("chiplist.xml")


def rc4_init(key: bytes) -> list[int]:
    s = list(range(256))
    j = 0
    for i in range(256):
        j = (j + s[i] + key[i % len(key)]) & 0xFF
        s[i], s[j] = s[j], s[i]
    return s


def rc4_apply(data: bytes, s: list[int]) -> bytes:
    i = 0
    j = 0
    out = bytearray(len(data))
    for n, b in enumerate(data):
        i = (i + 1) & 0xFF
        j = (j + s[i]) & 0xFF
        s[i], s[j] = s[j], s[i]
        out[n] = b ^ s[(s[i] + s[j]) & 0xFF]
    return bytes(out)


def rc4_chunked(data: bytes, key: bytes, chunk_size: int = 0x2000) -> bytes:
    # KSA 一次, 每个 0x2000 块重置 i=j=0 继续用同一 S 盒
    s = rc4_init(key)
    out = bytearray()
    for offset in range(0, len(data), chunk_size):
        out += rc4_apply(data[offset:offset + chunk_size], s)
    return bytes(out)


def build_password() -> str:
    first_order = ["vd7", "SQP", "RBs", "HgX", "0bv", "pii", "sn8"]
    second_order = ["z1J", "92Z", "7xA", "eex", "MEW", "ulI", "wdX"]
    return "".join(s[1:3] for s in first_order + second_order)


def derive_real_password() -> bytes:
    obfuscated = base64.b64decode(build_password().encode("ascii"))
    unwrap_key = hashlib.sha1(b"chiplist.dat").digest()
    return rc4_apply(obfuscated, rc4_init(unwrap_key))


def decrypt_chiplist(raw: bytes) -> bytes:
    if len(raw) < 8:
        raise ValueError(f"too short: {len(raw)} bytes")
    key = hashlib.sha1(derive_real_password()).digest()
    decrypted = rc4_chunked(raw, key)
    unpacked_size, reserved = struct.unpack_from("<II", decrypted, 0)
    if reserved != 0:
        raise ValueError(f"reserved != 0 (0x{reserved:08X}) — 密钥可能不匹配 (软件版本差异?)")
    xml = zlib.decompress(decrypted[8:])
    if len(xml) != unpacked_size:
        raise ValueError(f"size mismatch: header={unpacked_size}, zlib={len(xml)}")
    return xml


def main() -> int:
    try:
        xml = decrypt_chiplist(INPUT.read_bytes())
    except Exception as e:
        print(f"解码失败: {e}")
        return 1
    OUTPUT.write_bytes(xml)
    print(f"密码: {derive_real_password().decode('ascii', 'replace')}")
    print(f"已解码 {len(xml)} 字节 XML -> {OUTPUT}")
    print(xml[:400].decode("utf-8", "replace"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
