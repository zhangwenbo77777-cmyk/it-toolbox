// GBK 解码器：将 binary 字符串还原为 UTF-8
function decodeGbk(binaryStr) {
  try {
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    return new TextDecoder('gbk').decode(bytes);
  } catch {
    return binaryStr;
  }
}

const cpuName = document.getElementById('cpu-name');
const cpuCores = document.getElementById('cpu-cores');
const cpuUsage = document.getElementById('cpu-usage');
const cpuTemp = document.getElementById('cpu-temp');
const cpuSpeed = document.getElementById('cpu-speed');
const memoryTotal = document.getElementById('memory-total');
const memoryUsage = document.getElementById('memory-usage');
const memoryUsed = document.getElementById('memory-used');
const slotsVisual = document.getElementById('slots-visual');
const slotsText = document.getElementById('slots-text');
const gpuName = document.getElementById('gpu-name');
const gpuDriver = document.getElementById('gpu-driver');
const gpuUsage = document.getElementById('gpu-usage');
const gpuVramUsage = document.getElementById('gpu-vram-usage');
const gpuTemp = document.getElementById('gpu-temp');
const osName = document.getElementById('os-name');
const diskContainer = document.getElementById('disk-container');
const configContainer = document.getElementById('config-container');

// === 侧边栏切换 ===
const navItems = document.querySelectorAll('.nav-item');
const pages = document.querySelectorAll('.page');
let currentPage = 'hardware';
let networkLoaded = false;
let quickLoaded = false;

navItems.forEach(item => {
  item.addEventListener('click', () => {
    const targetPage = item.dataset.page;
    if (targetPage === currentPage) return;

    navItems.forEach(n => n.classList.remove('active'));
    item.classList.add('active');

    pages.forEach(p => p.classList.remove('active'));
    const targetEl = document.getElementById('page-' + targetPage);
    setTimeout(() => targetEl.classList.add('active'), 20);

    currentPage = targetPage;

    if (targetPage === 'network' && !networkLoaded) {
      loadNetworkPage();
      networkLoaded = true;
    }

    if (targetPage === 'quick' && !quickLoaded) {
      loadQuickPage();
      quickLoaded = true;
    }
  });
});

// === 硬件信息页面 ===

async function loadConfigInfo() {
  configContainer.innerHTML = '<div class="loading"><div class="spinner"></div><p>正在检测...</p></div>';
  try {
    const result = await window.electronAPI.getConfigInfo();
    if (result.success && result.data) {
      renderConfigCards(result.data);
    } else {
      configContainer.innerHTML = '<div class="loading"><p>检测失败</p></div>';
    }
  } catch (error) {
    configContainer.innerHTML = '<div class="loading"><p>检测失败</p></div>';
  }
}

function renderConfigCards(config) {
  const items = [
    { icon: 'CPU', label: '处理器', value: config.cpu.name, detail: config.cpu.cores + ' 核心' },
    { icon: 'MB', label: '主板', value: config.motherboard.name, detail: config.motherboard.vendor || '' },
    { icon: 'MEM', label: '内存', value: config.memory.total, detail: config.memory.detail || '' },
    { icon: 'GPU', label: '显卡', value: config.gpu.name, detail: config.gpu.vram || '' },
    { icon: 'AUD', label: '声卡', value: config.audio.name || '未检测到', detail: '' },
    { icon: 'NET', label: '网卡', value: config.network.name || '未检测到', detail: config.network.speed || '' }
  ];

  configContainer.innerHTML = items.map((item, i) =>
    '<div class="config-card" style="animation-delay: ' + (i * 0.05) + 's">' +
      '<div class="config-icon">' + item.icon + '</div>' +
      '<div class="config-info">' +
        '<div class="config-label">' + item.label + '</div>' +
        '<div class="config-value" title="' + item.value + '">' + item.value + '</div>' +
        (item.detail ? '<div class="config-detail">' + item.detail + '</div>' : '') +
      '</div>' +
    '</div>'
  ).join('');
}

