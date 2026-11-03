// POST /api/segment
// Body: { "photos": ["data:image/jpeg;base64,...", ...up to 3], "services": [{ "name": "..." }] }
// Returns photo roles, hero choice, readable sign text, and product crop boxes (SAM 3.1) for the client to cut.

import { postRoute } from '../lib/http.js';
import { segmentPhotos } from '../lib/segment.js';

export default postRoute(async (body) => segmentPhotos(body.photos, Array.isArray(body.services) ? body.services : []), { rateLimit: true, countsForClient: false });
