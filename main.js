const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, Notification } = require('electron');
const path = require('path');
const si = require('systeminformation');
const { exec, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');

// ============================================================
// 持久化 PowerShell 会话 — stdin/stdout 通信
// 命令通过 base64 编码发送，避免转义问题
// 输出以 "<<<KS_END:id>>>" 标记结束，支持并发
// ============================================================
let psSession = null;
let psInput = null;
let psBuffer = '';
let psCallbacks = new Map(); // id -> { resolve, timer }
let psCmdId = 0;
let psReady = false;
let psRestarting = false;

let psReadyResolve = null; // 用于等待 PS 会话就绪

function startPsSession() {
  if (psSession && !psSession.killed && psReady) return;

  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;

  // 持久 PS 会话脚本：读取 base64 编码命令，解码执行，输出结果 + 结束标记
  // 注意：不能用模板字符串，因为 PS 中的 ${...} 会被 JS 解释
  const psScript = [
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8',
    'while ($null -ne ($b64 = [Console]::In.ReadLine())) {',
    "  if ($b64 -eq 'EXIT') { break }",
    '  try {',
    '    $bytes = [Convert]::FromBase64String($b64)',
    '    $cmd = [System.Text.Encoding]::UTF8.GetString($bytes)',
    '    $result = Invoke-Expression $cmd 2>&1 | Out-String',
    '    Write-Host $result -NoNewline',
    '  } catch {',
    '    Write-Host "ERROR: $($_.Exception.Message)" -NoNewline',
    '  }',
    '  Write-Host "<<<KS_END>>>"',
    '}'
  ].join('\n');

  psSession = spawn('powershell', [
    '-ExecutionPolicy', 'Bypass',
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    psScript
  ], { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });

  psInput = psSession.stdin;
  psBuffer = '';
  psReady = false; // 等待握手完成后才设为 true

  // 先注册 data 监听器，再发送握手命令
  psSession.stdout.on('data', (data) => {
    psBuffer += data.toString('utf8');
    // 检查完整的命令响应
    while (psBuffer.includes('<<<KS_END>>>')) {
      const endIdx = psBuffer.indexOf('<<<KS_END>>>');
      const output = psBuffer.substring(0, endIdx);
      psBuffer = psBuffer.substring(endIdx + '<<<KS_END>>>'.length);

      // 按队列顺序匹配回调
      const firstKey = psCallbacks.keys().next().value;
      if (firstKey !== undefined) {
        const cb = psCallbacks.get(firstKey);
        psCallbacks.delete(firstKey);
        if (cb.timer) clearTimeout(cb.timer);
        cb.resolve(output.trim());
      }
    }
  });

  psSession.stderr.on('data', () => {});

  psSession.on('close', () => {
    psSession = null;
    psInput = null;
    psReady = false;
    for (const [, cb] of psCallbacks) {
      if (cb.timer) clearTimeout(cb.timer);
      cb.resolve(null);
    }
    psCallbacks.clear();
    if (!isQuitting && !psRestarting) {
      psRestarting = true;
      setTimeout(() => { psRestarting = false; startPsSession(); }, 3000);
    }
  });

  // 发送握手命令验证 PS 会话可用
  const handshakeB64 = Buffer.from('Write-Host "OK"', 'utf8').toString('base64');
  psReadyResolve = null;
  const handshakeId = ++psCmdId;
  psCallbacks.set(handshakeId, {
    resolve: (output) => {
      if (output && output.includes('OK')) {
        psReady = true;
        if (mainWindow) mainWindow.webContents.send('ps-ready');
      }
      if (psReadyResolve) psReadyResolve();
    },
    timer: null
  });
  try { psInput.write(handshakeB64 + '\n'); } catch {}
}

// 通过持久 PS 会话执行命令
// 如果 PS 会话尚未就绪，轮询等待（最多 5 秒），避免 fallback 弹出独立窗口
function execPsSession(script, timeout = 8000) {
  return new Promise(async (resolve) => {
    if (!psReady && psSession && !psSession.killed) {
      const deadline = Date.now() + 5000;
      while (!psReady && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 100));
      }
    }

    if (!psReady || !psInput) {
      execPs(script, timeout).then(resolve);
      return;
    }

    const id = ++psCmdId;
    const timer = setTimeout(() => {
      if (psCallbacks.has(id)) {
        psCallbacks.delete(id);
        resolve(null);
      }
    }, timeout);

    psCallbacks.set(id, { resolve, timer });

    try {
      // Base64 编码命令，避免所有转义问题
      const b64 = Buffer.from(script, 'utf8').toString('base64');
      psInput.write(b64 + '\n');
    } catch {
      psCallbacks.delete(id);
      clearTimeout(timer);
      resolve(null);
    }
  });
}

