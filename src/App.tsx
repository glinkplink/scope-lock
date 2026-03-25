import { useState, useEffect } from 'react';
import type { WelderJob } from './types';
import { JobForm } from './components/JobForm';
import { AgreementPreview } from './components/AgreementPreview';
import { AuthPage } from './components/AuthPage';
import { BusinessProfileForm } from './components/BusinessProfileForm';
import { HomePage } from './components/HomePage';
import { EditProfilePage } from './components/EditProfilePage';
import { useAuth } from './hooks/useAuth';
import { supabase } from './lib/supabase';
import { getProfile, updateNextWoNumber, upsertProfile } from './lib/db/profile';
import { signUp } from './lib/auth';
import { getDefaultCustomerObligations, getDefaultExclusions } from './lib/defaults';
import type { BusinessProfile, Job, Invoice } from './types/db';
import sampleJob from './data/sample-job.json';
import { Settings } from 'lucide-react';
import { WorkOrdersPage } from './components/WorkOrdersPage';
import { InvoiceWizard } from './components/InvoiceWizard';
import { InvoiceFinalPage } from './components/InvoiceFinalPage';
import { WorkOrderDetailPage } from './components/WorkOrderDetailPage';
import './App.css';

type AppView =
  | 'home'
  | 'form'
  | 'preview'
  | 'profile'
  | 'work-orders'
  | 'work-order-detail'
  | 'invoice-wizard'
  | 'invoice-final'
  | 'auth';

type AppHistoryState = { view?: AppView };

const APP_VIEWS: AppView[] = [
  'home',
  'form',
  'preview',
  'profile',
  'work-orders',
  'work-order-detail',
  'invoice-wizard',
  'invoice-final',
  'auth',
];

