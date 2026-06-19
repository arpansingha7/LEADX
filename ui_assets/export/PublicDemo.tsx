import { useEffect, useState, useCallback, useRef } from "react";
import { useParams } from "react-router-dom";
import { BASE } from "../api";
import logo from "../assets/logo-white.png";
import Vapi from "@vapi-ai/web";
import { Conversation } from "@elevenlabs/client";

/* ─────────────────────────────────────────────────────────────────────────
   Predixion AI — Public Voice Demo  (themable: dark default + light toggle)
   All backend integration points are IDENTICAL to the previous screen —
   only the presentation layer changed. See README.md.
   ───────────────────────────────────────────────────────────────────────── */

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
type Theme = "dark" | "light";

/* ─── orb colors, assigned to agents by index ───────────────────────────── */
const ORB_COLORS = ["blue", "emerald", "violet", "amber", "rose", "cyan"] as const;
/* pastel accents read best on dark; deeper "solid" accents read best on light */
const ACCENT: Record<string, string> = {
  blue: "#7CB8F7", emerald: "#6EE7B7", violet: "#C4B5FD", amber: "#FCD34D", rose: "#F9A8D4", cyan: "#67E8F9",
};
const SOLID: Record<string, string> = {
  blue: "#2563EB", emerald: "#10B981", violet: "#7C4DEC", amber: "#E0840A", rose: "#E03C8C", cyan: "#0BA3C0",
};
const orbColor = (i: number) => ORB_COLORS[i % ORB_COLORS.length];

/* Where "Contact us" sends people. */
const CONTACT_EMAIL = "harshal@predixion.ai";

const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

function Orb({ color, mode, small }: { color: string; mode?: "speaking" | "calm" | ""; small?: boolean }) {
  return (
    <div className={`pd-orb orb-${color}${small ? " sm" : ""}${mode ? " " + mode : ""}`}>
      <div className="r1" /><div className="r2" />
      <div className="sphere">
        <div className="bA" /><div className="bB" /><div className="bC" /><div className="sheen" />
      </div>
    </div>
  );
}

