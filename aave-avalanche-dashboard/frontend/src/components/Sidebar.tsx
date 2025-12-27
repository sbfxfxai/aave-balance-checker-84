import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { 
  LayoutDashboard, 
  TrendingUp, 
  ArrowLeftRight, 
  User, 
  Settings,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';

interface SidebarProps {
  collapsed?: boolean;
  onToggle?: () => void;
}

const navItems = [
  { icon: LayoutDashboard, label: 'Dashboard', path: '/' },
  { icon: TrendingUp, label: 'GMX', path: '/gmx' },
  { icon: ArrowLeftRight, label: 'Swap', path: '/swap' },
  { icon: User, label: 'Account', path: '/account' },
  { icon: Settings, label: 'Settings', path: '/settings' },
];

export function Sidebar({ collapsed = false, onToggle }: SidebarProps) {
  const location = useLocation();
  const [isCollapsed, setIsCollapsed] = useState(collapsed);

  const handleToggle = () => {
    setIsCollapsed(!isCollapsed);
    onToggle?.();
  };

  return (
    <aside 
      className={`
        fixed left-0 top-0 h-full z-40
        bg-sidebar border-r border-sidebar-border
        transition-all duration-300 ease-in-out
        ${isCollapsed ? 'w-16' : 'w-64'}
      `}
    >
      {/* Logo Header */}
      <div className="h-16 flex items-center px-4 border-b border-sidebar-border">
        <div className="flex items-center gap-3">
          <img src="/tiltvault-logo.png" alt="TiltVault" className="w-8 h-8 object-contain" />
          {!isCollapsed && (
            <span className="text-sidebar-foreground font-semibold text-lg">TiltVault</span>
          )}
        </div>
      </div>

      {/* Navigation */}
      <nav className="mt-4 px-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.path;
          
          return (
            <Link
              key={item.path}
              to={item.path}
              className={`
                flex items-center gap-3 px-3 py-3 rounded-lg mb-1
                transition-all duration-200
                ${isActive 
                  ? 'bg-primary/20 text-primary' 
                  : 'text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground'
                }
              `}
            >
              <Icon className="w-5 h-5 flex-shrink-0" />
              {!isCollapsed && (
                <span className="font-medium">{item.label}</span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Collapse Toggle */}
      <button
        onClick={handleToggle}
        className="
          absolute bottom-4 right-0 translate-x-1/2
          w-6 h-6 rounded-full
          bg-sidebar-accent border border-sidebar-border
          flex items-center justify-center
          text-muted-foreground hover:text-sidebar-foreground
          transition-colors
        "
      >
        {isCollapsed ? (
          <ChevronRight className="w-3 h-3" />
        ) : (
          <ChevronLeft className="w-3 h-3" />
        )}
      </button>
    </aside>
  );
}
