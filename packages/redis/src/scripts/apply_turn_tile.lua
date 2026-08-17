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

-- "Unreachable" mirrors apps/server/src/lobby.ts's isReachable() exactly.
-- PRESENCE_STALE_MS arrives as ARGV[6] rather than a Lua literal — Redis's
-- sandboxed Lua has no io/os libraries, so it can't read a config file or
-- env var itself; apps/server/src/lobby.ts's exported constant is the sole
-- source of truth, passed in on every call. See docs/decisions.md "Player
-- presence: connected/disconnected tracking". Missing lastSeenAt
-- (shouldn't happen for a real game, but possible for state persisted
-- before this field existed) defaults to "just seen" rather than "long
-- gone", failing open during a rollout window instead of mass-skipping
-- every in-flight game's current turn the instant this deploys.
local PRESENCE_STALE_MS = tonumber(ARGV[6])
local now = tonumber(ARGV[3])

local function isReachable(player)
  local lastSeenAt = player.lastSeenAt or now
  return (now - lastSeenAt) < PRESENCE_STALE_MS
end

-- turnPlayerId is an identity, not an array position — see
-- docs/decisions.md "Turn ownership: turnPlayerIndex -> identity-based,
-- not array position". `nil`/cjson.null (nobody currently eligible, the
-- pathological all-unreachable case) resolves to no current player.
local currentIndex = nil
if state.turnPlayerId ~= nil and state.turnPlayerId ~= cjson.null then
  for i, p in ipairs(state.players) do
    if p.id == state.turnPlayerId then
      currentIndex = i
      break
    end
  end
end
local currentPlayer = currentIndex ~= nil and state.players[currentIndex] or nil
local isCurrentPlayer = currentPlayer ~= nil and currentPlayer.id == ARGV[2]

-- Fast-skip: don't make everyone wait out the full turnTimerSec for a
-- player who's gone quiet.
local currentPlayerUnreachable = currentPlayer == nil or not isReachable(currentPlayer)

local deadlinePassed = (type(state.turnDeadline) == 'number' and now >= state.turnDeadline)
  or currentPlayerUnreachable
if not isCurrentPlayer and not deadlinePassed then
  return cjson.encode({ error = 'NotYourTurn' })
end

-- ARGV[5], observedTurnDeadline: set only by a client's background auto-fire
-- (see TurnTileCommand in @anagrabble/protocol), never a manual click. Every
-- connected client races the same deadline, so in a two-player game the
-- *only* other player is always exactly who turnPlayerId advances to —
-- meaning the loser's stale call can arrive just after the winner's call
-- has already made the loser isCurrentPlayer, for the wrong reason. Reject
-- if the deadline this call was reacting to no longer matches current
-- state: something else already handled it.
local observedTurnDeadline = (ARGV[5] ~= nil and ARGV[5] ~= '') and tonumber(ARGV[5]) or nil
if observedTurnDeadline ~= nil and observedTurnDeadline ~= state.turnDeadline then
  return cjson.encode({ error = 'NotYourTurn' })
end

local letter = redis.call('LPOP', KEYS[4])
if not letter then
  return stateRaw
end

local seq = redis.call('INCR', KEYS[2])
table.insert(state.pool, letter)
state.bankCount = state.bankCount - 1

-- Advance turn ownership to the next reachable player, walking past any
-- run of unreachable ones without drawing a tile for them. Landing on an
-- unreachable player here is exactly what let a client's own fast-skip
-- effect fire again immediately after this call returned, silently
-- drawing a second tile for one click — see docs/decisions.md "Turn
-- ownership: turnPlayerIndex -> identity-based, not array position".
local numPlayers = #state.players
local startIndex = currentIndex or 0
local nextPlayerId = nil
for step = 1, numPlayers do
  local candidateIndex = ((startIndex + step - 1) % numPlayers) + 1
  local candidate = state.players[candidateIndex]
  if isReachable(candidate) then
    nextPlayerId = candidate.id
    break
  end
end
-- Lua semantics: assigning a table field to `nil` removes the key rather
-- than encoding JSON null, which would silently drop turnPlayerId from the
-- wire payload instead of sending the documented `null`. cjson.null is the
-- explicit JSON-null sentinel.
state.turnPlayerId = nextPlayerId or cjson.null
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
