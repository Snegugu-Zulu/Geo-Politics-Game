const express = require("express");
const crypto = require("crypto");

const Game = require("../models/Game");

const auth = require("../middleware/auth");
const protect = auth.protect || auth;

const {
    PLAYERS,
    getAvailableCountries,
    startGame,
    battle,
    getTurnReinforcements,
    allocateReinforcements,
    npcAllocateReinforcements,
    transferSoldiers,
    npcDecision,
    npcShouldContinueAttack,
    npcTransferDecision,
    getWinner,
    getNextPlayer,
    isNewRound
} = require("../game/gameLogic");

const router = express.Router();

/*
|--------------------------------------------------------------------------
| Helper functions
|--------------------------------------------------------------------------
*/

function getUserId(req) {
    return req.user?._id || req.user?.id;
}

function addHistory(game, type, message, details = {}) {
    game.history.push({
        type,
        message,
        round: game.round,
        ...details,
        timestamp: new Date()
    });
}

function attackEnded(result) {
    return result.attackEnded ?? (
        !!result.conquered || result.endReason === "attacker-exhausted"
    );
}

function finishIfNeeded(game) {
    if (game.status === "finished") {
        return true;
    }

    // Do not declare a winner while the game is still in setup.
    if (game.status !== "active") {
        return false;
    }

    const winner = getWinner(game.countries);

    if (winner) {
        game.status = "finished";
        game.phase = "finished";
        game.winner = winner;
        game.attackInProgress = null;

        addHistory(
            game,
            "win",
            `${winner} has won the campaign by controlling all remaining territories.`,
            { player: winner }
        );

        return true;
    }

    return false;
}

// Log a conquest and, if the previous owner has nothing left, their elimination.
function recordConquest(game, conqueror, countryName, previousOwner, soldiersGained) {
    addHistory(
        game,
        "conquest",
        `${conqueror} conquered ${countryName} from ${previousOwner} and gained ${soldiersGained} soldiers there.`,
        {
            player: conqueror,
            defender: countryName,
            previousOwner,
            soldiersGained
        }
    );

    const remaining = game.countries.filter(
        c => c.owner === previousOwner
    ).length;

    if (remaining === 0 && previousOwner !== "Unassigned") {
        addHistory(
            game,
            "elimination",
            `${previousOwner} has lost every territory and is eliminated.`,
            { player: previousOwner }
        );
    }
}

// One line describing a single round of dice (used as the fallback text).
function describeRound(attackerName, defenderName, result) {
    return `${attackerName} rolled [${result.attackerDice.join(", ")}] against ${defenderName}'s [${result.defenderDice.join(", ")}]: attacker lost ${result.attackerLosses}, defender lost ${result.defenderLosses}.`;
}

// Log one round of dice so every roll can be shown in the UI.
function addBattleRound(game, player, attackerName, defenderName, result, roundNumber) {
    addHistory(
        game,
        "battle",
        `Round ${roundNumber}: ${describeRound(attackerName, defenderName, result)}`,
        {
            player,
            attacker: attackerName,
            defender: defenderName,
            attackerDice: result.attackerDice,
            defenderDice: result.defenderDice,
            attackerLosses: result.attackerLosses,
            defenderLosses: result.defenderLosses,
            conquered: result.conquered,
            soldiersGained: result.soldiersGained,
            previousOwner: result.previousOwner,
            endReason: result.endReason
        }
    );
}

// Place pending reinforcements automatically if the player skips or attacks without placing them.
function autoApplyPendingReinforcements(game, owner) {
    if (game.round < 2) return null;
    if (game.reinforcementsReceived) return null;

    try {
        const amount = getTurnReinforcements(game, owner);
        if (amount <= 0) return null;

        const owned = game.countries.filter(c => c.owner === owner);
        if (owned.length === 0) return null;

        const weakest = [...owned].sort((a, b) => a.soldiers - b.soldiers)[0];

        const result = allocateReinforcements(game, owner, [
            { country: weakest.name, amount }
        ]);

        game.reinforcementsReceived = true;

        addHistory(
            game,
            "reinforce",
            `${owner} auto-placed ${amount} reinforcement(s) in ${weakest.name}.`,
            {
                player: owner,
                amount,
                allocations: result.allocations
            }
        );

        return result;
    } catch (err) {
        return null;
    }
}

