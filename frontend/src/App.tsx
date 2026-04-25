import React, { useEffect, useState } from 'react';
import { useAppStore } from './store';
import { NavSidebar } from './components/nav/NavSidebar';
import { ChatScreen }     from './screens/ChatScreen';
import { PlanScreen }     from './screens/PlanScreen';
import { ScheduleScreen } from './screens/ScheduleScreen';
import { AgentsScreen }   from './screens/AgentsScreen';
import { TasksScreen }    from './screens/TasksScreen';
import { SkillsScreen }   from './screens/SkillsScreen';
import { SettingsScreen } from './screens/SettingsScreen';
import { SpawnModal }     from './components/SpawnModal';
import { api } from './api/client';
import type { ScreenId } from './types';
import { useProviders } from './hooks/useProviders';
import { initSocket } from './lib/agentSocket';

const SCREENS: Record<ScreenId, React.ReactElement> = {
  chat:     <ChatScreen />,
  plan:     <PlanScreen />,
  schedule: <ScheduleScreen />,
  agents:   <AgentsScreen />,
  tasks:    <TasksScreen />,
  skills:   <SkillsScreen />,
  settings: <SettingsScreen />,
};

export function App() {
  const activeScreen    = useAppStore((s) => s.activeScreen);
  const setActiveScreen = useAppStore((s) => s.setActiveScreen);
  const setBackendStatus = useAppStore((s) => s.setBackendStatus);
  const [spawnOpen, setSpawnOpen] = useState(false);

  useProviders(); // pre-warms provider store on mount
  useEffect(() => { initSocket(); }, []); // establish WebSocket on app load

  useEffect(() => {
    async function checkHealth() {
      try {
        const { response } = await api.GET('/api/health');
        setBackendStatus(response.ok ? 'ok' : 'error');
      } catch {
        setBackendStatus('error');
      }
    }
    checkHealth();
    const interval = setInterval(checkHealth, 30_000);
    return () => clearInterval(interval);
  }, [setBackendStatus]);

  useEffect(() => {
    const onSpawn = () => setSpawnOpen(true);
    const onNav   = (e: Event) => setActiveScreen((e as CustomEvent<string>).detail as ScreenId);
    window.addEventListener('nid:spawn',    onSpawn);
    window.addEventListener('nid:navigate', onNav);
    return () => {
      window.removeEventListener('nid:spawn',    onSpawn);
      window.removeEventListener('nid:navigate', onNav);
    };
  }, [setActiveScreen]);

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <NavSidebar />
      <div key={activeScreen} className="nid-screen"
        style={{ flex: 1, display: 'flex', overflow: 'hidden', minWidth: 0 }}>
        {SCREENS[activeScreen]}
      </div>
      {spawnOpen && <SpawnModal onClose={() => setSpawnOpen(false)} />}
    </div>
  );
}
