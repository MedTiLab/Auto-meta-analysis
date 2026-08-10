import { useEffect, useState } from 'react';

interface FileAttachmentProps {
  file: File;
  onRemove: () => void;
  uploadProgress?: number;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const FileAttachment = ({ file, onRemove, uploadProgress }: FileAttachmentProps) => {
  const [preview, setPreview] = useState<string | undefined>(undefined);
  const isImage = file.type.startsWith('image/');

  useEffect(() => {
    if (!isImage) return;
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file, isImage]);

  return (
    <div className="relative group">
      {isImage ? (
        <img src={preview} alt={file.name} className="w-20 h-20 object-cover rounded" />
      ) : (
        <div className="w-20 h-20 rounded bg-muted/60 flex flex-col items-center justify-center gap-1 px-1">
          <svg className="w-6 h-6 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
          <span className="text-[10px] text-muted-foreground truncate w-full text-center" title={file.name}>
            {file.name}
          </span>
          <span className="text-[9px] text-muted-foreground/70">{formatFileSize(file.size)}</span>
        </div>
      )}
      {uploadProgress !== undefined && uploadProgress < 100 && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
          <div className="text-white text-xs">{uploadProgress}%</div>
        </div>
      )}
      <button
        type="button"
        onClick={onRemove}
        className="absolute -right-2 -top-2 rounded-full bg-foreground p-1 text-background opacity-100 transition-opacity focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
        aria-label="Remove file"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
};

export { FileAttachment };
export default FileAttachment;
