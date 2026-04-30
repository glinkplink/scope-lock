import { useCallback, useLayoutEffect, useRef, useState } from 'react';

/** Letter width at 96dpi — preview layout matches PDF viewport. */
export const PREVIEW_LETTER_WIDTH_PX = 816;

/** Letter height at 96dpi — used when a thumbnail should show one full page. */
export const PREVIEW_LETTER_HEIGHT_PX = 1056;

/** Preview upscale only applies at this breakpoint and when measure width > 816px. */
export const PREVIEW_DESKTOP_UPSCALE_MQ = '(min-width: 1024px)';

type UseScaledPreviewOptions = {
  fitPageHeightPx?: number;
  maxVisiblePageCount?: number;
};

function isUseScaledPreviewOptions(value: unknown): value is UseScaledPreviewOptions {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    ('fitPageHeightPx' in value || 'maxVisiblePageCount' in value)
  );
}

/**
 * Shared scaled “mini sheet” preview: viewport + sheet refs, scale, and spacer dimensions
 * (spacer height = sheet.scrollHeight * scale — matches prior previewContentHeight * previewScale).
 *
 * Rest arguments are not read as values: they are forwarded as the dependency array for the
 * layout effect that remeasures sheet height when caller content changes.
 */
export function useScaledPreview(...heightRefreshDeps: unknown[]) {
  const options = isUseScaledPreviewOptions(heightRefreshDeps[0])
    ? heightRefreshDeps[0]
    : undefined;
  const refreshDeps = options ? heightRefreshDeps.slice(1) : heightRefreshDeps;
  const fitPageHeightPx = options?.fitPageHeightPx;
  const maxVisiblePageCount = options?.maxVisiblePageCount;
  const [viewportNode, setViewportNode] = useState<HTMLDivElement | null>(null);
  const [sheetNode, setSheetNode] = useState<HTMLDivElement | null>(null);
  const viewportRef = useCallback((node: HTMLDivElement | null) => {
    setViewportNode(node);
  }, []);
  const sheetRef = useCallback((node: HTMLDivElement | null) => {
    setSheetNode(node);
  }, []);
  const scaleFrameRef = useRef<number | null>(null);
  const heightFrameRef = useRef<number | null>(null);
  const [sheetScrollHeight, setSheetScrollHeight] = useState(0);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const viewport = viewportNode;
    if (!viewport) return;

    const computeScale = () => {
      const w = viewport.getBoundingClientRect().width;
      if (w <= 0) return 1;

      const maxScale = window.matchMedia(PREVIEW_DESKTOP_UPSCALE_MQ).matches ? 1.5 : 1;
      const widthScale = w / PREVIEW_LETTER_WIDTH_PX;
      const pageHeightScale = fitPageHeightPx
        ? fitPageHeightPx / PREVIEW_LETTER_HEIGHT_PX
        : Number.POSITIVE_INFINITY;
      return Math.min(widthScale, pageHeightScale, maxScale);
    };

    const measureScale = () => {
      setScale(computeScale());
    };

    const updateScale = () => {
      if (scaleFrameRef.current != null) return;
      scaleFrameRef.current = window.requestAnimationFrame(() => {
        scaleFrameRef.current = null;
        const nextScale = computeScale();
        setScale((current) => (Math.abs(current - nextScale) > 0.001 ? nextScale : current));
      });
    };

    measureScale();
    const ro = new ResizeObserver(updateScale);
    ro.observe(viewport);
    const mq = window.matchMedia(PREVIEW_DESKTOP_UPSCALE_MQ);
    mq.addEventListener('change', updateScale);
    window.addEventListener('resize', updateScale);
    return () => {
      if (scaleFrameRef.current != null) {
        window.cancelAnimationFrame(scaleFrameRef.current);
        scaleFrameRef.current = null;
      }
      ro.disconnect();
      mq.removeEventListener('change', updateScale);
      window.removeEventListener('resize', updateScale);
    };
  }, [fitPageHeightPx, viewportNode]);

  /* Spacer height: sheet content only — ResizeObserver here does not track scroll container size. */
  useLayoutEffect(() => {
    const sheet = sheetNode;
    if (!sheet) return;

    const measureHeight = () => {
      const nextHeight = sheet.scrollHeight;
      setSheetScrollHeight((current) => (current !== nextHeight ? nextHeight : current));
    };

    const updateHeight = () => {
      if (heightFrameRef.current != null) return;
      heightFrameRef.current = window.requestAnimationFrame(() => {
        heightFrameRef.current = null;
        measureHeight();
      });
    };

    measureHeight();
    const ro = new ResizeObserver(updateHeight);
    ro.observe(sheet);
    return () => {
      if (heightFrameRef.current != null) {
        window.cancelAnimationFrame(heightFrameRef.current);
        heightFrameRef.current = null;
      }
      ro.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- caller passes refresh triggers (e.g. job, profile)
  }, [sheetNode, ...refreshDeps]);

  const maxVisibleSheetHeight =
    typeof maxVisiblePageCount === 'number' && maxVisiblePageCount > 0
      ? PREVIEW_LETTER_HEIGHT_PX * maxVisiblePageCount
      : null;
  const visibleSheetHeight =
    maxVisibleSheetHeight == null
      ? sheetScrollHeight
      : Math.min(sheetScrollHeight, maxVisibleSheetHeight);
  const spacerHeight = visibleSheetHeight * scale;
  const spacerWidth = PREVIEW_LETTER_WIDTH_PX * scale;

  return {
    viewportRef,
    sheetRef,
    scale,
    spacerHeight,
    spacerWidth,
    letterWidthPx: PREVIEW_LETTER_WIDTH_PX,
  };
}
