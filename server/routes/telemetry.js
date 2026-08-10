import express from 'express';
import { isTelemetryEnabled } from '../telemetry.js';

const router = express.Router();

/** Telemetry is not persisted or forwarded; endpoint kept so clients receive a stable 202 response. */
router.post('/events', (req, res) => {
  return res.status(202).json({
    accepted: 0,
    enabled: isTelemetryEnabled(),
  });
});

export default router;
