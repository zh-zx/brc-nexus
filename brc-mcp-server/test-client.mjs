// 冒烟测试：用 MCP Client 通过 stdio 连接 brc-mcp-server，列出工具并调用 search_accessions
// 用法：先把 AI Token 写入 .test-token.txt（从系统设置 → AI 接入 复制）
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import fs from 'fs';

let token;
try {
  token = fs.readFileSync(new URL('./.test-token.txt', import.meta.url), 'utf-8').trim();
} catch (e) {
  console.error('缺少 .test-token.txt：请先创建该文件并填入 BRC AI Token（系统设置 → AI 接入）。');
  process.exit(1);
}

const transport = new StdioClientTransport({
  command: 'node',
  args: ['C:/Users/Lenovo/brc-helper-v2/brc-mcp-server/src/index.js'],
  env: {
    BRC_URL: 'http://localhost:7800',
    BRC_TOKEN: token,
  },
});

const client = new Client({ name: 'brc-mcp-test', version: '1.0.0' });
await client.connect(transport);

const tools = await client.listTools();
console.log('=== TOOLS ===');
console.log(tools.tools.map(t => t.name).join(', '));

const res = await client.callTool({ name: 'search_accessions', arguments: { q: 'CIP-10', limit: 2 } });
console.log('\n=== search_accessions(CIP-10) ===');
const text = res.content?.[0]?.text || JSON.stringify(res);
console.log(String(text).slice(0, 600));

const res2 = await client.callTool({ name: 'get_stats', arguments: {} });
console.log('\n=== get_stats ===');
console.log(String(res2.content?.[0]?.text || JSON.stringify(res2)).slice(0, 300));

await client.close();
console.log('\nMCP TEST OK');
