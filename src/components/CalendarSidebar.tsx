import { Checkbox } from '@base-ui/react/checkbox';
import { Switch } from '@base-ui/react/switch';
import { Check, Plus, RefreshCw, Sparkles, Trash2, X } from 'lucide-react';
import type { AvailabilityBlock, CalendarSource } from '../types';

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
}: CalendarSidebarProps) {
  const totalMinutes = blocks.reduce(
    (acc, b) => acc + Math.round((b.endMs - b.startMs) / 60000),
    0
  );
  const totalHoursLabel =
    totalMinutes > 0
      ? `${(totalMinutes / 60).toFixed(totalMinutes % 60 === 0 ? 0 : 1)}h selected`
      : 'Drag on grid to highlight';

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
          Click and drag across any day column to highlight available times. Click × on a block to
          remove it.
        </p>
      </div>
    </aside>
  );
}
