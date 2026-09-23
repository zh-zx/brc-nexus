import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { LabelTemplate, Language, User } from '../types';
import { api } from '../api';

interface AppContextType {
  // Auth
  user: User | null;
  token: string | null;
  needsSetup: boolean;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<void>;
  setup: (username: string, password: string) => Promise<void>;
  logout: () => void;
  // v2.8：更新个人资料（显示名/用户名/头像），成功后刷新 user
  updateProfile: (patch: { displayName?: string; username?: string; avatar?: any }) => Promise<void>;

  // Data (cached from server)
  data: any[];
  columns: string[];
  hiddenColumns: string[];
  primaryIdColumn: string;
  nameColumn: string;

  // Settings
  language: Language;
  setLanguage: (lang: Language) => void;
  selectedPrinter: string | null;
  setSelectedPrinter: (p: string | null) => void;
  enablePrintLog: boolean;
  printLogPath: string | null;
  setPrintLogSettings: (enable: boolean, path: string | null) => void;

  // Master data
  operators: any[];
  mediaTypes: any[];
  templates: LabelTemplate[];
  rooms: any[];
  logo: string | null;

  // Actions
  setData: (data: any[]) => void;
  setColumns: (cols: string[]) => void;
  toggleColumnVisibility: (col: string) => void;
  setColumnMapping: (idCol: string, nameCol: string) => void;
  addOperator: (name: string) => Promise<void>;
  removeOperator: (id: string) => Promise<void>;
  addMediaType: (name: string) => Promise<void>;
  removeMediaType: (id: string) => Promise<void>;
  saveTemplate: (template: LabelTemplate) => Promise<void>;
  deleteTemplate: (id: string) => Promise<void>;
  addRoom: (name: string) => Promise<void>;
  updateRoom: (room: any) => Promise<void>;
  deleteRoom: (id: string) => Promise<void>;

  // Refresh
  refreshAll: () => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [needsSetup, setNeedsSetup] = useState(false);
  const [data, setDataState] = useState<any[]>([]);
  const [columns, setColumnsState] = useState<string[]>(['cccapNo', 'name']);
  const [hiddenColumns, setHiddenColumns] = useState<string[]>([]);
  const [primaryIdColumn, setPrimaryIdColumn] = useState('cccapNo');
  const [nameColumn, setNameColumn] = useState('name');
  const [language, setLanguageState] = useState<Language>('zh');
  const [selectedPrinter, setSelectedPrinterState] = useState<string | null>(null);
  const [enablePrintLog, setEnablePrintLog] = useState(false);
  const [printLogPath, setPrintLogPath] = useState<string | null>(null);
  const [operators, setOperators] = useState<any[]>([]);
  const [mediaTypes, setMediaTypes] = useState<any[]>([]);
  const [templates, setTemplates] = useState<LabelTemplate[]>([]);
  const [rooms, setRooms] = useState<any[]>([]);
  const [logo, setLogo] = useState<string | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  const refreshAll = useCallback(async () => {
    try {
      const [opsRes, mediaRes, tmplRes, roomsRes] = await Promise.all([
        api.getOperators().catch(() => ({ operators: [] })),
        api.getMediaTypes().catch(() => ({ mediaTypes: [] })),
        api.getTemplates().catch(() => ({ templates: [] })),
        api.getRooms().catch(() => ({ rooms: [] })),
      ]);
      setOperators(opsRes.operators);
      setMediaTypes(mediaRes.mediaTypes);
      setTemplates(tmplRes.templates);
      setRooms(roomsRes.rooms);

      // Load settings
      try {
        const settings = await api.getSettings();
        if (settings.language) setLanguageState(settings.language as Language);
        if (settings.primary_id_column) setPrimaryIdColumn(settings.primary_id_column);
        if (settings.name_column) setNameColumn(settings.name_column);
        setSelectedPrinterState(settings.selected_printer || null);
        setEnablePrintLog(settings.enable_print_log === 'true');
        setPrintLogPath(settings.print_log_path || null);
      } catch (e) { /* settings may not be available */ }
    } catch (e) {
      console.warn('Failed to load data', e);
    }
  }, []);

