import React, { useState, useRef, useEffect } from 'react';

// ============================================================
// NORMATIVA
// ============================================================

const NORM = {
  nome: "NTPA 001/2002 - Romania",
  limiti: { BOD5: 25, COD: 125, SST: 35, N_tot: 15, P_tot: 2 },
  bio: { theta_c_min: 10, theta_c_max: 20, Y: 0.6, Kd: 0.05, MLSS_min: 2500, MLSS_max: 4500, FM_min: 0.05, FM_max: 0.15 },
  disinf: { CT_min: 30, cl_min: 0.5 },
  AE: { BOD5: 60, COD: 120, SST: 70, N: 11, P: 2.5, Q: 200 },
};

// ============================================================
// PALETTE
// ============================================================

const C = {
  bg: '#0f1318',
  panel: '#161b22',
  border: '#21262d',
  blue: '#2f81f7',
  green: '#3fb950',
  amber: '#d29922',
  red: '#f85149',
  purple: '#a371f7',
  text: '#e6edf3',
  textMid: '#8b949e',
};

const mono: React.CSSProperties = {
  fontFamily: "'SF Mono', 'Fira Code', 'Fira Mono', 'Roboto Mono', monospace",
};

// ============================================================
// HELPERS
// ============================================================

function fmt(v: number | undefined | null, dec = 2): string {
  if (v === undefined || v === null || isNaN(v as number) || !isFinite(v as number)) return '—';
  return (v as number).toFixed(dec);
}

function calcVol(L: number, l: number, h: number): number {
  return L * l * h;
}

function safeDiv(a: number, b: number): number {
  if (!b || b === 0 || isNaN(b) || !isFinite(b)) return NaN;
  return a / b;
}

// ============================================================
// TYPES
// ============================================================

interface DatiState {
  nome: string;
  localita: string;
  beneficiario: string;
  progettista: string;
}

interface PortateState {
  modalita: 'AE' | 'DIRETTA';
  AE: number;
  Q_dir: number;
  Kd: number;
  Kh: number;
  override_Q: boolean;
  Q_override: number;
  BOD5: number;
  COD: number;
  SST: number;
  N: number;
  P: number;
}

interface DimsState {
  L: number;
  l: number;
  h: number;
}

interface OmogenState {
  dims: DimsState;
  t_accumulo: number;
  n_mixer: number;
  w_mixer: number;
}

interface DenitriState {
  dims: DimsState;
  N_out_target: number;
  n_mixer: number;
  w_mixer: number;
}

interface SBRState {
  dims: DimsState;
  n_reattori: number;
  MLSS: number;
  SRT: number;
  n_diffusori: number;
  portata_diffusore: number;
  t_fill: number;
  t_react: number;
  t_sedim: number;
  t_decant: number;
  t_idle: number;
}

interface DisinfState {
  dims: DimsState;
  c_cloro: number;
  t_contatto: number;
}

// ============================================================
// TIPI IDRAULICA
// ============================================================

type ConTipo = 'condotta' | 'stramazzo' | 'comunicante';

interface ConDef {
  id: string;
  from: string;
  to: string;
  tipo: ConTipo;
  // condotta (pipe)
  D_mm: number;
  L_m: number;
  n_mann: number;
  z_up: number;
  z_dn: number;
  // stramazzo (weir)
  z_soglia: number;
  B_weir: number;
  // comunicante (connected wall opening)
  z_fin: number;
  h_fin: number;
  b_fin: number;
}

interface NodeOverride {
  x: number;
  y: number;
  z_fondo: number;
}

interface IdraulicaState {
  overrides: Record<string, NodeOverride>;
  connections: ConDef[];
}

interface ConResult {
  id: string;
  tipo: ConTipo;
  ok: boolean;
  detail: string;
  Q_cap?: number;
  v?: number;
  H_weir?: number;
  dH?: number;
}

interface Scene3DNode {
  id: string;
  nome: string;
  color: string;
  x: number;
  y: number;
  z: number;
  L: number;
  l: number;
  h: number;
}

interface Scene3DCon {
  from: [number, number, number];
  to: [number, number, number];
  tipo: ConTipo;
}

// ============================================================
// CALCOLI PURI
// ============================================================

function calcPortate(p: PortateState) {
  const Q_med = p.modalita === 'AE' ? p.AE * NORM.AE.Q / 1000 : p.Q_dir;
  const Q_max_g = Q_med * p.Kd;
  const Q_max_h = safeDiv(Q_med, 24) * p.Kh;
  const Q_calc = p.override_Q ? p.Q_override : Q_max_h;
  return { Q_med, Q_max_g, Q_max_h, Q_calc };
}

function calcOmogen(o: OmogenState, Q_med: number) {
  const V_fisico = calcVol(o.dims.L, o.dims.l, o.dims.h);
  const Q_h = safeDiv(Q_med, 24);
  const V_necessario = Q_h * o.t_accumulo * 1.2;
  const HRT = safeDiv(V_fisico, Q_h);
  const P_mixer_tot = V_fisico * o.w_mixer / 1000;
  const P_per_mixer = safeDiv(P_mixer_tot, o.n_mixer);
  return { V_fisico, V_necessario, HRT, P_mixer_tot, P_per_mixer };
}

function calcDenitri(d: DenitriState, Q_med: number, N_in: number) {
  const V_fisico = calcVol(d.dims.L, d.dims.l, d.dims.h);
  const Q_h = safeDiv(Q_med, 24);
  const HRT = safeDiv(V_fisico, Q_h);
  const dN = N_in - d.N_out_target;
  const N_rimosso = Q_med * dN / 1000;
  const P_mixer_tot = V_fisico * d.w_mixer / 1000;
  const P_per_mixer = safeDiv(P_mixer_tot, d.n_mixer);
  return { V_fisico, HRT, dN, N_rimosso, P_mixer_tot, P_per_mixer };
}

function calcSBR(s: SBRState, Q_med: number, BOD5_in: number) {
  const V_singolo = calcVol(s.dims.L, s.dims.l, s.dims.h);
  const dBOD = BOD5_in - NORM.limiti.BOD5;
  const { Y, Kd } = NORM.bio;
  const denomBio = s.MLSS * (1 + Kd * s.SRT);
  const V_necessario_bio = denomBio > 0 ? (Q_med * s.SRT * Y * dBOD) / denomBio : NaN;
  const t_ciclo = s.t_fill + s.t_react + s.t_sedim + s.t_decant + s.t_idle;
  const cicli_giorno = t_ciclo > 0 ? Math.floor(1440 / t_ciclo) : 0;
  const V_per_ciclo = cicli_giorno > 0 && s.n_reattori > 0
    ? Q_med / (s.n_reattori * cicli_giorno) : NaN;
  const FM = V_singolo > 0 && s.MLSS > 0
    ? (Q_med * BOD5_in) / (V_singolo * s.MLSS) : NaN;
  const MLVSS = s.MLSS * 0.75;
  const Px = (Y * Q_med * dBOD / 1000) - (Kd * MLVSS * V_singolo / 1000);
  const Q_aria = s.n_diffusori * s.portata_diffusore;
  const O2_trasferito = Q_aria * 0.21 * 1.29 * 0.25;
  const O2_richiesto = Q_med > 0 ? (Q_med * dBOD / 1000 / 24) * 1.2 : NaN;
  const V_bio_per_reattore = s.n_reattori > 0 ? V_necessario_bio / s.n_reattori : NaN;
  return { V_singolo, V_necessario_bio, V_bio_per_reattore, dBOD, t_ciclo, cicli_giorno, V_per_ciclo, FM, MLVSS, Px, Q_aria, O2_trasferito, O2_richiesto };
}

function calcDisinf(d: DisinfState, Q_med: number) {
  const V_fisico = calcVol(d.dims.L, d.dims.l, d.dims.h);
  const CT = d.c_cloro * d.t_contatto;
  const Q_h = safeDiv(Q_med, 24);
  const V_necessario = Q_h * (d.t_contatto / 60);
  const HRT_eff = safeDiv(V_fisico, Q_h) * 60;
  const consumo_orario = Q_h * d.c_cloro / 1000;
  const consumo_giornaliero = consumo_orario * 24;
  const consumo_annuo = consumo_giornaliero * 365;
  return { V_fisico, CT, V_necessario, HRT_eff, consumo_orario, consumo_giornaliero, consumo_annuo };
}

// ============================================================
// CALCOLI IDRAULICI
// ============================================================

function calcCondotta(con: ConDef, Q_m3h: number): ConResult {
  const D = con.D_mm / 1000;
  if (D <= 0 || con.L_m <= 0) return { id: con.id, tipo: 'condotta', ok: false, detail: 'Dati mancanti' };
  const A = Math.PI * D * D / 4;
  const R = D / 4;
  const dz = con.z_up - con.z_dn;
  const i = Math.max(con.L_m > 0 ? dz / con.L_m : 0.001, 0.0001);
  const n = con.n_mann > 0 ? con.n_mann : 0.013;
  const Q_piena_s = (1 / n) * A * Math.pow(R, 2 / 3) * Math.sqrt(i);
  const Q_piena_h = Q_piena_s * 3600;
  const Q_s = Q_m3h / 3600;
  const riempi = Q_piena_s > 0 ? Math.min(Q_s / Q_piena_s * 100, 100) : 0;
  const v = A > 0 ? Q_s / A : 0;
  const ok = Q_piena_h >= Q_m3h && v >= 0.6 && v <= 3.0;
  return {
    id: con.id, tipo: 'condotta', ok,
    detail: 'Q_max=' + fmt(Q_piena_h, 1) + ' m³/h  v=' + fmt(v, 2) + ' m/s  riemp=' + fmt(riempi, 0) + '%  i=' + fmt(i * 100, 3) + '%',
    Q_cap: Q_piena_h, v, dH: i * con.L_m,
  };
}

function calcStramazzo(con: ConDef, Q_m3h: number): ConResult {
  const Q_s = Q_m3h / 3600;
  const B = Math.max(con.B_weir, 0.001);
  const H = Math.pow(Q_s / (1.84 * B), 2 / 3);
  const ok = isFinite(H) && H > 0 && H <= 0.5;
  return {
    id: con.id, tipo: 'stramazzo', ok,
    detail: 'H=' + fmt(H * 100, 1) + ' cm  z_soglia=' + fmt(con.z_soglia, 2) + ' m  B=' + fmt(con.B_weir, 2) + ' m',
    H_weir: H, dH: H,
  };
}

