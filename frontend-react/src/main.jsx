import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter, Link, Route, Routes } from 'react-router-dom';
import './index.css';
import { AppProvider } from './context/AppContext.jsx';
import Layout from './components/Layout.jsx';
import { Empty } from './components/ui.jsx';
import Dashboard from './pages/Dashboard.jsx';
import NewBooking from './pages/NewBooking.jsx';
import Requests from './pages/Requests.jsx';
import RequestDetail from './pages/RequestDetail.jsx';
import Inbox from './pages/Inbox.jsx';
import Issues from './pages/Issues.jsx';
import Calendar from './pages/Calendar.jsx';
import Notifications from './pages/Notifications.jsx';

// Hash routes (/#/requests/123) work the same whether the backend or nginx serves the files: no server fallback needed.
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppProvider>
      <HashRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="new" element={<NewBooking />} />
            <Route path="requests" element={<Requests />} />
            <Route path="requests/:key" element={<RequestDetail />} />
            <Route path="inbox" element={<Inbox />} />
            <Route path="issues" element={<Issues />} />
            <Route path="calendar" element={<Calendar />} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="*" element={<Empty>That page does not exist. <Link to="/">Go to the room board</Link>.</Empty>} />
          </Route>
        </Routes>
      </HashRouter>
    </AppProvider>
  </StrictMode>,
);
