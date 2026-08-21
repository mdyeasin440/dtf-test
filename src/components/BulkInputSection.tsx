import React, { useState } from 'react';
import {
  FileText,
  Sparkles,
  CheckCircle2,
  AlertTriangle,
  ArrowRight,
  Upload,
  Copy,
  Trash2,
  ListFilter,
  Layers,
  Ruler,
  HelpCircle,
} from 'lucide-react';
import { DesignPreset, OrderItem } from '../types';
import { parseBulkInput } from '../utils/nestingEngine';

interface BulkInputSectionProps {
  presets: DesignPreset[];
  rawText: string;
  setRawText: (text: string) => void;
  parsedOrders: OrderItem[];
  setParsedOrders: React.Dispatch<React.SetStateAction<OrderItem[]>>;
  onGenerateLayout: (orders: OrderItem[]) => void;
}

export const BulkInputSection: React.FC<BulkInputSectionProps> = ({
  presets,
  rawText,
  setRawText,
  parsedOrders,
  setParsedOrders,
  onGenerateLayout,
}) => {
  const [defaultGarmentSize, setDefaultGarmentSize] = useState<'Adult' | 'Youth' | 'Infant'>('Adult');

  const presetsMap = new Map<string, DesignPreset>(presets.map((p) => [p.code.toUpperCase(), p]));

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setRawText(val);
    const parsed = parseBulkInput(val, presetsMap);
    setParsedOrders(parsed);
  };

  const handleLoadSample = (sampleNum: number) => {
    let sampleContent = '';
    const sampleNames = ['RONALDO', 'MESSI', 'NEYMAR', 'MBAPPE', 'BELLINGHAM', 'HAALAND', 'SALAH', 'MODRIC', 'KANE', 'DE BRUYNE'];
    const sampleNumbers = ['7', '10', '11', '9', '5', '9', '11', '10', '9', '17'];
    
    if (presets.length > 0) {
      sampleContent = sampleNames.map((name, i) => {
        const p = presets[i % presets.length];
        const num = sampleNumbers[i % sampleNumbers.length];
        const size = i % 4 === 2 ? ', Youth' : i % 4 === 3 ? ', Infant' : '';
        return `${p.code}, ${name}, ${num}${size}`;
      }).join('\n');
    } else {
      sampleContent = `MY-CODE-01, RONALDO, 7\nMY-CODE-01, MESSI, 10\nMY-CODE-02, NEYMAR, 11, Adult\nMY-CODE-02, MBAPPE, 7, Youth`;
    }

    setRawText(sampleContent);
    const parsed = parseBulkInput(sampleContent, presetsMap);
    setParsedOrders(parsed);
  };

  const handleRemapDesignCode = (orderId: string, newPresetCode: string) => {
    const matched = presets.find((p) => p.code === newPresetCode);
    setParsedOrders((prev) =>
      prev.map((ord) => {
        if (ord.id === orderId) {
          return {
            ...ord,
            designCode: newPresetCode,
            matchedPreset: matched,
            status: matched ? 'matched' : 'unmatched_code',
            errorMessage: matched ? undefined : 'Preset not found',
          };
        }
        return ord;
      })
    );
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setRawText(content);
      const parsed = parseBulkInput(content, presetsMap);
      setParsedOrders(parsed);
    };
    reader.readAsText(file);
  };

  const matchedCount = parsedOrders.filter((o) => o.status === 'matched').length;
  const unmatchedCount = parsedOrders.filter((o) => o.status === 'unmatched_code').length;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Title & Description */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tighter text-white uppercase flex items-center space-x-2">
            <FileText className="w-6 h-6 text-red-500" />
            <span>Bulk Order Data Input</span>
          </h1>
          <p className="text-xs text-zinc-400 mt-1 font-mono">
            Paste comma-separated order lists. Each line is automatically matched with your team design database specifications.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Left Column: Text Area Input */}
        <div className="lg:col-span-6 space-y-4">
          <div className="bg-zinc-900/50 rounded-xl border border-zinc-800 p-5 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 flex items-center space-x-2">
                <span>Paste Order Lines</span>
                <span className="text-[10px] text-zinc-500 font-mono font-normal">
                  ([Design Code], [Name], [Number], [Optional Size])
                </span>
              </label>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handleLoadSample(1)}
                  className="text-xs font-semibold px-2.5 py-1 bg-red-600/10 text-red-400 border border-red-500/30 rounded hover:bg-red-600/20 transition-all uppercase tracking-wider text-[10px]"
                >
                  Load Sample Batch
                </button>
              </div>
            </div>

            <textarea
              rows={14}
              value={rawText}
              onChange={handleTextChange}
              placeholder={`[DESIGN_CODE], RONALDO, 7\n[DESIGN_CODE], MESSI, 10\n[DESIGN_CODE], NEYMAR, 11, Adult\n[DESIGN_CODE], MBAPPE, 7, Youth`}
              className="w-full bg-zinc-950 text-zinc-300 font-mono text-xs p-4 rounded-lg border border-zinc-800 focus:border-zinc-600 focus:outline-none placeholder:text-zinc-600 leading-relaxed resize-none"
            />

            <div className="flex items-center justify-between mt-3 text-xs text-zinc-400">
              <div className="flex items-center space-x-3 font-mono text-xs">
                <span>Total Items: <strong className="text-white">{parsedOrders.length}</strong></span>
                {matchedCount > 0 && (
                  <span className="text-emerald-400 font-mono flex items-center space-x-1">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>{matchedCount} Matched</span>
                  </span>
                )}
                {unmatchedCount > 0 && (
                  <span className="text-amber-400 font-mono flex items-center space-x-1">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>{unmatchedCount} Unmatched</span>
                  </span>
                )}
              </div>

              <div className="flex items-center space-x-2">
                <label className="flex items-center space-x-1 text-zinc-400 hover:text-white cursor-pointer text-xs">
                  <Upload className="w-3.5 h-3.5 text-red-400" />
                  <span>Import CSV/TXT</span>
                  <input type="file" accept=".txt,.csv" onChange={handleFileUpload} className="hidden" />
                </label>
                <button
                  onClick={() => {
                    setRawText('');
                    setParsedOrders([]);
                  }}
                  className="text-zinc-500 hover:text-red-400 p-1"
                  title="Clear Input"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Sizing & Batch Options */}
          <div className="bg-zinc-900/50 rounded-xl border border-zinc-800 p-5 shadow-xl">
            <h3 className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider mb-3">
              Batch Scale & Garment Sizing Preset
            </h3>
            <div className="grid grid-cols-3 gap-3">
              {(['Adult', 'Youth', 'Infant'] as const).map((sz) => (
                <button
                  key={sz}
                  onClick={() => setDefaultGarmentSize(sz)}
                  className={`p-3 rounded-lg border text-center transition-all ${
                    defaultGarmentSize === sz
                      ? 'bg-red-600/10 border-red-500/30 text-red-400 font-bold'
                      : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-white'
                  }`}
                >
                  <div className="text-xs font-bold uppercase tracking-wider">{sz} Size</div>
                  <div className="text-[10px] text-zinc-500 mt-0.5 font-mono">
                    {sz === 'Adult' ? '100% (12" Name / 9.5" Num)' : sz === 'Youth' ? '80% (9.6" Name / 7.6" Num)' : '65% (7.8" Name / 6.1" Num)'}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Parsed Orders Table & Process Button */}
        <div className="lg:col-span-6 space-y-4">
          <div className="bg-zinc-900/50 rounded-xl border border-zinc-800 p-5 shadow-xl flex flex-col justify-between min-h-[480px]">
            <div>
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center space-x-2">
                  <ListFilter className="w-4 h-4 text-red-400" />
                  <span>Parsed Orders Table ({parsedOrders.length})</span>
                </h3>

                <span className="text-xs text-zinc-400 font-mono">
                  Target Canvas: <strong className="text-white">39" Roll Width</strong>
                </span>
              </div>

              {parsedOrders.length === 0 ? (
                <div className="bg-zinc-950 rounded-xl border border-dashed border-zinc-800 p-12 text-center flex flex-col items-center justify-center">
                  <Layers className="w-10 h-10 text-zinc-600 mb-3" />
                  <p className="text-zinc-400 text-xs font-bold uppercase tracking-wider">No Orders Parsed Yet</p>
                  <p className="text-zinc-500 text-xs mt-1 max-w-sm font-mono">
                    Paste your order lines in the box on the left or click "Load Sample 1" to test auto-nesting.
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto max-h-[380px] overflow-y-auto rounded-lg border border-zinc-800">
                  <table className="w-full text-left text-xs text-zinc-300">
                    <thead className="bg-zinc-950 text-zinc-500 uppercase font-mono text-[10px] sticky top-0 border-b border-zinc-800">
                      <tr>
                        <th className="p-3">#</th>
                        <th className="p-3">Design Code</th>
                        <th className="p-3">Name</th>
                        <th className="p-3">Num</th>
                        <th className="p-3">Size</th>
                        <th className="p-3">Dimensions</th>
                        <th className="p-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/60 font-mono bg-zinc-950/60">
                      {parsedOrders.map((ord, idx) => (
                        <tr key={ord.id} className="hover:bg-zinc-800/50 transition-colors">
                          <td className="p-3 text-zinc-500">{idx + 1}</td>
                          <td className="p-3 font-bold">
                            {ord.status === 'matched' ? (
                              <span className="text-red-400">{ord.designCode}</span>
                            ) : (
                              <select
                                value={ord.designCode}
                                onChange={(e) => handleRemapDesignCode(ord.id, e.target.value)}
                                className="bg-amber-950 text-amber-300 border border-amber-500/40 rounded px-1.5 py-1 text-xs focus:outline-none"
                              >
                                <option value="">Select Code...</option>
                                {presets.map((p) => (
                                   <option key={p.id} value={p.code}>
                                     {p.code} ({p.teamName})
                                   </option>
                                ))}
                              </select>
                            )}
                          </td>
                          <td className="p-3 text-white font-bold tracking-wider uppercase">{ord.customerName}</td>
                          <td className="p-3 text-red-500 font-black text-sm">{ord.number}</td>
                          <td className="p-3 text-zinc-400">{ord.garmentSize}</td>
                          <td className="p-3 text-zinc-400 text-[11px]">
                            {ord.nameWidthInches}" x {ord.nameHeightInches}" Name
                            <br />
                            {ord.numberWidthInches}" x {ord.numberHeightInches}" Num
                          </td>
                          <td className="p-3">
                            {ord.status === 'matched' ? (
                              <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                                <CheckCircle2 className="w-3 h-3" />
                                <span>Matched</span>
                              </span>
                            ) : (
                              <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/30">
                                <AlertTriangle className="w-3 h-3" />
                                <span>Unmapped</span>
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Bottom Generate Layout Action Bar */}
            <div className="pt-4 border-t border-zinc-800">
              <button
                disabled={parsedOrders.length === 0}
                onClick={() => onGenerateLayout(parsedOrders)}
                className={`w-full py-3 px-6 rounded-lg font-bold text-xs uppercase tracking-wider flex items-center justify-center space-x-3 transition-all ${
                  parsedOrders.length > 0
                    ? 'bg-red-600 hover:bg-red-500 text-white shadow-lg shadow-red-900/30 cursor-pointer'
                    : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                }`}
              >
                <Sparkles className="w-4 h-4 text-white" />
                <span>Generate Sheet & 39" DTF Roll Layout</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
