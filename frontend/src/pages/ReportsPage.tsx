import { useState } from 'react';
import { FileText, Download, Calendar, Loader2 } from 'lucide-react';
import api from '../services/api';

export default function ReportsPage() {
  const today = new Date();
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);

  const [periodFrom, setPeriodFrom] = useState(formatDate(firstDay));
  const [periodTo, setPeriodTo] = useState(formatDate(today));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function downloadMonthly() {
    setLoading(true);
    setError('');
    try {
      const response = await api.get('/reports/monthly', {
        params: { period_from: periodFrom, period_to: periodTo },
        responseType: 'blob',
      });
      downloadBlob(response.data, `soc_report_${periodFrom}_${periodTo}.pdf`);
    } catch (err: unknown) {
      const msg = await extractError(err);
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ padding: '2rem', maxWidth: 900, margin: '0 auto' }}>
      <div style={{ marginBottom: '1.5rem' }}>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: '#fff', margin: 0 }}>
          Отчёты
        </h1>
        <p style={{ color: '#94a3b8', fontSize: '0.875rem', marginTop: 4 }}>
          Генерация PDF-отчётов по инцидентам
        </p>
      </div>

      {error && (
        <div style={{
          padding: '0.75rem 1rem', marginBottom: '1rem',
          background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)',
          borderRadius: 8, color: '#ef4444', fontSize: '0.875rem',
        }}>
          {error}
        </div>
      )}

      {/* Monthly Report Card */}
      <div style={{
        background: '#1e293b', border: '1px solid #334155',
        borderRadius: 12, padding: '1.5rem', marginBottom: '1rem',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: '1rem' }}>
          <FileText size={20} style={{ color: '#3b82f6' }} />
          <h2 style={{ fontSize: '1.125rem', fontWeight: 600, color: '#fff', margin: 0 }}>
            Отчёт SOC за период
          </h2>
        </div>
        <p style={{ color: '#94a3b8', fontSize: '0.875rem', marginBottom: '1rem' }}>
          Сводный отчёт по всем инцидентам за выбранный период. Включает статистику по приоритетам,
          статусам и список инцидентов.
        </p>

        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '1rem', flexWrap: 'wrap' }}>
          <div>
            <label style={{ display: 'block', color: '#94a3b8', fontSize: '0.8rem', marginBottom: 4 }}>
              <Calendar size={12} style={{ display: 'inline', marginRight: 4 }} />
              Начало периода
            </label>
            <input
              type="date"
              value={periodFrom}
              onChange={(e) => setPeriodFrom(e.target.value)}
              style={{
                padding: '0.5rem 0.75rem',
                background: '#0f172a', border: '1px solid #334155',
                borderRadius: 8, color: '#fff', fontSize: '0.875rem',
                outline: 'none',
              }}
            />
          </div>
          <div>
            <label style={{ display: 'block', color: '#94a3b8', fontSize: '0.8rem', marginBottom: 4 }}>
              <Calendar size={12} style={{ display: 'inline', marginRight: 4 }} />
              Конец периода
            </label>
            <input
              type="date"
              value={periodTo}
              onChange={(e) => setPeriodTo(e.target.value)}
              style={{
                padding: '0.5rem 0.75rem',
                background: '#0f172a', border: '1px solid #334155',
                borderRadius: 8, color: '#fff', fontSize: '0.875rem',
                outline: 'none',
              }}
            />
          </div>
          <button
            onClick={downloadMonthly}
            disabled={loading}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '0.5rem 1.25rem',
              background: loading ? '#475569' : '#3b82f6',
              color: '#fff', border: 'none',
              borderRadius: 8, cursor: loading ? 'not-allowed' : 'pointer',
              fontWeight: 600, fontSize: '0.875rem', height: 38,
            }}
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
            {loading ? 'Генерация...' : 'Скачать PDF'}
          </button>
        </div>
      </div>

      {/* Info */}
      <div style={{
        background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.2)',
        borderRadius: 12, padding: '1rem 1.25rem',
        color: '#93c5fd', fontSize: '0.85rem',
      }}>
        <strong>Совет:</strong> Вы также можете скачать PDF-отчёт по отдельному инциденту
        на странице детализации инцидента (кнопка «Скачать PDF»).
      </div>
    </div>
  );
}

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

function downloadBlob(blob: Blob, filename: string) {
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);
}

async function extractError(err: unknown): Promise<string> {
  const resp = (err as { response?: { data?: Blob } })?.response?.data;
  if (resp instanceof Blob) {
    try {
      const text = await resp.text();
      const json = JSON.parse(text);
      return json.detail || 'Ошибка генерации отчёта';
    } catch {
      return 'Ошибка генерации отчёта';
    }
  }
  return 'Ошибка генерации отчёта';
}
