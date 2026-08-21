import React, { useState } from 'react';
import {
  Search,
  Plus,
  Edit2,
  Trash2,
  Copy,
  Check,
  X,
  Type,
  Palette,
  Sparkles,
  Shield,
  Layers,
  Info,
  Image as ImageIcon,
  FileImage,
  CheckCircle2,
  UploadCloud,
  Loader2,
  Cloud,
} from 'lucide-react';
import { DesignPreset } from '../types';
import { registerCustomFont } from '../utils/fontLoader';
import { generateSampleNumberAssets } from '../utils/numberAssetHelper';
import { generateSampleLetterAssets } from '../utils/letterAssetHelper';
import { trimTransparentImageCanvas } from '../utils/imageTrimmer';
import { savePresetToD1, deletePresetFromD1, saveLocalPresets, uploadAssetToR2 } from '../utils/d1Api';

interface DatabaseManagerProps {
  presets: DesignPreset[];
  setPresets: React.Dispatch<React.SetStateAction<DesignPreset[]>>;
  onSelectPresetForTesting?: (presetCode: string) => void;
}

export const DatabaseManager: React.FC<DatabaseManagerProps> = ({
  presets,
  setPresets,
  onSelectPresetForTesting,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedLeague, setSelectedLeague] = useState<string>('All');
  const [editingPreset, setEditingPreset] = useState<DesignPreset | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [uploadFontStatus, setUploadFontStatus] = useState<string>('');
  const [statusMessage, setStatusMessage] = useState<string>('');
  const [isSavingCloud, setIsSavingCloud] = useState(false);
  const [uploadingAssetKey, setUploadingAssetKey] = useState<string | null>(null);

  // League filters
  const leagues = ['All', 'La Liga', 'Premier League', 'Serie A', 'Bundesliga', 'Ligue 1', 'MLS', 'International', 'Retro', 'Custom'];

  const filteredPresets = presets.filter((p) => {
    const matchesSearch =
      p.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.teamName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      p.league.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesLeague = selectedLeague === 'All' || p.league === selectedLeague;
    return matchesSearch && matchesLeague;
  });

  const handleCreateNew = () => {
    const newPreset: DesignPreset = {
      id: `preset-custom-${Date.now()}`,
      code: `SJ-CUSTOM-${Math.floor(100 + Math.random() * 900)}`,
      teamName: 'Custom Team',
      league: 'Custom',
      season: '2024-25',
      fontFamily: 'Oswald',
      textColor: '#FFFFFF',
      strokeColor: '#000000',
      strokeWidth: 4,
      textEffect: 'none',
      numberStyle: {
        fontFamily: 'Oswald',
        fillColor: '#FFFFFF',
        strokeColor: '#000000',
        strokeWidth: 6,
        badgeIcon: 'crest',
      },
      defaultNameWidthInches: 12.0,
      defaultNameHeightInches: 2.2,
      defaultNumberHeightInches: 9.5,
      notes: 'New custom design specification preset.',
    };
    setEditingPreset(newPreset);
    setIsCreating(true);
  };

  const handleDuplicate = async (preset: DesignPreset) => {
    const duplicated: DesignPreset = {
      ...preset,
      id: `preset-copy-${Date.now()}`,
      code: `${preset.code}-COPY`,
      teamName: `${preset.teamName} (Copy)`,
      updatedAt: new Date().toISOString(),
    };

    // Immediate local state update
    setPresets((prev) => {
      const updated = [duplicated, ...prev];
      saveLocalPresets(updated);
      return updated;
    });

    setStatusMessage(`Duplicated preset "${duplicated.code}" created successfully!`);
    setTimeout(() => setStatusMessage(''), 4000);

    // Sync to Cloudflare D1
    await savePresetToD1(duplicated);
  };

  const handleDelete = async (id: string, code: string) => {
    if (window.confirm(`Are you sure you want to delete preset "${code}" from cloud and local database?`)) {
      // Immediate local state update
      setPresets((prev) => {
        const updated = prev.filter((p) => p.id !== id);
        saveLocalPresets(updated);
        return updated;
      });

      setStatusMessage(`Preset "${code}" removed.`);
      setTimeout(() => setStatusMessage(''), 4000);

      // Sync deletion to Cloudflare D1
      await deletePresetFromD1(id);
    }
  };

  const handleSavePreset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPreset) return;

    setIsSavingCloud(true);
    const presetToSave: DesignPreset = {
      ...editingPreset,
      code: (editingPreset.code || '').trim().toUpperCase(),
      updatedAt: new Date().toISOString(),
    };

    // 1. Immediate local state update so UI is ultra-responsive
    setPresets((prevPresets) => {
      const existingIdx = prevPresets.findIndex(
        (p) => p.id === presetToSave.id || p.code.toUpperCase() === presetToSave.code.toUpperCase()
      );
      let updated: DesignPreset[];
      if (existingIdx >= 0) {
        updated = [...prevPresets];
        updated[existingIdx] = presetToSave;
      } else {
        updated = [presetToSave, ...prevPresets];
      }
      saveLocalPresets(updated);
      return updated;
    });

    const savedCode = presetToSave.code;

    // 2. Persist to Cloudflare D1 database (with all R2 asset URLs included)
    try {
      const result = await savePresetToD1(presetToSave);
      if (result.success && result.preset) {
        const finalP = result.preset;
        setPresets((prev) => {
          const idx = prev.findIndex((p) => p.code.toUpperCase() === finalP.code.toUpperCase());
          if (idx >= 0) {
            const next = [...prev];
            next[idx] = finalP;
            return next;
          }
          return [finalP, ...prev];
        });
        setStatusMessage(`Preset "${savedCode}" successfully saved to Cloudflare D1 Database & R2!`);
      } else {
        setStatusMessage(`Preset "${savedCode}" saved locally (D1 sync notice: ${result.error})`);
      }
    } catch (err) {
      console.warn('D1 sync notice:', err);
      setStatusMessage(`Preset "${savedCode}" saved locally.`);
    } finally {
      setIsSavingCloud(false);
      setEditingPreset(null);
      setIsCreating(false);
      setTimeout(() => setStatusMessage(''), 4500);
    }
  };

  const handleCustomFontUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editingPreset) return;

    try {
      setUploadFontStatus('Uploading font to Cloudflare R2...');
      const fontName = file.name.replace(/\.[^/.]+$/, '').trim();
      const sanitizedCode = (editingPreset.code || 'custom').replace(/[^a-zA-Z0-9_-]/g, '_');
      const r2Key = `fonts/${sanitizedCode}_${Date.now()}_${file.name}`;

      const reader = new FileReader();
      reader.onload = async (event) => {
        const fontDataUrl = event.target?.result as string;

        // Register in DOM immediately
        const registeredName = await registerCustomFont(fontName, fontDataUrl);

        // Upload to Cloudflare R2 bucket (env.MY_BUCKET)
        const uploadRes = await uploadAssetToR2(r2Key, fontDataUrl, file.type || 'font/ttf');
        const finalUrl = uploadRes.url || fontDataUrl;

        setEditingPreset({
          ...editingPreset,
          fontFamily: registeredName,
          customFontDataUrl: finalUrl,
        });

        setUploadFontStatus(`Font "${file.name}" uploaded to Cloudflare R2 successfully!`);
      };
      reader.readAsDataURL(file);
    } catch (err) {
      setUploadFontStatus('Failed to upload font file.');
    }
  };

  const handleNumberAssetUpload = async (digit: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editingPreset) return;

    setUploadingAssetKey(`num-${digit}`);
    const reader = new FileReader();
    reader.onload = async (event) => {
      const dataUrl = event.target?.result as string;
      const trimmed = await trimTransparentImageCanvas(dataUrl);

      // Upload trimmed PNG to Cloudflare R2 bucket
      const sanitizedCode = (editingPreset.code || 'custom').replace(/[^a-zA-Z0-9_-]/g, '_');
      const r2Key = `numbers/${sanitizedCode}_digit_${digit}_${Date.now()}.png`;

      const uploadRes = await uploadAssetToR2(r2Key, trimmed.dataUrl, 'image/png');
      const finalAssetUrl = uploadRes.url || trimmed.dataUrl;

      setEditingPreset((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          numberAssets: {
            ...(prev.numberAssets || {}),
            [digit]: finalAssetUrl,
          },
        };
      });
      setUploadingAssetKey(null);
    };
    reader.readAsDataURL(file);
  };

  const handleClearNumberAsset = (digit: string) => {
    if (!editingPreset) return;
    setEditingPreset((prev) => {
      if (!prev) return prev;
      const updated = { ...(prev.numberAssets || {}) };
      delete updated[digit];
      return {
        ...prev,
        numberAssets: updated,
      };
    });
  };

  const handleGenerateSampleNumberAssets = () => {
    if (!editingPreset) return;
    const sampleAssets = generateSampleNumberAssets(
      editingPreset.fontFamily,
      editingPreset.textColor,
      editingPreset.strokeColor
    );
    setEditingPreset((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        numberAssets: sampleAssets,
      };
    });
  };

  const handleLetterAssetUpload = async (letter: string, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editingPreset) return;

    setUploadingAssetKey(`let-${letter}`);
    const reader = new FileReader();
    reader.onload = async (event) => {
      const dataUrl = event.target?.result as string;
      const trimmed = await trimTransparentImageCanvas(dataUrl);

      // Upload trimmed PNG to Cloudflare R2 bucket
      const sanitizedCode = (editingPreset.code || 'custom').replace(/[^a-zA-Z0-9_-]/g, '_');
      const r2Key = `letters/${sanitizedCode}_letter_${letter}_${Date.now()}.png`;

      const uploadRes = await uploadAssetToR2(r2Key, trimmed.dataUrl, 'image/png');
      const finalAssetUrl = uploadRes.url || trimmed.dataUrl;

      setEditingPreset((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          letterAssets: {
            ...(prev.letterAssets || {}),
            [letter]: finalAssetUrl,
          },
        };
      });
      setUploadingAssetKey(null);
    };
    reader.readAsDataURL(file);
  };

  const handleClearLetterAsset = (letter: string) => {
    if (!editingPreset) return;
    setEditingPreset((prev) => {
      if (!prev) return prev;
      const updated = { ...(prev.letterAssets || {}) };
      delete updated[letter];
      return {
        ...prev,
        letterAssets: updated,
      };
    });
  };

  const handleGenerateSampleLetterAssets = () => {
    if (!editingPreset) return;
    const sampleAssets = generateSampleLetterAssets(
      editingPreset.fontFamily,
      editingPreset.textColor,
      editingPreset.strokeColor
    );
    setEditingPreset((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        letterAssets: sampleAssets,
      };
    });
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Top Header Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold tracking-tighter text-white uppercase flex items-center space-x-2">
            <Layers className="w-6 h-6 text-blue-500" />
            <span>Design & Font Management Database</span>
          </h1>
          <p className="text-xs text-zinc-400 font-mono mt-1">
            Store, map, and edit team fonts, colors, strokes, and vector styles for football clubs & custom design codes.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={handleCreateNew}
            className="flex items-center space-x-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white font-bold uppercase tracking-wider text-xs rounded shadow-lg shadow-blue-900/20 transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>+ Add New Design Code</span>
          </button>
        </div>
      </div>

      {/* Status Feedback Notification */}
      {statusMessage && (
        <div className="mb-6 p-3 bg-blue-950/60 border border-blue-500/40 rounded-lg flex items-center space-x-3 text-blue-300 text-xs font-mono shadow-lg transition-all">
          <CheckCircle2 className="w-4 h-4 text-blue-400 shrink-0" />
          <span>{statusMessage}</span>
        </div>
      )}

      {/* Filter and Search Bar */}
      <div className="bg-zinc-900/50 p-4 rounded-xl border border-zinc-800 mb-8 flex flex-col md:flex-row gap-4 justify-between items-center">
        <div className="relative w-full md:w-96">
          <Search className="w-4 h-4 absolute left-3.5 top-3 text-zinc-500" />
          <input
            type="text"
            placeholder="Search Design Code, Team, or Season..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-zinc-950 text-white pl-10 pr-4 py-2 rounded-lg border border-zinc-800 focus:border-blue-500 focus:outline-none text-xs font-mono placeholder:text-zinc-600"
          />
        </div>

        <div className="flex items-center space-x-2 overflow-x-auto w-full md:w-auto pb-1 md:pb-0">
          <span className="text-[10px] text-zinc-500 font-mono uppercase whitespace-nowrap">League:</span>
          {leagues.map((lg) => (
            <button
              key={lg}
              onClick={() => setSelectedLeague(lg)}
              className={`px-3 py-1 rounded text-xs font-bold uppercase tracking-wider whitespace-nowrap transition-all ${
                selectedLeague === lg
                  ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30'
                  : 'bg-zinc-950 text-zinc-400 border border-zinc-800 hover:text-white'
              }`}
            >
              {lg}
            </button>
          ))}
        </div>
      </div>

      {/* Presets Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {filteredPresets.map((preset) => (
          <div
            key={preset.id}
            className="bg-zinc-900/60 rounded-xl border border-zinc-800 p-5 hover:border-zinc-700 transition-all flex flex-col justify-between group shadow-lg"
          >
            <div>
              {/* Top Code Badge & League */}
              <div className="flex items-center justify-between mb-3">
                <span className="font-mono font-bold text-xs px-2.5 py-1 bg-blue-600/10 text-blue-400 border border-blue-500/30 rounded">
                  {preset.code}
                </span>
                <span className="text-[10px] font-mono uppercase text-zinc-500 bg-zinc-950 px-2 py-0.5 rounded border border-zinc-800">
                  {preset.league}
                </span>
              </div>

              <h3 className="font-bold text-white text-base tracking-wide uppercase mb-1">{preset.teamName}</h3>
              <p className="text-xs text-zinc-400 font-mono mb-4">{preset.season} • {preset.fontFamily}</p>

              {/* Live Preview Box */}
              <div className="bg-zinc-950 p-4 rounded-lg border border-zinc-800 mb-4 flex flex-col items-center justify-center min-h-[110px] relative overflow-hidden">
                <div
                  className="text-center font-black tracking-wide mb-1"
                  style={{
                    fontFamily: preset.fontFamily,
                    color: preset.textColor,
                    WebkitTextStroke: `${preset.strokeWidth > 0 ? preset.strokeWidth / 2 : 0}px ${preset.strokeColor}`,
                    fontSize: '20px',
                    letterSpacing: `${preset.letterSpacing || 2}px`,
                  }}
                >
                  RONALDO
                </div>

                <div
                  className="text-center font-black"
                  style={{
                    fontFamily: preset.numberStyle?.fontFamily || preset.fontFamily,
                    color: preset.numberStyle?.fillColor || preset.textColor,
                    WebkitTextStroke: `${(preset.numberStyle?.strokeWidth || 4) / 2}px ${preset.numberStyle?.strokeColor || preset.strokeColor}`,
                    fontSize: '44px',
                    lineHeight: '1',
                  }}
                >
                  7
                </div>
              </div>

              {/* Specs Summary */}
              <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-zinc-400 border-t border-zinc-800/80 pt-3 mb-4">
                <div className="flex items-center space-x-1.5">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: preset.textColor }} />
                  <span>Text: {preset.textColor}</span>
                </div>
                <div className="flex items-center space-x-1.5">
                  <FileImage className="w-3.5 h-3.5 text-blue-400" />
                  <span>
                    {preset.numberAssets && Object.keys(preset.numberAssets).length > 0
                      ? `${Object.keys(preset.numberAssets).length} PNG Assets`
                      : 'Vector Font'}
                  </span>
                </div>
              </div>
            </div>

            {/* Actions Bar */}
            <div className="flex items-center justify-between pt-3 border-t border-zinc-800">
              <button
                onClick={() => {
                  setEditingPreset(preset);
                  setIsCreating(false);
                }}
                className="flex items-center space-x-1.5 text-xs font-bold uppercase tracking-wider text-blue-400 hover:text-blue-300"
              >
                <Edit2 className="w-3.5 h-3.5" />
                <span>Edit Specs</span>
              </button>

              <div className="flex items-center space-x-2">
                <button
                  onClick={() => handleDuplicate(preset)}
                  className="p-1.5 text-zinc-400 hover:text-white rounded hover:bg-zinc-800"
                  title="Duplicate Preset"
                >
                  <Copy className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => handleDelete(preset.id, preset.code)}
                  className="p-1.5 text-zinc-500 hover:text-red-400 rounded hover:bg-zinc-800"
                  title="Delete Preset"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Edit / Create Preset Modal */}
      {editingPreset && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl max-w-2xl w-full p-6 shadow-2xl my-8">
            <div className="flex items-center justify-between pb-4 border-b border-zinc-800 mb-6">
              <h2 className="text-base font-bold text-white uppercase tracking-wider flex items-center space-x-2">
                <Palette className="w-5 h-5 text-blue-500" />
                <span>{isCreating ? 'Create New Design Preset' : `Edit Preset: ${editingPreset.code}`}</span>
              </h2>
              <button
                onClick={() => {
                  setEditingPreset(null);
                  setIsCreating(false);
                }}
                className="text-zinc-500 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSavePreset} className="space-y-4">
              {/* Top Form Fields */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                    Design Code (Matching Key)
                  </label>
                  <input
                    type="text"
                    required
                    value={editingPreset.code}
                    onChange={(e) => setEditingPreset({ ...editingPreset, code: e.target.value.toUpperCase() })}
                    className="w-full bg-zinc-950 text-white px-3 py-2 rounded border border-zinc-800 focus:border-blue-500 text-xs font-mono"
                    placeholder="e.g. SJ-Y5EMT or BARCELONA 2016-17"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                    Team Name
                  </label>
                  <input
                    type="text"
                    required
                    value={editingPreset.teamName}
                    onChange={(e) => setEditingPreset({ ...editingPreset, teamName: e.target.value })}
                    className="w-full bg-zinc-950 text-white px-3 py-2 rounded border border-zinc-800 focus:border-blue-500 text-xs font-mono"
                    placeholder="e.g. AC Milan"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                    League / Category
                  </label>
                  <select
                    value={editingPreset.league}
                    onChange={(e) => setEditingPreset({ ...editingPreset, league: e.target.value })}
                    className="w-full bg-zinc-950 text-white px-3 py-2 rounded border border-zinc-800 focus:border-blue-500 text-xs font-mono"
                  >
                    {leagues.filter((l) => l !== 'All').map((lg) => (
                      <option key={lg} value={lg}>
                        {lg}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                    Season / Era
                  </label>
                  <input
                    type="text"
                    value={editingPreset.season}
                    onChange={(e) => setEditingPreset({ ...editingPreset, season: e.target.value })}
                    className="w-full bg-zinc-950 text-white px-3 py-2 rounded border border-zinc-800 focus:border-blue-500 text-xs font-mono"
                    placeholder="e.g. 2024-25 or Classic"
                  />
                </div>
              </div>

              {/* Font Selector & Custom Font Upload */}
              <div className="bg-zinc-950 p-4 rounded-lg border border-zinc-800">
                <h3 className="text-[10px] font-bold text-blue-400 uppercase tracking-wider mb-3 flex items-center space-x-1.5">
                  <Type className="w-4 h-4" />
                  <span>Font Specification & Cloudflare R2 Upload</span>
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                      Font Family
                    </label>
                    <input
                      type="text"
                      value={editingPreset.fontFamily}
                      onChange={(e) => setEditingPreset({ ...editingPreset, fontFamily: e.target.value })}
                      className="w-full bg-zinc-900 text-white px-3 py-2 rounded border border-zinc-800 focus:border-blue-500 text-xs font-mono"
                      placeholder="e.g. Oswald, Bebas Neue, Impact"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                      Upload Custom Font (.ttf / .woff / .otf) to Cloudflare R2
                    </label>
                    <input
                      type="file"
                      accept=".ttf,.woff,.woff2,.otf"
                      onChange={handleCustomFontUpload}
                      className="text-xs text-zinc-400 file:mr-2 file:py-1 file:px-2.5 file:rounded file:border-0 file:text-[10px] file:font-bold file:uppercase file:bg-blue-600/10 file:text-blue-400 hover:file:bg-blue-600/20"
                    />
                  </div>
                </div>
                {uploadFontStatus && (
                  <p className="text-[10px] font-mono text-emerald-400 mt-2 flex items-center space-x-1">
                    <Cloud className="w-3.5 h-3.5" />
                    <span>{uploadFontStatus}</span>
                  </p>
                )}
              </div>

              {/* Number PNG Asset Grid (0-9) */}
              <div className="bg-zinc-950 p-4 rounded-lg border border-zinc-800 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800 pb-3">
                  <div>
                    <h3 className="text-xs font-bold text-blue-400 uppercase tracking-wider flex items-center space-x-2">
                      <FileImage className="w-4 h-4" />
                      <span>Upload Number PNG Assets (0-9) to Cloudflare R2</span>
                    </h3>
                    <p className="text-[10px] text-zinc-500 font-mono">
                      High-res transparent PNGs are stored in R2 (env.MY_BUCKET) and served globally.
                    </p>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      type="button"
                      onClick={handleGenerateSampleNumberAssets}
                      className="px-2.5 py-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-[10px] font-bold uppercase tracking-wider rounded border border-zinc-800 flex items-center space-x-1"
                      title="Auto-generate matching sample vector number graphics for digits 0-9"
                    >
                      <Sparkles className="w-3 h-3 text-blue-400" />
                      <span>Sample 0-9 Set</span>
                    </button>
                    {editingPreset.numberAssets && Object.keys(editingPreset.numberAssets).length > 0 && (
                      <button
                        type="button"
                        onClick={() => setEditingPreset({ ...editingPreset, numberAssets: {} })}
                        className="px-2 py-1 bg-zinc-900 hover:bg-red-950/40 text-zinc-400 hover:text-red-400 text-[10px] font-bold uppercase rounded border border-zinc-800"
                      >
                        Clear All
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-5 sm:grid-cols-10 gap-2 pt-1">
                  {['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => {
                    const hasAsset = editingPreset.numberAssets && editingPreset.numberAssets[digit];
                    const isUploadingThis = uploadingAssetKey === `num-${digit}`;
                    return (
                      <div
                        key={digit}
                        className={`relative group bg-zinc-900 border ${
                          hasAsset ? 'border-blue-500/50' : 'border-zinc-800 hover:border-zinc-700'
                        } rounded p-1.5 flex flex-col items-center justify-between min-h-[90px] transition-all`}
                      >
                        <span className="text-[10px] font-mono font-bold text-zinc-400 bg-zinc-950 px-1.5 py-0.2 rounded border border-zinc-800">
                          {digit}
                        </span>

                        <div className="my-1 flex items-center justify-center h-9 w-full">
                          {isUploadingThis ? (
                            <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
                          ) : hasAsset ? (
                            <img
                              src={hasAsset}
                              alt={`Digit ${digit}`}
                              className="max-h-9 max-w-full object-contain filter drop-shadow"
                            />
                          ) : (
                            <span className="text-zinc-600 font-mono text-xs font-bold">{digit}</span>
                          )}
                        </div>

                        <div className="flex items-center space-x-1 w-full justify-center">
                          <label className="cursor-pointer text-[9px] font-bold uppercase bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 px-1.5 py-0.5 rounded border border-blue-500/30 transition-all text-center w-full truncate">
                            {hasAsset ? 'Change' : '+ R2'}
                            <input
                              type="file"
                              accept="image/png,image/svg+xml,image/webp"
                              onChange={(e) => handleNumberAssetUpload(digit, e)}
                              className="hidden"
                            />
                          </label>
                          {hasAsset && (
                            <button
                              type="button"
                              onClick={() => handleClearNumberAsset(digit)}
                              className="text-zinc-500 hover:text-red-400 p-0.5"
                              title="Remove graphic"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Letter PNG Asset Grid (A-Z) */}
              <div className="bg-zinc-950 p-4 rounded-lg border border-zinc-800 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800 pb-3">
                  <div>
                    <h3 className="text-xs font-bold text-blue-400 uppercase tracking-wider flex items-center space-x-2">
                      <ImageIcon className="w-4 h-4" />
                      <span>Upload Letter PNG Assets (A-Z) to Cloudflare R2</span>
                    </h3>
                    <p className="text-[10px] text-zinc-500 font-mono">
                      Optional custom PNG cuts for each letter A-Z uploaded to R2.
                    </p>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button
                      type="button"
                      onClick={handleGenerateSampleLetterAssets}
                      className="px-2.5 py-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-[10px] font-bold uppercase tracking-wider rounded border border-zinc-800 flex items-center space-x-1"
                      title="Auto-generate sample A-Z vector letter graphics"
                    >
                      <Sparkles className="w-3 h-3 text-blue-400" />
                      <span>Sample A-Z Set</span>
                    </button>
                    {editingPreset.letterAssets && Object.keys(editingPreset.letterAssets).length > 0 && (
                      <button
                        type="button"
                        onClick={() => setEditingPreset({ ...editingPreset, letterAssets: {} })}
                        className="px-2 py-1 bg-zinc-900 hover:bg-red-950/40 text-zinc-400 hover:text-red-400 text-[10px] font-bold uppercase rounded border border-zinc-800"
                      >
                        Clear All
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-6 sm:grid-cols-13 gap-1.5 max-h-48 overflow-y-auto p-1 bg-zinc-900/40 rounded border border-zinc-800/80">
                  {'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((letter) => {
                    const hasAsset = editingPreset.letterAssets && editingPreset.letterAssets[letter];
                    const isUploadingThis = uploadingAssetKey === `let-${letter}`;
                    return (
                      <div
                        key={letter}
                        className={`relative group bg-zinc-900 border ${
                          hasAsset ? 'border-blue-500/50' : 'border-zinc-800 hover:border-zinc-700'
                        } rounded p-1 flex flex-col items-center justify-between min-h-[75px] transition-all`}
                      >
                        <span className="text-[9px] font-mono font-bold text-zinc-400 bg-zinc-950 px-1 rounded border border-zinc-800">
                          {letter}
                        </span>

                        <div className="my-0.5 flex items-center justify-center h-6 w-full">
                          {isUploadingThis ? (
                            <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />
                          ) : hasAsset ? (
                            <img
                              src={hasAsset}
                              alt={`Letter ${letter}`}
                              className="max-h-6 max-w-full object-contain filter drop-shadow"
                            />
                          ) : (
                            <span className="text-zinc-600 font-mono text-[10px] font-bold">{letter}</span>
                          )}
                        </div>

                        <div className="flex items-center space-x-1 w-full justify-center">
                          <label className="cursor-pointer text-[8px] font-bold uppercase bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 px-1 py-0.5 rounded border border-blue-500/30 transition-all text-center w-full truncate">
                            {hasAsset ? 'Edit' : '+R2'}
                            <input
                              type="file"
                              accept="image/png,image/svg+xml,image/webp"
                              onChange={(e) => handleLetterAssetUpload(letter, e)}
                              className="hidden"
                            />
                          </label>
                          {hasAsset && (
                            <button
                              type="button"
                              onClick={() => handleClearLetterAsset(letter)}
                              className="text-zinc-500 hover:text-red-400 p-0.5"
                            >
                              <X className="w-2.5 h-2.5" />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Color & Stroke Specifications */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 bg-zinc-950 p-4 rounded-lg border border-zinc-800">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                    Text Fill Color
                  </label>
                  <div className="flex items-center space-x-2">
                    <input
                      type="color"
                      value={editingPreset.textColor}
                      onChange={(e) => setEditingPreset({ ...editingPreset, textColor: e.target.value })}
                      className="w-8 h-8 rounded border border-zinc-700 bg-transparent cursor-pointer"
                    />
                    <input
                      type="text"
                      value={editingPreset.textColor}
                      onChange={(e) => setEditingPreset({ ...editingPreset, textColor: e.target.value })}
                      className="w-full bg-zinc-900 text-white px-2 py-1.5 rounded border border-zinc-800 text-xs font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                    Outer Stroke Color
                  </label>
                  <div className="flex items-center space-x-2">
                    <input
                      type="color"
                      value={editingPreset.strokeColor}
                      onChange={(e) => setEditingPreset({ ...editingPreset, strokeColor: e.target.value })}
                      className="w-8 h-8 rounded border border-zinc-700 bg-transparent cursor-pointer"
                    />
                    <input
                      type="text"
                      value={editingPreset.strokeColor}
                      onChange={(e) => setEditingPreset({ ...editingPreset, strokeColor: e.target.value })}
                      className="w-full bg-zinc-900 text-white px-2 py-1.5 rounded border border-zinc-800 text-xs font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                    Outer Stroke (PX)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="20"
                    value={editingPreset.strokeWidth}
                    onChange={(e) => setEditingPreset({ ...editingPreset, strokeWidth: parseInt(e.target.value) || 0 })}
                    className="w-full bg-zinc-900 text-white px-3 py-1.5 rounded border border-zinc-800 text-xs font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                    Text Effect
                  </label>
                  <select
                    value={editingPreset.textEffect}
                    onChange={(e) =>
                      setEditingPreset({
                        ...editingPreset,
                        textEffect: e.target.value as any,
                      })
                    }
                    className="w-full bg-zinc-900 text-white px-3 py-1.5 rounded border border-zinc-800 text-xs font-mono"
                  >
                    <option value="none">Flat (Standard)</option>
                    <option value="arc">Curved Arc</option>
                    <option value="italic">Italic Slant</option>
                    <option value="drop-shadow">Drop Shadow</option>
                  </select>
                </div>

                {editingPreset.textEffect === 'arc' && (
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-blue-400 mb-1">
                      Arc Curve Angle: <strong>{editingPreset.arcAmount || 15}°</strong>
                    </label>
                    <input
                      type="range"
                      min="5"
                      max="45"
                      value={editingPreset.arcAmount || 15}
                      onChange={(e) =>
                        setEditingPreset({ ...editingPreset, arcAmount: parseInt(e.target.value) || 15 })
                      }
                      className="w-full accent-blue-500 cursor-pointer my-1"
                    />
                  </div>
                )}
              </div>

              {/* Default Dimensions */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 bg-zinc-950 p-4 rounded-lg border border-zinc-800">
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                    Name Width (Inches)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={editingPreset.defaultNameWidthInches}
                    onChange={(e) =>
                      setEditingPreset({ ...editingPreset, defaultNameWidthInches: parseFloat(e.target.value) || 12.0 })
                    }
                    className="w-full bg-zinc-950 text-white px-3 py-2 rounded border border-zinc-800 focus:border-blue-500 text-xs font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                    Name Height (Inches)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={editingPreset.defaultNameHeightInches}
                    onChange={(e) =>
                      setEditingPreset({ ...editingPreset, defaultNameHeightInches: parseFloat(e.target.value) || 2.2 })
                    }
                    className="w-full bg-zinc-950 text-white px-3 py-2 rounded border border-zinc-800 focus:border-blue-500 text-xs font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                    Number Height (Inches)
                  </label>
                  <input
                    type="number"
                    step="0.1"
                    value={editingPreset.defaultNumberHeightInches}
                    onChange={(e) =>
                      setEditingPreset({ ...editingPreset, defaultNumberHeightInches: parseFloat(e.target.value) || 9.5 })
                    }
                    className="w-full bg-zinc-950 text-white px-3 py-2 rounded border border-zinc-800 focus:border-blue-500 text-xs font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                    Letter Spacing (Kerning/PX)
                  </label>
                  <input
                    type="number"
                    step="0.5"
                    value={typeof editingPreset.letterSpacing === 'number' ? editingPreset.letterSpacing : 3}
                    onChange={(e) =>
                      setEditingPreset({ ...editingPreset, letterSpacing: parseFloat(e.target.value) || 0 })
                    }
                    className="w-full bg-zinc-950 text-white px-3 py-2 rounded border border-zinc-800 focus:border-blue-500 text-xs font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-zinc-400 mb-1">
                  Notes / Description
                </label>
                <input
                  type="text"
                  value={editingPreset.notes || ''}
                  onChange={(e) => setEditingPreset({ ...editingPreset, notes: e.target.value })}
                  className="w-full bg-zinc-950 text-white px-3 py-2 rounded border border-zinc-800 focus:border-blue-500 text-xs font-mono placeholder:text-zinc-600"
                  placeholder="e.g. Official club font specification"
                />
              </div>

              <div className="flex items-center justify-end space-x-3 pt-4 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => {
                    setEditingPreset(null);
                    setIsCreating(false);
                  }}
                  className="px-4 py-2 text-zinc-400 hover:text-white text-xs font-bold uppercase tracking-wider"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingCloud}
                  className="px-6 py-2 bg-blue-600 text-white font-bold uppercase tracking-wider rounded shadow-lg shadow-blue-900/20 hover:bg-blue-500 text-xs flex items-center space-x-2 disabled:opacity-50"
                >
                  {isSavingCloud ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Saving to Cloudflare D1 & R2...</span>
                    </>
                  ) : (
                    <>
                      <UploadCloud className="w-3.5 h-3.5" />
                      <span>Save Preset Specification</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