// 独立进程执行 PS（fallback + 非轮询场景）
const activePsChildren = new Set();

function execPs(script, timeout = 5000) {
  return new Promise((resolve) => {
    const tmpFile = path.join(os.tmpdir(), 'ks-monitor-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.ps1');
    fs.writeFileSync(tmpFile, script, 'utf8');
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const child = exec('powershell -ExecutionPolicy Bypass -NoProfile -File ' + tmpFile, { timeout, env, windowsHide: true }, (error, stdout) => {
      try { fs.unlinkSync(tmpFile); } catch {}
      activePsChildren.delete(child);
      if (error) { resolve(null); return; }
      resolve(stdout.trim());
    });
    activePsChildren.add(child);
  });
}

let mainWindow;
let notificationWindow = null;
let tray = null;
let isQuitting = false;
let memoryCheckTimer = null;

function createTray() {
  try {
    const iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
    let trayIcon;
    try {
      trayIcon = nativeImage.createFromPath(iconPath);
    } catch {
      trayIcon = nativeImage.createEmpty(16, 16);
    }

    const contextMenu = Menu.buildFromTemplate([
      { label: '显示主窗口', click: () => { if (mainWindow) mainWindow.show(); } },
      { type: 'separator' },
      { label: '退出程序', click: () => { app.quit(); } }
    ]);

    tray = new Tray(trayIcon);
    tray.setToolTip('KS 系统监控');
    tray.setContextMenu(contextMenu);

    tray.on('double-click', () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    });
  } catch (error) {
    console.warn('Failed to create system tray:', error);
  }
}

// 内存占用率检测
let memoryWarningLastState = false;
const MEMORY_WARNING_THRESHOLD = 90;
const MEMORY_CHECK_INTERVAL = 10000; // 3s → 10s

function checkMemoryUsage() {
  // 窗口隐藏时跳过
  if (mainWindow && !mainWindow.isVisible()) return;

  si.mem().then(mem => {
    const usage = (mem.used / mem.total) * 100;
    const usagePercent = Math.round(usage);

    if (usage >= MEMORY_WARNING_THRESHOLD && !memoryWarningLastState) {
      memoryWarningLastState = true;
      showMemoryWarningNotification(usagePercent);
    } else if (usage < MEMORY_WARNING_THRESHOLD) {
      memoryWarningLastState = false;
    }
  }).catch(() => {});
}

function showMemoryWarningNotification(usage) {
  try {
    const notification = new Notification({
      title: '内存占用过高',
      body: '当前内存占用率已达到 ' + usage + '%，建议关闭不必要的程序以释放内存',
      icon: path.join(__dirname, 'assets', 'icon.png'),
      silent: false,
      urgency: 'critical'
    });
    notification.show();
    notification.on('click', () => {
      if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
    });
  } catch {}
}

function createWindow() {
  const iconPath = path.join(__dirname, 'assets', 'icon.png');

  mainWindow = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1200,
    minHeight: 700,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    backgroundColor: '#f5f5f5',
    titleBarStyle: 'default',
    autoHideMenuBar: true,
    show: false
  });

  mainWindow.loadFile('renderer/index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    if (mainWindow) mainWindow.hide();
  });

  mainWindow.on('minimize', (event) => {
    event.preventDefault();
    if (mainWindow) mainWindow.hide();
  });
}

app.whenReady().then(() => {
  const appIconPath = path.join(__dirname, 'assets', 'icon.png');
  try {
    app.setAppUserModelId('com.ks.it-toolbox');
    app.setAboutPanelOptions({ iconPath: appIconPath });
  } catch {}

  startPsSession();
  createWindow();
  createTray();

  memoryCheckTimer = setInterval(checkMemoryUsage, MEMORY_CHECK_INTERVAL);
  app.on('activate', () => {
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });
});
app.on('window-all-closed', () => {});
app.on('before-quit', () => {
  isQuitting = true;
  if (tray) { tray.destroy(); tray = null; }
  if (memoryCheckTimer) { clearInterval(memoryCheckTimer); memoryCheckTimer = null; }
  if (pingProcess) { pingProcess.kill(); pingProcess = null; }
  // 关闭持久 PS 会话
  if (psInput) {
    try { psInput.write('EXIT\n'); } catch {}
  }
  if (psSession) {
    try { psSession.kill(); } catch {}
    psSession = null;
    psInput = null;
  }
  for (const child of activePsChildren) {
    try { child.kill(); } catch {}
  }
  activePsChildren.clear();
});

