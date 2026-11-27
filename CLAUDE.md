# CLAUDE.md — BRC Nexus v2

## 定位

CIP-CCCAP（国际马铃薯中心亚太中心）**种质资源管理系统**：局域网单机部署，SQLite 单库 + 多设备浏览器访问 + Windows 打印代理 + AI/MCP 接入。覆盖种质档案、性状字典、库存/冻存、组培继代、工单巡检、引进分发审批、标签设计与打印。
代码当前版本 **2.18**（含进行中的 2.19 P0「生产就绪改造」）。仓库根 `package.json` 的 `"version": "2.0.0"` 是占位，**不要当真**。

### 子模块职责

| 目录 | 干什么 |
|---|---|
| `server/` | Fastify 4 + `node:sqlite` 的 REST API；同时承载 `/ws/print-agent` WebSocket 通道、`POST /mcp` MCP 端点、`/api/health`；生产模式下静态托管 `client/dist` |
| `client/` | React 18 + TS + Vite 5 + Tailwind 3 的 SPA（PWA），双主题 brutalist / classic，22 个业务页 |
| `print-agent/` | Electron 桌面应用，跑在接热敏打印机的 Windows PC 上：用隐藏 BrowserWindow 渲染服务端下发的 `labelsHtml` 再打印 |
| `brc-mcp-server/` | stdio 形态 MCP server，把工具调用转发到 `/api/ai/query`；启动时按 token 作用域**只注册**该角色可用的工具 |
| `ggce-server/` | 上游 GRIN-Global Community Edition v2026.3.0 源码（Java/Gradle），仅作参考/独立部署用，**不参与本项目构建** |
| `skills/brc-nexus/` | 管理端 AI 接入指南 + 角色权限矩阵 |
| `docs/mcp-skill/` | 给外部申请者的 MCP 技能与配置样例 |

## 运行

包管理器 npm。Node **≥ 22.5**（依赖 `node:sqlite` 的 `DatabaseSync`；**本机 v26.13.0 LTS**，`C:\Program Files\nodejs\node.exe`，2026-11-09 经 winget 装 `OpenJS.NodeJS.LTS`）。v26 起 `node:sqlite` **无需** `--experimental-sqlite` 标志；v26.10 起 `undefined` 显式绑为 NULL（本项目 `connection.js` 已自行归一为 null，两边一致）。

```bash
npm run setup      # 装 server / client / print-agent 依赖
npm run dev        # 并发起 server(7800) + client(5173)
npm run build      # 只构建 client → client/dist
npm run print-agent
node --test server/test/p0.test.mjs   # 后端集成测试（不需起服务）
```

- 端口：server `7800`（`BRC_PORT`），client dev `5173`（vite 把 `/api`、`/ws` 代理到 7800）。
- 数据库：`server/data/brc.db`（`BRC_DB_PATH` 可覆盖），WAL 模式，旁挂 `brc.db-wal` / `brc.db-shm`。
- 其它数据：`server/data/uploads`（静态服务在 `/uploads/`）、`server/data/backups`、`server/data/.jwt-secret`（gitignore）、`server/data/.restore-pending.json`（恢复标记）。
- 环境变量：`BRC_PORT`、`BRC_DB_PATH`、`BRC_LOG_LEVEL`、`BRC_DEBUG`（开启后 500 响应附 `detail`）、`JWT_SECRET`、`BRC_SERVER_URL`（print-agent）。
- 生产模式：server 会静态托管 `client/dist`（`wildcard: true` 实时读盘）→ **重新构建前端后无需重启 server**，刷新浏览器即可。

## 目录地图

