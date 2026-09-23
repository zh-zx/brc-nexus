const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const WebSocket = require('ws');

const SERVER_URL = process.env.BRC_SERVER_URL || 'http://localhost:7800';
const WS_URL = SERVER_URL.replace(/^http/, 'ws') + '/ws/print-agent';

let mainWindow = null;
let ws = null;
let reconnectTimer = null;
let printWorker = null;

// Disable hardware acceleration to prevent freezing
app.disableHardwareAcceleration();

function createPrintWorker() {
  if (printWorker && !printWorker.isDestroyed()) return;
  printWorker = new BrowserWindow({
    show: false,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      offscreen: false
    }
  });
  printWorker.on('closed', () => { printWorker = null; });
}

function log(msg) {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`[${timestamp}] ${msg}`);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.executeJavaScript(`document.getElementById('log').innerHTML += '<div>${msg.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>'`).catch(() => {});
  }
}

function connectWebSocket() {
  if (ws) {
    try { ws.close(); } catch(e) {}
    ws = null;
  }

  log(`Connecting to BRC server at ${WS_URL}...`);

  try {
    ws = new WebSocket(WS_URL);

    ws.on('open', () => {
      log('Connected to BRC Server!');
      // Register available printers
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.getPrintersAsync().then(printers => {
          const printerNames = printers.map(p => p.name);
          log(`Available printers: ${printerNames.join(', ')}`);
          ws.send(JSON.stringify({ type: 'register', printers: printerNames }));

          // Update UI
          mainWindow.webContents.executeJavaScript(`
            document.getElementById('status').innerHTML = '<span style="color:#2e7d32">● CONNECTED</span>';
            document.getElementById('printers').innerHTML = '${printerNames.join('<br/>').replace(/'/g, "\\'")}';
          `).catch(() => {});
        }).catch(() => {});
      }
    });

    ws.on('message', async (data) => {
      try {
        const msg = JSON.parse(data.toString());
        log(`Received: ${msg.type} jobId=${msg.jobId || 'N/A'}`);

        if (msg.type === 'print') {
          await handlePrintJob(msg);
        }
      } catch (e) {
        log(`Error processing message: ${e.message}`);
      }
    });

    ws.on('close', () => {
      log('Disconnected from server. Reconnecting in 10s...');
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.executeJavaScript(`document.getElementById('status').innerHTML = '<span style="color:orange">○ RECONNECTING...</span>'`).catch(() => {});
      }
      reconnectTimer = setTimeout(connectWebSocket, 10000);
    });

    ws.on('error', (err) => {
      log(`WebSocket error: ${err.message}`);
      ws.close();
    });
  } catch (e) {
    log(`Connection failed: ${e.message}. Retrying in 30s...`);
    reconnectTimer = setTimeout(connectWebSocket, 30000);
  }
}

async function handlePrintJob(job) {
  const { jobId, items, templateId, printerName, copies = 1 } = job;

  try {
    // Ensure worker exists
    createPrintWorker();
    if (!printWorker || printWorker.isDestroyed()) {
      createPrintWorker();
    }

    // Build HTML for printing
    // 优先使用设计器生成的 WYSIWYG 标签 HTML，否则回退到内置文本样式
    const printHtml = (job.labelsHtml && job.labelsHtml.trim())
      ? job.labelsHtml
      : await buildPrintHtml(items, templateId, job);

    await printWorker.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(printHtml)}`);

    // Wait for DOM to render
    await new Promise(resolve => setTimeout(resolve, 800));

    const printSettings = {
      silent: true,
      printBackground: true,
      deviceName: printerName || undefined,
      copies: parseInt(copies, 10) || 1,
      color: false,
      scaleFactor: 100
    };

    log(`Printing ${items.length} label(s) to ${printerName || 'default printer'}...`);

    const result = await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve({ success: false, error: 'Print timeout (30s)' });
      }, 30000);

      printWorker.webContents.print(printSettings, (success, errorType) => {
        clearTimeout(timeout);
        resolve(success ? { success: true } : { success: false, error: errorType });
      });
    });

    if (result.success) {
      log(`Print job ${jobId} completed successfully`);
    } else {
      log(`Print job ${jobId} failed: ${result.error}`);
    }

    // Notify server
    if (ws && ws.readyState === WebSocket.OPEN) {
      // Use HTTP API to update status
      const fetch = (await import('node-fetch')).default;
      await fetch(`${SERVER_URL}/api/print/update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobId,
          status: result.success ? 'completed' : 'error',
          error: result.error || null
        })
      }).catch(() => {});
    }

    // Cleanup
    if (printWorker && !printWorker.isDestroyed()) {
      printWorker.loadURL('about:blank');
    }

  } catch (e) {
    log(`Print error: ${e.message}`);
    if (printWorker && !printWorker.isDestroyed()) printWorker.destroy();
    printWorker = null;
  }
}

