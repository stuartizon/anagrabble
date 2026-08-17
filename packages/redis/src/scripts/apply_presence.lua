-- Atomic presence write: patches one player's lastSeenAt without clobbering
-- whatever a concurrent mutation (TurnTile, SubmitWord) may be doing to the
-- same state blob at the same moment. See docs/decisions.md "Player
-- presence: connected/disconnected tracking" — "reachable" is always
-- derived from this timestamp at read time (apps/server/src/lobby.ts's
-- isReachable, mirrored in apply_turn_tile.lua), never tracked via a
-- scheduled timer, so this script only ever needs to record a timestamp,
-- never schedule or cancel anything. Deliberately has no commandId
-- idempotency set (unlike apply_turn_tile.lua/apply_submit_word.lua) —
-- writing the same lastSeenAt twice is harmless, there's nothing here that
-- would double-apply.
--
-- KEYS[1] state
-- ARGV[1] playerId, ARGV[2] lastSeenAt to write (ms) — callers pass `now`
-- for a heartbeat, or an already-expired value to mark a graceful close
-- stale immediately rather than waiting out the next heartbeat gap.
--
-- Returns the resulting GameState JSON, or {"error": "GameNotFound"}.
-- No-ops (returns state unchanged) if the player isn't found — a
-- late-arriving heartbeat racing the player's own removal isn't an error.

local stateRaw = redis.call('GET', KEYS[1])
if not stateRaw then
  return cjson.encode({ error = 'GameNotFound' })
end

local state = cjson.decode(stateRaw)
local playerId = ARGV[1]
local lastSeenAt = tonumber(ARGV[2])

for _, player in ipairs(state.players) do
  if player.id == playerId then
    player.lastSeenAt = lastSeenAt
    break
  end
end

local encoded = cjson.encode(state)
-- lua-cjson can't tell an emptied array from an empty object. Unlike
-- apply_turn_tile.lua (which only ever runs once `pool` already has a tile
-- in it), this script can fire before the first tile is ever turned, so
-- `pool` needs the same round-trip patch as `words` — see that script's
-- comment and packages/redis test coverage for the underlying regression.
encoded = string.gsub(encoded, '"words":{}', '"words":[]')
encoded = string.gsub(encoded, '"pool":{}', '"pool":[]')

redis.call('SET', KEYS[1], encoded)
return encoded
