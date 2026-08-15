-- Atomic verify + mutate for TurnTile. See CLAUDE.md "Turn timer enforcement"
-- and "Tile turning is turn-based" — this is what makes the deadline check
-- and the mutation a single atomic step, so two clients racing to fire
-- TurnTile right as a deadline passes can't both succeed.
--
-- KEYS[1] state, KEYS[2] seq, KEYS[3] cmds, KEYS[4] bag (see lobby.ts key
-- builders — bagKey is the one addition, a Redis list of the shuffled draw
-- order, never sent to clients).
-- ARGV[1] commandId, ARGV[2] playerId, ARGV[3] now (ms), ARGV[4] cmds TTL (s)
--
-- Returns either the resulting GameState JSON, or {"error": "<code>"}.

local stateRaw = redis.call('GET', KEYS[1])
if not stateRaw then
  return cjson.encode({ error = 'GameNotFound' })
end

local alreadySeen = redis.call('SADD', KEYS[3], ARGV[1]) == 0
redis.call('EXPIRE', KEYS[3], ARGV[4])
if alreadySeen then
  return stateRaw
end

local state = cjson.decode(stateRaw)
if state.status ~= 'playing' then
  return cjson.encode({ error = 'GameNotStarted' })
end

-- Nothing left to turn once the bank is empty — a no-op, not an error, since
-- a client's local timer can still be ticking when this happens.
if state.bankCount <= 0 then
  return stateRaw
end

local now = tonumber(ARGV[3])
local currentPlayer = state.players[state.turnPlayerIndex + 1]
local isCurrentPlayer = currentPlayer ~= nil and currentPlayer.id == ARGV[2]

-- Fast-skip: don't make everyone wait out the full turnTimerSec for a
-- player who's gone quiet. "Unreachable" mirrors apps/server/src/lobby.ts's
-- isReachable() exactly (PRESENCE_STALE_MS must stay in sync between the
-- two, Lua can't share the TS constant) — see docs/decisions.md "Player
-- presence: connected/disconnected/left tracking". Missing lastSeenAt
-- (shouldn't happen for a real game, but possible for state persisted
-- before this field existed) defaults to "just seen" rather than "long
-- gone", failing open during a rollout window instead of mass-skipping
-- every in-flight game's current turn the instant this deploys.
local PRESENCE_STALE_MS = 20000
local lastSeenAt = (currentPlayer ~= nil and currentPlayer.lastSeenAt) or now
local currentPlayerUnreachable = currentPlayer ~= nil
  and (currentPlayer.left == true or (now - lastSeenAt) >= PRESENCE_STALE_MS)

local deadlinePassed = (type(state.turnDeadline) == 'number' and now >= state.turnDeadline)
  or currentPlayerUnreachable
if not isCurrentPlayer and not deadlinePassed then
  return cjson.encode({ error = 'NotYourTurn' })
end

local letter = redis.call('LPOP', KEYS[4])
if not letter then
  return stateRaw
end

local seq = redis.call('INCR', KEYS[2])
table.insert(state.pool, letter)
state.bankCount = state.bankCount - 1
state.turnPlayerIndex = (state.turnPlayerIndex + 1) % #state.players
state.turnDeadline = now + (state.config.turnTimerSec * 1000)
if state.bankCount == 0 then
  state.endGameDeadline = now + 60000
end
state.seq = seq

local encoded = cjson.encode(state)
-- lua-cjson can't tell an emptied array from an empty object, so
-- players[].words (still [] for everyone until word-play lands) would
-- round-trip as "{}" instead of "[]" — patch the one array field this
-- script can leave empty. See packages/redis test coverage for this exact
-- regression.
encoded = string.gsub(encoded, '"words":{}', '"words":[]')

redis.call('SET', KEYS[1], encoded)
return encoded
