# IT 工具箱 — Claude Code 开发指南

## 项目概述
基于 Electron 28 的 Windows 系统监控应用，红色主题 (#dc143c)，品牌标识 "KS"。

## 双环境工作流
- **正式环境** `E:\ITgjx` — `main` 分支，稳定版，不直接修改
- **测试环境** `E:\ITgjx-dev` — `dev` 分支，所有开发在此进行
- 测试通过后合并到 main：`cd E:\ITgjx && git merge dev && git push`

## 开发规范
- 所有新功能在 dev 分支开发，稳定后合并到 main
- 每次修改完运行 `npm start` 测试，确认无误后 git push
- 打包命令：`npm run build:win`（产物在 dist/）
- VS Code 终端运行前需执行：`$env:ELECTRON_RUN_AS_NODE=""`

## 项目结构
```
main.js              — 主进程（IPC handlers、持久化 PS 会话、GPU 缓存、内存警告）
preload.js           — 安全 API 桥接（14 个方法暴露给渲染进程）
renderer/
  index.html         — 三页面 UI：硬件信息 / 网络检测 / 快捷访问
  renderer.js        — 前端逻辑：加载/渲染/轮询/交互
  styles.css         — 全部样式
bin/                 — C# 工具：ks-smbios.exe（内存插槽）、ks-hardware.exe（硬件查询）
assets/              — 图标资源
CrystalDiskInfo/     — 硬盘 SMART 信息工具
memory/              — 开发进度记录（跨电脑同步）
```

## 核心架构要点
- **持久化 PowerShell 会话**：stdin/stdout + base64 编码命令，避免每次启动 powershell.exe
- **GPU 双路径**：NVIDIA 用 nvidia-smi（5秒缓存），其他用 PS 性能计数器
- **实时轮询**：8秒间隔，合并 CPU/GPU/内存到一次 PS 调用
- **串行加载**：启动时依次加载 配置→实时数据→磁盘，避免 PS 会话争抢
- **GBK 解码**：ping 输出用 binary 模式读取后 decodeGbk 转码

## 跨电脑同步
- 代码通过 git push/pull 同步
- 开发进度通过 `memory/project_progress.md` 同步
- **开始工作前**：`git pull`
- **结束工作后**：`git add . && git commit -m "描述" && git push`
- Claude Code 读取本文件和 memory/ 目录即可了解项目全貌

## 用户偏好
- 尽量少点确认按钮，给予最高权限自主执行
- 只有真正破坏性操作才需要确认
- 不要过度提问，合理时直接用默认方案
