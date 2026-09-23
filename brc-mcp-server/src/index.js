#!/usr/bin/env node
/**
 * BRC Nexus — MCP Server
 *
 * 通过 stdio 连接 AI 助手（Claude Desktop / workbuddy / Cursor 等），
 * 所有数据查询都转发到 BRC 的 REST AI 网关（/api/ai/query），
 * 鉴权使用独立的 AI Token（BRC_TOKEN）。
 *
 * 环境变量：
 *   BRC_URL        BRC 服务器地址，默认 http://localhost:7800
 *   BRC_TOKEN      AI Token（系统设置 → AI 接入 中创建；不同角色 token 作用域不同）
 *   BRC_TOKEN_NAME 可选，仅用于日志标注（如 "operator-张三"）
 *
 * 权限隔离（v2.7）：服务端是最终裁决者。本进程启动时会请求 GET /api/ai/tools，
 * 只注册该 token 作用域内允许的工具——operator 等低权限 token 不会暴露
 * export_accessions / get_login_log / get_messages 等管理/敏感工具。
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

const BRC_URL = (process.env.BRC_URL || 'http://localhost:7800').replace(/\/$/, '');
const BRC_TOKEN = process.env.BRC_TOKEN || '';
const BRC_TOKEN_NAME = process.env.BRC_TOKEN_NAME || '';

async function aiQuery(tool, params = {}) {
  if (!BRC_TOKEN) {
    throw new Error('未配置 BRC_TOKEN，请到 BRC 系统设置 → AI 接入 创建令牌');
  }
  const res = await fetch(`${BRC_URL}/api/ai/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${BRC_TOKEN}`,
    },
    body: JSON.stringify({ tool, params }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`BRC 网关错误 (${res.status}): ${body.slice(0, 300)}`);
  }
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'BRC 网关返回失败');
  return json.result;
}

// 包装成标准 CallToolResult，兼容所有 MCP 客户端
function toResult(data) {
  return { content: [{ type: 'text', text: JSON.stringify(data) }] };
}

// ---- 工具定义表（启动时按 token 作用域过滤注册） ----
const TOOL_DEFS = {
  search_accessions: {
    description: '按关键字搜索种质资源（品种编号/名称/物种/来源），可指定检索范围',
    inputSchema: {
      q: z.string().optional().describe('搜索关键字'),
      scope: z.string().optional().describe('检索范围：all=全部，或具体字段名（primary_id/display_name/species/origin/性状代码）'),
      exact: z.boolean().optional().describe('是否精确匹配'),
      limit: z.number().int().min(1).max(200).optional().describe('返回条数上限，默认 50'),
    },
  },
  query_traits: {
    description: '跨种质组合检索性状：多条件 AND 连接，支持数值(gt/gte/lt/lte/eq/neq)、等级(=)、文本(contains)',
    inputSchema: {
      conditions: z.array(z.object({
        traitCode: z.string().describe('性状代码（trait_def.code）'),
        op: z.string().describe('算子：gt/gte/lt/lte/eq/neq/contains/empty/notempty'),
        value: z.string().optional().describe('比较值（empty/notempty 可省略）'),
      })).min(1).describe('至少一个条件'),
      page: z.number().int().min(1).optional().describe('页码'),
      limit: z.number().int().min(1).max(200).optional().describe('每页条数'),
    },
  },
  get_accession: {
    description: '按 ID 获取某个种质的完整数据（含全部性状）',
    inputSchema: {
      id: z.string().describe('种质 ID'),
    },
  },
  get_inventory: {
    description: '查询库存：按品种名称关键字过滤，返回各库房的实物分布与数量',
    inputSchema: {
      room: z.string().optional().describe('库房名称过滤'),
      germplasm: z.string().optional().describe('品种名称关键字'),
    },
  },
  get_operation_records: {
    description: '查询操作记录与追溯（组培/冷柜/超低温等模块），可按模块/步骤/人员/时间过滤',
    inputSchema: {
      module: z.string().optional(),
      step: z.string().optional(),
      operator: z.string().optional(),
      from: z.string().optional().describe('开始时间，如 2026-08-01'),
      to: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    },
  },
  get_trait_definitions: {
    description: '查看全部性状定义（代码/中英文名/分类/值类型/等级标尺），用于决定 query_traits 的 traitCode',
    inputSchema: {
      category: z.string().optional().describe('按分类过滤'),
    },
  },
  export_accessions: {
    description: '导出种质数据（JSON 或 CSV）',
    inputSchema: {
      format: z.enum(['json', 'csv']).optional().describe('导出格式，默认 json'),
    },
  },
  get_freezer_status: {
    description: '查看 -80℃ 冷藏箱容量配置与使用情况（已用盒子数、样品总数）',
    inputSchema: {},
  },
  get_stats: {
    description: '获取系统概览统计（种质总数、库存量、库房数等）',
    inputSchema: {},
  },
  get_cryo_records: {
    description: '查询超低温保存（液氮）操作记录，可按设备/事件类型/人员/时间过滤',
    inputSchema: {
      device: z.string().optional(),
      eventType: z.string().optional(),
      operator: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    },
  },
  get_login_log: {
    description: '查询登录审计日志（仅管理员 token 可用）',
    inputSchema: {
      action: z.string().optional(),
      user: z.string().optional(),
      from: z.string().optional(),
      to: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    },
  },
  get_messages: {
    description: '查询系统消息（仅管理员 token 可用）',
    inputSchema: {
      unread: z.string().optional().describe('仅未读：1'),
      limit: z.number().int().min(1).max(200).optional(),
    },
  },
};

// 启动时拉取当前 token 作用域，只注册允许的工具
async function fetchScope() {
  if (!BRC_TOKEN) return { scope: null, tools: [] };
  try {
    const res = await fetch(`${BRC_URL}/api/ai/tools`, {
      headers: { Authorization: `Bearer ${BRC_TOKEN}` },
    });
    if (!res.ok) {
      console.error(`[BRC MCP] 获取工具作用域失败 (${res.status})，将不注册任何工具（服务端仍会拒绝越权调用）`);
      return { scope: null, tools: [] };
    }
    const json = await res.json();
    return { scope: json.scope || null, tools: (json.tools || []).map(t => t.name) };
  } catch (e) {
    console.error(`[BRC MCP] 获取工具作用域失败: ${e.message}`);
    return { scope: null, tools: [] };
  }
}

const server = new McpServer({ name: 'brc-nexus', version: '1.1.0' });

const { scope, tools } = await fetchScope();
let registered = 0;
let skipped = 0;
for (const [name, def] of Object.entries(TOOL_DEFS)) {
  if (!tools.includes(name)) {
    console.error(`[BRC MCP] 跳过工具 ${name}（当前 token 无此权限）`);
    skipped++;
    continue;
  }
  server.registerTool(name, {
    description: def.description,
    inputSchema: def.inputSchema,
  }, async (args) => {
    return toResult(await aiQuery(name, args || {}));
  });
  registered++;
}

// 启动 stdio 传输
const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`BRC MCP Server 已启动 → ${BRC_URL} (token: ${BRC_TOKEN ? (BRC_TOKEN_NAME || '已配置') : '未配置'}, scope: ${scope || '未知'}, 注册工具 ${registered} 个, 跳过 ${skipped} 个)`);