// ============================================================
// GPU 信息缓存 — GPU 名称/驱动在运行时不会变，只查一次
// ============================================================
let gpuCache = null; // { name, driver, vramTotalMB, isNvidia, isAmd }

async function getGpuCache() {
  if (gpuCache) return gpuCache;

  try {
    const result = await execPsSession(`Get-CimInstance -ClassName Win32_VideoController | Where-Object { $_.AdapterRAM -gt 0 } | Select-Object Name, DriverVersion, AdapterRAM | ConvertTo-Json`, 5000);
    if (result) {
      try {
        let gpuInfo = JSON.parse(result);
        if (!Array.isArray(gpuInfo)) gpuInfo = [gpuInfo];
        let gpu = gpuInfo.find(g => g.Name && (g.Name.toLowerCase().includes('nvidia') || g.Name.toLowerCase().includes('geforce') || g.Name.toLowerCase().includes('rtx') || g.Name.toLowerCase().includes('gtx')));
        if (!gpu) gpu = gpuInfo.find(g => g.Name && g.Name.toLowerCase().includes('radeon') && !g.Name.toLowerCase().includes('radeon(tm)'));
        if (!gpu) gpu = gpuInfo.find(g => g.Name && !g.Name.toLowerCase().includes('intel'));
        if (!gpu && gpuInfo.length > 0) gpu = gpuInfo[0];

        if (gpu) {
          const name = gpu.Name || 'Unknown';
          const isNvidia = /nvidia|geforce|rtx|gtx/i.test(name);
          const isAmd = /radeon|amd/i.test(name);
          gpuCache = {
            name,
            driver: gpu.DriverVersion || '',
            vramTotalMB: gpu.AdapterRAM ? (gpu.AdapterRAM / (1024 * 1024)) : 0,
            isNvidia,
            isAmd
          };
        }
      } catch {}
    }
  } catch {}

  if (!gpuCache) {
    gpuCache = { name: '未检测到', driver: '', vramTotalMB: 0, isNvidia: false, isAmd: false };
  }
  return gpuCache;
}

// ============================================================
// nvidia-smi 缓存 — 5 秒内复用结果，避免频繁调用
// ============================================================
let nvidiaCache = { data: null, timestamp: 0 };
const NVIDIA_CACHE_TTL = 5000;

async function getNvidiaSmiInfo() {
  const now = Date.now();
  if (nvidiaCache.data && (now - nvidiaCache.timestamp) < NVIDIA_CACHE_TTL) {
    return nvidiaCache.data;
  }

  try {
    const result = await new Promise((resolve) => {
      exec('nvidia-smi --query-gpu=utilization.gpu,temperature.gpu,memory.used,memory.total --format=csv,noheader,nounits', { timeout: 3000, windowsHide: true }, (error, stdout) => {
        if (error) { resolve(null); return; }
        const parts = stdout.trim().split(',').map(s => s.trim());
        if (parts.length >= 4) {
          resolve({ usage: parts[0], temp: parts[1], vramUsed: parts[2], vramTotal: parts[3] });
        } else resolve(null);
      });
    });

    nvidiaCache = { data: result, timestamp: now };
    return result;
  } catch {
    return null;
  }
}