// LLM battle commentary. Returns null on any failure so callers can fall back
// to static text. summary: { attackerDice, defenderDice, attackerLosses,
// defenderLosses, conquered, endReason }
function generateBattleCommentary(attacker, defender, summary) {
    const attackerLosses = summary.attackerLosses || 0;
    const defenderLosses = summary.defenderLosses || 0;

    const attackerDice = summary.attackerDice || [];
    const defenderDice = summary.defenderDice || [];

    let messages = [];

    if (summary.conquered) {
        messages = [
            `${attacker} has conquered ${defender}! The territory is now under new control.`,
            `Victory for ${attacker}! ${defender} has fallen after a fierce battle.`,
            `${attacker} successfully takes control of ${defender}. A major victory!`
        ];
    } 
    else if (summary.endReason === "attacker-exhausted") {
        messages = [
            `${defender} successfully defended its territory. ${attacker} could not continue the attack.`,
            `${attacker} has exhausted its forces. ${defender} remains in control.`,
            `The defence holds! ${defender} survives the attack from ${attacker}.`
        ];
    } 
    else if (attackerLosses > defenderLosses) {
        messages = [
            `${defender} has the advantage! ${attacker} suffered heavier losses.`,
            `A difficult battle for ${attacker}, who lost more soldiers than ${defender}.`,
            `${defender} resisted strongly and inflicted greater losses on the attacker.`
        ];
    } 
    else if (defenderLosses > attackerLosses) {
        messages = [
            `${attacker} is gaining the advantage! The defender suffered heavier losses.`,
            `${attacker} has weakened the defending forces and is gaining momentum.`,
            `The attack puts ${defender} under pressure after significant defensive losses.`
        ];
    } 
    else {
        messages = [
            `Both sides suffered equal losses. The battle between ${attacker} and ${defender} remains intense.`,
            `Neither side gained a clear advantage. Both armies suffered equal losses.`,
            `A closely contested battle! ${attacker} and ${defender} lost the same number of soldiers.`
        ];
    }

    const message = messages[Math.floor(Math.random() * messages.length)];

    return `${message} Losses: ${attacker} ${attackerLosses}, ${defender} ${defenderLosses}.`;
}

// Advance to the next living player, wrapping the round when the order loops.
function advanceTurn(game) {
    if (finishIfNeeded(game)) return;

    const previousPlayer = game.currentPlayer;

    const nextPlayer = getNextPlayer(
        game.countries,
        game.currentPlayer
    );

    if (!nextPlayer) {
        game.status = "finished";
        game.phase = "finished";
        return;
    }

    if (isNewRound(game.firstPlayer || PLAYERS[0], previousPlayer, nextPlayer)) {
        game.round += 1;

        addHistory(
            game,
            "event",
            `Round ${game.round} has started.`
        );
    }

    game.currentPlayer = nextPlayer;
    game.phase = "attack";
    game.attackInProgress = null;
    game.reinforcementsReceived = false;

    finishIfNeeded(game);
}