function calcComunicante(con: ConDef, Q_m3h: number): ConResult {
  const Q_s = Q_m3h / 3600;
  const A_fin = Math.max(con.h_fin * con.b_fin, 0.0001);
  const Cd = 0.6;
  const v = Q_s / A_fin;
  const dH = Math.pow(v / Cd, 2) / (2 * 9.81);
  const ok = dH < 0.05 && v < 2.0;
  return {
    id: con.id, tipo: 'comunicante', ok,
    detail: 'dH=' + fmt(dH * 100, 1) + ' cm  v=' + fmt(v, 2) + ' m/s  A_fin=' + fmt(A_fin, 3) + ' m²',
    dH, v,
  };
}

function calcIdraulicaAll(connections: ConDef[], Q_m3h: number): ConResult[] {
  return connections.map(con => {
    if (con.tipo === 'condotta') return calcCondotta(con, Q_m3h);
    if (con.tipo === 'stramazzo') return calcStramazzo(con, Q_m3h);
    return calcComunicante(con, Q_m3h);
  });
}

function buildSceneNodes(
  omogen: OmogenState,
  denitri: DenitriState,
  sbr: SBRState,
  disinf: DisinfState,
  overrides: Record<string, NodeOverride>,
): Scene3DNode[] {
  const gap = 2;
  const tanks: { id: string; nome: string; color: string; dims: DimsState }[] = [
    { id: 'omogen', nome: 'Omogen.', color: C.purple, dims: omogen.dims },
    { id: 'denitri', nome: 'Denitri.', color: C.amber, dims: denitri.dims },
    ...Array.from({ length: sbr.n_reattori }, (_, i) => ({
      id: 'sbr_' + (i + 1),
      nome: 'SBR ' + (i + 1),
      color: C.green,
      dims: sbr.dims,
    })),
    { id: 'disinf', nome: 'Disinf.', color: C.red, dims: disinf.dims },
  ];
  let curX = 0;
  return tanks.map(t => {
    const ov = overrides[t.id];
    const node: Scene3DNode = {
      id: t.id, nome: t.nome, color: t.color,
      x: ov ? ov.x : curX,
      y: ov ? ov.y : 0,
      z: ov ? ov.z_fondo : 0,
      L: t.dims.L, l: t.dims.l, h: t.dims.h,
    };
    curX += t.dims.L + gap;
    return node;
  });
}

function buildSceneConnections(connections: ConDef[], nodes: Scene3DNode[]): Scene3DCon[] {
  return connections.map(con => {
    const fn = nodes.find(n => n.id === con.from);
    const tn = nodes.find(n => n.id === con.to);
    if (!fn || !tn) return null;
    let fz = con.tipo === 'stramazzo' ? con.z_soglia : con.tipo === 'comunicante' ? fn.z + con.z_fin + con.h_fin / 2 : fn.z + con.z_up;
    let tz = con.tipo === 'stramazzo' ? con.z_soglia : con.tipo === 'comunicante' ? tn.z + con.z_fin + con.h_fin / 2 : tn.z + con.z_dn;
    const from: [number, number, number] = [fn.x + fn.L, fn.y + fn.l / 2, fz];
    const to: [number, number, number] = [tn.x, tn.y + tn.l / 2, tz];
    return { from, to, tipo: con.tipo };
  }).filter(Boolean) as Scene3DCon[];
}

function hexRgb(hex: string): string {
  const h = hex.replace('#', '');
  return parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) + ',' + parseInt(h.slice(4, 6), 16);
}

// ============================================================
// VIEWER 3D
// ============================================================

function Viewer3D({ nodes, connections, conResults }: {
  nodes: Scene3DNode[];
  connections: Scene3DCon[];
  conResults: ConResult[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [angle, setAngle] = useState(0.55);
  const [zoom, setZoom] = useState(22);
  const [pan, setPan] = useState({ x: 0, y: -40 });
  const dragRef = useRef<{ x: number; y: number; a0: number; panning: boolean } | null>(null);

  function proj(x: number, y: number, z: number, ca: number, sa: number, sc: number, panX: number, panY: number, W: number, H: number): [number, number] {
    const rx = x * ca - y * sa;
    const ry = x * sa + y * ca;
    return [rx * sc + W / 2 + panX, (-ry * 0.52 - z * 0.88) * sc + H / 2 + panY];
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const W = canvas.width / dpr;
    const H = canvas.height / dpr;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.scale(dpr, dpr);

    ctx.fillStyle = '#0d1117';
    ctx.fillRect(0, 0, W, H);

    const ca = Math.cos(angle), sa = Math.sin(angle);
    const p = (x: number, y: number, z: number): [number, number] => proj(x, y, z, ca, sa, zoom, pan.x, pan.y, W, H);

    // Ground grid
    ctx.strokeStyle = '#1c2535';
    ctx.lineWidth = 0.5;
    for (let gx = -5; gx <= 80; gx += 5) {
      const a2 = p(gx, -5, 0), b2 = p(gx, 35, 0);
      ctx.beginPath(); ctx.moveTo(...a2); ctx.lineTo(...b2); ctx.stroke();
    }
    for (let gy = -5; gy <= 35; gy += 5) {
      const a2 = p(-5, gy, 0), b2 = p(80, gy, 0);
      ctx.beginPath(); ctx.moveTo(...a2); ctx.lineTo(...b2); ctx.stroke();
    }

    // Tanks
    for (const n of nodes) {
      const { x, y, z, L, l: lw, h, color } = n;
      const x2 = x + L, y2 = y + lw, z2 = z + h;
      const rgb = hexRgb(color);
      const v: [number, number][] = [
        p(x, y, z), p(x2, y, z), p(x2, y2, z), p(x, y2, z),
        p(x, y, z2), p(x2, y, z2), p(x2, y2, z2), p(x, y2, z2),
      ];
      function face(idx: number[], fill: string, sc2 = 1) {
        if (!ctx) return;
        ctx.beginPath(); ctx.moveTo(...v[idx[0]]);
        for (let i = 1; i < idx.length; i++) ctx.lineTo(...v[idx[i]]);
        ctx.closePath();
        ctx.fillStyle = fill; ctx.fill();
        ctx.strokeStyle = 'rgba(' + rgb + ',0.6)';
        ctx.lineWidth = sc2; ctx.stroke();
      }
      face([3, 2, 6, 7], 'rgba(' + rgb + ',0.06)');
      face([2, 1, 5, 6], 'rgba(' + rgb + ',0.09)');
      face([0, 3, 7, 4], 'rgba(' + rgb + ',0.14)', 0.8);
      face([0, 1, 5, 4], 'rgba(' + rgb + ',0.22)', 1);
      face([4, 5, 6, 7], 'rgba(' + rgb + ',0.38)', 1.5);

      // Water level (at 80% of h)
      const wl = z + h * 0.80;
      const wv: [number, number][] = [p(x, y, wl), p(x2, y, wl), p(x2, y2, wl), p(x, y2, wl)];
      ctx.beginPath(); ctx.moveTo(...wv[0]);
      wv.slice(1).forEach(pt => ctx.lineTo(...pt));
      ctx.closePath();
      ctx.fillStyle = 'rgba(47,129,247,0.18)'; ctx.fill();
      ctx.strokeStyle = 'rgba(47,129,247,0.5)'; ctx.lineWidth = 1; ctx.stroke();

      const [lx, ly] = p(x + L / 2, y + lw / 2, z2 + 0.6);
      ctx.font = 'bold 10px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
      ctx.fillStyle = color; ctx.fillText(n.nome, lx, ly);
      ctx.font = '9px monospace'; ctx.fillStyle = C.textMid;
      ctx.fillText(fmt(L, 1) + 'x' + fmt(lw, 1) + 'x' + fmt(h, 1), lx, ly + 11);
    }

    // Connections
    connections.forEach((con, i) => {
      const res = conResults[i];
      const lineColor = !res ? C.textMid : res.ok ? C.green : C.red;
      const a2 = p(...con.from), b2 = p(...con.to);
      ctx.strokeStyle = lineColor; ctx.lineWidth = con.tipo === 'comunicante' ? 4 : 2;
      ctx.setLineDash(con.tipo === 'stramazzo' ? [7, 4] : []);
      ctx.beginPath(); ctx.moveTo(...a2); ctx.lineTo(...b2); ctx.stroke();
      ctx.setLineDash([]);
      const mx = (a2[0] + b2[0]) / 2, my = (a2[1] + b2[1]) / 2;
      const dx = b2[0] - a2[0], dy = b2[1] - a2[1];
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 10) {
        const ux = dx / len, uy = dy / len;
        ctx.fillStyle = lineColor;
        ctx.beginPath();
        ctx.moveTo(mx + ux * 7, my + uy * 7);
        ctx.lineTo(mx - ux * 7 - uy * 5, my - uy * 7 + ux * 5);
        ctx.lineTo(mx - ux * 7 + uy * 5, my - uy * 7 - ux * 5);
        ctx.closePath(); ctx.fill();
      }
    });

    // Axes
    const o2 = p(0, 0, 0);
    ([['X', p(4, 0, 0), '#f85149'], ['Y', p(0, 4, 0), '#3fb950'], ['Z', p(0, 0, 4), '#2f81f7']] as [string, [number, number], string][]).forEach(([label, pt, c]) => {
      ctx.strokeStyle = c; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(...o2); ctx.lineTo(...pt); ctx.stroke();
      ctx.fillStyle = c; ctx.font = '9px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, pt[0] + 6, pt[1]);
    });

    ctx.restore();
  }, [angle, zoom, pan, nodes, connections, conResults]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
  }, []);

  return (
    <div style={{ position: 'relative' as const }}>
      <canvas
        ref={canvasRef}
        onMouseDown={e => { dragRef.current = { x: e.clientX, y: e.clientY, a0: angle, panning: e.button === 2 }; }}
        onMouseMove={e => {
          if (!dragRef.current) return;
          if (dragRef.current.panning || e.buttons === 2) {
            setPan(p2 => ({ x: p2.x + e.movementX, y: p2.y + e.movementY }));
          } else if (e.buttons === 1) {
            setAngle(dragRef.current!.a0 + (e.clientX - dragRef.current!.x) * 0.012);
          }
        }}
        onMouseUp={() => { dragRef.current = null; }}
        onWheel={e => { e.preventDefault(); setZoom(z => Math.max(6, Math.min(90, z - e.deltaY * 0.05))); }}
        onContextMenu={e => e.preventDefault()}
        style={{ width: '100%', height: 380, borderRadius: 8, cursor: 'grab', display: 'block', outline: '1px solid ' + C.border }}
      />
      <div style={{ position: 'absolute' as const, bottom: 10, right: 10, display: 'flex', gap: 5 }}>
        {([['⟲', () => setAngle(a => a - 0.15)], ['⟳', () => setAngle(a => a + 0.15)], ['+', () => setZoom(z => Math.min(90, z + 5))], ['−', () => setZoom(z => Math.max(6, z - 5))], ['⌂', () => { setAngle(0.55); setZoom(22); setPan({ x: 0, y: -40 }); }]] as [string, () => void][]).map(([lbl, fn], i) => (
          <button key={i} onClick={fn} style={{ ...mono, fontSize: 13, padding: '3px 9px', background: '#1c2128', borderTop: 'none', borderRight: 'none', borderBottom: 'none', borderLeft: 'none', color: C.textMid, cursor: 'pointer', borderRadius: 5, outline: '1px solid ' + C.border }}>{lbl}</button>
        ))}
      </div>
      <div style={{ ...mono, position: 'absolute' as const, top: 8, left: 10, fontSize: 10, color: C.textMid }}>
        {'drag-sx: ruota  |  drag-dx: pan  |  scroll: zoom  |  ⌂: reset'}
      </div>
    </div>
  );
}

