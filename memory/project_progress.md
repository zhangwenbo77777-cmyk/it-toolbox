# IT 工具箱项目进度

## 当前版本
- 正式版：v1.0.8（main 分支）
- 开发版：v1.1.0-beta（dev 分支）— CPU 实时频率检测

## 已完成功能

### 1. 系统托盘功能
- ✅ 点击关闭/最小化按钮时，应用最小化到系统托盘
- ✅ 托盘图标：assets/tray-icon.png (16x16)
- ✅ 托盘菜单：显示主窗口、退出程序
- ✅ 双击托盘图标显示主窗口

### 2. 内存警告系统托盘通知
- ✅ 使用 Electron 全局 Notification API
- ✅ 内存占用率超过 90% 时弹出 Windows 系统通知
- ✅ 通知在应用最小化到托盘后也能正常工作
- ✅ 点击通知会显示并聚焦主窗口
- ✅ 使用防重复机制，避免重复弹窗
- ✅ 每 10 秒检测一次内存占用（原 3 秒，优化为 10 秒）

### 3. 电脑配置模块修复
- ✅ 修复了 baseboard.model 的拼写错误（原来是 baseboardboard.model）
- ✅ 电脑配置信息现在能正常显示

### 4. 打包配置优化
- ✅ 设置 "asar": false 避免 asar 打包问题
- ✅ 移除了有问题的 node-notifier 依赖
- ✅ 最终使用 Electron 原生 Notification API

### 5. 侧边栏导航
- ✅ 左侧 70px 固定侧边栏，图标+文字竖排
- ✅ 选中态：红色竖条 + 红色渐变背景
- ✅ 三个页面：硬件信息 / 网络检测 / 快捷访问

### 6. 网络检测页面
- ✅ 网卡信息卡片（MAC、IPv4、DNS，虚拟网卡标注）
- ✅ 系统代理开关（读写注册表 ProxyEnable）
- ✅ Ping 测试（单次 / 持续，GBK 解码，颜色区分结果）

### 7. 快捷访问页面
- ✅ 9 个系统工具一键打开（程序和功能、设备管理器、磁盘管理等）
- ✅ Windows 凭据管理带红色高亮提示

### 8. 性能优化
- ✅ 持久化 PowerShell 会话（110ms vs 1612ms，14.6 倍提升）
- ✅ GPU 数据合并到实时轮询，不再单独调用
- ✅ GPU 名称/驱动缓存（运行时不变）
- ✅ nvidia-smi 5 秒缓存
- ✅ 实时轮询间隔从 5s 优化到 8s
- ✅ 启动时串行加载，避免 PS 会话争抢

### 9. 存储设备
- ✅ 磁盘列表（类型、容量、接口、盘符）
- ✅ NVMe/SATA/USB 识别和颜色区分
- ✅ 跨区卷盘符修复（WMI 关联链替代 Get-Partition）
- ✅ 硬盘接口检测 v2（M.2/SATA 占用+估算）
- ✅ SMBIOS 直读内存插槽数

## 技术实现要点

### 主进程 (main.js)
- 持久化 PS 会话：stdin/stdout 通信，base64 编码命令，`<<<KS_END>>>` 标记结束
- `checkMemoryUsage()` 在主进程运行（10秒间隔），窗口隐藏时跳过
- `showMemoryWarningNotification()` 使用 Electron 全局 Notification 类
- GPU 缓存：首次通过 WMI 获取，后续复用
- nvidia-smi 缓存：5 秒 TTL
- 实时轮询合并：一次 PS 调用获取 CPU + GPU + 内存

### 渲染进程 (renderer.js)
- 应用内弹窗 showMemoryAlert（主窗口显示时）
- 侧边栏懒加载：网络/快捷页面首次切换时才加载
- GBK 解码器处理 ping 中文输出
- 内存警告防重复 + "不再提醒" 选项

## 待优化事项
- [ ] 添加通知阈值可配置功能
- [ ] 添加检测间隔可配置功能
- [ ] 添加通知声音自定义功能

## 开发历史
- v1.0.8：持久化 PS 会话、GPU 合并轮询、SMBIOS 内存插槽、跨区卷修复、硬盘接口检测 v2
- v1.1.0-beta：CPU 实时频率检测（支持 AMD/Intel 睿频）、ks-hardware.exe 多模式查询
