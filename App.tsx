
import React, { useState, useEffect, useRef } from 'react';
import { Ticket, TicketDetail, FreeField, AppView } from './types';
import { SlaBadge } from './components/SlaBadge';
import { geminiService } from './services/geminiService';
import { FF_LABEL, GOOGLE_SCRIPTS_URL, API_BASE } from './constants';

export default function App() {
  const [view, setView] = useState<AppView>(AppView.DASHBOARD);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [workflowStep, setWorkflowStep] = useState(0);

  // Close Ticket State
  const [closeOpen, setCloseOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [closeArticleTypes, setCloseArticleTypes] = useState<any[]>([]);
  const [closeStates, setCloseStates] = useState<any[]>([]);
  const [selectedStateId, setSelectedStateId] = useState("");
  const [selectedArticleTypeId, setSelectedArticleTypeId] = useState("");

  // GPS Tracking State
  const [startCoords, setStartCoords] = useState<{lat: number, lng: number} | null>(null);

  // Swipe logic references
  const touchStart = useRef<number | null>(null);
  const touchEnd = useRef<number | null>(null);

  // Free Fields state
  const [ffOpen, setFfOpen] = useState(false);
  const [ffForm, setFfForm] = useState<Record<string, string>>({});
  const [ffStep, setFfStep] = useState(0);
  const [ffSaving, setFfSaving] = useState(false);

  // AI State
  const [aiMessage, setAiMessage] = useState("");
  const [aiHistory, setAiHistory] = useState<{ role: 'user' | 'bot', text: string }[]>([]);
  const [aiLoading, setAiLoading] = useState(false);

  // --- API HANDLERS ---
  const handleLogin = async () => {
    setError("");
    try {
      const r = await fetch(`${API_BASE}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await r.json();
      if (data.success) setLoggedIn(true);
      else setError(data.message || "Neispravni podaci za prijavu");
    } catch (err) {
      setError(`Greška u konekciji: Provjerite da li middleware radi na ${API_BASE}`);
    }
  };

  const loadTickets = async () => {
    try {
      const r = await fetch(`${API_BASE}/api/my-tickets`);
      const data = await r.json();
      if (data.success) {
        // Map tickets to ensure SLA is captured case-insensitively if needed
        const mapped = data.tickets.map((t: any) => ({
          ...t,
          sla: t.sla || t.SLA || t.ServiceLevelAgreement || ""
        }));
        setTickets(mapped);
      }
    } catch {
      setError("Neuspješno učitavanje tiketa.");
    }
  };

  const checkWorkflowStatus = async (id: string) => {
    try {
      const r = await fetch(`${API_BASE}/api/ticket/${id}/freefields`);
      const data = await r.json();
      if (data.success) {
        const init: Record<string, string> = {};
        data.fields.forEach((f: FreeField) => init[f.name] = f.value || "");
        
        const isSet = (key: string) => ["1", "on", "yes", "true"].includes(String(init[key] || "").toLowerCase());
        
        if (isSet("DynamicField_endrouteUsed")) return 6;

        if (!isSet("DynamicField_startoftravelUsed")) return 0;
        else if (!isSet("DynamicField_endoftravelUsed")) return 1;
        else if (!isSet("DynamicField_startofworkUsed")) return 2;
        else if (!isSet("DynamicField_endofworkUsed")) return 3;
        else if (!isSet("DynamicField_startrouteUsed")) return 4;
        else return 5;
      }
    } catch {
      return 0;
    }
    return 0;
  };

  const openTicket = async (id: string) => {
    setSelectedId(id);
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/ticket/${id}`);
      const data = await r.json();
      if (data.success) {
        setDetail(data);
        const step = await checkWorkflowStatus(id);
        setWorkflowStep(step);
      }
    } catch {
      setError("Greška pri učitavanju detalja.");
    } finally {
      setLoading(false);
    }
  };

  const loadFreeFields = async (id: string) => {
    setLoading(true);
    try {
      const r = await fetch(`${API_BASE}/api/ticket/${id}/freefields`);
      const data = await r.json();
      if (data.success) {
        const init: Record<string, string> = {};
        data.fields.forEach((f: FreeField) => init[f.name] = f.value || "");
        setFfForm(init);

        const isSet = (key: string) => ["1", "on", "yes", "true"].includes(String(init[key] || "").toLowerCase());
        
        if (isSet("DynamicField_endrouteUsed")) setFfStep(6);
        else if (!isSet("DynamicField_startoftravelUsed")) setFfStep(0);
        else if (!isSet("DynamicField_endoftravelUsed")) setFfStep(1);
        else if (!isSet("DynamicField_startofworkUsed")) setFfStep(2);
        else if (!isSet("DynamicField_endofworkUsed")) setFfStep(3);
        else if (!isSet("DynamicField_startrouteUsed")) setFfStep(4);
        else setFfStep(5);

        // Only open modal after step is calculated to prevent "step 1" glitch
        setFfOpen(true);
      }
    } catch {
      setError("Neuspješno učitavanje workflow polja.");
    } finally {
      setLoading(false);
    }
  };

  const submitFF = async (base: string, extra: Record<string, string> = {}) => {
    setFfSaving(true);
    const now = new Date();
    const payload = {
      ...extra,
      [`DynamicField_${base}Used`]: "1",
      [`DynamicField_${base}Year`]: now.getFullYear().toString(),
      [`DynamicField_${base}Month`]: (now.getMonth() + 1).toString().padStart(2, '0'),
      [`DynamicField_${base}Day`]: now.getDate().toString().padStart(2, '0'),
      [`DynamicField_${base}Hour`]: now.getHours().toString().padStart(2, '0'),
      [`DynamicField_${base}Minute`]: now.getMinutes().toString().padStart(2, '0'),
    };

    try {
      const r = await fetch(`${API_BASE}/api/ticket/${selectedId}/freefields`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (data.success) {
        setFfOpen(false);
        if (selectedId) openTicket(selectedId);
      } else {
        setError(data.message || "Spremanje nije uspjelo");
      }
    } catch {
      setError("Greška pri slanju podataka.");
    } finally {
      setFfSaving(false);
    }
  };

  const openCloseDialog = async () => {
    if (!selectedId) return;
    setError("");
    setCloseOpen(true);
    setClosing(false);

    try {
      const url = `${API_BASE}/api/ticket/${selectedId}/state`;
      const r = await fetch(url);

      const ct = r.headers.get("content-type") || "";
      if (!ct.includes("application/json")) {
        setError("Backend nije vratio JSON za Change State.");
        return;
      }

      const data = await r.json();
      if (!data.success) {
        setError(data.message || "Failed to load state options");
        return;
      }

      const selects = data.selects || [];
      const article = selects.find((s: any) => s.name === "ArticleTypeID");
      const states = selects.find((s: any) => s.name === "NewStateID");

      const articleOpts = article?.options || [];
      const stateOpts = states?.options || [];

      setCloseArticleTypes(articleOpts);
      setCloseStates(stateOpts);

      // default: closed
      const closedOpt = stateOpts.find((o: any) => (o.text || "").toLowerCase() === "closed");
      if (closedOpt?.value) setSelectedStateId(String(closedOpt.value));

      // default: note-internal
      const internalOpt = articleOpts.find((o: any) => (o.text || "").toLowerCase().includes("note-internal"));
      if (internalOpt?.value) setSelectedArticleTypeId(String(internalOpt.value));
    } catch (e) {
      setError("Greška pri učitavanju Change State forme.");
    }
  };

  const submitClose = async () => {
    if (!selectedId) return;
    setClosing(true);
    setError("");

    try {
      const res = await fetch(`${API_BASE}/api/ticket/${selectedId}/state`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          newStateId: selectedStateId,
          articleTypeId: selectedArticleTypeId,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok || !data) {
        setError("Greška pri zatvaranju tiketa");
        return;
      }

      if (data.success === false) {
        setError(data.message || "Greška pri zatvaranju tiketa");
        return;
      }

      setCloseOpen(false);
      setSelectedId(null);
      setError("");
      await loadTickets();

    } catch (e) {
      setError("Greška pri zatvaranju tiketa");
    } finally {
      setClosing(false);
    }
  };

  const handleCloseTicket = () => {
    openCloseDialog();
  };

  const captureGPS = () => {
    return new Promise<{ lat: number; lng: number }>((resolve) => {
      if (!navigator.geolocation) {
        alert("GPS nije podržan na ovom uređaju.");
        return resolve({ lat: 0, lng: 0 });
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve({ lat: 0, lng: 0 }),
        { enableHighAccuracy: true }
      );
    });
  };

  const handleStartTravel = async () => {
    const coords = await captureGPS();
    setStartCoords(coords);
    await submitFF("startoftravel");
  };

  const handleEndTravel = async () => {
    const endCoords = await captureGPS();
    let calculatedKm = "";
    if (startCoords && endCoords.lat !== 0) {
      const dLat = (endCoords.lat - startCoords.lat) * 111;
      const dLng = (endCoords.lng - startCoords.lng) * 85; 
      const dist = Math.sqrt(dLat*dLat + dLng*dLng).toFixed(1);
      calculatedKm = dist;
    }
    await submitFF("endoftravel", { 
      DynamicField_Route: ffForm.DynamicField_Route || "",
      DynamicField_KM: calculatedKm 
    });
  };

  const sendAiQuery = async () => {
    if (!aiMessage.trim()) return;
    const msg = aiMessage;
    setAiMessage("");
    setAiHistory(prev => [...prev, { role: 'user', text: msg }]);
    setAiLoading(true);
    const context = detail ? `Klijent: ${detail.location?.name}, Kvar: ${detail.subject}. Opis: ${detail.articles[0]}` : "";
    const answer = await geminiService.getAiAdvice(msg, context);
    setAiHistory(prev => [...prev, { role: 'bot', text: answer }]);
    setAiLoading(false);
  };

  // --- GESTURE LOGIC ---
  const onTouchStart = (e: React.TouchEvent) => {
    touchEnd.current = null;
    touchStart.current = e.targetTouches[0].clientX;
  };
  const onTouchMove = (e: React.TouchEvent) => {
    touchEnd.current = e.targetTouches[0].clientX;
  };
  const onTouchEnd = () => {
    if (!touchStart.current || !touchEnd.current || selectedId) return;
    const distance = touchStart.current - touchEnd.current;
    const isLeftSwipe = distance > 70;
    const isRightSwipe = distance < -70;

    if (isLeftSwipe) {
      if (view === AppView.AI_HELPER) setView(AppView.DASHBOARD);
      else if (view === AppView.DASHBOARD) setView(AppView.EXTERNAL_APPS);
    }
    if (isRightSwipe) {
      if (view === AppView.EXTERNAL_APPS) setView(AppView.DASHBOARD);
      else if (view === AppView.DASHBOARD) setView(AppView.AI_HELPER);
    }
  };

  useEffect(() => {
    if (loggedIn) loadTickets();
  }, [loggedIn]);

  if (!loggedIn) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-slate-900">
        <div className="w-full max-w-md bg-white rounded-3xl p-8 shadow-2xl">
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg mb-4 animate-pulse">
               <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-800 tracking-tight">SPTS Login</h1>
            <p className="text-gray-400 text-xs mt-1">Backend: {API_BASE}</p>
          </div>
          <div className="space-y-4">
            <input className="w-full px-5 py-4 bg-gray-50 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 transition-all border" placeholder="Username" value={username} onChange={e => setUsername(e.target.value)} />
            <input className="w-full px-5 py-4 bg-gray-50 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 transition-all border" type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} />
            <button onClick={handleLogin} className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl shadow-lg active:scale-95 transition-all">PRIJAVI SE</button>
            {error && <div className="p-3 bg-red-50 text-red-600 text-center text-xs rounded-lg border border-red-100">{error}</div>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden select-none bg-gray-50 font-['Inter']" onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd}>
      {/* HEADER */}
      <header className="bg-white border-b px-6 py-4 flex items-center justify-between sticky top-0 z-10 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-md">
            <span className="text-white font-bold text-xs">SPTS</span>
          </div>
          <div>
            <h2 className="text-sm font-bold text-gray-800 leading-none">
              {view === AppView.AI_HELPER ? "AI POMOĆNIK" : view === AppView.EXTERNAL_APPS ? "PORTAL" : "DASHBOARD"}
            </h2>
            <div className="flex gap-1 mt-1.5">
              <div className={`w-1 h-1 rounded-full ${view === AppView.AI_HELPER ? 'bg-blue-600' : 'bg-gray-200'}`} />
              <div className={`w-1 h-1 rounded-full ${view === AppView.DASHBOARD ? 'bg-blue-600' : 'bg-gray-200'}`} />
              <div className={`w-1 h-1 rounded-full ${view === AppView.EXTERNAL_APPS ? 'bg-blue-600' : 'bg-gray-200'}`} />
            </div>
          </div>
        </div>
        <button className="text-gray-400 hover:text-gray-600 p-2 rounded-full" onClick={() => { loadTickets(); if(selectedId) openTicket(selectedId); }}>
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>
        </button>
      </header>

      {/* MAIN CONTENT */}
      <main className="flex-1 overflow-y-auto no-scrollbar relative">
        {selectedId ? (
          // --- DETALJI TIKETA ---
          <div className="p-4 space-y-4 animate-in fade-in duration-300">
            <button onClick={() => setSelectedId(null)} className="flex items-center gap-2 text-blue-600 font-bold py-2 active:scale-95">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"/></svg>
              NAZAD NA LISTU
            </button>

            {loading ? (
               <div className="flex flex-col items-center justify-center py-20 opacity-30">
                 <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin mb-2" />
                 <p className="text-xs font-bold">UČITAVANJE...</p>
               </div>
            ) : detail && (
              <div className="space-y-4 pb-10">
                {/* 1. SUBJECT CARD */}
                <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100">
                  <div className="flex justify-between items-start mb-4">
                    <span className="bg-blue-50 text-blue-600 text-[10px] font-bold tracking-widest px-2 py-1 rounded-md">#{detail.number}</span>
                    <SlaBadge sla={detail.ticket.sla} />
                  </div>
                  <h3 className="text-xl font-extrabold text-gray-900 leading-tight mb-2">
                    {detail.subject || detail.title}
                  </h3>
                  <div className="flex items-center gap-2 text-xs text-gray-400 font-medium">
                    <span>SLA: {detail.ticket.sla || "NO SLA"}</span>
                    <span>•</span>
                    <span>State: {detail.ticket.state}</span>
                  </div>
                </div>

                {/* 2. DESCRIPTION CARD */}
                <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100">
                  <h4 className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">Opis Problema</h4>
                  <div className="text-gray-700 text-sm leading-relaxed whitespace-pre-line italic">
                    NULL
                  </div>
                </div>

                {/* 3. PHONE CARD (Oblačić) */}
                {detail.location?.phone && (
                  <div className="bg-white rounded-3xl p-5 shadow-sm border border-gray-100 flex items-center justify-between">
                    <div>
                      <h4 className="text-[10px] font-black text-green-600 uppercase tracking-widest mb-1">Kontakt Telefon</h4>
                      <p className="text-gray-900 font-bold text-lg">{detail.location.phone}</p>
                    </div>
                    <a 
                      href={`tel:${detail.location.phone}`}
                      className="w-12 h-12 bg-green-500 text-white rounded-2xl flex items-center justify-center shadow-lg active:scale-95 transition-transform"
                    >
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z"/></svg>
                    </a>
                  </div>
                )}

                {/* 4. LOCATION CARD (Oblačić) */}
                {detail.location && (
                  <div className="bg-white rounded-3xl p-6 shadow-sm border border-gray-100">
                    <h4 className="text-[10px] font-black text-blue-500 uppercase tracking-widest mb-3">Lokacija Klijenta</h4>
                    <p className="text-gray-900 font-bold">{detail.location.name}</p>
                    <p className="text-gray-500 text-sm mb-4">{detail.location.street}, {detail.location.city}</p>
                    <a 
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${detail.location.street} ${detail.location.city}`)}`}
                      target="_blank"
                      className="flex items-center justify-center gap-2 py-3 bg-blue-50 text-blue-600 text-xs font-bold rounded-xl active:bg-blue-100 transition-colors"
                    >
                      OTVORI GOOGLE MAPE
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/></svg>
                    </a>
                  </div>
                )}

                {/* ACTION: WORKFLOW */}
                <button 
                  onClick={() => loadFreeFields(selectedId)}
                  className="w-full bg-blue-600 p-5 rounded-3xl text-white flex items-center justify-between shadow-xl active:scale-95 transition-all"
                >
                  <div className="text-left">
                    <p className="text-[10px] font-black opacity-60 uppercase tracking-widest">Akcija</p>
                    <p className="font-bold text-lg">POKRENI RADNI NALOG</p>
                  </div>
                  <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center">
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                  </div>
                </button>

                {/* CLOSE TICKET BUTTON */}
                {workflowStep >= 4 && workflowStep < 6 && (
                  <button 
                    onClick={handleCloseTicket}
                    className="w-full mt-4 bg-red-600 p-5 rounded-3xl text-white flex items-center justify-between shadow-xl active:scale-95 transition-all"
                  >
                    <div className="text-left">
                      <p className="text-[10px] font-black opacity-60 uppercase tracking-widest">Akcija</p>
                      <p className="font-bold text-lg">ZATVORI TIKET</p>
                    </div>
                    <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center">
                      <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg>
                    </div>
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          // --- DASHBOARD (Glavni Ekran) ---
          <div className="h-full">
            {view === AppView.AI_HELPER && (
              <div className="p-6 h-full flex flex-col animate-in slide-in-from-left duration-300">
                <div className="flex-1 space-y-4 mb-20 overflow-y-auto no-scrollbar">
                  {aiHistory.length === 0 && <div className="text-center py-10 opacity-30 italic text-sm">Ja sam tvoj SPTS asistent. Kako ti mogu pomoći oko današnjih tiketa?</div>}
                  {aiHistory.map((h, i) => (
                    <div key={i} className={`flex ${h.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                      <div className={`max-w-[85%] px-5 py-3 rounded-2xl text-sm ${h.role === 'user' ? 'bg-blue-600 text-white shadow-md' : 'bg-white border text-gray-800 shadow-sm'}`}>
                        {h.text}
                      </div>
                    </div>
                  ))}
                  {aiLoading && <div className="text-[10px] font-bold text-blue-600 animate-pulse tracking-widest ml-2">GEMINI RAZMIŠLJA...</div>}
                </div>
                <div className="fixed bottom-24 left-4 right-4 bg-white p-2 rounded-2xl border shadow-2xl flex gap-2 items-center">
                  <input className="flex-1 p-3 outline-none text-sm bg-transparent" placeholder="Pitaj nešto..." value={aiMessage} onChange={e => setAiMessage(e.target.value)} onKeyDown={e => e.key === 'Enter' && sendAiQuery()} />
                  <button onClick={sendAiQuery} className="w-11 h-11 bg-blue-600 rounded-xl flex items-center justify-center text-white shadow-lg">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"/></svg>
                  </button>
                </div>
              </div>
            )}

            {view === AppView.EXTERNAL_APPS && (
              <div className="p-6 space-y-6 animate-in slide-in-from-right duration-300">
                <div className="bg-white rounded-3xl p-8 border shadow-sm text-center">
                  <div className="w-20 h-20 bg-purple-50 text-purple-600 rounded-3xl flex items-center justify-center mx-auto mb-6">
                    <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
                  </div>
                  <h3 className="font-bold text-xl text-gray-900 mb-2">Google Scripts Portal</h3>
                  <p className="text-gray-500 text-sm mb-8 leading-relaxed">Eksterni alati za izvještaje i upravljanje stanjem na terenu.</p>
                  <a href={GOOGLE_SCRIPTS_URL} target="_blank" className="block w-full py-4 bg-purple-600 text-white font-bold rounded-2xl shadow-xl active:scale-95 transition-all">
                    OTVORI PORTAL
                  </a>
                </div>
              </div>
            )}

            {view === AppView.DASHBOARD && (
              <div className="p-4 space-y-3 animate-in fade-in duration-500">
                {tickets.length === 0 && <div className="text-center py-20 opacity-20 font-bold">NEMA AKTIVNIH TIKETA</div>}
                {tickets.map(t => (
                  <div key={t.id} onClick={() => openTicket(t.id)} className="bg-white rounded-[24px] p-5 shadow-sm border border-transparent hover:border-blue-100 active:bg-blue-50/30 active:scale-[0.98] transition-all flex items-center justify-between group">
                    <div className="flex-1 pr-4">
                      <div className="flex items-center gap-3 mb-2">
                        <span className="text-[10px] font-black text-gray-300 tracking-widest uppercase">#{t.number}</span>
                      </div>
                      <h4 className="text-[15px] font-bold text-gray-800 line-clamp-1 group-active:text-blue-700">{t.title}</h4>
                      <div className="flex items-center gap-2 mt-2">
                        <div className="px-2 py-0.5 bg-gray-100 rounded text-[9px] font-bold text-gray-500 uppercase">{t.queue}</div>
                        <span className="text-[10px] text-gray-300">•</span>
                        <span className="text-[10px] text-gray-400 font-medium">{t.age}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <SlaBadge sla={t.sla} />
                      <div className="w-8 h-8 rounded-full bg-gray-50 flex items-center justify-center group-hover:bg-blue-50 transition-colors">
                        <svg className="w-4 h-4 text-gray-300 group-hover:text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"/></svg>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* FOOTER NAV */}
      {!selectedId && (
        <nav className="bg-white border-t px-10 py-5 flex justify-between items-center z-50 rounded-t-[40px] shadow-[0_-10px_40px_rgba(0,0,0,0.04)]">
          <button onClick={() => setView(AppView.AI_HELPER)} className={`transition-all ${view === AppView.AI_HELPER ? 'text-blue-600 scale-110' : 'text-gray-300'}`}>
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
          </button>
          <button onClick={() => setView(AppView.DASHBOARD)} className={`transition-all ${view === AppView.DASHBOARD ? 'text-blue-600 scale-110' : 'text-gray-300'}`}>
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"/></svg>
          </button>
          <button onClick={() => setView(AppView.EXTERNAL_APPS)} className={`transition-all ${view === AppView.EXTERNAL_APPS ? 'text-blue-600 scale-110' : 'text-gray-300'}`}>
            <svg className="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/></svg>
          </button>
        </nav>
      )}

      {/* CLOSE TICKET OVERLAY */}
      {closeOpen && (
        <div className="fixed inset-0 bg-black/70 z-[100] p-6 flex items-center justify-center backdrop-blur-md">
          <div className="bg-white w-full max-w-lg rounded-[40px] overflow-hidden shadow-2xl animate-in zoom-in duration-300">
            <div className="p-8 relative">
              <button onClick={() => setCloseOpen(false)} className="absolute top-6 right-6 text-gray-300 hover:text-gray-900 transition-colors">
                 <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
              
              <h3 className="text-2xl font-bold text-gray-900 mb-6">Zatvori Tiket</h3>

              <div className="space-y-4">
                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-2">Status</label>
                  <select 
                    className="w-full p-4 bg-gray-50 rounded-2xl border-none shadow-sm outline-none focus:ring-2 focus:ring-blue-500 font-bold appearance-none"
                    value={selectedStateId}
                    onChange={e => setSelectedStateId(e.target.value)}
                  >
                    {closeStates.map(s => (
                      <option key={s.value} value={s.value}>{s.text}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-2">Tip Bilješke</label>
                  <select 
                    className="w-full p-4 bg-gray-50 rounded-2xl border-none shadow-sm outline-none focus:ring-2 focus:ring-blue-500 font-bold appearance-none"
                    value={selectedArticleTypeId}
                    onChange={e => setSelectedArticleTypeId(e.target.value)}
                  >
                    {closeArticleTypes.map(s => (
                      <option key={s.value} value={s.value}>{s.text}</option>
                    ))}
                  </select>
                </div>

                <button 
                  disabled={closing} 
                  onClick={submitClose} 
                  className="w-full py-5 bg-red-600 text-white font-bold rounded-2xl shadow-xl active:scale-95 transition-all mt-4"
                >
                  {closing ? "ZATVARANJE..." : "POTVRDI ZATVARANJE"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* WORKFLOW OVERLAY */}
      {ffOpen && (
        <div className="fixed inset-0 bg-black/70 z-[100] p-6 flex items-end justify-center backdrop-blur-md">
          <div className="bg-white w-full max-w-lg rounded-[40px] overflow-hidden shadow-2xl animate-in slide-in-from-bottom duration-500">
            <div className="p-10 relative">
              <button onClick={() => setFfOpen(false)} className="absolute top-8 right-8 text-gray-300 hover:text-gray-900 transition-colors">
                 <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"/></svg>
              </button>
              
              <h3 className="text-2xl font-bold text-gray-900 mb-2">Workflow Intervencije</h3>
              <p className="text-gray-400 text-[10px] font-bold uppercase tracking-widest mb-8">KORAK {ffStep + 1} OD 6</p>

              <div className="flex gap-1.5 mb-10">
                {[...Array(6)].map((_, i) => (
                  <div key={i} className={`h-1.5 flex-1 rounded-full transition-all duration-500 ${i <= ffStep ? 'bg-blue-600 shadow-[0_0_8px_rgba(37,99,235,0.4)]' : 'bg-gray-100'}`} />
                ))}
              </div>

              <div className="space-y-6">
                 {ffStep === 0 && (
                   <div className="text-center">
                     <div className="w-20 h-20 bg-blue-50 text-blue-600 rounded-[30px] flex items-center justify-center mx-auto mb-6 shadow-inner rotate-3">
                        <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
                     </div>
                     <p className="font-bold text-xl text-gray-900 tracking-tight">Kreni na lokaciju?</p>
                     <p className="text-gray-500 text-sm mt-2 px-6 font-medium leading-relaxed">Zabilježit ćemo GPS poziciju i vrijeme polaska.</p>
                     <button disabled={ffSaving} onClick={handleStartTravel} className="w-full mt-10 py-5 bg-blue-600 text-white font-bold rounded-2xl shadow-xl active:scale-95 transition-all">
                       {ffSaving ? "LOGIRANJE..." : "POTVRDI POLAZAK"}
                     </button>
                   </div>
                 )}

                 {ffStep === 1 && (
                   <div className="space-y-4">
                      <div className="bg-gray-50 p-6 rounded-3xl border border-dashed border-gray-200">
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-2">Ruta (Relacija)</label>
                        <input className="w-full p-4 bg-white rounded-2xl border-none shadow-sm outline-none focus:ring-2 focus:ring-blue-500 font-bold" placeholder="npr. Sarajevo - Tuzla" value={ffForm.DynamicField_Route || ""} onChange={e => setFfForm(p => ({...p, DynamicField_Route: e.target.value}))} />
                      </div>
                      <button disabled={ffSaving} onClick={handleEndTravel} className="w-full py-5 bg-blue-600 text-white font-bold rounded-2xl shadow-xl active:scale-95 transition-all">
                        {ffSaving ? "LOGIRANJE..." : "STIGAO NA LOKACIJU"}
                      </button>
                   </div>
                 )}

                 {ffStep === 2 && (
                    <div className="text-center">
                       <p className="font-bold text-xl mb-8 tracking-tight">Počni rad na site-u?</p>
                       <button onClick={() => submitFF("startofwork")} className="w-full py-5 bg-blue-600 text-white font-bold rounded-2xl shadow-xl">POČNI RAD</button>
                    </div>
                 )}

                 {ffStep === 3 && (
                   <div className="space-y-4">
                      <div className="bg-gray-50 p-6 rounded-3xl border border-dashed border-gray-200">
                        <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest block mb-2">Opis rješenja</label>
                        <textarea className="w-full p-4 bg-white rounded-2xl border-none shadow-sm outline-none focus:ring-2 focus:ring-blue-500 font-bold" rows={4} placeholder="Šta je urađeno?" value={ffForm.DynamicField_Solution || ""} onChange={e => setFfForm(p => ({...p, DynamicField_Solution: e.target.value}))} />
                      </div>
                      <button disabled={ffSaving} onClick={() => submitFF("endofwork", { DynamicField_Solution: ffForm.DynamicField_Solution })} className="w-full py-5 bg-blue-600 text-white font-bold rounded-2xl shadow-xl">ZAVRŠI RAD NA SITE-U</button>
                   </div>
                 )}

                 {ffStep === 4 && (
                    <button onClick={() => submitFF("startroute")} className="w-full py-5 bg-blue-600 text-white font-bold rounded-2xl shadow-xl">KRENI NAZAD</button>
                 )}

                 {ffStep === 5 && (
                   <div className="space-y-6">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="bg-gray-50 p-4 rounded-3xl">
                           <label className="text-[10px] font-bold text-gray-400 uppercase">Ukupno KM</label>
                           <input className="w-full bg-transparent border-b-2 border-blue-200 outline-none p-2 font-bold text-lg" type="number" value={ffForm.DynamicField_KM || ""} onChange={e => setFfForm(p => ({...p, DynamicField_KM: e.target.value}))} />
                        </div>
                        <div className="bg-gray-50 p-4 rounded-3xl">
                           <label className="text-[10px] font-bold text-gray-400 uppercase">Ruta KM</label>
                           <input className="w-full bg-transparent border-b-2 border-blue-200 outline-none p-2 font-bold text-lg" type="number" value={ffForm.DynamicField_endroutekm || ""} onChange={e => setFfForm(p => ({...p, DynamicField_endroutekm: e.target.value}))} />
                        </div>
                      </div>
                      <button disabled={ffSaving} onClick={() => submitFF("endroute", { DynamicField_KM: ffForm.DynamicField_KM, DynamicField_endroutekm: ffForm.DynamicField_endroutekm })} className="w-full py-5 bg-blue-600 text-white font-bold rounded-2xl shadow-xl">ZATVORI RADNI NALOG</button>
                   </div>
                 )}

                 {ffStep >= 6 && (
                   <div className="text-center py-10">
                      <div className="w-20 h-20 bg-green-50 text-green-600 rounded-full flex items-center justify-center mx-auto mb-8 animate-bounce">
                         <svg className="w-10 h-10" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"/></svg>
                      </div>
                      <h3 className="text-2xl font-bold mb-4 tracking-tight">Intervencija završena!</h3>
                      <button onClick={() => setFfOpen(false)} className="w-full py-5 bg-gray-900 text-white font-bold rounded-2xl active:scale-95 transition-all">NAZAD NA DASHBOARD</button>
                   </div>
                 )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
