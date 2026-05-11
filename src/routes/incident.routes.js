import { Router } from 'express';
import {
  reportIncident,
  getIncidentsInBbox,
  getIncidentsNearRoute,
  verifyIncidentCtrl,
  removeIncidentCtrl,
} from '../controllers/incident.controller.js';
import { verifyJwt } from '../middleware/auth.middleware.js';

const router = Router();

router.get('/', getIncidentsInBbox);                       // GET /api/incidents?minLng=&minLat=&maxLng=&maxLat=
router.post('/near-route', getIncidentsNearRoute);         // POST /api/incidents/near-route
router.post('/', verifyJwt, reportIncident);               // POST /api/incidents
router.post('/:id/verify', verifyJwt, verifyIncidentCtrl); // POST /api/incidents/:id/verify
router.delete('/:id', verifyJwt, removeIncidentCtrl);      // DELETE /api/incidents/:id

export default router;