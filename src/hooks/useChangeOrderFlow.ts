import { useState, useCallback, useRef, useEffect, type Dispatch, type SetStateAction } from 'react';
import type { Job, ChangeOrder } from '../types/db';
import type { AppView } from './useAppNavigation';

export type ChangeOrderFlowState = {
  changeOrderFlowJob: Job | null;
  wizardExistingCO: ChangeOrder | null;
  coDetailCO: ChangeOrder | null;
};

const initialChangeOrder: ChangeOrderFlowState = {
  changeOrderFlowJob: null,
  wizardExistingCO: null,
  coDetailCO: null,
};

export function useChangeOrderFlow(
  workOrderDetailJob: Job | null,
  navigateTo: (view: AppView) => void,
  setChangeOrderListVersion: Dispatch<SetStateAction<number>>
) {
  const [changeOrder, setChangeOrder] = useState<ChangeOrderFlowState>(initialChangeOrder);
  const changeOrderRef = useRef(changeOrder);
  useEffect(() => {
    changeOrderRef.current = changeOrder;
  }, [changeOrder]);

  const resetFlowForBackToList = useCallback(() => {
    setChangeOrder((co) => ({
      ...co,
      changeOrderFlowJob: null,
      wizardExistingCO: null,
      coDetailCO: null,
    }));
  }, []);

  const handleStartChangeOrderFromDetail = useCallback(() => {
    if (!workOrderDetailJob) return;
    setChangeOrder((co) => ({
      ...co,
      changeOrderFlowJob: workOrderDetailJob,
      wizardExistingCO: null,
    }));
    navigateTo('change-order-wizard');
  }, [workOrderDetailJob, navigateTo]);

  const handleOpenCODetail = useCallback(
    (co: ChangeOrder) => {
      setChangeOrder((c) => ({ ...c, coDetailCO: co }));
      navigateTo('co-detail');
    },
    [navigateTo]
  );

  const handleBackFromCODetail = useCallback(() => {
    setChangeOrder((c) => ({ ...c, coDetailCO: null }));
    navigateTo('work-order-detail');
  }, [navigateTo]);

  const handleEditCOFromDetail = useCallback(
    (co: ChangeOrder) => {
      if (!workOrderDetailJob) return;
      setChangeOrder((c) => ({
        ...c,
        changeOrderFlowJob: workOrderDetailJob,
        wizardExistingCO: co,
      }));
      navigateTo('change-order-wizard');
    },
    [workOrderDetailJob, navigateTo]
  );

  const handleDeleteCOFromDetail = useCallback(() => {
    setChangeOrder((c) => ({ ...c, coDetailCO: null }));
    setChangeOrderListVersion((v) => v + 1);
    navigateTo('work-order-detail');
  }, [navigateTo, setChangeOrderListVersion]);

  const handleChangeOrderWizardComplete = useCallback((savedCo: ChangeOrder) => {
    setChangeOrder((c) => ({
      ...c,
      wizardExistingCO: null,
      changeOrderFlowJob: null,
      coDetailCO: savedCo,
    }));
    setChangeOrderListVersion((v) => v + 1);
    navigateTo('co-detail');
  }, [navigateTo, setChangeOrderListVersion]);

  const handleChangeOrderWizardCancel = useCallback(() => {
    const c = changeOrderRef.current;
    const wasEditing = c.wizardExistingCO !== null;
    const hadDetail = c.coDetailCO;
    setChangeOrder((prev) => ({
      ...prev,
      wizardExistingCO: null,
      changeOrderFlowJob: null,
    }));
    if (wasEditing && hadDetail) {
      navigateTo('co-detail');
    } else {
      navigateTo('work-order-detail');
    }
  }, [navigateTo]);

  const resetChangeOrderFlow = useCallback(() => {
    setChangeOrder(initialChangeOrder);
  }, []);

  const handleCoEsignUpdated = useCallback(
    (updatedCo: ChangeOrder) => {
      setChangeOrder((c) => ({ ...c, coDetailCO: updatedCo }));
    },
    []
  );

  return {
    state: changeOrder,
    actions: {
      resetFlowForBackToList,
      handleStartChangeOrderFromDetail,
      handleOpenCODetail,
      handleBackFromCODetail,
      handleEditCOFromDetail,
      handleDeleteCOFromDetail,
      handleChangeOrderWizardComplete,
      handleChangeOrderWizardCancel,
      resetChangeOrderFlow,
      handleCoEsignUpdated,
    },
  };
}
