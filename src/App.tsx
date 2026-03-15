import { useState, useEffect } from 'react';
import type { WelderJob } from './types';
import { JobForm } from './components/JobForm';
import { AgreementPreview } from './components/AgreementPreview';
import { AuthPage } from './components/AuthPage';
import { BusinessProfileForm } from './components/BusinessProfileForm';
import { HomePage } from './components/HomePage';
import { EditProfilePage } from './components/EditProfilePage';
import { useAuth } from './hooks/useAuth';
import { signOut } from './lib/auth';
import { getProfile } from './lib/db/profile';
import type { BusinessProfile } from './types/db';
import sampleJob from './data/sample-job.json';
import './App.css';

function App() {
  const { user, loading: authLoading } = useAuth();
  const [profile, setProfile] = useState<BusinessProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [view, setView] = useState<'home' | 'form' | 'preview' | 'profile'>('home');
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
      };
      loadProfile();
    } else {
      setProfile(null);
      setProfileLoading(false);
    }
  }, [user]);

  const loadProfile = async () => {
    if (!user) return;
    setProfileLoading(true);
    const data = await getProfile(user.id);
    setProfile(data);
    setProfileLoading(false);
  };

  if (authLoading || profileLoading) {
    return <div className="app-loading">Loading...</div>;
  }

  if (!user) {
    return <AuthPage />;
  }

  if (!profile) {
    return (
      <BusinessProfileForm
        userId={user.id}
        initialProfile={null}
        onSave={loadProfile}
      />
    );
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
          {showTabs && (
            <button
              type="button"
              className="btn-home"
              onClick={() => setView('home')}
            >
              Home
            </button>
          )}
          <button
            type="button"
            className="btn-edit-profile"
            onClick={() => setView('profile')}
          >
            Edit Profile
          </button>
          <button
            type="button"
            className="btn-sign-out"
            onClick={() => signOut()}
          >
            Sign Out
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
            businessName={profile?.business_name}
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
