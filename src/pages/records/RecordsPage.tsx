import { useState } from 'react';
import { CloudUploadIcon } from '../../app/icons';
import { Seg } from '../../app/Seg';
import { useAppStore } from '../../app/store';
import { useSyncStore } from '../../app/sync';
import { syncNoteText } from '../../app/syncText';
import { usePortfolio } from '../../app/usePortfolio';
import { RECORD_TIMES, filterRecords, groupByMonth } from '../../domain/records';
import type { RecordKind, RecordSort, RecordTime } from '../../domain/records';
import { AddRecordSheet } from './AddRecordSheet';
import { recordLine } from './recordLine';
import './records.css';
import { useT } from '../../i18n';

const KINDS: readonly RecordKind[] = ['all', 'buy', 'sell', 'deposit', 'withdraw', 'calibrate'];

/** Records: filter by period and type, sort, group by month; Add record at the top right (prototype v5 lines 207–231). */
export function RecordsPage() {
  const t = useT();
  const [time, setTime] = useState<RecordTime>('all');
  const [kind, setKind] = useState<RecordKind>('all');
  const [sort, setSort] = useState<RecordSort>('desc');
  const [adding, setAdding] = useState(false);
  const portfolio = usePortfolio();
  const transactions = useAppStore((s) => s.transactions);
  const accounts = useAppStore((s) => s.accounts);
  const today = useAppStore((s) => s.today);
  const hide = useAppStore((s) => s.hideAmounts);
  const syncNote = syncNoteText(useSyncStore(), t);

  const records = filterRecords(transactions, { time, kind, sort, today });
  const ctx = {
    instrumentByCode: portfolio.instrumentByCode,
    accountName: (id: string) => accounts.find((a) => a.id === id)?.name ?? id,
    calibrationDiffs: portfolio.ledger.calibrationDiffs,
    hide,
    t,
  };
  const kinds = KINDS.map((k) => [k, k === 'all' ? t.records.allKinds : t.common.txTypes[k]] as const);

  return (
    <section className="page records">
      <div className="records-header">
        <h1 className="page-title">{t.records.title}</h1>
        <button type="button" className="btn btn-primary" onClick={() => setAdding(true)}>
          {t.records.add}
        </button>
      </div>
      {syncNote && (
        <span className="records-sync">
          <CloudUploadIcon />
          {syncNote}
        </span>
      )}
      <div className="records-filters">
        <div className="rec-chips" role="group" aria-label={t.records.timeLabel}>
          {RECORD_TIMES.map((r) => (
            <button key={r} type="button" className="rec-chip" aria-pressed={time === r} onClick={() => setTime(r)}>
              {t.records.times[r]}
            </button>
          ))}
        </div>
        <div className="rec-types">
          <Seg label={t.records.kindLabel} options={kinds} value={kind} onChange={setKind} />
        </div>
        <div className="rec-count-row">
          <span className="rec-count">{t.records.count(records.length)}</span>
          <button type="button" className="btn btn-ghost rec-sort" onClick={() => setSort(sort === 'desc' ? 'asc' : 'desc')}>
            {sort === 'desc' ? t.records.newestFirst : t.records.oldestFirst}
          </button>
        </div>
      </div>
      {records.length === 0 && <p className="rec-empty">{t.records.empty}</p>}
      {groupByMonth(records).map((g) => (
        <div key={g.month} className="rec-group">
          <span className="rec-month">{t.records.month(g.month)}</span>
          <div className="list-box">
            {g.items.map((tx) => {
              const line = recordLine(tx, ctx);
              return (
                <div key={line.id} className="rec-row list-row">
                  <span className="rec-title">{line.title}</span>
                  <span className={`rec-type tone-${line.tone}`}>{line.typeLabel}</span>
                  <span className="rec-meta">{line.meta}</span>
                  <span className="rec-amount">
                    <span className="rec-amount-main">{line.amount}</span>
                    {line.note && (
                      <>
                        {' '}
                        <span className="rec-note">· {line.note}</span>
                      </>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ))}
      {adding && <AddRecordSheet onClose={() => setAdding(false)} />}
    </section>
  );
}
