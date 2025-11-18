import React, { useEffect, useState } from "react";

// SharedCalendar - single-file React component
// Tailwind CSS assumed globally available in the host app.
// Features:
// - Month view calendar
// - Add / edit / delete events
// - Persist to localStorage
// - Create shareable link (encoded events in URL)
// - Export events to .ics file
// - Quick 'invite by email' (mailto)

export default function SharedCalendar() {
  const [today] = useState(new Date());
  const [viewDate, setViewDate] = useState(new Date());
  const [events, setEvents] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState(null);
  const [form, setForm] = useState({
    title: "",
    date: "",
    time: "09:00",
    duration: 60,
    description: "",
    attendees: "",
  });
  const STORAGE_KEY = "shared_calendar_events_v1";

  // load from localStorage or URL
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const shared = urlParams.get("shared");
    if (shared) {
      try {
        const decoded = JSON.parse(decodeURIComponent(atob(shared)));
        if (Array.isArray(decoded)) {
          setEvents(decoded.map(e => ({...e, id: e.id || cryptoRandomId()})));
          return;
        }
      } catch (e) {
        console.warn("Failed to load shared events", e);
      }
    }
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      try { setEvents(JSON.parse(raw)); } catch { /* ignore */ }
    }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
  }, [events]);

  function cryptoRandomId() {
    return Math.random().toString(36).slice(2, 9);
  }

  function startOfMonth(d) {
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }
  function endOfMonth(d) {
    return new Date(d.getFullYear(), d.getMonth() + 1, 0);
  }

  function prevMonth() { setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() - 1, 1)); }
  function nextMonth() { setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth() + 1, 1)); }
  function goToday() { setViewDate(new Date()); }

  function openNewModal(dateIso) {
    setEditingEvent(null);
    setForm({ title: "", date: dateIso, time: "09:00", duration: 60, description: "", attendees: "" });
    setModalOpen(true);
  }

  function openEditModal(ev) {
    const d = new Date(ev.start);
    const isoDate = d.toISOString().slice(0,10);
    const hhmm = d.toTimeString().slice(0,5);
    setEditingEvent(ev);
    setForm({ title: ev.title, date: isoDate, time: hhmm, duration: ev.duration || 60, description: ev.description || "", attendees: (ev.attendees || []).join(", ") });
    setModalOpen(true);
  }

  function saveEvent(e) {
    e.preventDefault();
    const start = new Date(form.date + "T" + form.time);
    const ev = {
      id: editingEvent ? editingEvent.id : cryptoRandomId(),
      title: form.title || "(bez názvu)",
      start: start.toISOString(),
      duration: Number(form.duration) || 60,
      description: form.description,
      attendees: form.attendees.split(",").map(s => s.trim()).filter(Boolean),
    };
    setEvents(prev => {
      if (editingEvent) return prev.map(p => p.id === ev.id ? ev : p);
      return [...prev, ev];
    });
    setModalOpen(false);
  }

  function deleteEvent(id) {
    if (!confirm("Vymazať udalosť?")) return;
    setEvents(prev => prev.filter(p => p.id !== id));
  }

  function eventsForDay(date) {
    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate()+1);
    return events.filter(ev => {
      const s = new Date(ev.start);
      return s >= dayStart && s < dayEnd;
    }).sort((a,b)=> new Date(a.start)-new Date(b.start));
  }

  function buildMonthGrid(d) {
    const first = startOfMonth(d);
    const last = endOfMonth(d);
    const startWeekDay = first.getDay(); // 0=Sun
    const days = [];
    // show full weeks (Sun-Sat)
    const gridStart = new Date(first);
    gridStart.setDate(first.getDate() - startWeekDay);
    for (let i = 0; i < 42; i++) {
      const cell = new Date(gridStart);
      cell.setDate(gridStart.getDate() + i);
      days.push(cell);
    }
    return days;
  }

  function makeShareLink() {
    const payload = btoa(encodeURIComponent(JSON.stringify(events)));
    const u = new URL(window.location.href);
    u.searchParams.set("shared", payload);
    return u.toString();
  }

  async function copyShareLink() {
    const link = makeShareLink();
    try { await navigator.clipboard.writeText(link); alert("Skopírované do schránky"); }
    catch { prompt("Kopíruj tento link ručne:", link); }
  }

  function exportICS() {
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//SharedCalendar/1.0//SK",
    ];
    for (const ev of events) {
      const start = new Date(ev.start);
      const dtstart = formatICSDatetime(start);
      const dtend = formatICSDatetime(new Date(start.getTime() + (ev.duration || 60)*60*1000));
      const uid = ev.id + "@sharedcalendar.local";
      lines.push("BEGIN:VEVENT");
      lines.push(`UID:${uid}`);
      lines.push(`DTSTAMP:${formatICSDatetime(new Date())}`);
      lines.push(`DTSTART:${dtstart}`);
      lines.push(`DTEND:${dtend}`);
      lines.push(`SUMMARY:${escapeICSText(ev.title)}`);
      if (ev.description) lines.push(`DESCRIPTION:${escapeICSText(ev.description)}`);
      if (ev.attendees && ev.attendees.length) lines.push(`ATTENDEE:${ev.attendees.join(", ")}`);
      lines.push("END:VEVENT");
    }
    lines.push("END:VCALENDAR");
    const blob = new Blob([lines.join("\r\n")], {type: 'text/calendar;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'shared-calendar.ics';
    document.body.appendChild(a); a.click(); a.remove();
    URL.revokeObjectURL(url);
  }

  function formatICSDatetime(d) {
    // UTC datetime in basic format
    const Y = d.getUTCFullYear();
    const M = String(d.getUTCMonth()+1).padStart(2,'0');
    const D = String(d.getUTCDate()).padStart(2,'0');
    const h = String(d.getUTCHours()).padStart(2,'0');
    const m = String(d.getUTCMinutes()).padStart(2,'0');
    const s = String(d.getUTCSeconds()).padStart(2,'0');
    return `${Y}${M}${D}T${h}${m}${s}Z`;
  }
  function escapeICSText(s='') { return s.replace(/\n/g,'\\n').replace(/,/g,'\,'); }

  function inviteByEmail(ev) {
    const start = new Date(ev.start);
    const to = (ev.attendees && ev.attendees.length) ? ev.attendees.join(",") : "";
    const subj = encodeURIComponent(ev.title);
    const body = encodeURIComponent(`${ev.title}\n${start.toLocaleString()} (${ev.duration || 60} min)\n\n${ev.description || ''}`);
    window.location.href = `mailto:${to}?subject=${subj}&body=${body}`;
  }

  const monthGrid = buildMonthGrid(viewDate);

  return (
    <div className="max-w-5xl mx-auto p-4">
      <header className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-semibold">Zdieľaný kalendár</h1>
          <p className="text-sm text-gray-600">Mesiac: {viewDate.toLocaleString(undefined,{month:'long', year:'numeric'})}</p>
        </div>
        <div className="flex gap-2">
          <button className="px-3 py-1 rounded shadow bg-white" onClick={prevMonth}>◀</button>
          <button className="px-3 py-1 rounded shadow bg-white" onClick={goToday}>Dnes</button>
          <button className="px-3 py-1 rounded shadow bg-white" onClick={nextMonth}>▶</button>
          <button className="px-3 py-1 rounded shadow bg-indigo-600 text-white" onClick={()=>openNewModal(new Date().toISOString().slice(0,10))}>Pridať udalosť</button>
          <button className="px-3 py-1 rounded shadow bg-white" onClick={copyShareLink}>Kopírovať link</button>
          <button className="px-3 py-1 rounded shadow bg-white" onClick={exportICS}>Export .ics</button>
        </div>
      </header>

      <div className="grid grid-cols-7 gap-1 text-sm">
        {['Ne','Po','Ut','St','Št','Pia','So'].map(d=> (
          <div key={d} className="text-center font-medium py-2">{d}</div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {monthGrid.map((date,i) => {
          const inMonth = date.getMonth() === viewDate.getMonth();
          const isToday = date.toDateString() === today.toDateString();
          const dayEvents = eventsForDay(date);
          return (
            <div key={i} className={`border rounded p-2 min-h-[90px] ${inMonth ? 'bg-white' : 'bg-gray-50'} ${isToday ? 'ring-2 ring-indigo-200' : ''}`}>
              <div className="flex justify-between items-start">
                <div className={`text-xs font-medium ${inMonth ? '' : 'text-gray-400'}`}>{date.getDate()}</div>
                <button className="text-[10px] px-2 py-0.5 bg-green-100 rounded" onClick={()=>openNewModal(date.toISOString().slice(0,10))}>+ pridať</button>
              </div>
              <div className="mt-1 space-y-1">
                {dayEvents.slice(0,4).map(ev=> (
                  <div key={ev.id} className="p-1 rounded bg-indigo-50 cursor-pointer" onClick={()=>openEditModal(ev)}>
                    <div className="text-[11px] font-semibold truncate">{ev.title}</div>
                    <div className="text-[10px] text-gray-600">{new Date(ev.start).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}</div>
                  </div>
                ))}
                {dayEvents.length > 4 && <div className="text-xs text-gray-500">+{dayEvents.length-4} ďalšie</div>}
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50">
          <form onSubmit={saveEvent} className="bg-white rounded-lg w-full max-w-lg p-6 shadow-lg">
            <h2 className="text-lg font-semibold mb-3">{editingEvent ? 'Upraviť udalosť' : 'Nová udalosť'}</h2>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col">
                <span className="text-xs text-gray-600">Názov</span>
                <input value={form.title} onChange={e=>setForm({...form, title:e.target.value})} className="border rounded p-2" required />
              </label>
              <label className="flex flex-col">
                <span className="text-xs text-gray-600">Dátum</span>
                <input type="date" value={form.date} onChange={e=>setForm({...form, date:e.target.value})} className="border rounded p-2" required />
              </label>
              <label className="flex flex-col">
                <span className="text-xs text-gray-600">Čas</span>
                <input type="time" value={form.time} onChange={e=>setForm({...form, time:e.target.value})} className="border rounded p-2" required />
              </label>
              <label className="flex flex-col">
                <span className="text-xs text-gray-600">Trvanie (min)</span>
                <input type="number" min={1} value={form.duration} onChange={e=>setForm({...form, duration:e.target.value})} className="border rounded p-2" />
              </label>
            </div>
            <label className="flex flex-col mt-3">
              <span className="text-xs text-gray-600">Popis</span>
              <textarea value={form.description} onChange={e=>setForm({...form, description:e.target.value})} className="border rounded p-2" rows={3} />
            </label>
            <label className="flex flex-col mt-3">
              <span className="text-xs text-gray-600">Účastníci (oddelení čiarkou - emaily)</span>
              <input value={form.attendees} onChange={e=>setForm({...form, attendees:e.target.value})} className="border rounded p-2" placeholder="ana@example.com, peter@example.com" />
            </label>

            <div className="flex justify-end gap-2 mt-4">
              {editingEvent && <button type="button" onClick={()=>{ deleteEvent(editingEvent.id); setModalOpen(false); }} className="px-3 py-1 rounded bg-red-100">Vymazať</button>}
              <button type="button" onClick={()=>setModalOpen(false)} className="px-4 py-2 rounded border">Zrušiť</button>
              <button type="submit" className="px-4 py-2 rounded bg-indigo-600 text-white">Uložiť</button>
            </div>
          </form>
        </div>
      )}

      {/* Small footer with share link preview */}
      <footer className="mt-6 text-sm text-gray-600">
        <div>Link pre zdieľanie (obsah kalendára bude zakódovaný v linku):</div>
        <div className="mt-1 flex gap-2">
          <input className="flex-1 border rounded p-2" readOnly value={makeShareLink()} />
          <button className="px-3 py-1 rounded bg-white" onClick={copyShareLink}>Kopírovať</button>
        </div>
      </footer>
    </div>
  );
}
