import { Select } from '@base-ui/react/select';
import { Check, ChevronDown, Globe } from 'lucide-react';
import type { TimeZoneOption } from '../utils/temporal';

interface TimeZoneSelectProps {
  value: string;
  onValueChange: (tz: string) => void;
  options: TimeZoneOption[];
  ariaLabel?: string;
}

export function TimeZoneSelect({
  value,
  onValueChange,
  options,
  ariaLabel = 'Select time zone',
}: TimeZoneSelectProps) {
  const selectedLabel = options.find((o) => o.id === value)?.label ?? value;

  return (
    <Select.Root
      value={value}
      onValueChange={(val) => {
        if (val) onValueChange(val);
      }}
    >
      <Select.Trigger className="base-select-trigger" aria-label={ariaLabel}>
        <Globe size={14} className="select-leading-icon" />
        <Select.Value className="base-select-value">{selectedLabel}</Select.Value>
        <Select.Icon className="base-select-icon">
          <ChevronDown size={14} />
        </Select.Icon>
      </Select.Trigger>

      <Select.Portal>
        <Select.Positioner className="base-select-positioner" sideOffset={6} align="end">
          <Select.Popup className="base-select-popup">
            <Select.List className="base-select-list">
              {options.map((opt) => (
                <Select.Item key={opt.id} value={opt.id} className="base-select-item">
                  <Select.ItemIndicator className="base-select-item-indicator">
                    <Check size={13} />
                  </Select.ItemIndicator>
                  <Select.ItemText>{opt.label}</Select.ItemText>
                </Select.Item>
              ))}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
  );
}
