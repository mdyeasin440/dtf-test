import React, { useState, useEffect, useMemo } from 'react';
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
  Database,
  RefreshCw,
  AlertCircle,
  Folder,
  FolderUp,
  Files,
  CheckCheck,
  Upload,
} from 'lucide-react';
import { DesignPreset } from '../types';
import { registerCustomFont } from '../utils/fontLoader';
import { generateSampleNumberAssets } from '../utils/numberAssetHelper';
import { generateSampleLetterAssets } from '../utils/letterAssetHelper';
import { trimTransparentImageCanvas } from '../utils/imageTrimmer';
import {
  savePresetToD1,
  deletePresetFromD1,
  saveLocalPresets,
  uploadAssetToR2,
  fetchPresetsFromD1,
  checkCloudflareStatus,
} from '../utils/d1Api';

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
  const [isRefreshingCloud, setIsRefreshingCloud] = useState(false);
  const [bulkUploadProgress, setBulkUploadProgress] = useState<{
    isActive: boolean;
    totalFiles: number;
    currentFileIndex: number;
    currentFileName: string;
    matchedNumbers: number;
    matchedLetters: number;
    unmatchedFiles: string[];
    status: 'idle' | 'processing' | 'done' | 'error';
    message: string;
  }>({
    isActive: false,
    totalFiles: 0,
    currentFileIndex: 0,
    currentFileName: '',
    matchedNumbers: 0,
    matchedLetters: 0,
    unmatchedFiles: [],
    status: 'idle',
    message: '',
  });
  const [cloudStatus, setCloudStatus] = useState<{
    connected: boolean;
    database: string;
    storage: string;
    checked: boolean;
  }>({
    connected: false,
    database: 'Checking...',
    storage: 'Checking...',
    checked: false,
  });

  useEffect(() => {
    checkCloudflareStatus().then((res) => {
      setCloudStatus({
        connected: res.connected,
        database: res.database,
        storage: res.storage,
        checked: true,
      });
    });
  }, []);

  const handleRefreshFromCloud = async () => {
    setIsRefreshingCloud(true);
    setStatusMessage('Syncing latest presets from Cloudflare D1 Database...');
    try {
      const latest = await fetchPresetsFromD1();
      setPresets(latest);
      setStatusMessage(`Synced ${latest.length} presets from Cloudflare D1 Database!`);
    } catch (err: any) {
      setStatusMessage('Sync notice: using cached presets');
    } finally {
      setIsRefreshingCloud(false);
      setTimeout(() => setStatusMessage(''), 4000);
    }
  };

  // League filters
  const leagues = ['All', 'La Liga', 'Premier League', 'Serie A', 'Bundesliga', 'Ligue 1', 'MLS', 'International', 'Retro', 'Custom'];

  const filteredPresets = useMemo(() => {
    return presets
      .filter((p) => {
        const matchesSearch =
          p.code.toLowerCase().includes(searchTerm.toLowerCase()) ||
          p.teamName.toLowerCase().includes(searchTerm.toLowerCase()) ||
          p.league.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesLeague = selectedLeague === 'All' || p.league === selectedLeague;
        return matchesSearch && matchesLeague;
      })
      .sort((a, b) => {
        const aCustom = a.league === 'Custom' || a.isCustom || (a.code && a.code.startsWith('SJ-CUSTOM'));
        const bCustom = b.league === 'Custom' || b.isCustom || (b.code && b.code.startsWith('SJ-CUSTOM'));
        if (aCustom && !bCustom) return -1;
        if (!aCustom && bCustom) return 1;

        const aTime = a.updatedAt ? new Date(a.updatedAt).getTime() : 0;
        const bTime = b.updatedAt ? new Date(b.updatedAt).getTime() : 0;
        return bTime - aTime;
      });
  }, [presets, searchTerm, selectedLeague]);

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
      curvedTextArch: false, // Curved / Arched text toggle OFF by default
      enableArcPath: false,
      arcCurvature: 24,
      isCustom: true,
      updatedAt: new Date().toISOString(),
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
      const cleanCode = (code || '').trim().toUpperCase();

      // Immediate local state update across id & code
      setPresets((prev) => {
        const updated = prev.filter(
          (p) => p.id !== id && (!p.code || p.code.trim().toUpperCase() !== cleanCode)
        );
        saveLocalPresets(updated);
        return updated;
      });

      if (editingPreset && (editingPreset.id === id || editingPreset.code?.toUpperCase() === cleanCode)) {
        setEditingPreset(null);
        setIsCreating(false);
      }

      setStatusMessage(`Preset "${code}" permanently deleted from cloud & local database.`);
      setTimeout(() => setStatusMessage(''), 4500);

      // Sync deletion to Cloudflare D1 & permanent delete registry
      await deletePresetFromD1(id, code);
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

  /**
   * Helper to parse filenames into Number digits (0-9) or Letter characters (A-Z)
   */
  const parseAssetFromFileName = (
    filename: string,
    targetScope: 'all' | 'numbers' | 'letters' = 'all'
  ): { type: 'number' | 'letter' | null; key: string } => {
    const baseName = filename.replace(/\.[^/.]+$/, '').trim();
    if (!baseName) return { type: null, key: '' };

    // 1. Exact single digit 0-9
    if ((targetScope === 'all' || targetScope === 'numbers') && /^[0-9]$/.test(baseName)) {
      return { type: 'number', key: baseName };
    }

    // 2. Exact single letter A-Z
    if ((targetScope === 'all' || targetScope === 'letters') && /^[a-zA-Z]$/.test(baseName)) {
      return { type: 'letter', key: baseName.toUpperCase() };
    }

    // 3. Number prefix patterns: "num_0", "number_1", "digit-2", "n3", "0_white", "0-jersey"
    if (targetScope === 'all' || targetScope === 'numbers') {
      const numPrefixMatch = baseName.match(/^(?:num|number|digit|n|no|d)[_\-\s]?([0-9])$/i);
      if (numPrefixMatch) return { type: 'number', key: numPrefixMatch[1] };

      const numSuffixMatch = baseName.match(/^([0-9])[_\-\s](?:white|black|color|cut|stroke|gold|red|blue|vector|png|layer|jersey|back|front)/i);
      if (numSuffixMatch) return { type: 'number', key: numSuffixMatch[1] };

      const numBoundaryMatch = baseName.match(/^[_\-\s]*([0-9])[_\-\s]*$/);
      if (numBoundaryMatch) return { type: 'number', key: numBoundaryMatch[1] };
    }

    // 4. Letter prefix patterns: "letter_a", "char_B", "let-C", "alpha_d", "name_e", "A_white", "B_font"
    if (targetScope === 'all' || targetScope === 'letters') {
      const letPrefixMatch = baseName.match(/^(?:letter|char|let|alpha|name|font|l)[_\-\s]?([a-zA-Z])$/i);
      if (letPrefixMatch) return { type: 'letter', key: letPrefixMatch[1].toUpperCase() };

      const letSuffixMatch = baseName.match(/^([a-zA-Z])[_\-\s](?:white|black|color|cut|stroke|gold|red|blue|vector|png|layer|jersey|font|char)/i);
      if (letSuffixMatch) return { type: 'letter', key: letSuffixMatch[1].toUpperCase() };

      const letBoundaryMatch = baseName.match(/^[_\-\s]*([a-zA-Z])[_\-\s]*$/);
      if (letBoundaryMatch) return { type: 'letter', key: letBoundaryMatch[1].toUpperCase() };
    }

    // Scope specific fallback
    if (targetScope === 'numbers') {
      const dMatch = baseName.match(/([0-9])/);
      if (dMatch) return { type: 'number', key: dMatch[1] };
    }

    if (targetScope === 'letters') {
      const cMatch = baseName.match(/(?:^|[^a-zA-Z])([a-zA-Z])(?:$|[^a-zA-Z])/);
      if (cMatch) return { type: 'letter', key: cMatch[1].toUpperCase() };
    }

    return { type: null, key: '' };
  };

  /**
   * Bulk uploads and processes entire folders or multi-selected image files
   * Maps digits 0-9 to numberAssets and A-Z to letterAssets with Cloudflare R2 persistence!
   */
  const handleBulkAssetUpload = async (
    files: FileList | File[] | null,
    targetScope: 'all' | 'numbers' | 'letters' = 'all'
  ) => {
    if (!files || files.length === 0 || !editingPreset) return;

    const fileArray = Array.from(files).filter((file) => {
      return (
        file.type.startsWith('image/') ||
        /\.(png|jpe?g|webp|svg)$/i.test(file.name)
      );
    });

    if (fileArray.length === 0) {
      setBulkUploadProgress({
        isActive: true,
        totalFiles: 0,
        currentFileIndex: 0,
        currentFileName: '',
        matchedNumbers: 0,
        matchedLetters: 0,
        unmatchedFiles: [],
        status: 'error',
        message: 'No valid image files (.png, .webp, .svg, .jpg) found.',
      });
      return;
    }

    setBulkUploadProgress({
      isActive: true,
      totalFiles: fileArray.length,
      currentFileIndex: 0,
      currentFileName: fileArray[0].name,
      matchedNumbers: 0,
      matchedLetters: 0,
      unmatchedFiles: [],
      status: 'processing',
      message: `Analyzing and uploading ${fileArray.length} image assets...`,
    });

    const newNumbers: Record<string, string> = { ...(editingPreset.numberAssets || {}) };
    const newLetters: Record<string, string> = { ...(editingPreset.letterAssets || {}) };
    const unmatched: string[] = [];
    let numCount = 0;
    let letCount = 0;

    const sanitizedCode = (editingPreset.code || 'custom').replace(/[^a-zA-Z0-9_-]/g, '_');

    for (let i = 0; i < fileArray.length; i++) {
      const file = fileArray[i];
      const match = parseAssetFromFileName(file.name, targetScope);

      setBulkUploadProgress((prev) => ({
        ...prev,
        currentFileIndex: i + 1,
        currentFileName: file.name,
        message: `Processing (${i + 1}/${fileArray.length}): ${file.name} ${match.type ? `→ [${match.type.toUpperCase()}: ${match.key}]` : ''}`,
      }));

      if (!match.type || !match.key) {
        unmatched.push(file.name);
        continue;
      }

      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target?.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(file);
        });

        // Trim transparent bounding borders for crisp rendering
        const trimmed = await trimTransparentImageCanvas(dataUrl);

        // Upload to Cloudflare R2
        if (match.type === 'number') {
          const digit = match.key;
          const r2Key = `numbers/${sanitizedCode}_digit_${digit}_${Date.now()}.png`;
          const uploadRes = await uploadAssetToR2(r2Key, trimmed.dataUrl, 'image/png');
          const finalUrl = uploadRes.url || trimmed.dataUrl;
          newNumbers[digit] = finalUrl;
          numCount++;
        } else if (match.type === 'letter') {
          const char = match.key;
          const r2Key = `letters/${sanitizedCode}_letter_${char}_${Date.now()}.png`;
          const uploadRes = await uploadAssetToR2(r2Key, trimmed.dataUrl, 'image/png');
          const finalUrl = uploadRes.url || trimmed.dataUrl;
          newLetters[char] = finalUrl;
          letCount++;
        }

        // Live state update so grid fills in real time
        setEditingPreset((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            numberAssets: { ...newNumbers },
            letterAssets: { ...newLetters },
          };
        });

        setBulkUploadProgress((prev) => ({
          ...prev,
          matchedNumbers: numCount,
          matchedLetters: letCount,
        }));
      } catch (err) {
        console.warn(`Failed to process ${file.name}:`, err);
        unmatched.push(file.name);
      }
    }

    setBulkUploadProgress({
      isActive: true,
      totalFiles: fileArray.length,
      currentFileIndex: fileArray.length,
      currentFileName: '',
      matchedNumbers: numCount,
      matchedLetters: letCount,
      unmatchedFiles: unmatched,
      status: 'done',
      message: `Bulk Upload Completed! Successfully added ${numCount} Number(s) & ${letCount} Letter(s).`,
    });
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Top Header Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold tracking-tighter text-white uppercase flex items-center space-x-2">
            <Layers className="w-6 h-6 text-red-500" />
            <span>Design & Font Management Database</span>
          </h1>
          <p className="text-xs text-zinc-400 font-mono mt-1">
            Store, map, and edit team fonts, colors, strokes, and vector styles for football clubs & custom design codes.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          <button
            onClick={handleRefreshFromCloud}
            disabled={isRefreshingCloud}
            title="Sync all presets directly from Cloudflare D1"
            className="flex items-center space-x-2 px-3.5 py-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-700 font-mono text-xs rounded transition-all shadow-md disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-red-400 ${isRefreshingCloud ? 'animate-spin' : ''}`} />
            <span>{isRefreshingCloud ? 'Syncing...' : 'Sync Cloud D1'}</span>
          </button>

          <button
            onClick={handleCreateNew}
            className="flex items-center space-x-2 px-4 py-2 bg-red-600 hover:bg-red-500 text-white font-bold uppercase tracking-wider text-xs rounded shadow-lg shadow-red-900/20 transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>+ Add New Design Code</span>
          </button>
        </div>
      </div>

      {/* Cloud Connectivity Status Bar */}
      <div className="mb-6 p-3 rounded-lg border bg-zinc-950/80 border-zinc-800 flex flex-wrap items-center justify-between gap-3 text-xs font-mono">
        <div className="flex items-center space-x-2.5">
          <span className={`w-2.5 h-2.5 rounded-full ${cloudStatus.connected ? 'bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.8)]' : 'bg-amber-500'}`} />
          <span className="text-zinc-300">
            D1 Database: <strong className="text-white">{cloudStatus.database}</strong>
          </span>
          <span className="text-zinc-600">|</span>
          <span className="text-zinc-300">
            R2 Bucket: <strong className="text-white">{cloudStatus.storage}</strong>
          </span>
        </div>

        <div className="flex items-center space-x-2 text-[11px] text-zinc-400">
          <span>{presets.length} Presets Available</span>
          <span className="text-zinc-600">•</span>
          <span className="text-emerald-400 font-semibold">Multi-Device Cloud Ready</span>
        </div>
      </div>

      {/* Status Feedback Notification */}
      {statusMessage && (
        <div className="mb-6 p-3 bg-red-950/60 border border-red-500/40 rounded-lg flex items-center space-x-3 text-red-300 text-xs font-mono shadow-lg transition-all">
          <CheckCircle2 className="w-4 h-4 text-red-400 shrink-0" />
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
            className="w-full bg-zinc-950 text-white pl-10 pr-4 py-2 rounded-lg border border-zinc-800 focus:border-red-500 focus:outline-none text-xs font-mono placeholder:text-zinc-600"
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
                  ? 'bg-red-600/20 text-red-400 border border-red-500/30'
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
                <div className="flex items-center space-x-1.5">
                  <span className="font-mono font-bold text-xs px-2.5 py-1 bg-red-600/10 text-red-400 border border-red-500/30 rounded">
                    {preset.code}
                  </span>
                  {(preset.curvedTextArch || preset.enableArcPath || preset.textEffect === 'arc') && (
                    <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/40 rounded">
                      ⚡ Arc {preset.arcCurvature || preset.arcAmount || 24}°
                    </span>
                  )}
                </div>
                <span className="text-[10px] font-mono uppercase text-zinc-500 bg-zinc-950 px-2 py-0.5 rounded border border-zinc-800">
                  {preset.league}
                </span>
              </div>

              <h3 className="font-bold text-white text-base tracking-wide uppercase mb-1">{preset.teamName}</h3>
              <p className="text-xs text-zinc-400 font-mono mb-4">{preset.season} • {preset.fontFamily}</p>

              {/* Live Preview Box */}
              <div className="bg-zinc-950 p-4 rounded-lg border border-zinc-800 mb-4 flex flex-col items-center justify-center min-h-[110px] relative overflow-hidden">
                {(preset.curvedTextArch || preset.enableArcPath || preset.textEffect === 'arc') ? (
                  <svg className="w-full h-12 overflow-visible" viewBox="0 0 200 45">
                    <defs>
                      <path
                        id={`card-arc-path-${preset.id}`}
                        d={`M 10,${38 + ((preset.arcCurvature || 24) * 0.25)} Q 100,${12 - ((preset.arcCurvature || 24) * 0.2)} 190,${38 + ((preset.arcCurvature || 24) * 0.25)}`}
                        fill="transparent"
                      />
                    </defs>
                    <text
                      fill={preset.textColor || '#FFFFFF'}
                      stroke={preset.strokeColor || '#000000'}
                      strokeWidth={preset.strokeWidth > 0 ? Math.min(2.5, preset.strokeWidth * 0.4) : 0}
                      style={{
                        fontFamily: preset.fontFamily || 'Oswald, sans-serif',
                        fontWeight: 900,
                        fontSize: '17px',
                        letterSpacing: `${preset.letterSpacing || 2}px`,
                      }}
                    >
                      <textPath
                        href={`#card-arc-path-${preset.id}`}
                        startOffset="50%"
                        textAnchor="middle"
                      >
                        RONALDO
                      </textPath>
                    </text>
                  </svg>
                ) : (
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
                )}

                {preset.numberAssets && (preset.numberAssets['7'] || Object.values(preset.numberAssets)[0]) ? (
                  <div className="h-12 flex items-center justify-center my-1">
                    <img
                      src={preset.numberAssets['7'] || Object.values(preset.numberAssets)[0]}
                      alt="Digit Graphic"
                      className="max-h-12 object-contain filter drop-shadow"
                    />
                  </div>
                ) : (
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
                )}
              </div>

              {/* Specs Summary */}
              <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-zinc-400 border-t border-zinc-800/80 pt-3 mb-4">
                <div className="flex items-center space-x-1.5">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: preset.textColor }} />
                  <span>Text: {preset.textColor}</span>
                </div>
                <div className="flex items-center space-x-1.5">
                  <FileImage className="w-3.5 h-3.5 text-red-400" />
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
                className="flex items-center space-x-1.5 text-xs font-bold uppercase tracking-wider text-red-400 hover:text-red-300"
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

      {/* Empty State */}
      {filteredPresets.length === 0 && (
        <div className="text-center py-16 bg-zinc-900/30 rounded-xl border border-zinc-800 p-8 flex flex-col items-center justify-center">
          <Palette className="w-12 h-12 text-zinc-600 mb-3" />
          <h3 className="text-base font-bold text-zinc-300 uppercase tracking-wider mb-1">
            {searchTerm || selectedLeague !== 'All' ? 'No Matching Presets Found' : 'No Design Presets Available'}
          </h3>
          <p className="text-xs text-zinc-500 font-mono max-w-md mb-6">
            {searchTerm || selectedLeague !== 'All'
              ? 'Try adjusting your search terms or league filter.'
              : 'Add your custom jersey fonts, colors, and digit PNG assets by clicking the button below.'}
          </p>
          <button
            onClick={handleCreateNew}
            className="flex items-center space-x-2 px-5 py-2.5 bg-red-600 hover:bg-red-500 text-white font-bold uppercase tracking-wider text-xs rounded-lg shadow-lg shadow-red-900/30 transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>+ Add Your First Design Code</span>
          </button>
        </div>
      )}

      {/* Edit / Create Preset Modal */}
      {editingPreset && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl max-w-2xl w-full p-6 shadow-2xl my-8">
            <div className="flex items-center justify-between pb-4 border-b border-zinc-800 mb-6">
              <h2 className="text-base font-bold text-white uppercase tracking-wider flex items-center space-x-2">
                <Palette className="w-5 h-5 text-red-500" />
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
                    className="w-full bg-zinc-950 text-white px-3 py-2 rounded border border-zinc-800 focus:border-red-500 text-xs font-mono"
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
                    className="w-full bg-zinc-950 text-white px-3 py-2 rounded border border-zinc-800 focus:border-red-500 text-xs font-mono"
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
                    className="w-full bg-zinc-950 text-white px-3 py-2 rounded border border-zinc-800 focus:border-red-500 text-xs font-mono"
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
                    className="w-full bg-zinc-950 text-white px-3 py-2 rounded border border-zinc-800 focus:border-red-500 text-xs font-mono"
                    placeholder="e.g. 2024-25 or Classic"
                  />
                </div>
              </div>

              {/* Font Selector & Custom Font Upload */}
              <div className="bg-zinc-950 p-4 rounded-lg border border-zinc-800">
                <h3 className="text-[10px] font-bold text-red-400 uppercase tracking-wider mb-3 flex items-center space-x-1.5">
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
                      className="w-full bg-zinc-900 text-white px-3 py-2 rounded border border-zinc-800 focus:border-red-500 text-xs font-mono"
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
                      className="text-xs text-zinc-400 file:mr-2 file:py-1 file:px-2.5 file:rounded file:border-0 file:text-[10px] file:font-bold file:uppercase file:bg-red-600/10 file:text-red-400 hover:file:bg-red-600/20"
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

              {/* Specialized Text Shaping & Curved Text Arch Configuration */}
              <div className={`p-4 rounded-xl border transition-all ${
                editingPreset.curvedTextArch || editingPreset.enableArcPath || editingPreset.textEffect === 'arc'
                  ? 'bg-gradient-to-r from-red-950/40 via-zinc-900 to-amber-950/30 border-red-500/50 shadow-lg'
                  : 'bg-zinc-950 border-zinc-800'
              }`}>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-bold text-white uppercase tracking-wider flex items-center space-x-1.5">
                        <Sparkles className="w-4 h-4 text-red-400" />
                        <span>Curved Text Arch / Enable Arc Path</span>
                      </span>
                      <span className={`text-[9px] font-mono px-2 py-0.5 rounded-full font-bold uppercase ${
                        editingPreset.curvedTextArch || editingPreset.enableArcPath || editingPreset.textEffect === 'arc'
                          ? 'bg-red-500/20 text-red-300 border border-red-500/40'
                          : 'bg-zinc-800 text-zinc-400 border border-zinc-700'
                      }`}>
                        {editingPreset.curvedTextArch || editingPreset.enableArcPath || editingPreset.textEffect === 'arc'
                          ? '⚡ Curved Arc (ON)'
                          : 'OFF (Straight Text)'}
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-400 font-mono">
                      When enabled, name text automatically follows a smooth, proportional, and balanced upward arc curve (matching classic sports jersey arched text).
                    </p>
                  </div>

                  {/* Toggle Switch */}
                  <label className="relative inline-flex items-center cursor-pointer select-none shrink-0">
                    <input
                      type="checkbox"
                      checked={Boolean(editingPreset.curvedTextArch || editingPreset.enableArcPath || editingPreset.textEffect === 'arc')}
                      onChange={(e) => {
                        const isChecked = e.target.checked;
                        setEditingPreset({
                          ...editingPreset,
                          curvedTextArch: isChecked,
                          enableArcPath: isChecked,
                          textEffect: isChecked ? 'arc' : 'none',
                          arcCurvature: editingPreset.arcCurvature || editingPreset.arcAmount || 24,
                          arcAmount: editingPreset.arcAmount || editingPreset.arcCurvature || 24,
                        });
                      }}
                      className="sr-only peer"
                    />
                    <div className="w-12 h-6 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-zinc-400 peer-checked:after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-red-600"></div>
                    <span className="ml-2.5 text-xs font-mono font-bold text-zinc-300">
                      {Boolean(editingPreset.curvedTextArch || editingPreset.enableArcPath || editingPreset.textEffect === 'arc') ? 'ON' : 'OFF'}
                    </span>
                  </label>
                </div>

                {/* Expanded Controls when Arc Path is Enabled */}
                {(editingPreset.curvedTextArch || editingPreset.enableArcPath || editingPreset.textEffect === 'arc') && (
                  <div className="mt-4 pt-4 border-t border-zinc-800/80 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between text-xs font-mono">
                          <span className="text-zinc-300 font-bold uppercase text-[11px]">
                            Arc Curvature Angle:
                          </span>
                          <span className="text-red-400 font-black px-2 py-0.5 bg-zinc-950 rounded border border-zinc-800">
                            {editingPreset.arcCurvature || editingPreset.arcAmount || 24}°
                          </span>
                        </div>
                        <input
                          type="range"
                          min="10"
                          max="45"
                          step="1"
                          value={editingPreset.arcCurvature || editingPreset.arcAmount || 24}
                          onChange={(e) => {
                            const val = parseInt(e.target.value) || 24;
                            setEditingPreset({
                              ...editingPreset,
                              arcCurvature: val,
                              arcAmount: val,
                            });
                          }}
                          className="w-full accent-red-500 cursor-pointer"
                        />
                        <div className="flex items-center justify-between gap-1 pt-1">
                          {[
                            { label: 'Subtle', deg: 15 },
                            { label: 'Classic Jersey', deg: 24 },
                            { label: 'Pronounced', deg: 35 },
                          ].map((presetArch) => {
                            const currentVal = editingPreset.arcCurvature || editingPreset.arcAmount || 24;
                            return (
                              <button
                                key={presetArch.deg}
                                type="button"
                                onClick={() =>
                                  setEditingPreset({
                                    ...editingPreset,
                                    arcCurvature: presetArch.deg,
                                    arcAmount: presetArch.deg,
                                  })
                                }
                                className={`flex-1 py-1 px-2 text-[10px] font-mono font-bold uppercase rounded border transition-all ${
                                  currentVal === presetArch.deg
                                    ? 'bg-red-600 text-white border-red-500 shadow'
                                    : 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-200'
                                }`}
                              >
                                {presetArch.label} ({presetArch.deg}°)
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      {/* Live Curved Arc Visual Preview */}
                      <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800 flex flex-col items-center justify-center relative overflow-hidden h-24">
                        <div className="absolute top-1 left-2 text-[9px] font-mono text-zinc-500 uppercase">
                          Live Curve Preview (Balanced Arch)
                        </div>
                        <svg className="w-full h-16 overflow-visible" viewBox="0 0 300 60">
                          <defs>
                            <path
                              id={`preview-arc-path-${editingPreset.id}`}
                              d={`M 15,${52 + ((editingPreset.arcCurvature || 24) * 0.35)} Q 150,${16 - ((editingPreset.arcCurvature || 24) * 0.25)} 285,${52 + ((editingPreset.arcCurvature || 24) * 0.35)}`}
                              fill="transparent"
                            />
                          </defs>
                          <text
                            fill={editingPreset.textColor || '#FFFFFF'}
                            stroke={editingPreset.strokeColor || '#000000'}
                            strokeWidth={editingPreset.strokeWidth ? Math.min(3, editingPreset.strokeWidth * 0.4) : 0}
                            style={{
                              fontFamily: editingPreset.fontFamily || 'Oswald, sans-serif',
                              fontWeight: 900,
                              fontSize: '20px',
                              letterSpacing: `${editingPreset.letterSpacing || 2}px`,
                            }}
                          >
                            <textPath
                              href={`#preview-arc-path-${editingPreset.id}`}
                              startOffset="50%"
                              textAnchor="middle"
                            >
                              {editingPreset.teamName ? editingPreset.teamName.toUpperCase().slice(0, 12) : 'RONALDO'}
                            </textPath>
                          </text>
                        </svg>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Smart Bulk Folder & Multi-File Auto-Importer */}
              <div className="bg-gradient-to-r from-red-950/40 via-zinc-900 to-zinc-900/40 p-4 rounded-xl border border-red-500/30 space-y-3 shadow-lg">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-xs font-bold text-red-300 uppercase tracking-wider flex items-center space-x-2">
                      <FolderUp className="w-4 h-4 text-red-400" />
                      <span>Bulk Folder / Multi-File Auto-Importer</span>
                    </h3>
                    <p className="text-[11px] text-zinc-400 font-mono mt-0.5">
                      Upload an entire folder or select multiple images for Numbers (0-9) and Letters (A-Z). Files like <span className="text-red-300 font-bold">0.png–9.png</span> auto-map to digits and <span className="text-red-300 font-bold">A.png–Z.png</span> auto-map to name letters!
                    </p>
                  </div>

                  {/* Master upload action buttons */}
                  <div className="flex items-center space-x-2 shrink-0">
                    <label className="cursor-pointer px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white text-[10px] font-bold uppercase tracking-wider rounded shadow-md flex items-center space-x-1.5 transition-all">
                      <Folder className="w-3.5 h-3.5" />
                      <span>📁 Upload Folder</span>
                      <input
                        type="file"
                        {...({ webkitdirectory: '', directory: '', multiple: true } as any)}
                        onChange={(e) => {
                          handleBulkAssetUpload(e.target.files, 'all');
                          e.target.value = '';
                        }}
                        className="hidden"
                      />
                    </label>

                    <label className="cursor-pointer px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 text-[10px] font-bold uppercase tracking-wider rounded shadow-md flex items-center space-x-1.5 transition-all">
                      <Files className="w-3.5 h-3.5 text-red-400" />
                      <span>🗂️ Select Files</span>
                      <input
                        type="file"
                        multiple
                        accept="image/png,image/svg+xml,image/webp,image/jpeg"
                        onChange={(e) => {
                          handleBulkAssetUpload(e.target.files, 'all');
                          e.target.value = '';
                        }}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>

                {/* Real-time Progress Bar & Status */}
                {bulkUploadProgress.isActive && (
                  <div className="bg-zinc-950 p-3 rounded-lg border border-zinc-800 text-xs font-mono space-y-2">
                    <div className="flex items-center justify-between text-[11px]">
                      <div className="flex items-center space-x-2">
                        {bulkUploadProgress.status === 'processing' && (
                          <Loader2 className="w-3.5 h-3.5 text-red-400 animate-spin" />
                        )}
                        {bulkUploadProgress.status === 'done' && (
                          <CheckCheck className="w-3.5 h-3.5 text-emerald-400" />
                        )}
                        {bulkUploadProgress.status === 'error' && (
                          <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                        )}
                        <span className="text-zinc-200">{bulkUploadProgress.message}</span>
                      </div>

                      <span className="text-zinc-400 font-bold">
                        {bulkUploadProgress.totalFiles > 0
                          ? `${Math.round((bulkUploadProgress.currentFileIndex / bulkUploadProgress.totalFiles) * 100)}%`
                          : ''}
                      </span>
                    </div>

                    {bulkUploadProgress.totalFiles > 0 && (
                      <div className="w-full bg-zinc-800 rounded-full h-1.5 overflow-hidden">
                        <div
                          className={`h-full transition-all duration-200 ${
                            bulkUploadProgress.status === 'done' ? 'bg-emerald-500' : 'bg-red-500'
                          }`}
                          style={{
                            width: `${(bulkUploadProgress.currentFileIndex / bulkUploadProgress.totalFiles) * 100}%`,
                          }}
                        />
                      </div>
                    )}

                    <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-zinc-400 pt-1">
                      <div className="flex items-center space-x-3">
                        <span className="px-2 py-0.5 rounded bg-red-950 text-red-300 border border-red-800/50">
                          🔢 Numbers Mapped: <strong>{bulkUploadProgress.matchedNumbers}</strong>
                        </span>
                        <span className="px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800/50">
                          🔤 Letters Mapped: <strong>{bulkUploadProgress.matchedLetters}</strong>
                        </span>
                      </div>

                      {bulkUploadProgress.unmatchedFiles.length > 0 && (
                        <span className="text-amber-400">
                          ⚠️ {bulkUploadProgress.unmatchedFiles.length} file(s) skipped (not named 0-9 or A-Z)
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Number PNG Asset Grid (0-9) */}
              <div className="bg-zinc-950 p-4 rounded-lg border border-zinc-800 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800 pb-3">
                  <div>
                    <h3 className="text-xs font-bold text-red-400 uppercase tracking-wider flex items-center space-x-2">
                      <FileImage className="w-4 h-4" />
                      <span>Upload Number PNG Assets (0-9) to Cloudflare R2</span>
                    </h3>
                    <p className="text-[10px] text-zinc-500 font-mono">
                      High-res transparent PNGs stored in Cloudflare R2 and served globally.
                    </p>
                  </div>
                  <div className="flex items-center flex-wrap gap-2">
                    <label
                      className="cursor-pointer px-2 py-1 bg-zinc-900 hover:bg-zinc-800 text-red-400 text-[10px] font-bold uppercase tracking-wider rounded border border-zinc-800 flex items-center space-x-1"
                      title="Upload a folder containing 0.png - 9.png"
                    >
                      <Folder className="w-3 h-3" />
                      <span>Folder (0-9)</span>
                      <input
                        type="file"
                        {...({ webkitdirectory: '', directory: '', multiple: true } as any)}
                        onChange={(e) => {
                          handleBulkAssetUpload(e.target.files, 'numbers');
                          e.target.value = '';
                        }}
                        className="hidden"
                      />
                    </label>
                    <label
                      className="cursor-pointer px-2 py-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-[10px] font-bold uppercase tracking-wider rounded border border-zinc-800 flex items-center space-x-1"
                      title="Select multiple digit files (0-9)"
                    >
                      <Files className="w-3 h-3 text-red-400" />
                      <span>Files</span>
                      <input
                        type="file"
                        multiple
                        accept="image/png,image/svg+xml,image/webp,image/jpeg"
                        onChange={(e) => {
                          handleBulkAssetUpload(e.target.files, 'numbers');
                          e.target.value = '';
                        }}
                        className="hidden"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={handleGenerateSampleNumberAssets}
                      className="px-2 py-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-[10px] font-bold uppercase tracking-wider rounded border border-zinc-800 flex items-center space-x-1"
                      title="Auto-generate matching sample vector number graphics for digits 0-9"
                    >
                      <Sparkles className="w-3 h-3 text-red-400" />
                      <span>Sample 0-9</span>
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
                          hasAsset ? 'border-red-500/50' : 'border-zinc-800 hover:border-zinc-700'
                        } rounded p-1.5 flex flex-col items-center justify-between min-h-[90px] transition-all`}
                      >
                        <span className="text-[10px] font-mono font-bold text-zinc-400 bg-zinc-950 px-1.5 py-0.2 rounded border border-zinc-800">
                          {digit}
                        </span>

                        <div className="my-1 flex items-center justify-center h-9 w-full">
                          {isUploadingThis ? (
                            <Loader2 className="w-4 h-4 text-red-400 animate-spin" />
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
                          <label className="cursor-pointer text-[9px] font-bold uppercase bg-red-600/20 hover:bg-red-600/30 text-red-400 px-1.5 py-0.5 rounded border border-red-500/30 transition-all text-center w-full truncate">
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
                    <h3 className="text-xs font-bold text-red-400 uppercase tracking-wider flex items-center space-x-2">
                      <ImageIcon className="w-4 h-4" />
                      <span>Upload Letter PNG Assets (A-Z) to Cloudflare R2</span>
                    </h3>
                    <p className="text-[10px] text-zinc-500 font-mono">
                      Optional custom PNG cuts for each letter A-Z uploaded to R2.
                    </p>
                  </div>
                  <div className="flex items-center flex-wrap gap-2">
                    <label
                      className="cursor-pointer px-2 py-1 bg-zinc-900 hover:bg-zinc-800 text-red-400 text-[10px] font-bold uppercase tracking-wider rounded border border-zinc-800 flex items-center space-x-1"
                      title="Upload a folder containing A.png - Z.png"
                    >
                      <Folder className="w-3 h-3" />
                      <span>Folder (A-Z)</span>
                      <input
                        type="file"
                        {...({ webkitdirectory: '', directory: '', multiple: true } as any)}
                        onChange={(e) => {
                          handleBulkAssetUpload(e.target.files, 'letters');
                          e.target.value = '';
                        }}
                        className="hidden"
                      />
                    </label>
                    <label
                      className="cursor-pointer px-2 py-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-[10px] font-bold uppercase tracking-wider rounded border border-zinc-800 flex items-center space-x-1"
                      title="Select multiple letter files (A-Z)"
                    >
                      <Files className="w-3 h-3 text-red-400" />
                      <span>Files</span>
                      <input
                        type="file"
                        multiple
                        accept="image/png,image/svg+xml,image/webp,image/jpeg"
                        onChange={(e) => {
                          handleBulkAssetUpload(e.target.files, 'letters');
                          e.target.value = '';
                        }}
                        className="hidden"
                      />
                    </label>
                    <button
                      type="button"
                      onClick={handleGenerateSampleLetterAssets}
                      className="px-2 py-1 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-[10px] font-bold uppercase tracking-wider rounded border border-zinc-800 flex items-center space-x-1"
                      title="Auto-generate sample A-Z vector letter graphics"
                    >
                      <Sparkles className="w-3 h-3 text-red-400" />
                      <span>Sample A-Z</span>
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
                          hasAsset ? 'border-red-500/50' : 'border-zinc-800 hover:border-zinc-700'
                        } rounded p-1 flex flex-col items-center justify-between min-h-[75px] transition-all`}
                      >
                        <span className="text-[9px] font-mono font-bold text-zinc-400 bg-zinc-950 px-1 rounded border border-zinc-800">
                          {letter}
                        </span>

                        <div className="my-0.5 flex items-center justify-center h-6 w-full">
                          {isUploadingThis ? (
                            <Loader2 className="w-3 h-3 text-red-400 animate-spin" />
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
                          <label className="cursor-pointer text-[8px] font-bold uppercase bg-red-600/20 hover:bg-red-600/30 text-red-400 px-1 py-0.5 rounded border border-red-500/30 transition-all text-center w-full truncate">
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
                    value={editingPreset.curvedTextArch || editingPreset.enableArcPath || editingPreset.textEffect === 'arc' ? 'arc' : editingPreset.textEffect}
                    onChange={(e) => {
                      const newEffect = e.target.value as any;
                      const isArc = newEffect === 'arc';
                      setEditingPreset({
                        ...editingPreset,
                        textEffect: newEffect,
                        curvedTextArch: isArc,
                        enableArcPath: isArc,
                        arcCurvature: editingPreset.arcCurvature || editingPreset.arcAmount || 24,
                        arcAmount: editingPreset.arcAmount || editingPreset.arcCurvature || 24,
                      });
                    }}
                    className="w-full bg-zinc-900 text-white px-3 py-1.5 rounded border border-zinc-800 text-xs font-mono"
                  >
                    <option value="none">Flat (Standard Line)</option>
                    <option value="arc">Curved Arch (Upward Arc Path)</option>
                    <option value="italic">Italic Slant</option>
                    <option value="drop-shadow">Drop Shadow</option>
                  </select>
                </div>

                {editingPreset.textEffect === 'arc' && (
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-red-400 mb-1">
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
                      className="w-full accent-red-500 cursor-pointer my-1"
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
                    className="w-full bg-zinc-950 text-white px-3 py-2 rounded border border-zinc-800 focus:border-red-500 text-xs font-mono"
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
                    className="w-full bg-zinc-950 text-white px-3 py-2 rounded border border-zinc-800 focus:border-red-500 text-xs font-mono"
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
                    className="w-full bg-zinc-950 text-white px-3 py-2 rounded border border-zinc-800 focus:border-red-500 text-xs font-mono"
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
                    className="w-full bg-zinc-950 text-white px-3 py-2 rounded border border-zinc-800 focus:border-red-500 text-xs font-mono"
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
                  className="w-full bg-zinc-950 text-white px-3 py-2 rounded border border-zinc-800 focus:border-red-500 text-xs font-mono placeholder:text-zinc-600"
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
                  className="px-6 py-2 bg-red-600 text-white font-bold uppercase tracking-wider rounded shadow-lg shadow-red-900/20 hover:bg-red-500 text-xs flex items-center space-x-2 disabled:opacity-50"
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