async function loadSystemInfo() {
  try {
    const result = await window.electronAPI.getSystemInfo();
    if (result.success) {
      cpuName.textContent = result.data.cpu.brand;
      cpuCores.textContent = result.data.cpu.cores + ' 核心';
      memoryTotal.textContent = result.data.memory.total + ' GB';
      const slots = result.data.memory.slots;
      slotsText.textContent = slots.used + '/' + slots.total;
      slotsVisual.innerHTML = '';
      for (let i = 0; i < slots.total; i++) {
        const slot = document.createElement('div');
        slot.className = 'slot-item' + (i < slots.used ? ' active' : '');
        slotsVisual.appendChild(slot);
      }
      osName.textContent = result.data.os;
    }
  } catch (error) { console.error('Error:', error); }

  // 首次加载获取实时数据填充（包含 GPU 信息，不再单独调用 getGpuInfo）
  try {
    const statsResult = await window.electronAPI.getRealtimeStats();
    if (statsResult.success && statsResult.data) {
      if (statsResult.data.cpuUsage) cpuUsage.textContent = statsResult.data.cpuUsage;
      if (statsResult.data.memUsage) memoryUsage.textContent = statsResult.data.memUsage;
      if (statsResult.data.memUsed) memoryUsed.textContent = statsResult.data.memUsed;
      // GPU 首次填充
      if (statsResult.data.gpuName && statsResult.data.gpuName !== '未检测到') {
        gpuName.textContent = statsResult.data.gpuName;
        gpuDriver.textContent = statsResult.data.gpuDriver ? '驱动: ' + statsResult.data.gpuDriver : '';
      } else {
        gpuName.textContent = '未检测到独立显卡';
      }
      if (statsResult.data.gpuUsage) gpuUsage.textContent = statsResult.data.gpuUsage;
      if (statsResult.data.gpuTemp) gpuTemp.textContent = statsResult.data.gpuTemp;
      if (statsResult.data.gpuVram && statsResult.data.gpuVramTotal) {
        gpuVramUsage.textContent = statsResult.data.gpuVram + '/' + statsResult.data.gpuVramTotal + ' GB';
      }
    }
  } catch {}
}

let slotsLoaded = false;

async function loadDiskInfo() {
  diskContainer.innerHTML = '<div class="loading"><div class="spinner"></div><p>正在检测...</p></div>';
  try {
    const diskResult = await window.electronAPI.getDiskInfo();
    if (diskResult.success && diskResult.data.length > 0) {
      renderDiskCards(diskResult.data);
    } else {
      const errMsg = diskResult.error ? '检测失败: ' + diskResult.error : '未检测到存储设备';
      diskContainer.innerHTML = '<div class="loading"><p>' + errMsg + '</p></div>';
    }
  } catch (error) { diskContainer.innerHTML = '<div class="loading"><p>检测失败: ' + error.message + '</p></div>'; }

  // 硬盘接口信息（懒加载，只加载一次）
  if (slotsLoaded) return;
  slotsLoaded = true;
  const slotsContainer = document.getElementById('slots-container');
  try {
    const slotResult = await window.electronAPI.getDiskSlots();
    if (slotResult.success) {
      renderSlotCards(slotResult.data);
    } else {
      const errMsg = slotResult.error ? '检测失败: ' + slotResult.error : '检测失败';
      slotsContainer.innerHTML = '<div class="loading"><p>' + errMsg + '</p></div>';
    }
  } catch (error) {
    slotsContainer.innerHTML = '<div class="loading"><p>检测失败: ' + error.message + '</p></div>';
  }
}

