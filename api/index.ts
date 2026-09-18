// Vercel Function: every /api/* and /p/* request is rewritten here (vercel.json) and handed to the Hono app.
import { handle } from '../server/vercel.js';

export const GET = handle;
export const POST = handle;
