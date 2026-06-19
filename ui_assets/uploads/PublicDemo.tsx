import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "react-router-dom";
import { BASE } from "../api";
import logo from "../assets/logo-white.png";
import Vapi from "@vapi-ai/web";
import { Conversation } from "@elevenlabs/client";
import {
  PhoneIcon,
  XMarkIcon,
  InformationCircleIcon,
  ArrowPathIcon,
  ArrowRightIcon,
  DocumentTextIcon,
  CheckCircleIcon,
} from "@heroicons/react/24/outline";
import { StarIcon } from "@heroicons/react/24/solid";

/* ─── types ─────────────────────────────────────────────────────────────── */
interface Company {
  id: string; name: string; slug: string; logo_url: string;
  passcode: string; voice_platform: string; is_published: number;
}
interface Agent {
  id: string; name: string; description: string; agent_id: string;
  avatar_url: string; objective: string; is_published: number;
}
interface TranscriptLine { role: "agent" | "user"; text: string; }

/* ─── component ─────────────────────────────────────────────────────────── */
export default function PublicDemo() {
  const { slug } = useParams<{ slug: string }>();

  const [company, setCompany]             = useState<Company | null>(null);
  const [agents, setAgents]               = useState<Agent[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<Agent | null>(null);
  const [passcodeInput, setPasscodeInput] = useState("");
  const [passcodeValid, setPasscodeValid] = useState(false);
  const [needsPasscode, setNeedsPasscode] = useState(false);
  const [loading, setLoading]             = useState(true);
  const [showModal, setShowModal]         = useState(false);
  const [isConnected, setIsConnected]     = useState(false);
  const [callEnded, setCallEnded]         = useState(false);
  const [callSummary, setCallSummary]     = useState("");
  const [rating, setRating]               = useState(0);
  const [feedback, setFeedback]           = useState("");
  const [userName, setUserName]           = useState("");
  const [userEmail, setUserEmail]         = useState("");
  const [anonymous, setAnonymous]         = useState(false);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);
  const [sessionId, setSessionId]         = useState<string | null>(null);
  const [vapiCallId, setVapiCallId]             = useState<string | null>(null);
  const [elevenLabsConvId, setElevenLabsConvId] = useState<string | null>(null);
  const [error, setError]                 = useState("");
  const [, setTranscript]                 = useState<TranscriptLine[]>([]);
  const [agentSpeaking, setAgentSpeaking] = useState(false);
  // Contact Us modal
  const [showContact, setShowContact]     = useState(false);
  const [contactForm, setContactForm]     = useState({ name:"", email:"", phone:"", company:"", message:"" });
  const [contactSent, setContactSent]     = useState(false);
  const [contactSending, setContactSending] = useState(false);

  const elevenLabsConvRef = useRef<any>(null);
  const vapiRef           = useRef<any>(null);

  /* ── load ── */
  useEffect(() => {
    if (!slug) return;
    fetch(`${BASE}/api/public/companies/${slug}`)
      .then(r => r.json())
      .then(async data => {
        if (data.success) {
          setCompany(data.company);
          setNeedsPasscode(!!data.company.passcode);
          if (!data.company.passcode) setPasscodeValid(true);
          const ar = await fetch(`${BASE}/api/public/agents/${data.company.id}`);
          const ad = await ar.json();
          if (ad.success) {
            const pub = ad.agents.filter((a: Agent) => a.is_published === 1);
            setAgents(pub);
            if (pub.length >= 1) setSelectedAgent(pub[0]);
          }
        } else { setError("Company not found"); }
        setLoading(false);
      })
      .catch(() => { setError("Failed to load. Please try again."); setLoading(false); });
  }, [slug]);

  /* ── ElevenLabs ── */
  const startElevenLabsCall = async () => {
    const res = await fetch(`${BASE}/api/voice/eleven-labs/session`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId: company!.id, agentId: selectedAgent!.id })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message);
    if (data.sessionId) setSessionId(data.sessionId);

    const conv = await Conversation.startSession({
      ...(data.signedUrl ? { signedUrl: data.signedUrl } : { agentId: data.agentId }),
      onMessage: (msg: { source: string; message: string }) => {
         setTranscript(p => [...p, {
           role: msg.source === "ai" ? "agent" : "user",
           text: msg.message
           }]);
        },
      onModeChange: ({ mode }: { mode: string }) => {
        setAgentSpeaking(mode === "speaking");
     },
     onDisconnect: (details?: any) => {
      console.log("ElevenLabs onDisconnect fired:", details);
      handleCallEnded();
    },
     onError: (msg: string) => {
      console.error("ElevenLabs error:", msg);
      setError("Call error. Please try again.");
     },
   });
