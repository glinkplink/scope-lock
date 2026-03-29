import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ChangeOrder,
  Invoice,
  Job,
  WorkOrderListChangeOrderPreview,
  WorkOrderInvoiceStatus,
  WorkOrderListJob,
} from '../types/db';

export type WorkOrderRowActionsDeps = {
  userId: string;
  getJobById: (jobId: string) => Promise<Job | null>;
  getChangeOrderById: (changeOrderId: string) => Promise<ChangeOrder | null>;
  getInvoice: (invoiceId: string) => Promise<Invoice | null>;
  onOpenWorkOrderDetail: (jobId: string) => void;
  onOpenChangeOrderDetail: (job: Job, changeOrder: ChangeOrder) => void;
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
  getChangeOrderById,
  getInvoice,
  onOpenWorkOrderDetail,
  onOpenChangeOrderDetail,
  onStartInvoice,
  onOpenPendingInvoice,
}: WorkOrderRowActionsDeps) {
  const [actionLoadingJobIds, setActionLoadingJobIds] = useState<Set<string>>(() => new Set());
  const actionLoadingIdsRef = useRef<Set<string>>(new Set());
  const jobCacheRef = useRef<Map<string, Job>>(new Map());
  const changeOrderCacheRef = useRef<Map<string, ChangeOrder>>(new Map());
  const invoiceCacheRef = useRef<Map<string, Invoice>>(new Map());
  const inflightJobRequestsRef = useRef<Map<string, Promise<Job | null>>>(new Map());
  const inflightChangeOrderRequestsRef = useRef<Map<string, Promise<ChangeOrder | null>>>(new Map());
  const inflightInvoiceRequestsRef = useRef<Map<string, Promise<Invoice | null>>>(new Map());

  useEffect(() => {
    jobCacheRef.current = new Map();
    changeOrderCacheRef.current = new Map();
    invoiceCacheRef.current = new Map();
    inflightJobRequestsRef.current = new Map();
    inflightChangeOrderRequestsRef.current = new Map();
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

  const getHydratedChangeOrder = useCallback(async (changeOrderId: string): Promise<ChangeOrder | null> => {
    const cached = changeOrderCacheRef.current.get(changeOrderId);
    if (cached) return cached;

    const inflight = inflightChangeOrderRequestsRef.current.get(changeOrderId);
    if (inflight) return inflight;

    const request = getChangeOrderById(changeOrderId)
      .then((changeOrder) => {
        if (changeOrder) changeOrderCacheRef.current.set(changeOrderId, changeOrder);
        return changeOrder;
      })
      .finally(() => {
        inflightChangeOrderRequestsRef.current.delete(changeOrderId);
      });
    inflightChangeOrderRequestsRef.current.set(changeOrderId, request);
    return request;
  }, [getChangeOrderById]);

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

  const prefetchJob = useCallback((jobId: string) => {
    void getHydratedJob(jobId);
  }, [getHydratedJob]);

  const runWithJobHydration = async (
    listJob: WorkOrderListJob,
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
  };

  const handleOpenDetail = useCallback((listJob: WorkOrderListJob) => {
    onOpenWorkOrderDetail(listJob.id);
  }, [onOpenWorkOrderDetail]);

  const handleStartInvoice = useCallback((listJob: WorkOrderListJob) => {
    void runWithJobHydration(listJob, (full) => onStartInvoice(full));
  }, [onStartInvoice]);

  const handleOpenChangeOrderDetail = useCallback((
    listJob: WorkOrderListJob,
    changeOrderPreview: WorkOrderListChangeOrderPreview
  ) => {
    if (!beginRowAction(listJob.id)) return;
    void (async () => {
      try {
        const [fullJob, fullChangeOrder] = await Promise.all([
          getHydratedJob(listJob.id),
          getHydratedChangeOrder(changeOrderPreview.id),
        ]);

        if (fullJob && fullChangeOrder) {
          onOpenChangeOrderDetail(fullJob, fullChangeOrder);
        } else {
          console.error('WorkOrdersPage: missing full job or change order for detail flow');
        }
      } finally {
        endRowAction(listJob.id);
      }
    })();
  }, [getHydratedChangeOrder, getHydratedJob, onOpenChangeOrderDetail]);

  const handleOpenPendingInvoice = useCallback((listJob: WorkOrderListJob, status: WorkOrderInvoiceStatus) => {
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
    handleOpenChangeOrderDetail,
    handleStartInvoice,
    handleOpenPendingInvoice,
    prefetchJob,
  };
}
