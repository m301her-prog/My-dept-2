import { Routes, Route, Navigate } from 'react-router-dom';
import { useApp } from './context/AppContext.jsx';
import Auth from './pages/Auth.jsx';
import Home from './pages/Home.jsx';
import DebtList from './pages/DebtList.jsx';
import DebtForm from './pages/DebtForm.jsx';
import DebtDetail from './pages/DebtDetail.jsx';
import DebtStatistics from './pages/DebtStatistics.jsx';
import Settings from './pages/Settings.jsx';
import Admin from './pages/Admin.jsx';
import Notification from './components/Notification.jsx';

/**
 * Protected Route Component
 * Ensures user is authenticated before accessing route
 */
function ProtectedRoute({ children }) {
  const { isAuthenticated } = useApp();

  if (!isAuthenticated) {
    return <Navigate to="/auth" replace />;
  }

  return children;
}

/**
 * Admin Route Component
 * Ensures user is authenticated AND is an admin
 */
function AdminRoute({ children }) {
  const { isAuthenticated, isAdmin } = useApp();

  if (!isAuthenticated) {
    return <Navigate to="/auth" replace />;
  }

  if (!isAdmin) {
    return <Navigate to="/" replace />;
  }

  return children;
}

/**
 * Auth Route Component
 * Redirects authenticated users to home
 */
function AuthRoute({ children }) {
  const { isAuthenticated } = useApp();

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  return children;
}

/**
 * Main App Component
 * Handles routing and notification display
 */
export default function App() {
  const { darkMode } = useApp();

  return (
    <div className={`min-h-screen ${darkMode ? 'dark' : ''}`}>
      <div className="min-h-screen bg-gray-50 dark:bg-gray-900 transition-colors duration-300">
        {/* Global Notification Component */}
        <Notification />

        {/* Application Routes */}
        <Routes>
          {/* Authentication Route - Public */}
          <Route
            path="/auth"
            element={
              <AuthRoute>
                <Auth />
              </AuthRoute>
            }
          />

          {/* Home Route - Protected */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Home />
              </ProtectedRoute>
            }
          />

          {/* Debts List Route - Protected */}
          <Route
            path="/debts"
            element={
              <ProtectedRoute>
                <DebtList />
              </ProtectedRoute>
            }
          />

          {/* Add Debt Route - Protected */}
          <Route
            path="/debts/add"
            element={
              <ProtectedRoute>
                <DebtForm />
              </ProtectedRoute>
            }
          />

          {/* Debt Detail Route - Protected */}
          <Route
            path="/debts/:id"
            element={
              <ProtectedRoute>
                <DebtDetail />
              </ProtectedRoute>
            }
          />

          {/* Edit Debt Route - Protected */}
          <Route
            path="/debts/:id/edit"
            element={
              <ProtectedRoute>
                <DebtForm />
              </ProtectedRoute>
            }
          />

          {/* Statistics Route - Protected */}
          <Route
            path="/statistics"
            element={
              <ProtectedRoute>
                <DebtStatistics />
              </ProtectedRoute>
            }
          />

          {/* Settings Route - Protected */}
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <Settings />
              </ProtectedRoute>
            }
          />

          {/* Admin Dashboard Route - Admin Only */}
          <Route
            path="/admin"
            element={
              <AdminRoute>
                <Admin />
              </AdminRoute>
            }
          />

          {/* Fallback Route - Redirect to Home */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
    </div>
  );
}
