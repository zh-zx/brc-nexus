import React from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

// v2.8 生产级硬化：全局错误边界，杜绝白屏 —— 出错显示友好降级卡片（刷新 / 回首页）
class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary]', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-[60vh] flex items-center justify-center p-6">
          <div className="glass-card rounded-3xl p-8 max-w-md w-full text-center space-y-4 animate-scale-in">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-50 flex items-center justify-center">
              <AlertTriangle className="w-7 h-7 text-amber-500" />
            </div>
            <div>
              <h3 className="text-lg font-black text-gray-700">页面出了点问题</h3>
              <p className="text-xs text-gray-500 mt-1">Something went wrong on this page. 已自动拦截，不会影响其他功能。</p>
              <p className="text-[10px] text-gray-400 mt-2 font-mono break-words bg-white/60 rounded-xl px-3 py-2">{this.state.error.message || String(this.state.error)}</p>
            </div>
            <div className="flex gap-2 justify-center">
              <button onClick={() => { this.setState({ error: null }); }} className="px-4 py-2 rounded-xl bg-[#2e7d32] text-white text-xs font-bold hover:bg-[#1b5e20] flex items-center gap-1">
                <RefreshCw className="w-3.5 h-3.5" /> 重试
              </button>
              <button onClick={() => { window.location.hash = '/'; this.setState({ error: null }); }} className="px-4 py-2 rounded-xl bg-white border border-gray-200 text-gray-600 text-xs font-bold hover:bg-gray-50 flex items-center gap-1">
                <Home className="w-3.5 h-3.5" /> 回首页
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
