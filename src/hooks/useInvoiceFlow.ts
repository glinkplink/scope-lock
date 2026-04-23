import { useState, useCallback, useRef, useEffect } from 'react';
import type { Job, Invoice } from '../types/db';
import type { AppRouteParams, AppView } from './useAppNavigation';
import { getInvoiceByJobId } from '../lib/db/invoices';

export type InvoiceFlowState = {
  invoiceFlowJob: Job | null;
  wizardExistingInvoice: Invoice | null;
  activeInvoice: Invoice | null;
  invoiceFinalReturnView: 'work-orders' | 'invoices' | 'home';
  refreshKey: number;
};

const initialInvoice: InvoiceFlowState = {
  invoiceFlowJob: null,
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
          wizardExistingInvoice: null,
          activeInvoice: null,
          invoiceFinalReturnView: 'work-orders',
        }));
        navigateTo('invoice-wizard', { jobId: jobRow.id });
      })();
    },
    [navigateTo]
  );

  const handleOpenPendingInvoice = useCallback(
    (jobRow: Job, inv: Invoice, returnView: 'work-orders' | 'invoices' | 'home' = 'work-orders') => {
      setInvoice((i) => ({
        ...i,
        invoiceFlowJob: jobRow,
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
      handleOpenPendingInvoice,
      handleInvoiceWizardSuccess,
      handleInvoiceWizardCancel,
      handleInvoiceFinalBack,
      handleEditInvoice,
      handleInvoiceUpdated,
      resetInvoiceFlow,
    },
  };
}
