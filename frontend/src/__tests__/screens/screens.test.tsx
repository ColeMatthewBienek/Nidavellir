import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
// All fail (red) until screen files exist
import { ChatScreen }     from '../../screens/ChatScreen';
import { PlanScreen }     from '../../screens/PlanScreen';
import { ScheduleScreen } from '../../screens/ScheduleScreen';
import { AgentsScreen }   from '../../screens/AgentsScreen';
import { TasksScreen }    from '../../screens/TasksScreen';
import { SkillsScreen }   from '../../screens/SkillsScreen';
import { SettingsScreen } from '../../screens/SettingsScreen';

describe('Placeholder screens', () => {
  it('ChatScreen renders without crashing', () => {
    expect(() => render(<ChatScreen />)).not.toThrow();
  });

  it('ChatScreen renders the thread list', () => {
    render(<ChatScreen />);
    expect(screen.getAllByText('auth-refactor').length).toBeGreaterThan(0);
  });

  it('PlanScreen renders without crashing', () => {
    expect(() => render(<PlanScreen />)).not.toThrow();
  });

  it('ScheduleScreen renders without crashing', () => {
    expect(() => render(<ScheduleScreen />)).not.toThrow();
  });

  it('AgentsScreen renders without crashing', () => {
    expect(() => render(<AgentsScreen />)).not.toThrow();
  });

  it('TasksScreen renders without crashing', () => {
    expect(() => render(<TasksScreen />)).not.toThrow();
  });

  it('SkillsScreen renders without crashing', () => {
    expect(() => render(<SkillsScreen />)).not.toThrow();
  });

  it('SettingsScreen renders without crashing', () => {
    expect(() => render(<SettingsScreen />)).not.toThrow();
  });
});
