import { getDb, get, run, all } from './connection.js';
import crypto from 'crypto';

export function runMigrations() {
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS user (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      display_name TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS excel_upload (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      uploaded_at TEXT DEFAULT (datetime('now')),
      uploaded_by TEXT,
      row_count INTEGER DEFAULT 0,
      import_mode TEXT DEFAULT 'replace',
      raw_columns_json TEXT,
      raw_rows_json TEXT,
      mapping_json TEXT
    );

    CREATE TABLE IF NOT EXISTS accession (
      id TEXT PRIMARY KEY,
      data_json TEXT NOT NULL,
      primary_id TEXT,
      display_name TEXT,
      species TEXT,
      origin TEXT,
      source_upload_id TEXT,
      last_modified_by TEXT,
      last_modified_at TEXT DEFAULT (datetime('now')),
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (source_upload_id) REFERENCES excel_upload(id)
    );

    CREATE INDEX IF NOT EXISTS idx_accession_primary_id ON accession(primary_id);
    CREATE INDEX IF NOT EXISTS idx_accession_display_name ON accession(display_name);
    CREATE INDEX IF NOT EXISTS idx_accession_species ON accession(species);

    CREATE TABLE IF NOT EXISTS room (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS inventory (
      id TEXT PRIMARY KEY,
      accession_id TEXT,
      room_id TEXT NOT NULL,
      germplasm_name TEXT,
      quantity INTEGER DEFAULT 0,
      form TEXT DEFAULT 'Glass Tube',
      barcode TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (accession_id) REFERENCES accession(id) ON DELETE SET NULL,
      FOREIGN KEY (room_id) REFERENCES room(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS subculture_event (
      id TEXT PRIMARY KEY,
      accession_id TEXT,
      scanned_id TEXT NOT NULL,
      operator TEXT,
      medium TEXT,
      copies INTEGER DEFAULT 1,
      template_id TEXT,
      event_at TEXT DEFAULT (datetime('now')),
      user_id TEXT,
      FOREIGN KEY (user_id) REFERENCES user(id)
    );

    CREATE TABLE IF NOT EXISTS label_template (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      width REAL DEFAULT 50,
      height REAL DEFAULT 30,
      layout_json TEXT,
      elements_json TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS code_value (
      id TEXT PRIMARY KEY,
      group_code TEXT NOT NULL,
      code TEXT NOT NULL,
      title_zh TEXT,
      title_en TEXT,
      sort_order INTEGER DEFAULT 0,
      UNIQUE(group_code, code)
    );

    CREATE TABLE IF NOT EXISTS operator (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS media_type (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS app_setting (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT,
      record_id TEXT,
      action TEXT,
      before_json TEXT,
      after_json TEXT,
      user_id TEXT,
      username TEXT,
      ip_address TEXT,
      timestamp TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS print_job (
      id TEXT PRIMARY KEY,
      status TEXT DEFAULT 'pending',
      template_id TEXT,
      items_json TEXT,
      printer_name TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT,
      error TEXT
    );
  `);

  // Insert default settings if not exist
  const settingCount = get('SELECT COUNT(*) as c FROM app_setting');
  if (!settingCount || settingCount.c === 0) {
    run("INSERT OR IGNORE INTO app_setting (key, value) VALUES ('language', 'zh')");
    run("INSERT OR IGNORE INTO app_setting (key, value) VALUES ('primary_id_column', 'cccapNo')");
    run("INSERT OR IGNORE INTO app_setting (key, value) VALUES ('name_column', 'name')");
    run("INSERT OR IGNORE INTO app_setting (key, value) VALUES ('enable_print_log', 'false')");
    run("INSERT OR IGNORE INTO app_setting (key, value) VALUES ('print_log_path', '')");
    run("INSERT OR IGNORE INTO app_setting (key, value) VALUES ('version', '2.2.0')");
  }
  // Data source settings (local vs GGCE integration)
  run("INSERT OR IGNORE INTO app_setting (key, value) VALUES ('data_source_mode', 'local')");
  run("INSERT OR IGNORE INTO app_setting (key, value) VALUES ('ggce_server_url', '')");
  run("INSERT OR IGNORE INTO app_setting (key, value) VALUES ('ggce_api_token', '')");
  run("INSERT OR IGNORE INTO app_setting (key, value) VALUES ('label_mode', 'local')");

  // Migration: add barcode column to inventory if missing (for existing DBs)
  try {
    const cols = all('PRAGMA table_info(inventory)');
    const hasBarcode = cols.some(c => c.name === 'barcode');
    if (!hasBarcode) {
      run('ALTER TABLE inventory ADD COLUMN barcode TEXT');
    }
  } catch (e) {
    // ignore - column may already exist
  }

  // Migration: add html column to print_job (WYSIWYG label HTML) if missing
  try {
    const pjCols = all('PRAGMA table_info(print_job)');
    if (!pjCols.some(c => c.name === 'html')) {
      run('ALTER TABLE print_job ADD COLUMN html TEXT');
    }
  } catch (e) {    // ignore - column may already exist
  }

  // 性状定义表（预置 CIP 字典 + 用户自定义），幂等创建兼容旧库
  // v2.10: illustration(示意图 dataURL) / desc_zh / desc_en（说明文字）
  run(`
    CREATE TABLE IF NOT EXISTS trait_def (
      id TEXT PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name_en TEXT,
      name_zh TEXT,
      category TEXT DEFAULT 'other',
      value_type TEXT DEFAULT 'text',
      unit TEXT,
      scale_json TEXT,
      illustration TEXT,
      desc_zh TEXT,
      desc_en TEXT,
      is_system INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // ---- v2.3: 需求文档新增模块表 ----

  // 操作记录与追溯（组织培养/冷藏箱/超低温通用）
  run(`
    CREATE TABLE IF NOT EXISTS operation_step_def (
      id TEXT PRIMARY KEY,
      module TEXT NOT NULL,
      code TEXT,
      step_no INTEGER,
      title TEXT,
      title_en TEXT,
      required_fields_json TEXT,
      sort_order INTEGER DEFAULT 0,
      is_system INTEGER DEFAULT 0
    )
  `);
  run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_operation_step_module_code ON operation_step_def(module, code)`);
  run(`
    CREATE TABLE IF NOT EXISTS operation_record (
      id TEXT PRIMARY KEY,
      module TEXT,
      batch_id TEXT,
      step_code TEXT,
      title TEXT,
      operator TEXT,
      content_json TEXT,
      notes TEXT,
      event_at TEXT DEFAULT (datetime('now')),
      immutable INTEGER DEFAULT 1,
      user_id TEXT
    )
  `);
  run(`CREATE INDEX IF NOT EXISTS idx_operation_record_module ON operation_record(module)`);
  run(`CREATE INDEX IF NOT EXISTS idx_operation_record_operator ON operation_record(operator)`);
  run(`CREATE INDEX IF NOT EXISTS idx_operation_record_event_at ON operation_record(event_at)`);

  // -80℃ 冷藏箱多级定位存储
  run(`
    CREATE TABLE IF NOT EXISTS freezer_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      freezer_count INTEGER DEFAULT 3,
      shelf_per_freezer INTEGER DEFAULT 4,
      drawer_per_shelf INTEGER DEFAULT 35,
      box_per_drawer INTEGER DEFAULT 5,
      row_count INTEGER DEFAULT 9,
      col_count INTEGER DEFAULT 9,
      box_ranges_json TEXT
    )
  `);
  run(`
    CREATE TABLE IF NOT EXISTS freezer_box (
      id TEXT PRIMARY KEY,
      box_no INTEGER UNIQUE NOT NULL,
      freezer_no INTEGER,
      shelf_no INTEGER,
      drawer_no INTEGER,
      qr TEXT UNIQUE
    )
  `);
  run(`
    CREATE TABLE IF NOT EXISTS freezer_sample (
      id TEXT PRIMARY KEY,
      box_id TEXT,
      position_no INTEGER,
      accession_id TEXT,
      sample_code TEXT,
      quantity REAL DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (box_id) REFERENCES freezer_box(id)
    )
  `);
  run(`
    CREATE TABLE IF NOT EXISTS freezer_movement (
      id TEXT PRIMARY KEY,
      box_id TEXT,
      sample_id TEXT,
      action TEXT,
      from_loc TEXT,
      to_loc TEXT,
      operator TEXT,
      event_at TEXT DEFAULT (datetime('now')),
      user_id TEXT
    )
  `);

  // 通用审批流配置（引进/分发共用）
  run(`
    CREATE TABLE IF NOT EXISTS approval_flow (
      id TEXT PRIMARY KEY,
      module TEXT NOT NULL,
      stage_no INTEGER,
      title TEXT,
      title_en TEXT,
      required_docs_json TEXT,
      sort_order INTEGER DEFAULT 0
    )
  `);

  // 种质引进审批
  run(`
    CREATE TABLE IF NOT EXISTS intro_request (
      id TEXT PRIMARY KEY,
      req_no TEXT UNIQUE,
      applicant_org TEXT,
      contact TEXT,
      resource_type TEXT,
      qty REAL,
      origin TEXT,
      trait_description TEXT,
      risk_level TEXT,
      docs_json TEXT,
      status TEXT DEFAULT 'pending',
      current_stage INTEGER DEFAULT 1,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  run(`
    CREATE TABLE IF NOT EXISTS intro_approval (
      id TEXT PRIMARY KEY,
      request_id TEXT,
      stage INTEGER,
      approver TEXT,
      comment TEXT,
      decision TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  run(`
    CREATE TABLE IF NOT EXISTS quarantine_record (
      id TEXT PRIMARY KEY,
      request_id TEXT,
      batch_no TEXT,
      base_name TEXT,
      start_date TEXT,
      end_date TEXT,
      monitor_json TEXT,
      report_docs_json TEXT,
      conclusion TEXT,
      status TEXT DEFAULT 'quarantining',
      reminder_due TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // 种质分发审批与跟踪
  run(`
    CREATE TABLE IF NOT EXISTS dist_request (
      id TEXT PRIMARY KEY,
      req_no TEXT UNIQUE,
      applicant TEXT,
      applicant_org TEXT,
      purpose TEXT,
      resource_type TEXT,
      qty REAL,
      duration_days INTEGER,
      qualification_docs_json TEXT,
      accessions_json TEXT,
      source TEXT DEFAULT 'manual',
      status TEXT DEFAULT 'pending',
      current_stage INTEGER DEFAULT 1,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  run(`
    CREATE TABLE IF NOT EXISTS dist_approval (
      id TEXT PRIMARY KEY,
      request_id TEXT,
      stage INTEGER,
      approver TEXT,
      comment TEXT,
      decision TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  run(`
    CREATE TABLE IF NOT EXISTS dist_order (
      id TEXT PRIMARY KEY,
      request_id TEXT,
      pickup_method TEXT DEFAULT 'self',
      logistics_no TEXT,
      handler TEXT,
      items_json TEXT,
      shipped_at TEXT,
      status TEXT DEFAULT 'issued',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  run(`
    CREATE TABLE IF NOT EXISTS dist_tracking (
      id TEXT PRIMARY KEY,
      request_id TEXT,
      order_id TEXT,
      report_no TEXT,
      consumed_qty REAL,
      remainder_handle TEXT,
      note TEXT,
      report_at TEXT DEFAULT (datetime('now')),
      user_id TEXT,
      reminders_json TEXT
    )
  `);

  // 附件上传元数据（文件存 server/data/uploads/）
  run(`
    CREATE TABLE IF NOT EXISTS upload_file (
      id TEXT PRIMARY KEY,
      original_name TEXT,
      stored_name TEXT,
      mime TEXT,
      size INTEGER,
      uploaded_by TEXT,
      ref_table TEXT,
      ref_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // ---- v2.4: 登录审计 / 消息中心 / 操作增强 / 超低温模块 ----

  // 登录审计日志（登录/退出/失败/锁定），可追溯个人
  run(`
    CREATE TABLE IF NOT EXISTS login_log (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      username TEXT,
      display_name TEXT,
      action TEXT,
      ip TEXT,
      detail TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  run(`CREATE INDEX IF NOT EXISTS idx_login_log_username ON login_log(username)`);
  run(`CREATE INDEX IF NOT EXISTS idx_login_log_created_at ON login_log(created_at)`);

  // 登录失败锁定
  run(`
    CREATE TABLE IF NOT EXISTS login_lock (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      locked_until TEXT,
      reason TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // 系统消息中心（审批进度通知 / 各类到期提醒）
  run(`
    CREATE TABLE IF NOT EXISTS sys_message (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      role TEXT,
      type TEXT,
      title TEXT,
      title_en TEXT,
      body TEXT,
      body_en TEXT,
      ref_table TEXT,
      ref_id TEXT,
      is_read INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  run(`CREATE INDEX IF NOT EXISTS idx_sys_message_user ON sys_message(user_id)`);
  run(`CREATE INDEX IF NOT EXISTS idx_sys_message_role ON sys_message(role)`);

  // v2.12：按用户的消息已读状态（广播消息一人已读不再影响他人）
  run(`
    CREATE TABLE IF NOT EXISTS sys_message_read (
      user_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      read_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (user_id, message_id)
    )
  `);

  // 操作记录审核意见（管理员附加，原始记录仍锁定）
  run(`
    CREATE TABLE IF NOT EXISTS operation_record_review (
      id TEXT PRIMARY KEY,
      record_id TEXT,
      reviewer TEXT,
      comment TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // 完成时间手动修正留痕（operations 与 cryo 共用）
  run(`
    CREATE TABLE IF NOT EXISTS record_time_correction (
      id TEXT PRIMARY KEY,
      ref_table TEXT,
      ref_id TEXT,
      old_at TEXT,
      new_at TEXT,
      corrected_by TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // 超低温保存（液氮）设备
  run(`
    CREATE TABLE IF NOT EXISTS cryo_device (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      name_en TEXT,
      location TEXT,
      capacity TEXT,
      note TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  // 超低温操作留痕（不可篡改）
  run(`
    CREATE TABLE IF NOT EXISTS cryo_record (
      id TEXT PRIMARY KEY,
      device_id TEXT,
      event_type TEXT,
      operator TEXT,
      detail_json TEXT,
      device_temp REAL,
      device_level REAL,
      occurred_at TEXT DEFAULT (datetime('now')),
      immutable INTEGER DEFAULT 1,
      user_id TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  run(`CREATE INDEX IF NOT EXISTS idx_cryo_record_device ON cryo_record(device_id)`);
  run(`CREATE INDEX IF NOT EXISTS idx_cryo_record_event_at ON cryo_record(occurred_at)`);

  // 超低温设备报警与处理
  run(`
    CREATE TABLE IF NOT EXISTS cryo_alarm (
      id TEXT PRIMARY KEY,
      device_id TEXT,
      alarm_type TEXT,
      severity TEXT DEFAULT 'medium',
      triggered_at TEXT DEFAULT (datetime('now')),
      status TEXT DEFAULT 'open',
      resolve_notes TEXT,
      resolved_by TEXT,
      resolved_at TEXT,
      user_id TEXT
    )
  `);

  // ---- v2.5: 工单派单（MES 式）/ 报工 / 个人待办 ----

  // 工单（管理员派单给操作员，状态机 pending→in_progress→done/blocked/cancelled）
  run(`
    CREATE TABLE IF NOT EXISTS work_order (
      id TEXT PRIMARY KEY,
      wo_no TEXT UNIQUE NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      purpose TEXT DEFAULT '',
      accessions_json TEXT DEFAULT '[]',
      target_qty REAL DEFAULT 0,
      priority TEXT DEFAULT 'normal',
      due_date TEXT,
      status TEXT DEFAULT 'pending',
      progress REAL DEFAULT 0,
      done_qty REAL DEFAULT 0,
      created_by TEXT,
      started_at TEXT,
      finished_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  run(`CREATE INDEX IF NOT EXISTS idx_wo_status_due ON work_order(status, due_date)`);
  run(`CREATE INDEX IF NOT EXISTS idx_wo_created ON work_order(created_at)`);

  // 工单指派（多操作员）
  run(`
    CREATE TABLE IF NOT EXISTS work_order_assignee (
      id TEXT PRIMARY KEY,
      work_order_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      assigned_by TEXT,
      assigned_at TEXT DEFAULT (datetime('now')),
      UNIQUE(work_order_id, user_id)
    )
  `);
  run(`CREATE INDEX IF NOT EXISTS idx_woa_user ON work_order_assignee(user_id)`);
  run(`CREATE INDEX IF NOT EXISTS idx_woa_order ON work_order_assignee(work_order_id)`);

  // 工单报工反馈（progress 进度 / issue 受阻 / done 完成）
  run(`
    CREATE TABLE IF NOT EXISTS work_order_feedback (
      id TEXT PRIMARY KEY,
      work_order_id TEXT NOT NULL,
      user_id TEXT,
      username TEXT,
      kind TEXT NOT NULL,
      qty REAL DEFAULT 0,
      content TEXT,
      step_code TEXT,
      photo_json TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  run(`CREATE INDEX IF NOT EXISTS idx_wofb_order ON work_order_feedback(work_order_id)`);

  // ---- v2.8: 工单日报台账（订单→工序→日报一对多联动） ----
  // 同一操作员同一工序同一天只保留一条（覆盖更新），qty 计入进度自动汇总
  run(`
    CREATE TABLE IF NOT EXISTS work_daily_report (
      id TEXT PRIMARY KEY,
      work_order_id TEXT NOT NULL,
      step_code TEXT NOT NULL,
      report_date TEXT NOT NULL,
      user_id TEXT,
      username TEXT NOT NULL,
      qty REAL DEFAULT 0,
      content TEXT,
      photo_json TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_wdr_unique ON work_daily_report(work_order_id, step_code, user_id, report_date)`);
  run(`CREATE INDEX IF NOT EXISTS idx_wdr_order ON work_daily_report(work_order_id, report_date)`);

  // 个人待办清单（自己建立，纯手动）
  run(`
    CREATE TABLE IF NOT EXISTS todo (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      notes TEXT,
      due_date TEXT,
      priority TEXT DEFAULT 'normal',
      is_done INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  run(`CREATE INDEX IF NOT EXISTS idx_todo_user ON todo(user_id, is_done)`);

  // ---- v2.6: 用户个性化设置 / 巡检任务与记录 ----

  // 用户级设置（工作台模块显隐等），独立于全局 app_setting
  run(`
    CREATE TABLE IF NOT EXISTS user_setting (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value_json TEXT,
      updated_at TEXT DEFAULT (datetime('now')),
      UNIQUE(user_id, key)
    )
  `);
  run(`CREATE INDEX IF NOT EXISTS idx_user_setting_user ON user_setting(user_id)`);

  // 巡检任务（库存/冷藏箱/超低温），闹钟式周期：完成一轮自动生成下一轮
  run(`
    CREATE TABLE IF NOT EXISTS inspection_task (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      scope_type TEXT DEFAULT 'all',
      target_type TEXT NOT NULL,
      target_ref TEXT DEFAULT 'all',
      due_date TEXT,
      repeat_mode TEXT DEFAULT 'none',
      repeat_interval INTEGER DEFAULT 1,
      assignee_ids_json TEXT DEFAULT '[]',
      status TEXT DEFAULT 'pending',
      renewed INTEGER DEFAULT 0,
      created_by TEXT,
      finished_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);
  run(`CREATE INDEX IF NOT EXISTS idx_inspection_status_due ON inspection_task(status, due_date)`);

  // 巡检记录（被指派者逐项上报：正常/异常/报修 + 备注 + 照片）
  run(`
    CREATE TABLE IF NOT EXISTS inspection_record (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      user_id TEXT,
      username TEXT,
      target_ref TEXT,
      status TEXT DEFAULT 'normal',
      note TEXT,
      photo_json TEXT DEFAULT '[]',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  run(`CREATE INDEX IF NOT EXISTS idx_inspection_record_task ON inspection_record(task_id)`);

  // ---- v2.3 增量迁移：为早期建库缺列的表补列（幂等） ----
  // quarantine_record / dist_order 早期版本没有 created_at，但查询按它排序
  // 注意：SQLite ALTER TABLE ADD COLUMN 的 DEFAULT 必须是常量，datetime('now')
  // 不允许，故先加无默认列，再回填，新插入由路由显式写入时间。
  for (const table of ['quarantine_record', 'dist_order']) {
    const cols = all(`PRAGMA table_info(${table})`);
    const hasCreatedAt = cols.some(c => c.name === 'created_at');
    if (!hasCreatedAt) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN created_at TEXT`);
      db.exec(`UPDATE ${table} SET created_at = datetime('now') WHERE created_at IS NULL`);
      console.log(`Migration: added created_at to ${table}`);
    }
  }

  // ---- v2.3 种子数据 ----

  // 默认审批流（可自定义）
  const flowCount = get('SELECT COUNT(*) as c FROM approval_flow');
  if (!flowCount || flowCount.c === 0) {
    run("INSERT OR IGNORE INTO approval_flow (id, module, stage_no, title, title_en, required_docs_json, sort_order) VALUES ('intro-s1', 'intro', 1, '科室审批', 'Department Review', '[]', 1)");
    run("INSERT OR IGNORE INTO approval_flow (id, module, stage_no, title, title_en, required_docs_json, sort_order) VALUES ('intro-s2', 'intro', 2, '隔离检疫', 'Quarantine', '[\"quarantine_report\"]', 2)");
    run("INSERT OR IGNORE INTO approval_flow (id, module, stage_no, title, title_en, required_docs_json, sort_order) VALUES ('intro-s3', 'intro', 3, '放行确认', 'Release', '[]', 3)");
    run("INSERT OR IGNORE INTO approval_flow (id, module, stage_no, title, title_en, required_docs_json, sort_order) VALUES ('dist-s1', 'dist', 1, '资质校验', 'Qualification Check', '[\"qualification\"]', 1)");
    run("INSERT OR IGNORE INTO approval_flow (id, module, stage_no, title, title_en, required_docs_json, sort_order) VALUES ('dist-s2', 'dist', 2, '分发审批', 'Distribution Approval', '[]', 2)");
    run("INSERT OR IGNORE INTO approval_flow (id, module, stage_no, title, title_en, required_docs_json, sort_order) VALUES ('dist-s3', 'dist', 3, '出库调度', 'Dispatch', '[]', 3)");
  }

  // 组织培养默认流程步骤（可自定义增删改）
  const stepCount = get('SELECT COUNT(*) as c FROM operation_step_def');
  if (!stepCount || stepCount.c === 0) {
    run("INSERT OR IGNORE INTO operation_step_def (id, module, code, step_no, title, title_en, required_fields_json, sort_order, is_system) VALUES ('tc-1','tissue_culture','prep',1,'前期准备','Preparation','[]',1,1)");
    run("INSERT OR IGNORE INTO operation_step_def (id, module, code, step_no, title, title_en, required_fields_json, sort_order, is_system) VALUES ('tc-2','tissue_culture','inoculation',2,'外植体接种','Explant Inoculation','[\"quantity\",\"medium\"]',2,1)");
    run("INSERT OR IGNORE INTO operation_step_def (id, module, code, step_no, title, title_en, required_fields_json, sort_order, is_system) VALUES ('tc-3','tissue_culture','d7_check',3,'7天检查','7-Day Check','[\"temperature\"]',3,1)");
    run("INSERT OR IGNORE INTO operation_step_def (id, module, code, step_no, title, title_en, required_fields_json, sort_order, is_system) VALUES ('tc-4','tissue_culture','d21_check',4,'21天检查','21-Day Check','[\"temperature\"]',4,1)");
    run("INSERT OR IGNORE INTO operation_step_def (id, module, code, step_no, title, title_en, required_fields_json, sort_order, is_system) VALUES ('tc-5','tissue_culture','transfer',5,'转移保存培养基','Transfer to Medium','[\"quantity\"]',5,1)");
    run("INSERT OR IGNORE INTO operation_step_def (id, module, code, step_no, title, title_en, required_fields_json, sort_order, is_system) VALUES ('tc-6','tissue_culture','exit',6,'出库','Exit','[\"quantity\"]',6,1)");
    run("INSERT OR IGNORE INTO operation_step_def (id, module, code, step_no, title, title_en, required_fields_json, sort_order, is_system) VALUES ('tc-7','tissue_culture','destroy',7,'销毁','Destroy','[\"quantity\",\"reason\"]',7,1)");
  }

  // 冷藏箱容量配置（单行，可自定义）
  const frzCount = get('SELECT COUNT(*) as c FROM freezer_config');
  if (!frzCount || frzCount.c === 0) {
    // 默认 3箱×4层×35抽屉×5盒=每箱700盒；盒子号 C1:1-700 / C2:701-1400 / C3:1401-2100
    const ranges = [[1, 700], [701, 1400], [1401, 2100]];
    run("INSERT OR IGNORE INTO freezer_config (id, freezer_count, shelf_per_freezer, drawer_per_shelf, box_per_drawer, row_count, col_count, box_ranges_json) VALUES (1, 3, 4, 35, 5, 9, 9, ?)",
      [JSON.stringify(ranges)]);
  }

  // ---- v2.7: 角色化 AI Token（MCP/Skill 权限隔离） ----
  // 每个 token 绑定一个角色，只能调用该角色作用域内的工具；杜绝"拿一个 token 就有全部权限"。
  run(`
    CREATE TABLE IF NOT EXISTS ai_token (
      id TEXT PRIMARY KEY,
      token_hash TEXT UNIQUE NOT NULL,
      name TEXT,
      role TEXT NOT NULL DEFAULT 'external',
      enabled INTEGER DEFAULT 1,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      last_used_at TEXT
    )
  `);
  run(`CREATE INDEX IF NOT EXISTS idx_ai_token_role ON ai_token(role, enabled)`);

  // AI 接入 Token（独立于用户 JWT）
  const aiTok = get("SELECT value FROM app_setting WHERE key = 'ai_api_token'");
  if (!aiTok || !aiTok.value) {
    const token = crypto.randomBytes(32).toString('hex');
    run("INSERT OR IGNORE INTO app_setting (key, value) VALUES ('ai_api_token', ?)", [token]);
  }
  // 把现有单 token 播种为 admin 角色（兼容旧 MCP 配置）；仅当 ai_token 表为空时执行
  const aiTokCount = get('SELECT COUNT(*) as c FROM ai_token');
  if (!aiTokCount || aiTokCount.c === 0) {
    const legacy = get("SELECT value FROM app_setting WHERE key = 'ai_api_token'")?.value || '';
    if (legacy) {
      const hash = crypto.createHash('sha256').update(legacy).digest('hex');
      // created_by 置空（非占位用户名）：空属主豁免 owner/孤儿校验，否则默认令牌在 P0 加固下即刻失效
      run('INSERT OR IGNORE INTO ai_token (id, token_hash, name, role, enabled, created_by) VALUES (?,?,?,?,1,?)',
        [crypto.randomUUID(), hash, '默认管理员令牌', 'admin', '']);
    }
  }

  // ---- v2.4 增量迁移：缺列补列（幂等，ALTER 只加无默认常量列） ----
  const migrateColumns = (table, columns) => {
    const cols = all(`PRAGMA table_info(${table})`);
    const names = cols.map(c => c.name);
    for (const [name, ddl] of Object.entries(columns)) {
      if (!names.includes(name)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${ddl}`);
        console.log(`Migration: added ${table}.${name}`);
      }
    }
  };
  // 用户：类型/状态/单位/邮箱/审核信息
  migrateColumns('user', {
    user_type: "TEXT DEFAULT 'operator'",
    status: "TEXT DEFAULT 'active'",
    org: 'TEXT',
    email: 'TEXT',
    approved_at: 'TEXT',
    approved_by: 'TEXT',
    // v2.8 头像：JSON {"type":"emoji","value":..,"bg":..} 或 {"type":"image","value":dataURL}
    avatar: 'TEXT',
  });
  // 操作步骤：计划间隔天数（距上一步）+ 继代分型（扩繁/保存继代/分发继代）
  migrateColumns('operation_step_def', {
    due_days: 'INTEGER DEFAULT 0',
    purpose: "TEXT DEFAULT ''",
    reminder_lead_days: 'INTEGER DEFAULT 0',
  });
  // 引进申请：主体资质编号/有效期（到期提醒）
  migrateColumns('intro_request', {
    qualification_no: 'TEXT',
    qualification_expiry: 'TEXT',
  });
  // 库存：保存期限
  migrateColumns('inventory', { expiry_date: 'TEXT' });
  // 操作记录：可关联到工单（报工带 stepCode 时写执行留痕）
  migrateColumns('operation_record', { work_order_id: 'TEXT' });
  // 工单：步骤提醒去重（记录已提醒到哪一步）
  migrateColumns('work_order', { reminded_step: "TEXT DEFAULT ''" });
  // 工单：进度模式（''/auto = 自动汇总；manual = 手动）
  migrateColumns('work_order', { progress_mode: "TEXT DEFAULT ''" });
  // 便签：颜色（v2.6 便签墙）
  migrateColumns('todo', { color: "TEXT DEFAULT 'yellow'" });
  // v2.10：性状示意图 + 中英说明
  migrateColumns('trait_def', { illustration: 'TEXT', desc_zh: 'TEXT', desc_en: 'TEXT' });
  // v2.10：分发申请携带选中的种质清单 + 来源（manual/wizard/mcp）
  migrateColumns('dist_request', { accessions_json: 'TEXT', source: "TEXT DEFAULT 'manual'" });
  // v2.11：基因组学预留块（链接+元数据模式，不存 VCF 本体）+ Breedbase stock 映射预留
  run(`
    CREATE TABLE IF NOT EXISTS accession_omics (
      id TEXT PRIMARY KEY,
      accession_id TEXT,
      category TEXT,
      title TEXT,
      ref TEXT,
      url TEXT,
      notes TEXT,
      created_by TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  migrateColumns('accession', { stock_id: 'TEXT' });

  // v2.11 一次性迁移：重置 ui.navOrder 排序偏好（旧默认的冻结副本会挡住新业务流排序）。
  // 「排序」功能保留——用户此后仍可拖拽定制并保存。
  try {
    run("DELETE FROM user_setting WHERE key = 'ui.navOrder'");
  } catch { /* user_setting 表可能尚不存在 */ }

  // ---- v2.4 参数种子（全部可配置） ----
  const SETTINGS = {
    'op.overdue_reminder_days': '1',
    'op.time_correct_audit': 'true',
    'intro.quarantine_reminder_days': '7',
    'intro.qualification_expiry_days': '30',
    'dist.tracking_grace_days': '7',
    'auth.session_hours': '24',
    'auth.max_login_failures': '5',
    'auth.lockout_minutes': '30',
    'auth.audit_login': 'true',
    'auth.allow_register': 'true',
    'auth.register_requires_approval': 'true',
    'backup.enabled': 'false',
    'backup.interval_hours': '24',
    'backup.retention_days': '30',
    'upload.max_mb': '30',
    'ui.touch_mode': 'false',
    'notify.enabled': 'true',
    'dist.blacklist_json': '[]',
    'dist.max_accessions': '35',
    'mcp.rate_limit_per_min': '120',
    // v2.12：设置区块可见性矩阵（区块 → 允许的 user_type 列表；admin 角色恒为全可见）
    'setup.section_visibility': JSON.stringify({
      dataSource: ['admin'],
      excelImport: ['admin'],
      columns: ['admin'],
      dict: ['admin'],
      dataSafety: ['admin'],
      ai: ['admin'],
      params: ['admin'],
      connection: ['admin', 'approver', 'operator', 'regulator', 'external'],
    }),
    'work.overdue_reminder_days': '1',
    'work.step_reminder_lead_days': '1',
  };
  for (const [k, v] of Object.entries(SETTINGS)) {
    run('INSERT OR IGNORE INTO app_setting (key, value) VALUES (?, ?)', [k, v]);
  }
  // 用户类型字典（可自定义，超级管理员据此对注册用户分类）
  const userTypes = get("SELECT value FROM app_setting WHERE key = 'auth.user_types_json'");
  if (!userTypes || !userTypes.value) {
    const types = [
      { code: 'operator', label: '操作员', label_en: 'Operator' },
      { code: 'approver', label: '审批人员', label_en: 'Approver' },
      { code: 'regulator', label: '监管方', label_en: 'Regulator' },
      { code: 'external', label: '外部用户', label_en: 'External User' },
    ];
    run("INSERT OR IGNORE INTO app_setting (key, value) VALUES ('auth.user_types_json', ?)", [JSON.stringify(types)]);
  }

  // ---- v2.4 继代分型步骤模板（扩繁 / 保存继代双接种 / 分发继代） ----
  // due_days = 距上一步完成后的计划天数（0=当日）
  const purposeSeeds = {
    multiplication: [
      ['tc-m1', 'prep_m', 1, '前期准备', 'Preparation', '[]', 1],
      ['tc-m2', 'inoculation_m', 2, '外植体接种（扩繁）', 'Inoculation (Multiplication)', '["quantity","medium"]', 0],
      ['tc-m3', 'd7_m', 3, '7天检查', '7-Day Check', '["temperature"]', 7],
      ['tc-m4', 'd21_m', 4, '21天检查', '21-Day Check', '["temperature"]', 14],
      ['tc-m5', 'exit_m', 5, '出库', 'Exit', '["quantity"]', 0],
      ['tc-m6', 'destroy_m', 6, '销毁', 'Destroy', '["quantity","reason"]', 0],
    ],
    conservation: [
      ['tc-c1', 'prep_c', 1, '前期准备', 'Preparation', '[]', 1],
      ['tc-c2', 'inoculation_c', 2, '外植体接种（保存继代）', 'Inoculation (Conservation)', '["quantity","medium"]', 0],
      ['tc-c3', 'd7c_c', 3, '7天检查', '7-Day Check', '["temperature"]', 7],
      ['tc-c4', 'd21c_c', 4, '21天检查', '21-Day Check', '["temperature"]', 14],
      ['tc-c5', 'transfer_c', 5, '转移到保存培养基（第二次外植体接种）', 'Transfer to Medium (2nd Inoculation)', '["quantity","medium"]', 0],
      ['tc-c6', 'd7c2_c', 6, '7天检查（第二次）', '7-Day Check (2nd)', '["temperature"]', 7],
      ['tc-c7', 'd21c2_c', 7, '21天检查（第二次）', '21-Day Check (2nd)', '["temperature"]', 14],
      ['tc-c8', 'transfer2_c', 8, '转移到保存生长室', 'Transfer to Growth Room', '[]', 0],
      ['tc-c9', 'exit_c', 9, '出库', 'Exit', '["quantity"]', 0],
      ['tc-c10', 'destroy_c', 10, '销毁', 'Destroy', '["quantity","reason"]', 0],
    ],
    distribution: [
      ['tc-d1', 'prep_d', 1, '前期准备', 'Preparation', '[]', 1],
      ['tc-d2', 'inoculation_d', 2, '外植体接种（分发继代）', 'Inoculation (Distribution)', '["quantity","medium"]', 0],
      ['tc-d3', 'd7_d', 3, '7天检查', '7-Day Check', '["temperature"]', 7],
      ['tc-d4', 'd21_d', 4, '21天检查', '21-Day Check', '["temperature"]', 14],
      ['tc-d5', 'exit_d', 5, '出库', 'Exit', '["quantity"]', 0],
      ['tc-d6', 'destroy_d', 6, '销毁', 'Destroy', '["quantity","reason"]', 0],
    ],
  };
  for (const [purpose, steps] of Object.entries(purposeSeeds)) {
    for (const [id, code, no, title, titleEn, req, due] of steps) {
      run(`INSERT OR IGNORE INTO operation_step_def (id, module, code, step_no, title, title_en, required_fields_json, sort_order, is_system, due_days, purpose)
           VALUES (?, 'tissue_culture', ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
        [id, code, no, title, titleEn, req, no, due, purpose]);
    }
  }
  // 给通用步骤 tc-1..7 补 due_days 默认（若为空）
  run("UPDATE operation_step_def SET due_days = CASE code WHEN 'd7_check' THEN 7 WHEN 'd21_check' THEN 14 ELSE 0 END WHERE purpose = '' AND due_days IS NULL");

  // Insert default code values
  const cvCount = get('SELECT COUNT(*) as c FROM code_value');
  if (!cvCount || cvCount.c === 0) {
    run("INSERT OR IGNORE INTO code_value (id, group_code, code, title_zh, title_en, sort_order) VALUES ('form-tube', 'STORAGE_FORM', 'Glass Tube', '玻璃试管', 'Glass Tube', 1)");
    run("INSERT OR IGNORE INTO code_value (id, group_code, code, title_zh, title_en, sort_order) VALUES ('form-jar', 'STORAGE_FORM', 'Plastic Jar', '塑料瓶', 'Plastic Jar', 2)");
    run("INSERT OR IGNORE INTO code_value (id, group_code, code, title_zh, title_en, sort_order) VALUES ('form-box', 'STORAGE_FORM', 'Box', '盒子', 'Box', 3)");
    run("INSERT OR IGNORE INTO code_value (id, group_code, code, title_zh, title_en, sort_order) VALUES ('form-other', 'STORAGE_FORM', 'Other', '其他', 'Other', 4)");
  }

  // ---- v2.7 大数据索引（正式使用后附件/记录量增长，避免全表扫描） ----
  // 附件元数据表：按 ref 拉取附件是高频路径
  run(`CREATE INDEX IF NOT EXISTS idx_upload_ref ON upload_file(ref_table, ref_id)`);
  run(`CREATE INDEX IF NOT EXISTS idx_upload_created ON upload_file(created_at)`);
  run(`CREATE INDEX IF NOT EXISTS idx_upload_uploader ON upload_file(uploaded_by)`);
  // 审计日志：按表/记录追溯
  run(`CREATE INDEX IF NOT EXISTS idx_audit_table_record ON audit_log(table_name, record_id)`);
  run(`CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(timestamp)`);
  // 消息：用户 + 已读过滤
  run(`CREATE INDEX IF NOT EXISTS idx_sys_message_user_read ON sys_message(user_id, is_read)`);
  // 操作记录：模块/步骤/时间组合过滤（AI 工具与追溯查询）
  run(`CREATE INDEX IF NOT EXISTS idx_op_module_step ON operation_record(module, step_code, event_at)`);
  run(`CREATE INDEX IF NOT EXISTS idx_op_batch ON operation_record(batch_id)`);
  // 冷藏箱样品：按盒/按种质定位
  run(`CREATE INDEX IF NOT EXISTS idx_fs_box ON freezer_sample(box_id)`);
  run(`CREATE INDEX IF NOT EXISTS idx_fs_accession ON freezer_sample(accession_id)`);
  // 冷藏箱移动记录
  run(`CREATE INDEX IF NOT EXISTS idx_fm_box ON freezer_movement(box_id)`);
  run(`CREATE INDEX IF NOT EXISTS idx_fm_sample ON freezer_movement(sample_id)`);
  // 超低温记录：事件类型过滤
  run(`CREATE INDEX IF NOT EXISTS idx_cryo_event_type ON cryo_record(event_type)`);
  // 巡检：截止日过滤
  run(`CREATE INDEX IF NOT EXISTS idx_inspection_due ON inspection_task(due_date)`);
  // 工单报工：按工单时间线
  run(`CREATE INDEX IF NOT EXISTS idx_wofb_created ON work_order_feedback(created_at)`);

  console.log('Database migrations complete');
}
