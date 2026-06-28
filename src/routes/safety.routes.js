import { Router } from 'express';
import { getSafetySegmentsInBbox, safetyAlongRoute } from '../controllers/safetyScore.controller.js';

const router = Router();

router.get('/segments', getSafetySegmentsInBbox);   // GET  /api/safety/segments?minLng=&minLat=&maxLng=&maxLat=
router.post('/along-route', safetyAlongRoute);       // POST /api/safety/along-route

export default router;
