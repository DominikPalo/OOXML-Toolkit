import { createRoot } from 'react-dom/client';
import './styles/tokens.css';
import './styles/app.css';
import { App } from './App';
import { installDebugHooks } from './debug';

installDebugHooks();
createRoot(document.getElementById('root')!).render(<App />);
