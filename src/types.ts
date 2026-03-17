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

/**
 * 文件读取选项接口
 */
export interface FileReadOptions {
  /** 起始位置（字节），默认为 0 */
  start?: number;
  /** 读取长度（字节），不指定则读取全部 */
  length?: number;
  /** 是否返回 Uint8Array，false 则返回 Blob，默认为 true */
  asUint8Array?: boolean;
  /** 进度回调函数 */
  onProgress?: (loaded: number, total: number) => void;
}

/**
 * 文件内容读取结果接口
 */
export interface FileContentResult {
  /** 文件名 */
  filename: string;
  /** 文件内容（Uint8Array 或 Blob） */
  content: Uint8Array | Blob;
  /** 文件信息 */
  fileInfo: ZipFileInfo;
}

/**
 * 本地文件头信息接口
 */
export interface LocalFileHeaderInfo {
  /** 本地文件头偏移量 */
  localHeaderOffset: number;
  /** 压缩方法 */
  compressionMethod: number;
  /** 压缩后大小 */
  compressedSize: number;
  /** 未压缩大小 */
  uncompressedSize: number;
  /** 文件名长度 */
  filenameLength: number;
  /** 额外字段长度 */
  extraFieldLength: number;
  /** 文件名 */
  filename: string;
}
