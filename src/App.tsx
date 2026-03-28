import { useCallback, useState, type ReactNode } from 'react';
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
import { getInvoice } from './lib/db/invoices';
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
import { normalizeOwnerFullName } from './lib/owner-name';
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
  const [ownerFirstName, setOwnerFirstName] = useState('');
  const [ownerLastName, setOwnerLastName] = useState('');
  const [ownerBusinessEmail, setOwnerBusinessEmail] = useState('');
  const [ownerBusinessPhone, setOwnerBusinessPhone] = useState('');

  const clearGuestInformationFields = useCallback(() => {
    setOwnerFirstName('');
    setOwnerLastName('');
    setOwnerBusinessEmail('');
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
  }) => {
    const ownerName = normalizeOwnerFullName(ownerFirstName, ownerLastName);
    const profileEmail = ownerBusinessEmail.trim() || capture.email;
    const profilePhone = ownerBusinessPhone.trim() || null;
    const { data: authData, error: authError } = await signUp(capture.email, capture.password);
    if (authError || !authData.user) {
      throw new Error(authError?.message || 'Failed to create account');
    }

    const { data: createdProfile, error: profileError } = await upsertProfile({
      user_id: authData.user.id,
      business_name: capture.businessName,
      email: profileEmail,
      phone: profilePhone,
      owner_name: ownerName || null,
      default_exclusions: getDefaultExclusions(),
      default_assumptions: getDefaultCustomerObligations(),
    });

    if (profileError || !createdProfile) {
      throw new Error(profileError?.message || 'Failed to save profile');
    }

    setProfile(createdProfile);

    return {
      userId: authData.user.id,
      businessName: capture.businessName,
      email: profileEmail,
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
    if (view === 'work-order-detail' && user && profile && workOrderDetailJob) {
      return (
        <WorkOrderDetailPage
          key={`${workOrderDetailJob.id}-${changeOrderListVersion}`}
          userId={user.id}
          job={workOrderDetailJob}
          profile={profile}
          changeOrderListVersion={changeOrderListVersion}
          onJobUpdated={setWorkOrderDetailJob}
          onBack={handleBackFromWorkOrderDetail}
          onStartChangeOrder={changeOrderFlow.handleStartChangeOrderFromDetail}
          onStartChangeOrderInvoice={(co, invoiceId) => {
            if (!invoiceId) {
              invoiceFlow.handleStartChangeOrderInvoice(workOrderDetailJob, co);
              return;
            }
            void getInvoice(invoiceId).then((inv) => {
              if (!inv) return;
              invoiceFlow.handleOpenPendingChangeOrderInvoice(workOrderDetailJob, co, inv);
            });
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
          onBack={changeOrderFlow.handleBackFromCODetail}
          onEdit={changeOrderFlow.handleEditCOFromDetail}
          onDelete={changeOrderFlow.handleDeleteCOFromDetail}
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
          ownerFirstName={ownerFirstName}
          ownerLastName={ownerLastName}
          ownerBusinessEmail={ownerBusinessEmail}
          ownerBusinessPhone={ownerBusinessPhone}
          onOwnerFirstNameChange={setOwnerFirstName}
          onOwnerLastNameChange={setOwnerLastName}
          onOwnerBusinessEmailChange={setOwnerBusinessEmail}
          onOwnerBusinessPhoneChange={setOwnerBusinessPhone}
          showOwnerNameFields={!profile}
          onGoToPreview={() => navigateTo('preview')}
        />
      );
    }
    return (
      <AgreementPreview
        job={draft.job}
        profile={profile}
        existingJobId={draft.currentJobId ?? undefined}
        hasSession={Boolean(user)}
        ownerFirstName={ownerFirstName}
        ownerLastName={ownerLastName}
        ownerBusinessEmail={ownerBusinessEmail}
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
