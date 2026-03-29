import { useCallback, useEffect, useRef, useState } from 'react';
import type { Invoice, Job, WorkOrderInvoiceStatus } from '../types/db';

export type WorkOrderRowActionsDeps = {
  userId: string;
  getJobById: (jobId: string) => Promise<Job | null>;
  getInvoice: (invoiceId: string) => Promise<Invoice | null>;
  onOpenWorkOrderDetail: (jobId: string, targetSection?: 'top' | 'change-orders') => void;
  onStartInvoice: (job: Job) => void;
  onOpenPendingInvoice: (job: Job, invoice: Invoice) => void;
};

/**
 * Per-row hydration + loading locks for work order list actions.
 * One row busy does not block other rows.
 */
export function useWorkOrderRowActions({
  userId,
  getJobById,
  getInvoice,
  onOpenWorkOrderDetail,
  onStartInvoice,
  onOpenPendingInvoice,
}: WorkOrderRowActionsDeps) {
  const [actionLoadingJobIds, setActionLoadingJobIds] = useState<Set<string>>(() => new Set());
  const actionLoadingIdsRef = useRef<Set<string>>(new Set());
  const jobCacheRef = useRef<Map<string, Job>>(new Map());
  const invoiceCacheRef = useRef<Map<string, Invoice>>(new Map());
  const inflightJobRequestsRef = useRef<Map<string, Promise<Job | null>>>(new Map());
  const inflightInvoiceRequestsRef = useRef<Map<string, Promise<Invoice | null>>>(new Map());

  useEffect(() => {
    jobCacheRef.current = new Map();
    invoiceCacheRef.current = new Map();
    inflightJobRequestsRef.current = new Map();
    inflightInvoiceRequestsRef.current = new Map();
    actionLoadingIdsRef.current = new Set();
    setActionLoadingJobIds(new Set());
  }, [userId]);

  const beginRowAction = (jobId: string) => {
    if (actionLoadingIdsRef.current.has(jobId)) return false;
    actionLoadingIdsRef.current.add(jobId);
    setActionLoadingJobIds(new Set(actionLoadingIdsRef.current));
    return true;
  };

  const endRowAction = (jobId: string) => {
    actionLoadingIdsRef.current.delete(jobId);
    setActionLoadingJobIds(new Set(actionLoadingIdsRef.current));
  };

  const getHydratedJob = useCallback(async (jobId: string): Promise<Job | null> => {
    const cached = jobCacheRef.current.get(jobId);
    if (cached) return cached;

    const inflight = inflightJobRequestsRef.current.get(jobId);
    if (inflight) return inflight;

    const request = getJobById(jobId)
      .then((job) => {
        if (job) jobCacheRef.current.set(jobId, job);
        return job;
      })
      .finally(() => {
        inflightJobRequestsRef.current.delete(jobId);
      });
    inflightJobRequestsRef.current.set(jobId, request);
    return request;
  }, [getJobById]);

  const getHydratedInvoice = useCallback(async (invoiceId: string): Promise<Invoice | null> => {
    const cached = invoiceCacheRef.current.get(invoiceId);
    if (cached) return cached;

    const inflight = inflightInvoiceRequestsRef.current.get(invoiceId);
    if (inflight) return inflight;

    const request = getInvoice(invoiceId)
      .then((invoice) => {
        if (invoice) invoiceCacheRef.current.set(invoiceId, invoice);
        return invoice;
      })
      .finally(() => {
        inflightInvoiceRequestsRef.current.delete(invoiceId);
      });
    inflightInvoiceRequestsRef.current.set(invoiceId, request);
    return request;
  }, [getInvoice]);

  const runWithJobHydration = useCallback(async (
    listJob: { id: string },
    fn: (fullJob: Job) => void
  ) => {
    if (!beginRowAction(listJob.id)) return;
    try {
      const full = await getHydratedJob(listJob.id);
      if (full) fn(full);
      else console.error('WorkOrdersPage: getJobById returned no row for', listJob.id);
    } finally {
      endRowAction(listJob.id);
    }
  }, [getHydratedJob]);

  const handleOpenDetail = useCallback((listJob: { id: string }) => {
    onOpenWorkOrderDetail(listJob.id);
  }, [onOpenWorkOrderDetail]);

  const handleStartInvoice = useCallback((listJob: { id: string }) => {
    void runWithJobHydration(listJob, (full) => onStartInvoice(full));
  }, [onStartInvoice, runWithJobHydration]);

  const handleOpenPendingInvoice = useCallback((listJob: { id: string }, status: WorkOrderInvoiceStatus) => {
    if (!beginRowAction(listJob.id)) return;
    void (async () => {
      try {
        const [fullJob, fullInv] = await Promise.all([
          getHydratedJob(listJob.id),
          getHydratedInvoice(status.id),
        ]);
        if (fullJob && fullInv) onOpenPendingInvoice(fullJob, fullInv);
        else console.error('WorkOrdersPage: missing full job or invoice for pending flow');
      } finally {
        endRowAction(listJob.id);
      }
    })();
  }, [getHydratedInvoice, getHydratedJob, onOpenPendingInvoice]);

  return {
    busyJobIds: actionLoadingJobIds,
    handleOpenDetail,
    handleStartInvoice,
    handleOpenPendingInvoice,
  };
}
