"use client";

export function FileViewer({ src, fileName }: { src: string; fileName: string }) {
  const lower = fileName.toLowerCase();
  const isImage = /\.(jpe?g|png|gif|webp)$/.test(lower);
  const isHeic = /\.heic$/.test(lower);

  if (isImage) {
    return (
      <div className="bg-white rounded-xl border border-surface-200 shadow-sm p-4 flex justify-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={fileName} style={{ maxWidth: "100%", height: "auto", borderRadius: 8 }} />
      </div>
    );
  }

  if (isHeic) {
    return (
      <div className="bg-white rounded-xl border border-surface-200 shadow-sm p-6 text-center">
        <p className="text-surface-700 mb-3">This receipt is a HEIC image, which most browsers can&apos;t display directly.</p>
        <a href={src} download={fileName} className="btn-primary">
          Download {fileName}
        </a>
        <p className="text-xs text-surface-400 mt-3">HEIC viewing in-browser is a future enhancement.</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-surface-200 shadow-sm overflow-hidden">
      <iframe src={src} title={fileName} width="100%" height="800" style={{ border: 0, display: "block" }} />
    </div>
  );
}
