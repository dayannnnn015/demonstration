import { z } from 'zod';
import { timelineSchemas, revisionPreviewResponse, correctionResponse } from '../enrollment-timeline/contracts.js';

const grade = z.number().int().min(0).max(6);
export const placementSchemas = {
  preview: timelineSchemas.preview.extend({ grade_level: grade }),
  correct: timelineSchemas.correct.extend({ grade_level: grade }),
  history: timelineSchemas.history,
};
export const placementOperations = ([
  { id: 'placementPreview', method: 'post', path: '/api/v1/enrollments/:id/placement/preview', summary: 'Review a whole-year grade correction and replacement sections, preserving dates and movements', body: placementSchemas.preview, bodyLimit: '256kb' },
  { id: 'placementCorrect', method: 'post', path: '/api/v1/enrollments/:id/placement/corrections', summary: 'Confirm the reviewed grade correction with immutable before/after timeline evidence', body: placementSchemas.correct, bodyLimit: '256kb' },
  { id: 'placementHistory', method: 'get', path: '/api/v1/enrollments/:id/placement/corrections', summary: 'Read protected grade-placement corrections, newest first', query: placementSchemas.history },
] as const).map(operation => ({ ...operation, module: 'grade-placement' as const, manager: true as const }));
export type PlacementOperationId = typeof placementOperations[number]['id'];
const placementCorrection = correctionResponse.extend({ correction_kind: z.literal('placement'), previous_grade_level: grade, corrected_grade_level: grade });
export const placementResponses: Record<string, z.ZodType> = {
  placementPreview: revisionPreviewResponse.extend({ correction_kind: z.literal('placement'), previous_grade_level: grade, corrected_grade_level: grade }),
  placementCorrect: placementCorrection,
  placementHistory: z.object({ items: z.array(placementCorrection), pagination: z.object({ limit: z.number().int(), next_before_version: z.number().int().nullable() }) }),
};
