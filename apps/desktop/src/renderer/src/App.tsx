import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from './lib/auth';
import { onSocket } from './lib/socket';
import { Spinner, Toasts } from './components/ui';
import { TopNav } from './components/TopNav';
import { UpdateBanner } from './components/UpdateBanner';
import Login from './pages/Login';
import ChangePassword from './pages/ChangePassword';
import Feed from './pages/Feed';
import PostPage from './pages/PostPage';
import Profile from './pages/Profile';
import Network from './pages/Network';
import Messaging from './pages/Messaging';
import Notifications from './pages/Notifications';
import Search from './pages/Search';
import Hashtag from './pages/Hashtag';
import Saved from './pages/Saved';
import Groups from './pages/Groups';
import GroupPage from './pages/GroupPage';
import Events from './pages/Events';
import EventPage from './pages/EventPage';
import Articles from './pages/Articles';
import ArticlePage from './pages/ArticlePage';
import ArticleEditor from './pages/ArticleEditor';
import Jobs from './pages/Jobs';
import JobPage from './pages/JobPage';
import OrgChart from './pages/OrgChart';
import AdminLayout from './pages/admin/AdminLayout';
import AdminHierarchy from './pages/admin/Hierarchy';
import AdminRoles from './pages/admin/Roles';
import AdminUsers from './pages/admin/Users';
import AdminReports from './pages/admin/Reports';
import AdminAudit from './pages/admin/Audit';
import AdminAnalytics from './pages/admin/Analytics';
import Companies from './pages/Companies';
import CompanyPage from './pages/CompanyPage';
import CompanySettings from './pages/CompanySettings';
import Platform from './pages/Platform';

export default function App() {
  const { ready, me, boot } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();

  useEffect(() => {
    boot();
  }, [boot]);

  useEffect(() => window.nexus.onNavigate((p) => navigate(p)), [navigate]);

  // Realtime → cache invalidation + native desktop notifications (SOT §5.5)
  useEffect(() => {
    if (!me) return;
    const offs = [
      onSocket('notification:new', (n) => {
        qc.invalidateQueries({ queryKey: ['notifications'] });
        window.nexus.notify('Nexus', n.text, n.link ?? '/notifications');
      }),
      onSocket('message:new', (m) => {
        qc.invalidateQueries({ queryKey: ['conversations'] });
        qc.invalidateQueries({ queryKey: ['messages', m.conversationId] });
        if (m.senderId !== me.id) window.nexus.notify(m.sender.name, m.body || 'Sent an attachment', `/messaging/${m.conversationId}`);
      }),
      onSocket('message:read', (r) => qc.invalidateQueries({ queryKey: ['messages', r.conversationId] })),
    ];
    return () => offs.forEach((o) => o());
  }, [me, qc]);

  if (!ready) return <Spinner />;
  if (!me) return <Login />;
  if (me.mustChangePassword) return <ChangePassword forced />;

  return (
    <div className="flex h-full flex-col">
      <TopNav />
      <UpdateBanner />
      <Toasts />
      <main className="flex-1 overflow-y-auto" id="scroll-root">
        <ErrorBoundary resetKey={location.pathname}>
        <Routes>
          <Route path="/" element={<Feed />} />
          <Route path="/post/:id" element={<PostPage />} />
          <Route path="/profile/:id" element={<Profile />} />
          <Route path="/network" element={<Network />} />
          <Route path="/messaging" element={<Messaging />} />
          <Route path="/messaging/:id" element={<Messaging />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/search" element={<Search />} />
          <Route path="/hashtag/:tag" element={<Hashtag />} />
          <Route path="/saved" element={<Saved />} />
          <Route path="/groups" element={<Groups />} />
          <Route path="/groups/:id" element={<GroupPage />} />
          <Route path="/events" element={<Events />} />
          <Route path="/events/:id" element={<EventPage />} />
          <Route path="/articles" element={<Articles />} />
          <Route path="/articles/new" element={<ArticleEditor />} />
          <Route path="/articles/:id" element={<ArticlePage />} />
          <Route path="/articles/:id/edit" element={<ArticleEditor />} />
          <Route path="/jobs" element={<Jobs />} />
          <Route path="/jobs/:id" element={<JobPage />} />
          <Route path="/org" element={<OrgChart />} />
          <Route path="/settings/password" element={<ChangePassword />} />
          {me.tenancy === 'multi' && (
            <>
              <Route path="/companies" element={<Companies />} />
              <Route path="/invite" element={<Companies />} />
              <Route path="/companies/:id" element={<CompanyPage />} />
              <Route path="/companies/:id/settings" element={<CompanySettings />} />
              {me.isSuperAdmin && <Route path="/platform" element={<Platform />} />}
            </>
          )}
          <Route path="/admin" element={<AdminLayout />}>
            <Route index element={<Navigate to="hierarchy" replace />} />
            <Route path="hierarchy" element={<AdminHierarchy />} />
            <Route path="roles" element={<AdminRoles />} />
            <Route path="users" element={<AdminUsers />} />
            <Route path="reports" element={<AdminReports />} />
            <Route path="audit" element={<AdminAudit />} />
            <Route path="analytics" element={<AdminAnalytics />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </ErrorBoundary>
      </main>
    </div>
  );
}