// Execute one full NPC turn (reinforcements, transfers, multi-round attack).
// With skipCommentary the battle text is a static fallback and the Gemini request
// is returned in decision.pendingCommentary so the caller can fetch it in parallel.
async function executeNpcTurn(game, skipCommentary = false) {
    const npcName = game.currentPlayer;

    if (!npcName || npcName === "You") {
        throw new Error("It is not an NPC turn.");
    }

    const decision = { reinforcement: null, transfers: [] };

    // 1. Reinforcements (round 2+).
    const reinforcement = npcAllocateReinforcements(game, npcName);

    if (reinforcement.amount > 0) {
        addHistory(
            game,
            "reinforce",
            reinforcement.reason,
            {
                player: npcName,
                amount: reinforcement.amount,
                allocations: [
                    {
                        country: reinforcement.country,
                        amount: reinforcement.amount
                    }
                ]
            }
        );

        decision.reinforcement = {
            country: reinforcement.country,
            amount: reinforcement.amount,
            reason: reinforcement.reason
        };
    }

    // 2. Transfers: consolidate soldiers when it unlocks a better attack.
    for (let i = 0; i < PLAYERS.length; i++) {
        const move = npcTransferDecision(game.countries, npcName);

        if (move.action !== "transfer") break;

        transferSoldiers(
            game.countries,
            npcName,
            move.from,
            move.target,
            move.amount
        );

        addHistory(
            game,
            "transfer",
            move.reason,
            {
                player: npcName,
                from: move.from,
                target: move.target,
                amount: move.amount
            }
        );

        decision.transfers.push({
            from: move.from,
            target: move.target,
            amount: move.amount,
            reason: move.reason
        });
    }

    // 3. Attack decision.
    const attackDecision = npcDecision(game.countries, npcName);

    decision.action = attackDecision.action;
    decision.reason = attackDecision.reason;
    decision.from = attackDecision.from;
    decision.target = attackDecision.target;

    if (attackDecision.action === "attack") {
        const attacker = game.countries.find(
            country => country.name === attackDecision.from
        );

        const defender = game.countries.find(
            country => country.name === attackDecision.target
        );

        if (!attacker || !defender) {
            throw new Error("NPC selected an invalid territory.");
        }

        addHistory(
            game,
            "attack-decision",
            attackDecision.reason,
            {
                player: npcName,
                attacker: attacker.name,
                defender: defender.name
            }
        );

        // Keep rolling until conquest, exhaustion, or the NPC decides to stop.
        const rounds = [];
        let stopReason = null;

        let current = battle(attacker, defender);
        rounds.push(current);
        addBattleRound(game, npcName, attacker.name, defender.name, current, rounds.length);

        while (!attackEnded(current)) {
            const cont = npcShouldContinueAttack(attacker, defender);

            if (!cont.continue) {
                stopReason = cont.reason;
                break;
            }

            current = battle(attacker, defender);
            rounds.push(current);
            addBattleRound(game, npcName, attacker.name, defender.name, current, rounds.length);
        }

        if (stopReason) {
            addHistory(
                game,
                "attack-decision",
                stopReason,
                {
                    player: npcName,
                    attacker: attacker.name,
                    defender: defender.name
                }
            );
        }

        const last = rounds[rounds.length - 1];

        const totalAttackerLosses = rounds.reduce(
            (s, r) => s + r.attackerLosses, 0
        );
        const totalDefenderLosses = rounds.reduce(
            (s, r) => s + r.defenderLosses, 0
        );

        const commentaryInput = {
            attackerDice: last.attackerDice,
            defenderDice: last.defenderDice,
            attackerLosses: totalAttackerLosses,
            defenderLosses: totalDefenderLosses,
            conquered: last.conquered,
            endReason: last.endReason
        };

        const llmCommentary = skipCommentary
            ? null
            : await generateBattleCommentary(
                attacker.name,
                defender.name,
                commentaryInput
            );

        const battleMessage = llmCommentary || (
            last.conquered
                ? `${npcName} conquered ${defender.name} from ${attacker.name} after ${rounds.length} round(s).`
                : `${npcName} attacked ${defender.name} from ${attacker.name} for ${rounds.length} round(s) without conquering it.`
        );

        addHistory(
            game,
            "attack-result",
            battleMessage,
            {
                player: npcName,
                attacker: attacker.name,
                defender: defender.name,
                attackerDice: last.attackerDice,
                defenderDice: last.defenderDice,
                attackerLosses: totalAttackerLosses,
                defenderLosses: totalDefenderLosses,
                conquered: last.conquered,
                soldiersGained: last.soldiersGained,
                previousOwner: last.previousOwner,
                endReason: last.endReason
            }
        );

        if (skipCommentary) {
            decision.pendingCommentary = {
                index: game.history.length - 1,
                attacker: attacker.name,
                defender: defender.name,
                summary: commentaryInput
            };
        }

        if (last.conquered) {
            recordConquest(
                game,
                npcName,
                defender.name,
                last.previousOwner,
                last.soldiersGained
            );
        }

        decision.result = {
            rounds,
            commentary: llmCommentary,
            attackerDice: last.attackerDice,
            defenderDice: last.defenderDice,
            attackerLosses: totalAttackerLosses,
            defenderLosses: totalDefenderLosses,
            conquered: last.conquered,
            soldiersGained: last.soldiersGained,
            attackEnded: true,
            endReason: last.endReason,
            stopReason
        };
    } else {
        addHistory(
            game,
            "event",
            attackDecision.reason,
            { player: npcName }
        );
    }

    finishIfNeeded(game);

    if (game.status !== "finished") {
        advanceTurn(game);
    }

    return decision;
}

