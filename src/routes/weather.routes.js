import { Router } from 'express';
import { weatherAlongRoute } from '../controllers/weather.controller.js';

const router = Router();
router.post('/along-route', weatherAlongRoute);
export default router;