```
server/src/db/schema.js     977 行：全部建表 + 幂等补列迁移 + 种子数据（改表结构几乎都动这里）
server/src/db/refs.js       跨表引用关系的**单一事实源**：block/cascade/revoke/audit 策略
server/src/db/connection.js node:sqlite 封装（run/get/all/tx/backupDb）
server/src/db/settings.js   app_setting 读取 + 内存缓存（改设置必须 clearSettingsCache）
server/src/routes/          23 个路由文件，一文件一模块
server/src/middleware/      auth(JWT+账号回查) / permissions(角色判定) / ipLimit(登录限流)
server/src/lib/audit.js     writeAudit()：业务关键操作的统一审计写点
client/src/pages/           22 个页面；`/find` 是找种质向导，`/db` 是数据库管理台
client/src/components/bitable/  多维表格（飞书形态，v2.15+）
client/src/lib/mcpd.ts      MCPD v2.1 描述符注册表 + 受控词表（SAMPSTAT/COLLSRC/MLSSTAT/ORIGCTY）
client/src/lib/controlFx.tsx 工作台控制室动效（useCountUp / LiveClock / Sparkline）
client/src/utils.ts         2787 行：中英 i18n `translations` + `t(key, lang)` + `cn()`
client/src/context/          AppContext（登录态 + 全局数据通道）、ThemeContext（主题）
verify_*.py / shots_*.py     根目录：Python API/UI 验证脚本与截图对比脚本
```

## 关键架构决策（做了什么 + 为什么）

1. **种质 = 4 个真实列 + 一个 JSON 列**。`accession` 只存 `primary_id/display_name/species/origin`，全部性状塞 `data_json`。为了加性状不用改表结构、支持自由增键；代价是所有查询走 `json_extract`，SQL 控制台里看不到性状（要在可视化模式看）。
2. **v2.7 数据库引擎迁移**：`sql.js`（内存库 + 5s 整库写盘）→ `node:sqlite` 原生 SQLite + WAL。原因是即时落盘、崩溃零丢失、大量附件下检索性能；旧 `brc.db` 是标准 SQLite 文件，直接打开，**无需数据迁移**。
3. **备份用 `VACUUM INTO`**：WAL 下 `copyFileSync` 不安全，`VACUUM INTO` 产出一致性快照且能被任意 SQLite 工具打开。
4. **删除策略在应用层做，不重建 SQLite 外键**（用户决策）。策略集 `block / cascade / revoke / audit` 定义在 `db/refs.js`，完整性扫描、删除拦截、孤儿对账三处共用。
5. **权限双层**：v2.12 起设置页「可见性矩阵」（界面层，可配置，按用户类型）+ 接口层硬防线（不可配置，Excel 导入/整库导出/手动备份/操作员字典等仅 admin）。
6. **AI 双通道**：REST 网关 `POST /api/ai/query` + MCP `POST /mcp`（streamable HTTP，JSON-RPC，**不开 SSE**）。令牌角色化，服务端是最终裁决者——客户端伪造工具列表一律 403。MCP Server 启动时调 `GET /api/ai/tools` 只注册作用域内工具。
7. **MCP 提交申请与手工/向导同构**：`source='mcp'`、`created_by=令牌名`，同一审批流、同一 35 上限与黑名单。
8. **标签打印所见即所得**：设计器渲染 `labelsHtml` 原样交给打印代理渲染；旧版文本+二维码仅作兜底。
9. **双主题零 React 重渲染**：切 `document.documentElement.dataset.theme` 换 CSS 变量；19 个未迁移页面靠 `:root[data-theme="classic"]` 的 CSS retint 覆盖块自动跟随主题。
10. **多维表格按万行×千性状设计**：服务端分页/筛选/排序/分组，前端定高 spacer 窗口化（**不用 transform**，避免与 sticky 冲突），只传可见列。
11. **外部申请者访问尚未实现**（v2.9 决策备忘，`README-操作说明.md` 第五十一节）：VPN 进内网 vs 公网独立门户二选一未定；开通前必须先收紧当前对任意登录用户开放的读取面。

## 踩坑点 / 非显然约束

**版本号**
1. 版本硬编码在 6 处，改版必须同步：`server/src/index.js`(`/api/health`)、`server/src/routes/mcp.js`(`SERVER_VERSION`)、`client/src/pages/LoginPage.tsx`、`client/src/pages/Dashboard.tsx`(2 处)、`client/src/utils.ts`(`app.concept`)、`Workbench.tsx` 命令栏 eyebrow。`verify_v215.py` 等脚本还断言版本号。

