import { Checkbox } from '@base-ui/react/checkbox';
import { Select } from '@base-ui/react/select';
import { Switch } from '@base-ui/react/switch';
import {
  Check,
  ChevronDown,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import type { AvailabilityBlock, CalendarSource } from '../types';
import { formatMinutesLabel } from '../utils/temporal';

const WORK_TIME_OPTIONS = Array.from({ length: 33 }, (_, i) => 6 * 60 + i * 30); // 6:00 AM .. 10:00 PM

interface CalendarSidebarProps {
  calendars: CalendarSource[];
  onToggleCalendar: (id: string) => void;
  onRemoveCalendar: (id: string) => void;
  onOpenConnect: () => void;
  onRefresh: () => void;
  onLoadDemo: () => void;
  isRefreshing: boolean;
  availabilityCount: number;
  onClearAvailability: () => void;
  showWeekends: boolean;
  onToggleWeekends: (val: boolean) => void;
  startOnMonday: boolean;
  onToggleStartOnMonday: (val: boolean) => void;
  blocks: AvailabilityBlock[];
  workStartMin: number;
  workEndMin: number;
  onChangeWorkStart: (min: number) => void;
  onChangeWorkEnd: (min: number) => void;
  onFillFreeWeekdays: () => void;
}

export function CalendarSidebar({
  calendars,
  onToggleCalendar,
  onRemoveCalendar,
  onOpenConnect,
  onRefresh,
  onLoadDemo,
  isRefreshing,
  availabilityCount,
  onClearAvailability,
  showWeekends,
  onToggleWeekends,
  startOnMonday,
  onToggleStartOnMonday,
  blocks,
  workStartMin,
  workEndMin,
  onChangeWorkStart,
  onChangeWorkEnd,
  onFillFreeWeekdays,
}: CalendarSidebarProps) {
  const totalMinutes = blocks.reduce(
    (acc, b) => acc + Math.round((b.endMs - b.startMs) / 60000),
    0
  );
  const totalHoursLabel =
    totalMinutes > 0
      ? `${(totalMinutes / 60).toFixed(totalMinutes % 60 === 0 ? 0 : 1)}h selected`
      : 'Drag or click + Free';

  return (
    <aside className="sidebar">
      <div className="sidebar-section">
        <div className="sidebar-section-header">
          <h2 className="sidebar-heading">Calendars</h2>
          <div className="sidebar-actions">
            <button
              type="button"
              className="icon-btn"
              onClick={onRefresh}
              disabled={isRefreshing}
              title="Refresh calendars"
              aria-label="Refresh calendars"
            >
              <RefreshCw size={15} className={isRefreshing ? 'spin' : ''} />
            </button>
            <button
              type="button"
              className="icon-btn"
              onClick={onOpenConnect}
              title="Connect Google Calendar or iCal"
              aria-label="Connect Google Calendar or iCal"
            >
              <Plus size={16} />
            </button>
          </div>
        </div>

        <ul className="calendar-list">
          {calendars.map((cal) => (
            <li key={cal.id} className="calendar-item">
              <label className="calendar-checkbox-label">
                <Checkbox.Root
                  checked={cal.enabled}
                  onCheckedChange={() => onToggleCalendar(cal.id)}
                  className="base-checkbox"
                  style={
                    {
                      '--cal-color': cal.color,
                    } as React.CSSProperties
                  }
                >
                  <Checkbox.Indicator className="base-checkbox-indicator">
                    <Check size={12} strokeWidth={3} />
                  </Checkbox.Indicator>
                </Checkbox.Root>
                <span className="calendar-name" title={cal.name}>
                  {cal.name}
                </span>
              </label>

              {cal.provider !== 'google-oauth' && (
                <button
                  type="button"
                  className="calendar-remove-btn"
                  onClick={() => onRemoveCalendar(cal.id)}
                  title={`Remove ${cal.name}`}
                  aria-label={`Remove ${cal.name}`}
                >
                  <X size={13} />
                </button>
              )}
            </li>
          ))}
        </ul>

        <div className="sidebar-connect-stack">
          <button type="button" className="btn btn-secondary btn-full" onClick={onOpenConnect}>
            <Plus size={15} />
            Connect Google / iCal
          </button>
          {!calendars.some((c) => c.provider === 'demo') && (
            <button type="button" className="btn btn-ghost btn-full" onClick={onLoadDemo}>
              <Sparkles size={14} />
              Load Sample Calendars
            </button>
          )}
        </div>
      </div>

      <div className="sidebar-divider" />

      <div className="sidebar-section">
        <h2 className="sidebar-heading">Working Hours</h2>
        <div className="work-hours-row">
          <Select.Root
            value={String(workStartMin)}
            onValueChange={(val) => {
              if (!val) return;
              const next = Number(val);
              onChangeWorkStart(next);
              if (next >= workEndMin) {
                onChangeWorkEnd(Math.min(22 * 60, next + 60));
              }
            }}
          >
            <Select.Trigger className="base-select-trigger work-hour-select" aria-label="Working hours start">
              <Select.Value>{formatMinutesLabel(workStartMin)}</Select.Value>
              <Select.Icon className="base-select-icon">
                <ChevronDown size={13} />
              </Select.Icon>
            </Select.Trigger>
            <Select.Portal>
              <Select.Positioner className="base-select-positioner" sideOffset={4}>
                <Select.Popup className="base-select-popup work-hour-popup">
                  <Select.List className="base-select-list">
                    {WORK_TIME_OPTIONS.slice(0, -1).map((m) => (
                      <Select.Item key={m} value={String(m)} className="base-select-item">
                        <Select.ItemIndicator className="base-select-item-indicator">
                          <Check size={12} />
                        </Select.ItemIndicator>
                        <Select.ItemText>{formatMinutesLabel(m)}</Select.ItemText>
                      </Select.Item>
                    ))}
                  </Select.List>
                </Select.Popup>
              </Select.Positioner>
            </Select.Portal>
          </Select.Root>

          <span className="work-hours-sep">to</span>

          <Select.Root
            value={String(workEndMin)}
            onValueChange={(val) => {
              if (!val) return;
              const next = Number(val);
              onChangeWorkEnd(next);
              if (next <= workStartMin) {
                onChangeWorkStart(Math.max(6 * 60, next - 60));
              }
            }}
          >
            <Select.Trigger className="base-select-trigger work-hour-select" aria-label="Working hours end">
              <Select.Value>{formatMinutesLabel(workEndMin)}</Select.Value>
              <Select.Icon className="base-select-icon">
                <ChevronDown size={13} />
              </Select.Icon>
            </Select.Trigger>
            <Select.Portal>
              <Select.Positioner className="base-select-positioner" sideOffset={4}>
                <Select.Popup className="base-select-popup work-hour-popup">
                  <Select.List className="base-select-list">
                    {WORK_TIME_OPTIONS.slice(1).map((m) => (
                      <Select.Item key={m} value={String(m)} className="base-select-item">
                        <Select.ItemIndicator className="base-select-item-indicator">
                          <Check size={12} />
                        </Select.ItemIndicator>
                        <Select.ItemText>{formatMinutesLabel(m)}</Select.ItemText>
                      </Select.Item>
                    ))}
                  </Select.List>
                </Select.Popup>
              </Select.Positioner>
            </Select.Portal>
          </Select.Root>
        </div>

        <button
          type="button"
          className="btn btn-secondary btn-full btn-sm"
          onClick={onFillFreeWeekdays}
          title="Select all meeting-free times within working hours for Mon–Fri this week"
        >
          <Wand2 size={14} />
          Fill Free Time (Mon–Fri)
        </button>
      </div>

      <div className="sidebar-divider" />

      <div className="sidebar-section">
        <h2 className="sidebar-heading">View Options</h2>
        <div className="switch-row">
          <span className="switch-label">Show weekends</span>
          <Switch.Root
            checked={showWeekends}
            onCheckedChange={onToggleWeekends}
            className="base-switch"
            aria-label="Show weekends"
          >
            <Switch.Thumb className="base-switch-thumb" />
          </Switch.Root>
        </div>
        <div className="switch-row">
          <span className="switch-label">Start week on Monday</span>
          <Switch.Root
            checked={startOnMonday}
            onCheckedChange={onToggleStartOnMonday}
            className="base-switch"
            aria-label="Start week on Monday"
          >
            <Switch.Thumb className="base-switch-thumb" />
          </Switch.Root>
        </div>
      </div>

      <div className="sidebar-divider" />

      <div className="sidebar-section">
        <div className="sidebar-section-header">
          <h2 className="sidebar-heading">Availability</h2>
          {availabilityCount > 0 && (
            <button
              type="button"
              className="text-btn-danger"
              onClick={onClearAvailability}
              title="Clear all highlighted slots"
            >
              <Trash2 size={13} />
              Clear
            </button>
          )}
        </div>
        <p className="sidebar-hint">
          <strong>{availabilityCount}</strong> {availabilityCount === 1 ? 'block' : 'blocks'} ·{' '}
          {totalHoursLabel}
        </p>
        <p className="sidebar-subhint">
          Click <strong>+ Free</strong> on any day header to auto-select open times within working
          hours, or drag across the grid.
        </p>
      </div>
    </aside>
  );
}
