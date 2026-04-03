import { Outlet } from 'react-router-dom';
import { MobileAppShell } from '../components/MobileAppShell.js';
import { NodesIcon, NotificationsIcon, OverviewIcon, TasksIcon } from '../components/MobileIcons.js';

export function MobileAdminLayout() {
  const tabs = [
    { to: '/m/admin', label: '首页', icon: <OverviewIcon className="h-4 w-4" /> },
    { to: '/m/admin/tasks', label: '任务', icon: <TasksIcon className="h-4 w-4" /> },
    { to: '/m/admin/nodes', label: '节点', icon: <NodesIcon className="h-4 w-4" /> },
    { to: '/m/admin/notifications', label: '通知', icon: <NotificationsIcon className="h-4 w-4" /> },
  ];

  return (
    <MobileAppShell
      headerKicker="PMEOW operator"
      title="管理控制台"
      description="在移动端查看节点、任务与告警状态，保持与 Web 控制台一致的监测层级。"
      capsuleLabel="ADMIN"
      badges={['节点监测', '任务调度', '实时通知']}
      tabs={tabs}
    >
      <div className="px-1 py-2">
        <Outlet />
      </div>
    </MobileAppShell>
  );
}
