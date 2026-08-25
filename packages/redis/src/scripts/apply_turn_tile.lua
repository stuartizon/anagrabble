-- Atomic verify + mutate for TurnTile. See CLAUDE.md "Turn timer enforcement"
-- and "Tile turning is turn-based" — this is what makes the deadline check
-- and the mutation a single atomic step, so two clients racing to fire
-- TurnTile right as a deadline passes can't both succeed.
--
-- KEYS[1] state, KEYS[2] seq, KEYS[3] cmds, KEYS[4] bag (see gameSession.ts key
-- builders — bagKey is the one addition, a Redis list of the shuffled draw
-- order, never sent to clients).
-- ARGV[1] commandId, ARGV[2] playerId, ARGV[3] now (ms), ARGV[4] cmds TTL (s),
-- ARGV[5] presenceStaleMs
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

-- "Unreachable" mirrors apps/server/src/gameSession.ts's isReachable() exactly.
-- PRESENCE_STALE_MS arrives as ARGV[6] rather than a Lua literal — Redis's
-- sandboxed Lua has no io/os libraries, so it can't read a config file or
-- env var itself; apps/server/src/gameSession.ts's exported constant is the sole
-- source of truth, passed in on every call. See docs/decisions.md "Player
-- presence: connected/disconnected tracking". Missing lastSeenAt
-- (shouldn't happen for a real game, but possible for state persisted
-- before this field existed) defaults to "just seen" rather than "long
-- gone", failing open during a rollout window instead of mass-skipping
-- every in-flight game's current turn the instant this deploys.
local PRESENCE_STALE_MS = tonumber(ARGV[5])
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

-- Who would actually receive the turn next, walking past any run of
-- unreachable players — including possibly wrapping all the way back to
-- the current player if nobody else is reachable (the common solo-game
-- case: with one player, this always "wraps" straight back to them).
-- Computed *before* consuming a tile, and bailing out as a no-op if
-- nobody is reachable, rather than committing to a mutation with nowhere
-- to hand the turn: drawing a tile and setting turnPlayerId to null here
-- used to be exactly what broke a solo game — the sole player briefly
-- disconnecting made them "unreachable" (correctly), the fast-skip fired,
-- found no *other* reachable candidate to hand off to (they were still
-- marked stale in this same read), and nulled turnPlayerId out — leaving
-- "Someone's turn" with no button to click, and wasting a tile, until a
-- second sweep pass reassigned it back to them once they reconnected. See
-- docs/decisions.md "Turn-timer polling sweep" → "Solo-game turn nulling".
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
if nextPlayerId == nil then
  return stateRaw
end

local letter = redis.call('LPOP', KEYS[4])
if not letter then
  return stateRaw
end

local seq = redis.call('INCR', KEYS[2])
table.insert(state.pool, letter)
state.bankCount = state.bankCount - 1
state.turnPlayerId = nextPlayerId
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