**依赖与运行时**
2. `server/package.json` 仍声明 `sql.js`，但代码已全部迁到 `node:sqlite` —— 该依赖是残留；`Setup.tsx` 里「使用内置 sql.js 数据库」文案也已过期。
3. `print-agent/main.js` 用 `await import('node-fetch')` 调 `/api/print/update`，但 **node-fetch 未声明也未安装** → 打印状态回写抛错，`print_job` 永远停在 `pending`。
4. print-agent 连 `ws://host:7800/ws/print-agent` **不带 `?token=`**，而服务端 v2.19 已要求握手 token。一旦在设置里配置 `print.agent_token`，打印代理会被 4001 拒绝、打印链路直接断。未配置时是 fail-open（仅告警），投产前必须配置。
5. `fastify.printAgent` 是**单例全局**，同一时刻只接受一个代理连接；多台打印机须在同一台 PC 上。

**数据模型**
6. `batch-update` 三态语义：值 `''` = **跳过**（Excel 空单元格兼容），值 `null` = **显式清空**（删 `data_json` 键），其他 = 写入。`mode:'replace'` 覆盖 / `'merge'` 只填空。`primaryId` 不可清空。
7. batch-update 的自定义键闸门：只有显式 `allowCustomKeys:true` 才允许未知表头按 `/^[A-Za-z0-9_]{1,64}$/` 写入 `data_json`；不置位默认拦截 —— 这是防 Excel 表头误拼的回归防护，别顺手去掉。
8. `bitable-query` 硬上限：filters ≤20、sort ≤3、columns ≤60、pageSize ≤500、分组 ≤500 组；字段名须过 `/^[A-Za-z0-9_]+$/` 才允许进 `json_extract` 插值；`RESERVED_JSON_KEYS` 里的服务端管理列不可当数据键。
9. `stockTotal` / `stockForms` 是 inventory 子查询算出的**伪字段**，不是真实列；排序时空值恒排最后（`created_at + id` 稳定 tiebreak）。
10. `ai_token.created_by` 存的是 **username 不是 id**（`refs.js` 里 parentKey 特例）。删用户走 `revoke`：置 `enabled=0` 保留台账，不物理删。
11. `created_at` 用 `datetime('now')` = **UTC**，而「今日/逾期」按本地时间算。v2.17 的 7 日活跃度桶因此要用 `-getTimezoneOffset()` 归一 —— 任何跨时区统计都要注意。

**数据库 / schema**
12. SQLite `ALTER TABLE ADD COLUMN` 的 DEFAULT 必须是常量，`datetime('now')` 不行 → 加带默认时间的列要先加无默认列再回填，路由显式写时间。`schema.js` 的迁移套路是「幂等 + `PRAGMA table_info` 判存在」。
13. `schema.js` 里的 `FOREIGN KEY` 声明写在 `CREATE TABLE IF NOT EXISTS` 内，对**既有库从未生效**。历史孤儿用 `node server/scripts/reconcile-orphans.mjs`（默认只读，`--apply` 才改数据，会先备份 + 写审计）。
14. `app_setting` 参数走 `db/settings.js` 的内存缓存。改完设置必须 `clearSettingsCache()`（`PUT /api/settings` 已调），否则不生效。
15. `user_setting`（个人偏好）只接受白名单 key：`wb.modules / ui.sidebar / ui.navOrder / ui.theme`（`routes/mySettings.js` 的 `ALLOWED_KEYS`）—— 新增个人设置项必须同步改白名单。
16. 删除种质/工单/房间一律走 `db/refs.js` 的 `guardedDelete()`，否则绕过 block 策略（种质有库存或冻存样本时**禁止删除**）。
17. 备份→恢复是**两阶段**：`POST /api/dbadmin/restore` 只写 `data/.restore-pending.json` 标记，**必须重启 server 才生效**。见 `server/docs/backup-restore-runbook.md`。
18. 自动备份默认**关闭**（`backup.enabled` 默认 false），需在设置里开；间隔/保留天数分别是 `backup.interval_hours`(24)、`backup.retention_days`(30)。
19. 数据库管理台 SQL 控制台：`user / ai_token / login_log / audit_log / login_lock` 五表只读（`DENY_CRUD`）；DDL、多语句、`ATTACH`、`VACUUM`、危险 PRAGMA 一律拒绝；写操作二次确认并写审计。
20. 巡检「指派给我」过滤在 **JS 侧**做（历史原因：sql.js 不支持相关子查询里的 `json_each`，会返回空结果）—— 不要改回 SQL 过滤。

