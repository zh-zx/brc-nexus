---
name: brc-nexus
description: BRC Nexus（种质资源管理系统）AI 接入指南 — 配置 MCP、申请角色化 Token、了解权限矩阵。当用户询问如何用 AI 连接/查询 BRC Nexus、申请 AI Token、或遇到"无权限"错误时使用。
---

# BRC Nexus — AI 接入与权限指南

BRC Nexus 提供 **REST AI 网关**（`/api/ai/query`）与 **MCP Server**（`brc-mcp-server/`），
让 AI 助手可以安全地检索种质资源、库存、操作记录等数据。

## 1. 申请 Token

- 联系 **BRC 系统管理员**，在「系统设置 → AI 接入 → 作用域令牌管理」中为你创建 Token。
- 每个 Token 绑定一个**角色**，只能调用该角色作用域内的工具（服务端强制校验）。
- 管理员创建后**仅显示一次明文**，请立即保存。

## 2. 配置 MCP

`brc-mcp-server/` 已随仓库内置，直接使用：

```json
{
  "mcpServers": {
    "brc": {
      "command": "npx",
      "args": ["-y", "brc-mcp-server"],
      "env": {
        "BRC_URL": "http://<服务器IP>:7800",
        "BRC_TOKEN": "<你的角色化 Token>"
      }
    }
  }
}
```

> `BRC_TOKEN_NAME` 可选，仅用于日志标注（如 `operator-张三`），不影响权限。

MCP Server 启动时会请求 `GET /api/ai/tools`，**只注册当前 Token 作用域内的工具**；
作用域外的工具不会注册（服务端仍会拒绝越权调用）。

## 3. 权限矩阵（v2.7）

| AI 工具 | admin | approver | operator | regulator | external |
|---|---|---|---|---|---|
| search_accessions / get_accession | ✅ | ✅ | ✅ | ✅ | ✅ |
| query_traits / get_trait_definitions | ✅ | ✅ | ✅ | ✅ | ✅ |
| get_stats / get_inventory / get_freezer_status | ✅ | ✅ | ✅ | ✅ | ✅ |
| get_operation_records / get_cryo_records | ✅ | ✅ | ✅ | ✅ | — |
| export_accessions | ✅ | ✅ | — | — | — |
| get_login_log / get_messages | ✅ | — | — | — | — |
| 创建 / 吊销 Token | ✅ | — | — | — | — |

## 4. 硬性规则（务必遵守）

- **不得**请求超出当前 Token 作用域的工具或端点——服务端是最终裁决者，越权一律返回 `403`。
- **普通用户（operator/regulator/external）Token 永远无法获得管理能力**
  （登录日志、系统消息、导出、令牌管理均不可用）。
- 不要尝试伪造工具列表或绕过鉴权，任何此类尝试都会被服务端拒绝。
- 调用失败时，检查返回的 `error` 信息；`403` 表示该 Token 无此权限，应向管理员申请更高角色。

## 5. 常用工具速览

- `search_accessions {q, scope, exact}` — 关键字搜索种质（编号/名称/物种/来源）
- `get_accession {id}` — 按 ID 或种质编号获取完整数据（含全部性状）
- `query_traits {conditions}` — 跨种质组合检索性状（AND 连接）
- `get_trait_definitions` — 查看全部性状定义（决定 query_traits 的 traitCode）
- `get_inventory {room, germplasm}` — 查询库存分布
- `get_operation_records {module, step, operator, from, to}` — 操作记录追溯
- `get_cryo_records {device, eventType, operator, from, to}` — 超低温（液氮）记录
- `get_freezer_status` — -80℃ 冷藏箱容量与使用情况
- `get_stats` — 系统概览统计
