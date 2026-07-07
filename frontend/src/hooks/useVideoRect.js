/**
 * useVideoRect.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Returns the exact pixel rectangle of the video's rendered image inside a
 * <video object-contain> element — i.e. the letterbox-corrected area with
 * black bars removed.
 *
 * This is the SINGLE source of truth for coordinate normalisation across the
 * entire app.  Both Config Mode and Dashboard Mode import this hook so they
 * always share the same geometry.
 *
 * Returns
 * ───────
 * {
 *   rect: { left, top, width, height }   // CSS pixels, relative to viewport
 *   ready: bool                          // true once video metadata is loaded
 * }
 *
 * The rect is re-calculated whenever:
 *   - the video element is resized  (ResizeObserver)
 *   - the video metadata loads      (loadedmetadata)
 *   - the browser window resizes    (window resize)
 *
 * Usage
 * ─────
 *   const { rect } = useVideoRect(videoRef);
 *   // normalise a canvas-space click:
 *   const nx = (clientX - rect.left) / rect.width;
 *   const ny = (clientY - rect.top)  / rect.height;
 */

import { useState, useEffect, useCallback } from 'react';

/**
 * Compute the object-contain rendered area of a <video> element.
 * Returns { left, top, width, height } in px relative to the viewport,
 * or null if the video has no intrinsic size yet.
 */
export function getVideoContentRect(video) {
  if (!video) return null;

  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return null;          // metadata not loaded yet

  const el = video.getBoundingClientRect();
  const elW = el.width;
  const elH = el.height;

  // object-contain: scale to fit, preserving aspect ratio
  const scale  = Math.min(elW / vw, elH / vh);
  const imgW   = vw * scale;
  const imgH   = vh * scale;

  // centre the image inside the element (letterbox offsets)
  const offX   = (elW - imgW) / 2;
  const offY   = (elH - imgH) / 2;

  return {
    left:   el.left  + offX,
    top:    el.top   + offY,
    width:  imgW,
    height: imgH,
  };
}

export default function useVideoRect(videoRef) {
  const [rect,  setRect]  = useState(null);
  const [ready, setReady] = useState(false);

  const update = useCallback(() => {
    const r = getVideoContentRect(videoRef.current);
    if (r) {
      setRect(r);
      setReady(true);
    }
  }, [videoRef]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    video.addEventListener('loadedmetadata', update);
    window.addEventListener('resize', update);

    const obs = new ResizeObserver(update);
    obs.observe(video);

    // also fire immediately in case metadata is already loaded
    update();

    return () => {
      video.removeEventListener('loadedmetadata', update);
      window.removeEventListener('resize', update);
      obs.disconnect();
    };
  }, [videoRef, update]);

  return { rect, ready };
}
