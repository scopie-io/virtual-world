import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import qrcode from 'qrcode-generator';
import { SHARE_FIELDS, type ShareField } from '../../shared/rules';
import { modal } from '../state';

export const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

export function Sheet({ k, title, gold, wide, onClose, children }: { k?: string; title?: string; gold?: boolean; wide?: boolean; onClose?: (() => void) | false; children: ComponentChildren }) {
  const close = onClose === false ? null : onClose ?? (() => (modal.value = null));
  return (
    <div class="scrim" onClick={(e) => e.target === e.currentTarget && close?.()}>
      <div class={'sheet' + (wide ? ' wider' : '')} role="dialog" aria-modal="true" aria-label={title}>
        {close && <button type="button" class="close" aria-label="Close" onClick={close}>×</button>}
        {k && <div class={'k' + (gold ? ' gold' : '')}>{k}</div>}
        {title && <h2>{title}</h2>}
        {children}
      </div>
    </div>
  );
}

export function Qr({ text, label }: { text: string; label: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const c = qrcode(0, 'M'); c.addData(text); c.make(); if (ref.current) ref.current.innerHTML = c.createSvgTag({ cellSize: 4, margin: 2, scalable: true }); }, [text]);
  return <div class="qr" ref={ref} role="img" aria-label={label} />;
}

const FIELD_LABEL: Record<ShareField, string> = { name: 'Name', company: 'Company', role: 'Role', phone: 'WhatsApp / phone', email: 'Email' };
/** Per-share consent: the person ticks exactly what goes across. Name always does. */
export function FieldPicker({ value, onChange }: { value: ShareField[]; onChange: (f: ShareField[]) => void }) {
  const toggle = (f: ShareField) => onChange(value.includes(f) ? value.filter((x) => x !== f) : [...value, f]);
  return (
    <div class="fields">
      {SHARE_FIELDS.map((f) => (
        <label key={f} class="check"><input type="checkbox" checked={f === 'name' || value.includes(f)} disabled={f === 'name'} onChange={() => toggle(f)} /><span>{FIELD_LABEL[f]}</span></label>
      ))}
    </div>
  );
}

export type Scan = { kind: 'host'; stationId: string; code: string } | { kind: 'beacon'; stationId: string; token: string } | { kind: 'link'; code: string };
/** Understands the three QR kinds the game prints, whether scanned in-app (full URL) or opened by the phone camera (query string). */
export function parseScan(text: string): Scan | null {
  let params: URLSearchParams;
  try { params = new URL(text.trim()).searchParams; } catch { params = new URLSearchParams(text.trim().replace(/^\?/, '')); }
  const h = params.get('h'), b = params.get('b'), l = params.get('l');
  if (h) return { kind: 'host', stationId: h.split('.')[0]!, code: h };
  if (b) return { kind: 'beacon', stationId: b.split('.')[0]!, token: b };
  if (l) return { kind: 'link', code: l.toUpperCase() };
  return null;
}

type Detector = { detect(s: CanvasImageSource): Promise<{ rawValue: string }[]> };
export function Camera({ onCode, onFail }: { onCode: (s: string) => void; onFail: (m: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    let stream: MediaStream | null = null, raf = 0, done = false;
    (async () => {
      try { stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false }); }
      catch { onFail('Camera unavailable here — scan with your phone camera app instead, or type the code.'); return; }
      if (done) { stream.getTracks().forEach((t) => t.stop()); return; }
      const v = video.current!; v.srcObject = stream; await v.play().catch(() => {});
      const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
      const native = BD ? new BD({ formats: ['qr_code'] }) : null;
      const jsQR = native ? null : (await import('jsqr')).default;
      const canvas = document.createElement('canvas'), g = canvas.getContext('2d', { willReadFrequently: true })!;
      const tick = async () => {
        if (done) return;
        if (v.readyState >= 2 && v.videoWidth) {
          let value = '';
          if (native) value = (await native.detect(v).catch(() => []))[0]?.rawValue ?? '';
          else if (jsQR) { canvas.width = 480; canvas.height = Math.round((480 * v.videoHeight) / v.videoWidth); g.drawImage(v, 0, 0, canvas.width, canvas.height); const d = g.getImageData(0, 0, canvas.width, canvas.height); value = jsQR(d.data, d.width, d.height)?.data ?? ''; }
          if (value) { done = true; onCode(value); return; }
        }
        raf = requestAnimationFrame(tick);
      };
      void tick();
    })();
    return () => { done = true; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); };
  }, []);
  return <video ref={video} class="cam" playsInline muted />;
}

/**
 * The server says "expires in N ms", relative to when that answer arrived. Pin it to a wall-clock deadline once per
 * answer — recomputing Date.now() + N on every render would freeze the countdown between refreshes.
 */
export function useDeadline(inMs: number | undefined, answer: unknown): number {
  return useMemo(() => Date.now() + (inMs ?? 0), [answer]);
}

/** Seconds remaining, re-rendering once a second. */
export function useCountdown(untilMs: number): number {
  const [, tick] = useState(0);
  useEffect(() => { const id = setInterval(() => tick((n) => n + 1), 1000); return () => clearInterval(id); }, []);
  return Math.max(0, Math.ceil((untilMs - Date.now()) / 1000));
}
