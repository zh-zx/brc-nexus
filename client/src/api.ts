const BASE = import.meta.env.DEV ? '' : '';

function getToken(): string | null {
  return localStorage.getItem('brc_token');
}

function setToken(token: string | null) {
  if (token) localStorage.setItem('brc_token', token);
  else localStorage.removeItem('brc_token');
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    // 仅在确有请求体时声明 JSON：无 body 的 POST/DELETE 若带 application/json 会被 Fastify 判为 400
    ...(options.body != null ? { 'Content-Type': 'application/json' } : {}),
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}${path}`, {
    ...options,
    headers,
  });

  if (res.status === 401) {
    setToken(null);
    window.location.hash = '/login';
    throw new Error('登录已过期');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const err: any = new Error(body.error || '请求失败');
    err.body = body; // 保留服务端错误详情（如 FK_BLOCKED 的 references 列表）
    throw err;
  }

  return res.json();
}

// Auth
export const api = {
  // Auth
  async checkSetup() {
    return request<{ needsSetup: boolean; allowRegister?: boolean }>('/api/auth/status');
  },
  async setup(username: string, password: string, displayName?: string) {
    const res = await request<{ token: string; user: any }>('/api/auth/setup', {
      method: 'POST',
      body: JSON.stringify({ username, password, displayName }),
    });
    setToken(res.token);
    return res;
  },
  async login(username: string, password: string) {
    const res = await request<{ token: string; user: any }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    setToken(res.token);
    return res;
  },
  async me() {
    return request<{ user: any }>('/api/auth/me');
  },
  // v2.8：个人资料（显示名/用户名/头像）——服务端返回新 token（用户名可能变化）
  async updateMyProfile(patch: { displayName?: string; username?: string; avatar?: any }) {
    const res = await request<{ token: string; user: any }>('/api/my/profile', {
      method: 'PUT',
      body: JSON.stringify(patch),
    });
    setToken(res.token);
    return res;
  },

  // Accessions
  async searchAccessions(q: string, scope?: string, exact?: boolean, page?: number) {
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (scope) params.set('scope', scope);
    if (exact !== undefined) params.set('exact', String(exact));
    if (page) params.set('page', String(page));
    return request<{ accessions: any[]; total: number }>(`/api/accessions/search?${params}`);
  },
  async getAccessions(page = 1, limit = 100) {
    return request<{ accessions: any[]; total: number }>(`/api/accessions?page=${page}&limit=${limit}`);
  },
  async getAccessionCount() {
    return request<{ count: number }>('/api/accessions/count');
  },
  async createAccession(data: Record<string, any>) {
    return request<any>('/api/accessions', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
  async updateAccession(id: string, data: Record<string, any>) {
    return request<any>(`/api/accessions/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },
  async getAccession(id: string) {
    return request<any>(`/api/accessions/${id}`);
  },
  async getAccessionFields() {
    return request<{ fields: string[] }>('/api/accessions/fields');
  },
  async deleteAccession(id: string) {
    return request<{ success: boolean }>(`/api/accessions/${id}`, { method: 'DELETE' });
  },

  // Traits (custom trait definitions)
  async getTraits() {
    return request<{ traits: any[]; categories: any[] }>('/api/traits');
  },
  async createTrait(data: Record<string, any>) {
    return request<any>('/api/traits', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
  async updateTrait(id: string, data: Record<string, any>) {
    return request<any>(`/api/traits/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },
  async deleteTrait(id: string) {
    return request<{ success: boolean }>(`/api/traits/${id}`, { method: 'DELETE' });
  },

  // Trait query (multi-condition, AND)
  async queryAccessions(conditions: any[], page = 1, limit = 50) {
    return request<{ accessions: any[]; total: number }>('/api/accessions/query', {
      method: 'POST',
      body: JSON.stringify({ conditions, page, limit }),
    });
  },
  async getTraitValues(code: string) {
    return request<{ code: string; valueType: string; scale: any; values: any[] }>(
      `/api/accessions/trait-values?code=${encodeURIComponent(code)}`
    );
  },

  // v2.15：多维表格查询（服务端筛选/排序/分组/列选择；只回传基础 4 列 + 请求列）
  async bitableQuery(payload: {
    keyword?: string;
    filters?: any[];
    sort?: { field: string; dir: 'asc' | 'desc' }[];
    groupBy?: string;
    columns?: string[];
    fieldTypes?: Record<string, 'text' | 'number'>;
    page?: number;
    limit?: number;
  }) {
    return request<{
      rows: any[]; total: number; page: number; pageSize: number;
      fieldMeta: { field: string; type: string; scale?: Record<string, string>; group?: string; readonly?: boolean }[];
      groups?: { field: string; truncated: boolean; items: { value: string | null; count: number }[] };
    }>('/api/accessions/bitable-query', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // Excel
  async uploadExcel(file: File) {
    const formData = new FormData();
    formData.append('file', file);
    const token = getToken();
    const res = await fetch(`${BASE}/api/excel/upload`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData,
    });
    return res.json();
  },
  async importExcel(rows: any[], mapping: any, mode: string) {
    return request<{ success: boolean; inserted: number; updated: number; skipped: number; errors: any[] }>('/api/excel/import', {
      method: 'POST',
      body: JSON.stringify({ rows, mapping, mode }),
    });
  },

  // Print
  async print(items: any[], templateId: string, printerName?: string, operator?: string, medium?: string, copies = 1, labelsHtml?: string) {
    return request<{ success: boolean; jobId: string }>('/api/print', {
      method: 'POST',
      body: JSON.stringify({ items, templateId, printerName, operator, medium, copies, labelsHtml }),
    });
  },

  // Settings
  async getSettings() { return request<Record<string, string>>('/api/settings'); },
  async updateSettings(settings: Record<string, string>) {
    return request('/api/settings', { method: 'PUT', body: JSON.stringify(settings) });
  },
  async getRooms() { return request<{ rooms: any[] }>('/api/rooms'); },
  async createRoom(name: string) {
    return request<{ success: boolean; id: string }>('/api/rooms', { method: 'POST', body: JSON.stringify({ name }) });
  },
  async updateRoom(room: any) {
    return request(`/api/rooms/${room.id}`, { method: 'PUT', body: JSON.stringify(room) });
  },
  async deleteRoom(id: string) {
    return request(`/api/rooms/${id}`, { method: 'DELETE' });
  },
  async getOperators() { return request<{ operators: any[] }>('/api/operators'); },
  async createOperator(name: string) {
    return request<{ success: boolean }>('/api/operators', { method: 'POST', body: JSON.stringify({ name }) });
  },
  async deleteOperator(id: string) {
    return request(`/api/operators/${id}`, { method: 'DELETE' });
  },
  async getMediaTypes() { return request<{ mediaTypes: any[] }>('/api/media-types'); },
  async createMediaType(name: string) {
    return request<{ success: boolean }>('/api/media-types', { method: 'POST', body: JSON.stringify({ name }) });
  },
  async deleteMediaType(id: string) {
    return request(`/api/media-types/${id}`, { method: 'DELETE' });
  },
  async getTemplates() { return request<{ templates: any[] }>('/api/templates'); },
  async saveTemplate(template: any) {
    return request<{ success: boolean; id?: string }>('/api/templates', { method: 'POST', body: JSON.stringify(template) });
  },
  async deleteTemplate(id: string) {
    return request(`/api/templates/${id}`, { method: 'DELETE' });
  },

  // Dashboard
  async getDashboardStats() { return request<any>('/api/dashboard/stats'); },

  // Data management
  async getUploads() { return request<{ uploads: any[] }>('/api/excel/uploads'); },
  async getPrintQueue() { return request<{ jobs: any[] }>('/api/print/queue'); },
  async getSubcultureEvents(limit = 20) {
    return request<{ events: any[] }>(`/api/subculture-events?limit=${limit}`);
  },

  // Export/Backup
  async backup() { return request<{ success: boolean; path: string }>('/api/backup', { method: 'POST' }); },
  async exportAll() { return request<any>('/api/export'); },

  // AI gateway
  async getAiToken() { return request<{ token: string }>('/api/ai/token'); },
  async rotateAiToken() { return request<{ token: string }>('/api/ai/token', { method: 'POST' }); },
  // v2.7: 角色化作用域令牌管理
  async listAiTokens() { return request<{ tokens: any[] }>('/api/ai/tokens'); },
  async createAiToken(data: { name: string; role: string }) {
    return request<{ success: boolean; id: string; name: string; role: string; token: string }>('/api/ai/tokens', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
  async setAiTokenStatus(id: string, enabled: boolean) {
    return request<{ success: boolean; enabled: boolean }>(`/api/ai/tokens/${id}/status`, {
      method: 'POST',
      body: JSON.stringify({ enabled }),
    });
  },

  // Operations & traceability
  async getOperationSteps(module?: string) {
    const params = module ? `?module=${encodeURIComponent(module)}` : '';
    return request<{ steps: any[]; modules: string[]; purposes?: any[] }>(`/api/operation-steps${params}`);
  },
  async saveOperationStep(step: any, id?: string) {
    return request<{ success: boolean; id?: string }>(id ? `/api/operation-steps/${id}` : '/api/operation-steps', {
      method: id ? 'PUT' : 'POST',
      body: JSON.stringify(step),
    });
  },
  async deleteOperationStep(id: string) {
    return request<{ success: boolean }>(`/api/operation-steps/${id}`, { method: 'DELETE' });
  },
  async createOperationRecord(data: any) {
    return request<{ success: boolean; id: string }>('/api/operations', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
  async getOperationRecords(params: any = {}) {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v) qs.set(k, String(v)); });
    return request<{ records: any[]; total: number; page: number }>(`/api/operations?${qs}`);
  },
  async exportOperations(params: any = {}) {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v) qs.set(k, String(v)); });
    const token = getToken();
    const res = await fetch(`${BASE}/api/operations/export?${qs}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) throw new Error('导出失败');
    return res.blob();
  },

  // Freezer storage
  async getFreezerConfig() { return request<any>('/api/freezer/config'); },
  async updateFreezerConfig(cfg: any) {
    return request<any>('/api/freezer/config', { method: 'PUT', body: JSON.stringify(cfg) });
  },
  async getFreezerBoxes(freezer: number, shelf: number, drawer: number) {
    return request<any>(`/api/freezer/boxes?freezer=${freezer}&shelf=${shelf}&drawer=${drawer}`);
  },
  async getFreezerBox(boxNo: number) {
    return request<any>(`/api/freezer/box/${boxNo}`);
  },
  async scanFreezerBox(qr: string) {
    return request<any>(`/api/freezer/scan?qr=${encodeURIComponent(qr)}`);
  },
  async freezerCheckin(data: any) {
    return request<any>('/api/freezer/checkin', { method: 'POST', body: JSON.stringify(data) });
  },
  async freezerMove(data: any) {
    return request<any>('/api/freezer/move', { method: 'POST', body: JSON.stringify(data) });
  },
  async freezerCheckout(data: any) {
    return request<any>('/api/freezer/checkout', { method: 'POST', body: JSON.stringify(data) });
  },
  async freezerCount(data: any) {
    return request<any>('/api/freezer/count', { method: 'POST', body: JSON.stringify(data) });
  },
  async getFreezerMovements(params: any = {}) {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v) qs.set(k, String(v)); });
    return request<{ movements: any[]; total: number }>(`/api/freezer/movements?${qs}`);
  },

  // Intro (germplasm introduction)
  async getIntroFlow() { return request<{ stages: any[] }>('/api/intro/approval-flow'); },
  async saveIntroFlow(stages: any[]) {
    return request<{ success: boolean }>('/api/intro/approval-flow', { method: 'PUT', body: JSON.stringify({ stages }) });
  },
  async getIntroRequests(params: any = {}) {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v) qs.set(k, String(v)); });
    return request<{ requests: any[]; total: number; page: number }>(`/api/intro/requests?${qs}`);
  },
  async getIntroRequest(id: string) { return request<any>(`/api/intro/requests/${id}`); },
  async createIntroRequest(data: any) {
    return request<{ success: boolean; id: string; reqNo: string }>('/api/intro/requests', { method: 'POST', body: JSON.stringify(data) });
  },
  async updateIntroRequest(id: string, data: any) {
    return request<{ success: boolean }>(`/api/intro/requests/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  },
  async deleteIntroRequest(id: string) {
    return request<{ success: boolean }>(`/api/intro/requests/${id}`, { method: 'DELETE' });
  },
  async approveIntroRequest(id: string, stage: number, decision: string, comment: string) {
    return request<{ success: boolean }>(`/api/intro/requests/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify({ stage, decision, comment }),
    });
  },
  async createQuarantine(data: any) {
    return request<{ success: boolean; id: string }>('/api/intro/quarantine', { method: 'POST', body: JSON.stringify(data) });
  },
  async submitQuarantineResult(id: string, data: any) {
    return request<{ success: boolean }>(`/api/intro/quarantine/${id}/result`, { method: 'POST', body: JSON.stringify(data) });
  },
  async getQuarantineReminders() { return request<{ reminders: any[] }>('/api/intro/quarantine/reminders'); },

  // Dist (germplasm distribution)
  async getDistFlow() { return request<{ stages: any[] }>('/api/dist/approval-flow'); },
  async saveDistFlow(stages: any[]) {
    return request<{ success: boolean }>('/api/dist/approval-flow', { method: 'PUT', body: JSON.stringify({ stages }) });
  },
  async getDistRequests(params: any = {}) {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => { if (v) qs.set(k, String(v)); });
    return request<{ requests: any[]; total: number; page: number }>(`/api/dist/requests?${qs}`);
  },
  async getDistRequest(id: string) { return request<any>(`/api/dist/requests/${id}`); },
  async createDistRequest(data: any) {
    return request<{ success: boolean; id: string; reqNo: string; verifyWarning?: string[] }>('/api/dist/requests', { method: 'POST', body: JSON.stringify(data) });
  },
  async updateDistRequest(id: string, data: any) {
    return request<{ success: boolean }>(`/api/dist/requests/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  },
  async deleteDistRequest(id: string) {
    return request<{ success: boolean }>(`/api/dist/requests/${id}`, { method: 'DELETE' });
  },
  async approveDistRequest(id: string, stage: number, decision: string, comment: string) {
    return request<{ success: boolean }>(`/api/dist/requests/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify({ stage, decision, comment }),
    });
  },
  async checkDistInventory(opts: { resourceType: string; qty: number; traitCode?: string; traitValue?: string; op?: string; origin?: string }) {
    return request<any>('/api/dist/check-inventory', { method: 'POST', body: JSON.stringify(opts) });
  },
  async createDistOrder(data: any) {
    return request<{ success: boolean; id: string }>('/api/dist/orders', { method: 'POST', body: JSON.stringify(data) });
  },
  async createDistTracking(data: any) {
    return request<{ success: boolean; id: string }>('/api/dist/tracking', { method: 'POST', body: JSON.stringify(data) });
  },
  async traceDistRequest(reqNo: string) {
    return request<any>(`/api/dist/trace/${encodeURIComponent(reqNo)}`);
  },
  async getDistReminders() { return request<{ reminders: any[] }>('/api/dist/reminders'); },

  async getUploadsByRef(refTable: string, refId: string) {
    return request<{ files: any[] }>(`/api/uploads?refTable=${encodeURIComponent(refTable)}&refId=${encodeURIComponent(refId)}`);
  },
  async deleteUpload(id: string) {
    return request<{ success: boolean }>(`/api/uploads/${id}`, { method: 'DELETE' });
  },
  // ---- v2.4 ----
  // Auth
  async register(data: { username: string; password: string; displayName?: string; org?: string; email?: string }) {
    return request<{ success: boolean; pending?: boolean; token?: string; user?: any }>('/api/auth/register', {
      method: 'POST', body: JSON.stringify(data),
    });
  },
  async logout() {
    return request<{ success: boolean }>('/api/auth/logout', { method: 'POST' });
  },

  // Users (admin)
  async getUsers(filters: { type?: string; status?: string; q?: string } = {}) {
    const params = new URLSearchParams();
    if (filters.type) params.set('type', filters.type);
    if (filters.status) params.set('status', filters.status);
    if (filters.q) params.set('q', filters.q);
    return request<{ users: any[] }>(`/api/users?${params}`);
  },
  async createUser(data: any) {
    return request<{ success: boolean; id: string }>('/api/users', { method: 'POST', body: JSON.stringify(data) });
  },
  async updateUser(id: string, data: any) {
    return request<{ success: boolean }>(`/api/users/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  },
  async resetPassword(id: string, password: string) {
    return request<{ success: boolean }>(`/api/users/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ password }) });
  },
  async deleteUser(id: string) {
    return request<{ success: boolean }>(`/api/users/${id}`, { method: 'DELETE' });
  },
  async getUserTypes() {
    return request<{ types: any[] }>('/api/user-types');
  },

  // Login log (admin)
  async getLoginLog(filters: { from?: string; to?: string; action?: string; user?: string; page?: number; pageSize?: number } = {}) {
    const params = new URLSearchParams();
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    if (filters.action) params.set('action', filters.action);
    if (filters.user) params.set('user', filters.user);
    if (filters.page) params.set('page', String(filters.page));
    if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
    return request<{ logs: any[]; total: number; page: number }>(`/api/login-log?${params}`);
  },

  // v2.19 P0 审计台账（admin）：分页 + 过滤（表/动作/用户/日期/关键字）
  async getAuditLog(filters: { table?: string; action?: string; user?: string; from?: string; to?: string; q?: string; page?: number; pageSize?: number } = {}) {
    const params = new URLSearchParams();
    if (filters.table) params.set('table', filters.table);
    if (filters.action) params.set('action', filters.action);
    if (filters.user) params.set('user', filters.user);
    if (filters.from) params.set('from', filters.from);
    if (filters.to) params.set('to', filters.to);
    if (filters.q) params.set('q', filters.q);
    if (filters.page) params.set('page', String(filters.page));
    if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
    return request<{ logs: any[]; total: number; page: number; pageSize: number; facets: { tables: string[]; actions: string[] } }>(`/api/audit-log?${params}`);
  },

  // Messages
  async getMessages(opts: { unread?: boolean; page?: number; pageSize?: number } = {}) {
    const params = new URLSearchParams();
    if (opts.unread) params.set('unread', '1');
    if (opts.page) params.set('page', String(opts.page));
    if (opts.pageSize) params.set('pageSize', String(opts.pageSize));
    return request<{ messages: any[]; total: number; page: number }>(`/api/messages?${params}`);
  },
  async getUnreadCount() {
    return request<{ unread: number }>('/api/messages/unread-count');
  },
  async markMessageRead(id: string) {
    return request<{ success: boolean }>(`/api/messages/${id}/read`, { method: 'POST' });
  },
  async markAllRead() {
    return request<{ success: boolean }>('/api/messages/read-all', { method: 'POST' });
  },
  async deleteMessage(id: string) {
    return request<{ success: boolean }>(`/api/messages/${id}`, { method: 'DELETE' });
  },

  // Cryo
  async getCryoDevices() {
    return request<{ devices: any[] }>('/api/cryo/devices');
  },
  async createCryoDevice(data: any) {
    return request<{ success: boolean; id: string }>('/api/cryo/devices', { method: 'POST', body: JSON.stringify(data) });
  },
  async updateCryoDevice(id: string, data: any) {
    return request<{ success: boolean }>(`/api/cryo/devices/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  },
  async deleteCryoDevice(id: string) {
    return request<{ success: boolean }>(`/api/cryo/devices/${id}`, { method: 'DELETE' });
  },
  async getCryoRecords(filters: any = {}) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) params.set(k, String(v));
    return request<{ records: any[]; total: number; page: number }>(`/api/cryo/records?${params}`);
  },
  async createCryoRecord(data: any) {
    return request<{ success: boolean; id: string }>('/api/cryo/records', { method: 'POST', body: JSON.stringify(data) });
  },
  async correctCryoTime(id: string, occurredAt: string) {
    return request<{ success: boolean }>(`/api/cryo/records/${id}/correct-time`, { method: 'POST', body: JSON.stringify({ occurredAt }) });
  },
  async getCryoAlarms(filters: any = {}) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) params.set(k, String(v));
    return request<{ alarms: any[] }>(`/api/cryo/alarms?${params}`);
  },
  async createCryoAlarm(data: any) {
    return request<{ success: boolean; id: string }>('/api/cryo/alarms', { method: 'POST', body: JSON.stringify(data) });
  },
  async resolveCryoAlarm(id: string, notes: string) {
    return request<{ success: boolean }>(`/api/cryo/alarms/${id}/resolve`, { method: 'POST', body: JSON.stringify({ resolveNotes: notes }) });
  },
  async getCryoStatus() {
    return request<{ devices: any[]; eventTypes: string[]; eventLabels: any }>('/api/cryo/status');
  },
  async exportCryoExcel(filters: any = {}) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) params.set(k, String(v));
    const res = await fetch(`/api/cryo/export?${params}`, { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!res.ok) throw new Error('导出失败');
    return await res.blob();
  },

  // Statistics
  async getStatsOverview(from?: string, to?: string) {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return request<any>(`/api/stats/overview?${params}`);
  },

  // Backups (admin)
  async getBackups() {
    return request<{ backups: any[] }>('/api/backups');
  },
  async manualBackup() {
    return request<{ success: boolean; filename: string }>('/api/backup', { method: 'POST' });
  },

  // Operations v2.4
  async getOperationDetail(id: string) {
    return request<{ record: any; reviews: any[]; corrections: any[]; photos: any[] }>(`/api/operations/${id}`);
  },
  async reviewOperation(id: string, comment: string) {
    return request<{ success: boolean }>(`/api/operations/${id}/review`, { method: 'POST', body: JSON.stringify({ comment }) });
  },
  async correctOperationTime(id: string, eventAt: string) {
    return request<{ success: boolean }>(`/api/operations/${id}/correct-time`, { method: 'POST', body: JSON.stringify({ eventAt }) });
  },
  async getOperationOverdue() {
    return request<{ overdue: any[] }>('/api/operations/overdue');
  },

  // Intro v2.4
  async getQualificationReminders() {
    return request<{ reminders: any[] }>('/api/intro/qualification/reminders');
  },

  // Upload
  async uploadFile(file: File, refTable?: string, refId?: string) {
    const form = new FormData();
    form.append('file', file);
    const params = new URLSearchParams();
    if (refTable) params.set('refTable', refTable);
    if (refId) params.set('refId', refId);
    const res = await fetch(`/api/uploads?${params}`, { method: 'POST', headers: { Authorization: `Bearer ${getToken()}` }, body: form });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: '上传失败' }));
      throw new Error(err.error || '上传失败');
    }
    return res.json();
  },

  // ---- v2.5: 工单派单 / 报工 / 工作台 / 个人待办 ----
  async getWorkbench() {
    return request<any>('/api/workbench');
  },
  async getWorkOrders(filters: { status?: string; priority?: string; purpose?: string; q?: string; mine?: boolean; page?: number; limit?: number } = {}) {
    const params = new URLSearchParams();
    if (filters.status) params.set('status', filters.status);
    if (filters.priority) params.set('priority', filters.priority);
    if (filters.purpose) params.set('purpose', filters.purpose);
    if (filters.q) params.set('q', filters.q);
    if (filters.mine) params.set('mine', '1');
    if (filters.page) params.set('page', String(filters.page));
    if (filters.limit) params.set('limit', String(filters.limit));
    return request<{ orders: any[]; total: number; page: number }>(`/api/workorders?${params}`);
  },
  async getWorkOrder(id: string) {
    return request<any>(`/api/workorders/${id}`);
  },
  async createWorkOrder(data: any) {
    return request<{ success: boolean; id: string; woNo: string }>('/api/workorders', { method: 'POST', body: JSON.stringify(data) });
  },
  async updateWorkOrder(id: string, data: any) {
    return request<{ success: boolean }>(`/api/workorders/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  },
  async deleteWorkOrder(id: string) {
    return request<{ success: boolean }>(`/api/workorders/${id}`, { method: 'DELETE' });
  },
  async changeWorkOrderStatus(id: string, status: string) {
    return request<{ success: boolean }>(`/api/workorders/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) });
  },
  async submitWorkOrderFeedback(id: string, data: any) {
    return request<{ success: boolean; id: string; doneQty: number; progress: number; status: string }>(`/api/workorders/${id}/feedback`, { method: 'POST', body: JSON.stringify(data) });
  },
  async getMyTodos() {
    return request<{ todos: any[] }>('/api/todos');
  },
  async createTodo(data: any) {
    return request<{ success: boolean; id: string }>('/api/todos', { method: 'POST', body: JSON.stringify(data) });
  },
  async updateTodo(id: string, data: any) {
    return request<{ success: boolean }>(`/api/todos/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  },
  async deleteTodo(id: string) {
    return request<{ success: boolean }>(`/api/todos/${id}`, { method: 'DELETE' });
  },

  // ---- v2.6: 批量修改 / 工单附件导入与打印 / 巡检 / 工作台个性化 ----
  async batchUpdateAccessions(data: any) {
    return request<any>('/api/accessions/batch-update', { method: 'POST', body: JSON.stringify(data) });
  },
  async getBatchTemplate() {
    const res = await fetch('/api/accessions/template', { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!res.ok) throw new Error('下载模板失败');
    return await res.blob();
  },
  async parseOrderAccessions(data: any) {
    return request<any>('/api/workorders/parse-accessions', { method: 'POST', body: JSON.stringify(data) });
  },
  async getWorkOrderDailyReports(id: string) {
    return request<{ reports: any[] }>(`/api/workorders/${id}/daily-reports`);
  },
  async submitDailyReport(id: string, data: any) {
    return request<{ success: boolean; upserted: boolean; doneQty: number; progress: number }>(`/api/workorders/${id}/daily-report`, { method: 'POST', body: JSON.stringify(data) });
  },
  async setWorkOrderProgress(id: string, data: any) {
    return request<{ success: boolean; progress: number; doneQty: number }>(`/api/workorders/${id}/progress`, { method: 'PUT', body: JSON.stringify(data) });
  },
  async setWorkOrderProgressMode(id: string, mode: string) {
    return request<{ success: boolean; progressMode: string }>(`/api/workorders/${id}/progress-mode`, { method: 'PUT', body: JSON.stringify({ mode }) });
  },
  async printWorkOrder(data: any) {
    return request<{ success: boolean; jobId: string }>('/api/print', { method: 'POST', body: JSON.stringify(data) });
  },
  async getMySettings() {
    return request<Record<string, any>>('/api/my/settings');
  },
  async putMySettings(key: string, value: any) {
    return request<{ success: boolean }>('/api/my/settings', { method: 'PUT', body: JSON.stringify({ key, value }) });
  },
  async getInspections(filters: any = {}) {
    const params = new URLSearchParams();
    if (filters.status) params.set('status', filters.status);
    if (filters.targetType) params.set('targetType', filters.targetType);
    if (filters.mine) params.set('mine', '1');
    return request<{ inspections: any[] }>(`/api/inspections?${params}`);
  },
  async createInspection(data: any) {
    return request<{ success: boolean; id: string }>('/api/inspections', { method: 'POST', body: JSON.stringify(data) });
  },
  async updateInspection(id: string, data: any) {
    return request<{ success: boolean }>(`/api/inspections/${id}`, { method: 'PUT', body: JSON.stringify(data) });
  },
  async changeInspectionStatus(id: string, status: string) {
    return request<{ success: boolean }>(`/api/inspections/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) });
  },
  async submitInspectionRecord(id: string, data: any) {
    return request<any>(`/api/inspections/${id}/records`, { method: 'POST', body: JSON.stringify(data) });
  },
  async getInspectionRecords(id: string) {
    return request<{ records: any[] }>(`/api/inspections/${id}/records`);
  },
  async getInspectionChecklist(id: string) {
    return request<any>(`/api/inspections/${id}/checklist`);
  },

  // ---- v2.8: 数据库管理台 ----
  async dbTables() {
    return request<{ tables: { name: string; rows: number }[]; size: number }>('/api/dbadmin/tables');
  },
  async dbTablePreview(table: string) {
    return request<{ columns: string[]; rows: any[]; total: number }>(`/api/dbadmin/tables/${encodeURIComponent(table)}`);
  },
  async dbQuery(sql: string, confirm?: boolean) {
    return request<any>('/api/dbadmin/query', { method: 'POST', body: JSON.stringify({ sql, confirm }) });
  },
  async dbExport() {
    const res = await fetch('/api/dbadmin/export', { headers: { Authorization: `Bearer ${getToken()}` } });
    if (!res.ok) throw new Error('导出失败');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `brc-export-${Date.now()}.db`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },
  async dbBackup() {
    return request<{ success: boolean; filename: string }>('/api/dbadmin/backup', { method: 'POST' });
  },
  async dbMaintenance() {
    return request<{ success: boolean }>('/api/dbadmin/maintenance', { method: 'POST' });
  },
  async dbIntegrity() {
    return request<{ ok: boolean; integrity: string[]; orphans: any[] }>('/api/dbadmin/integrity');
  },
  // v2.9: 行级增删改（可视化模式）
  async dbRow(data: { table: string; mode: 'insert' | 'update' | 'delete'; row?: Record<string, any>; key?: { col: string; value: any }; confirm?: boolean }) {
    return request<any>('/api/dbadmin/row', { method: 'POST', body: JSON.stringify(data) });
  },
  // v2.11: 基因组学预留块
  async getOmics(accessionId: string) {
    return request<{ entries: any[] }>(`/api/accessions/${accessionId}/omics`);
  },
  async addOmics(accessionId: string, data: { category: string; title: string; ref?: string; url?: string; notes?: string }) {
    return request<{ success: boolean; id: string }>(`/api/accessions/${accessionId}/omics`, { method: 'POST', body: JSON.stringify(data) });
  },
  async deleteOmics(id: string) {
    return request<{ success: boolean }>(`/api/omics/${id}`, { method: 'DELETE' });
  },
};

// GGCE (GRIN-Global Community Edition) API client
// Calls GGCE Server REST API at /api/v2/* endpoints.
// Active when app_setting.data_source_mode === 'ggce'.
// GGCE server URL is stored in app_setting.ggce_server_url.
async function getGgceConfig(): Promise<{ url: string; mode: string; labelMode: string }> {
  const settings = await api.getSettings();
  return {
    url: (settings.ggce_server_url || '').replace(/\/$/, ''),
    mode: settings.data_source_mode || 'local',
    labelMode: settings.label_mode || 'local',
  };
}

async function ggceRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const { url } = await getGgceConfig();
  if (!url) throw new Error('GGCE 服务器地址未配置，请在系统设置中填写 GGCE Server URL');
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${url}${path}`, { ...options, headers });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `GGCE 请求失败 (${res.status})`);
  }
  return res.json();
}

export const ggce = {
  // Accession endpoints (GGCE /api/v2/a)
  async listAccessions(filter: any = {}) {
    return ggceRequest<{ content: any[]; totalElements: number; number: number; totalPages: number }>('/api/v2/a/list', {
      method: 'POST',
      body: JSON.stringify(filter),
    });
  },
  async getAccession(id: number) {
    return ggceRequest<any>(`/api/v2/a/details/${id}`);
  },
  async searchAccessions(q: string) {
    return ggceRequest<{ content: any[]; totalElements: number }>(`/api/v2/a/list`, {
      method: 'POST',
      body: JSON.stringify({ keyword: q }),
    });
  },

  // Inventory endpoints (GGCE /api/v2/i)
  async listInventory(filter: any = {}) {
    return ggceRequest<{ content: any[]; totalElements: number }>('/api/v2/i/list', {
      method: 'POST',
      body: JSON.stringify(filter),
    });
  },
  async getInventoryByBarcode(barcode: string) {
    return ggceRequest<any>(`/api/v2/i/details?barcode=${encodeURIComponent(barcode)}`);
  },
  async assignBarcode(inventoryId: number) {
    return ggceRequest<any>(`/api/v2/i/${inventoryId}/barcode`, { method: 'POST' });
  },

  // Label generation (GGCE /api/v2/i/generate-labels*)
  async generateLabelsZpl(inventoryIds: number[], templateName?: string, copies = 1) {
    return ggceRequest<{ zpl: string }>('/api/v2/i/generate-labels', {
      method: 'POST',
      body: JSON.stringify({
        inventoryIds,
        template: templateName,
        numberOfCopies: copies,
        collated: true,
      }),
    });
  },
  async generateLabelsPdf(inventoryIds: number[], templateName?: string) {
    const { url } = await getGgceConfig();
    if (!url) throw new Error('GGCE 服务器地址未配置');
    const res = await fetch(`${url}/api/v2/i/generate-labels-pdf`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ inventoryIds, template: templateName }),
    });
    return await res.blob();
  },

  // Taxonomy (GGCE /api/v2/t)
  async listSpecies() {
    return ggceRequest<{ content: any[] }>('/api/v2/t/species');
  },

  // BrAPI v2 (interoperability endpoint)
  async brapiGermplasm(q?: string) {
    const params = q ? `?germplasmName=${encodeURIComponent(q)}` : '';
    return ggceRequest<{ result: { data: any[] } }>(`/brapi/v2/germplasm${params}`);
  },

};

