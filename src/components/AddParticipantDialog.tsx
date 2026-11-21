import { useEffect, useMemo, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Users, X } from 'lucide-react';
import type { AvailabilityBlock, ParticipantAvailability } from '../types';
import { parseAvailabilityText } from '../utils/availabilityParser';
import {
  formatTime,
  getWeekDates,
  type TimeZoneOption,
} from '../utils/temporal';
import { TimeZoneSelect } from './TimeZoneSelect';

const PARTICIPANT_COLORS = [
  '#2563eb',
  '#7c3aed',
  '#db2777',
  '#ea580c',
  '#059669',
  '#0891b2',
];

interface AddParticipantDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingParticipant: ParticipantAvailability | null;
  defaultTimeZone: string;
  displayTimeZone: string;
  currentWeekStart: string;
  timeZoneOptions: TimeZoneOption[];
  existingCount: number;
  onSave: (data: {
    id?: string;
    name: string;
    color: string;
    rawText: string;
    defaultTimeZone: string;
    referenceWeekStart: string;
    blocks: AvailabilityBlock[];
  }) => void;
}

export function AddParticipantDialog({
  open,
  onOpenChange,
  editingParticipant,
  defaultTimeZone,
  displayTimeZone,
  currentWeekStart,
  timeZoneOptions,
  existingCount,
  onSave,
}: AddParticipantDialogProps) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(PARTICIPANT_COLORS[0]);
  const [rawText, setRawText] = useState('');
  const [assumedTz, setAssumedTz] = useState(defaultTimeZone);
  const [refWeekStart, setRefWeekStart] = useState(currentWeekStart);

  useEffect(() => {
    if (!open) return;
    if (editingParticipant) {
      setName(editingParticipant.name);
      setColor(editingParticipant.color);
      setRawText(editingParticipant.rawText);
      setAssumedTz(editingParticipant.defaultTimeZone);
      setRefWeekStart(editingParticipant.referenceWeekStart);
    } else {
      setName('');
      setColor(PARTICIPANT_COLORS[existingCount % PARTICIPANT_COLORS.length]);
      setRawText('');
      setAssumedTz(defaultTimeZone);
      setRefWeekStart(currentWeekStart);
    }
  }, [open, editingParticipant, defaultTimeZone, currentWeekStart, existingCount]);

  const parsed = useMemo(() => {
    if (!rawText.trim()) {
      return { blocks: [], detectedTimeZone: null, lines: [], warnings: [] };
    }
    return parseAvailabilityText(rawText, {
      defaultTimeZone: assumedTz,
      referenceWeekStart: refWeekStart,
    });
  }, [rawText, assumedTz, refWeekStart]);

  const previewByDay = useMemo(() => {
    const grouped = new Map<string, { label: string; ranges: string[] }>();
    for (const block of parsed.blocks) {
      const startZ = Temporal.Instant.fromEpochMilliseconds(block.startMs).toZonedDateTimeISO(
        displayTimeZone
      );
      const endZ = Temporal.Instant.fromEpochMilliseconds(block.endMs).toZonedDateTimeISO(
        displayTimeZone
      );
      const dayKey = startZ.toPlainDate().toString();
      const label = startZ.toLocaleString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });
      const entry = grouped.get(dayKey) ?? { label, ranges: [] };
      entry.ranges.push(`${formatTime(startZ)} – ${formatTime(endZ)}`);
      grouped.set(dayKey, entry);
    }
    return Array.from(grouped.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [parsed.blocks, displayTimeZone]);

  const refWeekLabel = useMemo(() => {
    const days = getWeekDates(refWeekStart);
    const startZ = Temporal.PlainDate.from(days[0]).toZonedDateTime({
      timeZone: displayTimeZone,
      plainTime: '12:00',
    });
    const endZ = Temporal.PlainDate.from(days[6]).toZonedDateTime({
      timeZone: displayTimeZone,
      plainTime: '12:00',
    });
    return `${startZ.toLocaleString('en-US', { month: 'short', day: 'numeric' })} – ${endZ.toLocaleString('en-US', { month: 'short', day: 'numeric' })}`;
  }, [refWeekStart, displayTimeZone]);

  const shiftRefWeek = (deltaDays: number) => {
    setRefWeekStart(Temporal.PlainDate.from(refWeekStart).add({ days: deltaDays }).toString());
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (parsed.blocks.length === 0) return;

    const finalName = name.trim() || `Person ${existingCount + 1}`;
    onSave({
      id: editingParticipant?.id,
      name: finalName,
      color,
      rawText,
      defaultTimeZone: parsed.detectedTimeZone ?? assumedTz,
      referenceWeekStart: refWeekStart,
      blocks: parsed.blocks,
    });
    onOpenChange(false);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="base-dialog-backdrop" />
        <Dialog.Popup className="base-dialog-popup base-dialog-popup-wide">
          <div className="dialog-header">
            <div>
              <Dialog.Title className="dialog-title">
                {editingParticipant ? `Edit ${editingParticipant.name}'s Availability` : 'Paste Someone’s Availability'}
              </Dialog.Title>
              <Dialog.Description className="dialog-description">
                Paste SlotPicker output or email times (e.g. &ldquo;Tue 2–4 PM EST, Thu 10am–12pm&rdquo;).
              </Dialog.Description>
            </div>
            <Dialog.Close className="icon-btn" aria-label="Close dialog">
              <X size={18} />
            </Dialog.Close>
          </div>

          <form className="dialog-form" onSubmit={handleSubmit}>
            <div className="participant-form-row">
              <label className="form-field participant-name-field">
                <span>Person&apos;s name</span>
                <input
                  type="text"
                  className="text-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={`e.g. Alex (defaults to Person ${existingCount + 1})`}
                  autoFocus
                />
              </label>

              <div className="form-field">
                <span>Color</span>
                <div className="color-picker-row">
                  {PARTICIPANT_COLORS.map((c) => (
                    <button
                      key={c}
                      type="button"
                      className={`color-swatch ${color === c ? 'is-selected' : ''}`}
                      style={{ backgroundColor: c }}
                      onClick={() => setColor(c)}
                      aria-label={`Select color ${c}`}
                    />
                  ))}
                </div>
              </div>
            </div>

            <div className="participant-meta-row">
              <div className="form-field">
                <span className="field-label-with-badge">
                  <span>Assumed time zone</span>
                  {parsed.detectedTimeZone && (
                    <span className="tz-detected-badge">
                      Detected: {parsed.detectedTimeZone}
                    </span>
                  )}
                </span>
                <TimeZoneSelect
                  value={assumedTz}
                  onValueChange={setAssumedTz}
                  options={timeZoneOptions}
                  ariaLabel="Assumed time zone for pasted text"
                />
              </div>

              <div className="form-field">
                <span>Reference week (for weekday-only lines)</span>
                <div className="ref-week-picker">
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => shiftRefWeek(-7)}
                    aria-label="Previous reference week"
                  >
                    <ChevronLeft size={15} />
                  </button>
                  <span className="ref-week-label">{refWeekLabel}</span>
                  <button
                    type="button"
                    className="icon-btn"
                    onClick={() => shiftRefWeek(7)}
                    aria-label="Next reference week"
                  >
                    <ChevronRight size={15} />
                  </button>
                </div>
              </div>
            </div>

            <label className="form-field">
              <span>Availability text</span>
              <textarea
                className="paste-textarea"
                rows={6}
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder={`Paste availability here, for example:\n• Tue, Nov 24: 10:00 AM – 12:00 PM, 2:00 PM – 4:30 PM EST\n• Thu 1–3pm PST\n\nOr paste a full SlotPicker bullet list directly.`}
              />
            </label>

            <div className="parse-preview-panel">
              <div className="parse-preview-header">
                <span className="parse-preview-title">
                  <Users size={13} />
                  Parsed preview ({displayTimeZone.split('/').pop()?.replace(/_/g, ' ')})
                </span>
                <span className="parse-preview-count">
                  {parsed.blocks.length}{' '}
                  {parsed.blocks.length === 1 ? 'block' : 'blocks'} found
                </span>
              </div>

              {previewByDay.length > 0 ? (
                <ul className="parse-preview-list">
                  {previewByDay.map(([dayKey, { label, ranges }]) => (
                    <li key={dayKey} className="parse-preview-day">
                      <strong>{label}:</strong> <span>{ranges.join(', ')}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="parse-preview-empty">
                  {rawText.trim()
                    ? 'No valid date + time ranges detected yet. Try adding a day name or date (e.g. "Tue 2-4 PM").'
                    : 'Paste availability above to see parsed slots in real time.'}
                </p>
              )}

              {parsed.warnings.length > 0 && (
                <div className="parse-warnings-box">
                  <div className="parse-warnings-title">
                    <AlertTriangle size={13} />
                    <span>
                      {parsed.warnings.length}{' '}
                      {parsed.warnings.length === 1 ? 'line skipped' : 'lines skipped'}
                    </span>
                  </div>
                  <ul className="parse-warnings-list">
                    {parsed.warnings.slice(0, 4).map((w, idx) => (
                      <li key={idx}>{w}</li>
                    ))}
                    {parsed.warnings.length > 4 && (
                      <li>…and {parsed.warnings.length - 4} more</li>
                    )}
                  </ul>
                </div>
              )}
            </div>

            <div className="dialog-footer-end">
              <Dialog.Close className="btn btn-secondary">Cancel</Dialog.Close>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={parsed.blocks.length === 0}
              >
                <Check size={15} />
                {editingParticipant ? 'Update Availability' : 'Add to Group Heatmap'}
              </button>
            </div>
          </form>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
