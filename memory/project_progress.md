# IT 工具箱项目进度

## 已完成功能

### 1. 系统托盘功能
- ✅ 点击关闭/最小化按钮时，应用最小化到系统托盘
- ✅ 托盘图标：assets/tray-icon.png (16x16)
- ✅ 托盘菜单：显示主窗口、退出程序
- ✅ 双击托盘图标显示主窗口

### 2. 内存警告系统托盘通知
- ✅ 使用 Electron 全局 Notification API
- ✅免内存占用率超过 90% 时弹出 Windows 系统通知
- ✅ 通知在应用最小化到托盘后也能正常工作
- ✅ 点击通知会显示并聚焦主窗口
- ✅ 使用防重复机制，避免重复弹窗
- ✅ 每 3 秒检测一次内存占用

### 3. 电脑配置模块修复
- ✅ 修复了 baseboard.model 的拼写错误（原来是 baseboardboard.model）
- ✅ 电脑配置信息现在能正常显示

### 4. 打包配置优化
- ✅ 设置 "asar": false 避免 asar 打包问题
- ✅ 移除了有问题的 node-notifier 依赖
- ✅ 最终使用 Electron 原生 Notification API

## 技术实现要点

### 主进程 (main.js)
- 使用 `setInterval` 在主进程中运行内存检测（3秒间隔）
- `checkMemoryUsage()` 函数检测内存并触发通知
- `showMemoryWarningNotification()` 函数使用 Electron 全局 Notification 类
- 内存检测独立于渲染进程，窗口隐藏/最小化时仍继续运行

### 渲染进程 (renderer.js)
- 保留了原有的应用内弹窗功能（showMemoryAlert）
- 这是在主窗口显示时的应用内警告
- 主进程的系统通知是在托盘状态下的系统级警告

## 文件修改清单

### main.js
- 添加 Notification 引入
- 添加 checkMemoryUsage() 函数
- 添加 showMemoryWarningNotification() 函数
- 在 app.whenReady() 中启动定时器
- 修复 get-config-info 中的 baseboard 拼写错误

### package.json
- 添加 "asar": false 配置
- 保留原有的依赖配置

## 测试验证
- ✅ 开发版测试：pnpm run start
- ✅ 安装版测试：dist/IT工具箱 Setup 2.0.0.exe
- ✅ 托盘状态下内存通知功能正常工作
- ✅ 电脑配置模块显示正常

## 待优化事项
- [ ] 添加通知阈值可配置功能
- [ ] 添加检测间隔可配置功能
- [ ] 添加通知声音自定义功能