  // Auth check on mount
  useEffect(() => {
    (async () => {
      try {
        const status = await api.checkSetup();
        setNeedsSetup(status.needsSetup);
        if (!status.needsSetup) {
          const token = localStorage.getItem('brc_token');
          if (token) {
            try {
              const { user: u } = await api.me();
              setUser(u);
            } catch {
              // Token invalid
              localStorage.removeItem('brc_token');
            }
          }
        }
      } catch (e) {
        console.warn('Server not reachable');
      }
      setIsLoaded(true);
    })();
  }, []);

  // Load data when authenticated
  useEffect(() => {
    if (user) {
      refreshAll();
    }
  }, [user, refreshAll]);

  const login = async (username: string, password: string) => {
    const res = await api.login(username, password);
    setUser(res.user);
    await refreshAll();
  };

  const setup = async (username: string, password: string) => {
    const res = await api.setup(username, password);
    setUser(res.user);
    setNeedsSetup(false);
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('brc_token');
  };

  const updateProfile = async (patch: { displayName?: string; username?: string; avatar?: any }) => {
    const res = await api.updateMyProfile(patch);
    setUser(res.user);
  };

  const setData = (newData: any[]) => {
    setDataState(newData);
    if (newData.length > 0) {
      const keys = Object.keys(newData[0]).filter(k => k !== 'id');
      setColumnsState(keys);
    }
  };

  const toggleColumnVisibility = (col: string) => {
    setHiddenColumns(prev =>
      prev.includes(col) ? prev.filter(c => c !== col) : [...prev, col]
    );
  };

  const setColumnMapping = (idCol: string, nameCol: string) => {
    setPrimaryIdColumn(idCol);
    setNameColumn(nameCol);
  };

  const addOperator = async (name: string) => {
    await api.createOperator(name);
    const res = await api.getOperators();
    setOperators(res.operators);
  };

  const removeOperator = async (id: string) => {
    await api.deleteOperator(id);
    setOperators(prev => prev.filter(o => o.id !== id));
  };

  const addMediaType = async (name: string) => {
    await api.createMediaType(name);
    const res = await api.getMediaTypes();
    setMediaTypes(res.mediaTypes);
  };

  const removeMediaType = async (id: string) => {
    await api.deleteMediaType(id);
    setMediaTypes(prev => prev.filter(m => m.id !== id));
  };

  const saveTemplate = async (template: LabelTemplate) => {
    await api.saveTemplate(template);
    const res = await api.getTemplates();
    setTemplates(res.templates);
  };

  const deleteTemplate = async (id: string) => {
    await api.deleteTemplate(id);
    setTemplates(prev => prev.filter(t => t.id !== id));
  };

  const addRoom = async (name: string) => {
    await api.createRoom(name);
    const res = await api.getRooms();
    setRooms(res.rooms);
  };

  const updateRoom = async (room: any) => {
    await api.updateRoom(room);
    const res = await api.getRooms();
    setRooms(res.rooms);
  };

  const deleteRoom = async (id: string) => {
    await api.deleteRoom(id);
    setRooms(prev => prev.filter(r => r.id !== id));
  };

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    api.updateSettings({ language: lang }).catch(() => {});
  };

  const setSelectedPrinter = (p: string | null) => {
    setSelectedPrinterState(p);
    api.updateSettings({ selected_printer: p || '' }).catch(() => {});
  };

  const setPrintLogSettings = (enable: boolean, path: string | null) => {
    setEnablePrintLog(enable);
    setPrintLogPath(path);
    api.updateSettings({ enable_print_log: String(enable), print_log_path: path || '' }).catch(() => {});
  };

  if (!isLoaded) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-green-50">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-[#2e7d32] border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-500 font-medium">Connecting to BRC Nexus...</p>
        </div>
      </div>
    );
  }

  const isAuthenticated = !!user;

  return (
    <AppContext.Provider value={{
      user, token: localStorage.getItem('brc_token'), needsSetup, isAuthenticated,
      login, setup, logout, updateProfile,
      data, columns, hiddenColumns, primaryIdColumn, nameColumn,
      language, setLanguage,
      selectedPrinter, setSelectedPrinter,
      enablePrintLog, printLogPath, setPrintLogSettings,
      operators, mediaTypes, templates, rooms, logo,
      setData, setColumns: setColumnsState,
      toggleColumnVisibility, setColumnMapping,
      addOperator, removeOperator,
      addMediaType, removeMediaType,
      saveTemplate, deleteTemplate,
      addRoom, updateRoom, deleteRoom,
      refreshAll,
    }}>
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
};
