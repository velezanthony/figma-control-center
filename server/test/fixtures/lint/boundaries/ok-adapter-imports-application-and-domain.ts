import { makeRunScript } from "#application/run-script.ts";
import { toJobId } from "#domain/job.ts";

export const ok = [makeRunScript, toJobId];