/*
|--------------------------------------------------------------------------
| PUBLIC ROUTES
| Must stay above router.use(protect).
|--------------------------------------------------------------------------
*/

// Full country list for the "pick your country" screen.
router.get("/countries", async (req, res) => {
    try {
        return res.json(getAvailableCountries());
    } catch (error) {
        console.error("Countries error:", error);

        return res.status(500).json({
            message: "Unable to retrieve countries."
        });
    }
});

// Anyone with the share link can view a campaign.
router.get("/public/:shareId", async (req, res) => {
    try {
        const game = await Game.findOne({
            shareId: req.params.shareId
        }).select("-user");

        if (!game) {
            return res.status(404).json({
                message: "Shared game not found."
            });
        }

        return res.json(game);

    } catch (error) {
        console.error("Public game error:", error);

        return res.status(500).json({
            message: "Unable to retrieve shared game."
        });
    }
});

/*
|--------------------------------------------------------------------------
| PROTECTED ROUTES
|--------------------------------------------------------------------------
*/

router.use(protect);

/*
|--------------------------------------------------------------------------
| LIST MY GAMES
| GET /api/games
|--------------------------------------------------------------------------
*/

router.get("/", async (req, res) => {
    try {
        const games = await Game.find({ user: getUserId(req) })
            .select("selectedCountry status phase round currentPlayer winner shareId createdAt updatedAt")
            .sort({ updatedAt: -1 });

        return res.json(games);

    } catch (error) {
        console.error("List games error:", error);

        return res.status(500).json({
            message: "Unable to retrieve your games."
        });
    }
});

/*
|--------------------------------------------------------------------------
| CREATE A NEW GAME
| POST /api/games/new
|
|  - With { selectedCountry }: creates and starts the game in one shot.
|  - Without a body:         creates a "setup" game for the two-step
|                            create -> /start flow.
|--------------------------------------------------------------------------
*/

router.post("/new", async (req, res) => {
    try {
        const { selectedCountry } = req.body || {};

        if (selectedCountry) {
            const state = startGame(selectedCountry);

            const game = await Game.create({
                user: getUserId(req),
                countries: state.countries,
                turnOrder: state.players,
                currentPlayer: state.currentPlayer,
                firstPlayer: state.firstPlayer,
                round: state.round,
                status: "active",
                phase: "attack",
                winner: state.winner,
                selectedCountry,
                reinforcementsReceived: false,
                attackInProgress: null,
                history: [
                    {
                        type: "event",
                        message: `A new campaign has started with ${selectedCountry}. ${state.firstPlayer} takes the first turn.`,
                        player: "You",
                        round: 1,
                        timestamp: new Date()
                    }
                ]
            });

            return res.status(201).json(game);
        }

        // Setup shell: a random sample of the country list matching the game's 10-country size.
        const shuffledCandidates = [...getAvailableCountries()].sort(
            () => Math.random() - 0.5);

        const placeholderCountries = shuffledCandidates
            .slice(0, PLAYERS.length)
            .map(c => ({
                name: c.name,
                population: c.population,
                soldierValue: c.soldierValue,
                soldiers: c.soldierValue,
                owner: "Unassigned"
            }));

        const game = await Game.create({
            user: getUserId(req),
            countries: placeholderCountries,
            turnOrder: [...PLAYERS],
            currentPlayer: "You",
            round: 1,
            status: "setup",
            phase: "setup",
            winner: null,
            reinforcementsReceived: false,
            attackInProgress: null,
            history: [
                {
                    type: "event",
                    message: "A new campaign has been created. Select your country to begin.",
                    round: 1,
                    timestamp: new Date()
                }
            ]
        });

        return res.status(201).json(game);

    } catch (error) {
        console.error("Create game error:", error);

        return res.status(500).json({
            message: error.message || "Unable to create a new game."
        });
    }
});

/*
|--------------------------------------------------------------------------
| GET ONE GAME
| GET /api/games/:id
|--------------------------------------------------------------------------
*/

