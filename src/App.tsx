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
import type { BusinessProfile } from './types/db';
import sampleJob from './data/sample-job.json';
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
  const [job, setJob] = useState<WelderJob>(() => ({
    ...(sampleJob as WelderJob),
    contractor_name: '',
  }));

  // Populate job with profile defaults when creating a new Work Agreement
  const createNewAgreement = () => {
    const defaults = profile
      ? {
          contractor_name: profile.business_name,
          exclusions: profile.default_exclusions?.length ? profile.default_exclusions : sampleJob.exclusions,
          assumptions: profile.default_assumptions?.length ? profile.default_assumptions : sampleJob.assumptions,
        }
      : {};

    setJob({
      ...(sampleJob as WelderJob),
      contractor_name: '',
      exclusions: [],
      assumptions: [],
      ...defaults,
    });
    setView('form');
  };

  useEffect(() => {
    if (profile && view !== 'profile') {
      // Only update contractor_name, not exclusions/assumptions (preserves user edits)
      setJob((prev) => ({ ...prev, contractor_name: profile.business_name }));
    }
  }, [profile?.business_name, view]);

  useEffect(() => {
    if (user) {
      const loadProfile = async () => {
        setProfileLoading(true);
        const data = await getProfile(user.id);
        setProfile(data);
        setProfileLoading(false);
        // Reset account creating state when user is authenticated
        setAccountCreating(false);
        // Reset signup flag once profile is loaded
        if (justCompletedSignup && data) {
          setJustCompletedSignup(false);
        }
      };
      loadProfile();
    } else {
      setProfile(null);
      setProfileLoading(false);
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

    // Create account
    const { data, error } = await signUp(onboardingData.email, password);

    if (error || !data.user) {
      setAccountCreating(false);
      throw new Error(error?.message || 'Failed to create account');
    }

    // Save profile
    const { error: profileError } = await upsertProfile({
      user_id: data.user.id,
      business_name: onboardingData.businessName,
      owner_name: onboardingData.ownerName || null,
      phone: onboardingData.phone || null,
      email: onboardingData.email || null,
      address: onboardingData.address || null,
      google_business_profile_url: onboardingData.googleUrl || null,
      default_exclusions: [],
      default_assumptions: [],
    });

    if (profileError) {
      setAccountCreating(false);
      throw new Error(profileError.message);
    }

    // Set flags for successful signup
    setShowSuccessBanner(true);
    setJustCompletedSignup(true);
    setOnboardingStep(null);
    setOnboardingData(null);
    setView('home'); // Ensure we land on home page
    // Keep accountCreating true - will be reset when auth state updates
  };

  if (authLoading || profileLoading || accountCreating) {
    return (
      <div className="app-loading">
        {accountCreating ? 'Creating your account...' : 'Loading...'}
      </div>
    );
  }

  // New user onboarding flow
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

  // Returning user sign in
  if (!user && showAuthPage) {
    return <AuthPage />;
  }

  // Authenticated user without profile
  // Skip this if user just completed signup (profile is still loading)
  if (user && !profile && !justCompletedSignup) {
    return (
      <BusinessProfileForm
        userId={user.id}
        initialProfile={null}
        onSave={loadProfile}
      />
    );
  }

  // User is authenticated and has profile
  // If user just completed signup and profile is still loading, show loading state
  if (!profile) {
    if (justCompletedSignup) {
      return <div className="app-loading">Setting up your account...</div>;
    }
    return null;
  }

  // Show EditProfilePage when view === 'profile'
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
            className="btn-header-action"
            onClick={() => setView('profile')}
          >
            Edit Profile
          </button>
        </div>
      </header>

      {showTabs && (
        <nav className="tab-nav">
          <button
            className={`tab-button ${view === 'form' ? 'active' : ''}`}
            onClick={() => setView('form')}
          >
            Work Agreement
          </button>
          <button
            className={`tab-button ${view === 'preview' ? 'active' : ''}`}
            onClick={() => setView('preview')}
          >
            Agreement Preview
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
          <JobForm job={job} onChange={setJob} />
        ) : (
          <AgreementPreview job={job} />
        )}
      </main>

      <footer className="app-footer">
        <p>ScopeLock - Protect Your Work</p>
      </footer>
    </div>
  );
}

export default App;