// Unified data source: dispatches to local api or GGCE based on settings
export const dataSource = {
  async getMode(): Promise<'local' | 'ggce'> {
    const { mode } = await getGgceConfig();
    return mode === 'ggce' ? 'ggce' : 'local';
  },

  async searchAccessions(q: string, page = 1): Promise<{ accessions: any[]; total: number }> {
    const mode = await this.getMode();
    if (mode === 'ggce') {
      const res = await ggce.searchAccessions(q);
      return {
        accessions: (res.content || []).map((a: any) => ({
          id: a.id,
          primaryId: a.accessionNumber,
          displayName: a.accessionNumberPart3 || a.accessionNumber,
          species: a.taxonomySpecies?.name || '',
          origin: a.site?.siteName || '',
          ...a,
        })),
        total: res.totalElements || 0,
      };
    }
    return api.searchAccessions(q, 'all', false, page);
  },

  async listAccessions(page = 1, limit = 50): Promise<{ accessions: any[]; total: number }> {
    const mode = await this.getMode();
    if (mode === 'ggce') {
      const res = await ggce.listAccessions({ page: { page: page - 1, size: limit } });
      return {
        accessions: (res.content || []).map((a: any) => ({
          id: a.id,
          primaryId: a.accessionNumber,
          displayName: a.accessionNumberPart3 || a.accessionNumber,
          species: a.taxonomySpecies?.name || '',
          origin: a.site?.siteName || '',
          ...a,
        })),
        total: res.totalElements || 0,
      };
    }
    return api.getAccessions(page, limit);
  },
};