elevenLabsConvRef.current = conv;
    // Capture the ElevenLabs conversation ID so we can poll for the summary
    // via the REST API after the call ends (getId() is on the Conversation instance)
    const eid = (conv as any).getId?.() ?? (conv as any).conversationId ?? null;
    if (eid) setElevenLabsConvId(String(eid));
    setIsConnected(true); setShowModal(false);
  };

  /* ── VAPI ── */
  const startVapiCall = async () => {
    const res = await fetch(`${BASE}/api/voice/vapi/session`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId: company!.id, agentId: selectedAgent!.id })
    });
    const data = await res.json();
    if (!data.success) throw new Error(data.message || "Failed to create VAPI session");
    setSessionId(data.sessionId);

    const vapi = new Vapi(data.publicKey);
    vapiRef.current = vapi;

    vapi.on("message", (msg: any) => {
      if (msg.type === "transcript" && msg.transcriptType === "final")
        setTranscript(p => [...p, { role: msg.role === "assistant" ? "agent" : "user", text: msg.transcript }]);
      if (msg.type === "speech-update")
        setAgentSpeaking(msg.status === "started" && msg.role === "assistant");
      // Note: end-of-call-report is a server webhook event only — not delivered to the browser SDK
    });
    vapi.on("call-end", () => handleCallEnded());
    vapi.on("error",    (e: any) => { console.error("VAPI error:", e); setError("Call error. Please try again."); });

    // vapi.start() returns the call object which contains the VAPI call ID.
    // We use this to poll our server for the call summary via VAPI REST API.
    const call = await vapi.start(data.assistantId) as any;
    if (call?.id) setVapiCallId(call.id);
    setIsConnected(true); setShowModal(false);
  };

  /* ── start / end / reset ── */
  const startCall = useCallback(async () => {
    if (!selectedAgent || !company) return;
    setError("");
    try { company.voice_platform === "vapi" ? await startVapiCall() : await startElevenLabsCall(); }
    catch (err: any) { console.error("Failed to start call:", err); setError("Failed to start call. Please check your connection."); }
  }, [selectedAgent, company]);

  const endCall = useCallback(async () => {
    try {
      if (elevenLabsConvRef.current?.endSession) await elevenLabsConvRef.current.endSession();
      if (vapiRef.current?.stop) vapiRef.current.stop();
    } catch (err) { console.error("Error ending call:", err); }
    handleCallEnded();
  }, []);

  const handleCallEnded = useCallback((_callId?: string) => {
    setIsConnected(false); setCallEnded(true); setAgentSpeaking(false);
    elevenLabsConvRef.current = null; vapiRef.current = null;
  }, []);

  /* ── poll for call summary after call ends ── */
  /* VAPI: server calls VAPI REST API using the captured vapiCallId.                   */
  /* ElevenLabs: server calls ElevenLabs REST API using the captured elevenLabsConvId. */
  /* Fallback: polls session endpoint (only works if server webhooks are configured).  */
  useEffect(() => {
    if (!callEnded || !sessionId || callSummary) return;

    let stopped = false;
    let attempts = 0;
    const maxAttempts = 20; // ~100 seconds at 5s intervals

    const fetchSummary = async () => {
      if (stopped) return;
      try {
        let url: string;
        if (vapiCallId) {
          url = `${BASE}/api/voice/vapi/call-summary?callId=${encodeURIComponent(vapiCallId)}&sessionId=${encodeURIComponent(sessionId)}`;
        } else if (elevenLabsConvId) {
          url = `${BASE}/api/voice/eleven-labs/call-summary?conversationId=${encodeURIComponent(elevenLabsConvId)}&sessionId=${encodeURIComponent(sessionId)}`;
        } else {
          url = `${BASE}/api/public/session/${sessionId}`;
        }
        const res  = await fetch(url);
        const data = await res.json();
        if (data.success && data.summary) {
          setCallSummary(data.summary);
          stopped = true;
        }
      } catch { /* ignore network errors */ }
      attempts++;
      if (attempts >= maxAttempts) stopped = true;
    };

    fetchSummary(); // immediate first attempt — no waiting on first interval tick
    const interval = setInterval(fetchSummary, 5000);

    return () => { stopped = true; clearInterval(interval); };
  }, [callEnded, sessionId, callSummary, vapiCallId, elevenLabsConvId]);

  const submitFeedback = async () => {
    try {
      await fetch(`${BASE}/api/public/feedback`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, companyId: company?.id, agentId: selectedAgent?.id,
          rating, feedback, userName: anonymous ? null : userName, userEmail: anonymous ? null : userEmail })
      });
      setFeedbackSubmitted(true);
    } catch (err) { console.error("Feedback error:", err); }
  };

  const resetCall = () => {
    setCallEnded(false); setFeedbackSubmitted(false); setRating(0); setFeedback("");
    setCallSummary(""); setSessionId(null); setVapiCallId(null); setElevenLabsConvId(null); setIsConnected(false); setError("");
    setTranscript([]); setAgentSpeaking(false);
    elevenLabsConvRef.current = null; vapiRef.current = null;
  };

  const closeContact = () => {
    setShowContact(false);
    setContactSent(false);
    setContactForm({ name:"", email:"", phone:"", company:"", message:"" });
  };

  /* ── loading / error shells ── */
  if (loading) return (
    <div style={pg}><style>{CSS}</style>
      <nav style={nav}><img src={logo} alt="Predixion AI" style={{ height:70 }} /></nav>
      <div style={centered}><p style={mu}>Loading…</p></div>
    </div>
  );
  if (error && !company) return (
    <div style={pg}><style>{CSS}</style>
      <nav style={nav}><img src={logo} alt="Predixion AI" style={{ height:70 }} /></nav>
      <div style={centered}><p style={mu}>{error}</p></div>
    </div>
  );
  if (!company || !company.is_published) return (
    <div style={pg}><style>{CSS}</style>
      <nav style={nav}><img src={logo} alt="Predixion AI" style={{ height:70 }} /></nav>
      <div style={centered}><p style={mu}>This demo is not available.</p></div>
    </div>
  );

  /* ── passcode gate ── */
  if (needsPasscode && !passcodeValid) {
    const checkPasscode = () =>
      passcodeInput === company.passcode ? setPasscodeValid(true) : setError("Invalid passcode");
    return (
      <div style={pg}><style>{CSS}</style>
        <nav style={nav}><img src={logo} alt="Predixion AI" style={{ height:70 }} /></nav>
        <main style={passcodeWrap}>
          <div style={card}>
            {company.logo_url
              ? <img src={company.logo_url} alt={company.name} style={{ height:52, borderRadius:10, marginBottom:4 }} />
              : <div style={avatarPH}>{company.name.charAt(0)}</div>}
            <h1 style={agName}>{company.name}</h1>
            <p style={{ ...mu, marginBottom:20 }}>Enter passcode to continue</p>
            <input
              style={{ ...inp, marginBottom:8 }}
              type="password"
              placeholder="Passcode"
              autoFocus
              value={passcodeInput}
              onChange={e => setPasscodeInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") checkPasscode(); }}
            />
            {error && <p style={errMsg}>{error}</p>}
            <button style={btnT} className="pd-btn-talk" onClick={checkPasscode}>
              <span style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:6 }}>
                Continue <ArrowRightIcon style={{ width:16, height:16 }} />
              </span>
            </button>
          </div>
        </main>
      </div>
    );
  }

  /* ── main page ── */
  return (
    <div style={pg}>
      <style>{CSS}</style>

      {/* centered logo */}
      <nav style={nav}>
        <img src={logo} alt="Predixion AI" style={{ height:70 }} />
      </nav>

      {/* single-column centered layout */}
      <main style={mainCentered}>
        {selectedAgent ? (
          <div style={card}>
            <div style={{ position:"relative", width:110, height:110, marginBottom:4 }}>
              {selectedAgent.avatar_url
                ? <img src={selectedAgent.avatar_url} alt={selectedAgent.name} style={avatarImg} />
                : <div style={avatarPH}>{selectedAgent.name.charAt(0)}</div>}
              {isConnected && <div className="pd-ring" />}
            </div>

            {isConnected && (
              <div style={{ display:"flex", alignItems:"center", gap:3, height:32, marginBottom:4 }}>
                {Array.from({ length:12 }).map((_,i) => (
                  <div key={i} className={agentSpeaking ? "pd-bar pd-bar-active" : "pd-bar"} style={{ animationDelay:`${i*0.07}s` }} />
                ))}
              </div>
            )}

            <h2 style={agName}>{selectedAgent.name}</h2>
            {selectedAgent.objective && <span style={objBadge}>{selectedAgent.objective}</span>}
            {selectedAgent.description && <p style={agDesc}>{selectedAgent.description}</p>}

            {agents.length > 1 && !isConnected && !callEnded && (
              <select style={{ ...inp, marginTop:4 }} value={selectedAgent.id}
                onChange={e => setSelectedAgent(agents.find(a => a.id === e.target.value) || null)}>
                {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            )}

            {!callEnded && (
              !isConnected
                ? <button style={btnT} className="pd-btn-talk" onClick={() => setShowModal(true)}><PhoneIcon style={{width:18,height:18,display:"inline",marginRight:8,verticalAlign:"middle"}}/>Talk Now</button>
                : <button style={btnE} className="pd-btn-end" onClick={endCall}><XMarkIcon style={{width:18,height:18,display:"inline",marginRight:8,verticalAlign:"middle"}}/>End Call</button>
            )}

            {isConnected && (
              <div style={{ display:"flex", alignItems:"center", gap:8, fontSize:13, color:"#22c55e" }}>
                <span className="pd-dot" /> Live conversation
              </div>
            )}

            {error && <p style={errMsg}>{error}</p>}
            {callEnded && <button style={{ ...btnT, marginTop:12 }} className="pd-btn-talk" onClick={resetCall}><ArrowPathIcon style={{width:18,height:18,display:"inline",marginRight:8,verticalAlign:"middle"}}/>Start over</button>}

            {/* Call Summary INSIDE the card (only after call ends) */}
            {callEnded && (
              <div style={{ ...smCard, width:"100%", marginTop:16 }}>
                <p style={smTitle}><DocumentTextIcon style={{width:16,height:16,display:"inline",marginRight:6,verticalAlign:"middle"}}/>Call Summary</p>
                {callSummary
                  ? <p style={{ fontSize:14, color:"#94a3b8", lineHeight:1.6 }}>{callSummary}</p>
                  : <p style={{ ...mu, fontStyle:"italic" }}>Summary will appear here after processing…</p>}
              </div>
            )}
          </div>
        ) : (
          <div style={card}>
            <p style={mu}>No agents available.</p>
          </div>
        )}

        {/* Feedback card (only after call ends) */}
        {callEnded && !feedbackSubmitted && (
          <div style={fbCard}>
            <p style={smTitle}>Rate your experience</p>
            <div style={{ display:"flex", gap:8, marginBottom:16 }}>
              {[1,2,3,4,5].map(s => (
                <button key={s} className="pd-star"
                  style={{ background:"none", border:"none", cursor:"pointer", padding:0, lineHeight:1 }}
                  onClick={() => setRating(s)}>
                  <StarIcon style={{ width:28, height:28, color: rating>=s ? "#f59e0b" : "#334155" }} />
                </button>
              ))}
            </div>
            <p style={{ ...smTitle, marginBottom:8 }}>Share your feedback</p>
            <textarea style={{ ...inp, resize:"vertical", minHeight:72, marginBottom:10 } as React.CSSProperties}
              placeholder="Tell us about your experience…" value={feedback} onChange={e => setFeedback(e.target.value)} />
            <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:12 }}>
              <input type="checkbox" id="anon" checked={anonymous} onChange={e => setAnonymous(e.target.checked)} style={{ width:16, height:16, cursor:"pointer" }} />
              <label htmlFor="anon" style={{ ...mu, cursor:"pointer", fontSize:13 }}>Submit anonymously</label>
            </div>
            {!anonymous && (<>
              <input style={{ ...inp, marginBottom:10 }} placeholder="Your name (optional)"  value={userName}  onChange={e => setUserName(e.target.value)} />
              <input style={{ ...inp, marginBottom:16 }} placeholder="Your email (optional)" value={userEmail} onChange={e => setUserEmail(e.target.value)} />
            </>)}
            <button style={btnT} className="pd-btn-talk" onClick={submitFeedback}>Submit Feedback</button>
          </div>
        )}

        {feedbackSubmitted && (
          <div style={{ ...fbCard, alignItems:"center" }}>
            <CheckCircleIcon style={{ width:48, height:48, color:"#22c55e", marginBottom:8 }} />
            <p style={{ color:"#f1f5f9", fontWeight:600, fontSize:16, marginBottom:16 }}>Thank you for your feedback!</p>
            <button style={btnG} onClick={resetCall}>Start another conversation</button>
          </div>
        )}
      </main>

      {/* footer — sits right below the card now */}
      <footer style={{ padding:"24px 40px 40px", display:"flex", flexDirection:"column", alignItems:"center", gap:14 }}>
        <p style={mu}>Want AI agents for your business?</p>
        <button style={btnG} onClick={() => setShowContact(true)}>Contact Us <ArrowRightIcon style={{width:14,height:14,display:"inline",marginLeft:4,verticalAlign:"middle"}}/></button>
      </footer>

      {/* ── Before-you-start modal ── */}
      {showModal && (
        <div style={overlay} onClick={() => setShowModal(false)}>
          <div style={modal} onClick={e => e.stopPropagation()}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
              <span style={{ fontWeight:600, color:"#f1f5f9", display:"flex", alignItems:"center", gap:6 }}>
                <InformationCircleIcon style={{ width:18, height:18, color:"#60a5fa" }} /> Before you start
              </span>
              <button style={closeBtn} onClick={() => setShowModal(false)}>
                <XMarkIcon style={{ width:18, height:18 }} />
              </button>
            </div>
            {["Ensure microphone permissions are granted for this site",
              "Close other apps that may be using your microphone",
              "Web latency varies and depends on your internet connection"].map((step, i) => (
              <div key={i} style={{ display:"flex", gap:12 }}>
                <span style={{ color:"#3b82f6", fontWeight:600, flexShrink:0 }}>{i+1}.</span>
                <span style={{ color:"#94a3b8", fontSize:14 }}>{step}</span>
              </div>
            ))}
            <button style={{ ...btnT, width:"100%" }} className="pd-btn-talk" onClick={startCall}>Proceed <ArrowRightIcon style={{width:16,height:16,display:"inline",marginLeft:6,verticalAlign:"middle"}}/></button>
          </div>
        </div>
      )}

      {/* ── Contact Us modal ── */}
      {showContact && (
        <div style={overlay} onClick={closeContact}>
          <div style={{ ...modal, maxWidth:480 }} onClick={e => e.stopPropagation()}>

            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:4 }}>
              <span style={{ fontWeight:600, color:"#f1f5f9", fontSize:16, display:"flex", alignItems:"center", gap:6 }}>
                {contactSent && <CheckCircleIcon style={{ width:18, height:18, color:"#22c55e" }} />}
                {contactSent ? "Message sent!" : "Contact Us"}
              </span>
              <button style={closeBtn} onClick={closeContact}>
                <XMarkIcon style={{ width:18, height:18 }} />
              </button>
            </div>

            {contactSent ? (
              <div style={{ textAlign:"center", padding:"20px 0" }}>
                <p style={{ fontSize:14, color:"#94a3b8", lineHeight:1.7 }}>
                  Thanks for reaching out! Our team will get back to you within 24 hours.
                </p>
                <button style={{ ...btnT, marginTop:20 }} className="pd-btn-talk" onClick={closeContact}>Close</button>
              </div>
            ) : (<>
              <p style={{ fontSize:13, color:"#94a3b8", marginBottom:16 }}>
                Fill out the form below and we'll get back to you as soon as possible.
              </p>

              <div style={{ display:"flex", flexDirection:"column", gap:12 }}>
                <div>
                  <label style={fieldLabel}>Name *</label>
                  <input style={inp} placeholder="Your full name"
                    value={contactForm.name}
                    onChange={e => setContactForm(f => ({ ...f, name: e.target.value }))} />
                </div>
                <div>
                  <label style={fieldLabel}>Email *</label>
                  <input style={inp} type="email" placeholder="your.email@company.com"
                    value={contactForm.email}
                    onChange={e => setContactForm(f => ({ ...f, email: e.target.value }))} />
                  <p style={{ fontSize:11, color:"#64748b", marginTop:4 }}>Please use your official email address</p>
                </div>
                <div>
                  <label style={fieldLabel}>Phone (Optional)</label>
                  <input style={inp} placeholder="+91 0000000000"
                    value={contactForm.phone}
                    onChange={e => setContactForm(f => ({ ...f, phone: e.target.value }))} />
                </div>
                <div>
                  <label style={fieldLabel}>Company (Optional)</label>
                  <input style={inp} placeholder="Your company name"
                    value={contactForm.company}
                    onChange={e => setContactForm(f => ({ ...f, company: e.target.value }))} />
                </div>
                <div>
                  <label style={fieldLabel}>What are you looking for? (Optional)</label>
                  <textarea style={{ ...inp, resize:"vertical", minHeight:96 } as React.CSSProperties}
                    placeholder="Tell us about your requirements or what you're interested in..."
                    value={contactForm.message}
                    onChange={e => setContactForm(f => ({ ...f, message: e.target.value }))} />
                </div>
              </div>

              <div style={{ display:"flex", gap:10, marginTop:20 }}>
                <button style={btnG} onClick={closeContact}>Cancel</button>
                <button
                  style={{ ...btnT, flex:1, marginTop:0, opacity: (contactSending || !contactForm.name.trim() || !contactForm.email.trim()) ? 0.5 : 1 }}
                  className="pd-btn-talk"
                  disabled={contactSending || !contactForm.name.trim() || !contactForm.email.trim()}
                  onClick={async () => {
                    setContactSending(true);
                    try {
                      await fetch(`${BASE}/api/public/contact`, {
                        method: "POST", headers: { "Content-Type":"application/json" },
                        body: JSON.stringify({ ...contactForm, companySlug: slug })
                      });
                      setContactSent(true);
                    } catch {
                      setError("Failed to send. Please try again.");
                    } finally { setContactSending(false); }
                  }}>
                  {contactSending ? "Sending…" : "Submit"}
                </button>
              </div>
            </>)}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── style constants ───────────────────────────────────────────────────── */
