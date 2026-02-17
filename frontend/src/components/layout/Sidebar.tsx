import { NavLink } from 'react-router-dom';
import { useAuthStore } from '../../store/auth';
import {
  LayoutDashboard, AlertTriangle, Server, FileText,
  Bell, Settings, Shield, Users, LogOut,
} from 'lucide-react';

const clientNav = [
  { to: '/', icon: LayoutDashboard, label: 'Дашборд' },
  { to: '/incidents', icon: AlertTriangle, label: 'Инциденты' },
  { to: '/sources', icon: Server, label: 'Источники' },
  { to: '/reports', icon: FileText, label: 'Отчёты' },
  { to: '/notifications', icon: Bell, label: 'Уведомления' },
];

const socNav = [
  { to: '/soc', icon: LayoutDashboard, label: 'Обзор SOC' },
  { to: '/soc/publish', icon: AlertTriangle, label: 'Публикация' },
  { to: '/soc/users', icon: Users, label: 'Пользователи' },
];

export default function Sidebar() {
  const { user, logout } = useAuthStore();
  const isSoc = user?.role?.startsWith('soc_');
  const nav = isSoc ? [...socNav, ...clientNav.slice(1)] : clientNav;

  return (
    <aside className="fixed left-0 top-0 bottom-0 w-60 bg-surface-900 border-r border-surface-800 flex flex-col z-30">
      {/* Logo */}
      <div className="h-16 flex items-center gap-2.5 px-5 border-b border-surface-800">
        <Shield className="w-7 h-7 text-brand-500" />
        <div>
          <span className="font-semibold text-sm text-surface-100 tracking-tight">MSSP SOC</span>
          <span className="block text-[10px] text-surface-500 -mt-0.5 tracking-widest uppercase">Portal</span>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-3 space-y-0.5 overflow-y-auto">
        {isSoc && (
          <div className="px-2 pt-1 pb-2">
            <span className="text-[10px] font-semibold text-surface-500 uppercase tracking-widest">SOC</span>
          </div>
        )}
        {isSoc && socNav.map((item) => (
          <SidebarLink key={item.to} {...item} />
        ))}
        {isSoc && (
          <div className="px-2 pt-4 pb-2">
            <span className="text-[10px] font-semibold text-surface-500 uppercase tracking-widest">Клиент</span>
          </div>
        )}
        {(isSoc ? clientNav : nav).map((item) => (
          <SidebarLink key={item.to} {...item} />
        ))}
      </nav>

      {/* User */}
      <div className="p-3 border-t border-surface-800">
        <div className="flex items-center gap-2.5 px-2 py-1.5">
          <div className="w-8 h-8 rounded-full bg-brand-600/20 flex items-center justify-center text-brand-400 text-xs font-semibold">
            {user?.name?.charAt(0).toUpperCase() || '?'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-surface-200 truncate">{user?.name}</p>
            <p className="text-[11px] text-surface-500 truncate">{user?.role?.replace('_', ' ')}</p>
          </div>
          <button
            onClick={logout}
            className="p-1.5 rounded-lg hover:bg-surface-800 text-surface-500 hover:text-surface-300 transition-colors"
            title="Выйти"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>
    </aside>
  );
}

function SidebarLink({ to, icon: Icon, label }: { to: string; icon: React.ElementType; label: string }) {
  return (
    <NavLink
      to={to}
      end={to === '/' || to === '/soc'}
      className={({ isActive }) =>
        `flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${
          isActive
            ? 'bg-brand-600/10 text-brand-400'
            : 'text-surface-400 hover:bg-surface-800 hover:text-surface-200'
        }`
      }
    >
      <Icon className="w-[18px] h-[18px]" />
      {label}
    </NavLink>
  );
}