// ============================================================
// 硬盘信息
// ============================================================
ipcMain.handle('get-disk-info', async () => {
  try {
    const [diskLayout, psResult] = await Promise.all([
      si.diskLayout(),
      // 用 Win32_LogicalDiskToPartition WMI 关联链替代 Get-Partition 做盘符映射
      // 优势：跨区卷/动态磁盘的从盘分区没有 DriveLetter，但 WMI 能正确关联逻辑盘到物理磁盘
      execPsSession(`$disks = Get-Disk | Select-Object Number, BusType, MediaType, IsDynamic
$mappings = @()
Get-CimInstance Win32_LogicalDiskToPartition | ForEach-Object {
  $dep = $_.Dependent.ToString()
  $ant = $_.Antecedent.ToString()
  $dl = $null; $dn = $null
  if ($dep -match '"([A-Z]):') { $dl = $Matches[1] }
  if ($ant -match 'Disk #') { $dn = [int](($ant -split 'Disk #')[1].Split(',')[0].Trim()) }
  if ($dl -and $dn -ne $null) { $mappings += @{ DriveLetter = $dl; DiskNumber = $dn } }
}
@{ Disks = $disks; Mappings = $mappings } | ConvertTo-Json -Depth 3`, 6000)
    ]);

    const diskMap = new Map();
    const diskPsMap = new Map();
    const mappingMap = new Map(); // diskNumber -> [driveLetter, ...]

    let psData = { Disks: [], Mappings: [] };
    if (psResult) {
      try {
        psData = JSON.parse(psResult);
        if (!Array.isArray(psData.Disks)) psData.Disks = psData.Disks ? [psData.Disks] : [];
        if (!Array.isArray(psData.Mappings)) psData.Mappings = psData.Mappings ? [psData.Mappings] : [];
      } catch {}
    }

    psData.Disks.forEach(diskPs => {
      diskPsMap.set(diskPs.Number, {
        busType: diskPs.BusType || 'Unknown',
        mediaType: diskPs.MediaType || 'Unknown',
        isDynamic: diskPs.IsDynamic || false
      });
    });

    // WMI 关联链：同一盘符可能跨多个物理磁盘（跨区卷），同一磁盘也可能有多个盘符
    psData.Mappings.forEach(m => {
      if (m.DiskNumber !== undefined && m.DriveLetter) {
        const letter = m.DriveLetter.toString().charAt(0);
        if (/^[A-Z]$/.test(letter)) {
          if (!mappingMap.has(m.DiskNumber)) mappingMap.set(m.DiskNumber, []);
          if (!mappingMap.get(m.DiskNumber).includes(letter)) {
            mappingMap.get(m.DiskNumber).push(letter);
          }
        }
      }
    });

    diskLayout.forEach(disk => {
      diskMap.set(disk.device, {
        name: disk.name || 'Unknown',
        type: disk.type || 'Unknown',
        busType: disk.interfaceType || 'Unknown',
        size: disk.size || 0,
        driveLetters: [],
        isDynamic: false,
        diskNumber: null
      });

      const match = disk.device.match(/PhysicalDrive(\d+)/i);
      if (match) {
        const diskNumber = parseInt(match[1]);
        diskMap.get(disk.device).diskNumber = diskNumber;

        if (diskPsMap.has(diskNumber)) {
          const psInfo = diskPsMap.get(diskNumber);
          if (!disk.interfaceType || disk.interfaceType === 'Unknown') {
            diskMap.get(disk.device).busType = psInfo.busType;
          }
          diskMap.get(disk.device).isDynamic = psInfo.isDynamic;
        }

        if (mappingMap.has(diskNumber)) {
          diskMap.get(disk.device).driveLetters = mappingMap.get(diskNumber);
        }
      }
    });

    const diskInfoResult = Array.from(diskMap.values()).map((disk, index) => {
      let interfaceDisplay = disk.busType;
      if (disk.busType === 'NVMe') interfaceDisplay = 'NVMe (M.2 PCIe)';

      let typeDisplay = disk.type || 'Unknown';
      if (typeDisplay === 'HD') typeDisplay = 'HDD';
      if (disk.busType === 'USB') typeDisplay = 'USB存储';

      const sizeGB = (disk.size / (1024 * 1024 * 1024)).toFixed(2);
      const sizeTB = (disk.size / (1024 * 1024 * 1024 * 1024)).toFixed(2);
      const sizeDisplay = disk.size >= 1024 * 1024 * 1024 * 1024 ? sizeTB + ' TB' : sizeGB + ' GB';

      let letters = disk.driveLetters.length > 0 ? [...new Set(disk.driveLetters)].join(', ') : '--';
      const diskTypeDisplay = disk.isDynamic ? '动态磁盘' : typeDisplay;

      return {
        name: disk.name,
        type: diskTypeDisplay,
        interface: interfaceDisplay,
        size: sizeDisplay,
        driveLetters: letters,
        device: disk.device,
        index: index
      };
    });

    return { success: true, data: diskInfoResult };
  } catch (e) {
    console.error('get-disk-info error:', e.message);
    return { success: false, error: e.message };
  }
});

