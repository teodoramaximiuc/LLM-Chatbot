import React, { useEffect, useMemo, useRef, useState } from "react";

const API_BASE = import.meta.env.VITE_BOOK_API_BASE || "http://127.0.0.1:8000";
const AAI_KEY = import.meta.env.VITE_ASSEMBLYAI_API_KEY || ""; 

const LOGIN_URL = `${API_BASE}/login`;
const SIGNUP_URL = `${API_BASE}/signup`;
const CHAT_URL = `${API_BASE}/chat`;
const CHAT_LS_KEY = "chat_history_v1";
const clearChat = () => setChatHistory([]);

function useSpeechSynthesis() {
  const synthRef = useRef(window.speechSynthesis || null);
  const speak = (text) => {
    if (!synthRef.current) return;
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "en-US";
    synthRef.current.speak(utter);
  };
  return { speak, supported: !!synthRef.current };
}

async function aaiUploadAudio(blob) {
  const resp = await fetch("https://api.assemblyai.com/v2/upload", {
    method: "POST",
    headers: {
      Authorization: AAI_KEY,
    },
    body: blob,
  });
  if (!resp.ok) throw new Error(`AAI upload failed: ${resp.status}`);
  const data = await resp.json();
  return data.upload_url;
}

async function aaiCreateTranscript(audioUrl) {
  const resp = await fetch("https://api.assemblyai.com/v2/transcript", {
    method: "POST",
    headers: {
      "Authorization": AAI_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ audio_url: audioUrl, speech_model: "best" }),
  });
  if (!resp.ok) throw new Error(`AAI transcript create failed: ${resp.status}`);
  return await resp.json();
}

