import React, { useState } from 'react';

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
// NAVIGAZIONE
// ============================================================

const SECTIONS = [
  { id: 'dati', label: 'Dati Generali', icon: '▣', accent: C.blue },
  { id: 'portate', label: 'Portate', icon: '≋', accent: C.blue },
  { id: 'omogen', label: 'Omogenizzazione', icon: '◉', accent: C.purple },
  { id: 'denitri', label: 'Denitrificazione', icon: '⬡', accent: C.amber },
  { id: 'sbr', label: 'Reattori SBR', icon: '▦', accent: C.green },
  { id: 'disinf', label: 'Disinfezione', icon: '✦', accent: C.red },
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