// ============================================================
// 硬盘接口检测 — v2 优化版
// M.2 总数：SMBIOS M.2 关键词 → NVMe 控制器数（已用下限）
// SATA 总数：AHCI 控制器计数（每控制器通常 4-8 口）→ IDE 通道数
// 关键改进：返回 estimated 标志，让前端区分精确值和估算值
// ============================================================
ipcMain.handle('get-disk-slots', async () => {
  try {
    const result = await execPsSession(`$disks = Get-Disk | Where-Object { $_.BusType -ne 'USB' } | Select-Object Number, BusType
$ahciControllers = @(Get-CimInstance Win32_IDEController | Where-Object { $_.Name -match 'AHCI|SATA' })
$ahciCount = $ahciControllers.Count
$ideChannelCount = (@(Get-CimInstance Win32_IDEControllerDevice)).Count
$nvmeCtrlCount = @(Get-PnpDevice -Class 'SCSIAdapter' -Status OK -ErrorAction SilentlyContinue | Where-Object { $_.FriendlyName -match 'NVMe|NVM' -and $_.InstanceId -match '^PCI' }).Count
$smbiosM2Count = @(Get-CimInstance -ClassName Win32_SystemSlot | Where-Object { $_.SlotDesignation -match 'M\\.2|M2' -and $_.SlotDesignation }).Count
@{
  Disks = $disks;
  AhciCount = $ahciCount;
  IdeChannelCount = $ideChannelCount;
  NvmeCtrlCount = $nvmeCtrlCount;
  SmbiosM2Count = $smbiosM2Count
} | ConvertTo-Json -Depth 3`, 10000);

    if (!result) return { success: false };

    let data = { Disks: [], AhciCount: 0, IdeChannelCount: 0, NvmeCtrlCount: 0, SmbiosM2Count: 0 };
    try {
      data = JSON.parse(result);
      if (!Array.isArray(data.Disks)) data.Disks = data.Disks ? [data.Disks] : [];
    } catch { return { success: false }; }

    // 已占用（100% 可靠）
    let usedNvme = 0, usedSata = 0;
    data.Disks.forEach(d => {
      const bus = (d.BusType || '').toLowerCase();
      if (bus === 'nvme') usedNvme++;
      else if (bus === 'sata' || bus === 'scsi' || bus === 'raid') usedSata++;
    });

    // === M.2 总数 ===
    let totalM2 = null;
    let m2Estimated = false;
    if (data.SmbiosM2Count > 0) {
      // SMBIOS 明确标注 M.2（最可靠，但很多主板不填）
      totalM2 = data.SmbiosM2Count;
    } else if (data.NvmeCtrlCount > 0) {
      // NVMe 控制器数 = 已使用的 M.2 口数（实际总数可能更多）
      totalM2 = data.NvmeCtrlCount;
      m2Estimated = true;
    }

    // === SATA 总数 ===
    let totalSata = null;
    let sataEstimated = false;
    if (data.IdeChannelCount > 0) {
      // IDE 通道数 = 已连接的 SATA 设备数（最小值）
      // 如果大于已用 SATA 盘数，说明有光驱等占用
      totalSata = data.IdeChannelCount;
      sataEstimated = true;
    } else if (data.AhciCount > 0) {
      // 有 AHCI 控制器但没有连接的设备
      // 每个 AHCI 控制器通常提供 4-8 个端口，但我们无法确定具体数量
      // 至少可以确认主板有 SATA 接口
      totalSata = null; // 无法确定具体数量
    }

    // 主板型号
    const baseboard = await si.baseboard();
    const boardModel = baseboard.model || baseboard.product || '';
    const boardVendor = baseboard.manufacturer || '';

    return {
      success: true,
      data: {
        m2: { used: usedNvme, total: totalM2, estimated: m2Estimated },
        sata: { used: usedSata, total: totalSata, estimated: sataEstimated },
        motherboard: { vendor: boardVendor, model: boardModel }
      }
    };
  } catch (e) {
    console.error('get-disk-slots error:', e.message);
    return { success: false, error: e.message };
  }
});

function getMemorySlots(usedSlots) {
  return new Promise((resolve) => {
    // 优先用 ks-smbios.exe 直接解析 SMBIOS Type 17 表获取真实插槽数
    const smbiosExe = path.join(__dirname, 'bin', 'ks-smbios.exe');
    exec('"' + smbiosExe + '"', { timeout: 3000, windowsHide: true }, (error, stdout) => {
      if (!error && stdout) {
        try {
          const data = JSON.parse(stdout.trim());
          if (data.total > 0) {
            resolve({ total: data.total, used: usedSlots });
            return;
          }
        } catch {}
      }
      // fallback：WMI 方式（可能虚高）
      execPsSession(`(Get-CimInstance -ClassName Win32_PhysicalMemoryArray | Measure-Object -Property MemoryDevices -Sum).Sum`, 5000).then(result => {
        let total = Math.max(usedSlots, 2);
        if (result) {
          try {
            const wmiTotal = parseInt(result.trim());
            if (wmiTotal > 0 && wmiTotal >= usedSlots) {
              if (wmiTotal > 4 && usedSlots > 0 && wmiTotal / usedSlots > 2) {
                total = usedSlots;
              } else {
                total = wmiTotal;
              }
            }
          } catch {}
        }
        resolve({ total, used: usedSlots });
      });
    });
  });
}

