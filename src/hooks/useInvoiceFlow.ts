import { useState, useCallback, useRef, useEffect } from 'react';
import type { ChangeOrder, Job, Invoice } from '../types/db';
import type { AppView } from './useAppNavigation';

export type InvoiceFlowState = {
  invoiceFlowJob: Job | null;
  invoiceFlowChangeOrder: ChangeOrder | null;
  invoiceFlowTarget: 'job' | 'change_order' | null;
  wizardExistingInvoice: Invoice | null;
  activeInvoice: Invoice | null;
  refreshKey: number;
};

const initialInvoice: InvoiceFlowState = {
  invoiceFlowJob: null,
  invoiceFlowChangeOrder: null,
  invoiceFlowTarget: null,
  wizardExistingInvoice: null,
  activeInvoice: null,
  refreshKey: 0,
};

type LoadProfile = (opts?: { silent?: boolean }) => void | Promise<void>;

export function useInvoiceFlow(
  navigateTo: (view: AppView) => void,
  loadProfile: LoadProfile
) {
  const [invoice, setInvoice] = useState<InvoiceFlowState>(initialInvoice);
  const invoiceRef = useRef(invoice);
  useEffect(() => {
    invoiceRef.current = invoice;
  }, [invoice]);

  const handleStartInvoice = useCallback(
    (jobRow: Job) => {
      setInvoice((inv) => ({
        ...inv,
        invoiceFlowJob: jobRow,
        invoiceFlowChangeOrder: null,
        invoiceFlowTarget: 'job',
        wizardExistingInvoice: null,
        activeInvoice: null,
      }));
      navigateTo('invoice-wizard');
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
      }));
      navigateTo('invoice-wizard');
    },
    [navigateTo]
  );

  const handleOpenPendingInvoice = useCallback(
    (jobRow: Job, inv: Invoice) => {
      setInvoice((i) => ({
        ...i,
        invoiceFlowJob: jobRow,
        invoiceFlowChangeOrder: null,
        invoiceFlowTarget: 'job',
        wizardExistingInvoice: null,
        activeInvoice: inv,
      }));
      navigateTo('invoice-final');
    },
    [navigateTo]
  );

  const handleOpenPendingChangeOrderInvoice = useCallback(
    (jobRow: Job, changeOrder: ChangeOrder, inv: Invoice) => {
      setInvoice((i) => ({
        ...i,
        invoiceFlowJob: jobRow,
        invoiceFlowChangeOrder: changeOrder,
        invoiceFlowTarget: 'change_order',
        wizardExistingInvoice: null,
        activeInvoice: inv,
      }));
      navigateTo('invoice-final');
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
      navigateTo('invoice-final');
      void loadProfile({ silent: true });
    },
    [navigateTo, loadProfile]
  );

  const handleInvoiceWizardCancel = useCallback(() => {
    const i = invoiceRef.current;
    if (i.wizardExistingInvoice) {
      setInvoice((prev) => ({ ...prev, wizardExistingInvoice: null }));
      navigateTo('invoice-final');
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

  const handleInvoiceFinalWorkOrders = useCallback(() => {
    navigateTo('work-orders');
    setInvoice((i) => ({
      ...i,
      invoiceFlowJob: null,
      invoiceFlowChangeOrder: null,
      invoiceFlowTarget: null,
      activeInvoice: null,
      wizardExistingInvoice: null,
      refreshKey: i.refreshKey + 1,
    }));
  }, [navigateTo]);

  const handleEditInvoice = useCallback(() => {
    if (!invoiceRef.current.activeInvoice) return;
    setInvoice((i) => ({
      ...i,
      wizardExistingInvoice: i.activeInvoice,
    }));
    navigateTo('invoice-wizard');
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
      handleInvoiceFinalWorkOrders,
      handleEditInvoice,
      handleInvoiceUpdated,
      resetInvoiceFlow,
    },
  };
}