function renderDiskCards(disks) {
  const html = disks.map((disk, index) => {
    let typeClass = 'unknown';
    if (disk.type.includes('NVMe')) typeClass = 'nvme';
    else if (disk.type.includes('SATA') || disk.type.includes('SSD')) typeClass = 'sata';
    else if (disk.type.includes('HDD') || disk.type === 'HD') typeClass = 'hdd';
    else if (disk.type.includes('USB')) typeClass = 'usb';

    const driveLetters = disk.driveLetters ? disk.driveLetters : '';

    return '<div class="disk-card" style="animation-delay: ' + (index * 0.1) + 's">' +
      '<div class="disk-header">' +
        '<div class="disk-name">' + disk.name + '</div>' +
        '<div class="disk-type ' + typeClass + '">' + disk.type + '</div>' +
      '</div>' +
      '<div class="disk-details">' +
        '<div class="detail-row"><span class="detail-label">容量</span><span class="detail-value">' + disk.size + '</span></div>' +
        '<div class="detail-row"><span class="detail-label">接口</span><span class="detail-value">' + disk.interface + '</span></div>' +
        '<div class="detail-row"><span class="detail-label">盘符</span><span class="detail-value">' + (driveLetters || '--') + '</span></div>' +
      '</div>' +
    '</div>';
  }).join('');

  diskContainer.innerHTML = html;
}

function renderSlotCards(slotData) {
  const container = document.getElementById('slots-container');
  let html = '<div class="slot-cards-grid">';

  // M.2 卡片
  const m2Used = slotData.m2.used;
  const m2Total = slotData.m2.total;
  const m2Estimated = slotData.m2.estimated;
  const m2Free = m2Total !== null ? (m2Total - m2Used) : null;

  html += '<div class="slot-card slot-card-m2">' +
    '<div class="slot-card-header">' +
      '<div class="slot-card-icon">M.2</div>' +
      '<div class="slot-card-title">M.2 接口</div>' +
    '</div>' +
    '<div class="slot-card-body">' +
      '<div class="slot-card-row"><span class="slot-card-label">已占用</span><span class="slot-card-value used">' + m2Used + ' 个</span></div>' +
      '<div class="slot-card-row"><span class="slot-card-label">剩余</span><span class="slot-card-value free">' + (m2Free !== null ? m2Free + ' 个' : '未知') + '</span></div>' +
      (m2Total !== null ? '<div class="slot-card-row"><span class="slot-card-label">总计</span><span class="slot-card-value total">' + m2Total + ' 个' + (m2Estimated ? ' (至少)' : '') + '</span></div>' : '') +
    '</div>' +
    '<div class="slot-card-visual">';

  if (m2Total !== null) {
    for (let i = 0; i < m2Total; i++) {
      html += '<div class="slot-dot' + (i < m2Used ? ' dot-m2-used' : ' dot-free') + '"></div>';
    }
  } else {
    for (let i = 0; i < m2Used; i++) {
      html += '<div class="slot-dot dot-m2-used"></div>';
    }
    html += '<div class="slot-dot dot-unknown">?</div>';
  }

  html += '</div>' +
    (m2Estimated ? '<div class="slot-card-note">总计为已检测到的 NVMe 设备数，实际 M.2 口可能更多</div>' : '') +
    (m2Total === null ? '<div class="slot-card-note">总数取决于主板型号，请参考主板说明书</div>' : '') +
  '</div>';

  // SATA 卡片
  const sataUsed = slotData.sata.used;
  const sataTotal = slotData.sata.total;
  const sataEstimated = slotData.sata.estimated;
  const sataFree = sataTotal !== null ? (sataTotal - sataUsed) : null;

  html += '<div class="slot-card slot-card-sata">' +
    '<div class="slot-card-header">' +
      '<div class="slot-card-icon">SATA</div>' +
      '<div class="slot-card-title">SATA 接口</div>' +
    '</div>' +
    '<div class="slot-card-body">' +
      '<div class="slot-card-row"><span class="slot-card-label">已占用</span><span class="slot-card-value used">' + sataUsed + ' 个</span></div>' +
      '<div class="slot-card-row"><span class="slot-card-label">剩余</span><span class="slot-card-value free">' + (sataFree !== null ? sataFree + ' 个' : '未知') + '</span></div>' +
      (sataTotal !== null ? '<div class="slot-card-row"><span class="slot-card-label">总计</span><span class="slot-card-value total">' + sataTotal + ' 个' + (sataEstimated ? ' (已连接设备)' : '') + '</span></div>' : '') +
    '</div>' +
    '<div class="slot-card-visual">';

  if (sataTotal !== null) {
    for (let i = 0; i < sataTotal; i++) {
      html += '<div class="slot-dot' + (i < sataUsed ? ' dot-sata-used' : ' dot-free') + '"></div>';
    }
  } else {
    for (let i = 0; i < sataUsed; i++) {
      html += '<div class="slot-dot dot-sata-used"></div>';
    }
    html += '<div class="slot-dot dot-unknown">?</div>';
  }

  html += '</div>' +
    (sataEstimated ? '<div class="slot-card-note">总计为已连接的 SATA 设备数，实际端口可能更多</div>' : '') +
    (sataTotal === null ? '<div class="slot-card-note">主板有 SATA 控制器但未检测到连接设备，请参考主板说明书</div>' : '') +
  '</div>';

  // 主板型号
  if (slotData.motherboard && (slotData.motherboard.model || slotData.motherboard.vendor)) {
    html += '<div class="slot-card-mobo">主板: ' +
      (slotData.motherboard.vendor ? slotData.motherboard.vendor + ' ' : '') +
      (slotData.motherboard.model || '') +
    '</div>';
  }

  html += '</div>';
  container.innerHTML = html;
}

