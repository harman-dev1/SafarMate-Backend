import { Router } from 'express';
import { computeRoute } from '../controllers/route.controller.js';
import { verifyJwt } from '../middleware/auth.middleware.js';

const router = Router();
// JWT optional: try to attach user but don't fail if missing
router.post('/compute', (req, res, next) => {
  if (req.headers.authorization) return verifyJwt(req, res, next);
  next();
}, computeRoute);
export default router;