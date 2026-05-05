# 侧边栏导航 + 网络检测功能设计

## 概述
为 IT 工具箱添加左侧导航栏，支持多页面切换。当前页面内容整体成为「硬件信息」页面，新增「网络检测」页面。侧边栏设计需支持后续扩展更多导航项。

## 侧边栏设计

### 布局
- 左侧固定 70px 宽侧边栏，右侧为内容区
- 侧边栏顶部：KS Logo 图标（复用现有 logo-icon 样式，缩小版）
- 下方导航项：图标 + 文字竖排

### 导航项样式
- 选中态：左侧 3px 红色竖条 + 图标红色渐变背景 + 文字红色
- 未选中态：图标灰色背景 + 文字灰色
- Hover：背景微微泛红
- 点击切换时内容区淡入淡出（CSS transition 0.2s）

### 导航项（初始）
1. 硬件信息 — 当前所有内容
2. 网络检测 — 新增页面
3. 后续扩展位（快捷启动等）

### 内容区
- 现有页面 HTML 整体包裹在 `#page-hardware` div 中
- 新增 `#page-network` div，默认隐藏
- 切换时 display 控制 + opacity transition

## 网络检测页面

### 区域 1：网卡信息卡片
- 每个网卡一张卡片，沿用现有磁盘卡片样式
- 虚拟网卡右上角标注灰色「虚拟」标签
- 卡片内容：网卡名称、MAC 地址、IPv4 地址、DNS 服务器地址
- 数据来源：systeminformation.networkInterfaces() + PowerShell 获取 DNS

### 区域 2：网络代理
- 显示 Windows 系统代理状态（开启/关闭）
- 红色渐变开关组件（toggle switch）
- 开关与 Windows 设置同步：此处切换 = 修改注册表 ProxyEnable 值
- 代理开启时显示代理服务器地址（ProxyServer 注册表值）
- 注册表路径：HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings
- 读取：ProxyEnable (REG_DWORD), ProxyServer (REG_SZ)
- 写入：修改 ProxyEnable 值（不需要管理员权限）

### 区域 3：连通性测试
- 输入框 + 「测试」按钮，默认目标 baidu.com
- 点击后执行 ping 并显示结果
- 结果颜色：成功绿色、超时橙色、失败红色
- 显示延迟 ms 数值

## 技术实现

### 前端改动
- index.html：添加侧边栏结构，将现有内容包裹在 page-hardware 中，新增 page-network
- styles.css：添加侧边栏样式、页面切换动画、网络检测页面样式
- renderer.js：添加侧边栏切换逻辑、网络检测页面交互逻辑

### 后端改动
- main.js：新增 IPC handler `get-network-info`（网卡信息+DNS）、`get-proxy-status`（代理状态）、`set-proxy-status`（切换代理）
- preload.js：暴露新的 API 方法

### 数据获取
- 网卡信息：si.networkInterfaces()
- DNS：PowerShell `Get-DnsClientServerAddress`
- 代理状态：注册表读取 ProxyEnable/ProxyServer
- 代理切换：注册表写入 ProxyEnable
- Ping：Node.js child_process 执行 ping 命令
