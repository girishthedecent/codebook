import type { Request, Response } from 'express';
import { getCorrelationId } from '../../utils/helpers/request.helpers.js';
import { successResponse } from '../../utils/helpers/response.helpers.js';
import { getLivenessService, getReadinessService } from './health.service.js';

export function getLivenessHandler(_req: Request, res: Response) {
  res.json(successResponse('Service is up', getLivenessService()));
}

export async function getReadinessHandler(_req: Request, res: Response) {
  const readiness = await getReadinessService();

  if (readiness.status !== 'ok') {
    // Error shape plus `data`, so callers can see which dependency is down.
    res.status(503).json({
      success: false,
      message: 'Service is not ready',
      code: 'SERVICE_UNAVAILABLE',
      data: readiness,
      correlationId: getCorrelationId(),
    });
    return;
  }
  res.json(successResponse('Service is ready', readiness));
}
