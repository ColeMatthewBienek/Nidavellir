import { RightSidebar } from './RightSidebar';

interface ContextPanelProps {
  onClose: () => void;
}

export function ContextPanel({ onClose }: ContextPanelProps) {
  return <RightSidebar onClose={onClose} />;
}
