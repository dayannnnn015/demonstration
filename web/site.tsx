import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Site } from './site/Site';
import './styles/site.css';

createRoot(document.getElementById('site')!).render(<StrictMode><Site /></StrictMode>);
