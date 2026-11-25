import { join } from "node:path";
import { toJobId } from "#domain/job.ts";

export const ok = [join, toJobId];