const pg:           React.CSSProperties = { minHeight:"100vh", background:"radial-gradient(ellipse at 20% 0%, #0f2040 0%, #020617 55%)", color:"#f1f5f9", fontFamily:"'DM Sans',sans-serif", display:"flex", flexDirection:"column" };
const nav:          React.CSSProperties = { display:"flex", justifyContent:"center", alignItems:"center", padding:"24px 40px" };
const mainCentered: React.CSSProperties = { display:"flex", flexDirection:"column", alignItems:"center", padding:"20px 24px 12px", gap:16, width:"100%", maxWidth:540, margin:"0 auto" };
const passcodeWrap: React.CSSProperties = { flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"20px 24px 60px", width:"100%", maxWidth:420, margin:"0 auto" };
const centered:     React.CSSProperties = { display:"flex", justifyContent:"center", alignItems:"center", flex:1, padding:"60px 24px" };
const card:         React.CSSProperties = { background:"rgba(255,255,255,.04)", border:"1px solid rgba(255,255,255,.09)", borderRadius:24, padding:"36px 28px", backdropFilter:"blur(20px)", display:"flex", flexDirection:"column", alignItems:"center", gap:12, width:"100%" };
const avatarImg:    React.CSSProperties = { width:110, height:110, borderRadius:"50%", objectFit:"cover", border:"3px solid rgba(255,255,255,.1)" };
const avatarPH:     React.CSSProperties = { width:110, height:110, borderRadius:"50%", background:"rgba(59,130,246,.15)", border:"3px solid rgba(59,130,246,.3)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:40, fontWeight:800, color:"#3b82f6", fontFamily:"'Inter',sans-serif" };
const agName:       React.CSSProperties = { fontSize:26, fontWeight:700, fontFamily:"'Inter',sans-serif", color:"#f1f5f9", textAlign:"center" };
const objBadge:     React.CSSProperties = { fontSize:12, fontWeight:500, padding:"4px 12px", borderRadius:999, background:"rgba(59,130,246,.15)", color:"#60a5fa", border:"1px solid rgba(59,130,246,.25)" };
const agDesc:       React.CSSProperties = { fontSize:14, color:"#94a3b8", textAlign:"center", lineHeight:1.6, maxWidth:300 };
const btnT:         React.CSSProperties = { background:"linear-gradient(135deg,#3b82f6,#2563eb)", border:"none", borderRadius:999, padding:"14px 36px", color:"#fff", fontSize:16, fontWeight:600, cursor:"pointer", minWidth:180, marginTop:8, fontFamily:"'DM Sans',sans-serif", display:"inline-flex", alignItems:"center", justifyContent:"center" };
const btnE:         React.CSSProperties = { background:"rgba(239,68,68,.12)", border:"1px solid rgba(239,68,68,.35)", borderRadius:999, padding:"14px 36px", color:"#f87171", fontSize:16, fontWeight:600, cursor:"pointer", width:"100%", marginTop:8, fontFamily:"'DM Sans',sans-serif" };
const btnG:         React.CSSProperties = { background:"transparent", border:"1px solid #334155", borderRadius:8, padding:"10px 20px", color:"#f1f5f9", fontSize:14, cursor:"pointer", fontFamily:"'DM Sans',sans-serif" };
const inp:          React.CSSProperties = { background:"rgba(2,6,23,.7)", border:"1px solid #334155", borderRadius:8, padding:"10px 12px", color:"#f1f5f9", fontSize:14, width:"100%", outline:"none", fontFamily:"'DM Sans',sans-serif" };
const errMsg:       React.CSSProperties = { fontSize:13, color:"#f87171", background:"rgba(239,68,68,.1)", border:"1px solid rgba(239,68,68,.2)", borderRadius:8, padding:"10px 14px", width:"100%", textAlign:"center" };
const fieldLabel:   React.CSSProperties = { fontSize:12, fontWeight:500, color:"#94a3b8", display:"block", marginBottom:6, letterSpacing:"0.03em" };
const mu:           React.CSSProperties = { color:"#94a3b8", fontSize:14 };
const smCard:       React.CSSProperties = { background:"rgba(255,255,255,.03)", border:"1px solid rgba(255,255,255,.08)", borderRadius:16, padding:"20px 22px", backdropFilter:"blur(12px)" };
const smTitle:      React.CSSProperties = { fontSize:14, fontWeight:600, color:"#f1f5f9", marginBottom:10, fontFamily:"'Inter',sans-serif" };
const fbCard:       React.CSSProperties = { background:"rgba(255,255,255,.03)", border:"1px solid rgba(255,255,255,.08)", borderRadius:20, padding:"24px 22px", backdropFilter:"blur(12px)", display:"flex", flexDirection:"column", width:"100%" };
const overlay:      React.CSSProperties = { position:"fixed", inset:0, background:"rgba(0,0,0,.65)", backdropFilter:"blur(6px)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:100, padding:24 };
const modal:        React.CSSProperties = { background:"#0f172a", border:"1px solid rgba(255,255,255,.1)", borderRadius:20, padding:"28px 32px", width:"100%", maxWidth:420, display:"flex", flexDirection:"column", gap:16 };
const closeBtn:     React.CSSProperties = { background:"none", border:"none", color:"#94a3b8", fontSize:18, cursor:"pointer", padding:"2px 6px", borderRadius:6 };

/* ─── injected CSS (animations) ─────────────────────────────────────────── */
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=DM+Sans:wght@400;500;600&display=swap');

  .pd-ring {
    position:absolute; inset:-7px; border-radius:50%;
    border:2px solid #3b82f6;
    animation: pd-pulse 1.6s ease-out infinite;
  }
  @keyframes pd-pulse {
    0%   { opacity:1; transform:scale(1); }
    100% { opacity:0; transform:scale(1.22); }
  }
  .pd-bar {
    width:3px; height:6px; border-radius:3px;
    background:rgba(59,130,246,.3);
  }
  .pd-bar-active {
    background:#3b82f6;
    animation: pd-wave .7s ease-in-out infinite alternate;
  }
  @keyframes pd-wave {
    0%   { height:5px; }
    100% { height:28px; }
  }
  .pd-dot {
    display:inline-block; width:8px; height:8px; border-radius:50%;
    background:#22c55e; animation:pd-blink 1.2s ease-in-out infinite;
  }
  @keyframes pd-blink {
    0%,100% { opacity:1; } 50% { opacity:.2; }
  }
  .pd-btn-talk:hover { opacity:.88; transform:scale(1.02); transition:all .18s; }
  .pd-btn-end:hover  { background:rgba(239,68,68,.24) !important; transition:background .18s; }
  .pd-star:hover     { transform:scale(1.2) !important; transition:transform .12s; }
  ::-webkit-scrollbar       { width:4px; }
  ::-webkit-scrollbar-track { background:transparent; }
  ::-webkit-scrollbar-thumb { background:#334155; border-radius:4px; }
`;
