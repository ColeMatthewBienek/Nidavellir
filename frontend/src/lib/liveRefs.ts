export type LiveRefKind = 'code' | 'document';

export interface CodeRef {
  kind: LiveRefKind;
  path: string;
  startLine?: number;
  endLine?: number;
  label: string;
}

const CODE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'cpp', 'c', 'h', 'cs',
  'sh', 'css', 'html', 'json', 'yaml', 'yml', 'toml', 'md', 'mdx',
]);

function extension(path: string): string {
  const clean = path.split(/[?#]/, 1)[0];
  const dot = clean.lastIndexOf('.');
  return dot === -1 ? '' : clean.slice(dot + 1).toLowerCase();
}

function decodePath(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function parseCodeRef(raw: string): CodeRef | null {
  const value = raw.trim();
  if (!value) return null;

  const schemeMatch = value.match(/^code:\/\/(.+?)(?:#L(\d+)(?:-L?(\d+))?)?$/i);
  if (schemeMatch) {
    const path = decodePath(schemeMatch[1]);
    const startLine = schemeMatch[2] ? Number(schemeMatch[2]) : undefined;
    const endLine = schemeMatch[3] ? Number(schemeMatch[3]) : startLine;
    return {
      kind: CODE_EXTENSIONS.has(extension(path)) ? 'code' : 'document',
      path,
      startLine,
      endLine,
      label: startLine ? `${path}:${startLine}${endLine && endLine !== startLine ? `-${endLine}` : ''}` : path,
    };
  }

  const pathMatch = value.match(/^(.+\.[A-Za-z0-9]+):(\d+)(?:-(\d+))?$/);
  if (!pathMatch) return null;
  const path = decodePath(pathMatch[1]);
  const ext = extension(path);
  if (!CODE_EXTENSIONS.has(ext)) return null;
  const startLine = Number(pathMatch[2]);
  const endLine = pathMatch[3] ? Number(pathMatch[3]) : startLine;
  return {
    kind: ext === 'md' || ext === 'mdx' ? 'document' : 'code',
    path,
    startLine,
    endLine,
    label: `${path}:${startLine}${endLine !== startLine ? `-${endLine}` : ''}`,
  };
}

export function buildCodePreviewUrl(ref: CodeRef, base?: string | null): string {
  const params = new URLSearchParams({ path: ref.path });
  if (ref.startLine) params.set('start', String(ref.startLine));
  if (ref.endLine) params.set('end', String(ref.endLine));
  if (base) params.set('base', base);
  return `http://localhost:7430/api/refs/code?${params.toString()}`;
}
