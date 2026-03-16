/**
 * ZIP 文件条目信息接口
 */
export interface ZipFileInfo {
  /** 文件名 */
  filename: string;
  /** 文件大小（字节） */
  fileSize: number;
  /** 压缩后大小（字节） */
  compressedSize: number;
  /** CRC32 校验和 */
  crc32: number;
  /** 压缩方法 */
  compressionMethod: number;
  /** 最后修改时间 */
  lastModified: Date;
  /** 是否为目录 */
  isDirectory: boolean;
  /** 注释 */
  comment: string;
}

/**
 * ZIP 文件摘要信息接口
 */
export interface ZipSummary {
  /** ZIP 文件 URL */
  url: string;
  /** 总条目数 */
  totalEntries: number;
  /** 文件数量 */
  files: number;
  /** 目录数量 */
  directories: number;
  /** 总大小（字节） */
  totalSize: number;
  /** 压缩后大小（字节） */
  compressedSize: number;
  /** 压缩率（百分比） */
  compressionRatio: number;
  /** ZIP 文件大小（字节） */
  zipFileSize: number;
}

/**
 * 中央目录信息接口
 */
export interface CentralDirectoryInfo {
  signature: number;
  diskNumber: number;
  cdDisk: number;
  cdEntriesOnDisk: number;
  cdEntriesTotal: number;
  cdSize: number;
  cdOffset: number;
  commentLength: number;
  comment: string;
}
