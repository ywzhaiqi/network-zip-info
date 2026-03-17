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
  .option('-f, --file <filename>', '提取指定文件的内容')
  .option('-o, --output <output>', '输出文件路径（与 --file 一起使用）')
  .action(async (url, options) => {
    try {
      console.log(`正在分析 ZIP 文件：${url}`);
      console.log("-".repeat(60));

      // 创建网络 ZIP 读取器
      const reader = new NetworkZipReader(url, 30, options.userAgent);
      await reader.initialize();

      // 如果指定了文件提取
      if (options.file) {
        console.log(`正在提取文件：${options.file}`);
        console.log("-".repeat(60));
        
        const result = await reader.getFileContent(options.file, {
          onProgress: (loaded, total) => {
            const percent = ((loaded / total) * 100).toFixed(1);
            console.log(`\r进度：${percent}% (${loaded}/${total} 字节)`, '');
          }
        });
        
        console.log(`\n文件信息:`);
        console.log(`  文件名：${result.fileInfo.filename}`);
        console.log(`  大小：${formatSize(result.fileInfo.fileSize)}`);
        console.log(`  压缩方法：${result.fileInfo.compressionMethod === 0 ? '存储' : result.fileInfo.compressionMethod === 8 ? 'DEFLATE' : `未知 (${result.fileInfo.compressionMethod})`}`);
        console.log(`  内容大小：${result.content instanceof Uint8Array ? result.content.length : 'Blob'} 字节`);
        
        if (options.output) {
          const fs = await import('fs');
          const content = result.content instanceof Uint8Array ? result.content : new Uint8Array(await (result.content as Blob).arrayBuffer());
          fs.writeFileSync(options.output, content);
          console.log(`\n文件已保存到：${options.output}`);
        } else {
          // 如果是文本文件，显示前 1000 个字符
          if (options.file.endsWith('.txt') || options.file.endsWith('.md') || options.file.endsWith('.json')) {
            const text = new TextDecoder().decode(result.content as Uint8Array);
            console.log("\n文件内容预览:");
            console.log("-".repeat(60));
            console.log(text.substring(0, 1000));
            if (text.length > 1000) {
              console.log(`\n...（还有 ${text.length - 1000} 字符未显示）`);
            }
          } else {
            console.log("\n提示：使用 -o 参数保存文件到磁盘");
          }
        }
        return;
      }

      // 显示使用的 User-Agent
      const currentUa = reader.getUserAgent();
      console.log(`使用的 User-Agent: ${currentUa}`);
      console.log("-".repeat(60));
      
      // 获取摘要信息
      const summary = await reader.getSummary();
      console.log("ZIP 文件摘要:");
      console.log(`  文件总数：${summary.files}`);
      console.log(`  目录总数：${summary.directories}`);
      console.log(`  原始大小：${formatSize(summary.totalSize)}`);
      console.log(`  压缩大小：${formatSize(summary.compressedSize)}`);
      console.log(`  压缩率：${summary.compressionRatio.toFixed(1)}%`);
      console.log(`  ZIP 文件大小：${formatSize(summary.zipFileSize)}`);
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
