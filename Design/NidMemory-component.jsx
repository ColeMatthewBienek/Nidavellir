// ─── MEMORY QUALITY DASHBOARD ────────────────────────────────────────────────
// Component: NidMemory
// Integrated into Nidavellir screens
// Renders memory system diagnostics and health inspection interface

const { useState } = React;

// ─── TOKENS (reference from main styles) ────────────────────────────────────
const BG0 = '#0d1117';
const BG1 = '#161b22';
const BG2 = '#21262d';
const BD  = '#30363d';
const T0  = '#e6edf3';
const T1  = '#8b949e';
const GRN = '#3fb950';
const YEL = '#d29922';
const RED = '#f85149';
const MONO = "'JetBrains Mono','Fira Code',monospace";

// ─── MOCK DATA ───────────────────────────────────────────────────────────────
const MEM_SUMMARY = {
  totalActive:     847,
  injected24h:     342,
  extractionFails: 8,
  dedupRejections: 23,
  lowConfidence:   34,
  neverUsed:       67,
  superseded:      12,
};

const MEM_DUPLICATES = [
  { id:1, score:0.94, text1:'JWT token validation middleware implementation', text2:'JWT middleware for token verification', count:3 },
  { id:2, score:0.87, text1:'Redis rate limiting with sliding window', text2:'Rate limiter using Redis counters', count:2 },
  { id:3, score:0.91, text1:'OAuth2 password flow authentication', text2:'Implement OAuth2 with password grant', count:2 },
];

const MEM_STALE = [
  { id:'m001', text:'Session-based authentication approach', lastUsed:234, confidence:0.82, created:'2024-01-03' },
  { id:'m002', text:'Legacy Python 2.7 compatibility patterns', lastUsed:189, confidence:0.65, created:'2024-01-05' },
  { id:'m003', text:'Deprecated API v1 endpoint documentation', lastUsed:156, confidence:0.71, created:'2024-01-08' },
  { id:'m004', text:'Old database migration strategy', lastUsed:142, confidence:0.58, created:'2024-01-12' },
];

const MEM_LOW_CONF = [
  { id:'m045', confidence:0.32, content:'Potential optimization for async queue processing', category:'optimization' },
  { id:'m052', confidence:0.41, content:'Alternative caching strategy using memcached', category:'caching' },
  { id:'m063', confidence:0.38, content:'Experimental load balancing approach', category:'infrastructure' },
];

const MEM_NEVER_USED = [
  { id:'m089', created:'2024-03-15', content:'Edge case handling for concurrent token refresh' },
  { id:'m091', created:'2024-03-18', content:'Performance notes on batch processing' },
  { id:'m094', created:'2024-03-20', content:'Discussion on error recovery strategies' },
];

const MEM_FREQUENT = [
  { id:'m001', content:'JWT token creation and validation', useCount:247, lastUsed:'14m', score:0.98, relevance:0.95, importance:0.94, decay:0.92 },
  { id:'m002', content:'Rate limiting patterns with Redis', useCount:189, lastUsed:'22m', score:0.96, relevance:0.93, importance:0.91, decay:0.89 },
  { id:'m003', content:'Session refresh token lifecycle', useCount:156, lastUsed:'1h', score:0.94, relevance:0.88, importance:0.87, decay:0.85 },
];

const MEM_EXTRACT_FAILS = [
  { id:'f001', time:'14:32', error:'context_window_exceeded', query:'Full auth module implementation with all edge cases' },
  { id:'f002', time:'14:21', error:'extraction_timeout', query:'Complete API specification document' },
  { id:'f003', time:'14:08', error:'invalid_format', query:'Malformed memory event payload' },
];

// ─── COMPONENTS ──────────────────────────────────────────────────────────────

function MetricCard({ label, value, color, subtext }) {
  const colorMap = { red:RED, yellow:YEL, green:GRN, neutral:T1 };
  const col = colorMap[color] || neutral;
  return (
    <div style={{ flex:'0 0 calc(25% - 10px)', minWidth:140,
      background:BG1, border:`1px solid ${BD}`, borderRadius:8,
      padding:14, display:'flex', flexDirection:'column', gap:8 }}>
      <div style={{ fontSize:28, fontWeight:700, color:col, fontFamily:MONO }}>{value}</div>
      <div style={{ fontSize:11, color:T1, textTransform:'uppercase', letterSpacing:'0.5px' }}>{label}</div>
      {subtext && <div style={{ fontSize:10, color:`${col}99` }}>{subtext}</div>}
    </div>
  );
}

