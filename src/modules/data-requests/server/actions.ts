'use server';

import { emptyInput } from '@/lib/validation';
import {
  submitDataRequestSchema,
  updateDataRequestSchema,
  type SubmitDataRequestInput,
  type UpdateDataRequestInput,
} from '@/modules/data-requests/schemas';
import { runAction } from '@/server/actions/run';
import { listDataRequests, listMyDataRequests } from './queries';
import { submitDataRequest, updateDataRequest } from './service';

/** Data-subject request actions (PAT-09). Thin: Zod strict -> authz context -> use case. */

export async function submitDataRequestAction(input: SubmitDataRequestInput) {
  return runAction(submitDataRequestSchema, input, (ctx, d) => submitDataRequest(ctx, d));
}

export async function updateDataRequestAction(input: UpdateDataRequestInput) {
  return runAction(updateDataRequestSchema, input, (ctx, d) => updateDataRequest(ctx, d));
}

export async function listMyDataRequestsAction() {
  return runAction(emptyInput, {}, (ctx) => listMyDataRequests(ctx));
}

export async function listDataRequestsAction() {
  return runAction(emptyInput, {}, (ctx) => listDataRequests(ctx));
}
