import { useState, useEffect } from 'react';
import type { WelderJob } from './types';
import { JobForm } from './components/JobForm';
import { AgreementPreview } from './components/AgreementPreview';
import { AuthPage } from './components/AuthPage';
import { BusinessProfileForm } from './components/BusinessProfileForm';
import { PasswordCreationPage } from './components/PasswordCreationPage';
import { HomePage } from './components/HomePage';
import { EditProfilePage } from './components/EditProfilePage';
import { useAuth } from './hooks/useAuth';
import { getProfile, upsertProfile } from './lib/db/profile';
import { signUp } from './lib/auth';
import { getDefaultCustomerObligations, getDefaultExclusions } from './lib/defaults';
import type { BusinessProfile } from './types/db';
import sampleJob from './data/sample-job.json';
import { Settings } from 'lucide-react';
import './App.css';

type OnboardingStep = 'profile' | 'password' | null;

interface OnboardingData {
  businessName: string;
  ownerName: string;
  phone: string;
  email: string;
  address: string;
  googleUrl: string;
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
  const [view, setView] = useState<'home' | 'form' | 'preview' | 'profile'>('home');
  const [onboardingStep, setOnboardingStep] = useState<OnboardingStep>(null);
  const [onboardingData, setOnboardingData] = useState<OnboardingData | null>(null);
  const [showAuthPage, setShowAuthPage] = useState(false);
  const [showSuccessBanner, setShowSuccessBanner] = useState(false);
  const [accountCreating, setAccountCreating] = useState(false);
  const [justCompletedSignup, setJustCompletedSignup] = useState(false);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [woIsOpen, setWoIsOpen] = useState(false);
  const [showUnsavedModal, setShowUnsavedModal] = useState(false);
  const [job, setJob] = useState<WelderJob>(() => ({
    ...(sampleJob as WelderJob),
    contractor_name: '',
  }));
  const [draftBaseline, setDraftBaseline] = useState<WelderJob | null>(null);

  const doCreateNewAgreement = (currentProfile: BusinessProfile | null) => {
    const nextDraft = buildNewAgreementDraft(currentProfile);
    setJob(nextDraft);
    setDraftBaseline(nextDraft);
    setCurrentJobId(null);
    setWoIsOpen(true);
    setView('form');
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
    setView('form');
    closeUnsavedModal();
  };

  const handleSaveSuccess = (savedJobId: string, isNewSave: boolean) => {
    setCurrentJobId(savedJobId);
    if (isNewSave && profile) {
      const newCount = (profile.next_wo_number ?? 1) + 1;
      const updatedProfile = { ...profile, next_wo_number: newCount };
      setProfile(updatedProfile);
      upsertProfile({ user_id: profile.user_id, next_wo_number: newCount });
    }
  };

  useEffect(() => {
    if (user) {
      const loadProfile = async () => {
        setShowAuthPage(false);
        setProfileLoading(true);
        const data = await getProfile(user.id);
        setProfile(data);
        setProfileLoading(false);
        setAccountCreating(false);
        if (justCompletedSignup && data) {
          setJustCompletedSignup(false);
        }
      };
      loadProfile();
    } else {
      Promise.resolve().then(() => {
        setProfile(null);
        setProfileLoading(false);
      });
    }
  }, [user, justCompletedSignup]);

  const loadProfile = async () => {
    if (!user) return;
    setProfileLoading(true);
    const data = await getProfile(user.id);
    setProfile(data);
    setProfileLoading(false);
  };

  const handleNewUserContinue = (profileData: OnboardingData) => {
    setOnboardingData(profileData);
    setOnboardingStep('password');
  };

  const handleCreateAccount = async (password: string) => {
    if (!onboardingData) {
      throw new Error('Profile data is missing');
    }

    setAccountCreating(true);

    const { data, error } = await signUp(onboardingData.email, password);

    if (error || !data.user) {
      setAccountCreating(false);
      throw new Error(error?.message || 'Failed to create account');
    }

    const { error: profileError } = await upsertProfile({
      user_id: data.user.id,
      business_name: onboardingData.businessName,
      owner_name: onboardingData.ownerName || null,
      phone: onboardingData.phone || null,
      email: onboardingData.email || null,
      address: onboardingData.address || null,
      google_business_profile_url: onboardingData.googleUrl || null,
      default_exclusions: getDefaultExclusions(),
      default_assumptions: getDefaultCustomerObligations(),
    });

    if (profileError) {
      setAccountCreating(false);
      throw new Error(profileError.message);
    }

    setShowSuccessBanner(true);
    setJustCompletedSignup(true);
    setOnboardingStep(null);
    setOnboardingData(null);
    setView('home');
  };

  if (authLoading || profileLoading || accountCreating) {
    return (
      <div className="app-loading">
        {accountCreating ? 'Creating your account...' : 'Loading...'}
      </div>
    );
  }

  if (!user && !showAuthPage) {
    if (onboardingStep === 'password' && onboardingData) {
      return (
        <PasswordCreationPage
          email={onboardingData.email}
          onCreateAccount={handleCreateAccount}
          onBack={() => setOnboardingStep(null)}
        />
      );
    }

    return (
      <BusinessProfileForm
        isNewUser={true}
        onContinue={handleNewUserContinue}
        onSignInClick={() => setShowAuthPage(true)}
      />
    );
  }

  if (!user && showAuthPage) {
    return <AuthPage onSignUpClick={() => setShowAuthPage(false)} />;
  }

  if (user && !profile && !justCompletedSignup) {
    return (
      <BusinessProfileForm
        userId={user.id}
        initialProfile={null}
        onSave={loadProfile}
      />
    );
  }

  if (!profile) {
    if (justCompletedSignup) {
      return <div className="app-loading">Setting up your account...</div>;
    }
    return null;
  }

  if (view === 'profile') {
    return (
      <EditProfilePage
        profile={profile}
        onSave={loadProfile}
        onCancel={() => setView('home')}
      />
    );
  }

  const showTabs = view === 'form' || view === 'preview';

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title" onClick={() => setView('home')}>ScopeLock</h1>
        <div className="header-actions">
          <button
            type="button"
            className="btn-header-settings"
            onClick={() => setView('profile')}
            aria-label="Edit profile"
          >
            <Settings className="btn-header-settings-icon" aria-hidden="true" />
          </button>
        </div>
      </header>

      {showTabs && (
        <nav className="tab-nav">
          <button
            className={`tab-button ${view === 'form' ? 'active' : ''}`}
            onClick={() => setView('form')}
          >
            Edit Work Order
          </button>
          <button
            className={`tab-button ${view === 'preview' ? 'active' : ''}`}
            onClick={() => setView('preview')}
          >
            Preview
          </button>
        </nav>
      )}

      <main className="app-main">
        {view === 'home' ? (
          <HomePage
            onCreateAgreement={createNewAgreement}
            ownerName={profile?.owner_name || profile?.business_name}
            showSuccessBanner={showSuccessBanner}
            onDismissBanner={() => setShowSuccessBanner(false)}
          />
        ) : view === 'form' ? (
          <JobForm
            job={job}
            onChange={setJob}
            businessName={profile?.business_name}
            jobPersisted={Boolean(currentJobId)}
          />
        ) : (
          <AgreementPreview
            job={job}
            profile={profile}
            existingJobId={currentJobId ?? undefined}
            onSaveSuccess={handleSaveSuccess}
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
