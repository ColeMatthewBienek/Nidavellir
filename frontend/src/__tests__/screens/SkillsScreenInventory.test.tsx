import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { SkillsScreen } from '../../screens/SkillsScreen';

const skills = [
  {
    id: 'review-helper',
    slug: 'review-helper',
    name: 'Review Helper',
    description: 'Reviews code with severity labels.',
    scope: 'global',
    activationMode: 'manual',
    triggers: [{ type: 'keyword', value: 'review', weight: 1 }],
    instructions: { core: '## Workflow\n\nReview carefully.\n\n- Find risks\n- Cite files\n\n```bash\nnpm test\n```', constraints: ['Be specific.'], steps: [], examples: [], anti_patterns: [] },
    requiredCapabilities: { file_read: true, file_write: false, shell: false, browser: false, vision: false, code_execution: false, network: false, long_context: false },
    priority: 60,
    enabled: true,
    showInSlash: false,
    version: 1,
    status: 'validated',
    source: { format: 'markdown', import_path: '/tmp/review.md' },
    updatedAt: '2026-04-28T10:00:00Z',
  },
  {
    id: 'draft-import',
    slug: 'draft-import',
    name: 'Draft Import',
    description: '',
    scope: 'global',
    activationMode: 'manual',
    triggers: [],
    instructions: {
      core: `---
description: Imported and waiting for review.
---

# Draft Import

This paragraph should never be fully dumped into the compact inventory card because the full instruction body belongs in the drawer only.

- Review the import
- Decide whether to enable it`,
      constraints: [],
      steps: [],
      examples: [],
      anti_patterns: [],
    },
    requiredCapabilities: { file_read: false, file_write: false, shell: false, browser: false, vision: false, code_execution: false, network: false, long_context: false },
    priority: 50,
    enabled: false,
    showInSlash: false,
    version: 1,
    status: 'validated',
    source: { format: 'claude_skill', import_path: '/tmp/SKILL.md' },
    updatedAt: '2026-04-28T09:00:00Z',
  },
];

