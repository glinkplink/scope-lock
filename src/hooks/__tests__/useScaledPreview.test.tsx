// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import React from 'react';
import {
  useScaledPreview,
  PREVIEW_LETTER_HEIGHT_PX,
  PREVIEW_LETTER_WIDTH_PX,
  PREVIEW_DESKTOP_UPSCALE_MQ,
} from '../useScaledPreview';

// ---------------------------------------------------------------------------
// ResizeObserver mock
// ---------------------------------------------------------------------------

type RoEntry = { target: Element; cb: ResizeObserverCallback; instance: MockRO };
const roEntries: RoEntry[] = [];
const roInstances: MockRO[] = [];

class MockRO {
  cb: ResizeObserverCallback;
  observe = vi.fn((target: Element) => {
    roEntries.push({ target, cb: this.cb, instance: this });
  });
  disconnect = vi.fn(() => {
    for (let i = roEntries.length - 1; i >= 0; i--) {
      if (roEntries[i].instance === this) roEntries.splice(i, 1);
    }
  });
  unobserve = vi.fn();
  constructor(cb: ResizeObserverCallback) {
    this.cb = cb;
    roInstances.push(this);
  }
}

function fireResize(target: Element) {
  act(() => {
    for (const entry of roEntries) {
      if (entry.target === target) {
        entry.cb([], {} as ResizeObserver);
      }
    }
  });
}

