import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth, useUser } from "../../auth";
import { Header } from "../../components/Header";
import { PageShell, PageContent } from "../../components/Layout";
import { Loader } from "../../components/Loader";
import { useGameSocket } from "../../hooks/useGameSocket";
import { useGameSounds } from "../../hooks/useGameSounds";
import { useHaptics } from "../../hooks/useHaptics";
import { usePlayerSettings } from "../../hooks/usePlayerSettings";
import { getDisplayName } from "../../utils/clerkDisplayName";
import { makeCommandId } from "../../utils/gameId";
import { assignPlayerColors } from "../../utils/playerColors";
import { leaveGame as leaveGameRequest } from "../../client/fetchLeaveGame";
import { GameBoard } from "./GameBoard";
import { GameOverSummary } from "./GameOverSummary";
import { GameNotFoundCard } from "./GameNotFoundCard";
import { JoinInProgressCard } from "./JoinInProgressCard";
import { WaitingRoomCard } from "./WaitingRoomCard";

// Matches design-system/Lobby.dc.html — the live waiting room, and also the
// invite-link destination for players who haven't joined yet (RequireAuth
// sends a signed-out visitor through /login first). There's no separate
// "preview then redirect" page: an unjoined guest sees the same lobby
// everyone else does, with a Join button in place of "Waiting for the
// host…"; clicking Join updates this page in place once the server
// confirms membership, no navigation involved.
//
// Split per anagrabble#37's approach notes (mirroring LoginPage/index.tsx's
// shape): each screen below (GameNotFoundCard/JoinInProgressCard/
// WaitingRoomCard) is a thin render of props, owning no state of its own —
// this component keeps only the state that's genuinely shared across
// screens (the socket connection, in-flight action flags, player settings).
//
// Player settings (sound/haptics/language — anagrabble#40) are owned here,
// not fetched independently by GameBoard/MobileMenu, so a change made from
// the in-game mobile menu takes effect in this same mounted tree (no
// navigation/remount to lean on) — see anagrabble#37's "`soundEnabled` and a
// future in-game settings toggle" for why that matters.

export function LobbyPage() {
  const { gameId = "" } = useParams();
  const navigate = useNavigate();
  const { userId, getToken } = useAuth();
  const { user } = useUser();
  const playerName = getDisplayName(user);
  const [starting, setStarting] = useState(false);
  const [joining, setJoining] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);

  const {
    state: settingsState,
    saveError: settingsSaveError,
    update: updateSettings,
  } = usePlayerSettings();
  // Defaults sound on (matches the Postgres `player_settings` default) so a
  // sound can play before the fetch resolves; flips off shortly after mount
  // if the player has actually disabled it.
  const soundEnabled =
    settingsState.status === "loaded" ? settingsState.settings.soundEnabled : true;
  const { playSound } = useGameSounds(soundEnabled);
  // Same defaults-on-before-fetch-resolves reasoning as soundEnabled above
  // (matches DEFAULT_PLAYER_SETTINGS.hapticsEnabled).
  const hapticsEnabled =
    settingsState.status === "loaded" ? settingsState.settings.hapticsEnabled : true;
  const { vibrate } = useHaptics(hapticsEnabled);
  const playerSettings = settingsState.status === "loaded" ? settingsState.settings : null;

  const { status, lobby, error, wordPlay, history, send } = useGameSocket(gameId, () => {
    playSound("tileTurn");
    vibrate("tileTurn");
  });

  const shareLink = `${window.location.origin}/${gameId}`;

  const joinGame = () => {
    setJoining(true);
    send({
      type: "JoinGame",
      commandId: makeCommandId(),
      gameId,
      playerName,
    });
  };

  const startGame = () => {
    setStarting(true);
    send({
      type: "StartGame",
      commandId: makeCommandId(),
      gameId,
    });
  };

  // A deliberate, explicit leave. Rendered both from the pre-start lobby
  // view below and, via GameBoard, from a live game (design-system/In
  // Game.dc.html's leave-game button/confirm dialog). Pre-start this hits
  // `POST /games/:gameId/leave` (-> `leaveGame` in
  // apps/server/src/lobby.ts), which actually removes the player. Mid-game
  // that endpoint is a no-op on the backend — nobody is ever removed once
  // the game has started — so there's nothing worth a round trip for:
  // navigating away closes the socket, which the server treats exactly like
  // any other disconnect. (The backend no-op stays in place regardless, as
  // a defensive no-op for the rare race where `lobby.status` here is still
  // stale "open" from just before the host started the game.) See
  // docs/decisions.md "`left` presence state removed" for why there's
  // deliberately no distinct "left the game" state to set here.
  const leaveGame = async () => {
    if (lobby?.status === "playing") {
      navigate("/");
      return;
    }
    setLeaving(true);
    setLeaveError(null);
    try {
      const token = await getToken();
      if (!token) throw new Error("Unauthorized");
      await leaveGameRequest(token, gameId);
      navigate("/");
    } catch {
      setLeaveError("Something went wrong leaving the game. Try again.");
      setLeaving(false);
    }
  };

  // Only a missing game warrants replacing the whole page — every other
  // error code (NotHost, a rejected word, a stale-state retry, ...) means
  // the game itself is fine and should be shown inline near whatever
  // command produced it, not swap out the page it happened on.
  if (error?.code === "GameNotFound") {
    return <GameNotFoundCard onBackHome={() => navigate("/")} />;
  }

  if (!lobby) {
    return (
      <PageShell>
        <Header />
        <PageContent>
          <Loader />
        </PageContent>
      </PageShell>
    );
  }

  // "ended" renders its own summary screen rather than falling through to
  // the pre-game waiting-room view below (share link, "Start game" button),
  // which makes no sense for a game that's already over — see
  // GameOverSummary, matching design-system/Game Over.dc.html.
  if (lobby.status === "ended") {
    return <GameOverSummary lobby={lobby} playerId={userId!} />;
  }

  const colors = assignPlayerColors(lobby.players, userId!);
  const isHost = userId === lobby.hostId;
  const isJoined = lobby.players.some((p) => p.id === userId);
  const isUnjoinedGuest = !isHost && !isJoined;
  const canJoin = status === "open";

  // A guest who opens a mid-game invite link without ever calling JoinGame
  // is gated behind a join prompt rather than the live board — see
  // JoinInProgressCard's own comment for why.
  if (lobby.status === "playing" && isUnjoinedGuest) {
    return (
      <JoinInProgressCard
        lobby={lobby}
        colors={colors}
        joining={joining}
        canJoin={canJoin}
        onJoin={joinGame}
      />
    );
  }

  if (lobby.status === "playing") {
    return (
      <GameBoard
        lobby={lobby}
        playerId={userId!}
        send={send}
        error={error}
        wordPlay={wordPlay}
        playSound={playSound}
        vibrate={vibrate}
        history={history}
        status={status}
        onLeaveGame={leaveGame}
        leaving={leaving}
        leaveError={leaveError}
        playerSettings={playerSettings}
        onUpdatePlayerSettings={updateSettings}
        playerSettingsSaveError={settingsSaveError}
      />
    );
  }

  return (
    <WaitingRoomCard
      lobby={lobby}
      colors={colors}
      gameId={gameId}
      shareLink={shareLink}
      isHost={isHost}
      isJoined={isJoined}
      isUnjoinedGuest={isUnjoinedGuest}
      canJoin={canJoin}
      starting={starting}
      joining={joining}
      leaving={leaving}
      leaveError={leaveError}
      onStart={startGame}
      onJoin={joinGame}
      onLeave={leaveGame}
    />
  );
}
