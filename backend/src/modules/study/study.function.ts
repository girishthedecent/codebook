import { inngest } from '../../config/inngest.config.js';
import logger from '../../config/logger.config.js';
import { studyGenerateRequested } from '../../inngest/events.js';
import type { CitationRef } from '../citations/citations.types.js';
import { gatherMaterial, groupRefs, renderGroup } from './study.gather.js';
import { condenseGroup, generateStudy, LABELS } from './study.generate.js';
import type { StudyData } from './study.schemas.js';
import { failStudy, saveStudy, startStudy } from './study.service.js';

const GENERIC_FAILURE = 'Generation failed. Try again in a few minutes.';

/**
 * One study set: gather and number the chosen passages, condense them in groups when they
 * don't fit one prompt, then generate. Output that fails the checks gets one more attempt
 * with the problems spelled out; a second failure ends the run as FAILED with the reason.
 * Each model call is its own step, so a retried step doesn't pay for the others again.
 */
export const generateStudyArtifact = inngest.createFunction(
  {
    id: 'generate-study-artifact',
    triggers: [studyGenerateRequested],
    concurrency: [{ key: 'event.data.artifactId', limit: 1 }],
    retries: 2,
    onFailure: async ({ event, error }) => {
      logger.warn('Study generation failed', {
        artifactId: event.data.event.data.artifactId,
        error: error.message,
      });
      await failStudy(event.data.event.data.artifactId, GENERIC_FAILURE);
    },
  },
  async ({ event, step }) => {
    const { artifactId } = event.data;

    const artifact = await step.run('start', () => startStudy(artifactId));
    if (!artifact) return { artifactId, outcome: 'gone' };
    const ctx = { userId: artifact.userId, workspaceId: artifact.workspaceId };

    const gathered = await step.run('gather', () => gatherMaterial(ctx, artifact.input));
    if ('error' in gathered) {
      await step.run('fail', () => failStudy(artifactId, gathered.error));
      return { artifactId, outcome: 'nothing-to-read' };
    }
    // Step results come back as JSON; refs are plain data, so nothing is lost.
    const refs = gathered.refs as CitationRef[];

    const groups = groupRefs(refs);
    const material =
      groups.length === 1
        ? renderGroup(groups[0]!)
        : (
            await Promise.all(
              groups.map((group, i) =>
                step.run(`condense-${i + 1}`, () => condenseGroup(group, groups.length, ctx)),
              ),
            )
          ).join('\n\n');

    const numbers = refs.map((ref) => ref.n);
    const generateOnce = (feedback?: string[]) =>
      generateStudy(artifact.type, artifact.input, material, numbers, ctx, feedback);

    let result = await step.run('generate', () => generateOnce());
    if ('errors' in result) {
      const feedback = result.errors;
      result = await step.run('generate-retry', () => generateOnce(feedback));
    }

    if ('errors' in result) {
      const reason = `The generated ${LABELS[artifact.type]} didn't pass checks: ${result.errors.slice(0, 3).join(' ')}`;
      await step.run('fail', () => failStudy(artifactId, reason));
      return { artifactId, outcome: 'invalid' };
    }

    const { data, model } = result;
    await step.run('save', () => saveStudy(artifactId, artifact, data as StudyData, refs, model));
    return { artifactId, outcome: 'done', groups: groups.length };
  },
);
