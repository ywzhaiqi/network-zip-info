import type { ZipFileInfo, ZipSummary, CentralDirectoryInfo, FileReadOptions, FileContentResult, LocalFileHeaderInfo } from './types';
import { dosTimeToDateTime } from './utils';
import { inflateSync } from 'fflate';

/**
 * 网络 ZIP 文件读取器
 * 通过 HTTP Range 请求获取 ZIP 文件信息，无需下载完整文件
 */
export class NetworkZipReader {
  private url: string;
  private timeout: number;
  private userAgent: string;
  private fileSize: number | null = null;
  private debug: boolean;
  private cdDataCache: {
    data: Uint8Array;
    offset: number;
    size: number;
  } | null = null;
  private localHeaderCache: Map<number, LocalFileHeaderInfo> = new Map();

  /**
   * 初始化网络 ZIP 读取器
   * @param url ZIP 文件的 URL
   * @param timeout 请求超时时间（秒）
   * @param userAgent 自定义 User-Agent
   * @param debug 是否启用调试日志
   */
  constructor(
    url: string,
    timeout: number = 30,
    userAgent?: string,
    debug: boolean = false
  ) {
    this._validateUrl(url);
    this.url = url;
    this.timeout = timeout * 1000;
    this.userAgent = userAgent || '';
    this.debug = debug;
  }