describe('SkillsScreen skill inventory', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/api/skills') && !init) {
        return Response.json(skills);
      }
      if (url.endsWith('/api/skills/draft-import/enabled')) {
        return Response.json({ ...skills[1], enabled: true });
      }
      if (url.endsWith('/api/skills/review-helper/slash')) {
        return Response.json({ ...skills[0], showInSlash: true });
      }
      if (url.endsWith('/api/skills/review-helper') && init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body));
        return Response.json({
          ...skills[0],
          name: body.name,
          slug: body.slug,
          scope: body.scope,
          activationMode: body.activationMode,
          triggers: body.triggers,
          instructions: { ...skills[0].instructions, core: body.instructions },
          version: 2,
        });
      }
      if (url.endsWith('/api/skills/review-helper') && init?.method === 'DELETE') {
        return Response.json({ ok: true, deletedSkillId: 'review-helper' });
      }
      if (url.endsWith('/api/skills/import/local')) {
        return Response.json({
          ok: true,
          importId: 'import-1',
          detectedFormat: 'markdown',
          skill: skills[1],
          warnings: ['Imported skills are disabled until reviewed.'],
          errors: [],
        });
      }
      if (url.endsWith('/api/skills/import/markdown')) {
        return Response.json({
          ok: true,
          importId: 'import-paste',
          detectedFormat: 'markdown',
          skill: { ...skills[1], id: 'pasted-skill', name: 'Pasted Skill', source: { format: 'markdown' } },
          warnings: ['Imported skills are disabled until reviewed.'],
          errors: [],
        });
      }
      if (url.endsWith('/api/skills/import/upload')) {
        return Response.json({
          ok: true,
          importId: 'import-upload',
          detectedFormat: 'native',
          skill: { ...skills[1], id: 'uploaded-skill', name: 'Uploaded Skill', source: { format: 'native' } },
          warnings: ['Imported skills are disabled until reviewed.'],
          errors: [],
        });
      }
      if (url.endsWith('/api/skills/compile-preview')) {
        return Response.json({
          prompt_fragment: '## Activated Skills\n\n### Review Helper\nSkill ID: review-helper',
          injected_skill_ids: ['review-helper'],
          suppressed: [],
          estimated_tokens: 18,
        });
      }
      return Response.json({}, { status: 404 });
    }));
  });

  it('fetches real skills and renders inventory header stats and groups', async () => {
    render(<SkillsScreen />);

    expect(await screen.findByText('Skill Inventory')).toBeTruthy();
    expect(screen.getByText('2 loaded · 1 enabled · 1 needs review')).toBeTruthy();
    expect(screen.getByText('Enabled (1)')).toBeTruthy();
    expect(screen.getByText('Needs Review (1)')).toBeTruthy();
    expect(screen.getByText('Review Helper')).toBeTruthy();
    expect(screen.getByText('Imported and waiting for review.')).toBeTruthy();
    expect(screen.queryByText(/This paragraph should never be fully dumped/)).toBeNull();
  });

  it('filters to needs review from API data', async () => {
    render(<SkillsScreen />);

    await screen.findByText('Review Helper');
    fireEvent.click(screen.getByRole('button', { name: 'Needs Review' }));

    expect(screen.getByText('Draft Import')).toBeTruthy();
    expect(screen.queryByText('Review Helper')).toBeNull();
  });

  it('opens details and enables a reviewed imported skill through the API', async () => {
    render(<SkillsScreen />);

    fireEvent.click(await screen.findByRole('button', { name: /Draft Import/i }));

    const drawer = screen.getByLabelText('Skill details');
    expect(within(drawer).getByText('Overview')).toBeTruthy();
    expect(within(drawer).getByText('Claude Skill')).toBeTruthy();

    fireEvent.click(within(drawer).getByRole('button', { name: 'Enable Skill' }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:7430/api/skills/draft-import/enabled',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('renders markdown in expanded skill instructions', async () => {
    render(<SkillsScreen />);

    fireEvent.click(await screen.findByRole('button', { name: /Review Helper/i }));
    const drawer = screen.getByLabelText('Skill details');

    expect(within(drawer).getByRole('heading', { name: 'Workflow' })).toBeTruthy();
    expect(within(drawer).getByText('Find risks')).toBeTruthy();
    expect(within(drawer).getByText('Cite files')).toBeTruthy();
    expect(within(drawer).getAllByText((_, node) => node?.textContent === 'npm test').length).toBeGreaterThan(0);
    expect(within(drawer).queryByText(/## Workflow/)).toBeNull();
  });

  it('edits skill routing, activation, scope, triggers, and instruction text', async () => {
    render(<SkillsScreen />);

    fireEvent.click(await screen.findByRole('button', { name: /Review Helper/i }));
    const drawer = screen.getByLabelText('Skill details');
    fireEvent.click(within(drawer).getByRole('button', { name: 'Edit Skill' }));

    fireEvent.change(within(drawer).getByLabelText('Skill name'), {
      target: { value: 'Review Helper Edited' },
    });
    fireEvent.change(within(drawer).getByLabelText('Slash command'), {
      target: { value: 'review-helper-edited' },
    });
    fireEvent.change(within(drawer).getByLabelText('Skill scope'), {
      target: { value: 'project' },
    });
    fireEvent.change(within(drawer).getByLabelText('Activation mode'), {
      target: { value: 'automatic' },
    });
    fireEvent.change(within(drawer).getByLabelText('Trigger value'), {
      target: { value: 'review now' },
    });
    fireEvent.change(within(drawer).getByLabelText('Skill text'), {
      target: { value: '## Edited Workflow\n\nReview with the new rules.' },
    });
    fireEvent.click(within(drawer).getByRole('button', { name: 'Save Changes' }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:7430/api/skills/review-helper',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({
            name: 'Review Helper Edited',
            slug: 'review-helper-edited',
            instructions: '## Edited Workflow\n\nReview with the new rules.',
            scope: 'project',
            activationMode: 'automatic',
            triggers: [{ type: 'keyword', value: 'review now', weight: 1 }],
          }),
        }),
      );
    });
    expect(await within(drawer).findByText('Review Helper Edited')).toBeTruthy();
    expect(within(drawer).getByRole('heading', { name: 'Edited Workflow' })).toBeTruthy();
  });

  it('offers an invoke action for enabled skills', async () => {
    const invoke = vi.fn();
    const navigate = vi.fn();
    window.addEventListener('nid:invoke-skill', invoke);
    window.addEventListener('nid:navigate', navigate);

    render(<SkillsScreen />);

    fireEvent.click(await screen.findByRole('button', { name: /Review Helper/i }));
    const drawer = screen.getByLabelText('Skill details');
    fireEvent.click(within(drawer).getByRole('button', { name: 'Invoke Skill' }));

    expect(invoke).toHaveBeenCalled();
    expect((invoke.mock.calls[0][0] as CustomEvent).detail).toEqual({ slug: 'review-helper' });
    expect(navigate).toHaveBeenCalled();
    expect((navigate.mock.calls[0][0] as CustomEvent).detail).toBe('chat');

    window.removeEventListener('nid:invoke-skill', invoke);
    window.removeEventListener('nid:navigate', navigate);
  });

  it('toggles whether an enabled skill appears in the slash menu', async () => {
    render(<SkillsScreen />);

    fireEvent.click(await screen.findByRole('button', { name: /Review Helper/i }));
    const drawer = screen.getByLabelText('Skill details');
    fireEvent.click(within(drawer).getByLabelText('Show in / menu'));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:7430/api/skills/review-helper/slash',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ showInSlash: true }),
        }),
      );
    });
    expect(within(drawer).getByLabelText('Show in / menu')).toBeChecked();
  });

  it('deletes a skill after confirmation', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const changed = vi.fn();
    window.addEventListener('nid:skills-changed', changed);
    render(<SkillsScreen />);

    fireEvent.click(await screen.findByRole('button', { name: /Review Helper/i }));
    const drawer = screen.getByLabelText('Skill details');
    fireEvent.click(within(drawer).getByRole('button', { name: 'Delete Skill' }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:7430/api/skills/review-helper',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
    expect(screen.queryByLabelText('Skill details')).toBeNull();
    expect(changed).toHaveBeenCalled();
    window.removeEventListener('nid:skills-changed', changed);
  });

  it('imports from a local path and renders import warnings', async () => {
    render(<SkillsScreen />);

    fireEvent.click(await screen.findByRole('button', { name: '+ Import Skill' }));
    const dialog = screen.getByRole('dialog', { name: 'Import Skill' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Local Folder' }));
    fireEvent.change(within(dialog).getByLabelText('Local skill path'), { target: { value: '/tmp/review.md' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));

    expect(await within(dialog).findByText(/disabled until reviewed/i)).toBeTruthy();
  });

  it('opens the native directory picker for local imports when available', async () => {
    const pickSkillPath = vi.fn(async () => '/tmp/SKILL.md');
    vi.stubGlobal('window', Object.assign(window, {
      nidavellir: { ...(window.nidavellir ?? {}), pickSkillPath },
    }));
    render(<SkillsScreen />);

    fireEvent.click(await screen.findByRole('button', { name: '+ Import Skill' }));
    const dialog = screen.getByRole('dialog', { name: 'Import Skill' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Local Folder' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Browse' }));

    expect(await within(dialog).findByDisplayValue('/tmp/SKILL.md')).toBeTruthy();
    expect(pickSkillPath).toHaveBeenCalled();
  });

  it('imports pasted markdown through the API', async () => {
    render(<SkillsScreen />);

    fireEvent.click(await screen.findByRole('button', { name: '+ Import Skill' }));
    const dialog = screen.getByRole('dialog', { name: 'Import Skill' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Paste Markdown' }));
    fireEvent.change(within(dialog).getByLabelText('Pasted skill markdown'), {
      target: { value: '# Pasted Skill\n\nUse this skill.' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:7430/api/skills/import/markdown',
        expect.objectContaining({ method: 'POST' }),
      );
    });
    expect(await screen.findByText('Pasted Skill')).toBeTruthy();
  });

  it('uploads a selected skill package through multipart import', async () => {
    render(<SkillsScreen />);

    fireEvent.click(await screen.findByRole('button', { name: '+ Import Skill' }));
    const dialog = screen.getByRole('dialog', { name: 'Import Skill' });
    const file = new File(['# Uploaded Skill\n\nBody'], 'skill.md', { type: 'text/markdown' });
    fireEvent.change(within(dialog).getByLabelText('Skill package file'), { target: { files: [file] } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import' }));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:7430/api/skills/import/upload',
        expect.objectContaining({ method: 'POST', body: expect.any(FormData) }),
      );
    });
    expect(await screen.findByText('Uploaded Skill')).toBeTruthy();
  });

  it('renders compile preview output from the backend', async () => {
    render(<SkillsScreen />);

    fireEvent.click(await screen.findByRole('button', { name: 'Compile Preview' }));

    expect(await screen.findByText('18 tokens')).toBeTruthy();
    expect(screen.getByText(/Skill ID: review-helper/i)).toBeTruthy();
  });
});
