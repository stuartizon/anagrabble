export { createRedisClient, type CreateRedisClientOptions } from "./client.js";
export type { Redis } from "ioredis";
export {
  applyTurnTile,
  type ApplyTurnTileArgs,
  type ApplyTurnTileError,
  type ApplyTurnTileKeys,
  type ApplyTurnTileResult,
} from "./applyTurnTile.js";
export {
  applySubmitWord,
  type ApplySubmitWordArgs,
  type ApplySubmitWordError,
  type ApplySubmitWordKeys,
  type ApplySubmitWordResult,
  type UsedWord,
} from "./applySubmitWord.js";