async function buildPrintHtml(items, templateId, job) {
  // Build inline label HTML for printing
  const { operator = '', medium = '', copies = 1 } = job;

  // Since we can't render React on the print agent,
  // we request the server to generate label HTML
  // For now, use a simple fallback: text-based labels
  const labels = [];
  for (const item of items) {
    const count = parseInt(copies) || 1;
    for (let c = 0; c < count; c++) {
      labels.push(`
        <div style="page-break-after:always;padding:10mm;font-family:Arial,sans-serif;">
          <div style="font-size:24pt;font-weight:bold;">${item.cccapNo || item.id || ''}</div>
          <div style="font-size:14pt;margin-top:4pt;">${item.name || ''}</div>
          <div style="font-size:10pt;margin-top:8pt;color:#666;">${operator} | ${new Date().toLocaleDateString()}</div>
          <div style="margin-top:12pt;">
            <svg width="80" height="80" viewBox="0 0 80 80">
              <rect width="80" height="80" fill="white" stroke="black" stroke-width="0.5"/>
              ${generateQRPath(item.cccapNo || item.id || '', 80)}
            </svg>
          </div>
        </div>
      `);
    }
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    @page { margin: 0; size: ${job.width || 50}mm ${job.height || 30}mm; }
    body { margin: 0; padding: 0; }
    * { box-sizing: border-box; color: #000; }
  </style></head><body>${labels.join('')}</body></html>`;
}

function generateQRPath(text, size) {
  // Simplified QR-like pattern - in production use the server-generated label HTML
  return '';
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 640,
    icon: path.join(__dirname, '../client/public/favicon.svg'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    autoHideMenuBar: true,
    title: "BRC Print Agent v2"
  });

  mainWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 20px; background: #f0fdf4; }
  .card { background: white; border-radius: 16px; padding: 24px; box-shadow: 0 4px 24px rgba(0,0,0,0.06); }
  h1 { color: #2e7d32; font-size: 20px; margin: 0 0 4px 0; }
  .subtitle { color: #666; font-size: 12px; margin-bottom: 20px; }
  .status-bar { background: #e8f5e9; border-radius: 12px; padding: 12px 16px; margin-bottom: 16px; font-size: 14px; font-weight: bold; }
  #status { color: #666; }
  .section-title { font-size: 10px; font-weight: bold; color: #999; text-transform: uppercase; letter-spacing: 1px; margin: 16px 0 8px 0; }
  #printers { font-size: 12px; color: #333; line-height: 1.8; }
  #log { font-size: 11px; color: #666; font-family: 'Courier New', monospace; max-height: 240px; overflow-y: auto; background: #fafafa; border-radius: 8px; padding: 12px; margin-top: 8px; }
  .footer { text-align: center; font-size: 10px; color: #bbb; margin-top: 20px; }
  .config { font-size: 11px; background: #f5f5f5; border-radius: 8px; padding: 8px 12px; margin: 4px 0; }
  .config span { font-weight: bold; color: #333; }
</style></head>
<body>
  <div class="card">
    <h1>BRC Print Agent</h1>
    <div class="subtitle">v2.0.0 — LAN Thermal Label Printer Service</div>
    <div class="status-bar">
      <div id="status">○ CONNECTING...</div>
    </div>
    <div class="config"><span>Server:</span> ${SERVER_URL}</div>
    <div class="section-title">Available Printers</div>
    <div id="printers">Loading...</div>
    <div class="section-title">Activity Log</div>
    <div id="log">Starting print agent...</div>
    <div class="footer">CIP-CCCAP &bull; BRC Nexus v2</div>
  </div>
  <script>
    document.title = 'BRC Print Agent';
  </script>
</body>
</html>
  `)}`);

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(() => {
  createWindow();
  // Give the window a moment to render, then connect
  setTimeout(connectWebSocket, 1000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (ws) { try { ws.close(); } catch(e) {} }
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (ws) { try { ws.close(); } catch(e) {} }
  if (printWorker && !printWorker.isDestroyed()) printWorker.destroy();
});
