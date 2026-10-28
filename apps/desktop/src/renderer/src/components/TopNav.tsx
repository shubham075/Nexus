import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bell, Briefcase, Home, MessageSquareText, Search, Shield, Users, Network as OrgIcon, Bookmark, CalendarDays, Newspaper, UsersRound, LogOut, KeyRound, Download, Building2, Check } from 'lucide-react';
import { APP_NAME } from '@nexus/shared';
import { api, downloadJson } from '@/lib/api';
import { useToasts } from '@/lib/toast';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/theme';
import { Monitor, Moon, Sun } from 'lucide-react';
import { Avatar, Menu, MenuItem } from './ui';

function NavItem({ to, icon, label, badge }: { to: string; icon: React.ReactNode; label: string; badge?: number }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) =>
        `relative flex min-w-[52px] lg:min-w-[76px] flex-col items-center justify-center border-b-2 px-2 pt-1 text-xs ${isActive ? 'border-zinc-900 text-zinc-900' : 'border-transparent text-zinc-500 hover:text-zinc-900'}`
      }
    >
      <span className="relative">
        {icon}
        {!!badge && (
          <span className="absolute -right-2.5 -top-1.5 min-w-[18px] rounded-full bg-red-600 px-1 text-center text-[11px] font-semibold leading-[18px] text-white">
            {badge > 99 ? '99+' : badge}
          </span>
        )}
      </span>
      <span className="mt-0.5 hidden lg:block">{label}</span>
    </NavLink>
  );
}

/** Multi mode only (SOT D23): pick the active organization; single mode has exactly one and shows nothing. */
function OrgSwitcher() {
  const { me, switchOrg } = useAuth();
  if (me!.tenancy !== 'multi' || !me!.orgs.length) return null;
  const active = me!.orgs.find((o) => o.id === me!.activeOrgId);
  return (
    <Menu
      align="left"
      trigger={
        <button className="flex h-9 max-w-[160px] items-center gap-1.5 rounded-full px-3 text-sm font-medium text-zinc-700 hover:bg-zinc-100" title="Switch organization">
          <Building2 size={16} className="shrink-0" />
          <span className="truncate">{active?.name ?? 'Organization'}</span>
        </button>
      }
    >
      {me!.orgs.map((o) => (
        <MenuItem key={o.id} icon={o.id === active?.id ? <Check size={16} /> : <span className="w-4" />} onClick={() => o.id !== active?.id && switchOrg(o.id)}>
          {o.name}
        </MenuItem>
      ))}
    </Menu>
  );
}

