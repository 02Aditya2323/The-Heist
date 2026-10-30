// Source-mode worker only. Production loads the compiled sqlite-worker.js directly.
import { tsImport } from 'tsx/esm/api';
await tsImport(new URL('./sqlite-worker.ts', import.meta.url).href, import.meta.url);
