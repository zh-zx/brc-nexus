// 用户权限判定助手（v2.4）
// 角色：admin（超级管理员，全量）；user（普通用户）+ user_type 分类：
//   operator  操作员   — 维持现有行为（仅本人记录）
//   approver  审批人员 — 可审批引进/分发（原 admin-only 端点放开）
//   regulator 监管方   — 引进/分发/操作/超低温 全部只读（GET 放行，写拒绝）
//   external  外部用户 — 仅能新建/查看自己的分发申请与进度

export function canApprove(user) {
  return user?.role === 'admin' || user?.user_type === 'approver';
}

export function isRegulator(user) {
  return !!user && user.role !== 'admin' && user.user_type === 'regulator';
}

export function isExternal(user) {
  return !!user && user.role !== 'admin' && user.user_type === 'external';
}

// 通用：监管方对某模块只读 —— 用于写端点快速拒绝
export function readOnlyGuard(user, reply) {
  if (isRegulator(user)) {
    reply.status(403).send({ error: '监管方仅可查看，无修改权限' });
    return true;
  }
  return false;
}
