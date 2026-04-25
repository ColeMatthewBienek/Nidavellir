import { useState } from 'react';
import { ProviderIcon } from './shared/ProviderIcon';

const PROVIDERS = [
  { id: 'anthropic', label: 'Anthropic', models: ['claude-opus-4','claude-sonnet-4','claude-haiku-4-5'] },
  { id: 'openai',    label: 'OpenAI',    models: ['o3','o4-mini','gpt-4o'] },
  { id: 'google',    label: 'Google',    models: ['gemini-2.5-pro','gemini-2.0-flash'] },
];
const MODEL_META: Record<string, { ctx: string; strength: string }> = {
  'claude-opus-4':     { ctx: '200k', strength: 'Complex reasoning, long-context tasks' },
  'claude-sonnet-4':   { ctx: '200k', strength: 'Balanced speed & capability' },
  'claude-haiku-4-5':  { ctx: '200k', strength: 'Fast, lightweight tasks' },
  'o3':                { ctx: '200k', strength: 'Advanced reasoning & math' },
  'o4-mini':           { ctx: '128k', strength: 'Efficient coding & tool use' },
  'gpt-4o':            { ctx: '128k', strength: 'Multimodal, broad capability' },
  'gemini-2.5-pro':    { ctx: '1M',   strength: 'Massive context, deep analysis' },
  'gemini-2.0-flash':  { ctx: '1M',   strength: 'Ultra-fast responses at scale' },
};
const SPAWN_SKILLS = ['Interviewer','Spec Editor','Reviewer','Consolidator','Orchestrator','Spec Writer'];
const SPAWN_STEPS  = ['Provider','Configure','Skills','Launch'];

interface SpawnModalProps {
  onClose: () => void;
}

