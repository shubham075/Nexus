import { NavLink, Outlet } from 'react-router-dom';
import { BarChart3, Flag, KeyRound, Network, ScrollText, Users } from 'lucide-react';
import { useAuth } from '@/lib/auth';

export default function AdminLayout() {
  const perms = useAuth((s) => s.me?.permissions ?? []);
  const has = (...ps: string[]) => perms.includes('admin.all') || ps.some((p) => perms.includes(p));
  const items = [
    { to: 'hierarchy', label: 'Hierarchy', icon: <Network size={18} />, show: has('hierarchy.manage', 'users.manage', 'roles.manage') },
    { to: 'roles', label: 'Roles & permissions', icon: <KeyRound size={18} />, show: has('roles.manage') },
    { to: 'users', label: 'Employees', icon: <Users size={18} />, show: has('users.manage') },
    { to: 'reports', label: 'Moderation queue', icon: <Flag size={18} />, show: has('report.review') },
    { to: 'analytics', label: 'Analytics', icon: <BarChart3 size={18} />, show: has('analytics.view') },
    { to: 'audit', label: 'Audit log', icon: <ScrollText size={18} />, show: has('analytics.view') },
  ];
  return (
    <div className="grid h-full grid-cols-[220px_minmax(0,1fr)]">
      <aside className="border-r border-zinc-200 bg-white p-3">
        <div className="mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Admin console</div>
        {items.filter((i) => i.show).map((i) => (
          <NavLink key={i.to} to={i.to} className={({ isActive }) => `flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold ${isActive ? 'bg-brand-50 text-brand-600' : 'text-zinc-700 hover:bg-zinc-100'}`}>
            {i.icon} {i.label}
          </NavLink>
        ))}
      </aside>
      <div className="h-full min-h-0 overflow-y-auto"><Outlet /></div>
    </div>
  );
}
