import './App.css';
import React, { useState, useCallback } from 'react';
import { I18nProvider } from './lib/manchala-i18n.react.js';
import Dashboard from './Dashboard';
import DocAIWizard from './DocAIWizard';
import BatchReport from './BatchReport';

const BACKEND = process.env.REACT_APP_BACKEND_URL;

/**
 * App flow:
 *   1. Dashboard (first screen — stats, quick actions, Sarvam balance)
 *   2. Wizard     (process a document — 10-step pipeline)
 *   3. BatchReport (full batch listing with search/filter/export)
 */
function AppShell() {
  const [screen, setScreen] = useState('dashboard'); // 'dashboard' | 'wizard' | 'batches'
  const [openBatchId, setOpenBatchId] = useState(null);

  const goWizard = useCallback((batchId) => {
    setOpenBatchId(batchId || null);
    setScreen('wizard');
  }, []);

  const goBatches = useCallback(() => setScreen('batches'), []);
  const goDashboard = useCallback(() => setScreen('dashboard'), []);

  if (screen === 'wizard') {
    return (
      <DocAIWizard
        initialBatchId={openBatchId}
        onGoToDashboard={goDashboard}
        onGoToBatches={goBatches}
      />
    );
  }

  if (screen === 'batches') {
    return (
      <BatchReport
        onBack={goDashboard}
        onOpenBatch={(id) => goWizard(id)}
      />
    );
  }

  // Default: Dashboard
  return (
    <Dashboard
      onStartWizard={() => goWizard(null)}
      onViewAllBatches={goBatches}
      onOpenBatch={(id) => goWizard(id)}
      isFirstScreen={true}
    />
  );
}

function App() {
  return (
    <I18nProvider apiBase={BACKEND} defaultLang="en-IN">
      <AppShell />
    </I18nProvider>
  );
}

export default App;
