import { useEffect, useMemo, useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Tabs } from '@base-ui/react/tabs';
import { Check, Copy, Users, X } from 'lucide-react';
import type { AvailabilityBlock, BulletFormat, ParticipantAvailability } from '../types';
import { computeSharedAvailabilityBlocks } from '../utils/sharedAvailability';
import { formatAvailabilityBulletList, type TimeZoneOption } from '../utils/temporal';
import { TimeZoneSelect } from './TimeZoneSelect';

type ExportSource = 'mine' | 'shared';

interface AvailabilityOutputDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  blocks: AvailabilityBlock[];
  includeMeInHeatmap: boolean;
  participants: ParticipantAvailability[];
  defaultSource?: ExportSource;
  defaultMinOverlap?: number;
  outputTimeZone: string;
  onChangeOutputTimeZone: (tz: string) => void;
  timeZoneOptions: TimeZoneOption[];
}

export function AvailabilityOutputDialog({
  open,
  onOpenChange,
  blocks,
  includeMeInHeatmap,
  participants,
  defaultSource = 'mine',
  defaultMinOverlap,
  outputTimeZone,
  onChangeOutputTimeZone,
  timeZoneOptions,
}: AvailabilityOutputDialogProps) {
  const [format, setFormat] = useState<BulletFormat>('standard');
  const [source, setSource] = useState<ExportSource>(defaultSource);
  const [copied, setCopied] = useState(false);

  const hasOthers = participants.length > 0;

  const groupParticipants = useMemo(
    () => [
      { id: '__me__', name: 'Me', enabled: includeMeInHeatmap, blocks },
      ...participants.map((p) => ({
        id: p.id,
        name: p.name,
        enabled: p.enabled,
        blocks: p.blocks,
      })),
    ],
    [includeMeInHeatmap, blocks, participants]
  );

  const enabledParticipants = useMemo(
    () => groupParticipants.filter((p) => p.enabled),
    [groupParticipants]
  );

  const totalEnabled = enabledParticipants.length;
  const [minOverlap, setMinOverlap] = useState<number>(defaultMinOverlap ?? Math.max(1, totalEnabled));

  useEffect(() => {
    if (!open) return;
    setSource(hasOthers ? defaultSource : 'mine');
    setMinOverlap(
      defaultMinOverlap
        ? Math.max(1, Math.min(defaultMinOverlap, Math.max(1, totalEnabled)))
        : Math.max(1, totalEnabled)
    );
  }, [open, hasOthers, defaultSource, defaultMinOverlap, totalEnabled]);

  const effectiveMinOverlap = Math.max(1, Math.min(minOverlap, Math.max(1, totalEnabled)));

  const activeBlocks = useMemo(() => {
    if (source === 'mine' || !hasOthers) return blocks;
    return computeSharedAvailabilityBlocks(groupParticipants, effectiveMinOverlap);
  }, [source, hasOthers, blocks, groupParticipants, effectiveMinOverlap]);

  const headingPrefix = useMemo(() => {
    if (source === 'mine' || !hasOthers) return 'Available Times';
    if (effectiveMinOverlap === totalEnabled) {
      return `Shared Available Times — All ${totalEnabled} available`;
    }
    return `Shared Available Times — At least ${effectiveMinOverlap} of ${totalEnabled} available`;
  }, [source, hasOthers, effectiveMinOverlap, totalEnabled]);

  const bulletText = useMemo(
    () => formatAvailabilityBulletList(activeBlocks, outputTimeZone, format, headingPrefix),
    [activeBlocks, outputTimeZone, format, headingPrefix]
  );

  const handleCopy = async () => {
    if (!bulletText) return;
    await navigator.clipboard.writeText(bulletText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const overlapOptions = useMemo(() => {
    if (totalEnabled <= 1) return [1];
    const opts: number[] = [];
    for (let k = totalEnabled; k >= Math.min(2, totalEnabled); k--) {
      opts.push(k);
    }
    return opts;
  }, [totalEnabled]);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="base-dialog-backdrop" />
        <Dialog.Popup className="base-dialog-popup base-dialog-popup-wide">
          <div className="dialog-header">
            <div>
              <Dialog.Title className="dialog-title">
                {source === 'shared' && hasOthers ? 'Shared Available Times' : 'Your Available Times'}
              </Dialog.Title>
              <Dialog.Description className="dialog-description">
                Ready to paste into an email, Slack message, or invite.
              </Dialog.Description>
            </div>
            <Dialog.Close className="icon-btn" aria-label="Close dialog">
              <X size={18} />
            </Dialog.Close>
          </div>

          {hasOthers && (
            <div className="output-source-bar">
              <Tabs.Root
                value={source}
                onValueChange={(val) => setSource(val as ExportSource)}
              >
                <Tabs.List className="base-tabs-list">
                  <Tabs.Tab value="mine" className="base-tab">
                    My Availability
                  </Tabs.Tab>
                  <Tabs.Tab value="shared" className="base-tab">
                    <Users size={13} />
                    Shared Availability
                  </Tabs.Tab>
                </Tabs.List>
              </Tabs.Root>

              {source === 'shared' && totalEnabled >= 2 && (
                <div className="output-overlap-filter">
                  <span className="control-caption">Minimum overlap:</span>
                  <div className="heatmap-filter-group">
                    {overlapOptions.map((k) => (
                      <button
                        key={k}
                        type="button"
                        className={`heatmap-filter-pill ${effectiveMinOverlap === k ? 'is-active' : ''}`}
                        onClick={() => setMinOverlap(k)}
                      >
                        {k === totalEnabled ? `All (${k}/${totalEnabled})` : `≥ ${k} of ${totalEnabled}`}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {source === 'shared' && hasOthers && enabledParticipants.length > 0 && (
            <div className="output-participants-caption">
              Comparing: {enabledParticipants.map((p) => p.name).join(', ')}
            </div>
          )}

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
              {source === 'shared' && hasOthers
                ? `No overlapping times found with at least ${effectiveMinOverlap} of ${totalEnabled} people available. Try lowering the minimum overlap or adding more availability.`
                : 'No times highlighted yet. Drag across any day column on the calendar to select your available windows.'}
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
