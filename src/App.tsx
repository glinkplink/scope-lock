import { useState, type ReactNode } from 'react';
import { JobForm } from './components/JobForm';
import { AgreementPreview } from './components/AgreementPreview';
import { AuthPage } from './components/AuthPage';
import { BusinessProfileForm } from './components/BusinessProfileForm';
import { HomePage } from './components/HomePage';
import { EditProfilePage } from './components/EditProfilePage';
import { useAppNavigation } from './hooks/useAppNavigation';
import { useAuthProfile } from './hooks/useAuthProfile';
import { upsertProfile } from './lib/db/profile';
import { signUp } from './lib/auth';
import { getDefaultCustomerObligations, getDefaultExclusions } from './lib/defaults';
import type { BusinessProfile, Job } from './types/db';
import { Settings } from 'lucide-react';
import { WorkOrdersPage } from './components/WorkOrdersPage';
import { InvoiceWizard } from './components/InvoiceWizard';
import { InvoiceFinalPage } from './components/InvoiceFinalPage';
import { WorkOrderDetailPage } from './components/WorkOrderDetailPage';
import { ChangeOrderDetailPage } from './components/ChangeOrderDetailPage';
import { ChangeOrderWizard } from './components/ChangeOrderWizard';
import { useInvoiceFlow } from './hooks/useInvoiceFlow';
import { useChangeOrderFlow } from './hooks/useChangeOrderFlow';
import { useWorkOrderDraft } from './hooks/useWorkOrderDraft';
import './App.css';

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

  const [workOrderDetailJob, setWorkOrderDetailJob] = useState<import('./types/db').Job | null>(null);
  const [changeOrderListVersion, setChangeOrderListVersion] = useState(0);
  const [profileEntrySource, setProfileEntrySource] = useState<'work-orders' | null>(null);

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

  const { state: draft, actions: draftFlow } = useWorkOrderDraft(profile, navigateTo, loadProfile);

  const handleCaptureAndSave = async (capture: {
    businessName: string;
    email: string;
    password: string;
  }) => {
    const { data: authData, error: authError } = await signUp(capture.email, capture.password);
    if (authError || !authData.user) {
      throw new Error(authError?.message || 'Failed to create account');
    }

    const { data: createdProfile, error: profileError } = await upsertProfile({
      user_id: authData.user.id,
      business_name: capture.businessName,
      email: capture.email,
      default_exclusions: getDefaultExclusions(),
      default_assumptions: getDefaultCustomerObligations(),
    });

    if (profileError || !createdProfile) {
      throw new Error(profileError?.message || 'Failed to save profile');
    }

    setProfile(createdProfile);

    return { userId: authData.user.id, businessName: capture.businessName, email: capture.email };
  };

  const handleEditProfileSaved = (savedProfile: BusinessProfile | null) => {
    if (savedProfile) setProfile(savedProfile);
    else void loadProfile({ silent: true });
    if (profileEntrySource === 'work-orders') {
      setProfileEntrySource(null);
      navigateTo('work-orders');
    }
  };

  const openWorkOrders = () => {
    setProfileEntrySource(null);
    navigateTo('work-orders');
  };

  const handleOpenWorkOrderDetail = (jobRow: Job) => {
    setWorkOrderDetailJob(jobRow);
    navigateTo('work-order-detail');
  };

  const handleBackFromWorkOrderDetail = () => {
    setWorkOrderDetailJob(null);
    changeOrderFlow.resetFlowForBackToList();
    navigateTo('work-orders');
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
      return (
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
        />
      );
    }
    if (view === 'work-order-detail' && profile && workOrderDetailJob) {
      return (
        <WorkOrderDetailPage
          key={`${workOrderDetailJob.id}-${changeOrderListVersion}`}
          job={workOrderDetailJob}
          profile={profile}
          changeOrderListVersion={changeOrderListVersion}
          onBack={handleBackFromWorkOrderDetail}
          onStartChangeOrder={changeOrderFlow.handleStartChangeOrderFromDetail}
          onStartInvoice={(inv) => {
            if (inv) {
              invoiceFlow.handleOpenPendingInvoice(workOrderDetailJob, inv);
            } else {
              invoiceFlow.handleStartInvoice(workOrderDetailJob);
            }
          }}
          onOpenCODetail={changeOrderFlow.handleOpenCODetail}
        />
      );
    }
    if (view === 'co-detail' && user && profile && workOrderDetailJob && changeOrder.coDetailCO) {
      return (
        <ChangeOrderDetailPage
          key={changeOrder.coDetailCO.id}
          userId={user.id}
          co={changeOrder.coDetailCO}
          job={workOrderDetailJob}
          profile={profile}
          invoice={null}
          onBack={changeOrderFlow.handleBackFromCODetail}
          onEdit={changeOrderFlow.handleEditCOFromDetail}
          onDelete={changeOrderFlow.handleDeleteCOFromDetail}
          onStartInvoice={() => invoiceFlow.handleStartInvoice(workOrderDetailJob)}
          onOpenPendingInvoice={(inv) =>
            invoiceFlow.handleOpenPendingInvoice(workOrderDetailJob, inv)
          }
        />
      );
    }
    if (view === 'change-order-wizard' && user && profile && changeOrder.changeOrderFlowJob) {
      return (
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
      return (
        <InvoiceWizard
          key={`${invoice.invoiceFlowJob.id}-${invoice.wizardExistingInvoice?.id ?? 'new'}`}
          userId={user.id}
          job={invoice.invoiceFlowJob}
          profile={profile}
          existingInvoice={invoice.wizardExistingInvoice}
          onCancel={invoiceFlow.handleInvoiceWizardCancel}
          onSuccess={invoiceFlow.handleInvoiceWizardSuccess}
        />
      );
    }
    if (view === 'invoice-final' && user && profile && invoice.invoiceFlowJob && invoice.activeInvoice) {
      return (
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
          onGoToPreview={() => navigateTo('preview')}
        />
      );
    }
    return (
      <AgreementPreview
        job={draft.job}
        profile={profile}
        existingJobId={draft.currentJobId ?? undefined}
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
