import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { Plus, Trash2, Package, Download, Search } from 'lucide-react';
import { generateId, t } from '../utils';
import * as XLSX from 'xlsx';

const Inventory: React.FC = () => {
  const { rooms, addRoom, updateRoom, deleteRoom, language } = useApp();
  const [newRoomName, setNewRoomName] = useState('');
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [itemName, setItemName] = useState('');
  const [itemQty, setItemQty] = useState(0);
  const [itemForm, setItemForm] = useState<string>('Glass Tube');

  const activeRoom = rooms.find(r => r.id === selectedRoomId);

  const handleExport = () => {
    if (!activeRoom) return;
    const exportData = activeRoom.items.map((item: any) => ({
      Room: activeRoom.name, ID_Name: item.germplasmName, Quantity: item.quantity, Form: item.form, UpdatedAt: new Date(item.updatedAt).toLocaleDateString()
    }));
    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Inventory");
    XLSX.writeFile(wb, `Inventory_${activeRoom.name}.xlsx`);
  };

  return (
    <div className="h-full flex flex-col md:flex-row gap-6 animate-fade-in-up">
      <div className="w-full md:w-80 glass-panel rounded-2xl flex flex-col overflow-hidden shrink-0 h-40 md:h-full transition-all">
        <div className="p-5 border-b border-white/20 bg-white/30 backdrop-blur-md shrink-0">
          <h2 className="text-lg font-bold text-gray-800 mb-4">{t('inv.list', language)}</h2>
          <div className="flex gap-2">
            <input className="flex-1 glass-input rounded-lg px-3 py-2 text-sm outline-none min-w-0" placeholder={t('inv.newRoom', language)} value={newRoomName} onChange={e => setNewRoomName(e.target.value)} />
            <button onClick={() => { if (newRoomName.trim()) { addRoom(newRoomName); setNewRoomName(''); } }} className="bg-[#2e7d32] text-white p-2 rounded-lg shadow-lg hover:bg-[#1b5e20] transition-all"><Plus className="w-4 h-4" /></button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-2 custom-scrollbar">
          {rooms.map((room: any) => (
            <div key={room.id} onClick={() => setSelectedRoomId(room.id)}
              className={`p-4 rounded-xl cursor-pointer transition-all duration-300 flex justify-between items-center group ${
                selectedRoomId === room.id ? 'bg-[#2e7d32] text-white shadow-lg shadow-green-900/20 scale-105' : 'bg-white/40 hover:bg-white text-gray-700'
              }`}>
              <div className="truncate">
                <div className="font-bold text-sm truncate">{room.name}</div>
                <div className={`text-xs mt-1 ${selectedRoomId === room.id ? 'text-green-100' : 'text-gray-400'}`}>{room.items?.length || 0} items</div>
              </div>
              <button onClick={(e) => { e.stopPropagation(); deleteRoom(room.id); }} className={`p-1.5 rounded-full ${selectedRoomId === room.id ? 'hover:bg-green-700 text-white' : 'hover:bg-red-50 text-gray-400 hover:text-red-500'} opacity-0 group-hover:opacity-100 transition-opacity`}>
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 glass-panel rounded-2xl flex flex-col overflow-hidden relative min-w-0 animate-fade-in-up">
        {activeRoom ? (
          <>
            <div className="p-6 border-b border-white/20 bg-white/30 backdrop-blur-md flex flex-col sm:flex-row sm:justify-between sm:items-end gap-4 sticky top-0 z-10">
              <div>
                <span className="t-eyebrow">INVENTORY</span>
                <h1 className="t-page-title text-2xl sm:text-3xl mt-1">{activeRoom.name}</h1>
                <p className="text-sm text-gray-500 mt-1 flex items-center gap-2"><Package className="w-4 h-4" /> {activeRoom.items?.length || 0} records</p>
              </div>
              <button onClick={handleExport} className="px-4 py-2 bg-white/60 hover:bg-white text-green-700 rounded-lg text-sm font-semibold shadow-sm transition-all flex items-center gap-2 active:scale-95">
                <Download className="w-4 h-4" /> {t('inv.export', language)}
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 sm:p-6 custom-scrollbar">
              <div className="bg-white/40 border border-white/50 rounded-xl p-4 mb-6 grid grid-cols-1 md:grid-cols-4 lg:grid-cols-12 gap-3 shadow-sm animate-scale-in">
                <div className="md:col-span-2 lg:col-span-4"><label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">{t('inv.resName', language)}</label><input className="w-full glass-input rounded-lg p-2 text-sm outline-none" value={itemName} onChange={e => setItemName(e.target.value)} /></div>
                <div className="md:col-span-1 lg:col-span-2"><label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">{t('inv.qty', language)}</label><input type="number" className="w-full glass-input rounded-lg p-2 text-sm outline-none" value={itemQty} onChange={e => setItemQty(Number(e.target.value))} /></div>
                <div className="md:col-span-2 lg:col-span-4"><label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1 block">{t('inv.form', language)}</label><select className="w-full glass-input rounded-lg p-2 text-sm outline-none" value={itemForm} onChange={e => setItemForm(e.target.value)}><option>Glass Tube</option><option>Plastic Jar</option><option>Box</option></select></div>
                <div className="md:col-span-4 lg:col-span-2 flex items-end"><button onClick={() => { if (itemName) { const u = { ...activeRoom, items: [...(activeRoom.items || []), { id: generateId(), germplasmName: itemName, quantity: itemQty, form: itemForm, updatedAt: new Date().toISOString() }] }; updateRoom(u); setItemName(''); setItemQty(0); } }} className="btn-primary w-full p-2 rounded-lg text-sm font-bold shadow-md active:scale-95">{t('common.add', language)}</button></div>
              </div>

              <div className="bg-white/50 rounded-xl border border-white/60 overflow-hidden shadow-sm">
                <div className="hidden md:block overflow-x-auto">
                  <table className="w-full min-w-[500px]">
                    <thead className="bg-gray-50/50 border-b border-gray-100">
                      <tr>
                        <th className="px-6 py-3 text-left text-xs font-bold text-gray-400 uppercase">{t('inv.resName', language)}</th>
                        <th className="px-6 py-3 text-left text-xs font-bold text-gray-400 uppercase">{t('inv.qty', language)}</th>
                        <th className="px-6 py-3 text-left text-xs font-bold text-gray-400 uppercase">{t('inv.form', language)}</th>
                        <th className="px-6 py-3 text-left text-xs font-bold text-gray-400 uppercase">{t('inv.updateTime', language)}</th>
                        <th className="w-10"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50/50">
                      {(activeRoom.items || []).map((item: any) => (
                        <tr key={item.id} className="hover:bg-white/80 transition-colors animate-fade-in-up">
                          <td className="px-6 py-4 text-sm font-semibold text-gray-800">{item.germplasmName}</td>
                          <td className="px-6 py-4 text-sm font-mono text-[#2e7d32]">{item.quantity}</td>
                          <td className="px-6 py-4 text-sm text-gray-500"><span className="bg-gray-100 px-2 py-1 rounded text-xs">{item.form}</span></td>
                          <td className="px-6 py-4 text-xs text-gray-400">{new Date(item.updatedAt).toLocaleDateString()}</td>
                          <td className="px-6 py-4 text-right"><button onClick={() => updateRoom({ ...activeRoom, items: (activeRoom.items || []).filter((i: any) => i.id !== item.id) })} className="text-gray-300 hover:text-red-500"><Trash2 className="w-4 h-4" /></button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="md:hidden p-2 space-y-2">
                  {(activeRoom.items || []).map((item: any) => (
                    <div key={item.id} className="bg-white p-4 rounded-xl shadow-sm flex justify-between items-center animate-fade-in-up">
                      <div>
                        <div className="font-bold text-gray-800">{item.germplasmName}</div>
                        <div className="text-xs text-gray-500 mt-1">{item.form} &bull; {new Date(item.updatedAt).toLocaleDateString()}</div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-lg font-mono font-bold text-[#2e7d32] bg-green-50 px-2 py-1 rounded">{item.quantity}</span>
                        <button onClick={() => updateRoom({ ...activeRoom, items: (activeRoom.items || []).filter((i: any) => i.id !== item.id) })} className="text-gray-300 hover:text-red-500 p-2"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </div>
                  ))}
                </div>

                {(!activeRoom.items || activeRoom.items.length === 0) && <div className="p-8 text-center text-gray-400 text-sm">{t('inv.emptyRoom', language)}</div>}
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-gray-300 select-none animate-scale-in">
            <Package className="w-24 h-24 mb-6 opacity-20" />
            <p className="text-lg font-medium">{t('inv.selectRoom', language)}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Inventory;
