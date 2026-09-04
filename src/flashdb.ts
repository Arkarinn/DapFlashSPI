// FLASH 型号库: 手动选择与自动匹配的数据源
// 字段后续按需扩展 (页大小/扇区结构/擦除指令等); JEDEC ID 待与数据手册核对
export interface FlashInfo {
  vendor: string;
  model: string;
  jedecId: number; // 24 位 JEDEC ID (制造商 | 类型 | 容量)
  sizeBytes: number;
}

export const FLASH_DB: FlashInfo[] = [
  { vendor: 'Winbond', model: 'W25Q80', jedecId: 0xef4014, sizeBytes: 1 * 1024 * 1024 },
  { vendor: 'Winbond', model: 'W25Q16', jedecId: 0xef4015, sizeBytes: 2 * 1024 * 1024 },
  { vendor: 'Winbond', model: 'W25Q32', jedecId: 0xef4016, sizeBytes: 4 * 1024 * 1024 },
  { vendor: 'Winbond', model: 'W25Q64', jedecId: 0xef4017, sizeBytes: 8 * 1024 * 1024 },
  { vendor: 'Winbond', model: 'W25Q128', jedecId: 0xef4018, sizeBytes: 16 * 1024 * 1024 },
  { vendor: 'GigaDevice', model: 'GD25Q16', jedecId: 0xc84015, sizeBytes: 2 * 1024 * 1024 },
  { vendor: 'GigaDevice', model: 'GD25Q64', jedecId: 0xc84017, sizeBytes: 8 * 1024 * 1024 },
  { vendor: 'Microchip', model: 'AT25SF041', jedecId: 0x1f8401, sizeBytes: 512 * 1024 },
  { vendor: 'Macronix', model: 'MX25L6433F', jedecId: 0xc22017, sizeBytes: 8 * 1024 * 1024 },
  { vendor: 'Microchip', model: 'SST26VF016', jedecId: 0xbf2601, sizeBytes: 16 * 1024 * 1024 },
];
