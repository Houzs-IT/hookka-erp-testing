// Camera / library → compressImage (desktop settings) with progress and per-file Retry / Dismiss.
import { useCallback, useRef, useState } from "react";
import { compressImage } from "@/lib/image-compress";

export type PhotoFail = { id: number; file: File };

export function usePhotoQueue() {
  const [photos, setPhotos] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [fails, setFails] = useState<PhotoFail[]>([]);
  const seq = useRef(0);

  /** Compresses files; resolves to the data URIs that succeeded. */
  const compress = useCallback(async (files: File[]): Promise<string[]> => {
    const out: string[] = [];
    const bad: PhotoFail[] = [];
    setProgress({ done: 0, total: files.length });
    for (let i = 0; i < files.length; i++) {
      try {
        out.push(await compressImage(files[i], { maxDim: 1280, quality: 0.85 }));
      } catch {
        bad.push({ id: ++seq.current, file: files[i] });
      }
      setProgress({ done: i + 1, total: files.length });
    }
    setProgress(null);
    if (bad.length) setFails((f) => [...f, ...bad]);
    return out;
  }, []);

  const add = useCallback(
    async (list: FileList | File[] | null) => {
      const files = Array.from(list ?? []);
      if (!files.length) return [] as string[];
      const ok = await compress(files);
      if (ok.length) setPhotos((p) => [...p, ...ok]);
      return ok;
    },
    [compress],
  );

  const retry = useCallback(
    async (id: number) => {
      const f = fails.find((x) => x.id === id);
      if (!f) return [] as string[];
      setFails((l) => l.filter((x) => x.id !== id));
      const ok = await compress([f.file]);
      if (ok.length) setPhotos((p) => [...p, ...ok]);
      return ok;
    },
    [fails, compress],
  );

  return {
    photos,
    setPhotos,
    progress,
    fails,
    busy: progress !== null,
    add,
    retry,
    dismiss: (id: number) => setFails((l) => l.filter((x) => x.id !== id)),
    remove: (i: number) => setPhotos((p) => p.filter((_, j) => j !== i)),
    reset: () => {
      setPhotos([]);
      setFails([]);
    },
  };
}

