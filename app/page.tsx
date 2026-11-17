"use client";

import { useEffect, useRef, useState } from "react";
import { blobToWav } from "@/lib/wav";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Lead = { id: number; isNew: boolean; [k: string]: any };
type Msg = { text: string; err?: boolean } | null;

function useRecorder() {
  const rec = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const [recording, setRecording] = useState(false);

  async function start() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const r = new MediaRecorder(stream);
    chunks.current = [];
    r.ondataavailable = (e) => chunks.current.push(e.data);
    r.start();
    rec.current = r;
    setRecording(true);
  }
  function stop(): Promise<Blob> {
    return new Promise((resolve) => {
      const r = rec.current!;
      r.onstop = async () => {
        r.stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        resolve(await blobToWav(new Blob(chunks.current, { type: r.mimeType })));
      };
      r.stop();
    });
  }
  return { recording, start, stop };
}

export default function Home() {
  const [key, setKey] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [caption, setCaption] = useState("");
  const [voice, setVoice] = useState<Blob | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [batches, setBatches] = useState<Lead[][]>([]);
  const photoRec = useRecorder(); // voice note recorded BEFORE scanning
  const batchRec = useRecorder(); // voice note recorded AFTER scanning (for the last batch)

  useEffect(() => setKey(localStorage.getItem("access-key") ?? ""), []);
  useEffect(() => {
    if (!file) return setPreview("");
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  const api = (path: string, init: RequestInit = {}) =>
    fetch(path, { ...init, headers: { ...(init.headers ?? {}), "x-access-key": key } });

  async function fail(res: Response) {
    const j = await res.json().catch(() => ({}));
    setMsg({ text: res.status === 401 ? "Wrong access key." : `❌ ${j.error ?? res.statusText}`, err: true });
  }

  async function scan() {
    if (!file) return;
    setBusy(true);
    setMsg({ text: "Reading card…" });
    try {
      const fd = new FormData();
      fd.append("image", file);
      fd.append("caption", caption);
      if (voice) fd.append("audio", voice, "voice.wav");
      const res = await api("/api/scan", { method: "POST", body: fd });
      if (!res.ok) return fail(res);
      const j = await res.json();
      if (!j.leads.length) return setMsg({ text: "⚠️ No readable contact info. Move closer / improve lighting.", err: true });
      setBatches((b) => [j.leads, ...b]);
      setMsg({
        text:
          `Extracted ${j.leads.length} record(s). ` +
          (j.synced ? "Saved to Google Sheets ✔" : "Saved locally – Sheets sync failed (use Sync).") +
          (j.voice ? `\n🎤 “${j.voice}”` : ""),
      });
      setFile(null);
      setCaption("");
      setVoice(null);
    } catch (e) {
      setMsg({ text: `❌ ${(e as Error).message}`, err: true });
    } finally {
      setBusy(false);
    }
  }

  async function toggleBatchVoice() {
    if (!batchRec.recording) return batchRec.start().catch(() => setMsg({ text: "Microphone permission denied.", err: true }));
    const wav = await batchRec.stop();
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("ids", JSON.stringify(batches[0].map((l) => l.id)));
      fd.append("audio", wav, "voice.wav");
      const res = await api("/api/note", { method: "POST", body: fd });
      if (!res.ok) return fail(res);
      const j = await res.json();
      setBatches((all) =>
        all.map((b, i) => (i ? b : b.map((l) => ({ ...l, notes: l.notes ? `${l.notes} | [Voice] ${j.text}` : `[Voice] ${j.text}` })))),
      );
      setMsg({ text: `🎤 Added to notes: “${j.text}”` });
    } finally {
      setBusy(false);
    }
  }

  async function togglePhotoVoice() {
    if (!photoRec.recording) return photoRec.start().catch(() => setMsg({ text: "Microphone permission denied.", err: true }));
    setVoice(await photoRec.stop());
  }

  async function exportXlsx() {
    const res = await api("/api/export");
    if (!res.ok) return fail(res);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(await res.blob());
    a.download = res.headers.get("Content-Disposition")?.match(/filename="(.+)"/)?.[1] ?? "leads.xlsx";
    a.click();
  }

  async function sync() {
    const res = await api("/api/sync", { method: "POST" });
    if (!res.ok) return fail(res);
    const j = await res.json();
    setMsg(j.ok ? { text: `Synced ${j.appended} rows + ${j.notes} notes ✔` } : { text: "Sync failed – check credentials.", err: true });
  }

  return (
    <main>
      <h1>📇 Exhibition Lead Scanner</h1>

      <div className="card">
        <input
          type="password"
          placeholder="Access key (if required)"
          value={key}
          onChange={(e) => {
            setKey(e.target.value);
            localStorage.setItem("access-key", e.target.value);
          }}
        />
      </div>

      <div className="card">
        {preview && <img className="preview" src={preview} alt="preview" />}
        <div className="row" style={{ marginBottom: 10 }}>
          <label className="btn">
            📷 Take / choose photo
            <input
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </label>
          <button className={photoRec.recording ? "rec" : "secondary"} onClick={togglePhotoVoice} disabled={busy}>
            {photoRec.recording ? "⏹ Stop" : voice ? "🎤 Re-record" : "🎤 Voice note"}
          </button>
        </div>
        {voice && <p className="badge">🎤 Voice note attached</p>}
        <textarea
          dir="auto"
          rows={2}
          placeholder="Caption / note for this lead (optional)"
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
        />
        <div className="row" style={{ marginTop: 10 }}>
          <button onClick={scan} disabled={!file || busy || photoRec.recording}>
            {busy ? "Working…" : "Scan"}
          </button>
        </div>
      </div>

      {msg && <div className={`msg ${msg.err ? "err" : ""}`}>{msg.text}</div>}

      {batches.length > 0 && (
        <div className="row" style={{ marginBottom: 14 }}>
          <button className={batchRec.recording ? "rec" : "secondary"} onClick={toggleBatchVoice} disabled={busy}>
            {batchRec.recording ? "⏹ Stop & add to last scan" : "🎤 Add voice note to last scan"}
          </button>
        </div>
      )}

      {batches.flat().map((l) => (
        <div className="card lead" key={`${l.id}-${l.scanned_at}`}>
          <h3 dir="auto">{[l.full_name_ar, l.full_name_en].filter(Boolean).join(" / ") || "—"}</h3>
          <span className={`badge ${l.isNew ? "" : "dup"}`}>{l.isNew ? "new" : "duplicate – skipped"}</span>
          <p dir="auto">🏢 {l.company_name || "—"}</p>
          <p dir="auto">🏷 {l.industry_category}</p>
          {l.job_title && <p dir="auto">💼 {l.job_title}</p>}
          {(l.primary_phone || l.secondary_phones) && (
            <p dir="ltr">📞 {[l.primary_phone, l.secondary_phones].filter(Boolean).join(" | ")}</p>
          )}
          {l.email && <p>✉️ {l.email}</p>}
          {l.website && <p>🌐 {l.website}</p>}
          {l.city_country && <p dir="auto">📍 {l.city_country}</p>}
          {l.notes && <p dir="auto">📝 {l.notes}</p>}
        </div>
      ))}

      <div className="row">
        <button className="secondary" onClick={exportXlsx}>📥 Export Excel</button>
        <button className="secondary" onClick={sync}>🔄 Sync Sheets</button>
      </div>
    </main>
  );
}
