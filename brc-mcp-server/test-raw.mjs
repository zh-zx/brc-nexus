// 用原始 JSON-RPC 通过 stdio 测试 MCP server，避免 Client SDK 版本干扰
// 用法：先把 AI Token 写入 .test-token.txt（从系统设置 → AI 接入 复制）
import { spawn } from 'child_process';
import fs from 'fs';

let token;
try {
  token = fs.readFileSync(new URL('./.test-token.txt', import.meta.url), 'utf-8').trim();
} catch (e) {
  console.error('缺少 .test-token.txt：请先创建该文件并填入 BRC AI Token（系统设置 → AI 接入）。');
  process.exit(1);
}

const child = spawn('node', ['C:/Users/Lenovo/brc-helper-v2/brc-mcp-server/src/index.js'], {
  env: { ...process.env, BRC_URL: 'http://localhost:7800', BRC_TOKEN: token },
  stdio: ['pipe', 'pipe', 'inherit'],
});

let buf = '';
const pending = new Map();
let nextId = 1;

child.stdout.on('data', (chunk) => {
  buf += chunk.toString();
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (!line) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    } catch (e) { /* ignore */ }
  }
});

function call(method, params) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('timeout')); } }, 15000);
  });
}

// initialize
const init = await call('initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'raw-test', version: '1.0' },
});
console.log('INIT:', JSON.stringify(init.result?.serverInfo), 'tools:', (init.result?.capabilities?.tools || {}));

await call('notifications/initialized', {});

// list tools
const tools = await call('tools/list', {});
console.log('\nTOOLS:', tools.result?.tools?.map(t => t.name).join(', '));

// call search_accessions
const res = await call('tools/call', {
  name: 'search_accessions',
  arguments: { q: 'CIP-10', limit: 2 },
});
console.log('\nCALL RESULT (truncated):', JSON.stringify(res).slice(0, 900));

child.kill();
process.exit(0);
