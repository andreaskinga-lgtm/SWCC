import type { DesktopOperations } from '../shared/application.js';

declare global {
  interface Window { swcc: DesktopOperations }
}
