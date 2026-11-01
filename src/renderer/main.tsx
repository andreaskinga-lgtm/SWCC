import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { ActionFeedbackProvider } from './action-feedback.js';
import './styles.css';

const root = createRoot(document.getElementById('root')!);
if (import.meta.env.DEV && new URLSearchParams(location.search).get('prototype') === 'friendlier') {
  void import('./friendlier-prototype.js').then(({ FriendlierPrototype }) => {
    root.render(<FriendlierPrototype />);
  });
} else {
  root.render(<ActionFeedbackProvider><App operations={window.swcc} /></ActionFeedbackProvider>);
}
