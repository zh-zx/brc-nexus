import React from 'react';
import { User } from '../types';

// avatar 存储为 JSON 字符串：{"type":"emoji","value":"🌱","bg":"#e8f5e9"} 或 {"type":"image","value":dataURL}
export function parseAvatar(avatar?: string | null): { type: string; value: string; bg?: string } | null {
  if (!avatar) return null;
  try {
    const a = JSON.parse(avatar);
    if (a && (a.type === 'emoji' || a.type === 'image') && typeof a.value === 'string' && a.value) return a;
  } catch { /* ignore */ }
  return null;
}

const Avatar: React.FC<{
  user?: Pick<User, 'avatar' | 'display_name' | 'username'> | null;
  size?: number;
  className?: string;
}> = ({ user, size = 36, className }) => {
  const a = parseAvatar(user?.avatar);
  if (a?.type === 'image') {
    return (
      <img
        src={a.value}
        alt=""
        className={`rounded-full object-cover shrink-0 ${className || ''}`}
        style={{ width: size, height: size }}
      />
    );
  }
  if (a?.type === 'emoji') {
    return (
      <span
        className={`rounded-full flex items-center justify-center shrink-0 ${className || ''}`}
        style={{ width: size, height: size, background: a.bg || '#e8f5e9', fontSize: size * 0.55, lineHeight: 1 }}
      >
        {a.value}
      </span>
    );
  }
  const ch = (user?.display_name || user?.username || '?').charAt(0).toUpperCase();
  return (
    <span
      className="rounded-full bg-[#2e7d32] text-white flex items-center justify-center font-bold shrink-0"
      style={{ width: size, height: size, fontSize: size * 0.45 }}
    >
      {ch}
    </span>
  );
};

export default Avatar;