ipcMain.handle('get-system-info', async () => {
  try {
    const [cpu, mem, osInfo, memLayout] = await Promise.all([
      si.cpu(), si.mem(), si.osInfo(), si.memLayout()
    ]);
    const usedSlots = memLayout.filter(s => s.size > 0).length;
    const slotInfo = await getMemorySlots(usedSlots);
    return {
      success: true,
      data: {
        cpu: { brand: cpu.brand || 'Unknown', cores: cpu.cores || 0, usage: null, temperature: null, speed: null },
        memory: {
          total: (mem.total / (1024 * 1024 * 1024)).toFixed(2),
          used: (mem.used / (1024 * 1024 * 1024)).toFixed(2),
          usage: ((mem.used / mem.total) * 100).toFixed(1),
          slots: { total: slotInfo.total, used: usedSlots }
        },
        os: osInfo.distro || 'Unknown'
      }
    };
  } catch (e) { return { success: false, error: e.message }; }
});

// ============================================================
// 合并实时数据采集 — 一次调用获取 CPU + GPU + 内存
// 优化：
// 1. 持久 PS 会话避免重复启动 powershell.exe（节省 ~1s/次）
// 2. GPU 占用直接用性能计数器（合并到同一次 PS 调用）
// 3. NVIDIA 温度/显存用 nvidia-smi 缓存（5秒复用）
// 4. GPU 名称用缓存（不变）
// ============================================================
let realtimeLock = false;

ipcMain.handle('get-realtime-stats', async () => {
  try {
    const stats = await getRealtimeStats();
    if (!stats) return { success: false };
    return { success: true, data: stats };
  } catch (e) { return { success: false, error: e.message }; }
});

async function getRealtimeStats() {
  if (realtimeLock) return null;
  realtimeLock = true;
  try {
    // 一次 PS 调用获取 CPU + GPU + 内存 + CPU频率
    const result = await execPsSession(`$cpu = (Get-Counter -Counter '\\Processor(_Total)\\% Processor Time' -ErrorAction SilentlyContinue).CounterSamples.CookedValue
$cpuPerf = (Get-Counter -Counter '\\Processor Information(_Total)\\% Processor Performance' -ErrorAction SilentlyContinue).CounterSamples.CookedValue
$cpuBaseFreq = (Get-Counter -Counter '\\Processor Information(_Total)\\Processor Frequency' -ErrorAction SilentlyContinue).CounterSamples.CookedValue
$cpuFreq = $null
if ($cpuBaseFreq -and $cpuPerf) { $cpuFreq = [math]::Round($cpuBaseFreq * $cpuPerf / 100) }
$gpuSamples = (Get-Counter -Counter '\\GPU Engine(*)\\Utilization Percentage' -ErrorAction SilentlyContinue).CounterSamples
$gpuMax = 0
if ($gpuSamples) { foreach ($s in $gpuSamples) { if ($s.CookedValue -gt $gpuMax) { $gpuMax = $s.CookedValue } } }
$mem = Get-CimInstance Win32_OperatingSystem
$memTotal = [math]::Round($mem.TotalVisibleMemorySize / 1048576, 2)
$memUsed = [math]::Round(($mem.TotalVisibleMemorySize - $mem.FreePhysicalMemory) / 1048576, 2)
$memUsage = [math]::Round(($mem.TotalVisibleMemorySize - $mem.FreePhysicalMemory) / $mem.TotalVisibleMemorySize * 100, 1)
@{
  CpuUsage = if ($cpu -ne $null) { [math]::Round($cpu, 1) } else { $null };
  CpuFreq = $cpuFreq;
  GpuUsage = [math]::Round($gpuMax, 1);
  MemTotal = $memTotal;
  MemUsed = $memUsed;
  MemUsage = $memUsage
} | ConvertTo-Json`, 8000);

    if (!result) return null;

    let cpuUsage = null, cpuFreq = null, gpuUsage = null, memTotal = null, memUsed = null, memUsage = null;
    try {
      const data = JSON.parse(result);
      cpuUsage = data.CpuUsage !== null ? data.CpuUsage.toFixed(1) : null;
      cpuFreq = data.CpuFreq || null;
      gpuUsage = data.GpuUsage > 0 ? data.GpuUsage.toFixed(1) : null;
      memTotal = data.MemTotal.toFixed(2);
      memUsed = data.MemUsed.toFixed(2);
      memUsage = data.MemUsage.toFixed(1);
    } catch { return null; }

    // GPU 详细信息（温度/显存） — 从缓存获取
    const gpu = await getGpuCache();
    let gpuTemp = null;
    let gpuVram = null;
    let gpuVramTotal = null;

    if (gpu.isNvidia) {
      const nvidiaInfo = await getNvidiaSmiInfo();
      if (nvidiaInfo) {
        gpuTemp = nvidiaInfo.temp || null;
        gpuVram = nvidiaInfo.vramUsed ? (parseFloat(nvidiaInfo.vramUsed) / 1024).toFixed(1) : null;
        gpuVramTotal = nvidiaInfo.vramTotal ? (parseFloat(nvidiaInfo.vramTotal) / 1024).toFixed(1) : null;
        // nvidia-smi 提供更准确的占用率
        if (nvidiaInfo.usage) gpuUsage = nvidiaInfo.usage;
      }
    }

    return {
      cpuUsage,
      cpuFreq,
      gpuUsage,
      gpuName: gpu.name,
      gpuDriver: gpu.driver,
      gpuTemp,
      gpuVram,
      gpuVramTotal,
      memTotal,
      memUsed,
      memUsage
    };
  } finally {
    realtimeLock = false;
  }
}

