import { useMemo, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Tabs } from '@base-ui/react/tabs';
import { Check, Copy, X } from 'lucide-react';
import type { AvailabilityBlock, BulletFormat } from '../types';
import { formatAvailabilityBulletList, type TimeZoneOption } from '../utils/temporal';
import { TimeZoneSelect } from './TimeZoneSelect';

interface AvailabilityOutputDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blocks: AvailabilityBlock[];
  outputTimeZone: string;
  onChangeOutputTimeZone: (tz: string) => void;
  timeZoneOptions: TimeZoneOption[];
}

export function AvailabilityOutputDialog({
  open,
  onOpenChange,
  blocks,
  outputTimeZone,
  onChangeOutputTimeZone,
  timeZoneOptions,
}: AvailabilityOutputDialogProps) {
  const [format, setFormat] = useState<BulletFormat>('standard');
  const [copied, setCopied] = useState(false);

  const bulletText = useMemo(
    () => formatAvailabilityBulletList(blocks, outputTimeZone, format),
    [blocks, outputTimeZone, format]
  );

  const handleCopy = async () => {
    if (!bulletText) return;
    await navigator.clipboard.writeText(bulletText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="base-dialog-backdrop" />
        <Dialog.Popup className="base-dialog-popup base-dialog-popup-wide">
          <div className="dialog-header">
            <div>
              <Dialog.Title className="dialog-title">Your Available Times</Dialog.Title>
              <Dialog.Description className="dialog-description">
                Ready to paste into an email, Slack message, or invite.
              </Dialog.Description>
            </div>
            <Dialog.Close className="icon-btn" aria-label="Close dialog">
              <X size={18} />
            </Dialog.Close>
          </div>

          <div className="output-controls-row">
            <div className="output-tz-control">
              <span className="control-caption">Present times in:</span>
              <TimeZoneSelect
                value={outputTimeZone}
                onValueChange={onChangeOutputTimeZone}
                options={timeZoneOptions}
                ariaLabel="Presentation time zone"
              />
            </div>

            <Tabs.Root
              value={format}
              onValueChange={(val) => setFormat(val as BulletFormat)}
              className="format-tabs"
            >
              <Tabs.List className="base-tabs-list">
                <Tabs.Tab value="standard" className="base-tab">
                  Standard
                </Tabs.Tab>
                <Tabs.Tab value="compact" className="base-tab">
                  Compact
                </Tabs.Tab>
                <Tabs.Tab value="markdown" className="base-tab">
                  Markdown
                </Tabs.Tab>
              </Tabs.List>
            </Tabs.Root>
          </div>

          {bulletText ? (
            <pre className="output-preview-box">{bulletText}</pre>
          ) : (
            <div className="output-empty-box">
              No times highlighted yet. Drag across any day column on the calendar to select your
              available windows.
            </div>
          )}

          <div className="dialog-footer-end">
            <Dialog.Close className="btn btn-secondary">Close</Dialog.Close>
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleCopy}
              disabled={!bulletText}
            >
              {copied ? (
                <>
                  <Check size={15} />
                  Copied!
                </>
              ) : (
                <>
                  <Copy size={15} />
                  Copy Bullet List
                </>
              )}
            </button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
