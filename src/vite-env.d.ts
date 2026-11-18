/// <reference types="vite/client" />
import type { Temporal as TemporalType } from 'temporal-polyfill';

declare global {
  // eslint-disable-next-line no-var
  var Temporal: typeof TemporalType;
}