export function SpawnModal({ onClose }: SpawnModalProps) {
  const [step, setStep]           = useState(0);
  const [provider, setProvider]   = useState('anthropic');
  const [model, setModel]         = useState('claude-opus-4');
  const [name, setName]           = useState('');
  const [task, setTask]           = useState('');
  const [workdir, setWorkdir]     = useState('./workspace');
  const [skills, setSkills]       = useState(['Spec Editor']);
  const [launching, setLaunching] = useState(false);
  const [launched, setLaunched]   = useState(false);

  const providerObj  = PROVIDERS.find((p) => p.id === provider)!;
  const meta         = MODEL_META[model] ?? {};
  const defaultName  = `${model.split('-')[0]}-${String(Date.now()).slice(-4)}`;
  const displayName  = name.trim() || defaultName;

  const toggleSkill = (sk: string) =>
    setSkills((prev) => prev.includes(sk) ? prev.filter((s) => s !== sk) : [...prev, sk]);

  const launch = () => {
    setLaunching(true);
    setTimeout(() => { setLaunching(false); setLaunched(true); }, 2400);
  };

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: '#0d111799', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div style={{ width: 500, background: 'var(--bg1)', border: '1px solid var(--bd)', borderRadius: 10, overflow: 'hidden', boxShadow: '0 24px 64px #000000aa', animation: 'nidFadeSlide 0.2s ease-out' }}>

        {/* Header */}
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--t0)' }}>Spawn Agent</div>
            <div style={{ fontSize: 11, color: 'var(--t1)', marginTop: 2 }}>Configure and launch a new agent instance</div>
          </div>
          <span onClick={onClose} style={{ cursor: 'pointer', color: 'var(--t1)', fontSize: 16, lineHeight: 1 }}>✕</span>
        </div>

        {/* Step indicator */}
        <div style={{ padding: '12px 20px', borderBottom: '1px solid var(--bd)', display: 'flex', alignItems: 'center', background: 'var(--bg0)' }}>
          {SPAWN_STEPS.map((s, i) => (
            <div key={s} style={{ display: 'contents' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{
                  width: 20, height: 20, borderRadius: '50%', fontSize: 9, fontWeight: 700,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  background: i < step ? 'var(--grnd)' : i === step ? 'var(--blu)' : 'var(--bg2)',
                  border: `1px solid ${i < step ? 'var(--grnd)' : i === step ? 'var(--blu)' : 'var(--bd)'}`,
                  color: '#fff',
                }}>
                  {i < step ? '✓' : i + 1}
                </span>
                <span style={{ fontSize: 12, color: i === step ? 'var(--t0)' : 'var(--t1)', fontWeight: i === step ? 500 : 400 }}>{s}</span>
              </div>
              {i < SPAWN_STEPS.length - 1 && (
                <div style={{ flex: 1, height: 1, background: i < step ? 'var(--grnd)' : 'var(--bd)', margin: '0 10px' }}/>
              )}
            </div>
          ))}
        </div>

        {/* Content */}
        <div style={{ padding: 20, minHeight: 240 }}>
          {launched ? (
            <div style={{ textAlign: 'center', padding: '16px 0' }}>
              <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#3fb95018', border: '1px solid #3fb95044', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 14px', fontSize: 22 }}>⚡</div>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--grn)', marginBottom: 6 }}>Agent launched</div>
              <div style={{ fontSize: 12, color: 'var(--t1)', marginBottom: 16 }}>{displayName} is now active</div>
              <div style={{ background: 'var(--bg0)', border: '1px solid var(--bd)', borderRadius: 6, padding: '12px 14px', textAlign: 'left', fontFamily: 'var(--mono)', fontSize: 12, lineHeight: 1.9 }}>
                <div>agent_id  <span style={{ color: 'var(--grn)' }}>{displayName}</span></div>
                <div>model     <span style={{ color: 'var(--blu)' }}>{model}</span></div>
                <div>provider  <span style={{ color: 'var(--t0)' }}>{providerObj.label}</span></div>
                <div>status    <span style={{ color: 'var(--grn)' }}>active ●</span></div>
                {task && <div>task      <span style={{ color: 'var(--t0)' }}>{task}</span></div>}
              </div>
            </div>
          ) : launching ? (
            <div style={{ textAlign: 'center', padding: '32px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'center', gap: 6, marginBottom: 14 }}>
                {[0,1,2].map((i) => (
                  <span key={i} style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--grn)', display: 'inline-block', animation: `nidBounce 1.2s ${i*0.2}s ease-in-out infinite` }}/>
                ))}
              </div>
              <div style={{ fontSize: 13, color: 'var(--t0)' }}>
                Spawning <span style={{ fontFamily: 'var(--mono)', color: 'var(--grn)' }}>{displayName}</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--t1)', marginTop: 6 }}>
                Initialising workspace · Loading skills · Connecting to {providerObj.label}
              </div>
            </div>
          ) : (
            <>
              {step === 0 && (
                <div>
                  <div style={{ fontSize: 11, color: 'var(--t1)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.6px' }}>Provider</div>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
                    {PROVIDERS.map((p) => (
                      <div key={p.id} onClick={() => { setProvider(p.id); setModel(p.models[0]); }} style={{
                        flex: 1, padding: 10, borderRadius: 6,
                        border: `1px solid ${provider === p.id ? 'var(--blu)' : 'var(--bd)'}`,
                        background: provider === p.id ? '#1f6feb12' : 'var(--bg0)',
                        cursor: 'pointer', textAlign: 'center', transition: 'all 0.15s',
                      }}>
                        <ProviderIcon provider={p.label} size={28}/>
                        <div style={{ fontSize: 12, fontWeight: 500, color: provider === p.id ? 'var(--t0)' : 'var(--t1)', marginTop: 5 }}>{p.label}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--t1)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.6px' }}>Model</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {providerObj.models.map((m) => (
                      <div key={m} onClick={() => setModel(m)} style={{
                        padding: '10px 14px', borderRadius: 6,
                        border: `1px solid ${model === m ? 'var(--blu)' : 'var(--bd)'}`,
                        background: model === m ? '#1f6feb10' : 'var(--bg0)',
                        cursor: 'pointer', transition: 'all 0.15s',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      }}>
                        <span style={{ fontSize: 13, fontFamily: 'var(--mono)', color: model === m ? 'var(--t0)' : 'var(--t1)' }}>{m}</span>
                        <span style={{ fontSize: 11, color: 'var(--t1)' }}>{MODEL_META[m]?.ctx} ctx</span>
                      </div>
                    ))}
                  </div>
                  {meta.strength && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--t1)', fontStyle: 'italic' }}>Best for: {meta.strength}</div>}
                </div>
              )}

              {step === 1 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  {[
                    { label: 'Agent name',        val: name,    set: setName,    ph: defaultName       },
                    { label: 'Task (optional)',    val: task,    set: setTask,    ph: 'e.g. auth-refactor' },
                    { label: 'Working directory',  val: workdir, set: setWorkdir, ph: './workspace'      },
                  ].map((f) => (
                    <div key={f.label}>
                      <div style={{ fontSize: 11, color: 'var(--t1)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.6px' }}>{f.label}</div>
                      <input value={f.val} onChange={(e) => f.set(e.target.value)} placeholder={f.ph} style={{ width: '100%', background: 'var(--bg0)', border: '1px solid var(--bd)', borderRadius: 6, padding: '9px 12px', fontSize: 13, color: 'var(--t0)', outline: 'none', fontFamily: 'var(--mono)' }}/>
                    </div>
                  ))}
                </div>
              )}

              {step === 2 && (
                <div>
                  <div style={{ fontSize: 11, color: 'var(--t1)', marginBottom: 10, textTransform: 'uppercase', letterSpacing: '0.6px' }}>
                    Attach skills <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>— {skills.length} selected</span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                    {SPAWN_SKILLS.map((sk) => (
                      <div key={sk} onClick={() => toggleSkill(sk)} style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderRadius: 6,
                        border: `1px solid ${skills.includes(sk) ? 'var(--grn)' : 'var(--bd)'}`,
                        background: skills.includes(sk) ? '#3fb95010' : 'var(--bg0)',
                        cursor: 'pointer', transition: 'all 0.15s',
                      }}>
                        <span style={{ width: 16, height: 16, borderRadius: 3, border: `1px solid ${skills.includes(sk) ? 'var(--grn)' : 'var(--bd)'}`, background: skills.includes(sk) ? 'var(--grn)' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: '#fff', flexShrink: 0 }}>
                          {skills.includes(sk) ? '✓' : ''}
                        </span>
                        <span style={{ fontSize: 13, color: skills.includes(sk) ? 'var(--t0)' : 'var(--t1)' }}>{sk}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {step === 3 && (
                <div>
                  <div style={{ fontSize: 11, color: 'var(--t1)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.6px' }}>Review configuration</div>
                  <div style={{ background: 'var(--bg0)', border: '1px solid var(--bd)', borderRadius: 6, overflow: 'hidden' }}>
                    {([
                      ['Name',      displayName],
                      ['Provider',  providerObj.label],
                      ['Model',     model],
                      ['Task',      task || '—'],
                      ['Directory', workdir],
                      ['Skills',    skills.length ? skills.join(', ') : 'None'],
                    ] as [string,string][]).map(([k, v], i, arr) => (
                      <div key={k} style={{ display: 'flex', gap: 16, padding: '9px 14px', borderBottom: i < arr.length - 1 ? '1px solid #30363d22' : 'none' }}>
                        <span style={{ fontSize: 12, color: 'var(--t1)', width: 80, flexShrink: 0 }}>{k}</span>
                        <span style={{ fontSize: 12, color: 'var(--t0)', fontFamily: 'var(--mono)' }}>{v}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {!launching && (
          <div style={{ padding: '14px 20px', borderTop: '1px solid var(--bd)', display: 'flex', justifyContent: 'space-between', background: 'var(--bg0)' }}>
            {launched ? (
              <button onClick={onClose} style={{ marginLeft: 'auto', padding: '7px 18px', background: 'var(--grnd)', border: '1px solid var(--grnd)', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 500, color: '#fff' }}>
                Done
              </button>
            ) : (
              <>
                <button onClick={() => step > 0 ? setStep((s) => s - 1) : onClose()} style={{ padding: '7px 14px', background: 'transparent', border: '1px solid var(--bd)', borderRadius: 6, cursor: 'pointer', fontSize: 13, color: 'var(--t1)' }}>
                  {step === 0 ? 'Cancel' : '← Back'}
                </button>
                {step < 3 ? (
                  <button onClick={() => setStep((s) => s + 1)} style={{ padding: '7px 18px', background: 'var(--blu)', border: '1px solid var(--blu)', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 500, color: '#fff' }}>
                    Next →
                  </button>
                ) : (
                  <button onClick={launch} style={{ padding: '7px 18px', background: 'var(--grnd)', border: '1px solid var(--grnd)', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 600, color: '#fff', display: 'flex', alignItems: 'center', gap: 6 }}>
                    ⚡ Spawn Agent
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
