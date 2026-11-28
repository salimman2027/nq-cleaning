import { useEffect, useState } from 'react';
import { fileUrl, openFile } from './api';

/** Thumbnail of a protected photo (needs the sign-in token, so it cannot be a plain <img src>). Click opens it full size. */
export function AuthImg({ path, className = 'h-16 w-20' }: { path: string; className?: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let u = '';
    let dead = false;
    fileUrl(path).then((x) => { u = x; if (!dead) setSrc(x); else URL.revokeObjectURL(x); }).catch(() => undefined);
    return () => { dead = true; if (u) URL.revokeObjectURL(u); };
  }, [path]);
  return (
    <button type="button" onClick={() => void openFile(path).catch(() => undefined)} className={`${className} overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800`}>
      {src && <img src={src} alt="" className="h-full w-full object-cover" />}
    </button>
  );
}
