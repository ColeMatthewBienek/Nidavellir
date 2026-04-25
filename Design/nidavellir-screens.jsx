// nidavellir-screens.jsx — all screen components, exported to window

const { useState, useEffect, useRef } = React;

// ─── TOKENS ──────────────────────────────────────────────────────────────────
const BG0 = '#0d1117';
const BG1 = '#161b22';
const BG2 = '#21262d';
const BD  = '#30363d';
const T0  = '#e6edf3';
const T1  = '#8b949e';
const GRN = '#3fb950';
const GRND= '#238636';
const BLU = '#1f6feb';
const YEL = '#d29922';
const RED = '#f85149';
const PRP = '#bc8cff';
const MONO = "'JetBrains Mono','Fira Code',monospace";

// ─── SHARED ───────────────────────────────────────────────────────────────────
function SBadge({ s }) {
  const M = {
    idle:[T1,'idle'], busy:[YEL,'busy'], active:[GRN,'active'], error:[RED,'error'],
    pending:[T1,'pending'], running:[BLU,'running'], complete:[GRN,'complete'],
    failed:[RED,'failed'], scheduled:[PRP,'scheduled'], changes_requested:[YEL,'changes'],
  };
  const [col, lbl] = M[s] || M.idle;
  const pulse = s === 'active' || s === 'running';
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:4,
      padding:'2px 8px', borderRadius:20,
      border:`1px solid ${col}44`, background:`${col}16`,
      fontSize:11, fontWeight:500, color:col }}>
      <span style={{ width:5, height:5, borderRadius:'50%', background:col,
        display:'inline-block',
        boxShadow: pulse ? `0 0 6px ${col}` : 'none',
        animation: pulse ? 'nidPulse 2s ease-in-out infinite' : 'none' }} />
      {lbl}
    </span>
  );
}

function TopBar({ title, sub, children }) {
  return (
    <div style={{ height:48, padding:'0 20px', flexShrink:0,
      borderBottom:`1px solid ${BD}`, background:BG1,
      display:'flex', alignItems:'center', gap:10 }}>
      <div style={{ flex:1 }}>
        <span style={{ fontSize:14, fontWeight:600, color:T0 }}>{title}</span>
        {sub && <span style={{ fontSize:12, color:T1, marginLeft:10 }}>{sub}</span>}
      </div>
      {children}
    </div>
  );
}

function Btn({ children, primary, small, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} style={{
      padding: small ? '4px 10px' : '6px 14px',
      background: primary ? GRND : BG2,
      border: `1px solid ${primary ? GRND : BD}`,
      borderRadius:6, cursor: disabled ? 'not-allowed' : 'pointer',
      fontSize:12, fontWeight:500, color: disabled ? T1 : '#fff',
      opacity: disabled ? 0.5 : 1, transition:'all 0.15s', flexShrink:0,
    }}>{children}</button>
  );
}

