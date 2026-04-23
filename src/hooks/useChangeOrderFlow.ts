import { useState, useCallback, useRef, useEffect, type Dispatch, type SetStateAction } from 'react';
import type { Job, ChangeOrder } from '../types/db';
import type { AppRouteParams, AppView } from './useAppNavigation';

export type ChangeOrderDetailBackTarget = 'work-order-detail' | 'work-orders';

export type ChangeOrderFlowState = {
  changeOrderFlowJob: Job | null;
  wizardExistingCO: ChangeOrder | null;
  coDetailCO: ChangeOrder | null;
  coDetailBackTarget: ChangeOrderDetailBackTarget;
};

const initialChangeOrder: ChangeOrderFlowState = {
  changeOrderFlowJob: null,
  wizardExistingCO: null,
  coDetailCO: null,
  coDetailBackTarget: 'work-order-detail',
};

export function useChangeOrderFlow(
  workOrderDetailJob: Job | null,
  navigateTo: (view: AppView, params?: AppRouteParams) => void,
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
      coDetailBackTarget: 'work-order-detail',
    }));
  }, []);

  const handleStartChangeOrderFromDetail = useCallback(() => {
    if (!workOrderDetailJob) return;
    setChangeOrder((co) => ({
      ...co,
      changeOrderFlowJob: workOrderDetailJob,
      wizardExistingCO: null,
    }));
    navigateTo('change-order-wizard', { jobId: workOrderDetailJob.id });
  }, [workOrderDetailJob, navigateTo]);

  const handleOpenCODetail = useCallback(
    (co: ChangeOrder, backTarget: ChangeOrderDetailBackTarget = 'work-order-detail') => {
      setChangeOrder((c) => ({ ...c, coDetailCO: co, coDetailBackTarget: backTarget }));
      navigateTo('co-detail', { jobId: co.job_id, coId: co.id });
    },
    [navigateTo]
  );

  const handleBackFromCODetail = useCallback(() => {
    const backTarget = changeOrderRef.current.coDetailBackTarget;
    setChangeOrder((c) => ({
      ...c,
      coDetailCO: null,
      coDetailBackTarget: 'work-order-detail',
    }));
    if (backTarget === 'work-order-detail' && changeOrderRef.current.coDetailCO?.job_id) {
      navigateTo('work-order-detail', { jobId: changeOrderRef.current.coDetailCO.job_id });
    } else {
      navigateTo(backTarget);
    }
  }, [navigateTo]);

  const handleEditCOFromDetail = useCallback(
    (co: ChangeOrder) => {
      if (!workOrderDetailJob) return;
      setChangeOrder((c) => ({
        ...c,
        changeOrderFlowJob: workOrderDetailJob,
        wizardExistingCO: co,
      }));
      navigateTo('change-order-wizard', { jobId: workOrderDetailJob.id, coId: co.id });
    },
    [workOrderDetailJob, navigateTo]
  );

  const handleDeleteCOFromDetail = useCallback(() => {
    const backTarget = changeOrderRef.current.coDetailBackTarget;
    setChangeOrder((c) => ({
      ...c,
      coDetailCO: null,
      coDetailBackTarget: 'work-order-detail',
    }));
    setChangeOrderListVersion((v) => v + 1);
    if (backTarget === 'work-order-detail' && changeOrderRef.current.coDetailCO?.job_id) {
      navigateTo('work-order-detail', { jobId: changeOrderRef.current.coDetailCO.job_id });
    } else {
      navigateTo(backTarget);
    }
  }, [navigateTo, setChangeOrderListVersion]);

  const handleChangeOrderWizardComplete = useCallback((savedCo: ChangeOrder) => {
    setChangeOrder((c) => ({
      ...c,
      wizardExistingCO: null,
      changeOrderFlowJob: null,
      coDetailCO: savedCo,
    }));
    setChangeOrderListVersion((v) => v + 1);
    navigateTo('co-detail', { jobId: savedCo.job_id, coId: savedCo.id });
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
      navigateTo('co-detail', { jobId: hadDetail.job_id, coId: hadDetail.id });
    } else {
      navigateTo('work-order-detail', { jobId: c.changeOrderFlowJob?.id ?? hadDetail?.job_id });
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