function isAppView(v: unknown): v is AppView {
  return typeof v === 'string' && (APP_VIEWS as readonly string[]).includes(v);
}

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
        late_payment_terms:
          p.default_late_payment_terms ||
          'Balances unpaid 7 days after completion accrue 1.5% per month',
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
  const { user, loading: authLoading } = useAuth();
  const [profile, setProfile] = useState<BusinessProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [view, setView] = useState<AppView>('home');
  const [workOrderDetailJob, setWorkOrderDetailJob] = useState<Job | null>(null);
  const [invoiceFlowJob, setInvoiceFlowJob] = useState<Job | null>(null);
  const [wizardExistingInvoice, setWizardExistingInvoice] = useState<Invoice | null>(null);
  const [activeInvoice, setActiveInvoice] = useState<Invoice | null>(null);
  const [workOrdersSuccessBanner, setWorkOrdersSuccessBanner] = useState<string | null>(null);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [woIsOpen, setWoIsOpen] = useState(false);
  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
  /** Shown when job save succeeded but persisting next_wo_number failed */
  const [woCounterPersistError, setWoCounterPersistError] = useState<string | null>(null);
  const [job, setJob] = useState<WelderJob>(() => ({
    ...(sampleJob as WelderJob),
    contractor_name: '',
  }));
  const [draftBaseline, setDraftBaseline] = useState<WelderJob | null>(null);

  const navigateTo = (newView: AppView) => {
    window.history.pushState({ view: newView }, '');
    setView(newView);
  };

  const doCreateNewAgreement = (currentProfile: BusinessProfile | null) => {
    const nextDraft = buildNewAgreementDraft(currentProfile);
    setJob(nextDraft);
    setDraftBaseline(nextDraft);
    setCurrentJobId(null);
    setWoIsOpen(true);
    navigateTo('form');
  };

  const createNewAgreement = () => {
    const hasUnsavedChanges =
      woIsOpen &&
      currentJobId === null &&
      draftBaseline !== null &&
      JSON.stringify(job) !== JSON.stringify(draftBaseline);

    if (hasUnsavedChanges) {
      setShowUnsavedModal(true);
      return;
    }
    doCreateNewAgreement(profile);
  };

  const closeUnsavedModal = () => {
    setShowUnsavedModal(false);
  };

  const continueEditingWorkOrder = () => {
    navigateTo('form');
    closeUnsavedModal();
  };

  const handleSaveSuccess = async (savedJobId: string, isNewSave: boolean) => {
    setCurrentJobId(savedJobId);
    setWoCounterPersistError(null);
    if (!isNewSave) return;

    // Use session, not `user` from closure — after capture, React may not have re-rendered yet.
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (!uid) return;

    const fresh = await getProfile(uid);
    if (!fresh) return;

    const newCount = (fresh.next_wo_number ?? 1) + 1;
    const { error } = await updateNextWoNumber(uid, newCount);
    if (error) {
      console.error('Failed to persist next work order number:', error);
      setWoCounterPersistError(
        `Work order saved, but the next WO number could not be updated (${error.message}). Refresh the page before creating another work order, or the same number may be suggested again.`
      );
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

    // Session updates before this finishes; getProfile in useEffect can race and return null.
    setProfile(createdProfile);

    return { userId: authData.user.id, businessName: capture.businessName, email: capture.email };
  };

  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const st = e.state as AppHistoryState | null;
      const v = st?.view;
      if (isAppView(v)) setView(v);
      else setView('home');
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    const uid = user?.id;
    if (uid) {
      const run = async () => {
        setProfileLoading(true);
        const data = await getProfile(uid);
        if (data) {
          setProfile(data);
        } else {
          // Keep profile from capture upsert if fetch raced before the row was visible.
          setProfile((prev) => (prev?.user_id === uid ? prev : null));
        }
        setProfileLoading(false);
      };
      void run();
    } else {
      Promise.resolve().then(() => {
        setProfile(null);
        setProfileLoading(false);
      });
    }
  }, [user?.id]);

  const loadProfile = async (options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id;
    if (!uid) {
      if (!silent) setProfileLoading(false);
      return;
    }
    if (!silent) setProfileLoading(true);
    const data = await getProfile(uid);
    if (data) {
      setProfile(data);
    } else {
      setProfile((prev) => (prev?.user_id === uid ? prev : null));
    }
    if (!silent) setProfileLoading(false);
  };

  const handleEditProfileSaved = (savedProfile: BusinessProfile | null) => {
    if (savedProfile) setProfile(savedProfile);
    else void loadProfile({ silent: true });
  };

  const openWorkOrders = () => {
    navigateTo('work-orders');
  };

  const handleOpenWorkOrderDetail = (jobRow: Job) => {
    setWorkOrderDetailJob(jobRow);
    navigateTo('work-order-detail');
  };

  const handleBackFromWorkOrderDetail = () => {
    setWorkOrderDetailJob(null);
    navigateTo('work-orders');
  };

  const handleStartInvoice = (jobRow: Job) => {
    setInvoiceFlowJob(jobRow);
    setWizardExistingInvoice(null);
    setActiveInvoice(null);
    navigateTo('invoice-wizard');
  };

  const handleOpenPendingInvoice = (jobRow: Job, invoice: Invoice) => {
    setInvoiceFlowJob(jobRow);
    setActiveInvoice(invoice);
    navigateTo('invoice-final');
  };

  const handleInvoiceWizardSuccess = (invoice: Invoice) => {
    setActiveInvoice(invoice);
    setWizardExistingInvoice(null);
    navigateTo('invoice-final');
    void loadProfile({ silent: true });
  };

  const handleInvoiceWizardCancel = () => {
    if (wizardExistingInvoice) {
      setWizardExistingInvoice(null);
      navigateTo('invoice-final');
    } else {
      setInvoiceFlowJob(null);
      setActiveInvoice(null);
      navigateTo('work-orders');
    }
  };

  const handleInvoiceFinalWorkOrders = () => {
    navigateTo('work-orders');
    setInvoiceFlowJob(null);
    setActiveInvoice(null);
    setWizardExistingInvoice(null);
  };

  const handleEditInvoice = () => {
    if (!activeInvoice) return;
    setWizardExistingInvoice(activeInvoice);
    navigateTo('invoice-wizard');
  };

  const handleAfterInvoiceDownload = (inv: Invoice) => {
    setWorkOrdersSuccessBanner(
      `Invoice #${String(inv.invoice_number).padStart(4, '0')} downloaded and saved!`
    );
    navigateTo('work-orders');
    setInvoiceFlowJob(null);
    setActiveInvoice(null);
    void loadProfile({ silent: true });
  };

  const handleInvoiceUpdated = (inv: Invoice) => {
    setActiveInvoice(inv);
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
            setInvoiceFlowJob(null);
            setActiveInvoice(null);
            setWizardExistingInvoice(null);
            setWorkOrderDetailJob(null);
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
              onClick={() => navigateTo('profile')}
              aria-label="Edit profile"
            >
              <Settings className="btn-header-settings-icon" aria-hidden="true" />
            </button>
          )}
        </div>
      </header>

      {woCounterPersistError && (
        <div className="error-banner wo-counter-error-banner" role="alert">
          <span>{woCounterPersistError}</span>
          <button
            type="button"
            className="btn-dismiss-banner"
            onClick={() => setWoCounterPersistError(null)}
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
              window.history.replaceState({ view: 'home' }, '');
              setView('home');
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
            onCancel={() => navigateTo('home')}
          />
        ) : view === 'profile' && !profile ? (
          homePageEl
        ) : view === 'work-orders' && user ? (
          <WorkOrdersPage
            userId={user.id}
            successBanner={workOrdersSuccessBanner}
            onClearSuccessBanner={() => setWorkOrdersSuccessBanner(null)}
            onStartInvoice={handleStartInvoice}
            onOpenPendingInvoice={handleOpenPendingInvoice}
            onOpenWorkOrderDetail={handleOpenWorkOrderDetail}
          />
        ) : view === 'work-order-detail' && profile && workOrderDetailJob ? (
          <WorkOrderDetailPage
            job={workOrderDetailJob}
            profile={profile}
            onBack={handleBackFromWorkOrderDetail}
          />
        ) : view === 'invoice-wizard' && user && profile && invoiceFlowJob ? (
          <InvoiceWizard
            key={`${invoiceFlowJob.id}-${wizardExistingInvoice?.id ?? 'new'}`}
            userId={user.id}
            job={invoiceFlowJob}
            profile={profile}
            existingInvoice={wizardExistingInvoice}
            onCancel={handleInvoiceWizardCancel}
            onSuccess={handleInvoiceWizardSuccess}
          />
        ) : view === 'invoice-final' && user && profile && invoiceFlowJob && activeInvoice ? (
          <InvoiceFinalPage
            invoice={activeInvoice}
            job={invoiceFlowJob}
            profile={profile}
            onWorkOrders={handleInvoiceFinalWorkOrders}
            onEditInvoice={handleEditInvoice}
            onAfterDownload={handleAfterInvoiceDownload}
            onInvoiceUpdated={handleInvoiceUpdated}
          />
        ) : view === 'form' ? (
          <JobForm
            userId={user?.id}
            job={job}
            onChange={setJob}
            businessName={profile?.business_name}
            onGoToPreview={() => navigateTo('preview')}
          />
        ) : (
          <AgreementPreview
            job={job}
            profile={profile}
            existingJobId={currentJobId ?? undefined}
            onSaveSuccess={handleSaveSuccess}
            onCaptureAndSave={!user ? handleCaptureAndSave : undefined}
            onCaptureFlowFinished={() => {
              void loadProfile({ silent: true });
            }}
          />
        )}
      </main>

      <footer className="app-footer">
        <p>ScopeLock - Protect Your Work</p>
      </footer>

      {showUnsavedModal && (
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