router.get("/:id", async (req, res) => {
    try {
        const game = await Game.findOne({
            _id: req.params.id,
            user: getUserId(req)
        });

        if (!game) {
            return res.status(404).json({
                message: "Game not found."
            });
        }

        return res.json(game);

    } catch (error) {
        console.error("Load game error:", error);

        return res.status(500).json({
            message: "Unable to load game."
        });
    }
});

/*
|--------------------------------------------------------------------------
| START GAME
| POST /api/games/:id/start
|--------------------------------------------------------------------------
*/

router.post("/:id/start", async (req, res) => {
    try {
        const game = await Game.findOne({
            _id: req.params.id,
            user: getUserId(req)
        });

        if (!game) {
            return res.status(404).json({
                message: "Game not found."
            });
        }

        if (game.status !== "setup") {
            return res.status(400).json({
                message: "This game has already started."
            });
        }

        const { selectedCountry } = req.body;

        if (!selectedCountry) {
            return res.status(400).json({
                message: "Please select a country."
            });
        }

        const state = startGame(selectedCountry);

        game.countries = state.countries;
        game.turnOrder = state.players;
        game.currentPlayer = state.currentPlayer;
        game.firstPlayer = state.firstPlayer;
        game.round = state.round;
        game.winner = state.winner;
        game.selectedCountry = selectedCountry;
        game.reinforcementsReceived = false;
        game.attackInProgress = null;
        game.phase = "attack";
        game.status = "active";

        addHistory(
            game,
            "event",
            `The campaign has started. You selected ${selectedCountry}. ${state.firstPlayer} plays first.`,
            { player: "You" }
        );

        await game.save();

        return res.json(game);

    } catch (error) {
        console.error("Start game error:", error);

        return res.status(400).json({
            message: error.message || "Unable to start game."
        });
    }
});

/*
|--------------------------------------------------------------------------
| PLACE REINFORCEMENTS (human)
| POST /api/games/:id/reinforce
|--------------------------------------------------------------------------
*/

router.post("/:id/reinforce", async (req, res) => {
    try {
        const game = await Game.findOne({
            _id: req.params.id,
            user: getUserId(req)
        });

        if (!game) {
            return res.status(404).json({ message: "Game not found." });
        }

        if (game.status !== "active") {
            return res.status(400).json({ message: "This game is not active." });
        }

        if (game.currentPlayer !== "You") {
            return res.status(400).json({ message: "It is not your turn." });
        }

        if (game.round < 2) {
            return res.status(400).json({
                message: "No reinforcements are available in round 1."
            });
        }

        if (game.reinforcementsReceived) {
            return res.status(400).json({
                message: "You have already placed reinforcements this turn."
            });
        }

        const { allocations } = req.body;

        if (!Array.isArray(allocations) || allocations.length === 0) {
            return res.status(400).json({
                message: "Choose where to place your soldiers."
            });
        }

        for (const a of allocations) {
            if (!Number.isInteger(Number(a.amount))) {
                return res.status(400).json({
                    message: "Reinforcements must be whole soldiers."
                });
            }
        }

        const result = allocateReinforcements(game, "You", allocations);

        game.reinforcementsReceived = true;

        addHistory(
            game,
            "reinforce",
            `You placed ${result.amount} reinforcement(s).`,
            {
                player: "You",
                amount: result.amount,
                allocations: result.allocations
            }
        );

        await game.save();

        return res.json({ game, result });

    } catch (error) {
        console.error("Reinforce error:", error);

        return res.status(400).json({
            message: error.message || "Unable to place reinforcements."
        });
    }
});

/*
|--------------------------------------------------------------------------
| PLAYER ATTACK (one round per call)
| POST /api/games/:id/attack
|--------------------------------------------------------------------------
*/

