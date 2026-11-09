import { fixtureFetch } from './launcher.mjs';
globalThis.fetch = fixtureFetch().fetchImpl;
