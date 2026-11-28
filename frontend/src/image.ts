/** Shrinks a photo before upload so it stays small on a phone connection. */
export async function shrink(f: File): Promise<File> {
  if (!f.type.startsWith('image/')) return f;
  try {
    const bmp = await createImageBitmap(f);
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    const blob: Blob | null = await new Promise((ok) => c.toBlob(ok, 'image/jpeg', 0.8));
    return blob ? new File([blob], f.name.replace(/\.\w+$/, '') + '.jpg', { type: 'image/jpeg' }) : f;
  } catch { return f; }
}