**安全**
21. JWT 密钥不能用硬编码默认值：优先 `JWT_SECRET` env，否则读写 `server/data/.jwt-secret`（随机生成、gitignore）。换密钥 = 所有人重新登录。
22. 令牌/密码明文**只显示一次**；`ai_token` 只存 sha256（`token_hash`），丢了只能重建，没有找回路径。
23. `authMiddleware` 每次都回查 `user` 行：账号被删或 `status` 为 `disabled`/`pending`，JWT 立刻失效。
24. 角色判定在 `middleware/permissions.js`：`admin` / `user_type = operator|approver|regulator|external`。`canApprove` = admin 或 approver；`readOnlyGuard` 只挡 regulator。

**前端**
25. Tailwind 摇树：`.t-input` / `.t-card` 若无 JSX 直接引用会被编译剔除，真实样式由别名 `.glass-input { @apply t-input }` / `.glass-panel { @apply t-card }` 承载。verify 脚本断言的是 `.glass-input`，不是 `.t-input`。
26. CSS 注释里**不能出现 `*/`**（曾让 postcss 报 `Unexpected '/'`）。
27. `client/src/api.ts`：无 body 的 POST/DELETE **不能**带 `Content-Type: application/json`，Fastify 会判 400。
28. PWA：主 JS 约 3.1MB，`vite.config.ts` 里 `maximumFileSizeToCacheInBytes` 提到 5MB 才不炸；改前端后 PWA 可能仍走旧缓存。
29. 主题持久化在 `user_setting.ui.theme`；`verify_ui_v213.py` 依赖前一个脚本留下的主题状态，v2.16 起需前置 API 重置为 brutalist，否则假红。**脚本之间有顺序依赖**。
30. **Excel 导入链路契约**：`/api/excel/upload` 响应必须含完整 `rows`（前端 `excelRows` 靠它提交 import，缺了 IMPORT 按钮静默无效）；`importExcel` 的事务走 connection.js 的模块级 `tx(fn)`——`DatabaseSync` **没有** `.transaction()`（那是 better-sqlite3 的 API）。`/api/excel/import` 是 JSON body，受 Fastify 默认 1 MiB bodyLimit 限制。

## 验证方式

```bash
# 后端集成测试（node:test + fastify.inject，自动用临时 DB，不需起服务）
cd server && node --test test/p0.test.mjs

# API 层验证（需 server 在 7800 运行；用硬编码 admin/admin123 登录）
python verify_v215.py        # 多维表格契约、筛选与 sqlite 直查对照、权限、自由增键
python verify_v211.py        # v2.11 特性

# UI 层验证（Playwright）
python verify_ui_v218.py     # 语义 token + 双主题 + 冻结不变量
python verify_ui_v216.py

# 视觉比对
python shots_v217.py

# 孤儿对账（默认只读）
node server/scripts/reconcile-orphans.mjs
```

**验证脚本跑在生产库上**：`verify_*.py` 用 `admin/admin123` 登录真实服务器，部分脚本还直接用 `sqlite3` 打开 `server/data/brc.db` 对账。跑之前先备份。

改动后快速自检：改后端 → `node --test server/test/p0.test.mjs` + 起 server 跑 `verify_v215.py`；改前端 → `cd client && npm run build` → 刷新浏览器（server 实时读 `client/dist`，无需重启）→ 跑对应 `verify_ui_*.py`。

## 文档位置

- `README-操作说明.md`（95KB，仓库根）—— **最权威的决策记录**。第 1–10 节是快速开始/架构/目录；第 44–64 节逐版本累加「由来 → 做了什么 → 验证 → 明确不做」。**注意头部写的「版本：2.8.0」已过期**，正文内容仍然有效。
- `server/docs/backup-restore-runbook.md` —— 备份/恢复演练手册（数据文件位置表在第 0 节）。
- `docs/mcp-skill/SKILL.md` —— 面向申请者的 MCP 技能（含 35 上限等硬性规则）。
- `skills/brc-nexus/SKILL.md` —— 面向管理员的 AI 接入指南 + 角色权限矩阵。
- `brc-mcp-server/README-接入说明.md` —— MCP Server 接入细节。
- 仓库**没有** `docs/specs/` 与 `docs/plans/`；设计决策都写在 `README-操作说明.md` 正文里。
- `_tmp_*`、`backups/`、`shots*/` 是临时产物目录，**不要翻**。
