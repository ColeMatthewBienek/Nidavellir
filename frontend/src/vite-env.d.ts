/// <reference types="vite/client" />

interface Window {
  nidavellir?: {
    pickWorkingSetFiles: () => Promise<string[]>;
    pickDirectory?: () => Promise<string | null>;
    pickSkillPath?: () => Promise<string | null>;
    openCodeRef?: (path: string, startLine?: number, endLine?: number) => Promise<void>;
  };
}
