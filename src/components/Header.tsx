import React from 'react';
import {
  Printer,
  Database,
  Layers,
  FileText,
  Download,
  Ruler,
  Percent,
  Clock,
} from 'lucide-react';
import { RollMetrics } from '../types';

interface HeaderProps {
  activeTab: 'bulk' | 'canvas' | 'database' | 'export';
  setActiveTab: (tab: 'bulk' | 'canvas' | 'database' | 'export') => void;
  metrics: RollMetrics;
  ordersCount: number;
  presetsCount: number;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  metrics,
  ordersCount,
  presetsCount,
}) => {
  return (
    <header className="sticky top-0 z-40 bg-zinc-900/95 backdrop-blur border-b border-zinc-800 shadow-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo & Brand */}
          <div className="flex items-center space-x-3 cursor-pointer" onClick={() => setActiveTab('bulk')}>
            <div className="w-9 h-9 rounded-lg bg-zinc-900 border border-red-500/40 p-0.5 shadow-[0_0_12px_rgba(239,68,68,0.3)] flex items-center justify-center">
              <div className="w-full h-full bg-zinc-950 rounded flex items-center justify-center relative">
                <Printer className="w-4 h-4 text-red-500" />
                <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-red-600 shadow-[0_0_8px_rgba(239,68,68,0.8)]"></span>
              </div>
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-black tracking-tighter text-lg text-white uppercase">
                  SPIDEY JERSEY
                </span>
                <span className="text-[10px] font-mono tracking-widest px-2 py-0.5 bg-red-600/10 text-red-400 border border-red-500/30 rounded">
                  DTF PRO v2.4
                </span>
              </div>
              <p className="text-[11px] text-zinc-500 font-mono uppercase tracking-wider hidden sm:block">
                39" Roll DTF Print Sheet Automation & Nesting Engine
              </p>
            </div>
          </div>

          {/* Navigation Tabs */}
          <nav className="flex space-x-1.5 bg-zinc-950 p-1 rounded-xl border border-zinc-800">
            <button
              onClick={() => setActiveTab('bulk')}
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                activeTab === 'bulk'
                  ? 'bg-red-600 text-white shadow-lg shadow-red-900/30'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-800/80'
              }`}
            >
              <FileText className="w-4 h-4" />
              <span>1. Bulk Orders</span>
              {ordersCount > 0 && (
                <span className="ml-1 text-[10px] font-mono px-1.5 py-0.2 bg-black/40 text-white rounded">
                  {ordersCount}
                </span>
              )}
            </button>

            <button
              onClick={() => setActiveTab('canvas')}
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                activeTab === 'canvas'
                  ? 'bg-red-600 text-white shadow-lg shadow-red-900/30'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-800/80'
              }`}
            >
              <Layers className="w-4 h-4" />
              <span>2. 39" Nesting Canvas</span>
            </button>

            <button
              onClick={() => setActiveTab('database')}
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                activeTab === 'database'
                  ? 'bg-red-600 text-white shadow-lg shadow-red-900/30'
                  : 'text-zinc-400 hover:text-white hover:bg-zinc-800/80'
              }`}
            >
              <Database className="w-4 h-4" />
              <span>Design Presets</span>
              <span className="text-[10px] font-mono px-1.5 py-0.2 bg-zinc-800 text-zinc-300 rounded border border-zinc-700">
                {presetsCount}+
              </span>
            </button>

            <button
              onClick={() => setActiveTab('export')}
              className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all ${
                activeTab === 'export'
                  ? 'bg-red-600 text-white shadow-lg shadow-red-900/30'
                  : 'text-zinc-300 hover:text-white hover:bg-zinc-800/80'
              }`}
            >
              <Download className="w-4 h-4" />
              <span>Export DTF File</span>
            </button>
          </nav>

          {/* Quick Metrics Badge */}
          <div className="hidden lg:flex items-center space-x-3 text-xs font-mono bg-zinc-950 px-3 py-1.5 rounded-xl border border-zinc-800">
            <div className="flex items-center space-x-1.5 text-zinc-300">
              <Ruler className="w-3.5 h-3.5 text-red-400" />
              <span>
                39" x <strong className="text-white">{metrics.totalRollLengthInches}"</strong>
              </span>
            </div>
            <div className="h-3 w-px bg-zinc-800" />
            <div className="flex items-center space-x-1 text-emerald-400">
              <Percent className="w-3.5 h-3.5" />
              <span>Eff: <strong>{metrics.efficiencyPercentage}%</strong></span>
            </div>
            <div className="h-3 w-px bg-zinc-800" />
            <div className="flex items-center space-x-1 text-amber-400">
              <Clock className="w-3.5 h-3.5" />
              <span>~{metrics.estimatedPrintTimeMinutes}m</span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
};