// ============================================================
// COMPONENTI RIUTILIZZABILI
// ============================================================

function NumInput({
  label, value, onChange, unit, hint, readOnly, min, max, step,
}: {
  label: string;
  value: number;
  onChange?: (v: number) => void;
  unit?: string;
  hint?: string;
  readOnly?: boolean;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <label style={{ ...mono, fontSize: 11, color: C.textMid, letterSpacing: '0.05em', textTransform: 'uppercase' as const }}>
          {label}
        </label>
        {hint && <span style={{ ...mono, fontSize: 10, color: C.textMid }}>{hint}</span>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          type="number"
          value={isNaN(value) ? '' : value}
          min={min}
          max={max}
          step={step !== undefined ? step : 'any'}
          readOnly={readOnly}
          onChange={e => onChange && onChange(parseFloat(e.target.value) || 0)}
          style={{
            ...mono,
            flex: 1,
            background: readOnly ? '#0d1117' : '#010409',
            borderRadius: 6,
            color: readOnly ? C.textMid : C.text,
            fontSize: 14,
            padding: '6px 10px',
            outline: '1px solid ' + (readOnly ? C.border : '#30363d'),
            WebkitAppearance: 'none' as const,
          }}
        />
        {unit && <span style={{ ...mono, fontSize: 12, color: C.textMid, minWidth: 56 }}>{unit}</span>}
      </div>
    </div>
  );
}

function TextInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{ ...mono, display: 'block', fontSize: 11, color: C.textMid, marginBottom: 4, letterSpacing: '0.05em', textTransform: 'uppercase' as const }}>
        {label}
      </label>
      <input
        type="text"
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          ...mono,
          width: '100%',
          background: '#010409',
          borderRadius: 6,
          color: C.text,
          fontSize: 14,
          padding: '6px 10px',
          boxSizing: 'border-box' as const,
          outline: '1px solid #30363d',
        }}
      />
    </div>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: C.panel,
      outline: '1px solid ' + C.border,
      borderRadius: 8,
      padding: 16,
      marginBottom: 16,
      ...style,
    }}>
      {children}
    </div>
  );
}

function SectionTitle({ children, accent }: { children: React.ReactNode; accent?: string }) {
  const color = accent || C.blue;
  return (
    <div style={{ marginBottom: 20 }}>
      <h2 style={{
        ...mono,
        fontSize: 15,
        fontWeight: 700,
        color,
        margin: 0,
        paddingBottom: 10,
        borderBottom: '1px solid ' + C.border,
        letterSpacing: '0.08em',
        textTransform: 'uppercase' as const,
      }}>
        {children}
      </h2>
    </div>
  );
}

function ResultRow({
  label, value, unit, ok, highlight, sub,
}: {
  label: string;
  value: string;
  unit?: string;
  ok?: boolean | null;
  highlight?: boolean;
  sub?: string;
}) {
  const showBadge = ok !== undefined && ok !== null;
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '7px 10px',
      borderRadius: 6,
      marginBottom: 3,
      background: highlight ? '#1c2128' : 'transparent',
      borderLeft: highlight ? '3px solid ' + C.blue : '3px solid transparent',
    }}>
      <div>
        <span style={{ ...mono, fontSize: 12, color: C.textMid }}>{label}</span>
        {sub && <div style={{ ...mono, fontSize: 10, color: C.textMid, marginTop: 2 }}>{sub}</div>}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ ...mono, fontSize: 14, fontWeight: 600, color: C.text }}>{value}</span>
        {unit && <span style={{ ...mono, fontSize: 11, color: C.textMid, minWidth: 40 }}>{unit}</span>}
        {showBadge && (
          <span style={{
            ...mono,
            fontSize: 10,
            fontWeight: 700,
            padding: '2px 7px',
            borderRadius: 4,
            background: ok ? '#1a4731' : '#4a1c1c',
            color: ok ? C.green : C.red,
            letterSpacing: '0.05em',
          }}>
            {ok ? 'OK' : 'NO'}
          </span>
        )}
      </div>
    </div>
  );
}

function DimInput({ dims, onChange }: { dims: DimsState; onChange: (d: DimsState) => void }) {
  const vol = calcVol(dims.L, dims.l, dims.h);
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
        <NumInput label="L" value={dims.L} unit="m" step={0.5} onChange={v => onChange({ ...dims, L: v })} />
        <NumInput label="l" value={dims.l} unit="m" step={0.5} onChange={v => onChange({ ...dims, l: v })} />
        <NumInput label="h" value={dims.h} unit="m" step={0.1} onChange={v => onChange({ ...dims, h: v })} />
      </div>
      <div style={{
        ...mono,
        fontSize: 13,
        color: C.textMid,
        textAlign: 'center' as const,
        background: '#0d1117',
        borderRadius: 6,
        padding: '6px 12px',
        marginTop: 4,
      }}>
        {'V fisico = '}
        <span style={{ color: C.blue, fontWeight: 700 }}>{fmt(vol, 1)}</span>
        {' m³'}
      </div>
    </div>
  );
}

function VerifyBox({ checks, title }: { checks: { label: string; ok: boolean }[]; title?: string }) {
  const allOk = checks.every(c => c.ok);
  return (
    <div style={{
      borderRadius: 8,
      padding: 14,
      background: allOk ? '#0d1f17' : '#1f0d0d',
      marginTop: 12,
      outline: '1px solid ' + (allOk ? C.green : C.red),
    }}>
      <div style={{
        ...mono,
        fontSize: 12,
        fontWeight: 700,
        color: allOk ? C.green : C.red,
        letterSpacing: '0.1em',
        marginBottom: 10,
      }}>
        {title ? title + ' — ' : ''}{allOk ? '✓ VERIFICATO' : '✗ NON VERIFICATO'}
      </div>
      {checks.map((c, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
          <span style={{ color: c.ok ? C.green : C.red, fontSize: 13, flexShrink: 0 }}>{c.ok ? '✓' : '✗'}</span>
          <span style={{ ...mono, fontSize: 12, color: c.ok ? C.text : C.red }}>{c.label}</span>
        </div>
      ))}
    </div>
  );
}

function StatusBadge({ ok, label }: { ok: boolean; label?: string }) {
  return (
    <span style={{
      ...mono,
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      fontSize: 11,
      fontWeight: 700,
      padding: '4px 12px',
      borderRadius: 20,
      background: ok ? '#1a4731' : '#4a1c1c',
      color: ok ? C.green : C.red,
      letterSpacing: '0.05em',
      outline: '1px solid ' + (ok ? '#2d6a4f' : '#6e2323'),
    }}>
      <span style={{ fontSize: 8 }}>{'●'}</span>
      {label || (ok ? 'OK' : 'RIVEDERE')}
    </span>
  );
}

// ============================================================
// SEZIONE: DATI GENERALI
// ============================================================

