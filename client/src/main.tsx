import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';
import { RouterProvider } from './router';
import { ToastProvider } from './toast';

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <RouterProvider>
            <ToastProvider>
                <App />
            </ToastProvider>
        </RouterProvider>
    </StrictMode>,
);
