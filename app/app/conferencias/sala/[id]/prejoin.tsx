'use client';
import { useEffect, useRef, useState } from 'react';

type Pre = { audio: boolean; video: boolean; audioDeviceId?: string; videoDeviceId?: string };

/** 🎥 Vista previa antes de entrar: probar cámara y micrófono, elegir dispositivos y con qué entrar (como en Zoom). */
export function PreJoinCheck({ value, onChange }: { value: Pre; onChange: (v: Pre) => void }) {
  const [testing, setTesting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [mics, setMics] = useState<MediaDeviceInfo[]>([]);
  const [level, setLevel] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const raf = useRef(0);
  const ctx = useRef<AudioContext | null>(null);

  const stop = () => {
    cancelAnimationFrame(raf.current);
    stream.current?.getTracks().forEach((t) => t.stop()); stream.current = null;
    ctx.current?.close().catch(() => {}); ctx.current = null; setLevel(0);
  };
  useEffect(() => stop, []);
  const [tick, setTick] = useState(0);
  // El video aparece en pantalla después de activar la prueba: se conecta la cámara al mostrarse
  useEffect(() => {
    if (testing && video.current && stream.current && video.current.srcObject !== stream.current) {
      video.current.srcObject = stream.current; video.current.play().catch(() => {});
    }
  }, [testing, tick]);

  const start = async (v: Pre = value) => {
    stop(); setErr(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: v.videoDeviceId ? { deviceId: { exact: v.videoDeviceId } } : true,
        audio: v.audioDeviceId ? { deviceId: { exact: v.audioDeviceId }, noiseSuppression: true, echoCancellation: true } : { noiseSuppression: true, echoCancellation: true },
      });
      stream.current = s; setTesting(true); setTick((n) => n + 1);
      const devs = await navigator.mediaDevices.enumerateDevices();
      setCams(devs.filter((d) => d.kind === 'videoinput')); setMics(devs.filter((d) => d.kind === 'audioinput'));
      // Medidor del micrófono
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ac = new AC(); ctx.current = ac;
      const an = ac.createAnalyser(); an.fftSize = 512; ac.createMediaStreamSource(s).connect(an);
      const buf = new Uint8Array(an.frequencyBinCount);
      const tick = () => { an.getByteTimeDomainData(buf); let m = 0; for (const x of buf) m = Math.max(m, Math.abs(x - 128)); setLevel(Math.min(100, Math.round(m / 1.28))); raf.current = requestAnimationFrame(tick); };
      tick();
    } catch (e) {
      setTesting(false);
      setErr((e as Error).name === 'NotAllowedError' ? 'El navegador no dio permiso para la cámara o el micrófono: actívelo en el candado 🔒 junto a la dirección.' : 'No se encontró cámara o micrófono en este equipo.');
    }
  };
  const pick = (patch: Partial<Pre>) => { const v = { ...value, ...patch }; onChange(v); if (testing) start(v); };

  return (
    <div className="mt-4 rounded-xl border border-slate-200 p-3 text-left text-sm" data-testid="vista-previa">
      {testing ? (
        <>
          <video ref={video} muted playsInline className="aspect-video w-full -scale-x-100 rounded-lg bg-black object-cover" data-testid="video-previa" />
          <div className="mt-2 flex items-center gap-2"><span>🎙</span>
            <div className="h-2 flex-1 overflow-hidden rounded bg-slate-200"><div className="h-full bg-emerald-500 transition-[width]" style={{ width: `${level}%` }} data-testid="nivel-microfono" /></div></div>
          <p className="mt-1 text-xs text-slate-500">Hable: la barra verde debe moverse.</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {cams.length > 0 && <label className="block"><span className="text-xs font-semibold text-slate-600">Cámara</span>
              <select className="input py-1 text-xs" value={value.videoDeviceId ?? ''} onChange={(e) => pick({ videoDeviceId: e.target.value || undefined })}>
                <option value="">Predeterminada</option>{cams.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Cámara ${i + 1}`}</option>)}</select></label>}
            {mics.length > 0 && <label className="block"><span className="text-xs font-semibold text-slate-600">Micrófono</span>
              <select className="input py-1 text-xs" value={value.audioDeviceId ?? ''} onChange={(e) => pick({ audioDeviceId: e.target.value || undefined })}>
                <option value="">Predeterminado</option>{mics.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Micrófono ${i + 1}`}</option>)}</select></label>}
          </div>
          <button type="button" className="mt-2 text-xs underline" onClick={() => { stop(); setTesting(false); }}>Detener prueba</button>
        </>
      ) : (
        <button type="button" className="btn-secondary w-full" onClick={() => start()} data-testid="probar-dispositivos">🎥 Probar cámara y micrófono</button>
      )}
      {err && <p className="mt-2 text-xs text-red-700">{err}</p>}
      <div className="mt-3 flex flex-wrap gap-4">
        <label className="flex items-center gap-2"><input type="checkbox" checked={value.audio} onChange={(e) => onChange({ ...value, audio: e.target.checked })} data-testid="entrar-con-microfono" /> Entrar con micrófono encendido</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={value.video} onChange={(e) => onChange({ ...value, video: e.target.checked })} data-testid="entrar-con-camara" /> Entrar con cámara encendida</label>
      </div>
    </div>
  );
}
