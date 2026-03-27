import { useState, useCallback } from 'react';
import type { WelderJob } from './types';
import { JobForm } from './components/JobForm';
import { AgreementPreview } from './components/AgreementPreview';
import { AuthPage } from './components/AuthPage';
import { BusinessProfileForm } from './components/BusinessProfileForm';
import { HomePage } from './components/HomePage';
import { EditProfilePage } from './components/EditProfilePage';
import { useAppNavigation } from './hooks/useAppNavigation';
import { useAuthProfile } from './hooks/useAuthProfile';
import { supabase } from './lib/supabase';
import { getProfile, updateNextWoNumber, upsertProfile } from './lib/db/profile';
import { signUp } from './lib/auth';
import { getDefaultCustomerObligations, getDefaultExclusions } from './lib/defaults';
import type { BusinessProfile, Job, Invoice, ChangeOrder } from './types/db';
import sampleJob from './data/sample-job.json';
import { Settings } from 'lucide-react';
import { WorkOrdersPage } from './components/WorkOrdersPage';
import { InvoiceWizard } from './components/InvoiceWizard';
import { InvoiceFinalPage } from './components/InvoiceFinalPage';
import { WorkOrderDetailPage } from './components/WorkOrderDetailPage';
import { ChangeOrderDetailPage } from './components/ChangeOrderDetailPage';
import { ChangeOrderWizard } from './components/ChangeOrderWizard';
import './App.css';

type InvoiceFlowState = {
  invoiceFlowJob: Job | null;
  wizardExistingInvoice: Invoice | null;
  activeInvoice: Invoice | null;
};

type ChangeOrderFlowState = {
  changeOrderFlowJob: Job | null;
  wizardExistingCO: ChangeOrder | null;
  coDetailCO: ChangeOrder | null;
};

type DraftState = {
  job: WelderJob;
  draftBaseline: WelderJob | null;
  currentJobId: string | null;
  woIsOpen: boolean;
  showUnsavedModal: boolean;
  /** Shown when job save succeeded but persisting next_wo_number failed */
  woCounterPersistError: string | null;
};

