#!/usr/bin/env node

import { NetworkZipReader } from './NetworkZipReader';
import { formatSize } from './utils';
import { program } from 'commander';

program
  .name('network-zip-info')
  .description('通过网络 Range 请求获取 ZIP 文件信息，无需下载完整文件')
  .version('1.0.0')
  .argument('<url>', 'ZIP 文件的 URL')
  .option('-u, --user-agent <userAgent>', '自定义 User-Agent')
  .action(async (url, options) => {
    try {
      console.log(`正在分析 ZIP 文件: ${url}`);
      console.log("-".repeat(60));

      // 创建网络 ZIP 读取器
      const reader = new NetworkZipReader(url, 30, options.userAgent);
      await reader.initialize();

      // 显示使用的 User-Agent
      const currentUa = reader.getUserAgent();
      console.log(`使用的 User-Agent: ${currentUa}`);
      console.log("-".repeat(60));
      
      // 获取摘要信息
      const summary = await reader.getSummary();
      console.log("ZIP 文件摘要:");
      console.log(`  文件总数: ${summary.files}`);
      console.log(`  目录总数: ${summary.directories}`);
      console.log(`  原始大小: ${formatSize(summary.totalSize)}`);
      console.log(`  压缩大小: ${formatSize(summary.compressedSize)}`);
      console.log(`  压缩率: ${summary.compressionRatio.toFixed(1)}%`);
      console.log(`  ZIP 文件大小: ${formatSize(summary.zipFileSize)}`);
      console.log();
      
      // 获取文件列表
      const files = await reader.getFileList();
      
      console.log("文件列表:");
      console.log("-".repeat(60));
      console.log(`${'类型'.padEnd(4)} ${'文件名'.padEnd(40)} ${'大小'.padEnd(12)} 修改时间`);
      console.log("-".repeat(60));
      
      for (const fileInfo of files) {
        const fileType = fileInfo.isDirectory ? "DIR " : "FILE";
        const sizeStr = fileInfo.isDirectory ? "-" : formatSize(fileInfo.fileSize);
        const timeStr = fileInfo.lastModified.toLocaleString();
        
        // 截断过长的文件名
        let displayName = fileInfo.filename;
        if (displayName.length > 40) {
          displayName = displayName.substring(0, 37) + "...";
        }
        
        console.log(`${fileType.padEnd(4)} ${displayName.padEnd(40)} ${sizeStr.padEnd(12)} ${timeStr}`);
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : '未知错误';
      console.error(`错误：${message}`);
      process.exit(1);
    }
  });

program.parse();
