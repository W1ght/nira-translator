import React from 'react';
import { createRoot } from 'react-dom/client';

import '../../src/styles/app.css';
import { OptionsApp } from './OptionsApp';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <OptionsApp />
  </React.StrictMode>,
);