function buildNewAgreementDraft(currentProfile: BusinessProfile | null): WelderJob {
  const today = new Date().toISOString().split('T')[0];
  const p = currentProfile;
  const defaults: Partial<WelderJob> = p
    ? {
        contractor_name: p.business_name,
        contractor_phone: p.phone ?? '',
        contractor_email: p.email ?? '',
        wo_number: p.next_wo_number ?? 1,
        agreement_date: today,
        exclusions: getDefaultExclusions(p.default_exclusions),
        customer_obligations: getDefaultCustomerObligations(p.default_assumptions),
        payment_terms_days: p.default_payment_terms_days ?? 14,
        late_fee_rate: p.default_late_fee_rate ?? 1.5,
        workmanship_warranty_days: p.default_warranty_period ?? 30,
        negotiation_period: p.default_negotiation_period ?? 10,
      }
    : { agreement_date: today };

  return {
    ...(sampleJob as WelderJob),
    contractor_name: '',
    exclusions: getDefaultExclusions(),
    customer_obligations: getDefaultCustomerObligations(),
    ...defaults,
  };
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

  const [workOrderDetailJob, setWorkOrderDetailJob] = useState<Job | null>(null);
  const [changeOrderListVersion, setChangeOrderListVersion] = useState(0);
  const [profileEntrySource, setProfileEntrySource] = useState<'work-orders' | null>(null);

  const [invoice, setInvoice] = useState<InvoiceFlowState>({
    invoiceFlowJob: null,
    wizardExistingInvoice: null,
    activeInvoice: null,
  });

  const [changeOrder, setChangeOrder] = useState<ChangeOrderFlowState>({
    changeOrderFlowJob: null,
    wizardExistingCO: null,
    coDetailCO: null,
  });

  const [draft, setDraft] = useState<DraftState>(() => ({
    job: {
      ...(sampleJob as WelderJob),
      contractor_name: '',
    },
    draftBaseline: null,
    currentJobId: null,
    woIsOpen: false,
    showUnsavedModal: false,
    woCounterPersistError: null,
  }));

  const setJob = useCallback((next: WelderJob | ((prev: WelderJob) => WelderJob)) => {
    setDraft((d) => ({
      ...d,
      job: typeof next === 'function' ? next(d.job) : next,
    }));
  }, []);

  const doCreateNewAgreement = (currentProfile: BusinessProfile | null) => {
    const nextDraft = buildNewAgreementDraft(currentProfile);
    setDraft((d) => ({
      ...d,
      job: nextDraft,
      draftBaseline: nextDraft,
      currentJobId: null,
      woIsOpen: true,
    }));
    navigateTo('form');
  };

  const createNewAgreement = () => {
    const hasUnsavedChanges =
      draft.woIsOpen &&
      draft.currentJobId === null &&
      draft.draftBaseline !== null &&
      JSON.stringify(draft.job) !== JSON.stringify(draft.draftBaseline);

    if (hasUnsavedChanges) {
      setDraft((d) => ({ ...d, showUnsavedModal: true }));
      return;
    }
    doCreateNewAgreement(profile);
  };

  const closeUnsavedModal = () => {
    setDraft((d) => ({ ...d, showUnsavedModal: false }));
  };

  const continueEditingWorkOrder = () => {
    navigateTo('form');
    closeUnsavedModal();
  };

  const handleSaveSuccess = async (savedJobId: string, isNewSave: boolean) => {
    setDraft((d) => ({
      ...d,
      currentJobId: savedJobId,
      woCounterPersistError: null,
    }));
    if (!isNewSave) return;

    const {
      data: { session },
    } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (!uid) return;

    const fresh = await getProfile(uid);
    if (!fresh) return;

    const newCount = (fresh.next_wo_number ?? 1) + 1;
    const { error } = await updateNextWoNumber(uid, newCount);
    if (error) {
      console.error('Failed to persist next work order number:', error);
      setDraft((d) => ({
        ...d,
        woCounterPersistError: `Work order saved, but the next WO number could not be updated (${error.message}). Refresh the page before creating another work order, or the same number may be suggested again.`,
      }));
      return;
    }
    setProfile({ ...fresh, next_wo_number: newCount });
  };

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
    setChangeOrder((co) => ({
      ...co,
      changeOrderFlowJob: null,
      wizardExistingCO: null,
      coDetailCO: null,
    }));
    navigateTo('work-orders');
  };

  const handleStartChangeOrderFromDetail = () => {
    if (!workOrderDetailJob) return;
    setChangeOrder((co) => ({
      ...co,
      changeOrderFlowJob: workOrderDetailJob,
      wizardExistingCO: null,
    }));
    navigateTo('change-order-wizard');
  };

  const handleOpenCODetail = (co: ChangeOrder) => {
    setChangeOrder((c) => ({ ...c, coDetailCO: co }));
    navigateTo('co-detail');
  };

  const handleBackFromCODetail = () => {
    setChangeOrder((c) => ({ ...c, coDetailCO: null }));
    navigateTo('work-order-detail');
  };

  const handleEditCOFromDetail = (co: ChangeOrder) => {
    if (!workOrderDetailJob) return;
    setChangeOrder((c) => ({
      ...c,
      changeOrderFlowJob: workOrderDetailJob,
      wizardExistingCO: co,
    }));
    navigateTo('change-order-wizard');
  };

  const handleDeleteCOFromDetail = () => {
    setChangeOrder((c) => ({ ...c, coDetailCO: null }));
    setChangeOrderListVersion((v) => v + 1);
    navigateTo('work-order-detail');
  };

  const handleChangeOrderWizardComplete = () => {
    const wasEditing = changeOrder.wizardExistingCO !== null;
    setChangeOrder((c) => ({
      ...c,
      wizardExistingCO: null,
      changeOrderFlowJob: null,
      ...(wasEditing ? { coDetailCO: null } : {}),
    }));
    setChangeOrderListVersion((v) => v + 1);
    navigateTo('work-order-detail');
  };

  const handleChangeOrderWizardCancel = () => {
    const wasEditing = changeOrder.wizardExistingCO !== null;
    setChangeOrder((c) => ({
      ...c,
      wizardExistingCO: null,
      changeOrderFlowJob: null,
    }));
    if (wasEditing && changeOrder.coDetailCO) {
      navigateTo('co-detail');
    } else {
      navigateTo('work-order-detail');
    }
  };

  const handleStartInvoice = (jobRow: Job) => {
    setInvoice((inv) => ({
      ...inv,
      invoiceFlowJob: jobRow,
      wizardExistingInvoice: null,
      activeInvoice: null,
    }));
    navigateTo('invoice-wizard');
  };

  const handleOpenPendingInvoice = (jobRow: Job, inv: Invoice) => {
    setInvoice((i) => ({
      ...i,
      invoiceFlowJob: jobRow,
      activeInvoice: inv,
    }));
    navigateTo('invoice-final');
  };

  const handleInvoiceWizardSuccess = (inv: Invoice) => {
    setInvoice((i) => ({
      ...i,
      activeInvoice: inv,
      wizardExistingInvoice: null,
    }));
    navigateTo('invoice-final');
    void loadProfile({ silent: true });
  };

  const handleInvoiceWizardCancel = () => {
    if (invoice.wizardExistingInvoice) {
      setInvoice((i) => ({ ...i, wizardExistingInvoice: null }));
      navigateTo('invoice-final');
    } else {
      setInvoice((i) => ({
        ...i,
        invoiceFlowJob: null,
        activeInvoice: null,
      }));
      navigateTo('work-orders');
    }
  };

  const handleInvoiceFinalWorkOrders = () => {
    navigateTo('work-orders');
    setInvoice((i) => ({
      ...i,
      invoiceFlowJob: null,
      activeInvoice: null,
      wizardExistingInvoice: null,
    }));
  };

  const handleEditInvoice = () => {
    if (!invoice.activeInvoice) return;
    setInvoice((i) => ({
      ...i,
      wizardExistingInvoice: i.activeInvoice,
    }));
    navigateTo('invoice-wizard');
  };

  const handleAfterInvoiceDownload = (inv: Invoice) => {
    setWorkOrdersSuccessBanner(
      `Invoice #${String(inv.invoice_number).padStart(4, '0')} downloaded and saved!`
    );
    navigateTo('work-orders');
    setInvoice((i) => ({
      ...i,
      invoiceFlowJob: null,
      activeInvoice: null,
    }));
    void loadProfile({ silent: true });
  };

  const handleInvoiceUpdated = (inv: Invoice) => {
    setInvoice((i) => ({ ...i, activeInvoice: inv }));
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
      onCreateAgreement={createNewAgreement}
      ownerName={profile?.owner_name || profile?.business_name}
    />
  );

  return (
    <div className="app">
      <header className="app-header">
        <h1
          className="app-title"
          onClick={() => {
            navigateTo('home');
            setInvoice((i) => ({
              ...i,
              invoiceFlowJob: null,
              activeInvoice: null,
              wizardExistingInvoice: null,
            }));
            setWorkOrderDetailJob(null);
            setChangeOrder((c) => ({
              ...c,
              changeOrderFlowJob: null,
              wizardExistingCO: null,
              coDetailCO: null,
            }));
          }}
        >
          ScopeLock
        </h1>
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
            onClick={() => setDraft((d) => ({ ...d, woCounterPersistError: null }))}
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

      <main className="app-main">
        {view === 'auth' && !user ? (
          <AuthPage
            onSignInSuccess={() => {
              replaceView('home');
            }}
          />
        ) : view === 'auth' && user ? (
          homePageEl
        ) : view === 'home' ? (
          homePageEl
        ) : view === 'profile' && profile ? (
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
        ) : view === 'profile' && !profile ? (
          homePageEl
        ) : view === 'work-orders' && user ? (
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
            onStartInvoice={handleStartInvoice}
            onOpenPendingInvoice={handleOpenPendingInvoice}
            onOpenWorkOrderDetail={handleOpenWorkOrderDetail}
          />
        ) : view === 'work-order-detail' && profile && workOrderDetailJob ? (
          <WorkOrderDetailPage
            key={`${workOrderDetailJob.id}-${changeOrderListVersion}`}
            job={workOrderDetailJob}
            profile={profile}
            changeOrderListVersion={changeOrderListVersion}
            onBack={handleBackFromWorkOrderDetail}
            onStartChangeOrder={handleStartChangeOrderFromDetail}
            onStartInvoice={(inv) => {
              if (inv) {
                handleOpenPendingInvoice(workOrderDetailJob, inv);
              } else {
                handleStartInvoice(workOrderDetailJob);
              }
            }}
            onOpenCODetail={handleOpenCODetail}
          />
        ) : view === 'co-detail' && user && profile && workOrderDetailJob && changeOrder.coDetailCO ? (
          <ChangeOrderDetailPage
            key={changeOrder.coDetailCO.id}
            userId={user.id}
            co={changeOrder.coDetailCO}
            job={workOrderDetailJob}
            profile={profile}
            invoice={null}
            onBack={handleBackFromCODetail}
            onEdit={handleEditCOFromDetail}
            onDelete={handleDeleteCOFromDetail}
            onStartInvoice={() => handleStartInvoice(workOrderDetailJob)}
            onOpenPendingInvoice={(inv) => handleOpenPendingInvoice(workOrderDetailJob, inv)}
          />
        ) : view === 'change-order-wizard' && user && profile && changeOrder.changeOrderFlowJob ? (
          <ChangeOrderWizard
            key={changeOrder.wizardExistingCO?.id ?? 'new-co'}
            userId={user.id}
            job={changeOrder.changeOrderFlowJob}
            profile={profile}
            existingCO={changeOrder.wizardExistingCO}
            onComplete={handleChangeOrderWizardComplete}
            onCancel={handleChangeOrderWizardCancel}
          />
        ) : view === 'invoice-wizard' && user && profile && invoice.invoiceFlowJob ? (
          <InvoiceWizard
            key={`${invoice.invoiceFlowJob.id}-${invoice.wizardExistingInvoice?.id ?? 'new'}`}
            userId={user.id}
            job={invoice.invoiceFlowJob}
            profile={profile}
            existingInvoice={invoice.wizardExistingInvoice}
            onCancel={handleInvoiceWizardCancel}
            onSuccess={handleInvoiceWizardSuccess}
          />
        ) : view === 'invoice-final' && user && profile && invoice.invoiceFlowJob && invoice.activeInvoice ? (
          <InvoiceFinalPage
            invoice={invoice.activeInvoice}
            job={invoice.invoiceFlowJob}
            profile={profile}
            onWorkOrders={handleInvoiceFinalWorkOrders}
            onEditInvoice={handleEditInvoice}
            onAfterDownload={handleAfterInvoiceDownload}
            onInvoiceUpdated={handleInvoiceUpdated}
          />
        ) : view === 'form' ? (
          <JobForm
            userId={user?.id}
            job={draft.job}
            onChange={setJob}
            businessName={profile?.business_name}
            onGoToPreview={() => navigateTo('preview')}
          />
        ) : (
          <AgreementPreview
            job={draft.job}
            profile={profile}
            existingJobId={draft.currentJobId ?? undefined}
            onSaveSuccess={handleSaveSuccess}
            onCaptureAndSave={!user ? handleCaptureAndSave : undefined}
            onCaptureFlowFinished={handleCaptureFlowFinished}
          />
        )}
      </main>

      <footer className="app-footer">
        <p>ScopeLock - Protect Your Work</p>
      </footer>

      {draft.showUnsavedModal && (
        <div className="modal-overlay" onClick={closeUnsavedModal}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Unsaved Work Order</h3>
            <p>You have an unsaved Work Order. Continue editing or discard it?</p>
            <div className="modal-actions">
              <button
                className="btn-secondary"
                onClick={continueEditingWorkOrder}
              >
                Continue Editing
              </button>
              <button
                className="btn-danger"
                onClick={() => {
                  closeUnsavedModal();
                  doCreateNewAgreement(profile);
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
