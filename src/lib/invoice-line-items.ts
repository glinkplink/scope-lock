import type {
  BusinessProfile,
  ChangeOrder,
  ChangeOrderLineItem,
  Invoice,
  InvoiceLineItem,
  InvoiceLineItemSource,
  Job,
} from '../types/db';
import { DEFAULT_TAX_RATE, taxRateToPercentValue } from './tax';

const LEGACY_CO_LINE_RE = /^Change Order\s*#/i;
const ORIGINAL_SCOPE_MAX_LEN = 500;
const CO_DESCRIPTION_MAX_LEN = 60;

export interface MaterialRow {
  description: string;
  qty: string;
  unit_price: string;
}

export interface LaborRow {
  description: string;
  qty: string;
  rate: string;
}

export interface ParsedInvoiceState {
  fixedTotal: number;
  laborRows: LaborRow[];
  materialsYes: boolean;
  materialRows: MaterialRow[];
  due_date: string;
  taxPercent: string;
  structuredLineMetadata: boolean;
}

type EditableLineSource = Extract<InvoiceLineItemSource, 'original_scope' | 'labor' | 'material'>;

type BuildInvoiceLineItemsOpts = {
  job: Job;
  fixedTotal: number;
  laborRows: LaborRow[];
  materialsYes: boolean;
  materialRows: MaterialRow[];
  selectedCOs: ChangeOrder[];
  existingLineItems?: InvoiceLineItem[];
};

