const SIGNATURE_FONT = "'Dancing Script', cursive";
const SIGNATURE_FONT_SIZE_PX = 40;
const SIGNATURE_LINE_HEIGHT_PX = 1.15;
const SIGNATURE_COLOR = '#1A1917';
const HORIZONTAL_PADDING_PX = 12;
const VERTICAL_PADDING_PX = 10;
const MIN_WIDTH_PX = 220;
const MAX_WIDTH_PX = 420;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export async function buildDocusealProviderSignatureImage(
  ownerName: string
): Promise<string | null> {
  const trimmedName = ownerName.trim();
  if (!trimmedName || typeof document === 'undefined') return null;

  try {
    await document.fonts?.load?.(`400 ${SIGNATURE_FONT_SIZE_PX}px ${SIGNATURE_FONT}`);
  } catch {
    // Best-effort font preload only; proceed with whatever the browser resolved.
  }

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) return null;

  const font = `400 ${SIGNATURE_FONT_SIZE_PX}px ${SIGNATURE_FONT}`;
  context.font = font;
  const measuredWidth = Math.ceil(context.measureText(trimmedName).width);
  const width = clamp(measuredWidth + HORIZONTAL_PADDING_PX * 2, MIN_WIDTH_PX, MAX_WIDTH_PX);
  const height = Math.ceil(SIGNATURE_FONT_SIZE_PX * SIGNATURE_LINE_HEIGHT_PX) + VERTICAL_PADDING_PX * 2;

  canvas.width = width;
  canvas.height = height;

  context.clearRect(0, 0, width, height);
  context.font = font;
  context.fillStyle = SIGNATURE_COLOR;
  context.textBaseline = 'alphabetic';
  context.fillText(trimmedName, HORIZONTAL_PADDING_PX, height - VERTICAL_PADDING_PX);

  try {
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}
