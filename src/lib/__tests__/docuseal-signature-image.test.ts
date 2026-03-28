// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { buildDocusealProviderSignatureImage } from '../docuseal-signature-image';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('docuseal-signature-image', () => {
  it('returns a PNG data URL for a normal owner name', async () => {
    const loadMock = vi.fn(async () => []);
    Object.defineProperty(document, 'fonts', {
      configurable: true,
      value: { load: loadMock },
    });

    const clearRect = vi.fn();
    const fillText = vi.fn();
    const context = {
      font: '',
      fillStyle: '',
      textBaseline: 'alphabetic' as CanvasTextBaseline,
      clearRect,
      measureText: vi.fn(() => ({ width: 164 })),
      fillText,
    } as unknown as CanvasRenderingContext2D;

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context);
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,abc123');

    const out = await buildDocusealProviderSignatureImage('Pat Welder');

    expect(out).toBe('data:image/png;base64,abc123');
    expect(loadMock).toHaveBeenCalled();
    expect(fillText).toHaveBeenCalledWith('Pat Welder', expect.any(Number), expect.any(Number));
    expect(clearRect).toHaveBeenCalled();
  });

  it('returns null for blank input', async () => {
    await expect(buildDocusealProviderSignatureImage('   ')).resolves.toBeNull();
  });
});
