import React, { useState, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { t } from '../utils';
import { X, Save, Image as ImageIcon, Smile } from 'lucide-react';
import Avatar, { parseAvatar } from './Avatar';

const EMOJIS = ['🌱','🌿','🍀','🌾','🌽','🥔','🍠','🌻','🌼','🌸','🍄','🌰','🥬','🥕','🫘','🌶️','🍅','🥦','🪴','🧬','🔬','🧪','⚗️','📗'];
const COLORS = ['#e8f5e9','#e3f2fd','#fff3e0','#fce4ec','#f3e5f5','#e0f2f1','#fff8e1','#f1f8e9'];

const ProfileModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
  const { user, language, updateProfile } = useApp();
  const cur = parseAvatar(user?.avatar);
  const [tab, setTab] = useState<'emoji' | 'image'>(cur?.type === 'image' ? 'image' : 'emoji');
  const [displayName, setDisplayName] = useState(user?.display_name || user?.username || '');
  const [username, setUsername] = useState(user?.username || '');
  const [emoji, setEmoji] = useState(cur?.type === 'emoji' ? cur.value : '🌱');
  const [bg, setBg] = useState(cur?.type === 'emoji' ? cur.bg || '#e8f5e9' : '#e8f5e9');
  const [img, setImg] = useState<string | null>(cur?.type === 'image' ? cur.value : null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const imageEl = new Image();
      imageEl.onload = () => {
        const max = 512;
        let { width, height } = imageEl;
        const scale = Math.min(1, max / Math.max(width, height));
        width = Math.max(1, Math.round(width * scale));
        height = Math.max(1, Math.round(height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(imageEl, 0, 0, width, height);
        setImg(canvas.toDataURL('image/png'));
      };
      imageEl.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  };

  const save = async () => {
    if (!displayName.trim()) { alert(t('profile.displayNameRequired', language)); return; }
    setSaving(true);
    try {
      let avatar: any = null;
      if (tab === 'emoji') avatar = { type: 'emoji', value: emoji, bg };
      else if (img) avatar = { type: 'image', value: img };
      await updateProfile({ displayName, username, avatar });
      onClose();
    } catch (e: any) {
      alert(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 animate-fade-in" onClick={onClose}>
      <div className="bg-white rounded-3xl w-full max-w-md p-6 shadow-2xl animate-scale-in" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-gray-700 flex items-center gap-2">
            <Smile className="w-5 h-5 text-[#2e7d32]" />{t('profile.title', language)}
          </h3>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400"><X className="w-4 h-4" /></button>
        </div>

        {/* 预览 */}
        <div className="flex items-center gap-4 mb-4">
          <Avatar user={{ ...user, avatar: tab === 'emoji' ? JSON.stringify({ type: 'emoji', value: emoji, bg }) : (img ? JSON.stringify({ type: 'image', value: img }) : undefined) }} size={64} />
          <div className="text-sm">
            <p className="font-bold text-gray-800">{displayName || username}</p>
            <p className="text-xs text-gray-400">@{username}</p>
          </div>
        </div>

        {/* Tab 切换 */}
        <div className="flex gap-2 mb-4">
          <button onClick={() => setTab('emoji')} className={`flex-1 px-3 py-2 rounded-xl text-xs font-bold transition-all ${tab === 'emoji' ? 'bg-[#e8f5e9] text-[#2e7d32]' : 'bg-gray-100 text-gray-500'}`}>
            <Smile className="w-3.5 h-3.5 inline mr-1" />{t('profile.emojiTab', language)}
          </button>
          <button onClick={() => setTab('image')} className={`flex-1 px-3 py-2 rounded-xl text-xs font-bold transition-all ${tab === 'image' ? 'bg-[#e8f5e9] text-[#2e7d32]' : 'bg-gray-100 text-gray-500'}`}>
            <ImageIcon className="w-3.5 h-3.5 inline mr-1" />{t('profile.imageTab', language)}
          </button>
        </div>

        {tab === 'emoji' ? (
          <div className="space-y-3 mb-4">
            <div>
              <p className="text-[10px] font-bold text-gray-400 mb-1.5">{t('profile.chooseEmoji', language)}</p>
              <div className="grid grid-cols-8 gap-1.5">
                {EMOJIS.map(e => (
                  <button key={e} onClick={() => setEmoji(e)} className={`aspect-square rounded-xl text-xl flex items-center justify-center transition-all ${emoji === e ? 'bg-[#e8f5e9] ring-2 ring-[#2e7d32]' : 'hover:bg-gray-50'}`}>{e}</button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-[10px] font-bold text-gray-400 mb-1.5">{t('profile.chooseBg', language)}</p>
              <div className="flex gap-2">
                {COLORS.map(c => (
                  <button key={c} onClick={() => setBg(c)} className={`w-8 h-8 rounded-full transition-all ${bg === c ? 'ring-2 ring-offset-2 ring-[#2e7d32]' : ''}`} style={{ background: c }} />
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-3 mb-4">
            <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }} />
            <button onClick={() => fileRef.current?.click()} className="w-full py-3 rounded-xl border-2 border-dashed border-gray-300 text-sm text-gray-500 hover:border-[#2e7d32] hover:text-[#2e7d32] transition-all">
              {img ? <img src={img} alt="" className="w-16 h-16 rounded-full object-cover mx-auto mb-1" /> : <ImageIcon className="w-6 h-6 mx-auto mb-1" />}
              {t('profile.chooseImage', language)}
            </button>
          </div>
        )}

        {/* 用户名 + 显示名 */}
        <div className="space-y-3 mb-4">
          <div>
            <label className="text-[10px] font-bold text-gray-400 block mb-1">{t('profile.displayName', language)}</label>
            <input type="text" value={displayName} onChange={e => setDisplayName(e.target.value)} className="w-full glass-input rounded-lg px-3 py-2 text-sm" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-gray-400 block mb-1">{t('profile.username', language)}</label>
            <input type="text" value={username} onChange={e => setUsername(e.target.value)} className="w-full glass-input rounded-lg px-3 py-2 text-sm" />
            <p className="text-[10px] text-gray-400 mt-1">{t('profile.usernameHint', language)}</p>
          </div>
        </div>

        <button onClick={save} disabled={saving} className="w-full btn-primary py-2.5 rounded-xl text-sm font-bold disabled:opacity-60">
          <Save className="w-4 h-4 inline mr-1" />{saving ? t('profile.saving', language) : t('profile.save', language)}
        </button>
      </div>
    </div>
  );
};

export default ProfileModal;
