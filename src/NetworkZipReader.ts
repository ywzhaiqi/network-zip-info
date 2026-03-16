import type { ZipFileInfo, ZipSummary, CentralDirectoryInfo } from './types';
import { dosTimeToDateTime } from './utils';

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
        signal: AbortSignal.timeout(this.timeout),
        cache: 'no-store'
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
        signal: AbortSignal.timeout(this.timeout),
        cache: 'no-store'
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
   * @returns 文件信息列表
   */
  private async _readCentralDirectory(cdOffset: number, cdSize: number): Promise<ZipFileInfo[]> {
    const cdData = await this._readRange(cdOffset, cdSize);
    const files: ZipFileInfo[] = [];
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

      // const versionMade = this._readUint16LE(cdData, offset + 4);
      // const versionNeeded = this._readUint16LE(cdData, offset + 6);
      // const flags = this._readUint16LE(cdData, offset + 8);
      const compressionMethod = this._readUint16LE(cdData, offset + 10);
      const lastModTime = this._readUint16LE(cdData, offset + 12);
      const lastModDate = this._readUint16LE(cdData, offset + 14);
      const crc32 = this._readUint32LE(cdData, offset + 16);
      const compressedSize = this._readUint32LE(cdData, offset + 20);
      const uncompressedSize = this._readUint32LE(cdData, offset + 24);
      const filenameLength = this._readUint16LE(cdData, offset + 28);
      const extraLength = this._readUint16LE(cdData, offset + 30);
      const commentLength = this._readUint16LE(cdData, offset + 32);
      // const diskStart = this._readUint16LE(cdData, offset + 34);
      // const internalAttrs = this._readUint16LE(cdData, offset + 36);
      const externalAttrs = this._readUint32LE(cdData, offset + 38);
      // const localHeaderOffset = this._readUint32LE(cdData, offset + 42);

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
        comment
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
      return files;
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
   * 获取当前使用的 User-Agent
   * @returns User-Agent 字符串
   */
  getUserAgent(): string {
    return this.userAgent;
  }
}
