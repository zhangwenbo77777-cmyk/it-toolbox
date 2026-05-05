# IT工具箱

基于 Electron 的 Windows 系统监控应用，提供硬件信息检测、网络诊断和系统工具快捷访问。

## 功能

### 硬件信息
- **实时监控**：CPU 占用率 / 实时频率 / 温度、内存占用 / 插槽状态、GPU 占用率 / 温度 / 显存
- **电脑配置**：处理器、主板、内存、显卡、声卡、网卡详细信息
- **存储设备**：磁盘列表（类型、容量、接口、盘符），支持 NVMe/SATA/USB 识别
- **硬盘接口**：M.2 和 SATA 接口使用情况
- **内存警告**：占用超过 90% 自动弹窗提醒
- **跨区卷支持**：通过 WMI 关联链正确映射盘符

### 网络检测
- **网卡信息**：MAC 地址、IPv4、DNS 服务器
- **代理设置**：系统代理状态查看和开关
- **Ping 测试**：单次 / 持续测试，可视化结果

### 快捷访问
9 个系统工具一键打开：程序和功能、设备管理器、磁盘管理、网络连接、任务管理器、电源选项、防火墙、启动项管理、Windows 凭据管理

## 技术栈

| 技术 | 用途 |
|------|------|
| Electron 28 | 桌面应用框架 |
| systeminformation | 系统信息采集 |
| PowerShell (WMI) | Windows 硬件查询、性能计数器 |
| nvidia-smi | NVIDIA GPU 温度 / 显存 |
| C# (ks-smbios.exe / ks-hardware.exe) | SMBIOS 直读、CPU 频率查询 |
| electron-builder | NSIS 安装包打包 |

## 下载与运行

### 环境要求

- Windows 10/11 (x64)
- [Node.js](https://nodejs.org/) v18+（推荐 LTS 版本，安装时勾选 "Add to PATH"）
- [Git](https://git-scm.com/)

### 步骤一：下载正式环境

正式环境对应 `main` 分支，是当前稳定版本，用于日常使用。

```bash
git clone https://github.com/zhangwenbo77777-cmyk/it-toolbox.git
cd it-toolbox
npm install
npm start
```

### 步骤二：下载测试环境

测试环境对应 `dev` 分支，包含最新开发中的功能，用于开发和验证。请另开一个终端执行：

```bash
git clone https://github.com/zhangwenbo77777-cmyk/it-toolbox.git it-toolbox-dev
cd it-toolbox-dev
git checkout dev
npm install
npm start
```

> 两个环境目录完全独立，可以同时运行互不影响。

### 步骤三：配置开发环境

两个环境下载完成后，即可使用 Claude Code 或 VS Code (Copilot) 进行开发：

**Claude Code：**

```bash
# 安装 Claude Code CLI
npm install -g @anthropic-ai/claude-code

# 进入测试环境开始开发
cd it-toolbox-dev
claude
```

**VS Code (Copilot)：**

用 VS Code 打开 `it-toolbox-dev` 文件夹，即可使用 Copilot 辅助编码。

> **重要**：所有新功能请在测试环境（dev 分支）开发，测试通过后再合并到正式环境。

### 打包

```bash
npm run build:win
```

打包产物在 `dist/` 目录下，生成 NSIS 安装程序。

## 项目结构

```
it-toolbox/
├── main.js              # 主进程（IPC、系统调用、PowerShell 会话）
├── preload.js           # 安全 API 桥接
├── renderer/
│   ├── index.html       # UI 页面（硬件/网络/快捷访问三页）
│   ├── renderer.js      # 前端逻辑
│   └── styles.css       # 样式
├── bin/
│   ├── ks-smbios.exe    # SMBIOS Type 17 内存插槽检测
│   ├── ks-smbios.cs     # 源码
│   ├── ks-hardware.exe  # 硬件信息查询（--realtime / --smbios / --disk）
│   └── ks-hardware.cs   # 源码
├── assets/              # 图标资源
├── CrystalDiskInfo/     # 硬盘 SMART 信息工具
└── package.json         # 项目配置
```

## 使用 Claude Code 继续开发

在步骤三中已安装的 Claude Code，进入测试环境目录即可使用：

```bash
cd it-toolbox-dev
claude
```

可以直接用自然语言描述需求，例如：

```
帮我修复 CPU 频率在老机器上轮询卡顿的问题
给网络检测页面加一个刷新按钮
把 GPU 占用率的波浪动画改成进度条
```

### 开发规范

- **所有新功能在 dev 分支开发**，测试稳定后合并到 main
- **关键改动必须先确认再执行**——Claude Code 会在执行前询问
- **每次更新完记得打包**：`npm run build:win`
- **VS Code 终端运行时**需先执行 `unset ELECTRON_RUN_AS_NODE`

### 双环境工作流

```
正式环境  e:\ITgjx       main 分支  ← 合并后的稳定版
测试环境  e:\ITgjx-dev   dev 分支   ← 日常开发
```

```bash
# 在测试环境开发新功能
cd e:\ITgjx-dev
# ... 修改代码 ...
git add . && git commit -m "feat: 新功能描述"
git push

# 测试通过后，合并到正式环境
cd e:\ITgjx
git merge dev
git push
```

## 版本历史

### v1.0.8（当前正式版）
- 持久化 PowerShell 会话（110ms vs 1612ms，14.6 倍提升）
- GPU 数据合并到实时轮询
- SMBIOS 直读内存插槽
- 跨区卷盘符修复
- 硬盘接口检测 v2
- 窗口飙升修复 + 串行加载

### v1.1.0-beta（当前开发版）
- CPU 实时频率检测（支持 AMD/Intel 睿频）
- ks-hardware.exe 多模式硬件查询工具

## License

MIT
