import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
    Globe,
    Shield,
    Trophy,
    Swords
} from "lucide-react";

import api from "../services/api";

function SharedGame() {
    const { shareId } = useParams();

    const [game, setGame] = useState(null);
    const [message, setMessage] = useState("");
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;

        const loadSharedGame = async () => {
            setLoading(true);
            setMessage("");

            try {
                const { data } = await api.get(
                    `/games/public/${shareId}`
                );

                if (!cancelled) {
                    setGame(data);
                }

            } catch (error) {
                if (cancelled) return;

                if (error.response?.status === 404) {
                    setMessage("This shared campaign could not be found.");
                } else {
                    setMessage(
                        "Unable to load the shared campaign. " +
                        "Please try again later."
                    );
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        loadSharedGame();

        return () => {
            cancelled = true;
        };
    }, [shareId]);

    if (loading) {
        return (
            <div className="loading-screen">
                LOADING SHARED CAMPAIGN...
            </div>
        );
    }

    if (!game) {
        return (
            <div className="loading-screen">
                {message || "This shared campaign could not be found."}
            </div>
        );
    }

    const countries = game.countries || [];
    const history = game.history || [];

    const playerCount = [
        ...new Set(countries.map(c => c.owner))
    ].filter(owner => owner && owner !== "Unassigned").length;

    const recentHistory = history.slice(-20).reverse();

    return (
        <div className="shared-page">
            <header className="topbar">
                <div className="brand">
                    GEO<span>POLITICS</span>
                </div>

                <span className="shared-label">
                    <Globe size={15} />
                    PUBLIC GAME VIEW
                </span>
            </header>

            <main className="shared-content">
                <div className="shared-heading">
                    <p className="eyebrow">CAMPAIGN OBSERVATION</p>

                    <h1>Global Battlefield</h1>

                    <p>
                        This is a read-only view of a shared campaign.
                    </p>
                </div>

                <div className="shared-stats">
                    <div>
                        <small>ROUND</small>
                        <strong>{game.round ?? 1}</strong>
                    </div>

                    <div>
                        <small>ACTIVE PLAYER</small>
                        <strong>
                            {game.currentPlayer ||
                                (game.winner ? "—" : "Awaiting start")}
                        </strong>
                    </div>

                    <div>
                        <small>FACTIONS</small>
                        <strong>{playerCount}</strong>
                    </div>

                    <div>
                        <small>STATUS</small>
                        <strong>
                            {(game.status || "unknown").toUpperCase()}
                        </strong>
                    </div>
                </div>

                {game.status === "finished" && game.winner && (
                    <div className="winner-card">
                        <Trophy size={30} />

                        <div>
                            <p className="eyebrow">CAMPAIGN WINNER</p>
                            <h2>{game.winner}</h2>
                        </div>
                    </div>
                )}

                <section className="panel shared-territories">
                    <div className="panel-head">
                        <div>
                            <p className="eyebrow">WORLD MAP DATA</p>
                            <h2>Territories</h2>
                        </div>

                        <span className="count">
                            {countries.length}
                        </span>
                    </div>

                    <div className="territories">
                        {countries.map((country, index) => (
                            <div
                                className={`territory ${
                                    country.owner === "You" ? "owned" : ""
                                }`}
                                key={country.name}
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
                                    {country.soldiers ?? 0}
                                </div>
                            </div>
                        ))}

                        {countries.length === 0 && (
                            <p>
                                This campaign has not selected any territories yet.
                            </p>
                        )}
                    </div>
                </section>

                <section className="panel shared-log">
                    <div className="panel-head">
                        <div>
                            <p className="eyebrow">CAMPAIGN ACTIVITY</p>
                            <h2>Battle History</h2>
                        </div>

                        <Swords size={19} />
                    </div>

                    <div className="log-list">
                        {recentHistory.map((entry, index) => (
                            <div key={`${entry.timestamp || "t"}-${index}`}>
                                <span></span>
                                <p>{entry.message}</p>
                            </div>
                        ))}

                        {recentHistory.length === 0 && (
                            <p>No campaign activity recorded yet.</p>
                        )}
                    </div>
                </section>

                <Link to="/login" className="primary-btn shared-login">
                    CREATE YOUR OWN CAMPAIGN
                </Link>
            </main>
        </div>
    );
}

export default SharedGame;