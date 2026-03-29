import { Suspense, lazy, useCallback, useEffect, useState, type ReactNode } from 'react';
import { JobForm } from './components/JobForm';
import { AuthPage } from './components/AuthPage';
import { BusinessProfileForm } from './components/BusinessProfileForm';
import { HomePage } from './components/HomePage';
import { EditProfilePage } from './components/EditProfilePage';
import { useAppNavigation } from './hooks/useAppNavigation';
import { useAuthProfile } from './hooks/useAuthProfile';
import { upsertProfile } from './lib/db/profile';
import { signUp } from './lib/auth';
import { buildInitialProfileDefaults } from './lib/defaults';
import { getInvoice } from './lib/db/invoices';
import type { BusinessProfile, ChangeOrder, Job } from './types/db';
import { Settings } from 'lucide-react';
import { useInvoiceFlow } from './hooks/useInvoiceFlow';
import { useChangeOrderFlow } from './hooks/useChangeOrderFlow';
import { useWorkOrderDraft } from './hooks/useWorkOrderDraft';
import { normalizeOwnerFullName } from './lib/owner-name';
import './App.css';

const loadAgreementPreview = () =>
  import('./components/AgreementPreview').then((module) => ({ default: module.AgreementPreview }));
const loadWorkOrdersPage = () =>
  import('./components/WorkOrdersPage').then((module) => ({ default: module.WorkOrdersPage }));
const loadInvoiceWizard = () =>
  import('./components/InvoiceWizard').then((module) => ({ default: module.InvoiceWizard }));
const loadInvoiceFinalPage = () =>
  import('./components/InvoiceFinalPage').then((module) => ({ default: module.InvoiceFinalPage }));
const loadWorkOrderDetailPage = () =>
  import('./components/WorkOrderDetailPage').then((module) => ({ default: module.WorkOrderDetailPage }));
const loadChangeOrderDetailPage = () =>
  import('./components/ChangeOrderDetailPage').then((module) => ({ default: module.ChangeOrderDetailPage }));
const loadChangeOrderWizard = () =>
  import('./components/ChangeOrderWizard').then((module) => ({ default: module.ChangeOrderWizard }));

const AgreementPreview = lazy(loadAgreementPreview);
const WorkOrdersPage = lazy(loadWorkOrdersPage);
const InvoiceWizard = lazy(loadInvoiceWizard);
const InvoiceFinalPage = lazy(loadInvoiceFinalPage);
const WorkOrderDetailPage = lazy(loadWorkOrderDetailPage);
const ChangeOrderDetailPage = lazy(loadChangeOrderDetailPage);
const ChangeOrderWizard = lazy(loadChangeOrderWizard);

function scheduleIdleTask(task: () => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const idleWindow = window as Window & {
    requestIdleCallback?: (callback: () => void) => number;
    cancelIdleCallback?: (id: number) => void;
  };

  if (typeof idleWindow.requestIdleCallback === 'function') {
    const id = idleWindow.requestIdleCallback(task);
    return () => {
      if (typeof idleWindow.cancelIdleCallback === 'function') {
        idleWindow.cancelIdleCallback(id);
      }
    };
  }

  const timeoutId = window.setTimeout(task, 250);
  return () => window.clearTimeout(timeoutId);
}

function renderLazyPage(page: ReactNode) {
  return (
    <Suspense fallback={<div className="app-loading">Loading...</div>}>
      {page}
    </Suspense>
  );
}

