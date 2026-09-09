import React from 'react';
import LiteOverlay from './components/LiteOverlay';
import SettingsPopup from './components/SettingsPopup';
import { ErrorBoundary } from './components/ErrorBoundary';

const CropperWindow = React.lazy(() => import('./components/Cropper'));

const App: React.FC = () => {
  const windowType = new URLSearchParams(window.location.search).get('window');

  if (windowType === 'cropper') {
    return (
      <React.Suspense fallback={<div className="w-screen h-screen bg-transparent" />}>
        <CropperWindow />
      </React.Suspense>
    );
  }

  if (windowType === 'settings') {
    return (
      <ErrorBoundary context="MiaodaSettingsPopup">
        <SettingsPopup />
      </ErrorBoundary>
    );
  }

  if (windowType === 'assistant-interview' || windowType === 'assistant-written') {
    const assistant = windowType === 'assistant-interview' ? 'interview' : 'written';
    return (
      <ErrorBoundary context={`Miaoda${assistant}Assistant`}>
        <div className="w-full h-full relative overflow-hidden bg-transparent">
          <LiteOverlay standaloneAssistant={assistant} />
        </div>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary context="MiaodaLiteOverlay">
      <div className="w-full h-full relative overflow-hidden bg-transparent">
        <LiteOverlay />
      </div>
    </ErrorBoundary>
  );
};

export default App;