// GPU 信息 — 首次加载时调用
ipcMain.handle('get-gpu-info', async () => {
  try {
    const gpu = await getGpuCache();
    if (!gpu || gpu.name === '未检测到') return { success: false };

    let gpuTemp = '--', vramDisplay = '--';
    if (gpu.isNvidia) {
      const nvidiaResult = await getNvidiaSmiInfo();
      if (nvidiaResult) {
        gpuTemp = nvidiaResult.temp || '--';
        const vramUsedGB = nvidiaResult.vramUsed ? (parseFloat(nvidiaResult.vramUsed) / 1024).toFixed(1) : '--';
        const vramTotalGB = nvidiaResult.vramTotal ? (parseFloat(nvidiaResult.vramTotal) / 1024).toFixed(1) : (gpu.vramTotalMB / 1024).toFixed(1);
        vramDisplay = vramUsedGB + '/' + vramTotalGB + ' GB';
      }
    }

    if (vramDisplay === '--' && gpu.vramTotalMB > 0) {
      vramDisplay = '--/' + (gpu.vramTotalMB / 1024).toFixed(1) + ' GB';
    }

    return { success: true, data: { name: gpu.name, driver: gpu.driver, usage: '--', vramDisplay, temperature: gpuTemp } };
  } catch (e) { return { success: false, error: e.message }; }
});

ipcMain.handle('get-config-info', async () => {
  try {
    const [cpu, memLayout, baseboard, graphics, audio, network] = await Promise.all([
      si.cpu(), si.memLayout(), si.baseboard(), si.graphics(), si.audio(), si.networkInterfaces()
    ]);

    const totalMem = memLayout.reduce((sum, m) => sum + (m.size || 0), 0);
    const totalMemGB = (totalMem / (1024 * 1024 * 1024)).toFixed(1);
    const memTypes = [...new Set(memLayout.filter(m => m.type).map(m => m.type))];
    const memClocks = [...new Set(memLayout.filter(m => m.clockSpeed).map(m => m.clockSpeed))];
    const memDetail = memTypes.length > 0 ? `${memTypes[0]}${memClocks.length > 0 ? ' @ ' + memClocks[0] + ' MHz' : ''}` : '';

    const controllers = graphics.controllers || [];
    const realGpus = controllers.filter(c => {
      const name = (c.name || c.model || '').toLowerCase();
      return !name.includes('virtual') && !name.includes('remote') && !name.includes('basic') && !name.includes('microsoft') && !name.includes('rdp');
    });

    let gpu = realGpus.find(c => {
      const name = (c.name || c.model || '').toLowerCase();
      const vendor = (c.vendor || '').toLowerCase();
      return name.includes('nvidia') || name.includes('geforce') || name.includes('rtx') || name.includes('gtx') || name.includes('amd') || name.includes('radeon') || vendor.includes('nvidia') || vendor.includes('amd');
    }) || realGpus.find(c => (c.name || c.model || '').toLowerCase().includes('intel')) || realGpus[0];

    const gpuName = gpu ? (gpu.model || gpu.name || 'Unknown') : '未检测到';
    const gpuVram = gpu && gpu.vram ? (gpu.vram / 1024).toFixed(1) + ' GB' : '';

    const audioDevices = audio || [];
    const audioCard = audioDevices.find(a => a.name && !a.name.toLowerCase().includes('usb') && !a.name.toLowerCase().includes('high definition')) || audioDevices[0];
    const audioName = audioCard ? audioCard.name : '';

    const networkInterfaces = network || [];
    const netCard = networkInterfaces.find(n => !n.internal && !n.virtual) || networkInterfaces.find(n => !n.internal);
    const netName = netCard ? (netCard.ifaceName || netCard.iface) : '';
    const netSpeed = netCard && netCard.speed ? netCard.speed + ' Mbps' : '';

    return {
      success: true,
      data: {
        cpu: { name: cpu.brand || 'Unknown', cores: cpu.cores || 0 },
        motherboard: { name: baseboard.model || baseboard.product || 'Unknown', vendor: baseboard.manufacturer || '' },
        memory: { total: totalMemGB + ' GB', detail: memDetail },
        gpu: { name: gpuName, vram: gpuVram },
        audio: { name: audioName },
        network: { name: netName, speed: netSpeed }
      }
    };
  } catch (e) { return { success: false, error: e.message }; }
});