function SimilarityBadge({ score }) {
  const col = score > 0.9 ? RED : score > 0.85 ? YEL : GRN;
  return (
    <span style={{
      fontSize:11, fontWeight:600, color:col, fontFamily:MONO,
      background:`${col}12`, border:`1px solid ${col}33`,
      padding:'2px 8px', borderRadius:3,
    }}>{(score*100).toFixed(0)}%</span>
  );
}

// ─── MAIN COMPONENT ──────────────────────────────────────────────────────────

function NidMemory() {
  const [selectedDetail, setSelectedDetail] = useState(null);

  return (
    <div style={{ display:'flex', flex:1, flexDirection:'column', overflow:'hidden' }}>

      {/* Header */}
      <div style={{ height:48, padding:'0 20px', flexShrink:0,
        borderBottom:`1px solid ${BD}`, background:BG1,
        display:'flex', alignItems:'center', gap:10 }}>
        <div style={{ flex:1 }}>
          <span style={{ fontSize:14, fontWeight:600, color:T0 }}>Memory Quality</span>
          <span style={{ fontSize:12, color:T1, marginLeft:10 }}>Agent memory diagnostics and health</span>
        </div>
        <button style={{
          padding:'6px 14px',
          background: BG2,
          border: `1px solid ${BD}`,
          borderRadius:6, cursor:'pointer',
          fontSize:12, fontWeight:500, color:'#fff',
          transition:'all 0.15s',
        }}>↻ Refresh</button>
      </div>

      {/* Summary metrics */}
      <div style={{ padding:'16px 20px', borderBottom:`1px solid ${BD}`,
        background:BG1, overflow:'auto' }}>
        <div style={{ display:'flex', gap:12, flexWrap:'wrap' }}>
          <MetricCard label="Total Active" value={MEM_SUMMARY.totalActive} color="neutral" />
          <MetricCard label="Injected (24h)" value={MEM_SUMMARY.injected24h} color="neutral" />
          <MetricCard label="Extract Fails (24h)" value={MEM_SUMMARY.extractionFails} color="red" />
          <MetricCard label="Dedup Rejections" value={MEM_SUMMARY.dedupRejections} color="yellow" />
          <MetricCard label="Low Confidence" value={MEM_SUMMARY.lowConfidence} color="yellow" />
          <MetricCard label="Never Used" value={MEM_SUMMARY.neverUsed} color="yellow" />
          <MetricCard label="Superseded" value={MEM_SUMMARY.superseded} color="neutral" />
        </div>
      </div>

      {/* Main grid: 2 columns */}
      <div style={{ flex:1, display:'grid', gridTemplateColumns:'1fr 1fr',
        gap:0, overflow:'hidden' }}>

        {/* LEFT COLUMN: Issues */}
        <div style={{ overflow:'auto', borderRight:`1px solid ${BD}` }}>

          {/* Duplicate candidates */}
          <div style={{ borderBottom:`1px solid ${BD}` }}>
            <div style={{ padding:'12px 14px', background:BG1, borderBottom:`1px solid ${BD}`,
              fontSize:12, fontWeight:600, color:T0, display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ width:4, height:4, borderRadius:'50%', background:YEL, flexShrink:0 }}/>
              Duplicate Candidates ({MEM_DUPLICATES.length})
            </div>
            {MEM_DUPLICATES.map(dup => (
              <div key={dup.id} onClick={() => setSelectedDetail({type:'duplicate', data:dup})}
                style={{ padding:'10px 14px', borderBottom:`1px solid ${BD}22`,
                  cursor:'pointer', background:'transparent', transition:'background 0.1s' }}
                onMouseEnter={e => e.currentTarget.style.background = BG2}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:6 }}>
                  <SimilarityBadge score={dup.score}/>
                  <span style={{ fontSize:10, color:T1 }}>×{dup.count}</span>
                </div>
                <div style={{ fontSize:11, color:T0, lineHeight:1.4, marginBottom:4 }}>
                  "{dup.text1}"
                </div>
                <div style={{ fontSize:10, color:T1 }}>
                  ↔ "{dup.text2}"
                </div>
              </div>
            ))}
          </div>

          {/* Stale memories */}
          <div style={{ borderBottom:`1px solid ${BD}` }}>
            <div style={{ padding:'12px 14px', background:BG1, borderBottom:`1px solid ${BD}`,
              fontSize:12, fontWeight:600, color:T0, display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ width:4, height:4, borderRadius:'50%', background:YEL, flexShrink:0 }}/>
              Stale Memories ({MEM_STALE.length})
            </div>
            {MEM_STALE.map(mem => (
              <div key={mem.id} onClick={() => setSelectedDetail({type:'stale', data:mem})}
                style={{ padding:'10px 14px', borderBottom:`1px solid ${BD}22`,
                  cursor:'pointer', background:'transparent', transition:'background 0.1s' }}
                onMouseEnter={e => e.currentTarget.style.background = BG2}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                  <span style={{ fontSize:10, fontFamily:MONO, color:T1, flexShrink:0 }}>{mem.id}</span>
                  <span style={{ fontSize:11, color:T0, flex:1 }}>{mem.text}</span>
                </div>
                <div style={{ fontSize:10, color:T1, display:'flex', gap:12 }}>
                  <span>Not used: {mem.lastUsed}d</span>
                  <span>Confidence: {(mem.confidence*100).toFixed(0)}%</span>
                </div>
              </div>
            ))}
          </div>

          {/* Low confidence */}
          <div style={{ borderBottom:`1px solid ${BD}` }}>
            <div style={{ padding:'12px 14px', background:BG1, borderBottom:`1px solid ${BD}`,
              fontSize:12, fontWeight:600, color:T0, display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ width:4, height:4, borderRadius:'50%', background:YEL, flexShrink:0 }}/>
              Low Confidence ({MEM_LOW_CONF.length})
            </div>
            {MEM_LOW_CONF.map(mem => (
              <div key={mem.id} onClick={() => setSelectedDetail({type:'lowconf', data:mem})}
                style={{ padding:'10px 14px', borderBottom:`1px solid ${BD}22`,
                  cursor:'pointer', background:'transparent', transition:'background 0.1s' }}
                onMouseEnter={e => e.currentTarget.style.background = BG2}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                  <span style={{ fontSize:10, fontFamily:MONO, color:RED }}>{mem.id}</span>
                  <span style={{ fontSize:10, fontFamily:MONO, color:T1, padding:'1px 5px',
                    background:BG2, borderRadius:2 }}>{mem.category}</span>
                  <span style={{ fontSize:11, color:RED, fontWeight:600, marginLeft:'auto' }}>
                    {(mem.confidence*100).toFixed(0)}%
                  </span>
                </div>
                <div style={{ fontSize:10, color:T1 }}>{mem.content}</div>
              </div>
            ))}
          </div>

          {/* Never used */}
          <div>
            <div style={{ padding:'12px 14px', background:BG1, borderBottom:`1px solid ${BD}`,
              fontSize:12, fontWeight:600, color:T0, display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ width:4, height:4, borderRadius:'50%', background:YEL, flexShrink:0 }}/>
              Never Used ({MEM_NEVER_USED.length})
            </div>
            {MEM_NEVER_USED.map(mem => (
              <div key={mem.id} onClick={() => setSelectedDetail({type:'neverused', data:mem})}
                style={{ padding:'10px 14px', borderBottom:`1px solid ${BD}22`,
                  cursor:'pointer', background:'transparent', transition:'background 0.1s' }}
                onMouseEnter={e => e.currentTarget.style.background = BG2}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                  <span style={{ fontSize:10, fontFamily:MONO, color:T1, flexShrink:0 }}>{mem.id}</span>
                  <span style={{ fontSize:10, color:T1 }}>Created {mem.created}</span>
                </div>
                <div style={{ fontSize:11, color:T0 }}>{mem.content}</div>
              </div>
            ))}
          </div>
        </div>

        {/* RIGHT COLUMN: Behavior */}
        <div style={{ overflow:'auto' }}>

          {/* Frequent memories */}
          <div style={{ borderBottom:`1px solid ${BD}` }}>
            <div style={{ padding:'12px 14px', background:BG1, borderBottom:`1px solid ${BD}`,
              fontSize:12, fontWeight:600, color:T0, display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ width:4, height:4, borderRadius:'50%', background:GRN, flexShrink:0 }}/>
              Top Injected ({MEM_FREQUENT.length})
            </div>
            {MEM_FREQUENT.map(mem => (
              <div key={mem.id} onClick={() => setSelectedDetail({type:'frequent', data:mem})}
                style={{ padding:'10px 14px', borderBottom:`1px solid ${BD}22`,
                  cursor:'pointer', background:'transparent', transition:'background 0.1s' }}
                onMouseEnter={e => e.currentTarget.style.background = BG2}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                  <span style={{ fontSize:11, fontWeight:600, color:GRN, fontFamily:MONO }}>#{mem.useCount}</span>
                  <span style={{ fontSize:10, color:T1 }}>Last: {mem.lastUsed}</span>
                </div>
                <div style={{ fontSize:11, color:T0, marginBottom:6 }}>{mem.content}</div>
                <div style={{ display:'flex', gap:10, fontSize:9, color:T1 }}>
                  <span>rel:{(mem.relevance*100).toFixed(0)}%</span>
                  <span>imp:{(mem.importance*100).toFixed(0)}%</span>
                  <span>decay:{(mem.decay*100).toFixed(0)}%</span>
                </div>
              </div>
            ))}
          </div>

          {/* Extraction failures */}
          <div>
            <div style={{ padding:'12px 14px', background:BG1, borderBottom:`1px solid ${BD}`,
              fontSize:12, fontWeight:600, color:T0, display:'flex', alignItems:'center', gap:8 }}>
              <span style={{ width:4, height:4, borderRadius:'50%', background:RED, flexShrink:0 }}/>
              Extraction Failures ({MEM_EXTRACT_FAILS.length})
            </div>
            {MEM_EXTRACT_FAILS.map(fail => (
              <div key={fail.id} onClick={() => setSelectedDetail({type:'extractfail', data:fail})}
                style={{ padding:'10px 14px', borderBottom:`1px solid ${BD}22`,
                  cursor:'pointer', background:'transparent', transition:'background 0.1s' }}
                onMouseEnter={e => e.currentTarget.style.background = BG2}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:4 }}>
                  <span style={{ fontSize:10, color:T1, fontFamily:MONO }}>{fail.time}</span>
                  <span style={{ fontSize:10, padding:'1px 6px', background:RED+'18',
                    color:RED, fontFamily:MONO, borderRadius:2 }}>{fail.error}</span>
                </div>
                <div style={{ fontSize:10, color:T1 }}>{fail.query}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Detail drawer */}
      {selectedDetail && (
        <div style={{ position:'fixed', top:0, right:0, bottom:0, width:320,
          background:BG1, borderLeft:`1px solid ${BD}`, zIndex:10,
          display:'flex', flexDirection:'column', boxShadow:'-2px 0 16px #00000044' }}>
          <div style={{ padding:'12px 14px', borderBottom:`1px solid ${BD}`,
            display:'flex', alignItems:'center', justifyContent:'space-between', flexShrink:0 }}>
            <span style={{ fontSize:12, fontWeight:600, color:T0, textTransform:'uppercase',
              letterSpacing:'0.5px' }}>Details</span>
            <span onClick={() => setSelectedDetail(null)} style={{
              cursor:'pointer', color:T1, fontSize:16, lineHeight:1 }}>✕</span>
          </div>
          <div style={{ flex:1, overflowY:'auto', padding:14, display:'flex', flexDirection:'column', gap:14 }}>

            {/* Duplicate view */}
            {selectedDetail.type === 'duplicate' && (
              <>
                <div>
                  <div style={{ fontSize:10, color:T1, marginBottom:4, textTransform:'uppercase', letterSpacing:'0.5px' }}>Similarity</div>
                  <div style={{ fontSize:14, fontWeight:700, color:YEL, fontFamily:MONO }}>
                    {(selectedDetail.data.score*100).toFixed(1)}%
                  </div>
                </div>
                <div>
                  <div style={{ fontSize:10, color:T1, marginBottom:6, textTransform:'uppercase', letterSpacing:'0.5px' }}>First Memory</div>
                  <div style={{ fontSize:11, color:T0, background:BG2, padding:10, borderRadius:4,
                    lineHeight:1.5, border:`1px solid ${BD}` }}>
                    {selectedDetail.data.text1}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize:10, color:T1, marginBottom:6, textTransform:'uppercase', letterSpacing:'0.5px' }}>Second Memory</div>
                  <div style={{ fontSize:11, color:T0, background:BG2, padding:10, borderRadius:4,
                    lineHeight:1.5, border:`1px solid ${BD}` }}>
                    {selectedDetail.data.text2}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize:10, color:T1, marginBottom:4, textTransform:'uppercase', letterSpacing:'0.5px' }}>Occurrences</div>
                  <div style={{ fontSize:12, color:T0, fontFamily:MONO }}>×{selectedDetail.data.count}</div>
                </div>
              </>
            )}

            {/* Stale view */}
            {selectedDetail.type === 'stale' && (
              <>
                <div>
                  <div style={{ fontSize:10, color:T1, marginBottom:4, textTransform:'uppercase', letterSpacing:'0.5px' }}>ID</div>
                  <div style={{ fontSize:11, color:T0, fontFamily:MONO }}>{selectedDetail.data.id}</div>
                </div>
                <div>
                  <div style={{ fontSize:10, color:T1, marginBottom:6, textTransform:'uppercase', letterSpacing:'0.5px' }}>Content</div>
                  <div style={{ fontSize:11, color:T0, background:BG2, padding:10, borderRadius:4,
                    lineHeight:1.5, border:`1px solid ${BD}` }}>
                    {selectedDetail.data.text}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize:10, color:T1, marginBottom:4, textTransform:'uppercase', letterSpacing:'0.5px' }}>Last Used</div>
                  <div style={{ fontSize:12, color:T0, fontFamily:MONO }}>{selectedDetail.data.lastUsed} days ago</div>
                </div>
                <div>
                  <div style={{ fontSize:10, color:T1, marginBottom:4, textTransform:'uppercase', letterSpacing:'0.5px' }}>Confidence</div>
                  <div style={{ fontSize:12, color:T0, fontFamily:MONO }}>{(selectedDetail.data.confidence*100).toFixed(0)}%</div>
                </div>
                <div>
                  <div style={{ fontSize:10, color:T1, marginBottom:4, textTransform:'uppercase', letterSpacing:'0.5px' }}>Created</div>
                  <div style={{ fontSize:11, color:T1 }}>{selectedDetail.data.created}</div>
                </div>
              </>
            )}

            {/* Low confidence view */}
            {selectedDetail.type === 'lowconf' && (
              <>
                <div>
                  <div style={{ fontSize:10, color:T1, marginBottom:4, textTransform:'uppercase', letterSpacing:'0.5px' }}>ID</div>
                  <div style={{ fontSize:11, color:T0, fontFamily:MONO }}>{selectedDetail.data.id}</div>
                </div>
                <div>
                  <div style={{ fontSize:10, color:T1, marginBottom:4, textTransform:'uppercase', letterSpacing:'0.5px' }}>Confidence</div>
                  <div style={{ fontSize:14, fontWeight:700, color:RED, fontFamily:MONO }}>
                    {(selectedDetail.data.confidence*100).toFixed(0)}%
                  </div>
                </div>
                <div>
                  <div style={{ fontSize:10, color:T1, marginBottom:6, textTransform:'uppercase', letterSpacing:'0.5px' }}>Content</div>
                  <div style={{ fontSize:11, color:T0, background:BG2, padding:10, borderRadius:4,
                    lineHeight:1.5, border:`1px solid ${BD}` }}>
                    {selectedDetail.data.content}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize:10, color:T1, marginBottom:4, textTransform:'uppercase', letterSpacing:'0.5px' }}>Category</div>
                  <div style={{ fontSize:11, color:T0, fontFamily:MONO, padding:'4px 8px',
                    background:BG2, borderRadius:3, display:'inline-block' }}>
                    {selectedDetail.data.category}
                  </div>
                </div>
              </>
            )}

            {/* Never used view */}
            {selectedDetail.type === 'neverused' && (
              <>
                <div>
                  <div style={{ fontSize:10, color:T1, marginBottom:4, textTransform:'uppercase', letterSpacing:'0.5px' }}>ID</div>
                  <div style={{ fontSize:11, color:T0, fontFamily:MONO }}>{selectedDetail.data.id}</div>
                </div>
                <div>
                  <div style={{ fontSize:10, color:T1, marginBottom:6, textTransform:'uppercase', letterSpacing:'0.5px' }}>Content</div>
                  <div style={{ fontSize:11, color:T0, background:BG2, padding:10, borderRadius:4,
                    lineHeight:1.5, border:`1px solid ${BD}` }}>
                    {selectedDetail.data.content}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize:10, color:T1, marginBottom:4, textTransform:'uppercase', letterSpacing:'0.5px' }}>Created</div>
                  <div style={{ fontSize:11, color:T1 }}>{selectedDetail.data.created}</div>
                </div>
                <div style={{ padding:10, background:`${YEL}12`, borderRadius:4, border:`1px solid ${YEL}33` }}>
                  <div style={{ fontSize:10, color:YEL, fontWeight:600 }}>⚠ Never injected</div>
                  <div style={{ fontSize:10, color:T1, marginTop:4 }}>
                    This memory has never been used by any agent. Consider reviewing or removing.
                  </div>
                </div>
              </>
            )}

            {/* Frequent view */}
            {selectedDetail.type === 'frequent' && (
              <>
                <div>
                  <div style={{ fontSize:10, color:T1, marginBottom:4, textTransform:'uppercase', letterSpacing:'0.5px' }}>ID</div>
                  <div style={{ fontSize:11, color:T0, fontFamily:MONO }}>{selectedDetail.data.id}</div>
                </div>
                <div>
                  <div style={{ fontSize:10, color:T1, marginBottom:6, textTransform:'uppercase', letterSpacing:'0.5px' }}>Content</div>
                  <div style={{ fontSize:11, color:T0, background:BG2, padding:10, borderRadius:4,
                    lineHeight:1.5, border:`1px solid ${BD}` }}>
                    {selectedDetail.data.content}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize:10, color:T1, marginBottom:4, textTransform:'uppercase', letterSpacing:'0.5px' }}>Use Count</div>
                  <div style={{ fontSize:12, color:T0, fontFamily:MONO }}>{selectedDetail.data.useCount}</div>
                </div>
                <div>
                  <div style={{ fontSize:10, color:T1, marginBottom:4, textTransform:'uppercase', letterSpacing:'0.5px' }}>Last Used</div>
                  <div style={{ fontSize:11, color:T1 }}>{selectedDetail.data.lastUsed}</div>
                </div>
                <div>
                  <div style={{ fontSize:10, color:T1, marginBottom:8, textTransform:'uppercase', letterSpacing:'0.5px' }}>Score Breakdown</div>
                  <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                    {[
                      ['Relevance', selectedDetail.data.relevance],
                      ['Importance', selectedDetail.data.importance],
                      ['Decay', selectedDetail.data.decay],
                    ].map(([k, v]) => (
                      <div key={k} style={{ display:'flex', alignItems:'center', gap:8 }}>
                        <span style={{ fontSize:10, color:T1, width:80 }}>{k}</span>
                        <div style={{ flex:1, height:3, background:BD, borderRadius:2, overflow:'hidden' }}>
                          <div style={{ height:'100%', width:`${v*100}%`, background:GRN, borderRadius:2 }}/>
                        </div>
                        <span style={{ fontSize:10, color:T0, fontFamily:MONO, width:40, textAlign:'right' }}>
                          {(v*100).toFixed(0)}%
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Extraction failure view */}
            {selectedDetail.type === 'extractfail' && (
              <>
                <div>
                  <div style={{ fontSize:10, color:T1, marginBottom:4, textTransform:'uppercase', letterSpacing:'0.5px' }}>Timestamp</div>
                  <div style={{ fontSize:11, color:T0, fontFamily:MONO }}>{selectedDetail.data.time}</div>
                </div>
                <div>
                  <div style={{ fontSize:10, color:T1, marginBottom:4, textTransform:'uppercase', letterSpacing:'0.5px' }}>Error Type</div>
                  <div style={{ fontSize:11, color:RED, fontFamily:MONO, padding:'4px 8px',
                    background:RED+'12', borderRadius:3, display:'inline-block', border:`1px solid ${RED}33` }}>
                    {selectedDetail.data.error}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize:10, color:T1, marginBottom:6, textTransform:'uppercase', letterSpacing:'0.5px' }}>Failed Query</div>
                  <div style={{ fontSize:11, color:T0, background:BG2, padding:10, borderRadius:4,
                    lineHeight:1.5, border:`1px solid ${BD}` }}>
                    {selectedDetail.data.query}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Export for use in Nidavellir app
window.NidMemory = NidMemory;