/* ─── component ─────────────────────────────────────────────────────────── */
export default function PublicDemo() {
  const { slug } = useParams<{ slug: string }>();

  const [theme, setTheme] = useState<Theme>(() => {
    try { return (localStorage.getItem("pdTheme") as Theme) || "dark"; } catch { return "dark"; }
  });
  useEffect(() => { try { localStorage.setItem("pdTheme", theme); } catch { /* ignore */ } }, [theme]);

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
  const [seconds, setSeconds]             = useState(0);

  const elevenLabsConvRef = useRef<any>(null);
  const vapiRef           = useRef<any>(null);

  /* ── subtle, classy click sound (Web Audio) ── */
  useEffect(() => {
    let ac: AudioContext | null = null;
    const onDown = (e: PointerEvent) => {
      const el = e.target as HTMLElement | null;
      if (!el || !el.closest || !el.closest("button, .pd-pill, .pd-star, a.pd-theme")) return;
      try {
        const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
        if (!AC) return;
        if (!ac) ac = new AC();
        if (ac!.state === "suspended") ac!.resume();
        const now = ac!.currentTime;
        // soft filtered-noise transient
        const dur = 0.05;
        const buf = ac!.createBuffer(1, Math.max(1, Math.floor(ac!.sampleRate * dur)), ac!.sampleRate);
        const ch = buf.getChannelData(0);
        for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / ch.length, 3.2);
        const src = ac!.createBufferSource(); src.buffer = buf;
        const bp = ac!.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1250; bp.Q.value = 0.55;
        const lp = ac!.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 2400;
        const ng = ac!.createGain(); ng.gain.setValueAtTime(0.085, now); ng.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
        src.connect(bp); bp.connect(lp); lp.connect(ng); ng.connect(ac!.destination);
        src.start(now);
        // warm low body
        const o = ac!.createOscillator(); o.type = "sine";
        o.frequency.setValueAtTime(190, now); o.frequency.exponentialRampToValueAtTime(146, now + 0.05);
        const g = ac!.createGain();
        g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(0.055, now + 0.007); g.gain.exponentialRampToValueAtTime(0.0001, now + 0.1);
        o.connect(g); g.connect(ac!.destination);
        o.start(now); o.stop(now + 0.1);
      } catch { /* audio unavailable */ }
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => { document.removeEventListener("pointerdown", onDown, true); if (ac && ac.close) { try { ac.close(); } catch { /* */ } } };
  }, []);

  /* ── call duration timer ── */
  useEffect(() => {
    if (!isConnected) return;
    setSeconds(0);
    const t = setInterval(() => setSeconds(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [isConnected]);

  /* ── load company + agents ── */
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
        setTranscript(p => [...p, { role: msg.source === "ai" ? "agent" : "user", text: msg.message }]);
      },
      onModeChange: ({ mode }: { mode: string }) => setAgentSpeaking(mode === "speaking"),
      onDisconnect: (details?: any) => { console.log("ElevenLabs onDisconnect:", details); handleCallEnded(); },
      onError: (msg: string) => { console.error("ElevenLabs error:", msg); setError("Call error. Please try again."); },
    });
    elevenLabsConvRef.current = conv;
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
    });
    vapi.on("call-end", () => handleCallEnded());
    vapi.on("error", (e: any) => { console.error("VAPI error:", e); setError("Call error. Please try again."); });

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

  /* ── poll for call summary after call ends (unchanged) ── */
  useEffect(() => {
    if (!callEnded || !sessionId || callSummary) return;
    let stopped = false;
    let attempts = 0;
    const maxAttempts = 20; // ~100s @ 5s

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
        const res = await fetch(url);
        const data = await res.json();
        if (data.success && data.summary) { setCallSummary(data.summary); stopped = true; }
      } catch { /* ignore */ }
      attempts++;
      if (attempts >= maxAttempts) stopped = true;
    };

    fetchSummary();
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
    setCallSummary(""); setSessionId(null); setVapiCallId(null); setElevenLabsConvId(null);
    setIsConnected(false); setError(""); setTranscript([]); setAgentSpeaking(false); setSeconds(0);
    elevenLabsConvRef.current = null; vapiRef.current = null;
  };

  /* "Contact us" → opens the visitor's mail client. */
  const openContact = () => {
    const subject = encodeURIComponent("AI Voice Agents — Demo Inquiry");
    const body = encodeURIComponent(
      "Hi Harshal,\n\nI just tried the Predixion AI voice demo and I'd like to learn more about AI voice agents for our business.\n\nA bit about us:\n- Company:\n- Use case(s):\n- Approx. call volume:\n- Timeline:\n\nThanks!"
    );
    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${subject}&body=${body}`;
  };

  const light = theme === "light";
  const accFor = (c: string) => (light ? SOLID[c] : ACCENT[c]);
  const chipStyle = (c: string): React.CSSProperties => {
    const a = accFor(c);
    return {
      fontSize: 9.5, fontWeight: 500, letterSpacing: ".14em", padding: "4px 11px", borderRadius: 999, whiteSpace: "nowrap",
      background: `color-mix(in srgb, ${a} 13%, transparent)`, color: a,
      border: `1px solid ${light ? a : `color-mix(in srgb, ${a} 28%, transparent)`}`,
    };
  };
  const talkStyle = (c: string): React.CSSProperties => {
    const a = accFor(c);
    return {
      background: light ? `color-mix(in srgb, ${a} 13%, transparent)` : "rgba(255,255,255,.03)",
      border: `1px solid ${light ? a : "rgba(255,255,255,.14)"}`, color: a, marginTop: 6,
    };
  };

  const clientInitials = (company?.name || "").trim().split(/\s+/).slice(0, 2).map(w => w[0] || "").join("").toUpperCase() || "–";

  /* chrome wrapper — a plain function (NOT a component) so inputs keep focus across renders */
  const wrap = (children: React.ReactNode) => (
    <div className="pd-root" data-pd-theme={theme} style={pg}>
      <style>{CSS}</style>
      <div style={sheenLine} />
      <div style={sheenWash} />
      <div style={grid} />
      <header className="pd-header" style={header}>
        <div className="pd-headinner" style={headInner}>
          <img src={logo} alt="Predixion AI" style={{ height: 62, width: "auto", filter: light ? "invert(1)" : "none" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <div className="pd-presented" style={{ textAlign: "right", display: "flex", flexDirection: "column", gap: 3 }}>
              <span className="mono" style={{ fontSize: 8.5, letterSpacing: ".2em", color: "var(--label2)" }}>PRESENTED FOR</span>
              <span className="pd-clientname" style={{ fontSize: 13.5, fontWeight: 600, color: "var(--client)", lineHeight: 1 }}>{company?.name || "—"}</span>
            </div>
            <div style={avatarChip}>
              <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: "var(--muted)", letterSpacing: ".02em" }}>{clientInitials}</span>
            </div>
          </div>
        </div>
      </header>
      <main className="pd-main" style={main}>{children}</main>
    </div>
  );

  /* theme toggle (sun / moon) */
  const ThemeToggle = (
    <div style={{ flex: "none", display: "flex", alignItems: "center", gap: 2, background: light ? "rgba(0,0,0,.04)" : "rgba(255,255,255,.05)", border: `1px solid ${light ? "rgba(0,0,0,.09)" : "rgba(255,255,255,.1)"}`, borderRadius: 999, padding: 3, marginTop: 4 }}>
      <button onClick={() => setTheme("light")} title="Light mode" aria-label="Light mode"
        style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 28, borderRadius: 999, border: "none", cursor: "pointer", transition: "color .15s",
          background: light ? "#FFFFFF" : "transparent", color: light ? "#15151B" : "#6E6E78", boxShadow: light ? "0 1px 3px rgba(0,0,0,.12)" : "none" }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
      </button>
      <button onClick={() => setTheme("dark")} title="Dark mode" aria-label="Dark mode"
        style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 32, height: 28, borderRadius: 999, border: "none", cursor: "pointer", transition: "color .15s",
          background: !light ? "rgba(255,255,255,.12)" : "transparent", color: !light ? "#EDEDF2" : "#9A9AA4" }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" /></svg>
      </button>
    </div>
  );

  /* ── loading ── */
  if (loading) return wrap(
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18, padding: "120px 0" }}>
      <div className="pd-spin" />
      <p className="mono" style={{ margin: 0, color: "var(--label)", fontSize: 11, letterSpacing: ".2em" }}>INITIALIZING DEMO…</p>
    </div>
  );

  /* ── error / unavailable ── */
  if ((error && !company) || (company && !company.is_published)) return wrap(
    <div style={errCard}>
      <div style={errBadge}>!</div>
      <h2 style={{ margin: "6px 0 0", fontSize: 18, fontWeight: 600, color: "var(--h2)" }}>This demo is unavailable</h2>
      <p style={{ margin: "0 0 6px", fontSize: 13.5, color: "var(--muted)", lineHeight: 1.6 }}>{error || "This demo is not currently published."}</p>
      <button className="pd-sec" onClick={() => window.location.reload()}>Try again</button>
    </div>
  );
  if (!company) return null;

  /* ── passcode gate ── */
  if (needsPasscode && !passcodeValid) {
    const checkPasscode = () => passcodeInput === company.passcode ? setPasscodeValid(true) : setError("Invalid passcode");
    return wrap(
      <div style={passcodeCard}>
        <div style={passcodeBadge}>α</div>
        <p className="mono" style={{ margin: "6px 0 0", fontSize: 10, letterSpacing: ".22em", color: "var(--label)" }}>PRIVATE ACCESS</p>
        <h1 style={{ margin: 0, fontSize: 21, fontWeight: 600, color: "var(--h2)", textAlign: "center" }}>Enter your passcode</h1>
        <p style={{ margin: "0 0 10px", color: "var(--muted)", fontSize: 13.5, textAlign: "center", lineHeight: 1.55 }}>Use the passcode you were given to start the conversation.</p>
        <input className="mono" style={passcodeInputStyle} type="password" placeholder="Passcode" autoFocus
          value={passcodeInput}
          onChange={e => { setPasscodeInput(e.target.value); setError(""); }}
          onKeyDown={e => { if (e.key === "Enter") checkPasscode(); }} />
        {error && <p style={errMsg} className="mono">{error.toUpperCase()}</p>}
        <button className="pd-prim" style={{ width: "100%" }} onClick={checkPasscode}>Continue ➜</button>
      </div>
    );
  }

  const selIdx = selectedAgent ? Math.max(0, agents.findIndex(a => a.id === selectedAgent.id)) : 0;
  const selColor = orbColor(selIdx);
  const inCall = isConnected || callEnded;

  return wrap(
    <>
      {/* ─── LANDING: agent cards ─── */}
      {!inCall && (
        <div style={{ width: "100%", maxWidth: 1040, display: "flex", flexDirection: "column" }}>
          <div className="pd-hero" style={{ padding: "44px 4px 30px", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 24 }}>
            <div style={{ minWidth: 0 }}>
              <p className="mono" style={{ margin: "0 0 12px", fontSize: 10.5, letterSpacing: ".22em", color: "var(--label)" }}>LIVE VOICE DEMO</p>
              <h1 className="pd-h1" style={{ margin: 0, fontSize: 30, fontWeight: 600, color: "var(--h1)", letterSpacing: "-.01em", lineHeight: 1.15 }}>
                {agents.length > 1 ? "Choose an agent to start a conversation" : "Start a conversation"}
              </h1>
              <p className="pd-sub" style={{ margin: "12px 0 0", fontSize: 15, color: "var(--muted)", lineHeight: 1.6, maxWidth: 560 }}>
                {agents.length > 1
                  ? "Pick a Predixion voice agent below and talk to it live, exactly the way your customers would."
                  : "Talk to this Predixion voice agent live, exactly the way your customers would."}
              </p>
            </div>
            {ThemeToggle}
          </div>

          {agents.length === 0 ? (
            <div style={{ ...errCard, maxWidth: 420 }}>
              <p className="mono" style={{ margin: 0, color: "var(--muted)", fontSize: 13 }}>No agents available.</p>
            </div>
          ) : (
            <div className="pd-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(248px,1fr))", gap: 18 }}>
              {agents.map((a, i) => {
                const c = orbColor(i);
                return (
                  <div key={a.id} className="pd-card" style={cardStyle}>
                    <Orb color={c} small />
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8, marginTop: 4 }}>
                      <h2 style={{ margin: 0, fontSize: 20, fontWeight: 600, color: "var(--h2)" }}>{a.name}</h2>
                      {a.objective && <span className="mono" style={chipStyle(c)}>{a.objective.toUpperCase()}</span>}
                    </div>
                    {a.description && <p style={{ margin: "2px 0 0", flex: 1, fontSize: 13, color: "var(--muted)", lineHeight: 1.6, textWrap: "pretty" as any }}>{a.description}</p>}
                    <button className="pd-talk" style={talkStyle(c)} onClick={() => { setSelectedAgent(a); setShowModal(true); }}>
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 7, verticalAlign: -2 }}><path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/><path d="M19 10v1a7 7 0 0 1-14 0v-1M12 18v4"/></svg>
                      Talk to {a.name}
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 13, padding: "42px 0 4px" }}>
            <p className="mono" style={{ margin: 0, fontSize: 10, letterSpacing: ".14em", color: "var(--label2)" }}>AI VOICE AGENTS FOR YOUR BUSINESS?</p>
            <button className="pd-prim" onClick={openContact}>Contact us ➜</button>
          </div>
        </div>
      )}

      {/* ─── CALL VIEW ─── */}
      {inCall && selectedAgent && (
        <div className={`pd-callwrap${callEnded ? " pd-twocol" : ""}`} style={{ width: "100%", display: "flex", gap: 18, marginTop: 36 }}>
          <div className="pd-callcard pd-callcol" style={callCard}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 32 }}>
              <Orb color={selColor} mode={isConnected ? (agentSpeaking ? "speaking" : "") : "calm"} />
            </div>

            <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 10, marginTop: 2 }}>
              <h2 style={{ margin: 0, fontSize: 25, fontWeight: 600, color: "var(--h2)", letterSpacing: ".005em" }}>{selectedAgent.name}</h2>
              {selectedAgent.objective && <span className="mono" style={chipStyle(selColor)}>{selectedAgent.objective.toUpperCase()}</span>}
            </div>

            {isConnected && (
              <>
                <p className="mono" style={{ margin: "16px 0 0", fontSize: 10.5, letterSpacing: ".16em", color: "var(--label)", height: 14, whiteSpace: "nowrap" }}>
                  {agentSpeaking ? `${selectedAgent.name.toUpperCase()} IS SPEAKING` : "LISTENING…"}
                </p>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16, width: "100%", marginTop: 18 }}>
                  <div className="mono" style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13, color: "var(--accent)", fontWeight: 500, letterSpacing: ".12em" }}>
                    <span className="pd-dot" /> {fmtTime(seconds)}
                  </div>
                  <button className="pd-end" onClick={endCall}>✕ End call</button>
                </div>
              </>
            )}

            {callEnded && (
              <div style={summaryBox}>
                <div className="mono" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, fontSize: 10.5, letterSpacing: ".18em", color: "var(--label)" }}>
                  <span style={{ color: "var(--accent)" }}>▦</span> CALL SUMMARY
                </div>
                {callSummary
                  ? <p style={{ margin: 0, fontSize: 14, lineHeight: 1.72, color: "var(--soft)", textWrap: "pretty" as any }}>{callSummary}</p>
                  : (
                    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                      <div className="pd-shimmer" style={{ width: "100%" }} />
                      <div className="pd-shimmer" style={{ width: "90%" }} />
                      <div className="pd-shimmer" style={{ width: "66%" }} />
                      <p className="mono" style={{ margin: "6px 0 0", fontSize: 10, letterSpacing: ".1em", color: "var(--label2)" }}>ANALYZING CONVERSATION…</p>
                    </div>
                  )}
              </div>
            )}

            {error && <p style={errMsg} className="mono">{error.toUpperCase()}</p>}
          </div>

          {/* FEEDBACK */}
          {callEnded && !feedbackSubmitted && (
            <div className="pd-fbcol" style={fbCard}>
              <p className="mono" style={{ margin: "0 0 4px", fontSize: 10, letterSpacing: ".18em", color: "var(--label)" }}>YOUR FEEDBACK</p>
              <p style={{ margin: "0 0 16px", fontSize: 17, fontWeight: 600, color: "var(--h2)" }}>How was your conversation?</p>
              <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
                {[1, 2, 3, 4, 5].map(s => (
                  <button key={s} className="pd-star" style={{ background: "none", border: "none", cursor: "pointer", padding: 0, lineHeight: 1 }} onClick={() => setRating(s)}>
                    <svg width="28" height="28" viewBox="0 0 24 24" fill={rating >= s ? "#F0B35B" : "none"} stroke={rating >= s ? "#F0B35B" : (light ? "#C7C7CF" : "#33333b")} strokeWidth="1.4">
                      <path d="M12 2l2.9 6.26 6.6.86-4.9 4.6 1.27 6.78L12 17.9 6.13 20.5 7.4 13.72 2.5 9.12l6.6-.86L12 2z" />
                    </svg>
                  </button>
                ))}
              </div>
              <label className="mono" style={{ fontSize: 10, fontWeight: 500, letterSpacing: ".12em", color: "var(--label)", marginBottom: 8 }}>TELL US MORE <span style={{ color: "var(--ph)" }}>(OPTIONAL)</span></label>
              <textarea style={{ ...inp, resize: "vertical", minHeight: 84, marginBottom: 14 } as React.CSSProperties}
                placeholder="What went well? What could be better?" value={feedback} onChange={e => setFeedback(e.target.value)} />
              <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", marginBottom: 16 }} onClick={() => setAnonymous(a => !a)}>
                <span style={{ width: 18, height: 18, borderRadius: 5, border: `1px solid ${anonymous ? (light ? "#0F0F12" : "#ECECF1") : "var(--border-in)"}`, background: anonymous ? (light ? "#0F0F12" : "#ECECF1") : "var(--input)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
                  {anonymous && <span style={{ color: light ? "#FFFFFF" : "#0A0A0D", fontSize: 12, fontWeight: 800 }}>✓</span>}
                </span>
                <span style={{ fontSize: 13, color: "var(--muted)" }}>Submit anonymously</span>
              </label>
              {!anonymous && (
                <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
                  <input style={inp} placeholder="Your name (optional)" value={userName} onChange={e => setUserName(e.target.value)} />
                  <input style={inp} placeholder="Your email (optional)" value={userEmail} onChange={e => setUserEmail(e.target.value)} />
                </div>
              )}
              <div className="pd-fbrow" style={{ display: "flex", gap: 11 }}>
                <button className="pd-sec pd-back" onClick={resetCall}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M11 18l-6-6 6-6" /></svg>
                  Back to agents
                </button>
                <button className="pd-prim" style={{ flex: 1 }} onClick={submitFeedback}>Submit feedback</button>
              </div>
            </div>
          )}

          {/* SUBMITTED */}
          {feedbackSubmitted && (
            <div className="pd-fbcol" style={{ ...fbCard, alignItems: "center", textAlign: "center", gap: 8 }}>
              <div style={successBadge}>✓</div>
              <p style={{ margin: "8px 0 0", fontSize: 17, fontWeight: 600, color: "var(--h2)" }}>Thank you for your feedback</p>
              <p style={{ margin: "0 0 12px", fontSize: 13.5, color: "var(--muted)", lineHeight: 1.6, maxWidth: 300 }}>We appreciate you trying the demo. Your input goes straight to our product team.</p>
              <button className="pd-prim" onClick={resetCall}>Back to agents</button>
            </div>
          )}
        </div>
      )}

      {/* ── Before-you-start modal ── */}
      {showModal && (
        <div style={overlay} onClick={() => setShowModal(false)}>
          <div style={modal} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className="mono" style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 11, letterSpacing: ".16em", color: "var(--muted)" }}>
                <span style={{ color: "var(--accent)" }}>ⓘ</span> BEFORE YOU START
              </span>
              <button className="pd-close" style={closeBtn} onClick={() => setShowModal(false)}>✕</button>
            </div>
            {["Allow microphone access when your browser prompts you.",
              "Close other apps that may be using your microphone.",
              "Find a quiet space — voice quality depends on your connection."].map((step, i) => (
              <div key={i} style={{ display: "flex", gap: 13, alignItems: "flex-start" }}>
                <span className="mono" style={stepNum}>{i + 1}</span>
                <span style={{ fontSize: 14, color: "var(--soft)", lineHeight: 1.55 }}>{step}</span>
              </div>
            ))}
            <button className="pd-prim" style={{ width: "100%" }} onClick={startCall}>Proceed ➜</button>
          </div>
        </div>
      )}
    </>
  );
}

/* ─── style constants (theme colors via CSS variables) ──────────────────── */
const pg:        React.CSSProperties = { minHeight: "100vh", position: "relative", display: "flex", flexDirection: "column", background: "var(--bg)", color: "var(--text)", fontFamily: "'Helvetica Neue',Helvetica,Arial,sans-serif", overflow: "hidden" };
const sheenLine: React.CSSProperties = { position: "absolute", top: 0, left: 0, right: 0, height: 1, background: "linear-gradient(90deg,transparent,var(--sheen-line),transparent)", pointerEvents: "none", zIndex: 6 };
const sheenWash: React.CSSProperties = { position: "absolute", top: 0, left: 0, right: 0, height: 240, background: "linear-gradient(180deg,var(--sheen-wash),transparent)", pointerEvents: "none", zIndex: 1 };
const grid:      React.CSSProperties = { position: "absolute", inset: 0, pointerEvents: "none", backgroundImage: "linear-gradient(var(--grid) 1px,transparent 1px),linear-gradient(90deg,var(--grid) 1px,transparent 1px)", backgroundSize: "46px 46px", WebkitMaskImage: "radial-gradient(ellipse 62% 50% at 50% 32%,#000 16%,transparent 72%)", maskImage: "radial-gradient(ellipse 62% 50% at 50% 32%,#000 16%,transparent 72%)", animation: "gridBreathe 14s ease-in-out infinite", zIndex: 0 };
const header:    React.CSSProperties = { position: "relative", zIndex: 5, flex: "none", padding: "0 32px", borderBottom: "1px solid var(--border-soft)" };
const headInner: React.CSSProperties = { maxWidth: 1040, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 4px" };
const avatarChip:React.CSSProperties = { width: 38, height: 38, borderRadius: 10, background: "var(--avatar)", border: "1px solid var(--border2)", display: "flex", alignItems: "center", justifyContent: "center", flex: "none", boxShadow: "inset 0 1px 0 var(--border-soft)" };
const main:      React.CSSProperties = { position: "relative", zIndex: 4, flex: 1, display: "flex", flexDirection: "column", alignItems: "center", padding: "0 32px 56px", width: "100%" };
const cardStyle: React.CSSProperties = { background: "var(--surface)", border: "1px solid var(--border2)", borderRadius: 18, padding: "30px 24px 26px", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 14 };
const callCard:  React.CSSProperties = { position: "relative", width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 20, padding: "24px 30px 32px", display: "flex", flexDirection: "column", alignItems: "center" };
const summaryBox:React.CSSProperties = { width: "100%", background: "var(--panel)", border: "1px solid var(--border)", borderRadius: 14, padding: 20, marginTop: 24 };
const fbCard:    React.CSSProperties = { width: "100%", background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 18, padding: 26, display: "flex", flexDirection: "column" };
const inp:       React.CSSProperties = { width: "100%", background: "var(--input)", border: "1px solid var(--border-in)", borderRadius: 10, padding: "12px 14px", color: "var(--text)", fontSize: 14, outline: "none", fontFamily: "'Helvetica Neue',Arial,sans-serif" };
const errCard:   React.CSSProperties = { width: "100%", maxWidth: 400, marginTop: 90, background: "var(--surface)", border: "1px solid var(--border2)", borderRadius: 16, padding: "38px 32px", display: "flex", flexDirection: "column", alignItems: "center", gap: 12, textAlign: "center" };
const errBadge:  React.CSSProperties = { width: 46, height: 46, borderRadius: 12, background: "rgba(244,63,94,.1)", border: "1px solid rgba(244,63,94,.35)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fda4af", fontSize: 22, fontWeight: 700 };
const errMsg:    React.CSSProperties = { margin: 0, fontSize: 11, letterSpacing: ".05em", color: "var(--err-fg)", background: "rgba(244,63,94,.08)", border: "1px solid rgba(244,63,94,.25)", borderRadius: 8, padding: "9px 14px", width: "100%", textAlign: "center", marginTop: 12 };
const passcodeCard: React.CSSProperties = { width: "100%", maxWidth: 392, marginTop: 80, background: "var(--panel)", border: "1px solid var(--border2)", borderRadius: 18, padding: "36px 32px", display: "flex", flexDirection: "column", alignItems: "center", gap: 14 };
const passcodeBadge: React.CSSProperties = { width: 50, height: 50, borderRadius: 13, background: "color-mix(in srgb, var(--accent) 12%, transparent)", border: "1px solid color-mix(in srgb, var(--accent) 30%, transparent)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent)", fontSize: 24, fontWeight: 600 };
const passcodeInputStyle: React.CSSProperties = { width: "100%", background: "var(--input)", border: "1px solid var(--border-in)", borderRadius: 10, padding: "13px 15px", color: "var(--text)", fontSize: 15, outline: "none", textAlign: "center", letterSpacing: ".35em" };
const overlay:   React.CSSProperties = { position: "fixed", inset: 0, background: "var(--overlay)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 22 };
const modal:     React.CSSProperties = { width: "100%", maxWidth: 430, background: "var(--panel)", border: "1px solid var(--border2)", borderRadius: 18, padding: "28px 30px", display: "flex", flexDirection: "column", gap: 18, boxShadow: "0 40px 110px -30px rgba(0,0,0,.45)" };
const closeBtn:  React.CSSProperties = { background: "none", border: "none", color: "var(--label)", cursor: "pointer", padding: 6, borderRadius: 8, display: "flex", fontSize: 15 };
const stepNum:   React.CSSProperties = { flex: "none", width: 25, height: 25, borderRadius: 7, background: "color-mix(in srgb, var(--accent) 12%, transparent)", color: "var(--accent)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 600 };
const successBadge: React.CSSProperties = { width: 50, height: 50, borderRadius: "50%", background: "rgba(62,207,142,.1)", border: "1px solid rgba(62,207,142,.35)", display: "flex", alignItems: "center", justifyContent: "center", color: "#3ECF8E", fontSize: 24 };

/* ─── injected CSS (theme tokens, fonts, orb, animations, hover, responsive) ── */
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&display=swap');
.mono{font-family:'IBM Plex Mono',monospace}
*{box-sizing:border-box}

/* ── theme tokens ── */
.pd-root[data-pd-theme="dark"]{
  --bg:#08080B; --text:#E9E9EE; --h1:#F1F1F5; --h2:#EDEDF2; --muted:#9A9AA3; --label:#6E6E78; --label2:#56565E; --soft:#C9C9D1; --client:#D9D9E0; --ph:#4a4a52; --accent:#7CB8F7; --err-fg:#fda4af;
  --surface:rgba(255,255,255,.018); --surface-hover:rgba(255,255,255,.028); --panel:#0D0D11; --input:#131318;
  --border:rgba(255,255,255,.07); --border2:rgba(255,255,255,.08); --border-soft:rgba(255,255,255,.06); --border-in:rgba(255,255,255,.12);
  --grid:rgba(255,255,255,.04); --sheen-line:rgba(255,255,255,.14); --sheen-wash:rgba(255,255,255,.035);
  --avatar:linear-gradient(145deg,#1c1c24,#121217); --scroll:#2A2A33; --overlay:rgba(5,5,8,.74);
  --prim-bg:#ECECF1; --prim-fg:#0A0A0D; --prim-bd:#ffffff; --prim-bg-h:#ffffff;
  --sec-bg:transparent; --sec-fg:#C9C9D1; --sec-bd:rgba(255,255,255,.14); --sec-bg-h:rgba(255,255,255,.06); --sec-bd-h:rgba(255,255,255,.24); --sec-fg-h:#EDEDF2;
  --end-bd:rgba(244,63,94,.38); --shimmer1:#131318; --shimmer2:#1d1d26;
}
.pd-root[data-pd-theme="light"]{
  --bg:#F6F7FA; --text:#1B1B22; --h1:#0E0E13; --h2:#15151B; --muted:#63636E; --label:#85858F; --label2:#9A9AA4; --soft:#43434D; --client:#2A2A32; --ph:#A8A8B2; --accent:#2563EB; --err-fg:#C53034;
  --surface:#FFFFFF; --surface-hover:#FBFBFD; --panel:#FFFFFF; --input:#FFFFFF;
  --border:rgba(0,0,0,.08); --border2:rgba(0,0,0,.09); --border-soft:rgba(0,0,0,.07); --border-in:rgba(0,0,0,.12);
  --grid:rgba(0,0,0,.05); --sheen-line:rgba(0,0,0,.10); --sheen-wash:rgba(0,0,0,.025);
  --avatar:linear-gradient(145deg,#FFFFFF,#EEEEF2); --scroll:#CFCFD6; --overlay:rgba(28,28,36,.42);
  --prim-bg:#0F0F12; --prim-fg:#FFFFFF; --prim-bd:#0F0F12; --prim-bg-h:#000000;
  --sec-bg:rgba(46,46,54,.05); --sec-fg:#2E2E36; --sec-bd:rgba(46,46,54,.8); --sec-bg-h:rgba(46,46,54,.12); --sec-bd-h:rgba(46,46,54,.95); --sec-fg-h:#1E1E24;
  --end-bd:rgba(214,58,63,.85); --shimmer1:#E7E7EC; --shimmer2:#F4F4F7;
}
/* smooth morph between themes */
.pd-root *{transition:background-color .32s ease, border-color .32s ease, color .32s ease, fill .32s ease, box-shadow .32s ease}

input::placeholder,textarea::placeholder{color:var(--ph)}
input:focus,textarea:focus{border-color:rgba(124,184,247,.5)!important;outline:none}

@keyframes orbIdle{0%,100%{transform:translateY(0)}50%{transform:translateY(-6px)}}
@keyframes orbSheen{from{transform:rotate(0)}to{transform:rotate(360deg)}}
@keyframes ringPulse{0%,100%{transform:scale(.96)}50%{transform:scale(1.05)}}
@keyframes gridBreathe{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.06);opacity:.55}}
@keyframes blobA{from{transform:translate(-10%,-6%) scale(1) rotate(0)}to{transform:translate(22%,18%) scale(1.2) rotate(40deg)}}
@keyframes blobB{from{transform:translate(8%,6%) scale(1.1)}to{transform:translate(-18%,-14%) scale(.9)}}
@keyframes blobC{from{transform:translate(0,0) scale(.9)}to{transform:translate(-25%,30%) scale(1.15)}}
@keyframes pdBlink{0%,100%{opacity:1}50%{opacity:.25}}
@keyframes pdSpin{to{transform:rotate(360deg)}}
@keyframes pdShimmer{0%{background-position:-220px 0}100%{background-position:220px 0}}

.pd-spin{width:34px;height:34px;border-radius:50%;border:2px solid rgba(124,184,247,.16);border-top-color:#7CB8F7;animation:pdSpin .9s linear infinite}
.pd-dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:#3ECF8E;box-shadow:0 0 9px #3ECF8E;animation:pdBlink 1.3s ease-in-out infinite}
.pd-shimmer{height:11px;border-radius:5px;background:linear-gradient(90deg,var(--shimmer1),var(--shimmer2),var(--shimmer1));background-size:440px 100%;animation:pdShimmer 1.3s linear infinite}

/* call view layout */
.pd-callwrap{justify-content:center;flex-direction:column;align-items:center;max-width:472px;margin-left:auto;margin-right:auto}
.pd-callcol{width:100%}
.pd-fbcol{width:100%}
.pd-callwrap.pd-twocol{max-width:912px;flex-direction:row;align-items:flex-start}
.pd-twocol .pd-callcol{flex:1 1 0;min-width:0;max-width:452px;width:auto}
.pd-twocol .pd-fbcol{flex:1 1 0;min-width:0;max-width:452px;width:auto;position:sticky;top:24px}
@media (max-width:840px){
  .pd-callwrap.pd-twocol{max-width:472px;flex-direction:column;align-items:center}
  .pd-twocol .pd-callcol,.pd-twocol .pd-fbcol{max-width:472px;width:100%;position:static}
}

/* ORB (base = dark; light variants below stay vivid) */
.pd-orb{position:relative;width:184px;height:184px;flex:none;animation:orbIdle 5.5s ease-in-out infinite}
.pd-orb.sm{width:108px;height:108px}
.pd-orb .r1{position:absolute;inset:-15px;border-radius:50%;border:1px solid var(--rc);opacity:0;animation:ringPulse 2.6s ease-in-out infinite;transition:opacity .6s ease}
.pd-orb .r2{position:absolute;inset:-30px;border-radius:50%;border:1px solid var(--rc2);opacity:0;animation:ringPulse 2.6s ease-in-out infinite .6s;transition:opacity .6s ease}
.pd-orb .sphere{position:relative;overflow:hidden;width:100%;height:100%;border-radius:50%;transition:box-shadow .5s ease,transform .5s ease,filter .5s ease}
.pd-orb .bA{position:absolute;width:75%;height:75%;left:0;top:0;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.62),transparent 65%);filter:blur(10px);animation:blobA 7s ease-in-out infinite alternate}
.pd-orb .bB{position:absolute;width:95%;height:95%;right:-18%;bottom:-18%;border-radius:50%;background:radial-gradient(circle,var(--oshadow),transparent 65%);filter:blur(12px);animation:blobB 9s ease-in-out infinite alternate}
.pd-orb .bC{position:absolute;width:55%;height:55%;left:42%;top:-8%;border-radius:50%;background:radial-gradient(circle,var(--ohi),transparent 65%);filter:blur(10px);animation:blobC 11s ease-in-out infinite alternate}
.pd-orb .sheen{position:absolute;inset:-25%;background:conic-gradient(from 0deg,transparent 0deg,rgba(255,255,255,.13) 30deg,transparent 75deg,transparent 195deg,rgba(255,255,255,.06) 230deg,transparent 270deg);animation:orbSheen 16s linear infinite}
.orb-blue{--rc:rgba(96,165,250,.5);--rc2:rgba(96,165,250,.2);--oshadow:rgba(15,35,80,.95);--ohi:rgba(147,197,253,.75)}
.orb-blue .sphere{background:radial-gradient(circle at 35% 30%,#BFDBFE 0%,#3B82F6 45%,#1E3A8A 80%,#0F2350 100%)}
.orb-blue.speaking .sphere{box-shadow:0 0 80px rgba(59,130,246,.5),0 0 26px rgba(59,130,246,.45)}
.orb-emerald{--rc:rgba(52,211,153,.5);--rc2:rgba(52,211,153,.2);--oshadow:rgba(2,56,43,.95);--ohi:rgba(110,231,183,.7)}
.orb-emerald .sphere{background:radial-gradient(circle at 35% 30%,#A7F3D0 0%,#10B981 45%,#065F46 80%,#02382B 100%)}
.orb-emerald.speaking .sphere{box-shadow:0 0 80px rgba(16,185,129,.55),0 0 26px rgba(16,185,129,.5)}
.orb-violet{--rc:rgba(167,139,250,.5);--rc2:rgba(167,139,250,.2);--oshadow:rgba(46,16,101,.95);--ohi:rgba(196,181,253,.72)}
.orb-violet .sphere{background:radial-gradient(circle at 35% 30%,#DDD6FE 0%,#8B5CF6 45%,#4C1D95 80%,#2E1065 100%)}
.orb-violet.speaking .sphere{box-shadow:0 0 80px rgba(139,92,246,.5),0 0 26px rgba(139,92,246,.5)}
.orb-amber{--rc:rgba(245,158,11,.5);--rc2:rgba(245,158,11,.2);--oshadow:rgba(69,26,3,.92);--ohi:rgba(253,230,138,.72)}
.orb-amber .sphere{background:radial-gradient(circle at 35% 30%,#FDE68A 0%,#F59E0B 45%,#92400E 80%,#451A03 100%)}
.orb-amber.speaking .sphere{box-shadow:0 0 80px rgba(245,158,11,.5),0 0 26px rgba(245,158,11,.5)}
.orb-rose{--rc:rgba(244,114,182,.5);--rc2:rgba(244,114,182,.2);--oshadow:rgba(80,7,36,.92);--ohi:rgba(251,207,232,.72)}
.orb-rose .sphere{background:radial-gradient(circle at 35% 30%,#FBCFE8 0%,#EC4899 45%,#9D174D 80%,#500724 100%)}
.orb-rose.speaking .sphere{box-shadow:0 0 80px rgba(236,72,153,.5),0 0 26px rgba(236,72,153,.5)}
.orb-cyan{--rc:rgba(34,211,238,.5);--rc2:rgba(34,211,238,.2);--oshadow:rgba(8,51,68,.92);--ohi:rgba(165,243,252,.72)}
.orb-cyan .sphere{background:radial-gradient(circle at 35% 30%,#A5F3FC 0%,#06B6D4 45%,#155E75 80%,#083344 100%)}
.orb-cyan.speaking .sphere{box-shadow:0 0 80px rgba(6,182,212,.5),0 0 26px rgba(6,182,212,.5)}
/* light: vivid spheres (colored shading instead of near-black) */
.pd-root[data-pd-theme="light"] .orb-blue{--oshadow:rgba(37,99,235,.45)}
.pd-root[data-pd-theme="light"] .orb-blue .sphere{background:radial-gradient(circle at 35% 30%,#BFDBFE 0%,#3B82F6 42%,#2563EB 74%,#1D4FD0 100%)}
.pd-root[data-pd-theme="light"] .orb-emerald{--oshadow:rgba(16,185,129,.45)}
.pd-root[data-pd-theme="light"] .orb-emerald .sphere{background:radial-gradient(circle at 35% 30%,#A7F3D0 0%,#10B981 42%,#0EA372 74%,#0B8A60 100%)}
.pd-root[data-pd-theme="light"] .orb-violet{--oshadow:rgba(124,77,236,.45)}
.pd-root[data-pd-theme="light"] .orb-violet .sphere{background:radial-gradient(circle at 35% 30%,#DDD6FE 0%,#8B5CF6 42%,#7C4DEC 74%,#6A3BE0 100%)}
.pd-root[data-pd-theme="light"] .orb-amber{--oshadow:rgba(224,132,10,.45)}
.pd-root[data-pd-theme="light"] .orb-amber .sphere{background:radial-gradient(circle at 35% 30%,#FDE68A 0%,#F59E0B 42%,#E0840A 74%,#C9760A 100%)}
.pd-root[data-pd-theme="light"] .orb-rose{--oshadow:rgba(224,60,140,.45)}
.pd-root[data-pd-theme="light"] .orb-rose .sphere{background:radial-gradient(circle at 35% 30%,#FBCFE8 0%,#EC4899 42%,#E03C8C 74%,#D1327E 100%)}
.pd-root[data-pd-theme="light"] .orb-cyan{--oshadow:rgba(11,163,192,.45)}
.pd-root[data-pd-theme="light"] .orb-cyan .sphere{background:radial-gradient(circle at 35% 30%,#A5F3FC 0%,#06B6D4 42%,#0BA3C0 74%,#0C8EA8 100%)}
.pd-orb.speaking .r1,.pd-orb.speaking .r2{opacity:1}
.pd-orb.speaking .sphere{transform:scale(1.05)}
.pd-orb.calm .sphere{transform:scale(.92);filter:saturate(.92) brightness(.92)}

/* buttons */
.pd-prim{transition:all .18s ease;background:var(--prim-bg);color:var(--prim-fg);border:1px solid var(--prim-bd);border-radius:10px;padding:12px 22px;font-size:13.5px;font-weight:600;cursor:pointer;font-family:'Helvetica Neue',Arial,sans-serif;letter-spacing:.012em;display:inline-flex;align-items:center;justify-content:center;gap:9px;white-space:nowrap}
.pd-prim:hover{background:var(--prim-bg-h);transform:translateY(-1px);box-shadow:0 10px 26px -14px rgba(0,0,0,.45)}
.pd-prim:active{transform:translateY(0)}
.pd-talk{transition:all .18s ease;border-radius:9px;padding:9px 18px;font-size:12.5px;font-weight:500;cursor:pointer;font-family:'Helvetica Neue',Arial,sans-serif;letter-spacing:.02em;display:inline-flex;align-items:center;justify-content:center;gap:8px;white-space:nowrap}
.pd-talk:hover{transform:translateY(-1px);filter:brightness(1.05)}
.pd-sec{transition:all .18s ease;background:var(--sec-bg);border:1px solid var(--sec-bd);border-radius:10px;padding:11px 20px;color:var(--sec-fg);font-size:13px;font-weight:500;cursor:pointer;font-family:'Helvetica Neue',Arial,sans-serif;letter-spacing:.012em;display:inline-flex;align-items:center;justify-content:center;gap:8px;white-space:nowrap}
.pd-sec:hover{background:var(--sec-bg-h);border-color:var(--sec-bd-h);color:var(--sec-fg-h)}
.pd-back{background:#2B2B33;border-color:#2B2B33;color:#EDEDF2}
.pd-back:hover{background:#3A3A44;border-color:#3A3A44;color:#FFFFFF;transform:translateY(-1px)}
.pd-end{transition:all .18s ease;background:rgba(244,63,94,.09);border:1px solid var(--end-bd);border-radius:10px;padding:11px 24px;color:var(--err-fg);font-size:13.5px;font-weight:600;cursor:pointer;font-family:'Helvetica Neue',Arial,sans-serif;letter-spacing:.012em;display:inline-flex;align-items:center;justify-content:center;gap:9px;white-space:nowrap}
.pd-end:hover{background:rgba(244,63,94,.16);transform:translateY(-1px)}
.pd-card{transition:border-color .2s ease,transform .2s ease,background .2s ease;box-shadow:inset 0 1px 0 var(--border-soft)}
.pd-card:hover{border-color:var(--sec-bd);background:var(--surface-hover);transform:translateY(-3px)}
.pd-star:hover{transform:scale(1.16)}
.pd-close:hover{background:var(--sec-bg-h);color:var(--h2)}
.pd-theme:hover{filter:brightness(1.1)}
::-webkit-scrollbar{width:8px;height:8px}
::-webkit-scrollbar-track{background:transparent}
::-webkit-scrollbar-thumb{background:var(--scroll);border-radius:4px}

/* responsive */
@media (max-width:680px){
  .pd-header{padding-left:18px!important;padding-right:18px!important}
  .pd-headinner{padding-top:15px!important;padding-bottom:15px!important}
  .pd-header img{height:44px!important}
  .pd-presented{display:none!important}
  .pd-main{padding-left:18px!important;padding-right:18px!important}
  .pd-hero{padding:30px 0 22px!important}
  .pd-h1{font-size:23px!important}
  .pd-sub{font-size:14px!important}
  .pd-grid{grid-template-columns:1fr!important}
  .pd-callcard{padding-left:20px!important;padding-right:20px!important}
  .pd-orb{width:152px!important;height:152px!important}
  .pd-fbrow{flex-direction:column-reverse!important}
  .pd-fbrow>*{width:100%!important}
}
@media (max-width:380px){
  .pd-clientname{max-width:108px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
}
`;
