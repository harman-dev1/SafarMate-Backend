import { Router } from 'express';
import { googleSignIn, me, logout } from '../controllers/auth.controller.js';
import { verifyJwt } from '../middleware/auth.middleware.js';

const router = Router();
router.post('/google', googleSignIn);
router.get('/me', verifyJwt, me);
router.post('/logout', verifyJwt, logout);
export default router;