  /**
   * 验证 URL 格式和协议
   * @param url 待验证的 URL
   */
  private _validateUrl(url: string): void {
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error('只支持 HTTP 和 HTTPS 协议');
      }
    } catch (e) {
      throw new Error('无效的 URL 格式');
    }
  }

  private debugLog(...args: any[]): void {
    if (this.debug) {
      console.log(...args);
    }
  }

  /**
   * 异步初始化，检查服务器支持
   */
  async initialize(): Promise<void> {
    // 清除缓存
    this.cdDataCache = null;
    this.localHeaderCache.clear();
    await this._checkServerSupport();
  }

  /**
   * 检查服务器是否支持 Range 请求
   */
  private async _checkServerSupport(): Promise<void> {
    try {
      // 首先使用 HEAD 请求获取文件大小
      const headResponse = await fetch(this.url, {
        method: 'HEAD',
        redirect: 'follow',
        signal: AbortSignal.timeout(this.timeout)
      });

      if (!headResponse.ok) {
        throw new Error(`HTTP 错误：${headResponse.status}`);
      }

      const contentLength = headResponse.headers.get('content-length');
      this.debugLog('HEAD 请求 Content-Length:', contentLength);
      
      if (contentLength) {
        const size = parseInt(contentLength, 10);
        if (!isNaN(size) && size > 0) {
          this.fileSize = size;
          this.debugLog('设置 fileSize:', this.fileSize);
        }
      }

      if (this.fileSize === null || this.fileSize === 0) {
        throw new Error('无法获取文件大小');
      }

      // 然后使用 Range 请求检查服务器是否支持
      const headers = {
        'Range': 'bytes=0-1023',
        'User-Agent': this.userAgent
      };

      const response = await fetch(this.url, {
        method: 'GET',
        headers,
        redirect: 'follow',
        signal: AbortSignal.timeout(this.timeout)
      });

      if (!response.ok) {
        throw new Error(`HTTP 错误：${response.status}`);
      }

      if (response.status === 206) {
        this.debugLog('服务器支持 Range 请求');
      } else {
        console.warn('警告：服务器可能不支持 Range 请求，可能需要下载完整文件');
      }
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`无法连接到服务器：${error.message}`);
      }
      throw error;
    }
  }

  /**
   * 读取指定范围的数据
   * @param start 起始位置
   * @param length 读取长度
   * @returns 读取的数据
   */
  private async _readRange(start: number, length: number): Promise<Uint8Array> {
    const end = start + length - 1;
    const headers = {
      'Range': `bytes=${start}-${end}`,
      'User-Agent': this.userAgent
    };

    try {
      const response = await fetch(this.url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(this.timeout)
      });

      if (!response.ok) {
        throw new Error(`HTTP 错误：${response.status}`);
      }

      const contentRange = response.headers.get('content-range');
      this.debugLog(`Range 请求：bytes=${start}-${end}, 响应：${contentRange}`);

      const arrayBuffer = await response.arrayBuffer();
      this.debugLog(`请求长度：${length}, 实际接收：${arrayBuffer.byteLength}`);
      
      return new Uint8Array(arrayBuffer);
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`读取数据失败：${error.message}`);
      }
      throw error;
    }
  }

  /**
   * 查找中央目录结束记录
   * @returns [记录位置，记录数据]
   */
  private async _findEndOfCentralDirectory(): Promise<[number, Uint8Array]> {
    const maxCommentLength = 65535;
    
    if (this.fileSize === null) {
      throw new Error('文件大小未知，无法读取 ZIP 文件');
    }

    const searchLength = Math.min(22 + maxCommentLength, this.fileSize);
    const startPos = Math.max(0, this.fileSize - searchLength);
    
    this.debugLog('文件大小:', this.fileSize);
    this.debugLog('搜索起始位置:', startPos);
    this.debugLog('搜索长度:', searchLength);
    
    const data = await this._readRange(startPos, searchLength);
    
    this.debugLog('实际获取数据长度:', data.length);
    this.debugLog('数据前 20 字节:', Array.from(data.slice(0, 20)).map(b => b.toString(16).padStart(2, '0')).join(' '));
    this.debugLog('数据后 20 字节:', Array.from(data.slice(-20)).map(b => b.toString(16).padStart(2, '0')).join(' '));
    
    const eocdSignature = new Uint8Array([0x50, 0x4b, 0x05, 0x06]);

    for (let i = data.length - 22; i >= 0; i--) {
      if (this._compareBytes(data, i, eocdSignature)) {
        const eocdPos = startPos + i;
        let eocdData = data.slice(i, i + 22);

        const commentLength = this._readUint16LE(eocdData, 20);
        if (commentLength > 0) {
          const fullData = await this._readRange(startPos + i, 22 + commentLength);
          eocdData = fullData.slice(0, 22 + commentLength);
        }

        return [eocdPos, eocdData];
      }
    }

    throw new Error('未找到 ZIP 文件的中央目录结束记录');
  }

  /**
   * 比较字节数组
   */
  private _compareBytes(data: Uint8Array, offset: number, signature: Uint8Array): boolean {
    for (let i = 0; i < signature.length; i++) {
      if (data[offset + i] !== signature[i]) {
        return false;
      }
    }
    return true;
  }

  /**
   * 读取小端序 16 位无符号整数
   */
  private _readUint16LE(data: Uint8Array, offset: number): number {
    return data[offset] | (data[offset + 1] << 8);
  }

  /**
   * 读取小端序 32 位无符号整数
   */
  private _readUint32LE(data: Uint8Array, offset: number): number {
    return (data[offset] | (data[offset + 1] << 8) | 
            (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0;
  }

  /**
   * 解析中央目录结束记录
   * @param eocdData EOCD 记录数据
   * @returns 解析后的信息对象
   */
  private _parseEocd(eocdData: Uint8Array): CentralDirectoryInfo {
    if (eocdData.length < 22) {
      throw new Error('EOCD 记录数据不完整');
    }

    const signature = this._readUint32LE(eocdData, 0);
    const diskNumber = this._readUint16LE(eocdData, 4);
    const cdDisk = this._readUint16LE(eocdData, 6);
    const cdEntriesDisk = this._readUint16LE(eocdData, 8);
    const cdEntriesTotal = this._readUint16LE(eocdData, 10);
    const cdSize = this._readUint32LE(eocdData, 12);
    const cdOffset = this._readUint32LE(eocdData, 16);
    const commentLength = this._readUint16LE(eocdData, 20);

    let comment = '';
    if (commentLength > 0 && eocdData.length >= 22 + commentLength) {
      comment = new TextDecoder('utf-8', { fatal: false }).decode(
        eocdData.slice(22, 22 + commentLength)
      );
    }

    return {
      signature,
      diskNumber,
      cdDisk,
      cdEntriesOnDisk: cdEntriesDisk,
      cdEntriesTotal,
      cdSize,
      cdOffset,
      commentLength,
      comment
    };
  }

  /**
   * 读取并解析中央目录
   * @param cdOffset 中央目录偏移量
   * @param cdSize 中央目录大小
   * @returns 文件信息列表和偏移量
   */
  private async _readCentralDirectory(cdOffset: number, cdSize: number): Promise<Array<ZipFileInfo & { localHeaderOffset: number }>> {
    // 检查缓存
    if (this.cdDataCache && 
        this.cdDataCache.offset === cdOffset && 
        this.cdDataCache.size === cdSize) {
      this.debugLog('使用缓存的中央目录数据');
      return this._parseCentralDirectory(this.cdDataCache.data);
    }

    this.debugLog('读取中央目录，偏移量:', cdOffset, '大小:', cdSize);
    const cdData = await this._readRange(cdOffset, cdSize);
    
    // 缓存数据
    this.cdDataCache = {
      data: cdData,
      offset: cdOffset,
      size: cdSize
    };
    
    return this._parseCentralDirectory(cdData);
  }

  /**
   * 解析中央目录数据
   * @param cdData 中央目录数据
   * @returns 文件信息列表和偏移量
   */
  private _parseCentralDirectory(cdData: Uint8Array): Array<ZipFileInfo & { localHeaderOffset: number }> {
    const files: Array<ZipFileInfo & { localHeaderOffset: number }> = [];
    let offset = 0;

    while (offset < cdData.length) {
      if (offset + 4 > cdData.length) {
        break;
      }

      const signature = this._readUint32LE(cdData, offset);
      if (signature !== 0x02014b50) {
        break;
      }

      if (offset + 46 > cdData.length) {
        break;
      }

      const compressionMethod = this._readUint16LE(cdData, offset + 10);
      const lastModTime = this._readUint16LE(cdData, offset + 12);
      const lastModDate = this._readUint16LE(cdData, offset + 14);
      const crc32 = this._readUint32LE(cdData, offset + 16);
      const compressedSize = this._readUint32LE(cdData, offset + 20);
      const uncompressedSize = this._readUint32LE(cdData, offset + 24);
      const filenameLength = this._readUint16LE(cdData, offset + 28);
      const extraLength = this._readUint16LE(cdData, offset + 30);
      const commentLength = this._readUint16LE(cdData, offset + 32);
      const externalAttrs = this._readUint32LE(cdData, offset + 38);
      const localHeaderOffset = this._readUint32LE(cdData, offset + 42);

      const filenameStart = offset + 46;
      const filenameEnd = filenameStart + filenameLength;
      
      if (filenameEnd > cdData.length) {
        break;
      }

      const filename = new TextDecoder('utf-8', { fatal: false }).decode(
        cdData.slice(filenameStart, filenameEnd)
      );

      const commentStart = filenameEnd + extraLength;
      const commentEnd = commentStart + commentLength;
      let comment = '';
      
      if (commentLength > 0 && commentEnd <= cdData.length) {
        comment = new TextDecoder('utf-8', { fatal: false }).decode(
          cdData.slice(commentStart, commentEnd)
        );
      }

      const lastModified = dosTimeToDateTime(lastModDate, lastModTime);
      const isDirectory = filename.endsWith('/') || (externalAttrs & 0x10) !== 0;

      files.push({
        filename,
        fileSize: uncompressedSize,
        compressedSize,
        crc32,
        compressionMethod,
        lastModified,
        isDirectory,
        comment,
        localHeaderOffset
      });

      offset = commentEnd;
    }

    return files;
  }

  /**
   * 获取 ZIP 文件中的文件列表
   * @returns 文件信息列表
   */
  async getFileList(): Promise<ZipFileInfo[]> {
    if (this.fileSize === null) {
      await this.initialize();
    }
    try {
      const [_, eocdData] = await this._findEndOfCentralDirectory();
      const eocdInfo = this._parseEocd(eocdData);
      const files = await this._readCentralDirectory(eocdInfo.cdOffset, eocdInfo.cdSize);
      // 去掉内部使用的 localHeaderOffset 字段
      return files.map(({ localHeaderOffset, ...rest }) => rest);
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`获取文件列表失败：${error.message}`);
      }
      throw error;
    }
  }

  /**
   * 获取 ZIP 文件摘要信息
   * @returns 摘要信息对象
   */
  async getSummary(): Promise<ZipSummary> {
    if (this.fileSize === null) {
      await this.initialize();
    }
    const files = await this.getFileList();
    
    const totalFiles = files.filter(f => !f.isDirectory).length;
    const totalDirs = files.filter(f => f.isDirectory).length;
    const totalSize = files.filter(f => !f.isDirectory).reduce((sum, f) => sum + f.fileSize, 0);
    const totalCompressed = files.filter(f => !f.isDirectory).reduce((sum, f) => sum + f.compressedSize, 0);
    
    const compressionRatio = totalSize > 0 ? (1 - totalCompressed / totalSize) * 100 : 0;

    return {
      url: this.url,
      totalEntries: files.length,
      files: totalFiles,
      directories: totalDirs,
      totalSize,
      compressedSize: totalCompressed,
      compressionRatio,
      zipFileSize: this.fileSize || 0
    };
  }

  /**
   * 读取本地文件头信息
   * @param localHeaderOffset 本地文件头偏移量
   * @returns 本地文件头信息
   */
  private async _readLocalHeader(localHeaderOffset: number): Promise<LocalFileHeaderInfo> {
    // 检查缓存
    if (this.localHeaderCache.has(localHeaderOffset)) {
      this.debugLog('使用缓存的本地文件头数据，偏移量:', localHeaderOffset);
      return this.localHeaderCache.get(localHeaderOffset)!;
    }

    this.debugLog('读取本地文件头，偏移量:', localHeaderOffset);
    
    // 先读取 30 字节获取长度信息
    const headerData = await this._readRange(localHeaderOffset, 30);
    
    const signature = this._readUint32LE(headerData, 0);
    if (signature !== 0x04034b50) {
      throw new Error('无效的本地文件头签名');
    }

    const compressionMethod = this._readUint16LE(headerData, 8);
    const compressedSize = this._readUint32LE(headerData, 18);
    const uncompressedSize = this._readUint32LE(headerData, 22);
    const filenameLength = this._readUint16LE(headerData, 26);
    const extraFieldLength = this._readUint16LE(headerData, 28);

    // 如果文件名和额外字段不为空，再读取
    let filename = '';
    if (filenameLength > 0) {
      const filenameData = await this._readRange(localHeaderOffset + 30, filenameLength);
      filename = new TextDecoder('utf-8', { fatal: false }).decode(filenameData);
    }

    const info: LocalFileHeaderInfo = {
      localHeaderOffset,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      filenameLength,
      extraFieldLength,
      filename
    };

    // 缓存结果
    this.localHeaderCache.set(localHeaderOffset, info);
    
    return info;
  }

  /**
   * 查找指定文件的中央目录条目
   * @param filename 文件名
   * @returns 文件信息和偏移量
   */
  private async _findFileEntry(filename: string): Promise<{ offset: number; info: ZipFileInfo }> {
    if (this.fileSize === null) {
      await this.initialize();
    }

    const [_, eocdData] = await this._findEndOfCentralDirectory();
    const eocdInfo = this._parseEocd(eocdData);
    
    // 使用缓存的中央目录数据
    const cdData = await this._readCentralDirectory(eocdInfo.cdOffset, eocdInfo.cdSize);
    
    // 在已解析的中央目录数据中查找
    for (const entry of cdData) {
      if (entry.filename === filename) {
        return {
          offset: entry.localHeaderOffset,
          info: entry
        };
      }
    }

    throw new Error(`未找到文件：${filename}`);
  }

  /**
   * 获取 ZIP 文件中指定文件的内容
   * 支持大文件分块读取和进度回调
   * 支持未压缩和 DEFLATE 压缩的文件
   * @param filename 文件名
   * @param options 读取选项
   * @returns 文件内容结果
   */
  async getFileContent(filename: string, options?: FileReadOptions): Promise<FileContentResult> {
    const {
      start = 0,
      length,
      asUint8Array = true,
      onProgress
    } = options || {};

    const fileEntry = await this._findFileEntry(filename);
    const localHeaderInfo = await this._readLocalHeader(fileEntry.offset);

    const dataStart = localHeaderInfo.localHeaderOffset + 30 + localHeaderInfo.filenameLength + localHeaderInfo.extraFieldLength;

    let content: Uint8Array;

    // 根据压缩方法处理
    if (localHeaderInfo.compressionMethod === 0) {
      // 未压缩（存储模式）
      const totalSize = length !== undefined ? Math.min(length, localHeaderInfo.uncompressedSize - start) : localHeaderInfo.uncompressedSize - start;

      if (start >= localHeaderInfo.uncompressedSize) {
        throw new Error('起始位置超出文件大小');
      }

      const chunkSize = 1024 * 1024;
      const chunks: Uint8Array[] = [];
      let loaded = 0;

      for (let offset = start; offset < start + totalSize; offset += chunkSize) {
        const remaining = Math.min(chunkSize, start + totalSize - offset);
        const chunk = await this._readRange(dataStart + offset, remaining);
        chunks.push(chunk);
        loaded += chunk.length;

        if (onProgress) {
          onProgress(loaded, totalSize);
        }
      }

      content = new Uint8Array(totalSize);
      let position = 0;
      for (const chunk of chunks) {
        content.set(chunk, position);
        position += chunk.length;
      }
    } else if (localHeaderInfo.compressionMethod === 8) {
      // DEFLATE 压缩
      if (start !== 0 || length !== undefined) {
        console.warn('警告：压缩文件不支持部分读取，将返回完整解压内容');
      }

      // 读取完整的压缩数据
      const compressedData = await this._readRange(dataStart, localHeaderInfo.compressedSize);
      
      // 解压数据
      try {
        content = inflateSync(compressedData);
      } catch (error) {
        throw new Error(`解压失败：${error instanceof Error ? error.message : '未知错误'}`);
      }

      // 验证解压后的大小
      if (content.length !== localHeaderInfo.uncompressedSize) {
        console.warn(`警告：解压后大小 (${content.length}) 与预期 (${localHeaderInfo.uncompressedSize}) 不符`);
      }

      if (onProgress) {
        onProgress(content.length, content.length);
      }
    } else {
      throw new Error(`不支持的压缩方法：${localHeaderInfo.compressionMethod}，目前只支持存储模式（0）和 DEFLATE（8）`);
    }

    return {
      filename,
      content: asUint8Array ? content : new Blob([new Uint8Array(content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength) as ArrayBuffer)]),
      fileInfo: fileEntry.info
    };
  }

  /**
   * 以流式方式获取 ZIP 文件中指定文件的内容
   * 适用于超大文件，返回异步迭代器
   * 注意：目前只支持未压缩的文件（compressionMethod = 0）
   * @param filename 文件名
   * @param chunkSize 分块大小（字节），默认 1MB
   * @returns 异步字节流
   */
  async *streamFileContent(filename: string, chunkSize: number = 1024 * 1024): AsyncGenerator<Uint8Array> {
    const fileEntry = await this._findFileEntry(filename);
    const localHeaderInfo = await this._readLocalHeader(fileEntry.offset);

    if (localHeaderInfo.compressionMethod !== 0) {
      throw new Error(`流式读取不支持压缩文件，当前文件使用压缩方法：${localHeaderInfo.compressionMethod}`);
    }

    const dataStart = localHeaderInfo.localHeaderOffset + 30 + localHeaderInfo.filenameLength + localHeaderInfo.extraFieldLength;
    const totalSize = localHeaderInfo.uncompressedSize;

    for (let offset = 0; offset < totalSize; offset += chunkSize) {
      const remaining = Math.min(chunkSize, totalSize - offset);
      const chunk = await this._readRange(dataStart + offset, remaining);
      yield chunk;
    }
  }

  /**
   * 获取当前使用的 User-Agent
   * @returns User-Agent 字符串
   */
  getUserAgent(): string {
    return this.userAgent;
  }
}
