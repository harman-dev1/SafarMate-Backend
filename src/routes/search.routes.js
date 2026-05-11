import { Router } from 'express';
import { autocomplete, reverse } from '../controllers/search.controller.js';

const router = Router();
router.get('/autocomplete', autocomplete);
router.get('/reverse', reverse);
export default router;