async function flushAnimationFrame() {
  await act(async () => {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

// ---------------------------------------------------------------------------
// matchMedia stub factory
// ---------------------------------------------------------------------------

function makeMatchMedia(matches: boolean) {
  return {
    matches,
    media: PREVIEW_DESKTOP_UPSCALE_MQ,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Mutable backing values shared between harness and tests
// ---------------------------------------------------------------------------

const viewportWidth = { current: 400 };
const sheetScrollHeight = { current: 100 };

// ---------------------------------------------------------------------------
// Test harness component
// ---------------------------------------------------------------------------

interface HarnessProps {
  refreshKey?: string | number;
  fitPageHeightPx?: number;
  maxVisiblePageCount?: number;
}

function ScaledPreviewHarness({
  refreshKey = 'a',
  fitPageHeightPx,
  maxVisiblePageCount,
}: HarnessProps) {
  const { viewportRef, sheetRef, scale, spacerWidth, spacerHeight, letterWidthPx } =
    useScaledPreview({ fitPageHeightPx, maxVisiblePageCount }, refreshKey);

  return (
    <div
      ref={(el) => {
        if (el) {
          // Attach mock before layout effects read the rect
          vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({
            width: viewportWidth.current,
          } as DOMRect);
          // Re-spy on each render to pick up viewportWidth.current at call time
          // by wrapping in a function-returning mock
          vi.spyOn(el, 'getBoundingClientRect').mockImplementation(function () {
            return { width: viewportWidth.current } as DOMRect;
          });
        }
        (viewportRef as (node: HTMLDivElement | null) => void)(el);
      }}
    >
      <div
        ref={(el) => {
          if (el) {
            Object.defineProperty(el, 'scrollHeight', {
              configurable: true,
              get() {
                return sheetScrollHeight.current;
              },
            });
          }
          (sheetRef as (node: HTMLDivElement | null) => void)(el);
        }}
      />
      <div
        data-testid="probe"
        data-scale={scale}
        data-spacer-width={spacerWidth}
        data-spacer-height={spacerHeight}
        data-letter-width={letterWidthPx}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

afterEach(() => {
  cleanup();
  roEntries.length = 0;
  roInstances.length = 0;
  vi.restoreAllMocks();
  viewportWidth.current = 400;
  sheetScrollHeight.current = 100;
});

// ---------------------------------------------------------------------------
// Mount helper
// ---------------------------------------------------------------------------

function mountHarness(
  overrides: {
    matchMedia?: ReturnType<typeof makeMatchMedia>;
    refreshKey?: string | number;
    fitPageHeightPx?: number;
    maxVisiblePageCount?: number;
  } = {}
) {
  const mm = overrides.matchMedia ?? makeMatchMedia(false);
  vi.stubGlobal('ResizeObserver', MockRO);
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: vi.fn().mockReturnValue(mm),
  });
  const utils = render(
    <ScaledPreviewHarness
      refreshKey={overrides.refreshKey ?? 'a'}
      fitPageHeightPx={overrides.fitPageHeightPx}
      maxVisiblePageCount={overrides.maxVisiblePageCount}
    />
  );
  const probe = () => utils.getByTestId('probe');
  const getScale = () => parseFloat(probe().getAttribute('data-scale')!);
  const getSpacerWidth = () => parseFloat(probe().getAttribute('data-spacer-width')!);
  const getSpacerHeight = () => parseFloat(probe().getAttribute('data-spacer-height')!);
  return { ...utils, probe, getScale, getSpacerWidth, getSpacerHeight, mm };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useScaledPreview', () => {
  it('exports shared layout constants', () => {
    expect(PREVIEW_LETTER_WIDTH_PX).toBe(816);
    expect(PREVIEW_DESKTOP_UPSCALE_MQ).toBe('(min-width: 1024px)');
  });

  it('scale = width / 816 when below max (non-desktop)', () => {
    viewportWidth.current = 400;
    const { getScale, getSpacerWidth } = mountHarness({ matchMedia: makeMatchMedia(false) });
    const expected = 400 / 816;
    expect(getScale()).toBeCloseTo(expected, 5);
    expect(getSpacerWidth()).toBeCloseTo(816 * expected, 2);
  });

  it('caps scale at 1 on non-desktop when width > 816', () => {
    viewportWidth.current = 2000;
    const { getScale, getSpacerWidth } = mountHarness({ matchMedia: makeMatchMedia(false) });
    expect(getScale()).toBe(1);
    expect(getSpacerWidth()).toBe(816);
  });

  it('caps scale at 1.5 on desktop when width is very large', () => {
    viewportWidth.current = 5000;
    const { getScale, getSpacerWidth } = mountHarness({ matchMedia: makeMatchMedia(true) });
    expect(getScale()).toBe(1.5);
    expect(getSpacerWidth()).toBeCloseTo(816 * 1.5, 2);
  });

  it('spacerHeight = scrollHeight * scale', () => {
    viewportWidth.current = 408; // scale ≈ 0.5
    sheetScrollHeight.current = 200;
    const { getScale, getSpacerHeight } = mountHarness({ matchMedia: makeMatchMedia(false) });
    const scale = getScale();
    expect(scale).toBeCloseTo(0.5, 5);
    expect(getSpacerHeight()).toBeCloseTo(200 * scale, 2);
  });

  it('caps scale by fitPageHeightPx when provided', () => {
    viewportWidth.current = 500;
    sheetScrollHeight.current = PREVIEW_LETTER_HEIGHT_PX * 2;
    const { getScale, getSpacerHeight } = mountHarness({
      matchMedia: makeMatchMedia(false),
      fitPageHeightPx: 280,
    });

    expect(getScale()).toBeCloseTo(280 / PREVIEW_LETTER_HEIGHT_PX, 5);
    expect(getSpacerHeight()).toBeCloseTo(
      sheetScrollHeight.current * (280 / PREVIEW_LETTER_HEIGHT_PX),
      2
    );
  });

  it('caps scale by fitPageHeightPx when provided', () => {
    viewportWidth.current = 500;
    sheetScrollHeight.current = PREVIEW_LETTER_HEIGHT_PX * 2;
    const { getScale, getSpacerHeight } = mountHarness({
      matchMedia: makeMatchMedia(false),
      fitPageHeightPx: 280,
    });

    expect(getScale()).toBeCloseTo(280 / PREVIEW_LETTER_HEIGHT_PX, 5);
    expect(getSpacerHeight()).toBeCloseTo(
      sheetScrollHeight.current * (280 / PREVIEW_LETTER_HEIGHT_PX),
      2
    );
  });

  it('clips spacerHeight to the requested visible page count (with fitPageHeightPx)', () => {
    viewportWidth.current = 500;
    sheetScrollHeight.current = PREVIEW_LETTER_HEIGHT_PX * 3;
    const { getScale, getSpacerHeight } = mountHarness({
      matchMedia: makeMatchMedia(false),
      fitPageHeightPx: 280,
      maxVisiblePageCount: 1,
    });

    expect(getScale()).toBeCloseTo(280 / PREVIEW_LETTER_HEIGHT_PX, 5);
    expect(getSpacerHeight()).toBeCloseTo(280, 2);
  });

  it('clips spacerHeight to the requested visible page count (maxVisiblePageCount only)', () => {
    viewportWidth.current = 500;
    sheetScrollHeight.current = PREVIEW_LETTER_HEIGHT_PX * 3;
    const { getScale, getSpacerHeight } = mountHarness({
      matchMedia: makeMatchMedia(false),
      maxVisiblePageCount: 1,
    });

    // No fitPageHeightPx, so scale is width-only
    expect(getScale()).toBeCloseTo(500 / 816, 5);
    // spacerHeight = min(sheetScrollHeight, 1 page) * scale = 1056 * scale
    expect(getSpacerHeight()).toBeCloseTo(PREVIEW_LETTER_HEIGHT_PX * getScale(), 2);
  });

  it('deps change causes height effect to re-run and spacerHeight updates', () => {
    viewportWidth.current = 816; // scale ≈ 1
    sheetScrollHeight.current = 100;
    const mm = makeMatchMedia(false);
    const { rerender, getByTestId } = mountHarness({ matchMedia: mm, refreshKey: 'a' });

    sheetScrollHeight.current = 200;
    act(() => {
      rerender(<ScaledPreviewHarness refreshKey="b" />);
    });

    const spacerHeight = parseFloat(getByTestId('probe').getAttribute('data-spacer-height')!);
    expect(spacerHeight).toBeCloseTo(200, 1);
  });

  it('resize event updates scale', async () => {
    viewportWidth.current = 400;
    mountHarness({ matchMedia: makeMatchMedia(false) });

    viewportWidth.current = 816;
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    await flushAnimationFrame();

    const probe = document.querySelector('[data-testid="probe"]')!;
    const scale = parseFloat(probe.getAttribute('data-scale')!);
    expect(scale).toBeCloseTo(1, 5);
  });

  it('ResizeObserver fires via viewport RO callback and updates scale', async () => {
    viewportWidth.current = 400;
    const { getScale } = mountHarness({ matchMedia: makeMatchMedia(false) });
    expect(getScale()).toBeCloseTo(400 / 816, 5);

    viewportWidth.current = 816;
    // viewport div is the outermost rendered element (parent of sheet + probe)
    const probe = document.querySelector('[data-testid="probe"]')!;
    const viewport = probe.parentElement!;
    fireResize(viewport);
    await flushAnimationFrame();

    expect(getScale()).toBeCloseTo(1, 5);
  });

  it('cleanup on unmount: disconnects observers and removes listeners', () => {
    const mm = makeMatchMedia(false);
    const windowRemoveSpy = vi.spyOn(window, 'removeEventListener');

    const { unmount } = mountHarness({ matchMedia: mm });

    // Capture current instances before unmount
    const instances = [...roInstances];
    expect(instances.length).toBeGreaterThan(0);

    act(() => {
      unmount();
    });

    for (const inst of instances) {
      expect(inst.disconnect).toHaveBeenCalled();
    }

    expect(mm.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    expect(windowRemoveSpy).toHaveBeenCalledWith('resize', expect.any(Function));

    windowRemoveSpy.mockRestore();
  });
});
