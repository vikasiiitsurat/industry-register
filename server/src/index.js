// Vercel's Express detector requires an express import in the service entrypoint.
import 'express';
import { createApp } from './conversion-app.js';

// Vercel Express service entrypoint: no listener or database initialization.
export default createApp();