// 电脑配置刷新按钮
const configRefreshBtn = document.getElementById('config-refresh-btn');
configRefreshBtn.addEventListener('click', async () => {
  configRefreshBtn.disabled = true;
  configRefreshBtn.textContent = '刷新中...';
  await Promise.all([loadConfigInfo(), loadSystemInfo()]);
  configRefreshBtn.disabled = false;
  configRefreshBtn.textContent = '刷新';
});

// 存储设备刷新按钮
const diskRefreshBtn = document.getElementById('disk-refresh-btn');
diskRefreshBtn.addEventListener('click', async () => {
  diskRefreshBtn.disabled = true;
  diskRefreshBtn.textContent = '刷新中...';
  slotsLoaded = false; // 重置插槽加载标志
  await loadDiskInfo();
  diskRefreshBtn.disabled = false;
  diskRefreshBtn.textContent = '刷新';
});

// === 快捷访问页面 ===

const quickTools = [
  {
    id: 'uninstall',
    name: '程序和功能',
    desc: '卸载已安装的程序，管理软件变更',
    icon: 'i-uninstall',
    svg: '<path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>',
    command: 'appwiz.cpl'
  },
  {
    id: 'device',
    name: '设备管理器',
    desc: '查看硬件设备状态，检查未识别的设备',
    icon: 'i-device',
    svg: '<path d="M22 9V7h-2V5c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2v-2h2v-2h-2v-2h2v-2h-2V9h2zm-4 10H4V5h14v14zM6 13h5v4H6v-4zm6-6h4v3h-4V7zM6 7h5v5H6V7zm6 4h4v6h-4v-6z"/>',
    command: 'devmgmt.msc'
  },
  {
    id: 'disk',
    name: '磁盘管理',
    desc: '管理磁盘分区，更改盘符，格式化磁盘',
    icon: 'i-disk',
    svg: '<path d="M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 14H4V6h16v12zM6 10h2v2H6v-2zm0 4h8v2H6v-2zm10 0h2v2h-2v-2zm-6-4h8v2h-8v-2z"/>',
    command: 'diskmgmt.msc'
  },
  {
    id: 'network',
    name: '网络连接',
    desc: '查看和管理网络适配器，修改IP和DNS设置',
    icon: 'i-network',
    svg: '<path d="M1 9l2 2c4.97-4.97 13.03-4.97 18 0l2-2C16.93 2.93 7.08 2.93 1 9zm8 8l3 3 3-3c-1.65-1.66-4.34-1.66-6 0zm-4-4l2 2c2.76-2.76 7.24-2.76 10 0l2-2C15.14 9.14 8.87 9.14 5 13z"/>',
    command: 'ncpa.cpl'
  },
  {
    id: 'taskmgr',
    name: '任务管理器',
    desc: '强制结束卡死的程序，查看CPU和内存占用',
    icon: 'i-taskmgr',
    svg: '<path d="M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z"/>',
    command: 'taskmgr'
  },
  {
    id: 'power',
    name: '电源选项',
    desc: '更改电源计划，设置合盖和休眠行为',
    icon: 'i-power',
    svg: '<path d="M13 3h-2v10h2V3zm4.83 2.17l-1.42 1.42C17.99 7.86 19 9.81 19 12c0 3.87-3.13 7-7 7s-7-3.13-7-7c0-2.19 1.01-4.14 2.58-5.42L6.17 5.17C4.23 6.82 3 9.26 3 12c0 4.97 4.03 9 9 9s9-4.03 9-9c0-2.74-1.23-5.18-3.17-6.83z"/>',
    command: 'powercfg.cpl'
  },
  {
    id: 'firewall',
    name: '防火墙',
    desc: '检查防火墙状态，放行被拦截的程序',
    icon: 'i-firewall',
    svg: '<path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm0 10.99h7c-.53 4.12-3.28 7.79-7 8.94V12H5V6.3l7-3.11v8.8z"/>',
    command: 'firewall.cpl'
  },
  {
    id: 'startup',
    name: '启动项管理',
    desc: '管理开机自启程序，加快开机速度',
    icon: 'i-startup',
    svg: '<path d="M19 3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.11 0 2-.9 2-2V5c0-1.1-.89-2-2-2zm-9 14l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>',
    command: 'ms-settings:startupapps'
  },
  {
    id: 'credential',
    name: 'Windows 凭据管理',
    desc: '管理 Windows 凭据，更新共享盘和打印机密码',
    icon: 'i-credential',
    svg: '<path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/>',
    command: 'control /name Microsoft.CredentialManager',
    tip: '更改KOA密码后如果共享盘和打印机无法使用，可以点击这里找到对应的地址更新密码~',
    tipHighlight: true
  }
];

