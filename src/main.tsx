import React from 'react';
import { createRoot } from 'react-dom/client';
import Entry from './Entry';
import './styles.css';
import './overview.css';
import './guidance.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><Entry /></React.StrictMode>);
