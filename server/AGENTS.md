# server/AGENTS.md — Backend Rules

This file applies when working in the `server/` directory.

## Language

- **Plain JavaScript only.** No TypeScript, no type annotations, no `.ts` files.
- ES modules exclusively (`import`/`export`). **Never** use `require()`.
- All local imports must include the `.js` extension:
  ```js
  import { getProjects } from './projects.js';
  import { authenticateToken } from './middleware/auth.js';
  ```

## Route file template

```js
import express from 'express';

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    // handler logic
    res.json({ success: true });
  } catch (error) {
    console.error('[ERROR] Description:', error.message);
    res.status(500).json({ error: error.message });
  }
});

export default router;
```

## Route mounting

New routes **must** be registered in `server/index.js`:

```js
import myRoutes from './routes/my-feature.js';
app.use('/api/my-feature', authenticateToken, myRoutes);
```

Place the `app.use()` call with the other route registrations (lines ~391-431 in `server/index.js`).

## Authentication

- Protected routes use `authenticateToken` middleware from `server/middleware/auth.js`.
- Public routes (`/api/auth/*`, `/health`) skip auth.

## Error handling

- Wrap all async handlers in try/catch.
- Return proper HTTP status: 400, 403, 404, 500.
- Log with `console.error('[ERROR]', ...)`.

## Path security

Always validate file paths:
```js
const resolved = path.resolve(allowedRoot, userInput);
if (!resolved.startsWith(allowedRoot + path.sep)) {
  return res.status(403).json({ error: 'Path must be under allowed root' });
}
```

## Model constants

Use `shared/modelConstants.js` — never hardcode model names or IDs.

```js
import { CLAUDE_MODELS } from '../shared/modelConstants.js';
```
