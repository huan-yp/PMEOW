import { TaskBrowser } from '../components/TaskBrowser.js';

export default function Tasks() {
  return (
    <div className="space-y-6">
      <div>
        <p className="brand-kicker">任务调度</p>
        <h2 className="text-xl font-bold text-slate-100">任务列表</h2>
      </div>

      <TaskBrowser />
    </div>
  );
}
