import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { ActionFeedbackProvider } from './action-feedback.js';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <ActionFeedbackProvider><App operations={window.swcc} /></ActionFeedbackProvider>,
);
