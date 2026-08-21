import React, { useState } from 'react';
import {
  Download,
  FileImage,
  FileText,
  Printer,
  CheckCircle2,
  Sparkles,
  Layers,
  Ruler,
  AlertCircle,
  X,
  Clock,
  Scissors,
  Archive,
  PackageCheck,
  Loader2,
} from 'lucide-react';
import saveAs from 'file-saver';
import jsPDF from 'jspdf';
import JSZip from 'jszip';
import { CanvasItem, LayoutSettings, RollMetrics } from '../types';
import {
  generateHighResDtfCanvas,
  generateIndividualItemPngBlob,
} from '../utils/canvasRenderer';

/**
 * Robust cross-browser blob downloader supporting large memory streams
 */
function triggerBlobDownload(blob: Blob, filename: string) {
  if (!blob || blob.size === 0) {
    throw new Error('Generated file is empty or corrupted.');
  }

  try {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();

    setTimeout(() => {
      if (document.body.contains(link)) {
        document.body.removeChild(link);
      }
      URL.revokeObjectURL(url);
    }, 4000);
  } catch (err) {
    console.warn('Direct URL download fallback to saveAs:', err);
    saveAs(blob, filename);
  }
}

interface ExportModalProps {
  canvasItems: CanvasItem[];
  layoutSettings: LayoutSettings;
  metrics: RollMetrics;
  orders: any[];
  onClose?: () => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  canvasItems,
  layoutSettings,
  metrics,
  orders,
  onClose,
}) => {
  const [rendering, setRendering] = useState(false);
  const [exportType, setExportType] = useState<'png' | 'zip' | 'pdf' | null>(null);
  const [progress, setProgress] = useState(0);
  const [renderStatus, setRenderStatus] = useState<string>('');
  const [exportSuccess, setExportSuccess] = useState<string>('');

  const rollWidthInches = layoutSettings.rollWidthInches || 39.0;
  const rollHeightInches = metrics.totalRollLengthInches || 24.0;

  // 300 DPI Full Roll PNG Export (Optimized Async Pipeline)
  const handleExportPNG = async () => {
    try {
      setExportType('png');
      setRendering(true);
      setExportSuccess('');
      setRenderStatus('Preloading 300 DPI vector assets & font faces...');
      setProgress(5);

      // Render high-res canvas at 300 DPI with async chunked yielding
      const canvas = await generateHighResDtfCanvas(
        canvasItems,
        layoutSettings,
        300,
        (pct) => setProgress(5 + Math.round(pct * 0.75))
      );

      setRenderStatus('Compressing uncompressed transparent 300 DPI PNG roll file for DTF RIP...');
      setProgress(85);

      // Allow UI thread to flush status text before canvas encoding
      await new Promise((resolve) => setTimeout(resolve, 60));

      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), 'image/png');
      });

      if (!blob || blob.size === 0) throw new Error('PNG generation failed - blob is empty');

      setProgress(98);
      const filename = `SPIDEY_JERSEY_DTF_39INCH_ROLL_${Date.now()}.png`;
      triggerBlobDownload(blob, filename);

      setProgress(100);
      setExportSuccess(`Successfully exported high-res 300 DPI PNG roll file: ${filename}`);
    } catch (err: any) {
      console.error('PNG Export Error:', err);
      alert(`Error generating full roll PNG: ${err.message || 'Unknown error'}. Please try again.`);
    } finally {
      setRendering(false);
      setExportType(null);
    }
  };

  // Bulk Export Individual 300 DPI PNG Assets in ZIP
  const handleExportIndividualZip = async () => {
    try {
      if (canvasItems.length === 0) return;
      setExportType('zip');
      setRendering(true);
      setExportSuccess('');
      setRenderStatus(`Preparing chunked ZIP package for ${canvasItems.length} items at 300 DPI...`);
      setProgress(5);

      const zip = new JSZip();
      const folder = zip.folder("300DPI_INDIVIDUAL_DTF_ASSETS");

      for (let i = 0; i < canvasItems.length; i++) {
        const item = canvasItems[i];
        const label = item.customerName || item.number || 'ITEM';
        setRenderStatus(`Rendering 300 DPI Asset ${i + 1}/${canvasItems.length}: ${label}...`);

        const { blob, filename } = await generateIndividualItemPngBlob(item, 300);
        const indexedFilename = `${String(i + 1).padStart(3, '0')}_${filename}`;

        if (folder) {
          folder.file(indexedFilename, blob);
        } else {
          zip.file(indexedFilename, blob);
        }

        setProgress(10 + Math.round(((i + 1) / canvasItems.length) * 75));
        // Yield back to event loop to keep UI responsive
        await new Promise((resolve) => setTimeout(resolve, 0));
      }

      setRenderStatus('Compressing ZIP archive...');
      setProgress(88);

      const zipBlob = await zip.generateAsync({ type: 'blob' }, (metadata) => {
        setProgress(88 + Math.round((metadata.percent / 100) * 10));
      });

      const zipFilename = `SPIDEY_JERSEY_BULK_ASSETS_${Date.now()}.zip`;
      triggerBlobDownload(zipBlob, zipFilename);

      setProgress(100);
      setExportSuccess(`Successfully exported bulk ZIP package (${canvasItems.length} 300 DPI PNG assets): ${zipFilename}`);
    } catch (err: any) {
      console.error('ZIP Export Error:', err);
      alert(`Error generating ZIP archive: ${err.message || 'Unknown error'}`);
    } finally {
      setRendering(false);
      setExportType(null);
    }
  };

  // High-Res Printable PDF Export
  const handleExportPDF = async () => {
    try {
      setExportType('pdf');
      setRendering(true);
      setExportSuccess('');
      setRenderStatus('Building 300 DPI PDF Graphics Layer...');
      setProgress(15);

      // Render high-res canvas at true 300 DPI
      const canvas = await generateHighResDtfCanvas(
        canvasItems,
        layoutSettings,
        300,
        (pct) => setProgress(15 + Math.round(pct * 0.6))
      );

      setRenderStatus('Packaging PDF document with 39" page format...');
      setProgress(80);

      const imgData = canvas.toDataURL('image/png');

      // Create custom page size in points: 1 inch = 72 pt
      const pdfW = rollWidthInches * 72;
      const pdfH = rollHeightInches * 72;

      const pdf = new jsPDF({
        orientation: pdfW > pdfH ? 'landscape' : 'portrait',
        unit: 'pt',
        format: [pdfW, pdfH],
      });

      pdf.addImage(imgData, 'PNG', 0, 0, pdfW, pdfH);

      const filename = `SPIDEY_JERSEY_DTF_39INCH_ROLL_${Date.now()}.pdf`;
      pdf.save(filename);

      setProgress(100);
      setExportSuccess(`Exported 39" Roll PDF file: ${filename}`);
    } catch (err: any) {
      console.error('PDF Export Error:', err);
      alert(`Error generating PDF: ${err.message || 'Unknown error'}`);
    } finally {
      setRendering(false);
      setExportType(null);
    }
  };

  // Printable Production Slip
  const handleExportJobSummary = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const summaryHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>SPIDEY JERSEY - Production Job Summary Sheet</title>
          <style>
            body { font-family: monospace; padding: 30px; background: #fff; color: #000; }
            h1 { margin-bottom: 5px; font-size: 24px; }
            .header { border-bottom: 2px solid #000; padding-bottom: 15px; margin-bottom: 20px; }
            table { width: 100%; border-collapse: collapse; margin-top: 15px; }
            th, td { border: 1px solid #ccc; padding: 8px 12px; text-align: left; font-size: 12px; }
            th { background: #f0f0f0; }
            .badge { background: #eee; padding: 2px 6px; border-radius: 4px; font-weight: bold; }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>SPIDEY JERSEY - DTF PRINT JOB SUMMARY</h1>
            <p>Roll Width: 39 Inches | Total Length: ${metrics.totalRollLengthInches}" (${metrics.totalRollLengthMeters}m) | Efficiency: ${metrics.efficiencyPercentage}%</p>
            <p>Generated Date: ${new Date().toLocaleString()} | Orders: ${orders.length} | Items: ${canvasItems.length}</p>
          </div>

          <h2>Cutters & Sorting Manifest</h2>
          <table>
            <thead>
              <tr>
                <th>Item #</th>
                <th>Type</th>
                <th>Customer Name</th>
                <th>Number</th>
                <th>Design Code</th>
                <th>Size</th>
                <th>Roll X, Y Position</th>
                <th>Dimensions</th>
              </tr>
            </thead>
            <tbody>
              ${canvasItems
                .map(
                  (item, i) => `
                <tr>
                  <td>${i + 1}</td>
                  <td><strong>${item.itemType.toUpperCase()}</strong></td>
                  <td>${item.customerName || '-'}</td>
                  <td>${item.number || '-'}</td>
                  <td><span class="badge">${item.designCode}</span></td>
                  <td>${item.garmentSize}</td>
                  <td>X: ${item.x}", Y: ${item.y}"</td>
                  <td>${item.width}" x ${item.height}"</td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        </body>
      </html>
    `;

    printWindow.document.write(summaryHtml);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
    }, 500);
  };

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="bg-zinc-900 rounded-xl border border-zinc-800 p-8 shadow-2xl space-y-6">
        {/* Title */}
        <div className="flex items-center justify-between pb-6 border-b border-zinc-800">
          <div className="flex items-center space-x-3">
            <div className="p-3 bg-blue-600/10 text-blue-500 border border-blue-500/30 rounded-xl">
              <Printer className="w-8 h-8" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white uppercase tracking-wider">
                High-Resolution DTF Export System
              </h1>
              <p className="text-xs text-zinc-400 font-mono mt-0.5">
                Ready for professional Direct-to-Film RIP software at 300 DPI with 100% transparent background.
              </p>
            </div>
          </div>
        </div>

        {/* Specs Overview */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 bg-zinc-950 p-5 rounded-lg border border-zinc-800 font-mono text-xs">
          <div className="space-y-1">
            <span className="text-zinc-500 text-[10px] uppercase">Roll Canvas Size</span>
            <div className="text-white font-bold text-base">39" x {rollHeightInches}"</div>
            <div className="text-zinc-500 text-[10px]">11,700 px width at 300 DPI</div>
          </div>

          <div className="space-y-1">
            <span className="text-zinc-500 text-[10px] uppercase">Total Sheet Items</span>
            <div className="text-blue-400 font-bold text-base">
              {metrics.totalNamesCount} Names + {metrics.totalNumbersCount} Numbers
            </div>
            <div className="text-zinc-500 text-[10px]">{orders.length} Customer Orders</div>
          </div>

          <div className="space-y-1">
            <span className="text-zinc-500 text-[10px] uppercase">Film Efficiency</span>
            <div className="text-emerald-400 font-bold text-base">{metrics.efficiencyPercentage}%</div>
            <div className="text-zinc-500 text-[10px]">~{metrics.estimatedPrintTimeMinutes} Mins Print Time</div>
          </div>
        </div>

        {/* Progress Bar during Rendering */}
        {rendering && (
          <div className="bg-zinc-950 p-6 rounded-lg border border-blue-500/30 space-y-3">
            <div className="flex items-center justify-between text-xs font-mono">
              <span className="text-blue-400 font-bold flex items-center space-x-2">
                <Sparkles className="w-4 h-4 animate-spin" />
                <span>{renderStatus}</span>
              </span>
              <span className="text-white font-bold">{progress}%</span>
            </div>
            <div className="w-full bg-zinc-900 rounded-full h-3 overflow-hidden border border-zinc-800">
              <div
                className="bg-blue-600 h-full transition-all duration-300 rounded-full"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {/* Export Success Banner */}
        {exportSuccess && (
          <div className="bg-emerald-950/40 border border-emerald-500/30 p-4 rounded-lg flex items-center space-x-3 text-emerald-300 text-xs font-mono">
            <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" />
            <span>{exportSuccess}</span>
          </div>
        )}

        {/* Action Export Buttons Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 pt-4">
          {/* PNG Export */}
          <div className="bg-zinc-950 p-6 rounded-xl border border-zinc-800 hover:border-zinc-700 transition-all flex flex-col justify-between space-y-4">
            <div>
              <div className="p-3 bg-blue-600/10 text-blue-400 border border-blue-500/30 rounded-lg w-fit mb-3">
                <FileImage className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">300 DPI Roll PNG</h3>
              <p className="text-xs text-zinc-400 font-mono mt-1">
                Full 39" roll transparent PNG image formatted specifically for DTF RIP software (Cadlink, AcroRIP, Digital Factory).
              </p>
            </div>

            <button
              disabled={rendering || canvasItems.length === 0}
              onClick={handleExportPNG}
              className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold uppercase tracking-wider rounded-lg shadow-lg shadow-blue-900/20 transition-all flex items-center justify-center space-x-2"
            >
              {exportType === 'png' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                  <span>Processing Roll PNG...</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>Download Roll PNG</span>
                </>
              )}
            </button>
          </div>

          {/* Bulk Individual PNG Assets ZIP Package */}
          <div className="bg-zinc-950 p-6 rounded-xl border border-cyan-500/30 hover:border-cyan-500/50 transition-all flex flex-col justify-between space-y-4">
            <div>
              <div className="p-3 bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 rounded-lg w-fit mb-3">
                <Archive className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">Bulk Individual PNG Assets (ZIP)</h3>
              <p className="text-xs text-zinc-400 font-mono mt-1">
                Optimized chunked export generating individual 300 DPI transparent PNG files for all {canvasItems.length} items in a ZIP package.
              </p>
            </div>

            <button
              disabled={rendering || canvasItems.length === 0}
              onClick={handleExportIndividualZip}
              className="w-full py-3 px-4 bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold uppercase tracking-wider rounded-lg shadow-lg shadow-cyan-900/20 transition-all flex items-center justify-center space-x-2"
            >
              {exportType === 'zip' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                  <span>Packaging Assets ZIP...</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  <span>Download Assets ZIP</span>
                </>
              )}
            </button>
          </div>

          {/* PDF Export */}
          <div className="bg-zinc-950 p-6 rounded-xl border border-zinc-800 hover:border-zinc-700 transition-all flex flex-col justify-between space-y-4">
            <div>
              <div className="p-3 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-lg w-fit mb-3">
                <FileText className="w-6 h-6" />
              </div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">Vector Printable PDF</h3>
              <p className="text-xs text-zinc-400 font-mono mt-1">
                High-resolution continuous 39" wide PDF document mapped precisely to physical print dimensions.
              </p>
            </div>

            <button
              disabled={rendering || canvasItems.length === 0}
              onClick={handleExportPDF}
              className="w-full py-3 px-4 bg-zinc-900 hover:bg-zinc-800 disabled:opacity-50 disabled:cursor-not-allowed text-zinc-200 border border-zinc-800 text-xs font-bold uppercase tracking-wider rounded-lg transition-all flex items-center justify-center space-x-2"
            >
              {exportType === 'pdf' ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                  <span>Processing PDF...</span>
                </>
              ) : (
                <>
                  <Download className="w-4 h-4 text-emerald-400" />
                  <span>Download PDF</span>
                </>
              )}
            </button>
          </div>

          {/* Job Manifest Slip */}
          <div className="bg-zinc-950 p-6 rounded-xl border border-zinc-800 hover:border-zinc-700 transition-all flex flex-col justify-between space-y-4">
            <div>
              <div className="p-3 bg-zinc-900 text-zinc-300 border border-zinc-800 rounded-lg w-fit mb-3">
                <Scissors className="w-6 h-6 text-blue-400" />
              </div>
              <h3 className="text-sm font-bold text-white uppercase tracking-wider">Production Sorting Slip</h3>
              <p className="text-xs text-zinc-400 font-mono mt-1">
                Printable order list with roll coordinates for cutters and warehouse sorting staff.
              </p>
            </div>

            <button
              onClick={handleExportJobSummary}
              className="w-full py-3 px-4 bg-zinc-900 hover:bg-zinc-800 text-zinc-200 text-xs font-bold uppercase tracking-wider rounded-lg border border-zinc-800 transition-all flex items-center justify-center space-x-2"
            >
              <Printer className="w-4 h-4 text-blue-400" />
              <span>Print Sorting Manifest</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