function loadQuickPage() {
  const container = document.getElementById('quick-container');
  container.innerHTML = quickTools.map((tool, i) => {
    const tipHtml = tool.tip
      ? '<div class="quick-card-tip' + (tool.tipHighlight ? ' highlight' : '') + '">' + tool.tip + '</div>'
      : '';
    return '<div class="quick-card" data-command="' + tool.command + '" style="animation-delay: ' + (i * 0.06) + 's">' +
      '<div class="quick-card-top">' +
        '<div class="quick-card-icon ' + tool.icon + '"><svg viewBox="0 0 24 24">' + tool.svg + '</svg></div>' +
        '<div class="quick-card-name">' + tool.name + '</div>' +
      '</div>' +
      '<div class="quick-card-desc">' + tool.desc + '</div>' +
      tipHtml +
      '<div class="quick-card-arrow"><svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg></div>' +
    '</div>';
  }).join('');

  container.querySelectorAll('.quick-card').forEach(card => {
    card.addEventListener('click', async () => {
      const command = card.dataset.command;
      card.style.pointerEvents = 'none';
      card.style.opacity = '0.6';
      try {
        await window.electronAPI.openSystemTool(command);
      } catch (e) {
        console.error('Open tool error:', e);
      }
      setTimeout(() => {
        card.style.pointerEvents = '';
        card.style.opacity = '';
      }, 1000);
    });
  });
}

