import { inngest } from '../../config/inngest.config.js';
import logger from '../../config/logger.config.js';
import { studyGenerateRequested } from '../../inngest/events.js';
import type { CitationRef } from '../citations/citations.types.js';
import { failureCode, isStudyErrorCode } from './study.errors.js';
import { gatherMaterial, groupRefs, renderGroup } from './study.gather.js';
import { condenseGroup, generateStudy, LABELS } from './study.generate.js';
import type { StudyData } from './study.schemas.js';
import { failStudy, isStudyActive, saveStudy, startStudy } from './study.service.js';

/**
 * After the retries ran out: the set must not stay RUNNING. The error that ended the run only
 * keeps its name, message and `code`, so the steps that call a model say what went wrong in
 * `code` (see `classified`).
 */
export async function onStudyFailure({
  event,
  error,
}: {
  event: { data: { event: { data: { artifactId: string } } } };
  error: Error;
}) {
  const { artifactId } = event.data.event.data;
  const code = (error as { code?: unknown }).code;
  logger.warn('Study generation failed', { artifactId, error: error.message });
  await failStudy(artifactId, isStudyErrorCode(code) ? code : 'GENERATION_FAILED');
}

// A step that throws is retried; when its retries run out the error is all the failure handler
// gets, and the provider's error doesn't survive that trip.
const classified =
  <T>(work: () => Promise<T>) =>
  async () => {
    try {
      return await work();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Generation failed';
      throw Object.assign(new Error(message), { code: failureCode(error) });
    }
  };

/**
 * One study set: gather and number the chosen passages, condense them in groups when they
 * don't fit one prompt, then generate. Output that fails the checks gets one more attempt
 * with the problems spelled out; a second failure ends the run as FAILED with the reason.
 * Each model call is its own step, so a retried step doesn't pay for the others again.
 * A cancelled set is checked for before each model call and never written over.
 */
export const generateStudyArtifact = inngest.createFunction(
  {
    id: 'generate-study-artifact',
    triggers: [studyGenerateRequested],
    concurrency: [{ key: 'event.data.artifactId', limit: 1 }],
    retries: 2,
    onFailure: onStudyFailure,
  },
  async ({ event, step }) => {
    const { artifactId } = event.data;

    const artifact = await step.run('start', () => startStudy(artifactId));
    if (!artifact) return { artifactId, outcome: 'stopped' };
    const ctx = { userId: artifact.userId, workspaceId: artifact.workspaceId };

    const gathered = await step.run('gather', () => gatherMaterial(ctx, artifact.input));
    if ('error' in gathered) {
      await step.run('fail', () => failStudy(artifactId, 'NO_MATERIAL', gathered.error));
      return { artifactId, outcome: 'nothing-to-read' };
    }
    // Step results come back as JSON; refs are plain data, so nothing is lost.
    const refs = gathered.refs as CitationRef[];

    // Steps that call a model skip the call, and return null, once the set was cancelled.
    const whileActive = async <T>(work: () => Promise<T>) =>
      (await isStudyActive(artifactId)) ? work() : null;

    const groups = groupRefs(refs);
    const condensed =
      groups.length === 1
        ? [renderGroup(groups[0]!)]
        : await Promise.all(
            groups.map((group, i) =>
              step.run(
                `condense-${i + 1}`,
                classified(() => whileActive(() => condenseGroup(group, groups.length, ctx))),
              ),
            ),
          );
    if (condensed.includes(null)) return { artifactId, outcome: 'cancelled' };
    const material = condensed.join('\n\n');

    const numbers = refs.map((ref) => ref.n);
    const generateOnce = (feedback?: string[]) =>
      generateStudy(artifact.type, artifact.input, material, numbers, ctx, feedback);

    let result = await step.run(
      'generate',
      classified(() => whileActive(() => generateOnce())),
    );
    if (result && 'errors' in result) {
      const feedback = result.errors;
      result = await step.run(
        'generate-retry',
        classified(() => whileActive(() => generateOnce(feedback))),
      );
    }
    if (!result) return { artifactId, outcome: 'cancelled' };

    if ('errors' in result) {
      const reason = `The generated ${LABELS[artifact.type]} didn't pass checks: ${result.errors.slice(0, 3).join(' ')}`;
      await step.run('fail', () => failStudy(artifactId, 'VALIDATION_FAILED', reason));
      return { artifactId, outcome: 'invalid' };
    }

    const { data, model } = result;
    await step.run('save', () => saveStudy(artifactId, artifact, data as StudyData, refs, model));
    return { artifactId, outcome: 'done', groups: groups.length };
  },
);