router.post("/:id/attack", async (req, res) => {
    try {
        const game = await Game.findOne({
            _id: req.params.id,
            user: getUserId(req)
        });

        if (!game) {
            return res.status(404).json({ message: "Game not found." });
        }

        if (game.status !== "active") {
            return res.status(400).json({ message: "This game is not active." });
        }

        if (game.currentPlayer !== "You") {
            return res.status(400).json({ message: "It is not your turn." });
        }

        // One attack per turn: after a conquest the player may only transfer or end the turn.
        if (game.phase === "transfer") {
            return res.status(400).json({
                message: "You have already attacked this turn. Transfer soldiers or end your turn."
            });
        }

        const { from, target } = req.body;

        if (!from || !target) {
            return res.status(400).json({
                message: "Specify attacker and target."
            });
        }

        if (
            game.attackInProgress &&
            (game.attackInProgress.from !== from ||
                game.attackInProgress.target !== target)
        ) {
            return res.status(400).json({
                message: "Finish your current attack before starting a new one."
            });
        }

        const attacker = game.countries.find(c => c.name === from);
        const defender = game.countries.find(c => c.name === target);

        if (!attacker || !defender) {
            return res.status(404).json({ message: "Country not found." });
        }

        if (attacker.owner !== "You") {
            return res.status(400).json({
                message: "You do not own the attacking country."
            });
        }

        if (defender.owner === "You") {
            return res.status(400).json({
                message: "You cannot attack your own country."
            });
        }

        if (attacker.name === defender.name) {
            return res.status(400).json({
                message: "Choose a different target."
            });
        }

        if (attacker.soldiers < 2) {
            return res.status(400).json({
                message: "The attacker needs at least two soldiers."
            });
        }

        autoApplyPendingReinforcements(game, "You");

        const result = battle(attacker, defender);
        const ended = attackEnded(result);

        const commentary = await generateBattleCommentary(
            attacker.name,
            defender.name,
            result
        );

        const message = commentary || (
            result.conquered
                ? `You conquered ${defender.name} from ${attacker.name}.`
                : describeRound(attacker.name, defender.name, result)
        );

        addHistory(
            game,
            "battle",
            message,
            {
                player: "You",
                attacker: attacker.name,
                defender: defender.name,
                attackerDice: result.attackerDice,
                defenderDice: result.defenderDice,
                attackerLosses: result.attackerLosses,
                defenderLosses: result.defenderLosses,
                conquered: result.conquered,
                soldiersGained: result.soldiersGained,
                previousOwner: result.previousOwner,
                endReason: result.endReason
            }
        );

        if (result.conquered) {
            recordConquest(
                game,
                "You",
                defender.name,
                result.previousOwner,
                result.soldiersGained
            );
        }

        if (ended) {
            game.attackInProgress = null;

            if (result.conquered && !finishIfNeeded(game)) {
                // Stay on the player's turn so they can move soldiers into
                // the conquered country, then end the turn with /skip.
                game.phase = "transfer";
            } else {
                advanceTurn(game);
            }
        } else {
            game.attackInProgress = {
                from: attacker.name,
                target: defender.name
            };
        }

        finishIfNeeded(game);

        await game.save();

        return res.json({ game, result, commentary });

    } catch (error) {
        console.error("Attack error:", error);

        return res.status(400).json({
            message: error.message || "Battle failed."
        });
    }
});

/*
|--------------------------------------------------------------------------
| TRANSFER SOLDIERS
| POST /api/games/:id/transfer
|--------------------------------------------------------------------------
*/

router.post("/:id/transfer", async (req, res) => {
    try {
        const game = await Game.findOne({
            _id: req.params.id,
            user: getUserId(req)
        });

        if (!game) {
            return res.status(404).json({ message: "Game not found." });
        }

        if (game.status !== "active" || game.currentPlayer !== "You") {
            return res.status(400).json({
                message: "You can only transfer soldiers during your turn."
            });
        }

        if (game.attackInProgress) {
            return res.status(400).json({
                message: "You cannot transfer soldiers while an attack is in progress."
            });
        }

        const { from, target, amount } = req.body;

        const result = transferSoldiers(
            game.countries,
            "You",
            from,
            target,
            amount
        );

        addHistory(
            game,
            "transfer",
            `You transferred ${result.amount} soldiers from ${result.from} to ${result.target}.`,
            {
                player: "You",
                from: result.from,
                target: result.target,
                amount: result.amount
            }
        );

        await game.save();

        return res.json({ game, result });

    } catch (error) {
        console.error("Transfer error:", error);

        return res.status(400).json({
            message: error.message || "Soldier transfer failed."
        });
    }
});

