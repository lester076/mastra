/**
 * A late cancellation must not rewrite terminal workflow history (#31596).
 *
 * InngestRun.cancel() overwrote the stored snapshot status even when the run
 * had already finished, so a stale run view could turn a successful workflow
 * into a canceled one. The core Run preserves terminal runs; the Inngest
 * override now mirrors that.
 */
import { Mastra } from '@mastra/core/mastra';
import { MockStore } from '@mastra/core/storage';
import { Inngest } from 'inngest';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { init } from './index';

function createFixture() {
  const inngest = new Inngest({ id: 'cancel-finished-test' });
  const { createWorkflow, createStep } = init(inngest);
  const step = createStep({
    id: 'step1',
    inputSchema: z.object({ value: z.string() }),
    outputSchema: z.object({ value: z.string() }),
    execute: async ({ inputData }) => inputData,
  });
  const workflow = createWorkflow({
    id: 'cancel-finished-workflow',
    inputSchema: z.object({ value: z.string() }),
    outputSchema: z.object({ value: z.string() }),
    steps: [step],
  } as any)
    .then(step)
    .commit();

  const store = new MockStore();
  const mastra = new Mastra({
    storage: store,
    workflows: { 'cancel-finished-workflow': workflow as any },
  });
  workflow.__registerMastra(mastra);
  vi.spyOn(inngest, 'send').mockResolvedValue({ ids: ['evt-1'] } as any);
  return { workflow, store };
}

async function seedSnapshot(store: MockStore, workflowName: string, runId: string, resourceId: string, status: string) {
  const workflowsStore = await store.getStore('workflows');
  await workflowsStore.persistWorkflowSnapshot({
    workflowName,
    runId,
    resourceId,
    snapshot: {
      status,
      value: { answer: 42 },
      context: { input: {} },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as any,
  });
}

async function readSnapshot(store: MockStore, workflowName: string, runId: string) {
  const workflowsStore = await store.getStore('workflows');
  return workflowsStore.loadWorkflowSnapshot({ workflowName, runId });
}

describe('inngest cancel finished runs', () => {
  it('keeps a successful snapshot successful on a late cancel', async () => {
    const { workflow, store } = createFixture();
    const run = await workflow.createRun();
    await seedSnapshot(store, 'cancel-finished-workflow', run.runId, run.resourceId, 'success');

    await run.cancel();

    const snapshot = await readSnapshot(store, 'cancel-finished-workflow', run.runId);
    expect(snapshot?.status).toBe('success');
  });

  it('still cancels a running snapshot', async () => {
    const { workflow, store } = createFixture();
    const run = await workflow.createRun();
    await seedSnapshot(store, 'cancel-finished-workflow', run.runId, run.resourceId, 'running');

    await run.cancel();

    const snapshot = await readSnapshot(store, 'cancel-finished-workflow', run.runId);
    expect(snapshot?.status).toBe('canceled');
  });
});