function roundCurrency(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function nextLineId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `invli-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeLinePosition(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function hasLineMetadata(line: InvoiceLineItem): boolean {
  return (
    typeof line.id === 'string' &&
    line.id.trim() !== '' &&
    normalizeLinePosition(line.position) !== null &&
    typeof line.source === 'string'
  );
}

function safeTrim(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function takeId(pool: Record<EditableLineSource, string[]>, source: EditableLineSource): string {
  return pool[source].shift() ?? nextLineId();
}

function buildEditableIdPool(lineItems: InvoiceLineItem[]): Record<EditableLineSource, string[]> {
  const pool: Record<EditableLineSource, string[]> = {
    original_scope: [],
    labor: [],
    material: [],
  };

  for (const line of sortInvoiceLineItems(lineItems)) {
    if (!hasLineMetadata(line)) continue;
    if (
      line.source === 'original_scope' ||
      line.source === 'labor' ||
      line.source === 'material'
    ) {
      pool[line.source].push(line.id as string);
    }
  }

  return pool;
}

function normalizeChangeOrderLineItems(raw: unknown): ChangeOrderLineItem[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item): item is ChangeOrderLineItem => typeof item === 'object' && item !== null)
    .map((item) => ({
      id: String(item.id ?? ''),
      description: String(item.description ?? ''),
      quantity: Number(item.quantity) || 0,
      unit_rate: Number(item.unit_rate) || 0,
    }));
}

function computeSafeCOTotal(lineItems: ChangeOrder['line_items'] | null | undefined): number | null {
  if (!Array.isArray(lineItems)) return null;
  const normalized = normalizeChangeOrderLineItems(lineItems);
  const totalCents = normalized.reduce((sum, item) => {
    const lineTotal = Number(item.quantity) * Number(item.unit_rate);
    if (!Number.isFinite(lineTotal)) return sum;
    return sum + Math.round((lineTotal + Number.EPSILON) * 100);
  }, 0);
  const total = totalCents / 100;
  return Number.isFinite(total) ? total : null;
}

function isLegacyHeuristicChangeOrderLine(line: InvoiceLineItem): boolean {
  return (!line.source || line.source === 'legacy') && LEGACY_CO_LINE_RE.test(line.description.trim());
}

function isPreservedChangeOrderLine(line: InvoiceLineItem, structured: boolean): boolean {
  if (structured) return line.source === 'change_order';
  return line.source === 'change_order' || isLegacyHeuristicChangeOrderLine(line);
}

export function hasStructuredInvoiceLineMetadata(lineItems: InvoiceLineItem[]): boolean {
  return lineItems.length > 0 && lineItems.every(hasLineMetadata);
}

export function sortInvoiceLineItems(lineItems: InvoiceLineItem[]): InvoiceLineItem[] {
  if (!hasStructuredInvoiceLineMetadata(lineItems)) return [...lineItems];
  return [...lineItems].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

export function truncateWithEllipsis(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) return trimmed;
  if (maxLength <= 1) return '…'.slice(0, maxLength);
  return `${trimmed.slice(0, maxLength - 1).trimEnd()}…`;
}

export function originalScopeDescription(job: Job): string {
  const asset = safeTrim(job.asset_or_item_description);
  const requested = safeTrim(job.requested_work);

  if (!asset && !requested) return 'Original scope';
  if (!asset) return truncateWithEllipsis(requested, ORIGINAL_SCOPE_MAX_LEN);
  if (!requested) return truncateWithEllipsis(asset, ORIGINAL_SCOPE_MAX_LEN);

  const separator = ' — ';
  const combined = `${asset}${separator}${requested}`;
  if (combined.length <= ORIGINAL_SCOPE_MAX_LEN) return combined;

  if (asset.length >= ORIGINAL_SCOPE_MAX_LEN) {
    return truncateWithEllipsis(asset, ORIGINAL_SCOPE_MAX_LEN);
  }

  const remaining = ORIGINAL_SCOPE_MAX_LEN - asset.length - separator.length;
  if (remaining <= 1) return truncateWithEllipsis(combined, ORIGINAL_SCOPE_MAX_LEN);

  return `${asset}${separator}${truncateWithEllipsis(requested, remaining)}`;
}

export function formatChangeOrderInvoiceDescription(co: ChangeOrder): string {
  return `Change Order #${String(co.co_number).padStart(4, '0')}: ${truncateWithEllipsis(
    co.description.trim(),
    CO_DESCRIPTION_MAX_LEN
  )}`;
}

export function formatChangeOrderPickerAmount(co: ChangeOrder): string {
  const amount = computeSafeCOTotal(co.line_items);
  return amount === null ? '0.00' : amount.toFixed(2);
}

export function parseExistingIntoInvoiceState(
  job: Job,
  existing: Invoice,
  profile: BusinessProfile
): ParsedInvoiceState {
  const ordered = sortInvoiceLineItems(existing.line_items);
  const structuredLineMetadata = hasStructuredInvoiceLineMetadata(existing.line_items);
  const rest = ordered.filter((line) => !isPreservedChangeOrderLine(line, structuredLineMetadata));
  const laborItems = rest.filter((line) => line.kind === 'labor');
  const materialItems = rest.filter((line) => line.kind === 'material');

  let fixedTotal = job.price;
  let laborRows: LaborRow[];

  if (job.price_type === 'fixed') {
    const scopeLine =
      laborItems.find((line) => line.source === 'original_scope') ??
      laborItems.find((line) => !LEGACY_CO_LINE_RE.test(line.description.trim())) ??
      laborItems[0];
    fixedTotal = scopeLine && Number.isFinite(scopeLine.total) && scopeLine.total > 0 ? scopeLine.total : job.price;
    laborRows = [{ description: 'Labor', qty: '1', rate: '0' }];
  } else {
    laborRows =
      laborItems.length > 0
        ? laborItems.map((line) => ({
            description: line.description,
            qty: String(line.qty),
            rate: String(line.unit_price),
          }))
        : [{ description: 'Labor', qty: '', rate: '' }];
  }

  const materialRows =
    materialItems.length > 0
      ? materialItems.map((line) => ({
          description: line.description,
          qty: String(line.qty),
          unit_price: String(line.unit_price),
        }))
      : [{ description: '', qty: '1', unit_price: '' }];

  return {
    fixedTotal,
    laborRows,
    materialsYes: materialItems.length > 0,
    materialRows,
    due_date: existing.due_date,
    taxPercent: taxRateToPercentValue(existing.tax_rate ?? profile.default_tax_rate ?? DEFAULT_TAX_RATE),
    structuredLineMetadata,
  };
}

function buildEditableInvoiceLineItems(
  job: Job,
  fixedTotal: number,
  laborRows: LaborRow[],
  materialsYes: boolean,
  materialRows: MaterialRow[],
  idPool: Record<EditableLineSource, string[]>
): InvoiceLineItem[] {
  const items: InvoiceLineItem[] = [];

  if (job.price_type === 'fixed') {
    const total = roundCurrency(Math.max(0, Number(fixedTotal) || 0));
    items.push({
      id: takeId(idPool, 'original_scope'),
      kind: 'labor',
      description: originalScopeDescription(job),
      qty: 1,
      unit_price: total,
      total,
      source: 'original_scope',
      position: items.length,
    });
    return items;
  }

  for (const row of laborRows) {
    const qty = Number(row.qty);
    const rate = Number(row.rate);
    if (!row.description.trim() || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(rate) || rate < 0) {
      continue;
    }
    items.push({
      id: takeId(idPool, 'labor'),
      kind: 'labor',
      description: row.description.trim(),
      qty,
      unit_price: rate,
      total: roundCurrency(qty * rate),
      source: 'labor',
      position: items.length,
    });
  }

  if (materialsYes) {
    for (const row of materialRows) {
      const qty = Number(row.qty);
      const unitPrice = Number(row.unit_price);
      if (
        !row.description.trim() ||
        !Number.isFinite(qty) ||
        qty <= 0 ||
        !Number.isFinite(unitPrice) ||
        unitPrice < 0
      ) {
        continue;
      }
      items.push({
        id: takeId(idPool, 'material'),
        kind: 'material',
        description: row.description.trim(),
        qty,
        unit_price: unitPrice,
        total: roundCurrency(qty * unitPrice),
        source: 'material',
        position: items.length,
      });
    }
  }

  return items;
}

function buildChangeOrderInvoiceLines(selectedCOs: ChangeOrder[]): InvoiceLineItem[] {
  const items: InvoiceLineItem[] = [];

  for (const co of selectedCOs) {
    const amount = computeSafeCOTotal(co.line_items);
    if (amount === null || !Number.isFinite(amount)) continue;
    items.push({
      id: nextLineId(),
      kind: 'labor',
      description: formatChangeOrderInvoiceDescription(co),
      qty: 1,
      unit_price: amount,
      total: amount,
      source: 'change_order',
      change_order_id: co.id,
      position: items.length,
    });
  }

  return items;
}

function assignLinePositions(lineItems: InvoiceLineItem[]): InvoiceLineItem[] {
  return lineItems.map((line, index) => ({
    ...line,
    id: typeof line.id === 'string' && line.id.trim() !== '' ? line.id : nextLineId(),
    position: index,
  }));
}

function mergeEditedInvoiceLineItems(
  existingLineItems: InvoiceLineItem[],
  editableLineItems: InvoiceLineItem[],
  structuredLineMetadata: boolean
): InvoiceLineItem[] {
  const merged: InvoiceLineItem[] = [];
  const ordered = sortInvoiceLineItems(existingLineItems);
  let editableIndex = 0;

  for (const line of ordered) {
    if (isPreservedChangeOrderLine(line, structuredLineMetadata)) {
      merged.push(line);
      continue;
    }

    if (editableIndex < editableLineItems.length) {
      merged.push(editableLineItems[editableIndex]);
      editableIndex += 1;
    }
  }

  while (editableIndex < editableLineItems.length) {
    merged.push(editableLineItems[editableIndex]);
    editableIndex += 1;
  }

  return assignLinePositions(merged);
}

export function buildInvoiceLineItems(opts: BuildInvoiceLineItemsOpts): InvoiceLineItem[] {
  const structuredLineMetadata = opts.existingLineItems
    ? hasStructuredInvoiceLineMetadata(opts.existingLineItems)
    : false;
  const idPool = buildEditableIdPool(opts.existingLineItems ?? []);
  const editable = buildEditableInvoiceLineItems(
    opts.job,
    opts.fixedTotal,
    opts.laborRows,
    opts.materialsYes,
    opts.materialRows,
    idPool
  );

  if (opts.existingLineItems) {
    return mergeEditedInvoiceLineItems(opts.existingLineItems, editable, structuredLineMetadata);
  }

  const coItems = buildChangeOrderInvoiceLines(opts.selectedCOs);
  const ordered =
    opts.job.price_type === 'fixed'
      ? [...editable, ...coItems]
      : [...coItems, ...editable];

  return assignLinePositions(ordered);
}