// === 网络检测页面 ===

async function loadNetworkPage() {
  loadNetworkInfo();
  loadProxyStatus();
}

async function loadNetworkInfo() {
  const container = document.getElementById('network-container');
  container.innerHTML = '<div class="loading"><div class="spinner"></div><p>正在检测...</p></div>';
  try {
    const result = await window.electronAPI.getNetworkInfo();
    if (result.success && result.data.length > 0) {
      renderNetworkCards(result.data);
    } else {
      container.innerHTML = '<div class="loading"><p>未检测到网卡</p></div>';
    }
  } catch (error) {
    container.innerHTML = '<div class="loading"><p>检测失败</p></div>';
  }
}

function renderNetworkCards(interfaces) {
  const container = document.getElementById('network-container');
  container.innerHTML = interfaces.map((nic, i) => {
    const tagClass = nic.virtual ? 'virtual' : 'physical';
    const tagText = nic.virtual ? '虚拟' : '物理';

    return '<div class="net-card" style="animation-delay: ' + (i * 0.1) + 's">' +
      '<div class="net-card-header">' +
        '<div class="net-card-name">' + nic.name + '</div>' +
        '<div class="net-card-tag ' + tagClass + '">' + tagText + '</div>' +
      '</div>' +
      '<div class="net-card-details">' +
        '<div class="detail-row"><span class="detail-label">MAC 地址</span><span class="detail-value">' + (nic.mac ? nic.mac.toUpperCase() : '--') + '</span></div>' +
        '<div class="detail-row"><span class="detail-label">IPv4 地址</span><span class="detail-value">' + (nic.ipv4 || '--') + '</span></div>' +
        '<div class="detail-row"><span class="detail-label">DNS 服务器</span><span class="detail-value">' + (nic.dns || '--') + '</span></div>' +
      '</div>' +
    '</div>';
  }).join('');
}

async function loadProxyStatus() {
  const container = document.getElementById('proxy-container');
  try {
    const result = await window.electronAPI.getProxyStatus();
    if (result.success) {
      renderProxyCard(result.data);
    } else {
      container.innerHTML = '<div class="proxy-card"><div class="proxy-info"><span>检测失败</span></div></div>';
    }
  } catch (error) {
    container.innerHTML = '<div class="proxy-card"><div class="proxy-info"><span>检测失败</span></div></div>';
  }
}

function renderProxyCard(data) {
  const container = document.getElementById('proxy-container');
  const statusClass = data.enabled ? 'on' : 'off';
  const statusText = data.enabled ? '已开启' : '已关闭';
  const toggleClass = data.enabled ? 'on' : '';
  const serverText = data.enabled && data.server ? data.server : '';

  container.innerHTML =
    '<div class="proxy-card">' +
      '<div class="proxy-info">' +
        '<div class="proxy-icon"><svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg></div>' +
        '<div class="proxy-text">' +
          '<div class="proxy-label">系统代理</div>' +
          '<div class="proxy-status ' + statusClass + '">' + statusText + '</div>' +
          (serverText ? '<div class="proxy-detail">' + serverText + '</div>' : '') +
          '<div class="proxy-tip">' + (data.enabled ? '代理已开启，可能导致浏览器无法访问网页' : '代理关闭时浏览器直连网络，开启后将走代理服务器') + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="proxy-toggle ' + toggleClass + '" id="proxy-toggle">' +
        '<div class="proxy-toggle-knob"></div>' +
      '</div>' +
    '</div>';

  document.getElementById('proxy-toggle').addEventListener('click', async () => {
    const newState = !data.enabled;
    try {
      const result = await window.electronAPI.setProxyStatus(newState);
      if (result.success) {
        data.enabled = newState;
        renderProxyCard(data);
      }
    } catch (error) {
      console.error('Proxy toggle error:', error);
    }
  });
}

