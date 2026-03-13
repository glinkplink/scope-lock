import { useState } from 'react';
import type { WelderJob } from './types';
import { JobForm } from './components/JobForm';
import { AgreementPreview } from './components/AgreementPreview';
import sampleJob from './data/sample-job.json';
import './App.css';

function App() {
  const [activeTab, setActiveTab] = useState<'form' | 'preview'>('form');
  const [job, setJob] = useState<WelderJob>(sampleJob as WelderJob);

  return (
    <div className="app">
      <header className="app-header">
        <h1>ScopeLock</h1>
        <p className="tagline">Simple Agreements for Welders</p>
      </header>

      <nav className="tab-nav">
        <button
          className={`tab-button ${activeTab === 'form' ? 'active' : ''}`}
          onClick={() => setActiveTab('form')}
        >
          Job Details
        </button>
        <button
          className={`tab-button ${activeTab === 'preview' ? 'active' : ''}`}
          onClick={() => setActiveTab('preview')}
        >
          Agreement Preview
        </button>
      </nav>

      <main className="app-main">
        {activeTab === 'form' ? (
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