export function TopNav() {
  const { me, logout } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const { pref: theme, set: setTheme } = useTheme();
  const isAdmin = me!.permissions.some((p) => ['admin.all', 'hierarchy.manage', 'roles.manage', 'users.manage', 'report.review', 'analytics.view'].includes(p));

  const { data: notif } = useQuery({ queryKey: ['notifications', 'count'], queryFn: () => api.get<{ count: number }>('/notifications/unread-count'), refetchInterval: 60_000 });
  const { data: msgs } = useQuery({ queryKey: ['conversations', 'unread'], queryFn: () => api.get<{ unread: number }>('/conversations/unread'), refetchInterval: 60_000 });
  const { data: stats } = useQuery({ queryKey: ['network', 'stats'], queryFn: () => api.get('/network/stats') });

  const total = (notif?.count ?? 0) + (msgs?.unread ?? 0);
  useEffect(() => {
    window.nexus.setBadge(total);
  }, [total]);

  return (
    <header className="sticky top-0 z-30 border-b border-zinc-200/70 bg-surface/80 backdrop-blur-xl">
      <div className="mx-auto flex h-[52px] max-w-[1180px] items-center gap-2 px-4">
        <NavLink to="/" className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-900 text-base font-semibold text-surface" title={APP_NAME}>
          N
        </NavLink>
        <form
          className="relative ml-1 w-44 lg:w-72"
          onSubmit={(e) => {
            e.preventDefault();
            if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`);
          }}
        >
          <Search size={16} className="absolute left-3 top-2.5 text-zinc-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people, posts, jobs, units…" className="h-9 w-full rounded-full bg-zinc-100 pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-zinc-300" />
        </form>
        <OrgSwitcher />

        <nav className="ml-auto flex h-full items-stretch">
          <NavItem to="/" icon={<Home size={22} />} label="Home" />
          <NavItem to="/network" icon={<Users size={22} />} label="My Network" badge={stats?.invites} />
          <NavItem to="/jobs" icon={<Briefcase size={22} />} label="Jobs" />
          <NavItem to="/messaging" icon={<MessageSquareText size={22} />} label="Messaging" badge={msgs?.unread} />
          <NavItem to="/notifications" icon={<Bell size={22} />} label="Notifications" badge={notif?.count} />
          <Menu
            trigger={
              <button className="flex h-full min-w-[52px] lg:min-w-[76px] flex-col items-center justify-center px-2 pt-1 text-xs text-zinc-500 hover:text-zinc-900">
                <Avatar user={me!} size={24} />
                <span className="mt-0.5 hidden lg:block">Me ▾</span>
              </button>
            }
          >
            <div className="border-b border-zinc-200 px-4 pb-3 pt-2">
              <div className="flex gap-2">
                <Avatar user={me!} size={48} />
                <div>
                  <div className="font-semibold">{me!.name}</div>
                  <div className="text-xs text-zinc-600">{me!.headline}</div>
                </div>
              </div>
              <button className="btn-outline mt-2 w-full py-0.5" onClick={() => navigate(`/profile/${me!.id}`)}>
                View profile
              </button>
            </div>
            <MenuItem icon={<OrgIcon size={16} />} onClick={() => navigate('/org')}>Org chart</MenuItem>
            <MenuItem icon={<UsersRound size={16} />} onClick={() => navigate('/groups')}>Groups</MenuItem>
            <MenuItem icon={<CalendarDays size={16} />} onClick={() => navigate('/events')}>Events</MenuItem>
            <MenuItem icon={<Newspaper size={16} />} onClick={() => navigate('/articles')}>Articles & newsletters</MenuItem>
            <MenuItem icon={<Bookmark size={16} />} onClick={() => navigate('/saved')}>Saved items</MenuItem>
            <MenuItem icon={<KeyRound size={16} />} onClick={() => navigate('/settings/password')}>Change password</MenuItem>
            <MenuItem
              icon={<Download size={16} />}
              onClick={() =>
                downloadJson('/users/me/export', `nexus-export-${new Date().toISOString().slice(0, 10)}.json`)
                  .then(() => useToasts.getState().push('Your data export was downloaded', 'info'))
                  .catch((e) => useToasts.getState().push(e.message))
              }
            >
              Export my data
            </MenuItem>
            <div className="flex items-center justify-between px-4 py-2 text-sm font-medium text-zinc-700" onClick={(e) => e.stopPropagation()}>
              Theme
              <div className="flex rounded-full bg-zinc-100 p-0.5">
                {([['light', <Sun size={14} key="l" />], ['system', <Monitor size={14} key="s" />], ['dark', <Moon size={14} key="d" />]] as const).map(([p, icon]) => (
                  <button key={p} title={p} onClick={() => setTheme(p)} className={`rounded-full p-1.5 ${theme === p ? 'bg-surface text-zinc-900 shadow-soft' : 'text-zinc-500'}`}>{icon}</button>
                ))}
              </div>
            </div>
            <div className="my-1 border-t border-zinc-200" />
            <MenuItem icon={<LogOut size={16} />} onClick={logout}>Sign out</MenuItem>
          </Menu>
          {isAdmin && (
            <>
              <div className="mx-1 my-2 border-l border-zinc-200" />
              <NavItem to="/admin" icon={<Shield size={22} />} label="Admin" />
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
