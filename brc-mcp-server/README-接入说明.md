# BRC Nexus — MCP Server 接入说明

BRC Nexus 预留了 **MCP (Model Context Protocol) 接口**，让 AI 助手（Claude Desktop、workbuddy、Cursor、Claude Code 等）可以直接查询 BRC 系统的种质资源、性状、库存、操作记录等数据。

## 工作原理

```
AI 助手 ──stdio──▶ brc-mcp-server ──HTTP(Bearer Token)──▶ BRC REST AI 网关 (/api/ai/query) ──▶ BRC 数据库
```

- MCP Server 本身**不直接读数据库**（BRC 的 sql.js 内存库每 5 秒才落盘一次，直接读会读到旧数据），
  所有查询一律转发到 BRC 的 HTTP 网关，保证读到实时数据、避免写入冲突。
- 鉴权使用独立的 **AI Token**（与用户登录 JWT 无关），在「系统设置 → AI 接入」页面查看/轮换。

## 前提

1. BRC 服务器已启动：`http://<服务器IP>:7800`
2. 在浏览器打开 BRC 系统 → 系统设置 → **AI 接入**，复制 `BRC_TOKEN`

## 方式一：使用本仓库（推荐，局域网可访问）

在部署 BRC 的机器上（或能访问 BRC 的任意机器）：

```bash
cd brc-helper-v2/brc-mcp-server
npm install
```

然后在 AI 助手的 MCP 配置中，**命令**填本机的 node 路径 + 本文件路径，并设置环境变量：

| 环境变量 | 说明 | 示例 |
|---|---|---|
| `BRC_URL` | BRC 服务器地址 | `http://192.168.1.100:7800` |
| `BRC_TOKEN` | AI Token（系统设置 → AI 接入） | `5f59a0d4...` |

### Claude Desktop

编辑 `claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "brc": {
      "command": "node",
      "args": ["C:\\Users\\Lenovo\\brc-helper-v2\\brc-mcp-server\\src\\index.js"],
      "env": {
        "BRC_URL": "http://localhost:7800",
        "BRC_TOKEN": "<你的 AI Token>"
      }
    }
  }
}
```

### workbuddy / Cursor

在 MCP 设置中新增：

```json
{
  "mcpServers": {
    "brc": {
      "command": "node",
      "args": ["C:\\Users\\Lenovo\\brc-helper-v2\\brc-mcp-server\\src\\index.js"],
      "env": {
        "BRC_URL": "http://localhost:7800",
        "BRC_TOKEN": "<你的 AI Token>"
      }
    }
  }
}
```

> 注意：Windows 下路径中的 `\` 需要写成 `\\`。

## 方式二：通过 npx（若发布到 npm）

```json
{
  "mcpServers": {
    "brc": {
      "command": "npx",
      "args": ["-y", "brc-mcp-server"],
      "env": {
        "BRC_URL": "http://localhost:7800",
        "BRC_TOKEN": "<你的 AI Token>"
      }
    }
  }
}
```

## 可用工具

| 工具 | 说明 | 主要参数 |
|---|---|---|
| `search_accessions` | 按关键字搜索种质 | `q`, `scope`, `exact`, `limit` |
| `query_traits` | 跨种质多性状组合检索（AND） | `conditions:[{traitCode,op,value}]`, `page`, `limit` |
| `get_accession` | 获取单个种质完整数据 | `id` |
| `get_inventory` | 查询库存分布 | `room`, `germplasm` |
| `get_operation_records` | 查询操作记录/追溯 | `module`, `step`, `operator`, `from`, `to`, `limit` |
| `get_trait_definitions` | 查看全部性状定义（含等级标尺） | `category` |
| `export_accessions` | 导出种质（JSON/CSV） | `format` |
| `get_freezer_status` | 冷藏箱容量与使用情况 | — |
| `get_stats` | 系统概览统计 | — |

### query_traits 算子说明

| 值类型 | 支持算子 |
|---|---|
| number | `gt` `gte` `lt` `lte` `eq` `neq` `empty` `notempty` |
| scale（等级） | `eq`（value 为等级键，如 `5`）`empty` `notempty` |
| text | `contains` `eq` `neq` `empty` `notempty` |

## 直连 REST 网关（不经过 MCP）

如果只是临时想用 curl 调用：

```bash
# 1. 获取 Token（用管理员 JWT）
curl http://localhost:7800/api/ai/token -H "Authorization: Bearer <管理员JWT>"

# 2. 调用查询（用 AI Token）
curl -X POST http://localhost:7800/api/ai/query \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <AI_TOKEN>" \
  -d '{"tool":"search_accessions","params":{"q":"CIP-10"}}'
```

## 常见问题

- **`未配置 BRC_TOKEN`**：在 BRC「系统设置 → AI 接入」复制 Token，填入环境变量。
- **`BRC 网关错误 (401)`**：Token 错误或已被轮换，重新获取。
- **连接失败**：确认 `BRC_URL` 是本机可访问的地址（局域网请用服务器 IP），并确认 BRC 服务器已启动。
