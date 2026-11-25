import { nodeId } from "#domain/node-id.ts";
import { CONTRACT } from "../../server/src/domain/capture.ts";

export const leak = [nodeId, CONTRACT];
