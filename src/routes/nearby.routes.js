import { Router } from 'express';
import { getNearby } from '../controllers/nearby.controller.js';

const router = Router();
router.get('/', getNearby);
export default router;