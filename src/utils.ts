/**
 * 格式化文件大小
 * @param sizeBytes 文件大小（字节）
 * @returns 格式化后的大小字符串
 */
export function formatSize(sizeBytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = sizeBytes;
  let unitIndex = 0;
  
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  
  return `${size.toFixed(1)} ${units[unitIndex]}`;
}

/**
 * 将 DOS 时间格式转换为 Date 对象
 * @param dosDate DOS 日期
 * @param dosTime DOS 时间
 * @returns Date 对象
 */
export function dosTimeToDateTime(dosDate: number, dosTime: number): Date {
  try {
    const year = ((dosDate >> 9) & 0x7f) + 1980;
    const month = (dosDate >> 5) & 0x0f;
    const day = dosDate & 0x1f;
    
    const hour = (dosTime >> 11) & 0x1f;
    const minute = (dosTime >> 5) & 0x3f;
    const second = (dosTime & 0x1f) * 2;
    
    return new Date(year, month - 1, day, hour, minute, second);
  } catch (e) {
    return new Date(1980, 0, 1);
  }
}