/*
|--------------------------------------------------------------------------
| END PLAYER TURN (also stops an attack or finishes the transfer phase)
| POST /api/games/:id/skip
|--------------------------------------------------------------------------
*/

router.post("/:id/skip", async (req, res) => {
    try {
        const game = await Game.findOne({
            _id: req.params.id,
            user: getUserId(req)
        });

        if (!game) {
            return res.status(404).json({ message: "Game not found." });
        }

        if (game.status !== "active" || game.currentPlayer !== "You") {
            return res.status(400).json({
                message: "You cannot end this turn."
            });
        }

        autoApplyPendingReinforcements(game, "You");

        addHistory(
            game,
            "skip",
            game.attackInProgress
                ? "You stopped the attack and ended your turn."
                : "You ended your turn.",
            { player: "You" }
        );

        advanceTurn(game);

        await game.save();

        return res.json({ game });

    } catch (error) {
        console.error("Skip turn error:", error);

        return res.status(400).json({
            message: error.message || "Unable to end turn."
        });
    }
});

/*
|--------------------------------------------------------------------------
| PROCESS ONE NPC TURN
| POST /api/games/:id/npc-turn
|--------------------------------------------------------------------------
*/

router.post("/:id/npc-turn", async (req, res) => {
    try {
        const game = await Game.findOne({
            _id: req.params.id,
            user: getUserId(req)
        });

        if (!game) {
            return res.status(404).json({ message: "Game not found." });
        }

        if (game.status !== "active") {
            return res.status(400).json({ message: "This game is not active." });
        }

        if (game.currentPlayer === "You") {
            return res.status(400).json({
                message: "It is your turn, not an NPC turn."
            });
        }

        const decision = await executeNpcTurn(game);

        await game.save();

        return res.json({ game, decision });

    } catch (error) {
        console.error("NPC turn error:", error);

        return res.status(400).json({
            message: error.message || "Unable to process NPC turn."
        });
    }
});

/*
|--------------------------------------------------------------------------
| FAST-FORWARD ALL NPC TURNS
| POST /api/games/:id/fast-forward
|--------------------------------------------------------------------------
*/

router.post("/:id/fast-forward", async (req, res) => {
    try {
        const game = await Game.findOne({
            _id: req.params.id,
            user: getUserId(req)
        });

        if (!game) {
            return res.status(404).json({ message: "Game not found." });
        }

        if (game.status !== "active") {
            return res.status(400).json({ message: "This game is not active." });
        }

        if (game.currentPlayer === "You") {
            return res.status(400).json({
                message: "It is your turn. NPC turns cannot be fast-forwarded."
            });
        }

        const decisions = [];

        // Safety limit prevents an endless loop if the player is eliminated.
        let processed = 0;
        const maxTurns = 20;

        while (
            game.status === "active" &&
            game.currentPlayer !== "You" &&
            processed < maxTurns
        ) {
            const npcName = game.currentPlayer;

            // No LLM commentary during fast-forward, so there is no delay.
            const decision = await executeNpcTurn(game, true);

            decisions.push({
                player: npcName,
                action: decision.action,
                from: decision.from || null,
                target: decision.target || null,
                reason: decision.reason,
                reinforcement: decision.reinforcement,
                transfers: decision.transfers,
                result: decision.result || null
            });

            processed++;
        }

        await game.save();

        return res.json({ game, decisions });

    } catch (error) {
        console.error("Fast-forward error:", error);

        return res.status(400).json({
            message: error.message || "Unable to process NPC turns."
        });
    }
});

/*
|--------------------------------------------------------------------------
| CREATE OR REUSE A PUBLIC SHARE LINK
| POST /api/games/:id/share
|--------------------------------------------------------------------------
*/

router.post("/:id/share", async (req, res) => {
    try {
        const game = await Game.findOne({
            _id: req.params.id,
            user: getUserId(req)
        });

        if (!game) {
            return res.status(404).json({ message: "Game not found." });
        }

        if (!game.shareId) {
            game.shareId = crypto.randomBytes(16).toString("hex");
            await game.save();
        }

        return res.json({ shareId: game.shareId });

    } catch (error) {
        console.error("Share game error:", error);

        return res.status(500).json({
            message: "Unable to create a share link."
        });
    }
});

module.exports = router;