import { Router } from 'express';
import { verifyJwt } from '../middleware/auth.middleware.js';
import { updateMe, addSavedPlace, removeSavedPlace } from '../controllers/user.controller.js';

const router = Router();
router.patch('/me', verifyJwt, updateMe);
router.post('/me/saved-places', verifyJwt, addSavedPlace);
router.delete('/me/saved-places/:id', verifyJwt, removeSavedPlace);
export default router;