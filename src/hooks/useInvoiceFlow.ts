import { useState, useCallback, useRef, useEffect } from 'react';
import type { ChangeOrder, Job, Invoice } from '../types/db';
import type { AppRouteParams, AppView } from './useAppNavigation';
import { getInvoiceByJobId } from '../lib/db/invoices';

export type InvoiceFlowState = {
  invoiceFlowJob: Job | null;
  invoiceFlowChangeOrder: ChangeOrder | null;
  invoiceFlowTarget: 'job' | 'change_order' | null;
  wizardExistingInvoice: Invoice | null;
  activeInvoice: Invoice | null;
  invoiceFinalReturnView: 'work-orders' | 'invoices';
  refreshKey: number;
};

const initialInvoice: InvoiceFlowState = {
  invoiceFlowJob: null,
  invoiceFlowChangeOrder: null,
  invoiceFlowTarget: null,
  wizardExistingInvoice: null,
  activeInvoice: null,
  invoiceFinalReturnView: 'work-orders',
  refreshKey: 0,
};

type LoadProfile = (opts?: { silent?: boolean }) => void | Promise<void>;

export function useInvoiceFlow(
  navigateTo: (view: AppView, params?: AppRouteParams) => void,
  loadProfile: LoadProfile
) {
  const [invoice, setInvoice] = useState<InvoiceFlowState>(initialInvoice);
  const invoiceRef = useRef(invoice);
  useEffect(() => {
    invoiceRef.current = invoice;
  }, [invoice]);

  const handleStartInvoice = useCallback(
    (jobRow: Job) => {
      void (async () => {
        const existing = await getInvoiceByJobId(jobRow.id);
        if (existing) {
          setInvoice((inv) => ({
            ...inv,
            invoiceFlowJob: jobRow,
            invoiceFlowChangeOrder: null,
            invoiceFlowTarget: 'job',
            wizardExistingInvoice: null,
            activeInvoice: existing,
            invoiceFinalReturnView: 'work-orders',
          }));
          navigateTo('invoice-final', { invoiceId: existing.id });
          return;
        }

        setInvoice((inv) => ({
          ...inv,
          invoiceFlowJob: jobRow,
          invoiceFlowChangeOrder: null,
          invoiceFlowTarget: 'job',
          wizardExistingInvoice: null,
          activeInvoice: null,
          invoiceFinalReturnView: 'work-orders',
        }));
        navigateTo('invoice-wizard', { jobId: jobRow.id });
      })();
    },
    [navigateTo]
  );

  const handleStartChangeOrderInvoice = useCallback(
    (jobRow: Job, changeOrder: ChangeOrder) => {
      setInvoice((inv) => ({
        ...inv,
        invoiceFlowJob: jobRow,
        invoiceFlowChangeOrder: changeOrder,
        invoiceFlowTarget: 'change_order',
        wizardExistingInvoice: null,
        activeInvoice: null,
        invoiceFinalReturnView: 'work-orders',
      }));
      navigateTo('invoice-wizard', { jobId: jobRow.id, coId: changeOrder.id });
    },
    [navigateTo]
  );

  const handleOpenPendingInvoice = useCallback(
    (jobRow: Job, inv: Invoice, returnView: 'work-orders' | 'invoices' = 'work-orders') => {
      setInvoice((i) => ({
        ...i,
        invoiceFlowJob: jobRow,
        invoiceFlowChangeOrder: null,
        invoiceFlowTarget: 'job',
        wizardExistingInvoice: null,
        activeInvoice: inv,
        invoiceFinalReturnView: returnView,
      }));
      navigateTo('invoice-final', { invoiceId: inv.id });
    },
    [navigateTo]
  );

  const handleOpenPendingChangeOrderInvoice = useCallback(
    (jobRow: Job, changeOrder: ChangeOrder, inv: Invoice, returnView: 'work-orders' | 'invoices' = 'work-orders') => {
      setInvoice((i) => ({
        ...i,
        invoiceFlowJob: jobRow,
        invoiceFlowChangeOrder: changeOrder,
        invoiceFlowTarget: 'change_order',
        wizardExistingInvoice: null,
        activeInvoice: inv,
        invoiceFinalReturnView: returnView,
      }));
      navigateTo('invoice-final', { invoiceId: inv.id });
    },
    [navigateTo]
  );

  const handleInvoiceWizardSuccess = useCallback(
    (inv: Invoice) => {
      setInvoice((i) => ({
        ...i,
        activeInvoice: inv,
        wizardExistingInvoice: null,
      }));
      navigateTo('invoice-final', { invoiceId: inv.id });
      void loadProfile({ silent: true });
    },
    [navigateTo, loadProfile]
  );

  const handleInvoiceWizardCancel = useCallback(() => {
    const i = invoiceRef.current;
    if (i.wizardExistingInvoice) {
      setInvoice((prev) => ({ ...prev, wizardExistingInvoice: null }));
      if (i.activeInvoice?.id) {
        navigateTo('invoice-final', { invoiceId: i.activeInvoice.id });
      } else {
        navigateTo('work-orders');
      }
    } else {
      setInvoice((prev) => ({
        ...prev,
        invoiceFlowJob: null,
        invoiceFlowChangeOrder: null,
        invoiceFlowTarget: null,
        activeInvoice: null,
        refreshKey: prev.refreshKey + 1,
      }));
      navigateTo('work-orders');
    }
  }, [navigateTo]);

  const handleInvoiceFinalBack = useCallback(() => {
    const returnView = invoiceRef.current.invoiceFinalReturnView;
    navigateTo(returnView);
    setInvoice((i) => ({
      ...i,
      invoiceFlowJob: null,
      invoiceFlowChangeOrder: null,
      invoiceFlowTarget: null,
      activeInvoice: null,
      wizardExistingInvoice: null,
      invoiceFinalReturnView: 'work-orders',
      refreshKey: i.refreshKey + 1,
    }));
  }, [navigateTo]);

  const handleEditInvoice = useCallback(() => {
    const current = invoiceRef.current;
    if (!current.activeInvoice || !current.invoiceFlowJob) return;
    setInvoice((i) => ({
      ...i,
      wizardExistingInvoice: i.activeInvoice,
    }));
    navigateTo('invoice-wizard', {
      jobId: current.invoiceFlowJob.id,
      coId: current.invoiceFlowChangeOrder?.id ?? undefined,
      invoiceId: current.activeInvoice.id,
    });
  }, [navigateTo]);

  const handleInvoiceUpdated = useCallback((inv: Invoice) => {
    setInvoice((i) => ({ ...i, activeInvoice: inv }));
  }, []);

  const resetInvoiceFlow = useCallback(() => {
    setInvoice(initialInvoice);
  }, []);

  return {
    state: invoice,
    actions: {
      handleStartInvoice,
      handleStartChangeOrderInvoice,
      handleOpenPendingInvoice,
      handleOpenPendingChangeOrderInvoice,
      handleInvoiceWizardSuccess,
      handleInvoiceWizardCancel,
      handleInvoiceFinalBack,
      handleEditInvoice,
      handleInvoiceUpdated,
      resetInvoiceFlow,
    },
  };
}