function SecPanel({ title, action, onAction, width=210, children }) {
  return (
    <div style={{ width, flexShrink:0, borderRight:`1px solid ${BD}`,
      background:BG1, display:'flex', flexDirection:'column' }}>
      <div style={{ padding:'10px 14px', borderBottom:`1px solid ${BD}`,
        display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <span style={{ fontSize:11, fontWeight:600, color:T1,
          textTransform:'uppercase', letterSpacing:'0.7px' }}>{title}</span>
        {action && <span onClick={onAction}
          style={{ fontSize:16, color:T1, cursor:'pointer', lineHeight:1 }}>{action}</span>}
      </div>
      <div style={{ flex:1, overflowY:'auto' }}>{children}</div>
    </div>
  );
}

// ─── SLASH COMMANDS ───────────────────────────────────────────────────────────
const SLASH_CMDS = [
  { cmd:'/plan',    desc:'Start or resume a plan',        action:'nav:plan'    },
  { cmd:'/spawn',   desc:'Spawn a new agent',              action:'spawn'       },
  { cmd:'/agents',  desc:'Show active agent status',       action:'nav:agents'  },
  { cmd:'/tasks',   desc:'View task queue',                action:'nav:tasks'   },
  { cmd:'/skills',  desc:'Browse & invoke a skill',        action:'nav:skills'  },
  { cmd:'/context', desc:'Toggle file context panel',      action:'context'     },
  { cmd:'/memory',  desc:'Search memory store',            action:'memory'      },
  { cmd:'/clear',   desc:'Clear this thread',              action:'clear'       },
  { cmd:'/help',    desc:'List all available commands',    action:'help'        },
];

function SlashMenu({ query, onSelect, highlight, setHighlight }) {
  const filtered = SLASH_CMDS.filter(c => c.cmd.startsWith(query));
  if (!filtered.length) return null;
  return (
    <div style={{
      position:'absolute', bottom:'calc(100% + 8px)', left:0, right:0,
      background:BG1, border:`1px solid ${BLU}55`,
      borderRadius:8, overflow:'hidden',
      boxShadow:`0 -12px 32px #00000077`, zIndex:20,
    }}>
      <div style={{ padding:'6px 14px', borderBottom:`1px solid ${BD}`,
        display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <span style={{ fontSize:10, color:T1, textTransform:'uppercase', letterSpacing:'0.7px' }}>
          Commands
        </span>
        <span style={{ fontSize:10, color:T1 }}>↑↓ navigate · ↵ select · esc dismiss</span>
      </div>
      {filtered.map((c, i) => (
        <div key={c.cmd}
          onClick={() => onSelect(c)}
          onMouseEnter={() => setHighlight(i)}
          style={{
            padding:'9px 14px', cursor:'pointer',
            display:'flex', alignItems:'center', gap:14,
            background: i === highlight ? BG2 : 'transparent',
            borderBottom: i < filtered.length-1 ? `1px solid ${BD}22` : 'none',
            transition:'background 0.1s',
          }}>
          <span style={{ fontSize:12, fontFamily:MONO, color:BLU, flexShrink:0, width:88 }}>{c.cmd}</span>
          <span style={{ fontSize:12, color:T1, flex:1 }}>{c.desc}</span>
          {i === highlight && <span style={{ fontSize:10, color:T1, background:BG0,
            border:`1px solid ${BD}`, borderRadius:3, padding:'1px 5px' }}>↵</span>}
        </div>
      ))}
    </div>
  );
}

// ─── CONTEXT PANEL ───────────────────────────────────────────────────────────
const CTX_FILES_INIT = [
  { name:'backend/auth.py',     lines:87,  lang:'py' },
  { name:'backend/api/auth.py', lines:34,  lang:'py' },
  { name:'tests/test_auth.py',  lines:156, lang:'py' },
];
const CTX_MEMORY_HITS = [
  'JWT implementation pattern — session 2024-03',
  'Redis rate-limiting pattern from infra runbook',
];

function ContextPanel({ onClose }) {
  const [files, setFiles] = useState(CTX_FILES_INIT);
  return (
    <div style={{ width:260, flexShrink:0, borderLeft:`1px solid ${BD}`,
      background:BG1, display:'flex', flexDirection:'column' }}>
      <div style={{ padding:'10px 14px', borderBottom:`1px solid ${BD}`,
        display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <span style={{ fontSize:11, fontWeight:600, color:T1,
          textTransform:'uppercase', letterSpacing:'0.7px' }}>Context</span>
        <span onClick={onClose}
          style={{ cursor:'pointer', color:T1, fontSize:13, lineHeight:1 }}>✕</span>
      </div>
      <div style={{ flex:1, overflowY:'auto', padding:12,
        display:'flex', flexDirection:'column', gap:16 }}>

        {/* Files */}
        <div>
          <div style={{ fontSize:10, color:T1, marginBottom:6,
            textTransform:'uppercase', letterSpacing:'0.6px' }}>Files</div>
          <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
            {files.map(f => (
              <div key={f.name} style={{ display:'flex', alignItems:'center', gap:6,
                padding:'6px 8px', borderRadius:4, background:BG0, border:`1px solid ${BD}` }}>
                <span style={{ fontSize:9, padding:'1px 5px', background:`${BLU}18`,
                  border:`1px solid ${BLU}33`, borderRadius:2,
                  color:BLU, fontFamily:MONO, flexShrink:0 }}>{f.lang}</span>
                <span style={{ fontSize:11, color:T0, fontFamily:MONO, flex:1,
                  overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{f.name}</span>
                <span style={{ fontSize:10, color:T1, flexShrink:0 }}>{f.lines}L</span>
                <span onClick={() => setFiles(prev => prev.filter(x => x.name !== f.name))}
                  style={{ cursor:'pointer', color:T1, fontSize:11, flexShrink:0 }}>✕</span>
              </div>
            ))}
          </div>
          <div style={{ marginTop:8, fontSize:12, color:BLU, cursor:'pointer' }}>+ Add files</div>
        </div>

        {/* Memory */}
        <div>
          <div style={{ fontSize:10, color:T1, marginBottom:6,
            textTransform:'uppercase', letterSpacing:'0.6px' }}>Memory hits</div>
          {CTX_MEMORY_HITS.map((m, i) => (
            <div key={i} style={{ fontSize:11, color:T1, lineHeight:1.65,
              padding:'7px 9px', borderRadius:4, background:BG0,
              border:`1px solid ${BD}`, marginBottom:4 }}>{m}</div>
          ))}
        </div>

        {/* Agent */}
        <div>
          <div style={{ fontSize:10, color:T1, marginBottom:6,
            textTransform:'uppercase', letterSpacing:'0.6px' }}>Agent</div>
          <div style={{ padding:'8px 10px', background:BG0, border:`1px solid ${BD}`,
            borderRadius:4, display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ width:7, height:7, borderRadius:'50%', background:GRN,
              display:'inline-block', boxShadow:`0 0 5px ${GRN}`,
              animation:'nidPulse 2s ease-in-out infinite' }} />
            <span style={{ fontSize:12, color:T0, fontFamily:MONO, flex:1 }}>claude-opus-4</span>
            <span style={{ fontSize:10, color:T1 }}>active</span>
          </div>
        </div>

        {/* Token usage */}
        <div>
          <div style={{ fontSize:10, color:T1, marginBottom:6,
            textTransform:'uppercase', letterSpacing:'0.6px' }}>Token usage</div>
          <div style={{ fontSize:11, color:T1, marginBottom:5,
            display:'flex', justifyContent:'space-between' }}>
            <span>12,847 / 200,000</span>
            <span style={{ color:GRN }}>6%</span>
          </div>
          <div style={{ height:4, background:BD, borderRadius:2, overflow:'hidden' }}>
            <div style={{ width:'6%', height:'100%', background:GRN, borderRadius:2 }} />
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── CHAT ────────────────────────────────────────────────────────────────────
const CHAT_THREADS = [
  { id:'auth', label:'auth-refactor',  time:'now', unread:true  },
  { id:'api',  label:'API integration',time:'2h',  unread:false },
  { id:'bug',  label:'Bug fix #234',   time:'5h',  unread:false },
  { id:'mem',  label:'Memory system',  time:'1d',  unread:false },
];

const CHAT_INIT = [
  { id:1, role:'user',
    content:'Refactor the auth module to use JWT tokens with refresh token support. Current system uses session cookies and needs to be stateless.',
    time:'2:14 PM' },
  { id:2, role:'agent',
    content:"I'll analyze the current auth implementation and refactor to JWT.\n\nCurrent session-based approach:\n```python\n# backend/auth.py\ndef login(user):\n    session['user_id'] = user.id\n    session['expires'] = time() + 3600\n```\n\nRefactored JWT implementation:\n```python\nimport jwt\nfrom datetime import datetime, timedelta\n\nSECRET = os.environ['JWT_SECRET']\nACCESS_TTL  = timedelta(minutes=15)\nREFRESH_TTL = timedelta(days=7)\n\ndef create_tokens(user_id: str) -> dict:\n    now = datetime.utcnow()\n    return {\n        'access':  jwt.encode({'sub':user_id,'exp':now+ACCESS_TTL},  SECRET),\n        'refresh': jwt.encode({'sub':user_id,'exp':now+REFRESH_TTL}, SECRET),\n    }\n```\n\nShall I also update the middleware to validate tokens on each request?",
    time:'2:14 PM' },
  { id:3, role:'user',
    content:'Yes, and add rate limiting to the token endpoint — 5 requests per minute per IP.',
    time:'2:17 PM' },
];

const STREAM_RESP = "Adding rate limiting to the token endpoint.\n\nUsing a sliding window counter backed by Redis:\n```python\nfrom fastapi import Request, HTTPException\nfrom redis.asyncio import Redis\n\nredis = Redis.from_url(os.environ['REDIS_URL'])\n\nasync def rate_limit(request: Request):\n    ip  = request.client.host\n    key = f\"rl:token:{ip}\"\n    count = await redis.incr(key)\n    if count == 1:\n        await redis.expire(key, 60)   # 60s window\n    if count > 5:\n        raise HTTPException(429, \"Rate limit exceeded\")\n```\n\nApplied to the router:\n```python\n@router.post(\"/auth/token\",\n    dependencies=[Depends(rate_limit)])\nasync def get_token(form: OAuth2PasswordRequestForm):\n    user = await authenticate(form.username, form.password)\n    return create_tokens(str(user.id))\n```\n\nWant me to add `Retry-After` headers and exponential backoff too?";

function MsgBubble({ msg }) {
  const isUser = msg.role === 'user';
  const parts = msg.content.split(/(```[\s\S]*?```)/g);
  return (
    <div style={{ padding:'10px 20px', display:'flex', gap:10,
      flexDirection: isUser ? 'row-reverse' : 'row', alignItems:'flex-start' }}>
      <div style={{ width:26, height:26, borderRadius:'50%', flexShrink:0,
        background: isUser ? BLU : GRND,
        display:'flex', alignItems:'center', justifyContent:'center',
        fontSize:10, fontWeight:700, color:'#fff' }}>
        {isUser ? 'U' : 'N'}
      </div>
      <div style={{ maxWidth:'68%', fontSize:13, color:T0, lineHeight:1.65 }}>
        <div style={{ fontSize:11, color:T1, marginBottom:4,
          textAlign: isUser ? 'right' : 'left' }}>
          {isUser ? 'You' : 'Nidavellir'}
          {msg.time ? ` · ${msg.time}` : ''}
          {msg.streaming && <span style={{ marginLeft:6, color:GRN, fontSize:9,
            animation:'nidBlink 1.2s step-start infinite' }}>● LIVE</span>}
        </div>
        {parts.map((p, i) => p.startsWith('```') ? (
          <pre key={i} style={{
            background:BG0, border:`1px solid ${BD}`, borderRadius:6,
            padding:'10px 14px', margin:'6px 0',
            fontFamily:MONO, fontSize:12, lineHeight:1.6,
            overflowX:'auto', color:T0, whiteSpace:'pre-wrap',
          }}>{p.replace(/^```\w*\n?/, '').replace(/```$/, '')}</pre>
        ) : (
          <span key={i} style={{ whiteSpace:'pre-wrap' }}>{p}</span>
        ))}
        {msg.streaming && <span style={{ color:GRN, animation:'nidBlink 1s step-start infinite' }}>▋</span>}
      </div>
    </div>
  );
}

function ThinkingBubble() {
  return (
    <div style={{ padding:'10px 20px', display:'flex', gap:10 }}>
      <div style={{ width:26, height:26, borderRadius:'50%', background:GRND,
        display:'flex', alignItems:'center', justifyContent:'center',
        fontSize:10, fontWeight:700, color:'#fff', flexShrink:0 }}>N</div>
      <div style={{ paddingTop:5 }}>
        <div style={{ fontSize:11, color:T1, marginBottom:6 }}>Nidavellir · thinking</div>
        <div style={{ display:'flex', gap:4 }}>
          {[0,1,2].map(i => (
            <span key={i} style={{ width:6, height:6, borderRadius:'50%', background:T1,
              display:'inline-block',
              animation:`nidBounce 1.2s ${i*0.2}s ease-in-out infinite` }} />
          ))}
        </div>
      </div>
    </div>
  );
}

function NidChat() {
  const [thread, setThread]       = useState('auth');
  const [msgs, setMsgs]           = useState(CHAT_INIT);
  const [input, setInput]         = useState('');
  const [thinking, setThinking]   = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [streamTxt, setStreamTxt] = useState('');
  const [ctxOpen, setCtxOpen]     = useState(true);
  const [slashHL, setSlashHL]     = useState(0);
  const bottomRef = useRef(null);

  // Detect slash command mode
  const slashQuery  = input.match(/^(\/\S*)/) ? input.match(/^(\/\S*)/)[1].toLowerCase() : null;
  const showSlash   = !!slashQuery;
  const slashFiltered = showSlash ? SLASH_CMDS.filter(c => c.cmd.startsWith(slashQuery)) : [];

  useEffect(() => {
    if (bottomRef.current) {
      const el = bottomRef.current.parentElement;
      el.scrollTop = el.scrollHeight;
    }
  }, [msgs, streamTxt, thinking]);

  const handleSlashSelect = (cmd) => {
    if (cmd.action === 'spawn') {
      setInput('');
      window.dispatchEvent(new CustomEvent('nid:spawn'));
    } else if (cmd.action === 'context') {
      setInput(''); setCtxOpen(true);
    } else if (cmd.action === 'clear') {
      setMsgs([]); setInput('');
    } else if (cmd.action === 'help') {
      setInput('');
      setMsgs(prev => [...prev, { id:Date.now(), role:'agent',
        content:'**Available commands**\n\n' + SLASH_CMDS.map(c => `\`${c.cmd}\` — ${c.desc}`).join('\n'),
        time: new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }),
      }]);
    } else if (cmd.action.startsWith('nav:')) {
      setInput('');
      window.dispatchEvent(new CustomEvent('nid:navigate', { detail: cmd.action.slice(4) }));
    } else {
      setInput(cmd.cmd + ' ');
    }
    setSlashHL(0);
  };

  const handleKey = (e) => {
    if (showSlash && slashFiltered.length) {
      if (e.key === 'ArrowDown')  { e.preventDefault(); setSlashHL(i => (i+1) % slashFiltered.length); return; }
      if (e.key === 'ArrowUp')    { e.preventDefault(); setSlashHL(i => (i-1+slashFiltered.length) % slashFiltered.length); return; }
      if (e.key === 'Tab' || (e.key === 'Enter')) { e.preventDefault(); handleSlashSelect(slashFiltered[slashHL]); return; }
      if (e.key === 'Escape')     { setInput(''); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && !showSlash) { e.preventDefault(); send(); }
  };

  const send = () => {
    if (!input.trim() || streaming || thinking) return;
    setMsgs(prev => [...prev, {
      id: Date.now(), role:'user', content:input,
      time: new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }),
    }]);
    setInput('');
    setThinking(true);
    setTimeout(() => {
      setThinking(false); setStreaming(true);
      let i = 0;
      const iv = setInterval(() => {
        i += 5; setStreamTxt(STREAM_RESP.slice(0, i));
        if (i >= STREAM_RESP.length) {
          clearInterval(iv); setStreaming(false);
          setMsgs(prev => [...prev, { id:Date.now(), role:'agent', content:STREAM_RESP,
            time: new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' }) }]);
          setStreamTxt('');
        }
      }, 18);
    }, 1500);
  };

  return (
    <div style={{ display:'flex', flex:1, overflow:'hidden' }}>
      {/* Thread list */}
      <SecPanel title="Threads" action="+" onAction={() => {}}>
        {CHAT_THREADS.map(t => (
          <div key={t.id} onClick={() => setThread(t.id)} style={{
            padding:'10px 14px', cursor:'pointer',
            borderLeft: thread===t.id ? `2px solid ${GRN}` : '2px solid transparent',
            background: thread===t.id ? BG2 : 'transparent',
            display:'flex', alignItems:'center', justifyContent:'space-between',
            transition:'all 0.15s',
          }}>
            <div>
              <div style={{ fontSize:13, color: thread===t.id ? T0 : T1,
                fontWeight: thread===t.id ? 500 : 400 }}>{t.label}</div>
              <div style={{ fontSize:11, color:T1, marginTop:1 }}>{t.time}</div>
            </div>
            {t.unread && <span style={{ width:7, height:7, borderRadius:'50%',
              background:BLU, flexShrink:0 }} />}
          </div>
        ))}
      </SecPanel>

      {/* Messages */}
      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
        <TopBar title={CHAT_THREADS.find(t => t.id===thread)?.label || 'chat'}>
          <select style={{ background:BG2, border:`1px solid ${BD}`, borderRadius:5,
            padding:'4px 8px', fontSize:12, color:T0, cursor:'pointer', outline:'none' }}>
            <option>claude-opus-4</option>
            <option>claude-sonnet-4</option>
            <option>codex-mini</option>
          </select>
          <div onClick={() => setCtxOpen(o => !o)} style={{
            fontSize:12, color: ctxOpen ? GRN : T1,
            background: ctxOpen ? `${GRN}12` : BG2,
            border:`1px solid ${ctxOpen ? GRN+'44' : BD}`,
            borderRadius:5, padding:'4px 10px', cursor:'pointer',
            transition:'all 0.2s',
          }}>
            {ctxOpen ? '● Context' : `${CTX_FILES_INIT.length} files`}
          </div>
        </TopBar>

        <div style={{ flex:1, overflowY:'auto', padding:'8px 0' }}>
          {msgs.map(m => <MsgBubble key={m.id} msg={m} />)}
          {thinking && <ThinkingBubble />}
          {streaming && streamTxt && (
            <MsgBubble msg={{ id:'s', role:'agent', content:streamTxt, time:'', streaming:true }} />
          )}
          <div ref={bottomRef} style={{ height:1 }} />
        </div>

        {/* Input */}
        <div style={{ padding:14, borderTop:`1px solid ${BD}`, background:BG1, flexShrink:0 }}>
          <div style={{ position:'relative' }}>
            {showSlash && slashFiltered.length > 0 && (
              <SlashMenu
                query={slashQuery}
                highlight={slashHL}
                setHighlight={setSlashHL}
                onSelect={handleSlashSelect}
              />
            )}
            <div style={{
              display:'flex', gap:8, alignItems:'flex-end',
              background:BG2, borderRadius:8, padding:'10px 12px',
              border:`1px solid ${showSlash && slashFiltered.length ? BLU : BD}`,
              transition:'border-color 0.15s',
            }}>
              <textarea
                value={input}
                onChange={e => { setInput(e.target.value); setSlashHL(0); }}
                onKeyDown={handleKey}
                placeholder="Message Nidavellir…   / for commands"
                rows={1}
                style={{ flex:1, background:'transparent', border:'none', outline:'none',
                  resize:'none', fontSize:13, color:T0, fontFamily:'inherit', lineHeight:1.5 }}
              />
              <Btn primary onClick={send} disabled={!input.trim()||streaming||thinking||showSlash}>
                Send
              </Btn>
            </div>
          </div>
          <div style={{ marginTop:5, fontSize:11, color:`${T1}77`,
            display:'flex', gap:16 }}>
            <span>↵ send</span>
            <span>shift+↵ newline</span>
            <span style={{ color: showSlash ? BLU : `${T1}77` }}>/ commands</span>
          </div>
        </div>
      </div>

      {/* Context panel */}
      {ctxOpen && <ContextPanel onClose={() => setCtxOpen(false)} />}
    </div>
  );
}

// ─── PLAN ────────────────────────────────────────────────────────────────────
const PLAN_PROJECTS = [
  { id:'jwt', label:'JWT Auth Refactor',   status:'active'   },
  { id:'api', label:'API v2 Migration',    status:'pending'  },
  { id:'ui',  label:'UI Component System', status:'complete' },
];
const PLAN_STAGES = ['Interview','Spec','DAG','Review'];

const DAG_NODES = [
  { id:'spec',  label:'JWT Auth Spec',    x:16,  y:92,  w:152, h:38, col:BLU  },
  { id:'t1',    label:'create_tokens()',  x:220, y:16,  w:148, h:38, col:BG2  },
  { id:'t2',    label:'JWT middleware',   x:220, y:70,  w:148, h:38, col:BG2  },
  { id:'t3',    label:'Rate limiter',     x:220, y:124, w:148, h:38, col:BG2  },
  { id:'t4',    label:'Refresh endpoint', x:220, y:178, w:148, h:38, col:BG2  },
  { id:'tests', label:'Integration tests',x:424, y:92,  w:148, h:38, col:GRND },
];
const DAG_EDGES = [
  ['spec','t1'],['spec','t2'],['spec','t3'],['spec','t4'],
  ['t1','tests'],['t2','tests'],['t3','tests'],['t4','tests'],
];

function DagEdgePath({ from, to }) {
  const f = DAG_NODES.find(n => n.id===from);
  const t = DAG_NODES.find(n => n.id===to);
  if (!f||!t) return null;
  const x1=f.x+f.w, y1=f.y+f.h/2, x2=t.x, y2=t.y+t.h/2;
  return <path d={`M${x1} ${y1} C${x1+40} ${y1} ${x2-40} ${y2} ${x2} ${y2}`}
    fill="none" stroke={BD} strokeWidth={1.5} markerEnd="url(#nidArrow)"/>;
}

function DagNodeRect({ node }) {
  const isSrc = node.col !== BG2;
  return (
    <g>
      <rect x={node.x} y={node.y} width={node.w} height={node.h} rx={5}
        fill={isSrc ? `${node.col}1a` : BG2}
        stroke={isSrc ? node.col : BD} strokeWidth={isSrc ? 1.5 : 1}/>
      <text x={node.x+node.w/2} y={node.y+node.h/2+4}
        textAnchor="middle" fontSize={11} fill={T0} fontFamily="JetBrains Mono,monospace">
        {node.label}
      </text>
    </g>
  );
}

function NidPlan() {
  const [proj, setProj]   = useState('jwt');
  const [stage, setStage] = useState(2);
  return (
    <div style={{ display:'flex', flex:1, overflow:'hidden' }}>
      <SecPanel title="Plans" action="+" onAction={() => {}}>
        {PLAN_PROJECTS.map(p => (
          <div key={p.id} onClick={() => setProj(p.id)} style={{
            padding:'10px 14px', cursor:'pointer',
            borderLeft: proj===p.id ? `2px solid ${GRN}` : '2px solid transparent',
            background: proj===p.id ? BG2 : 'transparent', transition:'all 0.15s',
          }}>
            <div style={{ fontSize:13, color: proj===p.id ? T0 : T1,
              fontWeight: proj===p.id ? 500 : 400, marginBottom:5 }}>{p.label}</div>
            <SBadge s={p.status}/>
          </div>
        ))}
      </SecPanel>

      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
        <TopBar title="JWT Auth Refactor" sub="4 tasks · stage 3 of 4">
          <Btn small>Export Spec</Btn>
          <Btn small primary>Build →</Btn>
        </TopBar>
        <div style={{ display:'flex', borderBottom:`1px solid ${BD}`, background:BG1, flexShrink:0 }}>
          {PLAN_STAGES.map((s, i) => (
            <div key={s} onClick={() => setStage(i)} style={{
              padding:'10px 20px', cursor:'pointer', fontSize:13,
              color: stage===i ? T0 : T1,
              borderBottom: stage===i ? `2px solid ${GRN}` : '2px solid transparent',
              transition:'all 0.15s', display:'flex', alignItems:'center', gap:7,
            }}>
              <span style={{ width:17, height:17, borderRadius:'50%', fontSize:9, fontWeight:700,
                display:'inline-flex', alignItems:'center', justifyContent:'center',
                background: i<stage ? GRND : i===stage ? BLU : BD, color:'#fff', flexShrink:0 }}>
                {i < stage ? '✓' : i+1}
              </span>
              {s}
            </div>
          ))}
        </div>
        <div style={{ flex:1, overflow:'auto', padding:20 }}>
          {stage===0 && <div>
            <p style={{ fontSize:13, color:T1, marginBottom:16 }}>Interview agent gathering requirements…</p>
            <div style={{ background:BG1, border:`1px solid ${BD}`, borderRadius:8, padding:16 }}>
              <div style={{ fontSize:13, fontWeight:500, color:T0, marginBottom:10 }}>Requirements gathered</div>
              <ul style={{ color:T1, fontSize:13, lineHeight:2.1, margin:0, paddingLeft:20 }}>
                <li>Stateless JWT access tokens (15 min TTL)</li>
                <li>Refresh tokens — 7-day TTL, stored in httpOnly cookie</li>
                <li>Rate limiting: 5 req/min per IP on <code style={{ fontFamily:MONO, color:PRP }}>/auth/token</code></li>
                <li>Backward compatible migration path for existing sessions</li>
              </ul>
            </div>
          </div>}
          {stage===1 && <div>
            <div style={{ fontSize:13, fontWeight:500, color:T0, marginBottom:12 }}>Specification Draft</div>
            <div style={{ background:BG1, border:`1px solid ${BD}`, borderRadius:8,
              padding:20, fontFamily:MONO, fontSize:12, color:T1, lineHeight:1.9 }}>
              <div style={{ color:T0, fontWeight:600, marginBottom:8, fontSize:14 }}># JWT Authentication Refactor</div>
              <div style={{ marginBottom:12 }}>{'## Overview\nReplace session-based auth with stateless JWT. Access tokens expire in 15 min; refresh tokens expire in 7 days and are stored in httpOnly cookies only.'}</div>
              <div style={{ marginBottom:12 }}>{'## Endpoints\nPOST /auth/token    — issue access + refresh tokens\nPOST /auth/refresh  — exchange refresh for new access token\nDELETE /auth/logout — revoke refresh token'}</div>
              <div>{'## Security\n• Rate limit: 5 req/min per IP on POST /auth/token\n• Refresh tokens in httpOnly cookies — never in response body\n• Short-lived access tokens, fully stateless'}</div>
            </div>
          </div>}
          {stage===2 && <div>
            <div style={{ fontSize:13, fontWeight:500, color:T0, marginBottom:14 }}>Task DAG — 4 tasks across 2 phases</div>
            <div style={{ background:BG1, border:`1px solid ${BD}`, borderRadius:8, padding:16, overflowX:'auto', marginBottom:16 }}>
              <svg width={590} height={234}>
                <defs>
                  <marker id="nidArrow" markerWidth={8} markerHeight={8} refX={6} refY={3} orient="auto">
                    <path d="M0 0 L0 6 L6 3 z" fill={BD}/>
                  </marker>
                </defs>
                {DAG_EDGES.map(([f,t],i) => <DagEdgePath key={i} from={f} to={t}/>)}
                {DAG_NODES.map(n => <DagNodeRect key={n.id} node={n}/>)}
              </svg>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
              {[['create_tokens()','complete','claude-opus-4'],['JWT middleware','running','claude-opus-4'],
                ['Rate limiter','pending',null],['Refresh endpoint','pending',null]].map(([label,status,agent],i) => (
                <div key={i} style={{ display:'flex', alignItems:'center', gap:12, background:BG1,
                  border:`1px solid ${BD}`, borderRadius:6, padding:'10px 14px' }}>
                  <SBadge s={status}/><span style={{ fontFamily:MONO, fontSize:12, color:T0, flex:1 }}>{label}</span>
                  <span style={{ fontSize:11, color:T1 }}>{agent||<span style={{ color:`${T1}44` }}>unassigned</span>}</span>
                </div>
              ))}
            </div>
          </div>}
          {stage===3 && <div>
            <div style={{ fontSize:13, fontWeight:500, color:T0, marginBottom:14 }}>Review — 2 reviewers</div>
            {[{agent:'claude-opus-4',verdict:'approved',comment:'JWT implementation looks solid. Consider adding token rotation on refresh.'},
              {agent:'codex-mini',verdict:'changes_requested',comment:'Rate limiter is correct but missing Retry-After header.'}].map(r => (
              <div key={r.agent} style={{ background:BG1,
                border:`1px solid ${r.verdict==='approved'?GRND:YEL}`,
                borderRadius:8, padding:14, marginBottom:10 }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
                  <span style={{ fontSize:12, fontWeight:600, color:T0, fontFamily:MONO }}>{r.agent}</span>
                  <SBadge s={r.verdict}/>
                </div>
                <div style={{ fontSize:13, color:T1, lineHeight:1.65 }}>{r.comment}</div>
              </div>
            ))}
          </div>}
        </div>
      </div>
    </div>
  );
}

// ─── SCHEDULE ────────────────────────────────────────────────────────────────
const SCHED_DAYS  = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
const SCHED_DATES = [21,22,23,24,25,26,27];
const SCHED_RUNS  = [
  { id:1, label:'Auth Refactor Build', agent:'claude-opus-4', day:0, start:8, dur:4, col:BLU },
  { id:2, label:'Test Suite',          agent:'codex-mini',    day:0, start:13,dur:2, col:GRN },
  { id:3, label:'API Migration',       agent:'gemini-2.5',    day:1, start:9, dur:6, col:PRP },
  { id:4, label:'Code Review',         agent:'claude-opus-4', day:2, start:10,dur:3, col:YEL },
  { id:5, label:'Docs Generation',     agent:'claude-haiku',  day:3, start:8, dur:2, col:GRN },
  { id:6, label:'Integration Tests',   agent:'codex-mini',    day:4, start:9, dur:5, col:BLU },
  { id:7, label:'Deploy Staging',      agent:'claude-opus-4', day:5, start:14,dur:1, col:RED },
];
const HOURS = Array.from({ length:12 }, (_, i) => i + 7);
const fmtH = h => h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h-12}pm`;
const CELL_H = 52;

function NidSchedule() {
  const [sel, setSel] = useState(null);
  const TODAY = 3;
  return (
    <div style={{ display:'flex', flex:1, flexDirection:'column', overflow:'hidden' }}>
      <TopBar title="Schedule" sub="Week of Apr 21–27, 2026">
        <select style={{ background:BG2, border:`1px solid ${BD}`, borderRadius:5,
          padding:'4px 8px', fontSize:12, color:T0, cursor:'pointer', outline:'none' }}>
          <option>Week view</option><option>Month view</option>
        </select>
        <Btn primary small>+ Schedule Run</Btn>
      </TopBar>
      <div style={{ flex:1, overflow:'auto', padding:20 }}>
        <div style={{ display:'grid', gridTemplateColumns:'48px repeat(7,1fr)', minWidth:700 }}>
          <div style={{ height:36 }}/>
          {SCHED_DAYS.map((d,i) => (
            <div key={d} style={{ height:36, padding:'0 8px', display:'flex', alignItems:'center', gap:6,
              borderLeft:`1px solid ${BD}`, background:i===TODAY?`${BLU}12`:BG1, borderBottom:`1px solid ${BD}` }}>
              <span style={{ fontSize:12, fontWeight:600, color:i===TODAY?BLU:T1 }}>{d}</span>
              <span style={{ fontSize:11, color:i===TODAY?BLU:T1 }}>{SCHED_DATES[i]}</span>
            </div>
          ))}
          {HOURS.map(h => (
            <React.Fragment key={h}>
              <div style={{ height:CELL_H, paddingTop:6, paddingRight:8, textAlign:'right', flexShrink:0 }}>
                <span style={{ fontSize:10, color:T1, fontFamily:MONO }}>{fmtH(h)}</span>
              </div>
              {SCHED_DAYS.map((_,d) => (
                <div key={d} style={{ height:CELL_H, borderLeft:`1px solid ${BD}`,
                  borderTop:`1px solid ${BD}22`, background:d===TODAY?`${BLU}08`:'transparent', position:'relative' }}>
                  {SCHED_RUNS.filter(r => r.day===d && r.start===h).map(r => (
                    <div key={r.id} onClick={() => setSel(sel?.id===r.id?null:r)}
                      style={{ position:'absolute', top:3, left:4, right:4,
                        height:CELL_H*r.dur-6, background:`${r.col}1a`,
                        border:`1px solid ${r.col}55`, borderLeft:`3px solid ${r.col}`,
                        borderRadius:4, padding:'4px 7px', cursor:'pointer', overflow:'hidden', zIndex:1,
                        outline:sel?.id===r.id?`1px solid ${r.col}`:'none', transition:'all 0.15s' }}>
                      <div style={{ fontSize:11, fontWeight:500, color:r.col,
                        whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{r.label}</div>
                      <div style={{ fontSize:10, color:T1 }}>{r.agent}</div>
                    </div>
                  ))}
                </div>
              ))}
            </React.Fragment>
          ))}
        </div>
        {sel && (
          <div style={{ marginTop:16, background:BG1, border:`1px solid ${BD}`,
            borderRadius:8, padding:14, display:'flex', alignItems:'center', gap:14 }}>
            <div style={{ width:3, height:44, background:sel.col, borderRadius:2, flexShrink:0 }}/>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:13, fontWeight:500, color:T0 }}>{sel.label}</div>
              <div style={{ fontSize:11, color:T1, marginTop:2 }}>{sel.agent} · {sel.dur}h · {SCHED_DAYS[sel.day]} {fmtH(sel.start)}</div>
            </div>
            <Btn small>Edit</Btn>
            <Btn small>Cancel</Btn>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── PROVIDER ICONS ───────────────────────────────────────────────────────────
function ProviderIcon({ provider, size = 36 }) {
  const r = 7;
  const icons = {
    Anthropic: (
      <svg width={size} height={size} viewBox="0 0 36 36">
        <rect width="36" height="36" rx={r} fill="#c96a42"/>
        <polygon points="10,26 14,14 18,22 22,14 26,26 23,26 18,18 13,26"
          fill="white" opacity="0.95"/>
      </svg>
    ),
    OpenAI: (
      <svg width={size} height={size} viewBox="0 0 36 36">
        <rect width="36" height="36" rx={r} fill="#10a37f"/>
        {[0,60,120,180,240,300].map(deg => {
          const rad = deg * Math.PI / 180;
          const cx = 18 + 5 * Math.cos(rad);
          const cy = 18 + 5 * Math.sin(rad);
          return <circle key={deg} cx={cx} cy={cy} r="4.2"
            fill="none" stroke="white" strokeWidth="1.8"/>;
        })}
        <circle cx="18" cy="18" r="2.2" fill="white"/>
      </svg>
    ),
    Google: (
      <svg width={size} height={size} viewBox="0 0 36 36">
        <rect width="36" height="36" rx={r} fill="#ffffff" stroke={BD}/>
        <path d="M25 18.5h-7v3h4.1c-.4 2-2.2 3.5-4.1 3.5-2.5 0-4.5-2-4.5-4.5s2-4.5 4.5-4.5c1.1 0 2.1.4 2.9 1l2.2-2.2C21.6 13.5 19.9 13 18 13c-4.1 0-7.5 3.4-7.5 7.5s3.4 7.5 7.5 7.5c4.4 0 7.3-3.1 7.3-7.4 0-.5-.1-1-.3-1.6z"
          fill="#4285f4"/>
      </svg>
    ),
  };
  return icons[provider] || (
    <svg width={size} height={size} viewBox="0 0 36 36">
      <rect width="36" height="36" rx={r} fill={BG2} stroke={BD}/>
      <text x="18" y="23" textAnchor="middle" fontSize="13" fill={T1} fontFamily="monospace">◎</text>
    </svg>
  );
}

// ─── AGENTS ──────────────────────────────────────────────────────────────────
const AGENT_DATA = [
  { id:'a1', name:'claude-opus-4',  model:'claude-opus-4',   provider:'Anthropic',
    status:'active', task:'auth-refactor · JWT middleware', elapsed:'14m', done:3 },
  { id:'a2', name:'codex-mini',     model:'o4-mini (Codex)', provider:'OpenAI',
    status:'busy',   task:'test_suite.py · 247/312 tests',  elapsed:'6m',  done:5 },
  { id:'a3', name:'gemini-2.5-pro', model:'gemini-2.5-pro',  provider:'Google',
    status:'idle',   task:'—',                              elapsed:'—',   done:1 },
  { id:'a4', name:'claude-haiku',   model:'claude-haiku-4-5',provider:'Anthropic',
    status:'idle',   task:'—',                              elapsed:'—',   done:8 },
];
const ACTIVITY_LOG = [
  { time:'14:32', agent:'claude-opus-4',  msg:'Completed: create_tokens() — 47 lines' },
  { time:'14:28', agent:'codex-mini',     msg:'Running test_suite.py: 247/312 tests passed' },
  { time:'14:21', agent:'claude-opus-4',  msg:'Started: JWT middleware refactor' },
  { time:'13:55', agent:'claude-haiku',   msg:'Completed: /auth/token API documentation' },
  { time:'13:40', agent:'gemini-2.5-pro', msg:'Completed: API v2 spec review — 2 comments' },
];

function AgentCard({ ag }) {
  const statusCol = { active:GRN, busy:YEL, idle:T1, error:RED }[ag.status];
  const pulse = ag.status === 'active';
  return (
    <div style={{ background:BG1, border:`1px solid ${BD}`, borderRadius:8,
      padding:16, display:'flex', flexDirection:'column', gap:12, cursor:'pointer' }}>
      <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ position:'relative', flexShrink:0 }}>
            <ProviderIcon provider={ag.provider} size={36}/>
            <span style={{ position:'absolute', bottom:-2, right:-2,
              width:10, height:10, borderRadius:'50%',
              background:statusCol, border:`2px solid ${BG1}`,
              boxShadow: pulse ? `0 0 8px ${statusCol}` : 'none',
              animation: pulse ? 'nidPulse 2s ease-in-out infinite' : 'none' }}/>
          </div>
          <div>
            <div style={{ fontSize:13, fontWeight:600, color:T0, fontFamily:MONO }}>{ag.name}</div>
            <div style={{ fontSize:11, color:T1 }}>{ag.provider}</div>
          </div>
        </div>
        <SBadge s={ag.status}/>
      </div>
      <span style={{ fontSize:11, padding:'2px 7px', background:BG2,
        border:`1px solid ${BD}`, borderRadius:3, color:T1, fontFamily:MONO, alignSelf:'flex-start' }}>
        {ag.model}
      </span>
      <div style={{ borderTop:`1px solid ${BD}`, paddingTop:10 }}>
        <div style={{ fontSize:11, color:T1, marginBottom:3 }}>Current task</div>
        <div style={{ fontSize:12, color:ag.task==='—'?`${T1}55`:T0, fontFamily:MONO, lineHeight:1.5 }}>{ag.task}</div>
      </div>
      <div style={{ display:'flex', gap:16 }}>
        <span style={{ fontSize:11, color:T1 }}>Elapsed <b style={{ color:T0, fontWeight:500 }}>{ag.elapsed}</b></span>
        <span style={{ fontSize:11, color:T1 }}>Today <b style={{ color:GRN, fontWeight:500 }}>{ag.done} done</b></span>
      </div>
    </div>
  );
}

function NidAgents() {
  const active = AGENT_DATA.filter(a => a.status !== 'idle').length;
  return (
    <div style={{ display:'flex', flex:1, flexDirection:'column', overflow:'hidden' }}>
      <TopBar title="Agents" sub={`${active} active · ${AGENT_DATA.length} total`}>
        <Btn small primary onClick={() => window.dispatchEvent(new CustomEvent('nid:spawn'))}>
          + Spawn Agent
        </Btn>
      </TopBar>
      <div style={{ flex:1, overflow:'auto', padding:20 }}>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(2,1fr)', gap:14, maxWidth:900, marginBottom:20 }}>
          {AGENT_DATA.map(a => <AgentCard key={a.id} ag={a}/>)}
        </div>
        <div style={{ background:BG1, border:`1px solid ${BD}`, borderRadius:8, overflow:'hidden', maxWidth:900 }}>
          <div style={{ padding:'10px 14px', borderBottom:`1px solid ${BD}`,
            fontSize:11, fontWeight:600, color:T1, textTransform:'uppercase', letterSpacing:'0.7px' }}>
            Activity log
          </div>
          {ACTIVITY_LOG.map((e, i) => (
            <div key={i} style={{ padding:'9px 14px', borderBottom:i<4?`1px solid ${BD}22`:'none',
              display:'flex', gap:12, alignItems:'baseline' }}>
              <span style={{ fontSize:11, color:T1, fontFamily:MONO, flexShrink:0 }}>{e.time}</span>
              <span style={{ fontSize:11, color:GRN, fontFamily:MONO, flexShrink:0, minWidth:130 }}>{e.agent}</span>
              <span style={{ fontSize:12, color:T1 }}>{e.msg}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── TASKS ───────────────────────────────────────────────────────────────────
const ALL_TASKS = [
  { id:'AUTH-001', label:'create_tokens() function',      status:'complete', pri:'high',   agent:'claude-opus-4', when:'2h ago'  },
  { id:'AUTH-002', label:'JWT validation middleware',     status:'running',  pri:'high',   agent:'claude-opus-4', when:'2h ago'  },
  { id:'AUTH-003', label:'Rate limiter — token endpoint', status:'pending',  pri:'high',   agent:null,            when:'2h ago'  },
  { id:'AUTH-004', label:'Refresh token endpoint',        status:'pending',  pri:'medium', agent:null,            when:'2h ago'  },
  { id:'TEST-001', label:'Run full test suite',           status:'running',  pri:'medium', agent:'codex-mini',    when:'30m ago' },
  { id:'DOCS-001', label:'Update API documentation',      status:'pending',  pri:'low',    agent:null,            when:'1h ago'  },
  { id:'UI-001',   label:'Polish nav component',          status:'complete', pri:'low',    agent:'claude-haiku',  when:'3h ago'  },
  { id:'UI-002',   label:'Agent status pulse animation',  status:'complete', pri:'low',    agent:'claude-haiku',  when:'4h ago'  },
];
const PRI_COL = { high:RED, medium:YEL, low:T1 };

function NidTasks() {
  const [filter, setFilter] = useState('all');
  const rows = filter==='all' ? ALL_TASKS : ALL_TASKS.filter(t => t.status===filter);
  const count = s => s==='all' ? ALL_TASKS.length : ALL_TASKS.filter(t => t.status===s).length;
  return (
    <div style={{ display:'flex', flex:1, flexDirection:'column', overflow:'hidden' }}>
      <TopBar title="Tasks" sub={`${count('running')} running · ${count('pending')} pending`}>
        <Btn small primary>+ New Task</Btn>
      </TopBar>
      <div style={{ padding:'10px 20px', borderBottom:`1px solid ${BD}`, background:BG1, display:'flex', gap:7, flexShrink:0 }}>
        {['all','running','pending','complete'].map(f => (
          <button key={f} onClick={() => setFilter(f)} style={{
            padding:'4px 12px', borderRadius:20,
            border:`1px solid ${filter===f?GRN:BD}`,
            background:filter===f?`${GRN}16`:BG2,
            fontSize:12, color:filter===f?GRN:T1, cursor:'pointer', transition:'all 0.15s',
          }}>
            {f.charAt(0).toUpperCase()+f.slice(1)}{' '}
            <span style={{ fontSize:10 }}>{count(f)}</span>
          </button>
        ))}
      </div>
      <div style={{ flex:1, overflow:'auto' }}>
        <div style={{ display:'grid', gridTemplateColumns:'100px 1fr 100px 76px 148px 80px',
          padding:'8px 20px', borderBottom:`1px solid ${BD}`,
          fontSize:11, fontWeight:600, color:T1, textTransform:'uppercase', letterSpacing:'0.5px',
          background:BG1, position:'sticky', top:0, zIndex:2 }}>
          <div>ID</div><div>Task</div><div>Status</div><div>Priority</div><div>Agent</div><div>Created</div>
        </div>
        {rows.map((t, i) => (
          <div key={t.id} style={{ display:'grid', gridTemplateColumns:'100px 1fr 100px 76px 148px 80px',
            padding:'10px 20px', borderBottom:`1px solid ${BD}22`,
            background:i%2===0?'transparent':`${BG1}60`, alignItems:'center', cursor:'pointer' }}>
            <div style={{ fontSize:11, fontFamily:MONO, color:T1 }}>{t.id}</div>
            <div style={{ fontSize:13, color:T0 }}>{t.label}</div>
            <div><SBadge s={t.status}/></div>
            <div style={{ fontSize:11, fontWeight:500, color:PRI_COL[t.pri] }}>{t.pri}</div>
            <div style={{ fontSize:11, color:T1, fontFamily:MONO }}>
              {t.agent || <span style={{ color:BD }}>unassigned</span>}
            </div>
            <div style={{ fontSize:11, color:T1 }}>{t.when}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── SKILLS ──────────────────────────────────────────────────────────────────
const SKILL_DATA = [
  { id:'01',  name:'Interviewer',  tags:['requirements'],
    desc:'Gathers requirements through structured dialogue. Extracts intent, constraints, and edge cases.', lastUsed:'today', runs:42 },
  { id:'02',  name:'Spec Editor',  tags:['spec','planning'],
    desc:'Transforms raw requirements into a structured technical specification with acceptance criteria.', lastUsed:'today', runs:38 },
  { id:'03',  name:'Reviewer',     tags:['review','QA'],
    desc:'Reviews code and specs for correctness, style, and completeness. Produces severity-rated feedback.', lastUsed:'1h ago', runs:67 },
  { id:'03b', name:'Consolidator', tags:['review'],
    desc:'Merges multiple review comments into a coherent summary, resolving conflicts by impact.', lastUsed:'3h ago', runs:21 },
  { id:'04',  name:'Orchestrator', tags:['orchestration','DAG'],
    desc:'Decomposes specs into task DAGs, assigns agents, sequences work, monitors completion.', lastUsed:'2h ago', runs:15 },
  { id:'sw',  name:'Spec Writer',  tags:['spec'],
    desc:'General-purpose spec writing. Produces detailed functional and technical specs from prompts.', lastUsed:'yesterday', runs:29 },
];

function NidSkills() {
  const [sel, setSel] = useState(null);
  return (
    <div style={{ display:'flex', flex:1, overflow:'hidden' }}>
      <div style={{ flex:1, display:'flex', flexDirection:'column', overflow:'hidden' }}>
        <TopBar title="Skills" sub={`${SKILL_DATA.length} loaded`}>
          <Btn small primary>+ Load Skill</Btn>
        </TopBar>
        <div style={{ flex:1, overflow:'auto', padding:20 }}>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:12, maxWidth:1000 }}>
            {SKILL_DATA.map(sk => (
              <div key={sk.id} onClick={() => setSel(sel?.id===sk.id?null:sk)} style={{
                background:BG1, border:`1px solid ${sel?.id===sk.id?GRN:BD}`,
                borderRadius:8, padding:14, cursor:'pointer', transition:'border-color 0.15s' }}>
                <div style={{ display:'flex', alignItems:'center', gap:7, marginBottom:8 }}>
                  <span style={{ fontFamily:MONO, fontSize:10, color:T1, background:BG2, padding:'2px 6px', borderRadius:3 }}>{sk.id}</span>
                  <span style={{ fontSize:13, fontWeight:600, color:T0 }}>{sk.name}</span>
                </div>
                <p style={{ fontSize:12, color:T1, lineHeight:1.65, margin:'0 0 10px', textWrap:'pretty' }}>{sk.desc}</p>
                <div style={{ display:'flex', gap:4, flexWrap:'wrap', marginBottom:8 }}>
                  {sk.tags.map(tg => (
                    <span key={tg} style={{ fontSize:10, padding:'1px 6px', background:`${PRP}15`,
                      border:`1px solid ${PRP}30`, borderRadius:3, color:PRP, fontFamily:MONO }}>{tg}</span>
                  ))}
                </div>
                <div style={{ fontSize:11, color:T1, display:'flex', gap:12 }}>
                  <span>Last used: {sk.lastUsed}</span><span>{sk.runs} runs</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {sel && (
        <div style={{ width:260, borderLeft:`1px solid ${BD}`, background:BG1, flexShrink:0, display:'flex', flexDirection:'column' }}>
          <div style={{ padding:'12px 14px', borderBottom:`1px solid ${BD}`,
            display:'flex', justifyContent:'space-between', alignItems:'center' }}>
            <span style={{ fontSize:13, fontWeight:600, color:T0 }}>{sel.name}</span>
            <span onClick={() => setSel(null)} style={{ cursor:'pointer', color:T1, fontSize:14 }}>✕</span>
          </div>
          <div style={{ flex:1, padding:16, overflowY:'auto', display:'flex', flexDirection:'column', gap:14 }}>
            <div>
              <div style={{ fontSize:11, color:T1, marginBottom:5, textTransform:'uppercase', letterSpacing:'0.5px' }}>Description</div>
              <div style={{ fontSize:12, color:T0, lineHeight:1.75 }}>{sel.desc}</div>
            </div>
            <div>
              <div style={{ fontSize:11, color:T1, marginBottom:6, textTransform:'uppercase', letterSpacing:'0.5px' }}>Tags</div>
              <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                {sel.tags.map(tg => <span key={tg} style={{ fontSize:11, padding:'2px 8px',
                  background:`${PRP}15`, border:`1px solid ${PRP}30`,
                  borderRadius:3, color:PRP, fontFamily:MONO }}>{tg}</span>)}
              </div>
            </div>
            <div>
              <div style={{ fontSize:11, color:T1, marginBottom:5, textTransform:'uppercase', letterSpacing:'0.5px' }}>Usage</div>
              <div style={{ fontSize:12, color:T0 }}>{sel.runs} total runs</div>
              <div style={{ fontSize:12, color:T1 }}>Last used: {sel.lastUsed}</div>
            </div>
            <Btn primary>Invoke Skill</Btn>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── SETTINGS ────────────────────────────────────────────────────────────────
function NidSettings() {
  return (
    <div style={{ display:'flex', flex:1, flexDirection:'column', overflow:'hidden' }}>
      <TopBar title="Settings"/>
      <div style={{ flex:1, overflow:'auto', padding:20, maxWidth:600 }}>
        {[
          { section:'Models', fields:[
            { label:'Default model', type:'select', opts:['claude-opus-4','claude-sonnet-4','codex-mini','gemini-2.5-pro'] },
            { label:'Fallback model', type:'select', opts:['claude-haiku-4-5','gpt-4o-mini'] },
          ]},
          { section:'Agent Pool', fields:[
            { label:'Max concurrent agents', type:'number', val:'4' },
            { label:'Agent timeout (seconds)', type:'number', val:'300' },
          ]},
          { section:'API Keys', fields:[
            { label:'Anthropic API Key', type:'password', val:'sk-ant-•••••••••••••••' },
            { label:'OpenAI API Key',    type:'password', val:'sk-•••••••••••••••' },
          ]},
        ].map(grp => (
          <div key={grp.section} style={{ marginBottom:24 }}>
            <div style={{ fontSize:11, fontWeight:600, color:T1, textTransform:'uppercase',
              letterSpacing:'0.7px', marginBottom:12 }}>{grp.section}</div>
            <div style={{ background:BG1, border:`1px solid ${BD}`, borderRadius:8, overflow:'hidden' }}>
              {grp.fields.map((f, i) => (
                <div key={f.label} style={{ display:'flex', alignItems:'center',
                  justifyContent:'space-between', padding:'12px 16px',
                  borderBottom:i<grp.fields.length-1?`1px solid ${BD}`:'none' }}>
                  <label style={{ fontSize:13, color:T0 }}>{f.label}</label>
                  {f.type==='select' ? (
                    <select style={{ background:BG2, border:`1px solid ${BD}`, borderRadius:5,
                      padding:'5px 10px', fontSize:12, color:T0, outline:'none', cursor:'pointer' }}>
                      {f.opts.map(o => <option key={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input type={f.type} defaultValue={f.val} style={{ background:BG2,
                      border:`1px solid ${BD}`, borderRadius:5, padding:'5px 10px',
                      fontSize:12, color:T0, outline:'none', width:220, fontFamily:MONO }}/>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
        <Btn primary>Save Changes</Btn>
      </div>
    </div>
  );
}

// ─── SPAWN MODAL ─────────────────────────────────────────────────────────────
const PROVIDERS = [
  { id:'anthropic', label:'Anthropic', models:['claude-opus-4','claude-sonnet-4','claude-haiku-4-5'] },
  { id:'openai',    label:'OpenAI',    models:['o3','o4-mini','gpt-4o'] },
  { id:'google',    label:'Google',    models:['gemini-2.5-pro','gemini-2.0-flash'] },
];
const MODEL_META = {
  'claude-opus-4':     { ctx:'200k', strength:'Complex reasoning, long-context tasks' },
  'claude-sonnet-4':   { ctx:'200k', strength:'Balanced speed & capability' },
  'claude-haiku-4-5':  { ctx:'200k', strength:'Fast, lightweight tasks' },
  'o3':                { ctx:'200k', strength:'Advanced reasoning & math' },
  'o4-mini':           { ctx:'128k', strength:'Efficient coding & tool use' },
  'gpt-4o':            { ctx:'128k', strength:'Multimodal, broad capability' },
  'gemini-2.5-pro':    { ctx:'1M',   strength:'Massive context, deep analysis' },
  'gemini-2.0-flash':  { ctx:'1M',   strength:'Ultra-fast responses at scale' },
};
const SPAWN_SKILLS = ['Interviewer','Spec Editor','Reviewer','Consolidator','Orchestrator','Spec Writer'];
const SPAWN_STEPS  = ['Provider','Configure','Skills','Launch'];

function SpawnModal({ onClose }) {
  const [step, setStep]         = useState(0);
  const [provider, setProvider] = useState('anthropic');
  const [model, setModel]       = useState('claude-opus-4');
  const [name, setName]         = useState('');
  const [task, setTask]         = useState('');
  const [workdir, setWorkdir]   = useState('./workspace');
  const [skills, setSkills]     = useState(['Spec Editor']);
  const [launching, setLaunching] = useState(false);
  const [launched, setLaunched]   = useState(false);

  const providerObj  = PROVIDERS.find(p => p.id === provider);
  const meta         = MODEL_META[model] || {};
  const defaultName  = `${model.split('-')[0]}-${String(Date.now()).slice(-4)}`;
  const displayName  = name.trim() || defaultName;

  const toggleSkill = (sk) => setSkills(prev =>
    prev.includes(sk) ? prev.filter(s => s !== sk) : [...prev, sk]
  );

  const launch = () => {
    setLaunching(true);
    setTimeout(() => { setLaunching(false); setLaunched(true); }, 2400);
  };

  return (
    <div style={{ position:'fixed', inset:0, background:'#0d111799',
      backdropFilter:'blur(6px)', display:'flex', alignItems:'center',
      justifyContent:'center', zIndex:100 }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ width:500, background:BG1, border:`1px solid ${BD}`,
        borderRadius:10, overflow:'hidden',
        boxShadow:`0 24px 64px #000000aa`,
        animation:'nidFadeSlide 0.2s ease-out' }}>

        {/* Header */}
        <div style={{ padding:'16px 20px', borderBottom:`1px solid ${BD}`,
          display:'flex', alignItems:'center', justifyContent:'space-between' }}>
          <div>
            <div style={{ fontSize:14, fontWeight:600, color:T0 }}>Spawn Agent</div>
            <div style={{ fontSize:11, color:T1, marginTop:2 }}>Configure and launch a new agent instance</div>
          </div>
          <span onClick={onClose} style={{ cursor:'pointer', color:T1, fontSize:16, lineHeight:1 }}>✕</span>
        </div>

        {/* Step indicator */}
        <div style={{ padding:'12px 20px', borderBottom:`1px solid ${BD}`,
          display:'flex', alignItems:'center', background:BG0 }}>
          {SPAWN_STEPS.map((s, i) => (
            <React.Fragment key={s}>
              <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                <span style={{ width:20, height:20, borderRadius:'50%', fontSize:9, fontWeight:700,
                  display:'inline-flex', alignItems:'center', justifyContent:'center',
                  background: i<step ? GRND : i===step ? BLU : BG2,
                  border:`1px solid ${i<step?GRND:i===step?BLU:BD}`, color:'#fff' }}>
                  {i < step ? '✓' : i+1}
                </span>
                <span style={{ fontSize:12, color:i===step?T0:T1, fontWeight:i===step?500:400 }}>{s}</span>
              </div>
              {i < SPAWN_STEPS.length-1 && (
                <div style={{ flex:1, height:1, background:i<step?GRND:BD, margin:'0 10px' }}/>
              )}
            </React.Fragment>
          ))}
        </div>

        {/* Content */}
        <div style={{ padding:20, minHeight:240 }}>
          {launched ? (
            <div style={{ textAlign:'center', padding:'16px 0' }}>
              <div style={{ width:48, height:48, borderRadius:'50%', background:`${GRN}18`,
                border:`1px solid ${GRN}44`, display:'flex', alignItems:'center',
                justifyContent:'center', margin:'0 auto 14px', fontSize:22 }}>⚡</div>
              <div style={{ fontSize:15, fontWeight:600, color:GRN, marginBottom:6 }}>Agent launched</div>
              <div style={{ fontSize:12, color:T1, marginBottom:16 }}>{displayName} is now active</div>
              <div style={{ background:BG0, border:`1px solid ${BD}`, borderRadius:6,
                padding:'12px 14px', textAlign:'left', fontFamily:MONO, fontSize:12, lineHeight:1.9 }}>
                <div>agent_id  <span style={{ color:GRN }}>{displayName}</span></div>
                <div>model     <span style={{ color:BLU }}>{model}</span></div>
                <div>provider  <span style={{ color:T0 }}>{providerObj?.label}</span></div>
                <div>status    <span style={{ color:GRN }}>active ●</span></div>
                {task && <div>task      <span style={{ color:T0 }}>{task}</span></div>}
              </div>
            </div>
          ) : launching ? (
            <div style={{ textAlign:'center', padding:'32px 0' }}>
              <div style={{ display:'flex', justifyContent:'center', gap:6, marginBottom:14 }}>
                {[0,1,2].map(i => <span key={i} style={{ width:9, height:9, borderRadius:'50%',
                  background:GRN, display:'inline-block',
                  animation:`nidBounce 1.2s ${i*0.2}s ease-in-out infinite` }}/>)}
              </div>
              <div style={{ fontSize:13, color:T0 }}>
                Spawning <span style={{ fontFamily:MONO, color:GRN }}>{displayName}</span>
              </div>
              <div style={{ fontSize:11, color:T1, marginTop:6 }}>
                Initialising workspace · Loading skills · Connecting to {providerObj?.label}
              </div>
            </div>
          ) : (
            <>
              {/* Step 0: Provider + model */}
              {step === 0 && (
                <div>
                  <div style={{ fontSize:11, color:T1, marginBottom:8, textTransform:'uppercase', letterSpacing:'0.6px' }}>Provider</div>
                  <div style={{ display:'flex', gap:8, marginBottom:18 }}>
                    {PROVIDERS.map(p => (
                      <div key={p.id} onClick={() => { setProvider(p.id); setModel(p.models[0]); }}
                        style={{ flex:1, padding:'10px', borderRadius:6,
                          border:`1px solid ${provider===p.id?BLU:BD}`,
                          background:provider===p.id?`${BLU}12`:BG0,
                          cursor:'pointer', textAlign:'center', transition:'all 0.15s' }}>
                        <ProviderIcon provider={p.label} size={28}/>
                        <div style={{ fontSize:12, fontWeight:500, color:provider===p.id?T0:T1, marginTop:5 }}>{p.label}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ fontSize:11, color:T1, marginBottom:8, textTransform:'uppercase', letterSpacing:'0.6px' }}>Model</div>
                  <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                    {providerObj.models.map(m => (
                      <div key={m} onClick={() => setModel(m)} style={{
                        padding:'10px 14px', borderRadius:6,
                        border:`1px solid ${model===m?BLU:BD}`,
                        background:model===m?`${BLU}10`:BG0,
                        cursor:'pointer', transition:'all 0.15s',
                        display:'flex', alignItems:'center', justifyContent:'space-between' }}>
                        <span style={{ fontSize:13, fontFamily:MONO, color:model===m?T0:T1 }}>{m}</span>
                        <span style={{ fontSize:11, color:T1 }}>{MODEL_META[m]?.ctx} ctx</span>
                      </div>
                    ))}
                  </div>
                  {meta.strength && <div style={{ marginTop:10, fontSize:12, color:T1, fontStyle:'italic' }}>
                    Best for: {meta.strength}
                  </div>}
                </div>
              )}

              {/* Step 1: Configure */}
              {step === 1 && (
                <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
                  {[
                    { label:'Agent name',       val:name,    set:setName,    ph:defaultName },
                    { label:'Task (optional)',   val:task,    set:setTask,    ph:'e.g. auth-refactor' },
                    { label:'Working directory', val:workdir, set:setWorkdir, ph:'./workspace' },
                  ].map(f => (
                    <div key={f.label}>
                      <div style={{ fontSize:11, color:T1, marginBottom:5,
                        textTransform:'uppercase', letterSpacing:'0.6px' }}>{f.label}</div>
                      <input value={f.val} onChange={e => f.set(e.target.value)}
                        placeholder={f.ph} style={{ width:'100%', background:BG0,
                          border:`1px solid ${BD}`, borderRadius:6,
                          padding:'9px 12px', fontSize:13, color:T0,
                          outline:'none', fontFamily:MONO }}/>
                    </div>
                  ))}
                </div>
              )}

              {/* Step 2: Skills */}
              {step === 2 && (
                <div>
                  <div style={{ fontSize:11, color:T1, marginBottom:10, textTransform:'uppercase', letterSpacing:'0.6px' }}>
                    Attach skills <span style={{ fontWeight:400, textTransform:'none', letterSpacing:0 }}>— {skills.length} selected</span>
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', gap:5 }}>
                    {SPAWN_SKILLS.map(sk => (
                      <div key={sk} onClick={() => toggleSkill(sk)} style={{
                        display:'flex', alignItems:'center', gap:10,
                        padding:'9px 14px', borderRadius:6,
                        border:`1px solid ${skills.includes(sk)?GRN:BD}`,
                        background:skills.includes(sk)?`${GRN}10`:BG0,
                        cursor:'pointer', transition:'all 0.15s' }}>
                        <span style={{ width:16, height:16, borderRadius:3,
                          border:`1px solid ${skills.includes(sk)?GRN:BD}`,
                          background:skills.includes(sk)?GRN:'transparent',
                          display:'flex', alignItems:'center', justifyContent:'center',
                          fontSize:10, color:'#fff', flexShrink:0 }}>
                          {skills.includes(sk)?'✓':''}
                        </span>
                        <span style={{ fontSize:13, color:skills.includes(sk)?T0:T1 }}>{sk}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Step 3: Review */}
              {step === 3 && (
                <div>
                  <div style={{ fontSize:11, color:T1, marginBottom:12,
                    textTransform:'uppercase', letterSpacing:'0.6px' }}>Review configuration</div>
                  <div style={{ background:BG0, border:`1px solid ${BD}`, borderRadius:6, overflow:'hidden' }}>
                    {[
                      ['Name',      displayName],
                      ['Provider',  providerObj?.label],
                      ['Model',     model],
                      ['Task',      task||'—'],
                      ['Directory', workdir],
                      ['Skills',    skills.length ? skills.join(', ') : 'None'],
                    ].map(([k,v], i, arr) => (
                      <div key={k} style={{ display:'flex', gap:16, padding:'9px 14px',
                        borderBottom:i<arr.length-1?`1px solid ${BD}22`:'none' }}>
                        <span style={{ fontSize:12, color:T1, width:80, flexShrink:0 }}>{k}</span>
                        <span style={{ fontSize:12, color:T0, fontFamily:MONO }}>{v}</span>
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
          <div style={{ padding:'14px 20px', borderTop:`1px solid ${BD}`,
            display:'flex', justifyContent:'space-between', background:BG0 }}>
            {launched ? (
              <button onClick={onClose} style={{ marginLeft:'auto',
                padding:'7px 18px', background:GRND, border:`1px solid ${GRND}`,
                borderRadius:6, cursor:'pointer', fontSize:13, fontWeight:500, color:'#fff' }}>
                Done
              </button>
            ) : (
              <>
                <button onClick={() => step > 0 ? setStep(s => s-1) : onClose()} style={{
                  padding:'7px 14px', background:'transparent', border:`1px solid ${BD}`,
                  borderRadius:6, cursor:'pointer', fontSize:13, color:T1 }}>
                  {step === 0 ? 'Cancel' : '← Back'}
                </button>
                {step < 3 ? (
                  <button onClick={() => setStep(s => s+1)} style={{
                    padding:'7px 18px', background:BLU, border:`1px solid ${BLU}`,
                    borderRadius:6, cursor:'pointer', fontSize:13, fontWeight:500, color:'#fff' }}>
                    Next →
                  </button>
                ) : (
                  <button onClick={launch} style={{
                    padding:'7px 18px', background:GRND, border:`1px solid ${GRND}`,
                    borderRadius:6, cursor:'pointer', fontSize:13, fontWeight:600, color:'#fff',
                    display:'flex', alignItems:'center', gap:6 }}>
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

// ─── EXPORT ───────────────────────────────────────────────────────────────────
Object.assign(window, {
  NidChat, NidPlan, NidSchedule, NidAgents, NidTasks, NidSkills, NidSettings,
  SpawnModal, SBadge, TopBar, Btn,
});
