import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { useAuth, useIsTenantAdmin } from "./lib/auth";
import { LoginPage } from "./pages/LoginPage";
import { Layout } from "./components/Layout";
import { SitesHome } from "./pages/SitesHome";
import { DevicesPage } from "./pages/DevicesPage";
import { DeviceDetail } from "./pages/DeviceDetail";
import { DashboardsLayout } from "./pages/DashboardsPage";
import { DashboardDetail } from "./pages/DashboardDetail";
import { RulesPage } from "./pages/RulesPage";
import { AlarmsPage } from "./pages/AlarmsPage";
import { AlarmDetailPage } from "./pages/AlarmDetailPage";
import { MembersPage } from "./pages/MembersPage";
import { ZonesPage } from "./pages/ZonesPage";
import { UsersPage } from "./pages/admin/UsersPage";
import { RolesPage } from "./pages/admin/RolesPage";
import { AuditPage } from "./pages/admin/AuditPage";
import type { ReactNode } from "react";

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div className="p-8 text-sm text-slate-400">Chargement…</div>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequireTenantAdmin({ children }: { children: ReactNode }) {
  const isAdmin = useIsTenantAdmin();
  if (!isAdmin) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />

      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index element={<SitesHome />} />
        <Route path="sites/:id">
          <Route index            element={<Navigate to="dashboards" replace />} />
          <Route path="devices"   element={<DevicesPage />} />
          <Route path="devices/:deviceId" element={<DeviceDetail />} />
          <Route path="dashboards" element={<DashboardsLayout />}>
            <Route path=":did" element={<DashboardDetail />} />
          </Route>
          <Route path="rules"   element={<RulesPage />} />
          <Route path="alarms"  element={<AlarmsPage />} />
          <Route path="alarms/:alarmId" element={<AlarmDetailPage />} />
          <Route path="members" element={<MembersPage />} />
          <Route path="zones"   element={<ZonesPage />} />
        </Route>
        <Route path="admin" element={<RequireTenantAdmin><Outlet /></RequireTenantAdmin>}>
          <Route path="users" element={<UsersPage />} />
          <Route path="roles" element={<RolesPage />} />
          <Route path="audit" element={<AuditPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