function App() {
  const [workOrdersSuccessBanner, setWorkOrdersSuccessBanner] = useState<string | null>(null);
  const { view, navigateTo, replaceView } = useAppNavigation();
  const {
    user,
    authLoading,
    profile,
    profileLoading,
    setProfile,
    loadProfile,
    handleCaptureFlowFinished,
  } = useAuthProfile({
    replaceView,
    setWorkOrdersSuccessBanner,
  });

  const [workOrderDetailJobId, setWorkOrderDetailJobId] = useState<string | null>(null);
  const [workOrderDetailJob, setWorkOrderDetailJob] = useState<import('./types/db').Job | null>(null);
  const [changeOrderListVersion, setChangeOrderListVersion] = useState(0);
  const [profileEntrySource, setProfileEntrySource] = useState<'work-orders' | null>(null);
  const [ownerFirstName, setOwnerFirstName] = useState('');
  const [ownerLastName, setOwnerLastName] = useState('');
  const [ownerBusinessPhone, setOwnerBusinessPhone] = useState('');

  const clearGuestInformationFields = useCallback(() => {
    setOwnerFirstName('');
    setOwnerLastName('');
    setOwnerBusinessPhone('');
  }, []);

  const { state: invoice, actions: invoiceFlow } = useInvoiceFlow(
    navigateTo,
    (msg) => setWorkOrdersSuccessBanner(msg),
    loadProfile
  );

  const { state: changeOrder, actions: changeOrderFlow } = useChangeOrderFlow(
    workOrderDetailJob,
    navigateTo,
    setChangeOrderListVersion
  );

  const { state: draft, actions: draftFlow } = useWorkOrderDraft(
    profile,
    user?.id ?? null,
    navigateTo,
    loadProfile,
    clearGuestInformationFields
  );

  const handleCaptureAndSave = async (capture: {
    businessName: string;
    email: string;
    password: string;
    saveAsDefaults: boolean;
  }) => {
    const ownerName = normalizeOwnerFullName(ownerFirstName, ownerLastName);
    const profilePhone = ownerBusinessPhone.trim() || null;
    const { data: authData, error: authError } = await signUp(capture.email, capture.password);
    if (authError || !authData.user) {
      throw new Error(authError?.message || 'Failed to create account');
    }

    const { data: createdProfile, error: profileError } = await upsertProfile({
      user_id: authData.user.id,
      business_name: capture.businessName,
      email: capture.email,
      phone: profilePhone,
      owner_name: ownerName || null,
      ...buildInitialProfileDefaults(draft.job, capture.saveAsDefaults),
    });

    if (profileError || !createdProfile) {
      throw new Error(profileError?.message || 'Failed to save profile');
    }

    setProfile(createdProfile);

    return {
      userId: authData.user.id,
      businessName: capture.businessName,
      email: capture.email,
      phone: profilePhone,
      ownerName,
    };
  };

  const handleEditProfileSaved = (savedProfile: BusinessProfile | null) => {
    if (savedProfile) setProfile(savedProfile);
    else void loadProfile({ silent: true });
    if (profileEntrySource === 'work-orders') {
      setProfileEntrySource(null);
      navigateTo('work-orders');
    }
  };

  useEffect(() => {
    if (!user) return;
    return scheduleIdleTask(() => {
      void loadWorkOrdersPage();
    });
  }, [user]);

  const openWorkOrders = () => {
    setProfileEntrySource(null);
    navigateTo('work-orders');
  };

  const handleOpenWorkOrderDetail = (jobId: string) => {
    setWorkOrderDetailJobId(jobId);
    setWorkOrderDetailJob(null);
    navigateTo('work-order-detail');
  };

  const handleOpenChangeOrderDetailFromList = (
    jobRow: Job,
    changeOrderRow: import('./types/db').ChangeOrder
  ) => {
    setWorkOrderDetailJobId(jobRow.id);
    setWorkOrderDetailJob(jobRow);
    changeOrderFlow.handleOpenCODetail(changeOrderRow, 'work-orders');
  };

  const handleBackFromWorkOrderDetail = () => {
    setWorkOrderDetailJobId(null);
    setWorkOrderDetailJob(null);
    changeOrderFlow.resetFlowForBackToList();
    navigateTo('work-orders');
  };

  const handleBackFromCODetail = () => {
    if (changeOrder.coDetailBackTarget === 'work-orders') {
      setWorkOrderDetailJobId(null);
      setWorkOrderDetailJob(null);
    }
    changeOrderFlow.handleBackFromCODetail();
  };

  const handleDeleteCOFromDetail = () => {
    if (changeOrder.coDetailBackTarget === 'work-orders') {
      setWorkOrderDetailJobId(null);
      setWorkOrderDetailJob(null);
    }
    changeOrderFlow.handleDeleteCOFromDetail();
  };

  if (authLoading) {
    return (
      <div className="app-loading">
        Loading...
      </div>
    );
  }

  const inWorkOrderFlow = view === 'form' || view === 'preview';

  if (user && !profile && profileLoading && !inWorkOrderFlow) {
    return (
      <div className="app-loading">
        Loading...
      </div>
    );
  }

  if (user && !profile && !profileLoading && !inWorkOrderFlow) {
    return (
      <BusinessProfileForm
        userId={user.id}
        initialProfile={null}
        onSave={loadProfile}
      />
    );
  }

  const showTabs = view === 'form' || view === 'preview';

  const homePageEl = (
    <HomePage
      onCreateAgreement={draftFlow.createNewAgreement}
      ownerName={profile?.owner_name || profile?.business_name}
    />
  );

  function renderView(): ReactNode {
    if (view === 'auth' && !user) {
      return (
        <AuthPage
          onSignInSuccess={() => {
            replaceView('home');
          }}
        />
      );
    }
    if (view === 'auth' && user) {
      return homePageEl;
    }
    if (view === 'home') {
      return homePageEl;
    }
    if (view === 'profile' && profile) {
      return (
        <EditProfilePage
          profile={profile}
          onSave={handleEditProfileSaved}
          onCancel={() => {
            if (profileEntrySource === 'work-orders') {
              setProfileEntrySource(null);
              navigateTo('work-orders');
            } else {
              navigateTo('home');
            }
          }}
        />
      );
    }
    if (view === 'profile' && !profile) {
      return homePageEl;
    }
    if (view === 'work-orders' && user) {
      return renderLazyPage(
        <WorkOrdersPage
          key={user.id}
          userId={user.id}
          profile={profile}
          successBanner={workOrdersSuccessBanner}
          onClearSuccessBanner={() => setWorkOrdersSuccessBanner(null)}
          onCompleteProfileClick={() => {
            setProfileEntrySource('work-orders');
            navigateTo('profile');
          }}
          onStartInvoice={invoiceFlow.handleStartInvoice}
          onOpenPendingInvoice={invoiceFlow.handleOpenPendingInvoice}
          onOpenWorkOrderDetail={handleOpenWorkOrderDetail}
          onOpenChangeOrderDetail={handleOpenChangeOrderDetailFromList}
        />
      );
    }
    if (view === 'work-order-detail' && user && profile && workOrderDetailJobId) {
      return renderLazyPage(
        <WorkOrderDetailPage
          key={`${workOrderDetailJobId}-${changeOrderListVersion}`}
          userId={user.id}
          jobId={workOrderDetailJobId}
          job={workOrderDetailJob}
          profile={profile}
          changeOrderListVersion={changeOrderListVersion}
          onJobLoaded={(job: Job) => {
            setWorkOrderDetailJobId(job.id);
            setWorkOrderDetailJob(job);
          }}
          onJobUpdated={(job: Job) => {
            setWorkOrderDetailJobId(job.id);
            setWorkOrderDetailJob(job);
          }}
          onBack={handleBackFromWorkOrderDetail}
          onStartChangeOrder={changeOrderFlow.handleStartChangeOrderFromDetail}
          onStartChangeOrderInvoice={(co: ChangeOrder, invoiceId: string | null) => {
            const activeJob = workOrderDetailJob;
            if (!activeJob) return;
            if (!invoiceId) {
              invoiceFlow.handleStartChangeOrderInvoice(activeJob, co);
              return;
            }
            void getInvoice(invoiceId).then((inv) => {
              if (!inv) return;
              invoiceFlow.handleOpenPendingChangeOrderInvoice(activeJob, co, inv);
            });
          }}
          onOpenCODetail={changeOrderFlow.handleOpenCODetail}
        />
      );
    }
    if (view === 'co-detail' && user && profile && workOrderDetailJob && changeOrder.coDetailCO) {
      return renderLazyPage(
        <ChangeOrderDetailPage
          key={changeOrder.coDetailCO.id}
          userId={user.id}
          co={changeOrder.coDetailCO}
          job={workOrderDetailJob}
          profile={profile}
          onBack={handleBackFromCODetail}
          onEdit={changeOrderFlow.handleEditCOFromDetail}
          onDelete={handleDeleteCOFromDetail}
          onCoUpdated={changeOrderFlow.handleCoEsignUpdated}
        />
      );
    }
    if (view === 'change-order-wizard' && user && profile && changeOrder.changeOrderFlowJob) {
      return renderLazyPage(
        <ChangeOrderWizard
          key={changeOrder.wizardExistingCO?.id ?? 'new-co'}
          userId={user.id}
          job={changeOrder.changeOrderFlowJob}
          profile={profile}
          existingCO={changeOrder.wizardExistingCO}
          onComplete={changeOrderFlow.handleChangeOrderWizardComplete}
          onCancel={changeOrderFlow.handleChangeOrderWizardCancel}
        />
      );
    }
    if (view === 'invoice-wizard' && user && profile && invoice.invoiceFlowJob) {
      return renderLazyPage(
        <InvoiceWizard
          key={`${invoice.invoiceFlowJob.id}-${invoice.invoiceFlowChangeOrder?.id ?? 'job'}-${invoice.wizardExistingInvoice?.id ?? 'new'}`}
          userId={user.id}
          job={invoice.invoiceFlowJob}
          changeOrder={invoice.invoiceFlowTarget === 'change_order' ? invoice.invoiceFlowChangeOrder : null}
          profile={profile}
          existingInvoice={invoice.wizardExistingInvoice}
          onCancel={invoiceFlow.handleInvoiceWizardCancel}
          onSuccess={invoiceFlow.handleInvoiceWizardSuccess}
        />
      );
    }
    if (view === 'invoice-final' && user && profile && invoice.invoiceFlowJob && invoice.activeInvoice) {
      return renderLazyPage(
        <InvoiceFinalPage
          invoice={invoice.activeInvoice}
          job={invoice.invoiceFlowJob}
          profile={profile}
          onWorkOrders={invoiceFlow.handleInvoiceFinalWorkOrders}
          onEditInvoice={invoiceFlow.handleEditInvoice}
          onAfterDownload={invoiceFlow.handleAfterInvoiceDownload}
          onInvoiceUpdated={invoiceFlow.handleInvoiceUpdated}
        />
      );
    }
    if (view === 'form') {
      return (
        <JobForm
          userId={user?.id}
          job={draft.job}
          onChange={draftFlow.setJob}
          businessName={profile?.business_name}
          ownerFirstName={ownerFirstName}
          ownerLastName={ownerLastName}
          ownerBusinessPhone={ownerBusinessPhone}
          onOwnerFirstNameChange={setOwnerFirstName}
          onOwnerLastNameChange={setOwnerLastName}
          onOwnerBusinessPhoneChange={setOwnerBusinessPhone}
          showOwnerNameFields={!profile}
          onGoToPreview={() => navigateTo('preview')}
        />
      );
    }
    return renderLazyPage(
      <AgreementPreview
        job={draft.job}
        profile={profile}
        existingJobId={draft.currentJobId ?? undefined}
        hasSession={Boolean(user)}
        ownerFirstName={ownerFirstName}
        ownerLastName={ownerLastName}
        ownerBusinessPhone={ownerBusinessPhone}
        onSaveSuccess={draftFlow.handleSaveSuccess}
        onCaptureAndSave={!user ? handleCaptureAndSave : undefined}
        onCaptureFlowFinished={handleCaptureFlowFinished}
      />
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <button
          type="button"
          className="app-title"
          aria-label="ScopeLock, go to home"
          onClick={() => {
            navigateTo('home');
            invoiceFlow.resetInvoiceFlow();
            setWorkOrderDetailJobId(null);
            setWorkOrderDetailJob(null);
            changeOrderFlow.resetChangeOrderFlow();
          }}
        >
          ScopeLock
        </button>
        <div className="header-actions">
          {!user && (
            <button
              type="button"
              className="header-sign-in-link"
              onClick={() => navigateTo('auth')}
            >
              Sign In
            </button>
          )}
          {user && (
            <button
              type="button"
              className="header-work-orders-link"
              onClick={openWorkOrders}
            >
              Work Orders
            </button>
          )}
          {user && (
            <button
              type="button"
              className="btn-header-settings"
              onClick={() => {
                setProfileEntrySource(null);
                navigateTo('profile');
              }}
              aria-label="Edit profile"
            >
              <Settings className="btn-header-settings-icon" aria-hidden="true" />
            </button>
          )}
        </div>
      </header>

      {draft.woCounterPersistError && (
        <div className="error-banner wo-counter-error-banner" role="alert">
          <span>{draft.woCounterPersistError}</span>
          <button
            type="button"
            className="btn-dismiss-banner"
            onClick={draftFlow.dismissWoCounterError}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {showTabs && (
        <nav className="tab-nav">
          <button
            className={`tab-button ${view === 'form' ? 'active' : ''}`}
            onClick={() => navigateTo('form')}
          >
            Edit Work Order
          </button>
          <button
            className={`tab-button ${view === 'preview' ? 'active' : ''}`}
            onClick={() => navigateTo('preview')}
          >
            Preview
          </button>
        </nav>
      )}

      <main className="app-main">{renderView()}</main>

      <footer className="app-footer">
        <p>ScopeLock - Protect Your Work</p>
      </footer>

      {draft.showUnsavedModal && (
        <div className="modal-overlay" onClick={draftFlow.closeUnsavedModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Unsaved Work Order</h3>
            <p>You have an unsaved Work Order. Continue editing or discard it?</p>
            <div className="modal-actions">
              <button
                className="btn-secondary"
                onClick={draftFlow.continueEditingWorkOrder}
              >
                Continue Editing
              </button>
              <button
                className="btn-danger"
                onClick={() => {
                  draftFlow.closeUnsavedModal();
                  clearGuestInformationFields();
                  draftFlow.doCreateNewAgreement(profile);
                }}
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
