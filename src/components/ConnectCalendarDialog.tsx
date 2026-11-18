import { useState } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Tabs } from '@base-ui/react/tabs';
import { CalendarPlus, Link2, Upload, X } from 'lucide-react';

interface ConnectCalendarDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  savedClientId: string;
  onConnectGoogleOAuth: (clientId: string) => Promise<void>;
  onAddIcalUrl: (name: string, url: string, color: string) => Promise<void>;
  onAddIcalFile: (name: string, icsText: string, color: string) => Promise<void>;
}

const PRESET_COLORS = [
  '#2563eb',
  '#7c3aed',
  '#db2777',
  '#ea580c',
  '#059669',
  '#0891b2',
];

export function ConnectCalendarDialog({
  open,
  onOpenChange,
  savedClientId,
  onConnectGoogleOAuth,
  onAddIcalUrl,
  onAddIcalFile,
}: ConnectCalendarDialogProps) {
  const [clientId, setClientId] = useState(savedClientId);
  const [icalUrl, setIcalUrl] = useState('');
  const [icalName, setIcalName] = useState('');
  const [color, setColor] = useState(PRESET_COLORS[0]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientId.trim()) {
      setError('Please enter your Google OAuth Web Client ID.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await onConnectGoogleOAuth(clientId.trim());
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to connect Google Calendar.');
    } finally {
      setLoading(false);
    }
  };

  const handleIcalUrlSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!icalUrl.trim()) {
      setError('Please paste an iCal (.ics) URL.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      await onAddIcalUrl(icalName.trim() || 'Google Calendar (iCal)', icalUrl.trim(), color);
      setIcalUrl('');
      setIcalName('');
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load iCal feed.');
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setLoading(true);
    try {
      const text = await file.text();
      const baseName = file.name.replace(/\.ics$/i, '');
      await onAddIcalFile(icalName.trim() || baseName || 'Imported Calendar', text, color);
      setIcalName('');
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not parse .ics file.');
    } finally {
      setLoading(false);
      e.target.value = '';
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Backdrop className="base-dialog-backdrop" />
        <Dialog.Popup className="base-dialog-popup">
          <div className="dialog-header">
            <div>
              <Dialog.Title className="dialog-title">Connect Google Calendar</Dialog.Title>
              <Dialog.Description className="dialog-description">
                Visualize all your calendars side-by-side before highlighting availability.
              </Dialog.Description>
            </div>
            <Dialog.Close className="icon-btn" aria-label="Close dialog">
              <X size={18} />
            </Dialog.Close>
          </div>

          <Tabs.Root defaultValue="oauth" className="base-tabs">
            <Tabs.List className="base-tabs-list">
              <Tabs.Tab value="oauth" className="base-tab">
                <CalendarPlus size={14} />
                Google Sign-In (OAuth)
              </Tabs.Tab>
              <Tabs.Tab value="ical" className="base-tab">
                <Link2 size={14} />
                iCal URL / .ics File
              </Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value="ical" className="base-tab-panel">
              <p className="panel-help">
                <strong>Fastest setup (no API keys):</strong> In Google Calendar, open{' '}
                <em>Settings → [Your Calendar] → Integrate calendar</em> and copy the{' '}
                <strong>Secret address in iCal format</strong>.
              </p>

              <form onSubmit={handleIcalUrlSubmit} className="form-stack">
                <label className="field-label">
                  <span>Calendar Name (optional)</span>
                  <input
                    type="text"
                    className="text-input"
                    placeholder="e.g. Work, Personal, Family"
                    value={icalName}
                    onChange={(e) => setIcalName(e.target.value)}
                  />
                </label>

                <label className="field-label">
                  <span>Secret iCal URL</span>
                  <input
                    type="url"
                    className="text-input"
                    placeholder="https://calendar.google.com/calendar/ical/.../basic.ics"
                    value={icalUrl}
                    onChange={(e) => setIcalUrl(e.target.value)}
                  />
                </label>

                <div className="field-label">
                  <span>Color</span>
                  <div className="color-picker-row">
                    {PRESET_COLORS.map((c) => (
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

                {error && <p className="form-error">{error}</p>}

                <div className="dialog-footer-between">
                  <label className="btn btn-secondary file-upload-btn">
                    <Upload size={14} />
                    Upload .ics file
                    <input
                      type="file"
                      accept=".ics,text/calendar"
                      onChange={handleFileChange}
                      hidden
                    />
                  </label>

                  <button type="submit" className="btn btn-primary" disabled={loading}>
                    {loading ? 'Loading...' : 'Add Calendar'}
                  </button>
                </div>
              </form>
            </Tabs.Panel>

            <Tabs.Panel value="oauth" className="base-tab-panel">
              <p className="panel-help">
                Connects <strong>all</strong> your Google Calendars at once via read-only OAuth
                and stores your calendar list &amp; events locally in your browser. Create a Web
                OAuth Client ID in Google Cloud Console with{' '}
                <code>{window.location.origin}</code> in Authorized JavaScript origins.
              </p>

              <form onSubmit={handleOAuthSubmit} className="form-stack">
                <label className="field-label">
                  <span>Google OAuth 2.0 Client ID</span>
                  <input
                    type="text"
                    className="text-input"
                    placeholder="1234567890-abc...apps.googleusercontent.com"
                    value={clientId}
                    onChange={(e) => setClientId(e.target.value)}
                  />
                </label>

                {error && <p className="form-error">{error}</p>}

                <div className="dialog-footer-end">
                  <button type="submit" className="btn btn-primary" disabled={loading}>
                    {loading ? 'Signing in...' : 'Sign in with Google'}
                  </button>
                </div>
              </form>
            </Tabs.Panel>
          </Tabs.Root>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
