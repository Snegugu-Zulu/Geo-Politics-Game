import { useEffect, useMemo, useRef, useState } from "react";
import {
    LogOut,
    Swords,
    Shield,
    Zap,
    Trophy,
    FastForward,
    ArrowRightLeft,
    SkipForward,
    Share2,
    RefreshCw,
    Skull,
    Info
} from "lucide-react";

import { useNavigate, useParams } from "react-router-dom";
import api from "../services/api";

function Game() {
    const [game, setGame] = useState(null);
    const [selected, setSelected] = useState(null);
    const [target, setTarget] = useState(null);
    const npcRunKey = useRef(null);

    const [message, setMessage] = useState("");
    const [busy, setBusy] = useState(false);
    const [dice, setDice] = useState(null);

    const [transferFrom, setTransferFrom] = useState("");
    const [transferTo, setTransferTo] = useState("");
    const [transferAmount, setTransferAmount] = useState(1);

    const [reinforcements, setReinforcements] = useState({});

    const [showEliminationPopup, setShowEliminationPopup] = useState(false);
    const [showVictoryPopup, setShowVictoryPopup] = useState(false);
    const previousState = useRef({ id: null, owned: 0, finished: false });

    const [showInstructions, setShowInstructions] = useState(false);

    const navigate = useNavigate();
    const { gameId } = useParams();

    const playerCountries = useMemo(
        () => game?.countries.filter(c => c.owner === "You") || [],
        [game]
    );

    const enemies = useMemo(
        () => game?.countries.filter(c => c.owner !== "You") || [],
        [game]
    );

    const totalSoldiers = playerCountries.reduce(
        (sum, country) => sum + country.soldiers,
        0
    );

    const isPlayerTurn = game?.currentPlayer === "You";
    const isFinished = game?.status === "finished" || !!game?.winner;
    const isEliminated = !!game && game.status !== "setup" && playerCountries.length === 0;

    const attackInProgress = !!game?.attackInProgress;
    const activeAttack = game?.attackInProgress || null;

    // Popups only fire when the state changes during play: the human loses their
    // last territory, or the human wins. Loading or starting a game never triggers them.
    useEffect(() => {
        if (!game) return;

        const before = previousState.current;

        if (before.id !== game._id) {
            setShowEliminationPopup(false);
            setShowVictoryPopup(false);
        } else {
            if (before.owned > 0 && isEliminated) {
                setShowEliminationPopup(true);
            }
            if (!before.finished && isFinished && game.winner === "You") {
                setShowVictoryPopup(true);
            }
        }

        previousState.current = {
            id: game._id,
            owned: playerCountries.length,
            finished: isFinished
        };
    }, [game]);

    useEffect(() => {
        if (!showEliminationPopup && !showVictoryPopup) return;

        const timer = setTimeout(() => {
            setShowEliminationPopup(false);
            setShowVictoryPopup(false);
        }, 5000);

        return () => clearTimeout(timer);
    }, [showEliminationPopup, showVictoryPopup]);

    const reinforcementsDue =
        game?.round >= 2 &&
        isPlayerTurn &&
        !game?.reinforcementsReceived &&
        playerCountries.length > 0
            ? playerCountries.length * 2
            : 0;

    const reinforcementsPlaced = Object.values(reinforcements).reduce(
        (sum, n) => sum + Number(n || 0),
        0
    );

    const latestNpc = useMemo(() => {
        if (!game?.history) return null;
        for (let i = game.history.length - 1; i >= 0; i--) {
            const h = game.history[i];
            if (
                h.player &&
                h.player !== "You" &&
                ["attack-decision", "reinforce", "transfer", "event"].includes(h.type)
            ) {
                return h;
            }
        }
        return null;
    }, [game?.history]);

    const recentHistory = useMemo(() => {
        if (!game?.history) return [];
        return game.history.slice(-30).reverse();
    }, [game?.history]);

    const load = async () => {
        try {
            setBusy(true);
            const id = gameId || localStorage.getItem("gameId");

            if (!id) {
                navigate("/new-game");
                return;
            }
            const { data } = await api.get(`/games/${id}`);

            setGame(data);
            localStorage.setItem("gameId", id);

            if (data.attackInProgress?.from && data.attackInProgress?.target) {
                const fromCountry = data.countries.find(
                    c => c.name === data.attackInProgress.from
                );
                const toCountry = data.countries.find(
                    c => c.name === data.attackInProgress.target
                );
                setSelected(fromCountry || null);
                setTarget(toCountry || null);
            } else {
                const ownedCountries = data.countries.filter(
                    country => country.owner === "You"
                );
                if (ownedCountries.length === 1) {
                    setSelected(ownedCountries[0]);
                } else {
                    setSelected(null);
                    setTarget(null);
                }
            }

        } catch (error) {
            if (error.response?.status === 401) {
                localStorage.clear();
                navigate("/login");
                return;
            }
            if (error.response?.status === 404) {
                localStorage.removeItem("gameId");
                navigate("/new-game");
                return;
            }
            setMessage("Unable to load the game.");
        } finally {
            setBusy(false);
        }
    };

    useEffect(() => {
        load();
    }, [gameId]);

    const updateReinforcement = (countryName, delta) => {
        setReinforcements(prev => {
            const current = prev[countryName] || 0;
            const next = Math.max(0, current + delta);

            if (delta > 0 && reinforcementsPlaced >= reinforcementsDue) {
                return prev;
            }

            return { ...prev, [countryName]: next };
        });
    };

    const attack = async enemy => {
        if (!selected || busy || !isPlayerTurn || selected.owner !== "You" || isFinished || isEliminated) return;

        if (reinforcementsDue > 0) {
            setMessage("Place your reinforcements before attacking.");
            return;
        }

        if (game.phase === "transfer") {
            setMessage("You have already attacked this turn. Transfer soldiers or end your turn.");
            return;
        }

        if (attackInProgress && activeAttack && activeAttack.target !== enemy.name) {
            setMessage("Finish your current attack or stop before targeting a new enemy.");
            return;
        }

        setBusy(true);
        setMessage("");

        try {
            const { data } = await api.post(`/games/${game._id}/attack`, {
                from: selected.name,
                target: enemy.name
            });

            setGame(data.game);
            setDice(data.result);

            const result = data.result || {};
            const ended = result.attackEnded ?? (result.conquered || result.endReason === "attacker-exhausted");

            if (result.conquered) {
                const gained = result.soldiersGained || 0;
                setMessage(
                    `Territory conquered: ${enemy.name}. ` +
                    `Gained ${gained} soldier(s). Your losses: ${result.attackerLosses}, enemy losses: ${result.defenderLosses}. ` +
                    `Transfer soldiers if you like, then end your turn.`
                );
                setSelected(null);
                setTarget(null);
                return;
            }

            if (ended) {
                setMessage(
                    result.endReason === "attacker-exhausted"
                        ? `Attack stalled at ${enemy.name}. Your attacker is down to one soldier.`
                        : `Attack ended. Your losses: ${result.attackerLosses}, enemy losses: ${result.defenderLosses}.`
                );
                setSelected(null);
                setTarget(null);
                return;
            }

            setMessage(
                `Round resolved — your losses: ${result.attackerLosses}, ` +
                `enemy losses: ${result.defenderLosses}. ` +
                `Continue attacking ${enemy.name}, or STOP ATTACK to end your turn.`
            );

            const freshFrom = data.game.countries.find(c => c.name === selected.name);
            const freshTarget = data.game.countries.find(c => c.name === enemy.name);

            setSelected(freshFrom || null);
            setTarget(freshTarget || null);

        } catch (error) {
            setMessage(error.response?.data?.message || "Battle failed.");
        } finally {
            setBusy(false);
        }
    };

    const placeReinforcements = async () => {
        if (busy || !isPlayerTurn || isFinished || reinforcementsDue === 0 || isEliminated) return;

        if (reinforcementsPlaced !== reinforcementsDue) {
            setMessage(`Place exactly ${reinforcementsDue} soldier(s).`);
            return;
        }

        const allocations = Object.entries(reinforcements)
            .filter(([, amount]) => Number(amount) > 0)
            .map(([country, amount]) => ({
                country,
                amount: Math.floor(Number(amount))
            }));

        if (allocations.length === 0) {
            setMessage("Choose at least one country for reinforcements.");
            return;
        }

        setBusy(true);
        setMessage("");

        try {
            const { data } = await api.post(`/games/${game._id}/reinforce`, { allocations });
            setGame(data.game);
            setReinforcements({});
            setMessage(`Placed ${data.result?.amount ?? reinforcementsDue} reinforcement(s).`);
        } catch (error) {
            setMessage(error.response?.data?.message || "Unable to place reinforcements.");
        } finally {
            setBusy(false);
        }
    };

    const skipTurn = async () => {
        if (busy || !isPlayerTurn || isFinished || isEliminated) return;

        setBusy(true);
        setMessage("You ended your turn. NPCs will now play...");

        try {
            const { data } = await api.post(`/games/${game._id}/skip`);
            setGame(data.game);
            setSelected(null);
            setTarget(null);
            setDice(null);
            setReinforcements({});
            setMessage("Your turn has ended.");
        } catch (error) {
            setMessage(error.response?.data?.message || "Unable to end your turn.");
        } finally {
            setBusy(false);
        }
    };

    const fastForward = async () => {
        if (busy || isPlayerTurn || isFinished) return;

        setBusy(true);
        setMessage("Processing NPC strategies...");

        try {
            const { data } = await api.post(`/games/${game._id}/fast-forward`);
            setGame(data.game);
            setSelected(null);
            setTarget(null);

            const gameFinished = data.game.status === "finished" || !!data.game.winner;

            if (gameFinished) {
                setMessage(`${data.game.winner} has won the game.`);
            } else {
                setMessage(`NPC turns completed. ${data.decisions?.length ?? 0} decisions processed.`);
            }
        } catch (error) {
            setMessage(error.response?.data?.message || "Unable to process NPC turns.");
        } finally {
            setBusy(false);
        }
    };

    // Auto-play whenever it is not the player's turn.
    useEffect(() => {
        if (!game || game.status !== "active" || game.currentPlayer === "You" || busy) {
            return;
        }
        const turnKey = `${game._id}-${game.round}-${game.currentPlayer}`;
        if (npcRunKey.current === turnKey) return;

        npcRunKey.current = turnKey;
        fastForward();
    }, [game?._id, game?.round, game?.currentPlayer, game?.status, busy]);

    const transfer = async () => {
        if (busy || !transferFrom || !transferTo || !isPlayerTurn || isFinished || isEliminated) return;

        if (attackInProgress) {
            setMessage("You cannot transfer soldiers while an attack is in progress.");
            return;
        }

        setBusy(true);
        setMessage("");

        try {
            const { data } = await api.post(`/games/${game._id}/transfer`, {
                from: transferFrom,
                target: transferTo,
                amount: Math.floor(Number(transferAmount))
            });

            setGame(data.game);
            setMessage(`Transferred ${data.result.amount} soldiers from ${data.result.from} to ${data.result.target}.`);
            setTransferAmount(1);
        } catch (error) {
            setMessage(error.response?.data?.message || "Soldier transfer failed.");
        } finally {
            setBusy(false);
        }
    };

    const shareGame = async () => {
        try {
            const { data } = await api.post(`/games/${game._id}/share`);
            const url = `${window.location.origin}/shared/${data.shareId}`;
            await navigator.clipboard.writeText(url);
            setMessage("Public game link copied to clipboard.");
        } catch {
            setMessage("Unable to create or copy the share link.");
        }
    };

    const logout = () => {
        localStorage.clear();
        navigate("/login");
    };

    const selectCountry = country => {
        if (!isPlayerTurn || isFinished || isEliminated) return;

        if (attackInProgress) {
            setMessage("Finish your current attack or stop it before selecting another country.");
            return;
        }

        if (country.owner === "You") {
            setSelected(country);
            setTarget(null);
        } else {
            setMessage("Select one of your own countries to attack from.");
        }
    };

    if (!game) {
        return (
            <div className="loading-screen">
                INITIALISING GLOBAL BATTLEFIELD...
            </div>
        );
    }

    return (
        <div className="game-shell">
            <header className="topbar">
                <div className="brand">
                    GEO<span>POLITICS</span>
                </div>

                <div className="top-stats">
                    <div>
                        <small>ROUND</small>
                        <strong>{game.round}</strong>
                    </div>
                    <div>
                        <small>TURN</small>
                        <strong>{game.currentPlayer || "Finished"}</strong>
                    </div>
                    <div>
                        <small>STATUS</small>
                        <strong>{game.status.toUpperCase()}</strong>
                    </div>
                </div>

                <div className="top-actions">
                    <button className="icon-btn" onClick={shareGame} title="Share game">
                        <Share2 size={18} />
                    </button>
                    <button className="icon-btn" onClick={logout} title="Logout">
                        <LogOut size={18} />
                    </button>
                </div>
            </header>

            <main className="game-grid">
                <aside className="panel territory-panel">
                    <div className="panel-head">
                        <div>
                            <p className="eyebrow">WORLD MAP</p>
                            <h2>Territories</h2>
                        </div>
                        <span className="count">{game.countries.length}</span>
                    </div>

                    <div className="territories">
                        {game.countries.map((country, index) => (
                            <button
                                key={country.name}
                                className={`
                                    territory
                                    ${country.owner === "You" ? "owned" : ""}
                                    ${selected?.name === country.name ? "selected" : ""}
                                `}
                                onClick={() => selectCountry(country)}
                            >
                                <div className="country-index">
                                    {String(index + 1).padStart(2, "0")}
                                </div>
                                <div className="country-name">
                                    <strong>{country.name}</strong>
                                    <small>{country.owner}</small>
                                </div>
                                <div className="army">
                                    <Shield size={14} />
                                    {country.soldiers}
                                </div>
                            </button>
                        ))}
                    </div>

                    <div className="territory-legend">
                        <span className="legend-player"></span> Your territory
                        <span className="legend-enemy"></span> NPC territory
                    </div>

                    <div className="instruction-box">
                        <button
                            className="instruction-toggle"
                            onClick={() => setShowInstructions(!showInstructions)}
                        >
                            <Info size={16} />
                            How to Play
                        </button>
                        {showInstructions && (
                            <div className="instruction-content">
                                <ul>
                                    <li>1. Click one of your green territories on the left to select it, it will turn purple once selected.</li>
                                    <li>2. Click an enemy territory you wish to fight in the enemy territory options to attack.</li>
                                    <li>3. Roll higher numbers to conquer land.</li>
                                    <li>4. Place reinforcements to territories of your choice every round.</li>
                                </ul>
                            </div>
                        )}
                    </div>
                </aside>

                <section className="battle-stage">
                    <div className="stage-title">
                        <div>
                            <p className="eyebrow">GLOBAL BATTLEFIELD</p>
                            <h1>Command Centre</h1>
                        </div>
                        <div className="turn-badge">
                            <span></span>
                            {isFinished ? "Campaign completed" : isEliminated ? "Spectating" : `${game.currentPlayer}'s turn`}
                        </div>
                    </div>

                    {isFinished && (
                        <div className="winner-card">
                            <Trophy size={35} />

                            <div>
                                <p className="eyebrow">
                                    CAMPAIGN RESULT
                                </p>

                                <h2>
                                    {game.winner === "You"
                                        ? "VICTORY"
                                        : "CAMPAIGN OVER"}
                                </h2>

                                <p>
                                    {game.winner === "You"
                                        ? "You control the battlefield."
                                        : `${game.winner} has conquered all territories.`}
                                </p>
                            </div>
                        </div>
                    )}

                    {reinforcementsDue > 0 && !isFinished && !isEliminated && (
                        <div className="panel reinforce-panel">
                            <div className="panel-head">
                                <div>
                                    <p className="eyebrow">REINFORCEMENTS</p>
                                    <h3>Distribute {reinforcementsDue} soldiers</h3>
                                </div>
                                <Zap size={19} />
                            </div>

                            <small style={{ marginBottom: "1rem", display: "block" }}>
                                {reinforcementsPlaced} of {reinforcementsDue} placed.
                            </small>

                            <div className="reinforce-grid">
                                {playerCountries.map(country => (
                                    <div key={country.name} className="reinforce-row">
                                        <span>{country.name}</span>
                                        <div className="reinforce-controls">
                                            <button
                                                className="reinforce-btn minus"
                                                onClick={() => updateReinforcement(country.name, -1)}
                                                disabled={busy || !reinforcements[country.name]}
                                            >
                                                -
                                            </button>
                                            <strong className="reinforce-value">
                                                {reinforcements[country.name] || 0}
                                            </strong>
                                            <button
                                                className="reinforce-btn plus"
                                                onClick={() => updateReinforcement(country.name, 1)}
                                                disabled={busy || reinforcementsPlaced >= reinforcementsDue}
                                            >
                                                +
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <button
                                className="transfer-btn reinforce-confirm-btn"
                                onClick={placeReinforcements}
                                disabled={busy || reinforcementsPlaced !== reinforcementsDue}
                            >
                                CONFIRM REINFORCEMENTS
                            </button>
                        </div>
                    )}

                    <div className="battle-card">
                        <div className="combatant">
                            <span className="combat-label">ATTACKER</span>
                            <h2>{selected?.name || "Select territory"}</h2>
                            <div className="force-number">{selected?.soldiers ?? "—"}</div>
                            <small>AVAILABLE FORCES</small>
                        </div>
                        <div className="versus">
                            <Swords size={28} />
                            <strong>VS</strong>
                            <span>COMBAT</span>
                        </div>
                        <div className="combatant enemy">
                            <span className="combat-label">DEFENDER</span>
                            <h2>{target?.name || "Choose a target"}</h2>
                            <div className="force-number">{target?.soldiers ?? "?"}</div>
                            <small>ENEMY FORCES</small>
                        </div>
                    </div>

                    <div className="dice-card">
                        <div>
                            <p className="eyebrow">LAST BATTLE</p>
                            <h3>{dice ? "Combat result" : "Awaiting engagement"}</h3>
                        </div>

                        <div className="dice-row" key={`dice-roll-${game.history.length}`}>
                            {(dice?.attackerDice || ["—"]).map((d, i) => (
                                <div className="die" key={`a${i}-${d}`}>{d}</div>
                            ))}
                            <span>VS</span>
                            {(dice?.defenderDice || ["—"]).map((d, i) => (
                                <div className="die enemy-die" key={`d${i}-${d}`}>{d}</div>
                            ))}
                        </div>

                        {dice && (
                            <div className="dice-summary">
                                <span>Attacker losses: {dice.attackerLosses}</span>
                                <span>Defender losses: {dice.defenderLosses}</span>
                                {dice.conquered && <strong> TERRITORY CONQUERED </strong>}
                                {dice.endReason === "attacker-exhausted" && <strong> ATTACKER EXHAUSTED </strong>}
                            </div>
                        )}
                    </div>

                    <div className="target-heading">
                        <div>
                            <p className="eyebrow">AVAILABLE TARGETS</p>
                            <h3>Enemy territories</h3>
                        </div>
                        <span>{enemies.length} remaining</span>
                    </div>

                    <div className="target-grid">
                        {enemies.map(enemy => {
                            const isCurrentTarget = attackInProgress && activeAttack?.target === enemy.name;

                            return (
                                <button
                                    key={enemy.name}
                                    className="target-btn"
                                    disabled={
                                        !selected || busy || !isPlayerTurn || isFinished || isEliminated ||
                                        reinforcementsDue > 0 || game.phase === "transfer" || (selected?.soldiers < 2) ||
                                        (attackInProgress && !isCurrentTarget)
                                    }
                                    onClick={() => attack(enemy)}
                                >
                                    <span>{enemy.name}</span>
                                    <small>{enemy.soldiers} soldiers</small>
                                    <ArrowRightLeft size={16} />
                                </button>
                            );
                        })}
                    </div>

                    {message && <div className="battle-message">{message}</div>}

                    <div className="panel transfer-panel">
                        <div className="panel-head">
                            <div>
                                <p className="eyebrow">MILITARY MOVEMENT</p>
                                <h3>Transfer soldiers</h3>
                            </div>
                            <ArrowRightLeft size={19} />
                        </div>

                        <div className="transfer-fields">
                            <select
                                value={transferFrom}
                                onChange={e => {
                                    setTransferFrom(e.target.value);
                                    setTransferTo("");
                                }}
                                disabled={!isPlayerTurn || busy || attackInProgress || isEliminated}
                            >
                                <option value="">Source territory</option>
                                {playerCountries.map(country => (
                                    <option key={country.name} value={country.name}>
                                        {country.name} ({country.soldiers})
                                    </option>
                                ))}
                            </select>

                            <select
                                value={transferTo}
                                onChange={e => setTransferTo(e.target.value)}
                                disabled={!isPlayerTurn || busy || attackInProgress || isEliminated}
                            >
                                <option value="">Destination territory</option>
                                {playerCountries
                                    .filter(c => c.name !== transferFrom)
                                    .map(country => (
                                        <option key={country.name} value={country.name}>
                                            {country.name} ({country.soldiers})
                                        </option>
                                    ))}
                            </select>

                            <input
                                type="number"
                                min="1"
                                step="1"
                                value={transferAmount}
                                onChange={e => setTransferAmount(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                                disabled={!isPlayerTurn || busy || attackInProgress || isEliminated}
                            />

                            <button
                                className="transfer-btn"
                                onClick={transfer}
                                disabled={!isPlayerTurn || busy || attackInProgress || isFinished || isEliminated}
                            >
                                TRANSFER
                            </button>
                        </div>

                        <small>
                            At least one soldier must remain in the source territory.
                            {attackInProgress && " Transfers are blocked while an attack is in progress."}
                        </small>
                    </div>
                </section>

                <aside className="right-column">
                    <div className="panel commander-card">
                        <p className="eyebrow">YOUR FORCES</p>
                        <h2>COMMANDER</h2>
                        <div className="big-stat">{totalSoldiers}</div>
                        <small>TOTAL SOLDIERS</small>
                        <div className="mini-stats">
                            <div>
                                <strong>{playerCountries.length}</strong>
                                <span>TERRITORIES</span>
                            </div>
                            <div>
                                <strong>{Math.round((playerCountries.length / 10) * 100)}%</strong>
                                <span>CONTROL</span>
                            </div>
                        </div>
                    </div>

                    <div className="panel npc-card">
                        <div className="panel-head">
                            <div>
                                <p className="eyebrow">AI INTELLIGENCE</p>
                                <h3>NPC Strategy</h3>
                            </div>
                            <Zap size={19} />
                        </div>
                        <p>{latestNpc?.reason || latestNpc?.message || "NPCs are analysing the battlefield."}</p>
                    </div>

                    <div className="panel controls-card">
                        <p className="eyebrow">CONTROLS</p>

                        <button onClick={fastForward} disabled={busy || isPlayerTurn || isFinished}>
                            <FastForward size={16} />
                            FAST FORWARD NPCs
                        </button>

                        <button onClick={skipTurn} disabled={busy || !isPlayerTurn || isFinished || isEliminated}>
                            <SkipForward size={16} />
                            {attackInProgress ? "STOP ATTACK" : "END MY TURN"}
                        </button>

                        <button onClick={() => { setSelected(null); setTarget(null); }}>
                            <Shield size={16} />
                            CLEAR SELECTION
                        </button>

                        <button onClick={load}>
                            <RefreshCw size={16} />
                            REFRESH GAME
                        </button>
                    </div>

                    <div className="panel log-card">
                        <div className="panel-head">
                            <div>
                                <p className="eyebrow">EVENT STREAM</p>
                                <h3>Battle Log</h3>
                            </div>
                            <Trophy size={18} />
                        </div>
                        <div className="log-list">
                            {recentHistory.map((entry, i) => (
                                <div key={`${entry.timestamp}-${i}`}>
                                    <span></span>
                                    <p>{entry.message}</p>
                                </div>
                            ))}
                        </div>
                    </div>

                    <button
                        className="new-campaign-btn"
                        onClick={() => {
                            localStorage.removeItem("gameId");
                            navigate("/new-game");
                        }}
                    >
                        START NEW CAMPAIGN
                    </button>
                </aside>
            </main>

            {showEliminationPopup && (
                <div className="elimination-overlay" onClick={() => setShowEliminationPopup(false)}>
                    <div className="elimination-popup">
                        <Skull size={70} />
                        <h1>GAME OVER!</h1>
                        <h2>YOU HAVE BEEN ELIMINATED</h2>
                        <p>You have lost your territory. The NPCs are the victors.</p>
                        <p>Click Start New Campaign to play again!</p>
                    </div>
                </div>
            )}

            {showVictoryPopup && (
                <div className="elimination-overlay" onClick={() => setShowVictoryPopup(false)}>
                    <div className="elimination-popup victory-popup">
                        <Trophy size={70} />
                        <h1>VICTORY!</h1>
                        <h2>YOU CONQUERED THE WORLD</h2>
                        <p>You control every territory on the battlefield.</p>
                        <p>Click Start New Campaign to play again!</p>
                    </div>
                </div>
            )}
        </div>
    );
}

export default Game;