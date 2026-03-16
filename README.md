# network-zip-info

通过网络 Range 请求获取 ZIP 文件信息，无需下载完整文件。

## 功能特点

- 🚀 **无需下载完整文件** - 仅通过 HTTP Range 请求读取 ZIP 文件的中央目录
- 📦 **获取完整信息** - 支持获取文件列表、大小、压缩率等详细信息
- 🔧 **CLI 工具** - 提供命令行工具，方便快速查看 ZIP 文件信息
- 📚 **TypeScript 支持** - 完整的类型定义

## 安装

```bash
pnpm add network-zip-info
```

## 使用方法

### 作为库使用

```typescript
import { NetworkZipReader } from 'network-zip-info';
import type { ZipFileInfo, ZipSummary } from 'network-zip-info';

async function inspectZipFile(url: string) {
  // 创建读取器
  const reader = new NetworkZipReader(url);
  await reader.initialize();
  
  // 获取摘要信息
  const summary: ZipSummary = await reader.getSummary();
  console.log('文件总数:', summary.files);
  console.log('压缩率:', summary.compressionRatio.toFixed(1) + '%');
  
  // 获取文件列表
  const files: ZipFileInfo[] = await reader.getFileList();
  files.forEach(file => {
    console.log(file.filename, file.fileSize);
  });
}
```

### 使用 CLI 工具

```bash
# 查看 ZIP 文件信息
npx network-zip-info <url>

# 自定义 User-Agent
npx network-zip-info <url> -u "Custom User-Agent"
```

#### CLI 输出示例

```
正在分析 ZIP 文件：https://example.com/file.zip
------------------------------------------------------------
使用的 User-Agent: Mozilla/5.0 ...
------------------------------------------------------------
ZIP 文件摘要:
  文件总数：10
  目录总数：2
  原始大小：1.5 MB
  压缩大小：500 KB
  压缩率：66.7%
  ZIP 文件大小：520 KB

文件列表:
------------------------------------------------------------
类型 文件名                                    大小         修改时间
------------------------------------------------------------
FILE document.txt                              100 KB       2024-01-01 12:00:00
FILE image.png                                 200 KB       2024-01-01 12:00:00
DIR  folder/                                   -            2024-01-01 12:00:00
```

## API 参考

### NetworkZipReader

#### 构造函数

```typescript
new NetworkZipReader(url: string, timeout?: number, userAgent?: string, debug?: boolean)
```

- `url` - ZIP 文件的 URL
- `timeout` - 请求超时时间（秒），默认 30 秒
- `userAgent` - 自定义 User-Agent
- `debug` - 是否启用调试日志，默认 false

#### 方法

##### `initialize()`

初始化读取器，检查服务器是否支持 Range 请求。

```typescript
await reader.initialize();
```

##### `getSummary()`

获取 ZIP 文件的摘要信息。

```typescript
const summary = await reader.getSummary();
```

返回 `ZipSummary` 对象：
- `url` - ZIP 文件 URL
- `totalEntries` - 总条目数
- `files` - 文件数量
- `directories` - 目录数量
- `totalSize` - 总大小（字节）
- `compressedSize` - 压缩后大小（字节）
- `compressionRatio` - 压缩率（百分比）
- `zipFileSize` - ZIP 文件大小（字节）

##### `getFileList()`

获取 ZIP 文件中的所有文件信息。

```typescript
const files = await reader.getFileList();
```

返回 `ZipFileInfo[]` 数组，每个元素包含：
- `filename` - 文件名
- `fileSize` - 文件大小（字节）
- `compressedSize` - 压缩后大小（字节）
- `crc32` - CRC32 校验和
- `compressionMethod` - 压缩方法
- `lastModified` - 最后修改时间
- `isDirectory` - 是否为目录
- `comment` - 注释

### 工具函数

```typescript
import { formatSize, dosTimeToDateTime } from 'network-zip-info';

// 格式化文件大小
formatSize(1024); // "1.00 KB"

// 解析 DOS 时间
dosTimeToDateTime(0x4D71, 0xB9F5); // Date 对象
```

## 注意事项

- 目标服务器需要支持 HTTP Range 请求
- 仅适用于标准 ZIP 文件格式
- 对于非常大的 ZIP 文件，可能需要调整超时时间

## 开发

```bash
# 安装依赖
pnpm install

# 构建
pnpm run build

# 开发模式
pnpm run dev

# 运行测试
pnpm run test

# 类型检查
pnpm run typecheck
```

## 许可证

MIT