// Ping 测试
const pingBtn = document.getElementById('ping-btn');
const pingStopBtn = document.getElementById('ping-stop-btn');
const pingClearBtn = document.getElementById('ping-clear-btn');
const pingTarget = document.getElementById('ping-target');
const pingOutput = document.getElementById('ping-output');
const pingContinuousToggle = document.getElementById('ping-continuous-toggle');
let pingContinuous = false;

pingContinuousToggle.addEventListener('click', () => {
  pingContinuous = !pingContinuous;
  if (pingContinuous) {
    pingContinuousToggle.classList.add('on');
  } else {
    pingContinuousToggle.classList.remove('on');
    if (!pingBtn.disabled) return;
    stopContinuousPing();
  }
});

function appendPingLine(text) {
  const line = document.createElement('span');
  const hasReply = text.includes('回复') || text.includes('Reply');
  const hasTime = text.includes('时间') || text.includes('time');
  const hasMs = text.includes('ms');
  const hasTimeout = text.includes('超时') || text.includes('timed out');
  const hasFail = text.includes('请求失败') || text.includes('不可达') || text.includes('unreachable') || text.includes('fail') || text.includes('无法');

  if ((hasReply || hasTime) && hasMs && !hasTimeout) {
    line.className = 'ping-line-ok';
  } else if (hasTimeout) {
    line.className = 'ping-line-timeout';
  } else if (hasFail) {
    line.className = 'ping-line-fail';
  } else {
    line.className = 'ping-line-info';
  }
  line.textContent = text;
  pingOutput.appendChild(line);
  pingOutput.scrollTop = pingOutput.scrollHeight;
  pingClearBtn.style.display = 'inline-block';
}

async function stopContinuousPing() {
  await window.electronAPI.pingStop();
  window.electronAPI.removePingListeners();
  pingBtn.disabled = false;
  pingBtn.textContent = '测试';
  pingStopBtn.style.display = 'none';
  pingTarget.disabled = false;
  appendPingLine('\n--- 已停止 ---\n');
}

async function singlePing(target) {
  pingBtn.disabled = true;
  pingBtn.textContent = '测试中...';
  pingTarget.disabled = true;
  pingOutput.innerHTML = '';
  pingClearBtn.style.display = 'none';

  try {
    const result = await window.electronAPI.pingTest(target);
    const output = decodeGbk(result.data.output);
    output.split('\n').forEach(line => {
      if (line.trim()) appendPingLine(line + '\n');
    });
  } catch (error) {
    appendPingLine('测试失败\n');
  }

  pingBtn.disabled = false;
  pingBtn.textContent = '测试';
  pingTarget.disabled = false;
}

function continuousPing(target) {
  pingBtn.disabled = true;
  pingBtn.textContent = '测试中...';
  pingStopBtn.style.display = 'inline-block';
  pingTarget.disabled = true;
  pingOutput.innerHTML = '';
  pingClearBtn.style.display = 'none';

  window.electronAPI.onPingData((data) => {
    const decoded = decodeGbk(data);
    decoded.split('\n').forEach(line => {
      if (line.trim()) appendPingLine(line + '\n');
    });
  });

  window.electronAPI.onPingEnd(() => {
    appendPingLine('\n--- 已停止 ---\n');
    pingBtn.disabled = false;
    pingBtn.textContent = '测试';
    pingStopBtn.style.display = 'none';
    pingTarget.disabled = false;
  });

  window.electronAPI.pingStart(target);
}

pingBtn.addEventListener('click', async () => {
  const target = pingTarget.value.trim();
  if (!target) return;

  if (pingContinuous) {
    continuousPing(target);
  } else {
    await singlePing(target);
  }
});

pingStopBtn.addEventListener('click', () => {
  stopContinuousPing();
});

pingClearBtn.addEventListener('click', () => {
  pingOutput.innerHTML = '';
  pingClearBtn.style.display = 'none';
});

