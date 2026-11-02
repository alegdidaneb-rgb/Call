import React, { Suspense } from "react";
import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "@/components/auth/AuthProvider";
import { signOut } from "@/lib/auth";
import { Layout } from "@/components/common/Layout";
import { ErrorBoundary } from "@/components/common/ErrorBoundary";
import type { AppRole } from "@/types/app";

const LoginPage = React.lazy(() => import("@/pages/LoginPage").then((m) => ({ default: m.LoginPage })));
const SetupPage = React.lazy(() => import("@/pages/SetupPage").then((m) => ({ default: m.SetupPage })));
const DashboardPage = React.lazy(() => import("@/pages/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const LeadsPage = React.lazy(() => import("@/pages/LeadsPage").then((m) => ({ default: m.LeadsPage })));
const LeadDetailPage = React.lazy(() => import("@/pages/LeadDetailPage").then((m) => ({ default: m.LeadDetailPage })));
const CampaignPage = React.lazy(() => import("@/pages/CampaignPage").then((m) => ({ default: m.CampaignPage })));
const CallHistoryPage = React.lazy(() => import("@/pages/CallHistoryPage").then((m) => ({ default: m.CallHistoryPage })));
const ScriptsPage = React.lazy(() => import("@/pages/ScriptsPage").then((m) => ({ default: m.ScriptsPage })));
const AdminPage = React.lazy(() => import("@/pages/AdminPage").then((m) => ({ default: m.AdminPage })));
const TeamPage = React.lazy(() => import("@/pages/TeamPage").then((m) => ({ default: m.TeamPage })));

function PageSpinner() {
  return (
    <div className="flex items-center justify-center h-64">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600"></div>
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600"></div>
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  if (!user.provisioned) {
    return <PendingActivation email={user.email} />;
  }
  return <>{children}</>;
}

/**
 * An account that authenticated but was never onboarded by an administrator.
 *
 * RLS gives such an account no rows at all, so rendering the normal shell would
 * show empty tables that look like a successful load. Say plainly what is wrong
 * instead.
 */
function PendingActivation({ email }: { email: string | null }) {
  const navigate = useNavigate();

  async function handleSignOut() {
    await signOut();
    navigate("/login");
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
        <h1 className="text-lg font-bold text-gray-900">Waiting for an administrator</h1>
        <p className="text-sm text-gray-600 mt-2">
          {email ? `The account ${email} ` : "This account "}
          can sign in, but it has not been given access to any data. Accounts are created and
          activated by an administrator from the Team page.
        </p>
        <button
          onClick={handleSignOut}
          className="mt-6 px-4 py-2 rounded-lg border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50 transition"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

/**
 * Role gate for privileged screens.
 *
 * The `/admin` route was previously reachable by any signed-in user. This is a
 * UI-level control only -- the API and the Supabase RLS policies are what
 * actually enforce authorisation.
 */
function RequireRole({ roles, children }: { roles: AppRole[]; children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return <PageSpinner />;
  }
  if (!user || !roles.includes(user.role)) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}

function AppRoutes() {
  return (
    <Routes>
      <Route path="/login" element={<Suspense fallback={<PageSpinner />}><LoginPage /></Suspense>} />
      <Route path="/setup" element={<Suspense fallback={<PageSpinner />}><SetupPage /></Suspense>} />
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <Layout>
              <Suspense fallback={<PageSpinner />}>
                <Routes>
                  <Route index element={<Navigate to="/dashboard" replace />} />
                  <Route path="dashboard" element={<DashboardPage />} />
                  <Route path="leads" element={<LeadsPage />} />
                  <Route path="leads/:leadId" element={<LeadDetailPage />} />
                  <Route path="campaigns" element={<CampaignPage />} />
                  <Route path="scripts" element={<ScriptsPage />} />
                  <Route path="history" element={<CallHistoryPage />} />
                  <Route
                    path="admin"
                    element={
                      <RequireRole roles={["admin"]}>
                        <AdminPage />
                      </RequireRole>
                    }
                  />
                  <Route
                    path="team"
                    element={
                      <RequireRole roles={["admin"]}>
                        <TeamPage />
                      </RequireRole>
                    }
                  />
                </Routes>
              </Suspense>
            </Layout>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppRoutes />
    </ErrorBoundary>
  );
}