async function aaiPollTranscript(id, { timeoutMs = 90_000, intervalMs = 1500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const resp = await fetch(`https://api.assemblyai.com/v2/transcript/${id}`, {
      headers: { Authorization: AAI_KEY },
    });
    if (!resp.ok) throw new Error(`AAI transcript poll failed: ${resp.status}`);
    const data = await resp.json();
    if (data.status === "completed") return data.text;
    if (data.status === "error") throw new Error(data.error || "AAI error");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("AAI transcription timeout");
}

function classNames(...xs) {
  return xs.filter(Boolean).join(" ");
}

export default function App() {
  const [token, setToken] = useState(null);
  const [chatHistory, setChatHistory] = useState([]);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [showCover, setShowCover] = useState(true);
  const [pending, setPending] = useState(false);
  const [prompt, setPrompt] = useState("");

  const [loginUser, setLoginUser] = useState("");
  const [loginPass, setLoginPass] = useState("");
  const [suUser, setSuUser] = useState("");
  const [suPass, setSuPass] = useState("");

  const [activeAuthTab, setActiveAuthTab] = useState("login");

  const { speak, supported: ttsSupported } = useSpeechSynthesis();

  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);

  const authHeaders = useMemo(() => {
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [token]);

  const handleLogin = async () => {
    try {
      const r = await fetch(LOGIN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: loginUser, password: loginPass }),
      });
      if (!r.ok) throw new Error(`${r.status}`);
      const data = await r.json();
      setToken(data.access_token);
    } catch (e) {
      alert(`Login failed: ${e}`);
    }
  };

  const handleSignup = async () => {
    try {
      const r = await fetch(SIGNUP_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ name: suUser, password: suPass }),
      });
      if (!r.ok) throw new Error(`${r.status}`);
      alert("Signup successful. Please login.");
      setActiveAuthTab("login");
    } catch (e) {
      alert(`Signup failed: ${e}`);
    }
  };

  useEffect(() => {
    const saved = localStorage.getItem("auth_token");
    if (saved) setToken(saved);
  }, []);

  useEffect(() => {
    if (token) localStorage.setItem("auth_token", token);
    else localStorage.removeItem("auth_token");
  }, [token]);

  const logout = () => {
    setToken(null);
    setChatHistory([]);
  };
  
  // useEffect(() => {
  //   try {
  //     const raw = localStorage.getItem(CHAT_LS_KEY);
  //     if (!raw) return;
  //     const parsed = JSON.parse(raw);
  //     if (Array.isArray(parsed)) setChatHistory(parsed);
  //   } catch {}
  // }, []);

  // useEffect(() => {
  //   try {
  //     const light = chatHistory
  //       .filter(m => typeof m?.text === "string" && !m.text.startsWith("__IMG__"))
  //       .slice(-200);
  //     localStorage.setItem(CHAT_LS_KEY, JSON.stringify(light));
  //   } catch {}
  // }, [chatHistory]);

  const appendUser = (text) => setChatHistory((h) => [...h, { role: "user", text }]);
  const appendAssistant = (text) => setChatHistory((h) => [...h, { role: "assistant", text }]);

  const sendPrompt = async (finalPrompt, { echoUser = true, labelPrefix = "" } = {}) => {
    if (!finalPrompt?.trim()) return;

    if (echoUser) {
      const uiText = labelPrefix ? `${labelPrefix}${finalPrompt}` : finalPrompt;
      appendUser(uiText);
    }

    setPending(true);
    try {
      const r = await fetch(CHAT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({ prompt: finalPrompt, generate_image: showCover }),
      });
      if (!r.ok) throw new Error(`Server error: ${r.status}`);
      const data = await r.json();

      let reply = (data.message || "").trim();
      if (!reply) reply = "Hmm, I couldn't find a good match. Try specifying genre, tone, or audience.";
      appendAssistant(reply);

      if (ttsEnabled && ttsSupported && reply) speak(reply);

      const imageB64 = data.image_b64;
      if (showCover && imageB64) appendAssistant(`__IMG__${imageB64}`);
    } catch (e) {
      appendAssistant(`Error: ${e}`);
    } finally {
      setPending(false);
    }
  };

  const startRecording = async () => {
    if (!AAI_KEY) {
      alert("Missing VITE_ASSEMBLYAI_API_KEY env var.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream, { mimeType: "audio/webm" });
      recordedChunksRef.current = [];
      mr.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data);
      };
      mr.onstop = async () => {
        const blob = new Blob(recordedChunksRef.current, { type: "audio/webm" });
        try {
          const uploadUrl = await aaiUploadAudio(blob);
          const created = await aaiCreateTranscript(uploadUrl);
          const text = await aaiPollTranscript(created.id);
          if (text) {
            await sendPrompt(text, { echoUser: true, labelPrefix: "(Voice) " });
          }
        } catch (err) {
          appendAssistant(`Transcription failed: ${err}`);
        }
      };
      mediaRecorderRef.current = mr;
      mr.start();
      setIsRecording(true);
    } catch (e) {
      alert(`Mic permission / start error: ${e}`);
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach((t) => t.stop());
      setIsRecording(false);
    }
  };

  const toggleRecording = () => {
    if (isRecording) stopRecording(); else startRecording();
  };

  const userFromToken = useMemo(() => {
    if (!token) return null;
    try {
      return token.split(".")[0];
    } catch {
      return "user";
    }
  }, [token]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <div className="flex min-h-screen">
        {/* Sidebar */}
        <aside className="w-full sm:w-80 border-r border-gray-200 bg-white p-4 flex flex-col gap-4">
          <div>
            <h2 className="text-lg font-semibold">Account</h2>
            {token ? (
              <div className="mt-2 space-y-2">
                <div className="text-sm">User: <span className="font-mono break-all">{userFromToken}</span></div>
                <button onClick={logout} className="px-3 py-2 rounded-md bg-gray-900 text-white text-sm">Logout</button>
                {/* <button onClick={clearChat} className="px-3 py-2 rounded-md bg-gray-100">Clear chat</button> */}
              </div>
            ) : (
              <div className="mt-2">
                <div className="flex gap-2 mb-3">
                  <button onClick={() => setActiveAuthTab("login")} className={classNames("px-3 py-1 rounded-md text-sm", activeAuthTab === "login" ? "bg-gray-900 text-white" : "bg-gray-100")}>Login</button>
                  <button onClick={() => setActiveAuthTab("signup")} className={classNames("px-3 py-1 rounded-md text-sm", activeAuthTab === "signup" ? "bg-gray-900 text-white" : "bg-gray-100")}>Sign up</button>
                </div>
                {activeAuthTab === "login" ? (
                  <div className="space-y-2">
                    <label className="block text-sm">Username</label>
                    <input value={loginUser} onChange={(e) => setLoginUser(e.target.value)} className="w-full border rounded-md p-2" />
                    <label className="block text-sm">Password</label>
                    <input type="password" value={loginPass} onChange={(e) => setLoginPass(e.target.value)} className="w-full border rounded-md p-2" />
                    <button onClick={handleLogin} className="mt-2 w-full px-3 py-2 rounded-md bg-blue-600 text-white">Login</button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <label className="block text-sm">Username</label>
                    <input value={suUser} onChange={(e) => setSuUser(e.target.value)} className="w-full border rounded-md p-2" />
                    <label className="block text-sm">Password</label>
                    <input type="password" value={suPass} onChange={(e) => setSuPass(e.target.value)} className="w-full border rounded-md p-2" />
                    <button onClick={handleSignup} className="mt-2 w-full px-3 py-2 rounded-md bg-emerald-600 text-white">Create account</button>
                  </div>
                )}
              </div>
            )}
          </div>

          <hr />

          <div>
            <h2 className="text-lg font-semibold">Settings</h2>
            <label className="flex items-center gap-2 mt-2 text-sm">
              <input type="checkbox" checked={ttsEnabled} onChange={(e) => setTtsEnabled(e.target.checked)} />
              Speak replies (TTS)
            </label>
            {!ttsSupported && <p className="text-xs text-amber-600 mt-1">Browser TTS not supported.</p>}

            <label className="flex items-center gap-2 mt-2 text-sm">
              <input type="checkbox" checked={showCover} onChange={(e) => setShowCover(e.target.checked)} />
              Generate book covers
            </label>
          </div>

          <div className="mt-auto text-xs text-gray-500">Backend: {API_BASE}</div>
        </aside>

        {/* Main */}
        <main className="flex-1 flex flex-col">
          <header className="p-4 border-b bg-white">
            <h1 className="text-2xl font-bold">Smart Librarian <span className="align-middle">📙</span></h1>
            <p className="text-gray-500">RAG + GPT book recommendations with a friendly UI.</p>
          </header>

          {!token ? (
            <div className="p-6 text-sm text-gray-700">Please log in to start chatting.</div>
          ) : (
            <>
              {/* Chat history */}
              <div className="flex-1 overflow-auto p-4 space-y-4 pb-28">
                {chatHistory.map((m, idx) => (
                  <div key={idx} className={classNames("max-w-3xl", m.role === "user" ? "ml-auto" : "")}>
                    {m.text.startsWith("__IMG__") ? (
                      <img
                        src={`data:image/png;base64,${m.text.replace("__IMG__", "")}`}
                        alt="Suggested cover"
                        className="rounded-lg border max-w-xs" 
                      />
                    ) : (
                      <div className={classNames("rounded-2xl p-3 shadow-sm", m.role === "user" ? "bg-blue-50" : "bg-white border")}>{m.text}</div>
                    )}
                  </div>
                ))}
                {pending && <div className="text-sm text-gray-500">Thinking…</div>}
              </div>

              {/* Input */}
              <div className="fixed bottom-0 left-0 right-0 border-t bg-white p-3">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const msg = prompt.trim();
                    setPrompt("");
                    if (msg) sendPrompt(msg);
                  }}
                  className="max-w-3xl mx-auto flex items-center gap-2"
                >
                  <input
                    className="flex-1 border rounded-xl px-3 py-2"
                    placeholder="Type your question… (or tap the mic)"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    disabled={pending}
                  />
                  <button type="submit" className="px-4 py-2 rounded-xl bg-gray-900 text-white disabled:opacity-50" disabled={pending}>
                    Send
                  </button>

                  {/* Mic button inline with input */}
                  <button
                    type="button"
                    onClick={toggleRecording}
                    className="ml-2 px-4 py-2 rounded-full bg-white border border-gray-200 shadow-sm"
                    title={isRecording ? "Stop" : "Record"}
                  >
                    {isRecording ? "⏹️" : "🎤"}
                  </button>
                </form>
              </div>
            </>
          )}
        </main>
      </div>

      {/* Safe area padding */}
      <style>{`
        @supports (padding: max(0px)) {
          main { padding-bottom: max(16px, env(safe-area-inset-bottom)); }
        }
      `}</style>
    </div>
  );
}