function DatiGenerali({ dati, setDati }: { dati: DatiState; setDati: (d: DatiState) => void }) {
  return (
    <div>
      <SectionTitle>Dati Generali</SectionTitle>
      <Card>
        <div style={{
          ...mono, fontSize: 11, color: C.textMid, marginBottom: 16,
          padding: '8px 12px', background: '#0d1117', borderRadius: 6,
          borderLeft: '3px solid ' + C.blue,
        }}>
          {'Normativa: '}
          <span style={{ color: C.blue }}>{NORM.nome}</span>
        </div>
        <TextInput label="Nome Progetto" value={dati.nome} onChange={v => setDati({ ...dati, nome: v })} />
        <TextInput label="Localita" value={dati.localita} onChange={v => setDati({ ...dati, localita: v })} />
        <TextInput label="Beneficiario" value={dati.beneficiario} onChange={v => setDati({ ...dati, beneficiario: v })} />
        <TextInput label="Progettista" value={dati.progettista} onChange={v => setDati({ ...dati, progettista: v })} />
      </Card>
      <Card>
        <div style={{ ...mono, fontSize: 11, color: C.textMid, marginBottom: 12, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
          {'Limiti di Scarico — ' + NORM.nome}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          <ResultRow label="BOD5" value={String(NORM.limiti.BOD5)} unit="mg/L" />
          <ResultRow label="COD" value={String(NORM.limiti.COD)} unit="mg/L" />
          <ResultRow label="SST" value={String(NORM.limiti.SST)} unit="mg/L" />
          <ResultRow label="N totale" value={String(NORM.limiti.N_tot)} unit="mg/L" />
          <ResultRow label="P totale" value={String(NORM.limiti.P_tot)} unit="mg/L" />
        </div>
      </Card>
      <Card>
        <div style={{ ...mono, fontSize: 11, color: C.textMid, marginBottom: 12, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
          Carichi Unitari AE
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          <ResultRow label="BOD5" value={String(NORM.AE.BOD5)} unit="g/AE·g" />
          <ResultRow label="COD" value={String(NORM.AE.COD)} unit="g/AE·g" />
          <ResultRow label="SST" value={String(NORM.AE.SST)} unit="g/AE·g" />
          <ResultRow label="N" value={String(NORM.AE.N)} unit="g/AE·g" />
          <ResultRow label="P" value={String(NORM.AE.P)} unit="g/AE·g" />
          <ResultRow label="Q" value={String(NORM.AE.Q)} unit="L/AE·g" />
        </div>
      </Card>
    </div>
  );
}

// ============================================================
// SEZIONE: PORTATE
// ============================================================

function Portate({ p, setP }: { p: PortateState; setP: (v: PortateState) => void }) {
  const res = calcPortate(p);
  return (
    <div>
      <SectionTitle>Portate</SectionTitle>
      <Card>
        <div style={{ ...mono, fontSize: 11, color: C.textMid, marginBottom: 10, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
          Modalita di calcolo
        </div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {(['AE', 'DIRETTA'] as const).map(m => (
            <button
              key={m}
              onClick={() => setP({ ...p, modalita: m })}
              style={{
                ...mono,
                padding: '6px 18px',
                borderRadius: 6,
                borderTop: 'none',
                borderRight: 'none',
                borderBottom: 'none',
                borderLeft: p.modalita === m ? '3px solid ' + C.blue : '3px solid transparent',
                background: p.modalita === m ? '#1c2a3d' : '#0d1117',
                color: p.modalita === m ? C.blue : C.textMid,
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
                outline: '1px solid ' + (p.modalita === m ? C.blue : C.border),
              }}
            >
              {m}
            </button>
          ))}
        </div>
        {p.modalita === 'AE'
          ? <NumInput label="Abitanti Equivalenti" value={p.AE} unit="AE" step={100} onChange={v => setP({ ...p, AE: v })} />
          : <NumInput label="Portata Diretta" value={p.Q_dir} unit="m3/g" step={10} onChange={v => setP({ ...p, Q_dir: v })} />
        }
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <NumInput label="Kd — coeff. giornaliero" value={p.Kd} step={0.05} onChange={v => setP({ ...p, Kd: v })} />
          <NumInput label="Kh — coeff. orario" value={p.Kh} step={0.1} onChange={v => setP({ ...p, Kh: v })} />
        </div>
      </Card>
      <Card>
        <div style={{ ...mono, fontSize: 11, color: C.textMid, marginBottom: 12, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
          Portate Calcolate
        </div>
        <ResultRow label="Q med — portata media giornaliera" value={fmt(res.Q_med, 1)} unit="m3/g" highlight />
        <ResultRow label="Q max,g — portata massima giornaliera" value={fmt(res.Q_max_g, 1)} unit="m3/g" />
        <ResultRow label="Q max,h — portata massima oraria" value={fmt(res.Q_max_h, 2)} unit="m3/h" />
        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <input
              type="checkbox"
              checked={p.override_Q}
              onChange={e => setP({ ...p, override_Q: e.target.checked })}
              style={{ accentColor: C.blue, width: 14, height: 14 }}
            />
            <label style={{ ...mono, fontSize: 11, color: C.textMid, textTransform: 'uppercase' as const, letterSpacing: '0.05em', cursor: 'pointer' }}>
              Override manuale Q calcolo
            </label>
          </div>
          {p.override_Q
            ? <NumInput label="Q calcolo (manuale)" value={p.Q_override} unit="m3/h" onChange={v => setP({ ...p, Q_override: v })} />
            : <ResultRow label="Q calcolo = Q max,h" value={fmt(res.Q_calc, 2)} unit="m3/h" highlight />
          }
        </div>
      </Card>
      <Card>
        <div style={{ ...mono, fontSize: 11, color: C.textMid, marginBottom: 12, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
          Qualita Influente
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <NumInput label="BOD5" value={p.BOD5} unit="mg/L" step={1} hint={'AE: ' + NORM.AE.BOD5} onChange={v => setP({ ...p, BOD5: v })} />
          <NumInput label="COD" value={p.COD} unit="mg/L" step={1} hint={'AE: ' + NORM.AE.COD} onChange={v => setP({ ...p, COD: v })} />
          <NumInput label="SST" value={p.SST} unit="mg/L" step={1} hint={'AE: ' + NORM.AE.SST} onChange={v => setP({ ...p, SST: v })} />
          <NumInput label="N totale" value={p.N} unit="mg/L" step={0.5} hint={'AE: ' + NORM.AE.N} onChange={v => setP({ ...p, N: v })} />
          <NumInput label="P totale" value={p.P} unit="mg/L" step={0.1} hint={'AE: ' + NORM.AE.P} onChange={v => setP({ ...p, P: v })} />
        </div>
      </Card>
    </div>
  );
}

// ============================================================
// SEZIONE: OMOGENIZZAZIONE
// ============================================================

function Omogenizzazione({ o, setO, Q_med }: { o: OmogenState; setO: (v: OmogenState) => void; Q_med: number }) {
  const res = calcOmogen(o, Q_med);
  const hrtOk = res.HRT >= 2 && res.HRT <= 8;
  const pOk = res.P_per_mixer >= 1 && res.P_per_mixer <= 15;
  const vOk = res.V_fisico >= res.V_necessario;
  const checks = [
    { label: 'V fisico >= V necessario (' + fmt(res.V_necessario, 1) + ' m3)', ok: vOk },
    { label: 'HRT: 2 <= ' + fmt(res.HRT, 1) + ' h <= 8', ok: hrtOk },
    { label: 'P mixer: 1 <= ' + fmt(res.P_per_mixer, 2) + ' kW <= 15', ok: pOk },
  ];
  return (
    <div>
      <SectionTitle accent={C.purple}>Omogenizzazione</SectionTitle>
      <Card>
        <div style={{ ...mono, fontSize: 11, color: C.textMid, marginBottom: 10, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
          Dimensioni Vasca
        </div>
        <DimInput dims={o.dims} onChange={d => setO({ ...o, dims: d })} />
      </Card>
      <Card>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <NumInput label="Tempo accumulo" value={o.t_accumulo} unit="h" step={0.5} onChange={v => setO({ ...o, t_accumulo: v })} />
          <NumInput label="N mixer" value={o.n_mixer} unit="" step={1} onChange={v => setO({ ...o, n_mixer: v })} />
          <NumInput label="W mixer" value={o.w_mixer} unit="W/m3" hint="cons. 4-8" step={1} onChange={v => setO({ ...o, w_mixer: v })} />
        </div>
      </Card>
      <Card>
        <div style={{ ...mono, fontSize: 11, color: C.textMid, marginBottom: 10, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
          Risultati
        </div>
        <ResultRow label="V fisico" value={fmt(res.V_fisico, 1)} unit="m3" highlight />
        <ResultRow label="V necessario" value={fmt(res.V_necessario, 1)} unit="m3" ok={vOk} />
        <ResultRow label="HRT" value={fmt(res.HRT, 1)} unit="h" ok={hrtOk} sub="range: 2 - 8 h" />
        <ResultRow label="P mixer totale" value={fmt(res.P_mixer_tot, 2)} unit="kW" />
        <ResultRow label="P per mixer" value={fmt(res.P_per_mixer, 2)} unit="kW" ok={pOk} sub="range: 1 - 15 kW" />
        <VerifyBox checks={checks} title="Omogenizzazione" />
      </Card>
    </div>
  );
}

// ============================================================
// SEZIONE: DENITRIFICAZIONE
// ============================================================

function Denitrificazione({ d, setD, Q_med, N_in }: { d: DenitriState; setD: (v: DenitriState) => void; Q_med: number; N_in: number }) {
  const res = calcDenitri(d, Q_med, N_in);
  const hrtOk = res.HRT >= 1 && res.HRT <= 4;
  const dNOk = res.dN > 0;
  const pOk = res.P_per_mixer >= 1 && res.P_per_mixer <= 15;
  const checks = [
    { label: 'HRT: 1 <= ' + fmt(res.HRT, 1) + ' h <= 4', ok: hrtOk },
    { label: 'dN > 0 (' + fmt(res.dN, 1) + ' mg/L)', ok: dNOk },
    { label: 'P mixer: 1 <= ' + fmt(res.P_per_mixer, 2) + ' kW <= 15', ok: pOk },
  ];
  return (
    <div>
      <SectionTitle accent={C.amber}>Denitrificazione</SectionTitle>
      <Card>
        <div style={{ ...mono, fontSize: 11, color: C.textMid, marginBottom: 10, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
          Dimensioni Vasca
        </div>
        <DimInput dims={d.dims} onChange={dd => setD({ ...d, dims: dd })} />
      </Card>
      <Card>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <NumInput label="N out target" value={d.N_out_target} unit="mg/L" step={0.5} hint={'limite: ' + NORM.limiti.N_tot} onChange={v => setD({ ...d, N_out_target: v })} />
          <NumInput label="N mixer" value={d.n_mixer} unit="" step={1} onChange={v => setD({ ...d, n_mixer: v })} />
          <NumInput label="W mixer" value={d.w_mixer} unit="W/m3" hint="cons. 3-5" step={1} onChange={v => setD({ ...d, w_mixer: v })} />
        </div>
      </Card>
      <Card>
        <div style={{ ...mono, fontSize: 11, color: C.textMid, marginBottom: 10, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
          Risultati
        </div>
        <ResultRow label="V fisico" value={fmt(res.V_fisico, 1)} unit="m3" highlight />
        <ResultRow label="HRT" value={fmt(res.HRT, 1)} unit="h" ok={hrtOk} sub="range: 1 - 4 h" />
        <ResultRow label="N in" value={fmt(N_in, 1)} unit="mg/L" />
        <ResultRow label="N out target" value={fmt(d.N_out_target, 1)} unit="mg/L" />
        <ResultRow label="dN rimosso" value={fmt(res.dN, 1)} unit="mg/L" ok={dNOk} />
        <ResultRow label="N rimosso" value={fmt(res.N_rimosso, 2)} unit="kg/g" />
        <ResultRow label="P mixer totale" value={fmt(res.P_mixer_tot, 2)} unit="kW" />
        <ResultRow label="P per mixer" value={fmt(res.P_per_mixer, 2)} unit="kW" ok={pOk} sub="range: 1 - 15 kW" />
        <VerifyBox checks={checks} title="Denitrificazione" />
      </Card>
    </div>
  );
}

// ============================================================
// BARRA CICLO SBR
// ============================================================

function CycleBar({ s }: { s: SBRState }) {
  const total = s.t_fill + s.t_react + s.t_sedim + s.t_decant + s.t_idle;
  if (total <= 0) return null;
  const phases = [
    { label: 'FILL', value: s.t_fill, color: C.blue },
    { label: 'REACT', value: s.t_react, color: C.green },
    { label: 'SEDIM', value: s.t_sedim, color: C.amber },
    { label: 'DECANT', value: s.t_decant, color: C.purple },
    { label: 'IDLE', value: s.t_idle, color: C.textMid },
  ];
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ ...mono, fontSize: 11, color: C.textMid, marginBottom: 8, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
        {'Ciclo SBR — totale ' + total + ' min'}
      </div>
      <div style={{ display: 'flex', height: 30, borderRadius: 6, overflow: 'hidden', outline: '1px solid ' + C.border }}>
        {phases.map((ph, i) => ph.value > 0 && (
          <div key={i} title={ph.label + ': ' + ph.value + ' min'} style={{
            flex: ph.value,
            background: ph.color,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}>
            <span style={{ ...mono, fontSize: 9, fontWeight: 700, color: '#0f1318', whiteSpace: 'nowrap' as const }}>
              {ph.label}
            </span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 14, marginTop: 8, flexWrap: 'wrap' as const }}>
        {phases.map((ph, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: ph.color }} />
            <span style={{ ...mono, fontSize: 10, color: C.textMid }}>{ph.label + ' ' + ph.value + 'min'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================
// SEZIONE: SBR
// ============================================================

function SBR({ s, setS, Q_med, BOD5_in }: { s: SBRState; setS: (v: SBRState) => void; Q_med: number; BOD5_in: number }) {
  const res = calcSBR(s, Q_med, BOD5_in);
  const vOk = res.V_singolo >= res.V_bio_per_reattore;
  const fmOk = res.FM >= NORM.bio.FM_min && res.FM <= NORM.bio.FM_max;
  const srtOk = s.SRT >= NORM.bio.theta_c_min && s.SRT <= NORM.bio.theta_c_max;
  const mlssOk = s.MLSS >= NORM.bio.MLSS_min && s.MLSS <= NORM.bio.MLSS_max;
  const o2Ok = res.O2_trasferito >= res.O2_richiesto;
  const checks = [
    { label: 'V singolo >= V bio/n (' + fmt(res.V_bio_per_reattore, 1) + ' m3)', ok: vOk },
    { label: 'F/M: 0.05 <= ' + fmt(res.FM, 4) + ' <= 0.15 kgBOD/kgMLSS·g', ok: fmOk },
    { label: 'SRT: 10 <= ' + s.SRT + ' gg <= 20', ok: srtOk },
    { label: 'MLSS: 2500 <= ' + s.MLSS + ' <= 4500 mg/L', ok: mlssOk },
    { label: 'O2 trasferito >= O2 richiesto (' + fmt(res.O2_richiesto, 2) + ' kgO2/h)', ok: o2Ok },
  ];
  return (
    <div>
      <SectionTitle accent={C.green}>Reattori SBR</SectionTitle>
      <Card>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
          <NumInput label="N reattori" value={s.n_reattori} unit="" min={1} max={4} step={1} onChange={v => setS({ ...s, n_reattori: Math.max(1, Math.round(v)) })} />
          <NumInput label="MLSS" value={s.MLSS} unit="mg/L" step={100} hint="2500-4500" onChange={v => setS({ ...s, MLSS: v })} />
          <NumInput label="SRT" value={s.SRT} unit="gg" step={1} hint="10-20" onChange={v => setS({ ...s, SRT: v })} />
        </div>
        <div style={{ ...mono, fontSize: 11, color: C.textMid, margin: '12px 0 8px', textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
          Dimensioni Singolo Reattore (da scheda tecnica)
        </div>
        <DimInput dims={s.dims} onChange={d => setS({ ...s, dims: d })} />
      </Card>
      <Card>
        <div style={{ ...mono, fontSize: 11, color: C.textMid, marginBottom: 12, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
          Fasi del Ciclo
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <NumInput label="t fill" value={s.t_fill} unit="min" step={5} onChange={v => setS({ ...s, t_fill: v })} />
          <NumInput label="t react" value={s.t_react} unit="min" step={5} onChange={v => setS({ ...s, t_react: v })} />
          <NumInput label="t sedim" value={s.t_sedim} unit="min" step={5} onChange={v => setS({ ...s, t_sedim: v })} />
          <NumInput label="t decant" value={s.t_decant} unit="min" step={5} onChange={v => setS({ ...s, t_decant: v })} />
          <NumInput label="t idle" value={s.t_idle} unit="min" step={5} onChange={v => setS({ ...s, t_idle: v })} />
        </div>
        <CycleBar s={s} />
      </Card>
      <Card>
        <div style={{ ...mono, fontSize: 11, color: C.textMid, marginBottom: 12, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
          Aerazione
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <NumInput label="N diffusori" value={s.n_diffusori} unit="" step={1} onChange={v => setS({ ...s, n_diffusori: v })} />
          <NumInput label="Portata diffusore" value={s.portata_diffusore} unit="Nm3/h" step={0.5} onChange={v => setS({ ...s, portata_diffusore: v })} />
        </div>
      </Card>
      <Card>
        <div style={{ ...mono, fontSize: 11, color: C.textMid, marginBottom: 10, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
          Risultati Biologici
        </div>
        <ResultRow label="V singolo (scheda tecnica)" value={fmt(res.V_singolo, 1)} unit="m3" highlight />
        <ResultRow label="V necessario bio totale" value={fmt(res.V_necessario_bio, 1)} unit="m3" />
        <ResultRow label="V bio per reattore" value={fmt(res.V_bio_per_reattore, 1)} unit="m3" ok={vOk} />
        <ResultRow label="dBOD (BOD5 in - 25)" value={fmt(res.dBOD, 1)} unit="mg/L" />
        <ResultRow label="t ciclo" value={fmt(res.t_ciclo, 0)} unit="min" />
        <ResultRow label="Cicli/giorno" value={fmt(res.cicli_giorno, 0)} unit="cicli" />
        <ResultRow label="V per ciclo" value={fmt(res.V_per_ciclo, 1)} unit="m3" />
        <ResultRow label="F/M" value={fmt(res.FM, 4)} unit="kgBOD/kgMLSS·g" ok={fmOk} sub="range: 0.05 - 0.15" />
        <ResultRow label="MLVSS (= MLSS x 0.75)" value={fmt(res.MLVSS, 0)} unit="mg/L" />
        <ResultRow label="Px produzione fanghi" value={fmt(res.Px, 2)} unit="kgSS/g" />
        <ResultRow label="Q aria totale" value={fmt(res.Q_aria, 1)} unit="Nm3/h" highlight />
        <ResultRow label="O2 trasferito" value={fmt(res.O2_trasferito, 2)} unit="kgO2/h" ok={o2Ok} />
        <ResultRow label="O2 richiesto" value={fmt(res.O2_richiesto, 2)} unit="kgO2/h" />
        <VerifyBox checks={checks} title="Reattori SBR" />
      </Card>
    </div>
  );
}

// ============================================================
// SEZIONE: DISINFEZIONE
// ============================================================

function Disinfezione({ d, setD, Q_med }: { d: DisinfState; setD: (v: DisinfState) => void; Q_med: number }) {
  const res = calcDisinf(d, Q_med);
  const ctOk = res.CT >= NORM.disinf.CT_min;
  const clOk = d.c_cloro >= NORM.disinf.cl_min;
  const vOk = res.V_fisico >= res.V_necessario;
  const checks = [
    { label: 'CT >= 30 mg·min/L (CT = ' + fmt(res.CT, 1) + ')', ok: ctOk },
    { label: 'c cloro >= 0.5 mg/L (' + fmt(d.c_cloro, 2) + ' mg/L)', ok: clOk },
    { label: 'V fisico >= V necessario (' + fmt(res.V_necessario, 2) + ' m3)', ok: vOk },
  ];
  return (
    <div>
      <SectionTitle accent={C.red}>Disinfezione</SectionTitle>
      <Card>
        <div style={{ ...mono, fontSize: 11, color: C.textMid, marginBottom: 10, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
          Dimensioni Vasca
        </div>
        <DimInput dims={d.dims} onChange={dd => setD({ ...d, dims: dd })} />
      </Card>
      <Card>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <NumInput label="Concentrazione cloro" value={d.c_cloro} unit="mg/L" step={0.1} hint=">= 0.5" onChange={v => setD({ ...d, c_cloro: v })} />
          <NumInput label="Tempo contatto" value={d.t_contatto} unit="min" step={5} hint="CT >= 30" onChange={v => setD({ ...d, t_contatto: v })} />
        </div>
        <div style={{
          ...mono, fontSize: 13, textAlign: 'center' as const, padding: '10px 16px',
          background: '#0d1117', borderRadius: 6, marginTop: 4,
        }}>
          {'CT = ' + fmt(d.c_cloro, 2) + ' x ' + fmt(d.t_contatto, 0) + ' = '}
          <span style={{ color: ctOk ? C.green : C.red, fontWeight: 700 }}>{fmt(res.CT, 1)}</span>
          {' mg·min/L'}
        </div>
      </Card>
      <Card>
        <div style={{ ...mono, fontSize: 11, color: C.textMid, marginBottom: 10, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
          Risultati
        </div>
        <ResultRow label="V fisico" value={fmt(res.V_fisico, 1)} unit="m3" highlight />
        <ResultRow label="CT" value={fmt(res.CT, 1)} unit="mg·min/L" ok={ctOk} sub="minimo: 30 mg·min/L" />
        <ResultRow label="V necessario" value={fmt(res.V_necessario, 2)} unit="m3" ok={vOk} />
        <ResultRow label="HRT effettivo" value={fmt(res.HRT_eff, 1)} unit="min" />
        <ResultRow label="Consumo cloro orario" value={fmt(res.consumo_orario, 4)} unit="kg/h" />
        <ResultRow label="Consumo cloro giornaliero" value={fmt(res.consumo_giornaliero, 3)} unit="kg/g" />
        <ResultRow label="Consumo cloro annuo" value={fmt(res.consumo_annuo, 0)} unit="kg/anno" highlight />
        <VerifyBox checks={checks} title="Disinfezione" />
      </Card>
    </div>
  );
}

// ============================================================
// SEZIONE: RIEPILOGO
// ============================================================

function Riepilogo({
  dati, portate, omogen, denitri, sbr, disinf,
}: {
  dati: DatiState;
  portate: PortateState;
  omogen: OmogenState;
  denitri: DenitriState;
  sbr: SBRState;
  disinf: DisinfState;
}) {
  const pRes = calcPortate(portate);
  const oRes = calcOmogen(omogen, pRes.Q_med);
  const dRes = calcDenitri(denitri, pRes.Q_med, portate.N);
  const sRes = calcSBR(sbr, pRes.Q_med, portate.BOD5);
  const diRes = calcDisinf(disinf, pRes.Q_med);

  const allChecks = [
    { section: 'Omogen', label: 'V fisico >= V necessario', ok: oRes.V_fisico >= oRes.V_necessario },
    { section: 'Omogen', label: 'HRT 2 - 8 h', ok: oRes.HRT >= 2 && oRes.HRT <= 8 },
    { section: 'Omogen', label: 'P mixer 1 - 15 kW', ok: oRes.P_per_mixer >= 1 && oRes.P_per_mixer <= 15 },
    { section: 'Denitri', label: 'HRT 1 - 4 h', ok: dRes.HRT >= 1 && dRes.HRT <= 4 },
    { section: 'Denitri', label: 'dN > 0', ok: dRes.dN > 0 },
    { section: 'SBR', label: 'V singolo >= V bio/n', ok: sRes.V_singolo >= sRes.V_bio_per_reattore },
    { section: 'SBR', label: 'F/M 0.05 - 0.15', ok: sRes.FM >= NORM.bio.FM_min && sRes.FM <= NORM.bio.FM_max },
    { section: 'SBR', label: 'SRT 10 - 20 gg', ok: sbr.SRT >= NORM.bio.theta_c_min && sbr.SRT <= NORM.bio.theta_c_max },
    { section: 'SBR', label: 'MLSS 2500 - 4500 mg/L', ok: sbr.MLSS >= NORM.bio.MLSS_min && sbr.MLSS <= NORM.bio.MLSS_max },
    { section: 'SBR', label: 'O2 trasferito >= O2 richiesto', ok: sRes.O2_trasferito >= sRes.O2_richiesto },
    { section: 'Disinf', label: 'CT >= 30 mg·min/L', ok: diRes.CT >= NORM.disinf.CT_min },
    { section: 'Disinf', label: 'c cloro >= 0.5 mg/L', ok: disinf.c_cloro >= NORM.disinf.cl_min },
    { section: 'Disinf', label: 'V fisico >= V necessario', ok: diRes.V_fisico >= diRes.V_necessario },
  ];

  const nOk = allChecks.filter(c => c.ok).length;
  const tot = allChecks.length;
  const allGreen = nOk === tot;

  const dimTable = [
    { nome: 'Omogenizzazione', L: omogen.dims.L, l: omogen.dims.l, h: omogen.dims.h, V: oRes.V_fisico, n: 1 },
    { nome: 'Denitrificazione', L: denitri.dims.L, l: denitri.dims.l, h: denitri.dims.h, V: dRes.V_fisico, n: 1 },
    { nome: 'SBR (singolo)', L: sbr.dims.L, l: sbr.dims.l, h: sbr.dims.h, V: sRes.V_singolo, n: sbr.n_reattori },
    { nome: 'Disinfezione', L: disinf.dims.L, l: disinf.dims.l, h: disinf.dims.h, V: diRes.V_fisico, n: 1 },
  ];

  const sections = ['Omogen', 'Denitri', 'SBR', 'Disinf'];
  const sectionColors: Record<string, string> = {
    'Omogen': C.purple, 'Denitri': C.amber, 'SBR': C.green, 'Disinf': C.red,
  };

  return (
    <div>
      <SectionTitle>Riepilogo Impianto</SectionTitle>

      {/* Header progetto */}
      <Card style={{ background: '#0d1117' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div>
            <div style={{ ...mono, fontSize: 10, color: C.textMid, marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: '0.08em' }}>
              Progetto
            </div>
            <div style={{ ...mono, fontSize: 20, fontWeight: 700, color: C.text }}>
              {dati.nome || '—'}
            </div>
            <div style={{ ...mono, fontSize: 13, color: C.textMid, marginTop: 4 }}>
              {dati.localita || '—'}
            </div>
            <div style={{ ...mono, fontSize: 12, color: C.textMid, marginTop: 2 }}>
              {dati.beneficiario ? 'Beneficiario: ' + dati.beneficiario : ''}
            </div>
          </div>
          <div style={{ textAlign: 'right' as const }}>
            <div style={{ ...mono, fontSize: 10, color: C.textMid, marginBottom: 4, textTransform: 'uppercase' as const, letterSpacing: '0.08em' }}>
              Dimensionamento
            </div>
            <div style={{ ...mono, fontSize: 20, fontWeight: 700, color: C.blue }}>
              {portate.modalita === 'AE' ? portate.AE + ' AE' : 'Q diretta'}
            </div>
            <div style={{ ...mono, fontSize: 13, color: C.textMid, marginTop: 4 }}>
              {'Q med = ' + fmt(pRes.Q_med, 1) + ' m3/g'}
            </div>
            <div style={{ ...mono, fontSize: 12, color: C.textMid, marginTop: 2 }}>
              {'Q calcolo = ' + fmt(pRes.Q_calc, 2) + ' m3/h'}
            </div>
          </div>
        </div>
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid ' + C.border, display: 'flex', gap: 20, flexWrap: 'wrap' as const }}>
          <div style={{ ...mono, fontSize: 12, color: C.textMid }}>
            {'Normativa: '}
            <span style={{ color: C.blue }}>{NORM.nome}</span>
          </div>
          <div style={{ ...mono, fontSize: 12, color: C.textMid }}>
            {'Progettista: '}
            <span style={{ color: C.text }}>{dati.progettista || '—'}</span>
          </div>
        </div>
      </Card>

      {/* Contatore verifiche */}
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <div>
            <div style={{ ...mono, fontSize: 11, color: C.textMid, textTransform: 'uppercase' as const, letterSpacing: '0.08em', marginBottom: 4 }}>
              Stato Verifiche
            </div>
            <StatusBadge ok={allGreen} label={allGreen ? 'TUTTO VERIFICATO' : 'RIVEDERE'} />
          </div>
          <div style={{ textAlign: 'right' as const }}>
            <span style={{ ...mono, fontSize: 48, fontWeight: 700, color: allGreen ? C.green : C.amber, lineHeight: 1 }}>
              {nOk}
            </span>
            <span style={{ ...mono, fontSize: 24, color: C.textMid }}>
              {'/' + tot}
            </span>
          </div>
        </div>
        {sections.map(sec => {
          const secChecks = allChecks.filter(c => c.section === sec);
          const secOk = secChecks.every(c => c.ok);
          const accent = sectionColors[sec] || C.blue;
          return (
            <div key={sec} style={{ marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                <div style={{ width: 8, height: 8, borderRadius: 2, background: accent }} />
                <span style={{ ...mono, fontSize: 11, color: accent, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
                  {sec}
                </span>
                <StatusBadge ok={secOk} label={secOk ? 'OK' : 'RIVEDERE'} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, paddingLeft: 16 }}>
                {secChecks.map((c, i) => (
                  <div key={i} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '5px 10px',
                    borderRadius: 5,
                    background: c.ok ? '#0d1f17' : '#1f0d0d',
                    outline: '1px solid ' + (c.ok ? '#1a3d2d' : '#3d1a1a'),
                  }}>
                    <span style={{ color: c.ok ? C.green : C.red, fontSize: 12, flexShrink: 0 }}>
                      {c.ok ? '✓' : '✗'}
                    </span>
                    <span style={{ ...mono, fontSize: 11, color: c.ok ? C.text : C.red }}>{c.label}</span>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </Card>

      {/* Tabella dimensionamento */}
      <Card>
        <div style={{ ...mono, fontSize: 11, color: C.textMid, marginBottom: 12, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
          Tabella Dimensionamento Vasche
        </div>
        <div style={{ overflowX: 'auto' as const }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' as const, ...mono, fontSize: 13 }}>
            <thead>
              <tr>
                {['Vasca', 'N', 'L (m)', 'l (m)', 'h (m)', 'V (m3)', 'V tot (m3)'].map(hd => (
                  <th key={hd} style={{
                    textAlign: 'left' as const,
                    padding: '8px 12px',
                    borderBottom: '1px solid ' + C.border,
                    color: C.textMid,
                    fontWeight: 600,
                    letterSpacing: '0.04em',
                    fontSize: 11,
                    textTransform: 'uppercase' as const,
                  }}>{hd}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dimTable.map((r, i) => (
                <tr key={i} style={{ borderBottom: '1px solid ' + C.border }}>
                  <td style={{ padding: '10px 12px', color: C.text, fontWeight: 600 }}>{r.nome}</td>
                  <td style={{ padding: '10px 12px', color: C.textMid }}>{r.n}</td>
                  <td style={{ padding: '10px 12px', color: C.textMid }}>{fmt(r.L, 1)}</td>
                  <td style={{ padding: '10px 12px', color: C.textMid }}>{fmt(r.l, 1)}</td>
                  <td style={{ padding: '10px 12px', color: C.textMid }}>{fmt(r.h, 1)}</td>
                  <td style={{ padding: '10px 12px', color: C.blue, fontWeight: 700 }}>{fmt(r.V, 1)}</td>
                  <td style={{ padding: '10px 12px', color: C.blue, fontWeight: 700 }}>{fmt(r.V * r.n, 1)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={5} style={{ padding: '10px 12px', color: C.textMid, ...mono, fontSize: 12, fontWeight: 600 }}>TOTALE</td>
                <td style={{ padding: '10px 12px' }} />
                <td style={{ padding: '10px 12px', color: C.green, fontWeight: 700, ...mono, fontSize: 14 }}>
                  {fmt(dimTable.reduce((acc, r) => acc + r.V * r.n, 0), 1)} m3
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {/* Parametri chiave */}
      <Card>
        <div style={{ ...mono, fontSize: 11, color: C.textMid, marginBottom: 12, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
          Parametri Chiave
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
          <ResultRow label="Q med" value={fmt(pRes.Q_med, 1)} unit="m3/g" highlight />
          <ResultRow label="Q calcolo" value={fmt(pRes.Q_calc, 2)} unit="m3/h" />
          <ResultRow label="F/M" value={fmt(sRes.FM, 4)} unit="kgBOD/kgMLSS·g" ok={sRes.FM >= NORM.bio.FM_min && sRes.FM <= NORM.bio.FM_max} />
          <ResultRow label="SRT" value={String(sbr.SRT)} unit="gg" ok={sbr.SRT >= NORM.bio.theta_c_min && sbr.SRT <= NORM.bio.theta_c_max} />
          <ResultRow label="MLSS" value={String(sbr.MLSS)} unit="mg/L" ok={sbr.MLSS >= NORM.bio.MLSS_min && sbr.MLSS <= NORM.bio.MLSS_max} />
          <ResultRow label="Cicli SBR/giorno" value={fmt(sRes.cicli_giorno, 0)} unit="cicli" />
          <ResultRow label="Px produzione fanghi" value={fmt(sRes.Px, 2)} unit="kgSS/g" />
          <ResultRow label="O2 trasferito" value={fmt(sRes.O2_trasferito, 2)} unit="kgO2/h" ok={sRes.O2_trasferito >= sRes.O2_richiesto} />
          <ResultRow label="CT disinfezione" value={fmt(diRes.CT, 1)} unit="mg·min/L" ok={diRes.CT >= NORM.disinf.CT_min} />
          <ResultRow label="Cloro annuo" value={fmt(diRes.consumo_annuo, 0)} unit="kg/anno" highlight />
        </div>
      </Card>
    </div>
  );
}

// ============================================================
// SEZIONE: IDRAULICA
// ============================================================

const TANK_IDS_BASE = ['omogen', 'denitri', 'disinf'];
const CON_TIPO_LABEL: Record<ConTipo, string> = { condotta: 'Condotta', stramazzo: 'Stramazzo', comunicante: 'Comunicante' };
const CON_TIPO_COLOR: Record<ConTipo, string> = { condotta: C.blue, stramazzo: C.amber, comunicante: C.green };

function getAllNodeIds(n_reattori: number): string[] {
  return [
    'omogen', 'denitri',
    ...Array.from({ length: n_reattori }, (_, i) => 'sbr_' + (i + 1)),
    'disinf',
  ];
}

function getNodeLabel(id: string): string {
  if (id === 'omogen') return 'Omogenizzazione';
  if (id === 'denitri') return 'Denitrificazione';
  if (id === 'disinf') return 'Disinfezione';
  if (id.startsWith('sbr_')) return 'SBR ' + id.slice(4);
  return id;
}

const DEFAULT_CON: Omit<ConDef, 'id' | 'from' | 'to'> = {
  tipo: 'condotta',
  D_mm: 300, L_m: 10, n_mann: 0.013, z_up: 1.0, z_dn: 0.8,
  z_soglia: 1.5, B_weir: 1.0,
  z_fin: 0.0, h_fin: 0.5, b_fin: 1.0,
};

function IdraulicaSection({
  omogen, denitri, sbr, disinf, idraul, setIdraul, Q_calc,
}: {
  omogen: OmogenState; denitri: DenitriState; sbr: SBRState; disinf: DisinfState;
  idraul: IdraulicaState; setIdraul: (v: IdraulicaState) => void; Q_calc: number;
}) {
  const nodeIds = getAllNodeIds(sbr.n_reattori);
  const sceneNodes = buildSceneNodes(omogen, denitri, sbr, disinf, idraul.overrides);
  const sceneCons = buildSceneConnections(idraul.connections, sceneNodes);
  const results = calcIdraulicaAll(idraul.connections, Q_calc);

  const [draft, setDraft] = useState<ConDef>({
    id: '', from: nodeIds[0], to: nodeIds[1], ...DEFAULT_CON,
  });
  const [editOvId, setEditOvId] = useState<string | null>(null);

  function addCon() {
    if (!draft.from || !draft.to || draft.from === draft.to) return;
    const newCon: ConDef = { ...draft, id: Date.now().toString() };
    setIdraul({ ...idraul, connections: [...idraul.connections, newCon] });
  }

  function delCon(id: string) {
    setIdraul({ ...idraul, connections: idraul.connections.filter(c => c.id !== id) });
  }

  function setOverride(nodeId: string, field: keyof NodeOverride, val: number) {
    const cur = idraul.overrides[nodeId] || { x: 0, y: 0, z_fondo: 0 };
    setIdraul({ ...idraul, overrides: { ...idraul.overrides, [nodeId]: { ...cur, [field]: val } } });
  }

  function getOv(nodeId: string, field: keyof NodeOverride): number {
    const n = sceneNodes.find(n => n.id === nodeId);
    if (!n) return 0;
    if (field === 'x') return n.x;
    if (field === 'y') return n.y;
    return n.z;
  }

  const selectStyle: React.CSSProperties = {
    ...mono, background: '#010409', borderRadius: 6, color: C.text, fontSize: 13,
    padding: '5px 8px', outline: '1px solid #30363d', width: '100%',
    borderTop: 'none', borderRight: 'none', borderBottom: 'none', borderLeft: 'none',
  };

  return (
    <div>
      <SectionTitle accent={C.blue}>Idraulica — Connessioni</SectionTitle>

      {/* Viewer 3D */}
      <Card>
        <div style={{ ...mono, fontSize: 11, color: C.textMid, marginBottom: 10, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
          Visualizzatore 3D Impianto
        </div>
        <Viewer3D nodes={sceneNodes} connections={sceneCons} conResults={results} />
        <div style={{ display: 'flex', gap: 16, marginTop: 10, flexWrap: 'wrap' as const }}>
          {([['condotta', 'Condotta (gravità)'], ['stramazzo', 'Stramazzo'], ['comunicante', 'Parete comunicante']] as [ConTipo, string][]).map(([t, lbl]) => (
            <div key={t} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 24, height: 3, background: CON_TIPO_COLOR[t], borderRadius: 2 }} />
              <span style={{ ...mono, fontSize: 10, color: C.textMid }}>{lbl}</span>
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{ width: 10, height: 10, background: 'rgba(47,129,247,0.3)', outline: '1px solid rgba(47,129,247,0.5)', borderRadius: 2 }} />
            <span style={{ ...mono, fontSize: 10, color: C.textMid }}>Livello idrico (80% h)</span>
          </div>
        </div>
      </Card>

      {/* Quote vasche */}
      <Card>
        <div style={{ ...mono, fontSize: 11, color: C.textMid, marginBottom: 12, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
          Posizioni e Quote Vasche
        </div>
        <div style={{ overflowX: 'auto' as const }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' as const, ...mono, fontSize: 12 }}>
            <thead>
              <tr>
                {['Vasca', 'x (m)', 'y (m)', 'z fondo (m)'].map(h => (
                  <th key={h} style={{ textAlign: 'left' as const, padding: '6px 10px', borderBottom: '1px solid ' + C.border, color: C.textMid, fontSize: 10, textTransform: 'uppercase' as const, letterSpacing: '0.04em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sceneNodes.map(n => (
                <tr key={n.id} style={{ borderBottom: '1px solid ' + C.border }}>
                  <td style={{ padding: '6px 10px', color: n.color, fontWeight: 600 }}>{getNodeLabel(n.id)}</td>
                  {(['x', 'y', 'z_fondo'] as (keyof NodeOverride)[]).map(field => (
                    <td key={field} style={{ padding: '4px 8px' }}>
                      <input
                        type="number"
                        step="0.1"
                        value={getOv(n.id, field as keyof NodeOverride)}
                        onChange={e => setOverride(n.id, field as keyof NodeOverride, parseFloat(e.target.value) || 0)}
                        style={{ ...mono, width: 80, background: '#010409', borderRadius: 5, color: C.text, fontSize: 12, padding: '4px 6px', outline: '1px solid #30363d', borderTop: 'none', borderRight: 'none', borderBottom: 'none', borderLeft: 'none' }}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{ ...mono, fontSize: 10, color: C.textMid, marginTop: 8 }}>
          Le quote z controllano la pendenza delle condotte e le soglie degli stramazzi rispetto al fondo vasca.
        </div>
      </Card>

      {/* Aggiungi collegamento */}
      <Card>
        <div style={{ ...mono, fontSize: 11, color: C.textMid, marginBottom: 12, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
          Aggiungi Collegamento
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 14 }}>
          <div>
            <div style={{ ...mono, fontSize: 10, color: C.textMid, marginBottom: 4, textTransform: 'uppercase' as const }}>Da</div>
            <select value={draft.from} onChange={e => setDraft({ ...draft, from: e.target.value })} style={selectStyle}>
              {nodeIds.map(id => <option key={id} value={id}>{getNodeLabel(id)}</option>)}
            </select>
          </div>
          <div>
            <div style={{ ...mono, fontSize: 10, color: C.textMid, marginBottom: 4, textTransform: 'uppercase' as const }}>A</div>
            <select value={draft.to} onChange={e => setDraft({ ...draft, to: e.target.value })} style={selectStyle}>
              {nodeIds.map(id => <option key={id} value={id}>{getNodeLabel(id)}</option>)}
            </select>
          </div>
          <div>
            <div style={{ ...mono, fontSize: 10, color: C.textMid, marginBottom: 4, textTransform: 'uppercase' as const }}>Tipo</div>
            <select value={draft.tipo} onChange={e => setDraft({ ...draft, tipo: e.target.value as ConTipo })} style={selectStyle}>
              <option value="condotta">Condotta</option>
              <option value="stramazzo">Stramazzo</option>
              <option value="comunicante">Comunicante</option>
            </select>
          </div>
        </div>

        {draft.tipo === 'condotta' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: 10, marginBottom: 14 }}>
            <NumInput label="Ø" value={draft.D_mm} unit="mm" step={25} onChange={v => setDraft({ ...draft, D_mm: v })} />
            <NumInput label="L" value={draft.L_m} unit="m" step={1} onChange={v => setDraft({ ...draft, L_m: v })} />
            <NumInput label="n Manning" value={draft.n_mann} step={0.001} onChange={v => setDraft({ ...draft, n_mann: v })} hint="0.013" />
            <NumInput label="z monte" value={draft.z_up} unit="m" step={0.05} onChange={v => setDraft({ ...draft, z_up: v })} />
            <NumInput label="z valle" value={draft.z_dn} unit="m" step={0.05} onChange={v => setDraft({ ...draft, z_dn: v })} />
          </div>
        )}
        {draft.tipo === 'stramazzo' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
            <NumInput label="Quota soglia" value={draft.z_soglia} unit="m" step={0.05} onChange={v => setDraft({ ...draft, z_soglia: v })} />
            <NumInput label="Larghezza B" value={draft.B_weir} unit="m" step={0.1} onChange={v => setDraft({ ...draft, B_weir: v })} />
          </div>
        )}
        {draft.tipo === 'comunicante' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 14 }}>
            <NumInput label="z finestra (fondo)" value={draft.z_fin} unit="m" step={0.05} onChange={v => setDraft({ ...draft, z_fin: v })} />
            <NumInput label="Altezza h" value={draft.h_fin} unit="m" step={0.05} onChange={v => setDraft({ ...draft, h_fin: v })} />
            <NumInput label="Larghezza b" value={draft.b_fin} unit="m" step={0.05} onChange={v => setDraft({ ...draft, b_fin: v })} />
          </div>
        )}

        <button
          onClick={addCon}
          style={{
            ...mono, padding: '8px 20px', background: '#1c2a3d', borderRadius: 6, cursor: 'pointer',
            borderTop: 'none', borderRight: 'none', borderBottom: 'none', borderLeft: 'none',
            color: C.blue, fontWeight: 700, fontSize: 12, outline: '1px solid ' + C.blue,
          }}
        >
          {'+ Aggiungi ' + CON_TIPO_LABEL[draft.tipo]}
        </button>
      </Card>

      {/* Lista collegamenti con risultati */}
      {idraul.connections.length === 0 && (
        <div style={{ ...mono, fontSize: 13, color: C.textMid, textAlign: 'center' as const, padding: 32 }}>
          Nessun collegamento definito. Aggiungine uno sopra.
        </div>
      )}
      {idraul.connections.map((con, i) => {
        const res = results[i];
        const accentC = CON_TIPO_COLOR[con.tipo];
        return (
          <Card key={con.id} style={{ borderLeft: '3px solid ' + accentC }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
              <div>
                <span style={{ ...mono, fontSize: 11, fontWeight: 700, color: accentC, textTransform: 'uppercase' as const, letterSpacing: '0.08em' }}>
                  {CON_TIPO_LABEL[con.tipo]}
                </span>
                <span style={{ ...mono, fontSize: 13, color: C.text, marginLeft: 12 }}>
                  {getNodeLabel(con.from) + '  →  ' + getNodeLabel(con.to)}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {res && <StatusBadge ok={res.ok} label={res.ok ? 'OK' : 'RIVEDERE'} />}
                <button onClick={() => delCon(con.id)} style={{
                  ...mono, fontSize: 11, padding: '3px 8px', background: '#2d1414', borderRadius: 5, cursor: 'pointer',
                  borderTop: 'none', borderRight: 'none', borderBottom: 'none', borderLeft: 'none',
                  color: C.red, outline: '1px solid #4a1c1c',
                }}>✕ Elimina</button>
              </div>
            </div>
            {con.tipo === 'condotta' && (
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' as const }}>
                <ResultRow label="Ø" value={String(con.D_mm)} unit="mm" />
                <ResultRow label="L" value={String(con.L_m)} unit="m" />
                <ResultRow label="i" value={fmt(con.L_m > 0 ? (con.z_up - con.z_dn) / con.L_m * 100 : 0, 3)} unit="%" />
                <ResultRow label="n Manning" value={String(con.n_mann)} unit="" />
              </div>
            )}
            {con.tipo === 'stramazzo' && (
              <div style={{ display: 'flex', gap: 20 }}>
                <ResultRow label="z soglia" value={fmt(con.z_soglia, 2)} unit="m" />
                <ResultRow label="B" value={fmt(con.B_weir, 2)} unit="m" />
              </div>
            )}
            {con.tipo === 'comunicante' && (
              <div style={{ display: 'flex', gap: 20 }}>
                <ResultRow label="z finestra" value={fmt(con.z_fin, 2)} unit="m" />
                <ResultRow label="h x b" value={fmt(con.h_fin, 2) + ' × ' + fmt(con.b_fin, 2)} unit="m" />
              </div>
            )}
            {res && (
              <div style={{ ...mono, fontSize: 12, color: res.ok ? C.textMid : C.red, marginTop: 8, padding: '6px 10px', background: '#0d1117', borderRadius: 5 }}>
                {res.detail}
                {res.dH !== undefined && (
                  <span style={{ marginLeft: 14, color: C.textMid }}>
                    {'  perdita=' + fmt(res.dH, 3) + ' m'}
                  </span>
                )}
              </div>
            )}
          </Card>
        );
      })}

      {/* Riepilogo idraulico */}
      {results.length > 0 && (
        <Card>
          <div style={{ ...mono, fontSize: 11, color: C.textMid, marginBottom: 10, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
            {'Riepilogo Idraulico — Q design = ' + fmt(Q_calc, 2) + ' m³/h'}
          </div>
          <VerifyBox
            checks={results.map(r => ({ label: getNodeLabel(idraul.connections.find(c => c.id === r.id)?.from || '') + ' → ' + getNodeLabel(idraul.connections.find(c => c.id === r.id)?.to || '') + ' (' + CON_TIPO_LABEL[r.tipo] + ')', ok: r.ok }))}
            title="Verifica idraulica"
          />
        </Card>
      )}
    </div>
  );
}

// ============================================================
// NAVIGAZIONE
// ============================================================

const SECTIONS = [
  { id: 'dati', label: 'Dati Generali', icon: '▣', accent: C.blue },
  { id: 'portate', label: 'Portate', icon: '≋', accent: C.blue },
  { id: 'omogen', label: 'Omogenizzazione', icon: '◉', accent: C.purple },
  { id: 'denitri', label: 'Denitrificazione', icon: '⬡', accent: C.amber },
  { id: 'sbr', label: 'Reattori SBR', icon: '▦', accent: C.green },
  { id: 'disinf', label: 'Disinfezione', icon: '✦', accent: C.red },
  { id: 'idraul', label: 'Idraulica', icon: '⇢', accent: C.blue },
  { id: 'riepilogo', label: 'Riepilogo', icon: '≡', accent: C.blue },
];

// ============================================================
// APP
// ============================================================

export default function App() {
  const [activeSection, setActiveSection] = useState('dati');

  const [dati, setDati] = useState<DatiState>({
    nome: 'Impianto SBR',
    localita: '',
    beneficiario: '',
    progettista: '',
  });

  const [portate, setPortate] = useState<PortateState>({
    modalita: 'AE',
    AE: 1000,
    Q_dir: 200,
    Kd: 1.3,
    Kh: 2.5,
    override_Q: false,
    Q_override: 0,
    BOD5: NORM.AE.BOD5,
    COD: NORM.AE.COD,
    SST: NORM.AE.SST,
    N: NORM.AE.N,
    P: NORM.AE.P,
  });

  const [omogen, setOmogen] = useState<OmogenState>({
    dims: { L: 6, l: 3, h: 3 },
    t_accumulo: 4,
    n_mixer: 2,
    w_mixer: 5,
  });

  const [denitri, setDenitri] = useState<DenitriState>({
    dims: { L: 6, l: 3, h: 4 },
    N_out_target: NORM.limiti.N_tot,
    n_mixer: 2,
    w_mixer: 4,
  });

  const [sbr, setSbr] = useState<SBRState>({
    dims: { L: 15, l: 3, h: 5 },
    n_reattori: 2,
    MLSS: 3500,
    SRT: 15,
    n_diffusori: 56,
    portata_diffusore: 4,
    t_fill: 60,
    t_react: 120,
    t_sedim: 45,
    t_decant: 30,
    t_idle: 5,
  });

  const [disinf, setDisinf] = useState<DisinfState>({
    dims: { L: 4, l: 2, h: 2 },
    c_cloro: 1.0,
    t_contatto: 30,
  });

  const [idraul, setIdraul] = useState<IdraulicaState>({
    overrides: {},
    connections: [],
  });

  const Q_med = calcPortate(portate).Q_med;

  return (
    <div style={{
      display: 'flex',
      height: '100vh',
      background: C.bg,
      color: C.text,
      ...mono,
      overflow: 'hidden',
    }}>
      {/* SIDEBAR */}
      <div style={{
        width: 228,
        background: C.panel,
        borderRight: '1px solid ' + C.border,
        display: 'flex',
        flexDirection: 'column' as const,
        flexShrink: 0,
        overflow: 'hidden',
      }}>
        {/* Logo */}
        <div style={{ padding: '18px 16px 14px', borderBottom: '1px solid ' + C.border }}>
          <div style={{ fontSize: 11, color: C.blue, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase' as const, marginBottom: 3 }}>
            SBR Designer
          </div>
          <div style={{ fontSize: 10, color: C.textMid, lineHeight: 1.4 }}>
            {NORM.nome}
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '8px 0', overflowY: 'auto' as const }}>
          {SECTIONS.map(sec => {
            const isActive = activeSection === sec.id;
            return (
              <button
                key={sec.id}
                onClick={() => setActiveSection(sec.id)}
                style={{
                  ...mono,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  padding: '9px 16px',
                  background: isActive ? '#1c2128' : 'transparent',
                  borderTop: 'none',
                  borderRight: 'none',
                  borderBottom: 'none',
                  borderLeft: isActive ? '3px solid ' + sec.accent : '3px solid transparent',
                  color: isActive ? C.text : C.textMid,
                  cursor: 'pointer',
                  textAlign: 'left' as const,
                  fontSize: 13,
                  fontWeight: isActive ? 600 : 400,
                }}
              >
                <span style={{ fontSize: 14, color: isActive ? sec.accent : C.textMid, width: 16, textAlign: 'center' as const }}>
                  {sec.icon}
                </span>
                {sec.label}
              </button>
            );
          })}
        </nav>

        {/* Footer sidebar */}
        <div style={{ padding: '12px 16px', borderTop: '1px solid ' + C.border }}>
          <div style={{ ...mono, fontSize: 10, color: C.textMid, marginBottom: 4 }}>
            Q med
          </div>
          <div style={{ ...mono, fontSize: 16, fontWeight: 700, color: C.blue }}>
            {fmt(Q_med, 1) + ' m3/g'}
          </div>
        </div>
      </div>

      {/* MAIN */}
      <div style={{ flex: 1, overflowY: 'auto' as const, padding: '28px 32px' }}>
        {activeSection === 'dati' && (
          <DatiGenerali dati={dati} setDati={setDati} />
        )}
        {activeSection === 'portate' && (
          <Portate p={portate} setP={setPortate} />
        )}
        {activeSection === 'omogen' && (
          <Omogenizzazione o={omogen} setO={setOmogen} Q_med={Q_med} />
        )}
        {activeSection === 'denitri' && (
          <Denitrificazione d={denitri} setD={setDenitri} Q_med={Q_med} N_in={portate.N} />
        )}
        {activeSection === 'sbr' && (
          <SBR s={sbr} setS={setSbr} Q_med={Q_med} BOD5_in={portate.BOD5} />
        )}
        {activeSection === 'disinf' && (
          <Disinfezione d={disinf} setD={setDisinf} Q_med={Q_med} />
        )}
        {activeSection === 'idraul' && (
          <IdraulicaSection
            omogen={omogen} denitri={denitri} sbr={sbr} disinf={disinf}
            idraul={idraul} setIdraul={setIdraul}
            Q_calc={calcPortate(portate).Q_calc}
          />
        )}
        {activeSection === 'riepilogo' && (
          <Riepilogo
            dati={dati}
            portate={portate}
            omogen={omogen}
            denitri={denitri}
            sbr={sbr}
            disinf={disinf}
          />
        )}
      </div>
    </div>
  );
}