// === 内存警告 ===
let memoryWarningShown = false;
window.disableMemoryWarning = false;
const MEMORY_WARNING_THRESHOLD = 90;

function showMemoryAlert(usage) {
  const overlay = document.createElement('div');
  overlay.className = 'alert-overlay';
  overlay.innerHTML = `
    <div class="alert-modal">
      <div class="alert-header">
        <div class="alert-icon">!</div>
        <div class="alert-title">内存占用过高</div>
      </div>
      <div class="alert-content">
        <div>当前内存占用率已达到</div>
        <div class="alert-value">${usage}%</div>
        <div>建议关闭不必要的程序以释放内存</div>
      </div>
      <div class="alert-buttons">
        <button class="alert-btn alert-btn-close" id="alert-close-btn">忽略</button>
        <button class="alert-btn alert-btn-ignore" id="alert-ignore-btn">不再提醒</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const closeBtn = document.getElementById('alert-close-btn');
  const ignoreBtn = document.getElementById('alert-ignore-btn');

  closeBtn.addEventListener('click', () => {
    overlay.style.animation = 'slideOutAlert 0.3s ease forwards';
    setTimeout(() => overlay.remove(), 300);
  });

  ignoreBtn.addEventListener('click', () => {
    window.disableMemoryWarning = true;
    overlay.style.animation = 'slideOutAlert 0.3s ease forwards';
    setTimeout(() => overlay.remove(), 300);
  });
}

// ============================================================
// 实时更新 — 优化版
// 核心改进：
// 1. getRealtimeStats 已合并 GPU 数据，不再单独轮询 getGpuInfo
// 2. 轮询间隔从 5s 增加到 8s（PS 会话复用后响应更快，
//    但不需要那么频繁刷新）
// 3. 只在硬件页面更新
// ============================================================
let realtimeTimer = null;

function startRealtimeUpdate() {
  if (realtimeTimer) return;
  realtimeTimer = setInterval(async () => {
    if (currentPage !== 'hardware') return;

    try {
      const result = await window.electronAPI.getRealtimeStats();
      if (result.success && result.data) {
        // CPU
        if (result.data.cpuUsage) cpuUsage.textContent = result.data.cpuUsage;

        // 内存
        if (result.data.memUsage) memoryUsage.textContent = result.data.memUsage;
        if (result.data.memUsed) memoryUsed.textContent = result.data.memUsed;

        // GPU — 合并后直接从 realtimeStats 获取
        if (result.data.gpuUsage) gpuUsage.textContent = result.data.gpuUsage;
        if (result.data.gpuTemp) gpuTemp.textContent = result.data.gpuTemp;
        if (result.data.gpuVram && result.data.gpuVramTotal) {
          gpuVramUsage.textContent = result.data.gpuVram + '/' + result.data.gpuVramTotal + ' GB';
        }

        // 内存警告
        if (!window.disableMemoryWarning) {
          const memUsage = parseFloat(result.data.memUsage);
          if (memUsage >= MEMORY_WARNING_THRESHOLD) {
            if (!memoryWarningShown) {
              memoryWarningShown = true;
              showMemoryAlert(Math.round(memUsage));
            }
          } else {
            memoryWarningShown = false;
          }
        }
      }
    } catch (error) { console.error('Update error:', error); }
  }, 8000); // 5s → 8s
}

// === 启动 ===
// 串行加载：避免并发 IPC 抢占 PS 会话导致低性能机器超时
document.addEventListener('DOMContentLoaded', async () => {
  // 1. 电脑配置（纯 si 库，不占 PS）
  await loadConfigInfo();
  // 2. 实时数据填充（CPU/GPU/内存，含 GPU 名称/驱动）
  await loadSystemInfo();
  // 3. 存储设备 + 硬盘接口（依赖 PS WMI 查询，最重）
  await loadDiskInfo();
  // 全部加载完再开始轮询
  startRealtimeUpdate();
});
