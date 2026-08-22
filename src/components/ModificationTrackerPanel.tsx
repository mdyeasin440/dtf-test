import React, { useState } from 'react';
import {
  Split,
  MapPin,
  Link,
  Sparkles,
  Info,
  CheckCircle2,
  Layers,
  ArrowRight,
  TrendingDown,
  Search,
  Filter,
  RefreshCw,
  Eye,
  Sliders,
} from 'lucide-react';
import { CanvasItem, DigitSplitLogEntry, LayoutSettings } from '../types';

interface ModificationTrackerPanelProps {
  modificationLogs: DigitSplitLogEntry[];
  canvasItems: CanvasItem[];
  selectedItemIds: string[];
  onSelectItems: (ids: string[]) => void;
  onMergeDigits: (logEntry: DigitSplitLogEntry) => void;
  onUnbundleNumber: (item: CanvasItem) => void;
  layoutSettings: LayoutSettings;
  onChangeLayoutSettings: (settings: LayoutSettings) => void;
  onRePack: () => void;
}

export const ModificationTrackerPanel: React.FC<ModificationTrackerPanelProps> = ({
  modificationLogs,
  canvasItems,
  selectedItemIds,
  onSelectItems,
  onMergeDigits,
  onUnbundleNumber,
  layoutSettings,
  onChangeLayoutSettings,
  onRePack,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterReason, setFilterReason] = useState<string>('all');

  // Filter logs based on search & filter
  const filteredLogs = modificationLogs.filter((log) => {
    const matchSearch =
      log.originalNumber.includes(searchTerm) ||
      log.customerName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      log.orderId.toLowerCase().includes(searchTerm.toLowerCase());

    const matchFilter =
      filterReason === 'all' || log.reason === filterReason;

    return matchSearch && matchFilter;
  });

  // Calculate live statistics
  const totalSplitCount = modificationLogs.length;
  const totalDigitsCreated = modificationLogs.reduce(
    (acc, log) => acc + log.digits.length,
    0
  );
  const totalSpaceSaved = modificationLogs.reduce(
    (acc, log) => acc + (log.spaceSavedInches || 0),
    0
  );

  // Multi-digit numbers that are currently intact on canvas
  const intactMultiDigitNumbers = canvasItems.filter(
    (it) => it.itemType === 'number' && it.number.replace(/\D/g, '').length > 1
  );

  const getReasonBadge = (reason: string) => {
    switch (reason) {
      case 'shelf_end_fill':
        return {
          label: 'Shelf End Fill',
          bg: 'bg-amber-500/20 text-amber-300 border-amber-500/40',
          desc: 'Tucked into remaining row gap space before wrap',
        };
      case 'smart_pocket_fill':
        return {
          label: 'Smart Pocket Fit',
          bg: 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40',
          desc: 'Scanned from candidate pool to fill an empty void',
        };
      case 'manual_unbundle':
        return {
          label: 'Manual Unbundle',
          bg: 'bg-purple-500/20 text-purple-300 border-purple-500/40',
          desc: 'Independently split by operator or full unbundle mode',
        };
      default:
        return {
          label: 'Gap Optimization',
          bg: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
          desc: 'Space optimization adjustment',
        };
    }
  };

  return (
    <div className="space-y-4 font-sans text-white">
      {/* Header & Stats Banner */}
      <div className="bg-gradient-to-br from-zinc-900 to-zinc-950 p-4 rounded-xl border border-zinc-800 shadow-xl space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center">
              <Split className="w-4 h-4 text-amber-400" />
            </div>
            <div>
              <h3 className="text-sm font-bold tracking-wide uppercase text-zinc-100 flex items-center space-x-2">
                <span>Modification Tracker</span>
                {totalSplitCount > 0 && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/30 text-amber-300 border border-amber-500/50 font-mono">
                    {totalSplitCount} Active
                  </span>
                )}
              </h3>
              <p className="text-[11px] text-zinc-400">
                Live audit of unbundled double digits and relocations
              </p>
            </div>
          </div>
        </div>

        {/* Metrics Summary Strip */}
        <div className="grid grid-cols-3 gap-2 pt-1 font-mono">
          <div className="bg-zinc-950/80 p-2.5 rounded-lg border border-zinc-800/80">
            <span className="text-[10px] text-zinc-400 uppercase block">
              Split Numbers
            </span>
            <span className="text-sm font-bold text-amber-400">
              {totalSplitCount}
            </span>
          </div>

          <div className="bg-zinc-950/80 p-2.5 rounded-lg border border-zinc-800/80">
            <span className="text-[10px] text-zinc-400 uppercase block">
              Digits Created
            </span>
            <span className="text-sm font-bold text-cyan-400">
              {totalDigitsCreated}
            </span>
          </div>

          <div className="bg-zinc-950/80 p-2.5 rounded-lg border border-zinc-800/80">
            <span className="text-[10px] text-zinc-400 uppercase block">
              Film Width Saved
            </span>
            <span className="text-sm font-bold text-emerald-400 flex items-center space-x-0.5">
              <span>+{totalSpaceSaved.toFixed(1)}"</span>
            </span>
          </div>
        </div>

        {/* Unbundling Mode Controller */}
        <div className="bg-zinc-950 p-2.5 rounded-lg border border-zinc-800 space-y-1.5 font-mono">
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-zinc-400 uppercase font-semibold flex items-center space-x-1">
              <Sliders className="w-3 h-3 text-amber-400" />
              <span>Nesting Optimization Mode</span>
            </span>
          </div>

          <div className="grid grid-cols-3 gap-1 text-[10px]">
            <button
              onClick={() => {
                const upd: LayoutSettings = {
                  ...layoutSettings,
                  digitNestingMode: 'smart_unbundle',
                  splitDigitsForNesting: true,
                };
                onChangeLayoutSettings(upd);
              }}
              className={`py-1.5 px-2 rounded font-bold uppercase transition-all flex flex-col items-center justify-center text-center ${
                layoutSettings.digitNestingMode === 'smart_unbundle' ||
                (!layoutSettings.digitNestingMode && layoutSettings.splitDigitsForNesting)
                  ? 'bg-amber-500 text-zinc-950 shadow-md font-extrabold'
                  : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 border border-zinc-800'
              }`}
              title="Keeps double digits intact by default, and unbundles only when it fills an empty gap to save film."
            >
              <span>Smart Gap Fill</span>
              <span className="text-[8px] opacity-80">(Recommended)</span>
            </button>

            <button
              onClick={() => {
                const upd: LayoutSettings = {
                  ...layoutSettings,
                  digitNestingMode: 'split_all',
                  splitDigitsForNesting: true,
                };
                onChangeLayoutSettings(upd);
              }}
              className={`py-1.5 px-2 rounded font-bold uppercase transition-all flex flex-col items-center justify-center text-center ${
                layoutSettings.digitNestingMode === 'split_all'
                  ? 'bg-cyan-500 text-zinc-950 shadow-md font-extrabold'
                  : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 border border-zinc-800'
              }`}
              title="Separates all double-digit numbers into independent single digits upfront for tightest nesting."
            >
              <span>Split All</span>
              <span className="text-[8px] opacity-80">(Max Density)</span>
            </button>

            <button
              onClick={() => {
                const upd: LayoutSettings = {
                  ...layoutSettings,
                  digitNestingMode: 'intact',
                  splitDigitsForNesting: false,
                };
                onChangeLayoutSettings(upd);
              }}
              className={`py-1.5 px-2 rounded font-bold uppercase transition-all flex flex-col items-center justify-center text-center ${
                layoutSettings.digitNestingMode === 'intact'
                  ? 'bg-zinc-700 text-white shadow-md font-extrabold'
                  : 'bg-zinc-900 text-zinc-400 hover:text-zinc-200 border border-zinc-800'
              }`}
              title="Locks double-digit numbers strictly together inside rigid bounding boxes."
            >
              <span>Keep Intact</span>
              <span className="text-[8px] opacity-80">(No Split)</span>
            </button>
          </div>
        </div>
      </div>

      {/* Search and Filters */}
      <div className="flex items-center space-x-2">
        <div className="relative flex-1">
          <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-2.5 top-2.5" />
          <input
            type="text"
            placeholder="Search number or player..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500 font-mono"
          />
        </div>

        <select
          value={filterReason}
          onChange={(e) => setFilterReason(e.target.value)}
          className="bg-zinc-900 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 focus:outline-none font-mono"
        >
          <option value="all">All Adjustments</option>
          <option value="shelf_end_fill">Shelf End Fills</option>
          <option value="smart_pocket_fill">Smart Pockets</option>
          <option value="manual_unbundle">Manual Unbundled</option>
        </select>
      </div>

      {/* Log Entries List */}
      <div className="space-y-3 max-h-[480px] overflow-y-auto pr-1">
        {filteredLogs.length === 0 ? (
          <div className="bg-zinc-900/50 border border-dashed border-zinc-800 rounded-xl p-6 text-center space-y-3">
            <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center mx-auto text-zinc-500">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-semibold text-zinc-300 font-mono">
                {searchTerm
                  ? 'No unbundled digits match your search filter'
                  : 'No unbundled double-digit modifications on this layout'}
              </p>
              <p className="text-[11px] text-zinc-500 mt-1 font-mono">
                Double digits were either kept intact or fit naturally within roll width.
              </p>
            </div>

            {intactMultiDigitNumbers.length > 0 && (
              <div className="pt-2 border-t border-zinc-800">
                <span className="text-[10px] text-zinc-400 block mb-2 font-mono">
                  {intactMultiDigitNumbers.length} intact multi-digit numbers available to unbundle:
                </span>
                <button
                  onClick={onRePack}
                  className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-bold uppercase font-mono rounded shadow flex items-center justify-center space-x-1.5 mx-auto transition-all"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Run Smart Unbundle Packing</span>
                </button>
              </div>
            )}
          </div>
        ) : (
          filteredLogs.map((log) => {
            const badge = getReasonBadge(log.reason);
            const isCurrentlySelected = log.digits.some((d) =>
              selectedItemIds.includes(d.itemId)
            );

            return (
              <div
                key={log.id}
                className={`p-3.5 rounded-xl border transition-all space-y-2.5 ${
                  isCurrentlySelected
                    ? 'bg-amber-950/40 border-amber-500/80 shadow-lg shadow-amber-950/30 ring-1 ring-amber-500/50'
                    : 'bg-zinc-900 border-zinc-800 hover:border-zinc-700'
                }`}
              >
                {/* Top Row: Original Number + Player + Reason Tag */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-2.5">
                    <div className="px-2 py-1 rounded bg-zinc-950 border border-zinc-700 text-amber-400 font-extrabold text-sm font-mono tracking-wider">
                      #{log.originalNumber}
                    </div>
                    <div>
                      <div className="text-xs font-bold text-zinc-100 flex items-center space-x-1.5">
                        <span>{log.customerName || 'Standard Order'}</span>
                      </div>
                      <span className="text-[10px] text-zinc-400 font-mono">
                        Order ID: {log.orderId}
                      </span>
                    </div>
                  </div>

                  <span
                    className={`text-[9px] font-bold uppercase font-mono px-2 py-0.5 rounded border ${badge.bg}`}
                    title={badge.desc}
                  >
                    {badge.label}
                  </span>
                </div>

                {/* Relocated Digits Breakdown */}
                <div className="bg-zinc-950/70 p-2.5 rounded-lg border border-zinc-800/80 space-y-1.5 font-mono text-[11px]">
                  <div className="flex items-center justify-between text-[10px] text-zinc-400 font-bold uppercase border-b border-zinc-800 pb-1">
                    <span>Relocated Digits</span>
                    <span className="text-emerald-400">
                      +{log.spaceSavedInches.toFixed(1)}" Width Saved
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-0.5">
                    {log.digits.map((digitLoc, dIdx) => (
                      <div
                        key={`${digitLoc.itemId}-${dIdx}`}
                        className="bg-zinc-900/90 p-2 rounded border border-zinc-800 flex items-center justify-between"
                      >
                        <div className="flex items-center space-x-1.5">
                          <span className="w-5 h-5 rounded bg-amber-500/20 text-amber-300 font-extrabold flex items-center justify-center text-xs">
                            {digitLoc.digit}
                          </span>
                          <div>
                            <span className="text-[10px] font-bold text-zinc-300 block">
                              Row #{digitLoc.shelfRowIndex}
                            </span>
                            <span className="text-[9px] text-zinc-500">
                              X: {digitLoc.x.toFixed(1)}" · Y: {digitLoc.y.toFixed(1)}"
                            </span>
                          </div>
                        </div>

                        <span className="text-[9px] text-zinc-400">
                          {digitLoc.width.toFixed(1)}"w
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Actions: Locate on Canvas & Re-Merge */}
                <div className="flex items-center space-x-2 pt-1">
                  <button
                    onClick={() => {
                      const itemIds = log.digits.map((d) => d.itemId);
                      onSelectItems(itemIds);
                    }}
                    className={`flex-1 py-1.5 px-2.5 rounded text-xs font-bold font-mono uppercase transition-all flex items-center justify-center space-x-1.5 ${
                      isCurrentlySelected
                        ? 'bg-cyan-500 text-zinc-950 shadow'
                        : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700'
                    }`}
                    title="Highlight and focus these unbundled digits on the canvas"
                  >
                    <Eye className="w-3.5 h-3.5 text-cyan-400" />
                    <span>
                      {isCurrentlySelected ? 'Selected on Canvas' : 'Locate on Canvas'}
                    </span>
                  </button>

                  <button
                    onClick={() => onMergeDigits(log)}
                    className="py-1.5 px-2.5 bg-zinc-800 hover:bg-emerald-600 hover:text-white text-zinc-300 text-xs font-bold font-mono uppercase rounded border border-zinc-700 transition-all flex items-center space-x-1"
                    title="Re-merge these digits back into a single compound number block"
                  >
                    <Link className="w-3.5 h-3.5" />
                    <span>Re-Merge</span>
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Auxiliary Help Note */}
      <div className="bg-zinc-900/40 p-3 rounded-lg border border-zinc-800 text-[10px] text-zinc-400 font-mono flex items-start space-x-2">
        <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
        <div>
          <span className="text-zinc-200 font-bold block">
            Automated Smart Void Packing
          </span>
          Unbundled digits are placed independently into DTF gap pockets to eliminate empty film voids. Re-merging or dragging them manually is fully supported at any time.
        </div>
      </div>
    </div>
  );
};