// 网络检测 - 网卡信息
ipcMain.handle('get-network-info', async () => {
  try {
    const [interfaces, dnsResult] = await Promise.all([
      si.networkInterfaces(),
      execPsSession(`Get-DnsClientServerAddress -AddressFamily IPv4 | Select-Object InterfaceAlias, ServerAddresses | ConvertTo-Json`)
    ]);

    const dnsMap = new Map();
    if (dnsResult) {
      try {
        let dnsList = JSON.parse(dnsResult);
        if (!Array.isArray(dnsList)) dnsList = [dnsList];
        dnsList.forEach(d => {
          if (d.InterfaceAlias && d.ServerAddresses) {
            dnsMap.set(d.InterfaceAlias, d.ServerAddresses.join(', '));
          }
        });
      } catch {}
    }

    const virtualKeywords = ['virtual', 'hyper-v', 'vmware', 'vethernet', 'wsl', 'loopback', 'bluetooth', 'vpn', 'tunnel', '6to4', 'isatap', 'teredo'];

    const data = interfaces
      .filter(nic => !nic.internal)
      .map(nic => {
        const nameLower = (nic.ifaceName || nic.iface || '').toLowerCase();
        const isVirtual = virtualKeywords.some(kw => nameLower.includes(kw)) || nic.virtual;
        return {
          name: nic.ifaceName || nic.iface || 'Unknown',
          mac: nic.mac || '--',
          ipv4: nic.ip4 || '--',
          dns: dnsMap.get(nic.ifaceName || nic.iface) || '--',
          virtual: isVirtual
        };
      });

    return { success: true, data };
  } catch (e) { return { success: false, error: e.message }; }
});

// 网络检测 - 代理状态
ipcMain.handle('get-proxy-status', async () => {
  try {
    const result = await execPsSession(`$reg = Get-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'
$enabled = $reg.ProxyEnable
$server = $reg.ProxyServer
ConvertTo-Json @{ Enabled = ($enabled -eq 1); Server = $server }`);
    if (!result) return { success: false };
    const data = JSON.parse(result);
    return { success: true, data: { enabled: data.Enabled, server: data.Server || '' } };
  } catch (e) { return { success: false, error: e.message }; }
});

// 网络检测 - 切换代理
ipcMain.handle('set-proxy-status', async (_event, enabled) => {
  try {
    await execPsSession(`Set-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings' -Name ProxyEnable -Value ${enabled ? 1 : 0}`);
    return { success: true, data: { enabled } };
  } catch (e) { return { success: false, error: e.message }; }
});

// 网络检测 - 单次 Ping
ipcMain.handle('ping-test', async (_event, target) => {
  return new Promise((resolve) => {
    exec(`ping -n 1 -w 3000 ${target}`, { timeout: 5000, encoding: 'buffer' }, (error, stdout) => {
      const output = stdout ? stdout.toString('binary') : (error ? error.message : '');
      resolve({ success: true, data: { output } });
    });
  });
});

// 网络检测 - 持续 Ping
let pingProcess = null;

ipcMain.on('ping-start', (event, target) => {
  if (pingProcess) return;
  pingProcess = spawn('ping', ['-t', '-w', '3000', target]);
  pingProcess.stdout.on('data', (data) => {
    event.reply('ping-data', data.toString('binary'));
  });
  pingProcess.stderr.on('data', (data) => {
    event.reply('ping-data', data.toString('binary'));
  });
  pingProcess.on('close', () => {
    pingProcess = null;
    event.reply('ping-end');
  });
});

ipcMain.handle('ping-stop', async () => {
  if (pingProcess) { pingProcess.kill(); pingProcess = null; }
  return { success: true };
});

// 快捷访问 - 打开系统工具
ipcMain.handle('open-system-tool', async (_event, command) => {
  return new Promise((resolve) => {
    exec('cmd /c start "" ' + command, { timeout: 5000 }, (error) => {
      if (error) resolve({ success: false, error: error.message });
      else resolve({ success: true });
    });
  });
});
