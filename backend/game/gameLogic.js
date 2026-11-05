const allCountries = require("../data/countries");

const PLAYERS = [
    "You",
    "NPC 1",
    "NPC 2",
    "NPC 3",
    "NPC 4",
    "NPC 5",
    "NPC 6",
    "NPC 7",
    "NPC 8",
    "NPC 9"
];

const TOTAL_COUNTRIES = PLAYERS.length;

// An NPC only attacks when it has at least this many more soldiers than the target.
const ATTACK_MARGIN = 2;

// Population determines the starting soldier count.
function soldierValue(population) {
    if (population <= 5_000_000) return 1;
    if (population <= 10_000_000) return 2;
    if (population <= 25_000_000) return 3;
    if (population <= 50_000_000) return 4;
    if (population <= 75_000_000) return 5;
    if (population <= 100_000_000) return 6;
    if (population <= 125_000_000) return 7;
    if (population <= 150_000_000) return 8;

    return 9;
}

function shuffle(array) {
    const result = [...array];

    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));

        [result[i], result[j]] = [
            result[j],
            result[i]
        ];
    }

    return result;
}

function findCountry(countries, name) {
    return countries.find(
        country => country.name === name
    );
}

// List every country in the world so the player can choose one.
function getAvailableCountries() {
    return allCountries.map(country => ({
        name: country.name,
        population: country.population,
        soldierValue: soldierValue(country.population)
    }));
}

// The player picks one country; nine others are selected at random.
function createInitialCountries(selectedCountry) {
    if (allCountries.length < TOTAL_COUNTRIES) {
        throw new Error("At least ten countries are required.");
    }

    const selected = findCountry(allCountries, selectedCountry);

    if (!selected) {
        throw new Error("Please select a valid country.");
    }

    const others = shuffle(
        allCountries.filter(country => country.name !== selectedCountry)
    ).slice(0, TOTAL_COUNTRIES - 1);

    // PLAYERS[0] is the human, PLAYERS[1..9] are the NPCs.
    const chosen = [selected, ...others].map((country, index) => {
        const soldiers = soldierValue(country.population);

        return {
            name: country.name,
            population: country.population,
            soldierValue: soldiers,
            soldiers,
            owner: PLAYERS[index]
        };
    });

    return shuffle(chosen);
}

// Start the game after the player selects a country.
function startGame(selectedCountry) {
    const countries = createInitialCountries(selectedCountry);

    const firstPlayer = PLAYERS[
        Math.floor(Math.random() * PLAYERS.length)
    ];

    return {
        countries,
        players: [...PLAYERS],
        firstPlayer,
        currentPlayer: firstPlayer,
        round: 1,
        reinforcementsReceived: false,
        winner: null
    };
}

function rollDice(numberOfDice) {
    const dice = [];

    for (let i = 0; i < numberOfDice; i++) {
        dice.push(Math.floor(Math.random() * 6) + 1);
    }

    return dice;
}

// Validate an attack before any dice are rolled.
function startAttack(countries, owner, attackerName, targetName) {
    const attacker = findCountry(countries, attackerName);
    const defender = findCountry(countries, targetName);

    if (!attacker || !defender) {
        throw new Error("Country not found.");
    }

    if (attacker.owner !== owner) {
        throw new Error("You can only attack from a country you control.");
    }

    if (defender.owner === owner) {
        throw new Error("You cannot attack your own territory.");
    }

    if (attacker.soldiers < 2) {
        throw new Error("The attacker needs at least two soldiers.");
    }

    return {
        attacker,
        defender
    };
}

// Resolve ONE round of dice. Call it repeatedly until attackEnded is true
// (or until the attacker chooses to stop and skip the turn).
function battle(attacker, defender) {
    if (attacker.soldiers < 2) {
        throw new Error("The attacker needs at least two soldiers.");
    }

    if (defender.soldiers < 1) {
        throw new Error("The defender has no soldiers.");
    }

    if (attacker.owner === defender.owner) {
        throw new Error("You cannot attack your own territory.");
    }

    // The attacker must leave one soldier behind.
    // The number of dice is limited by the smaller side.
    const diceCount = Math.min(
        attacker.soldiers - 1,
        defender.soldiers
    );

    const attackerDice = rollDice(diceCount);
    const defenderDice = rollDice(diceCount);

    let attackerLosses = 0;
    let defenderLosses = 0;

    const pairs = [];

    // Die 1 fights die 1, die 2 fights die 2, and so on.
    for (let i = 0; i < diceCount; i++) {
        let winner;

        if (attackerDice[i] > defenderDice[i]) {
            winner = "attacker";
            defenderLosses++;
        } else if (attackerDice[i] < defenderDice[i]) {
            winner = "defender";
            attackerLosses++;
        } else {
            // A tie means nobody loses a soldier.
            winner = "tie";
        }

        pairs.push({
            attackerDie: attackerDice[i],
            defenderDie: defenderDice[i],
            winner
        });
    }

    attacker.soldiers -= attackerLosses;
    defender.soldiers -= defenderLosses;

    let conquered = false;
    let soldiersGained = 0;
    let previousOwner = defender.owner;

    if (defender.soldiers <= 0) {
        conquered = true;

        // Soldiers gained = Max(2, conquered country's soldier value / 2), rounded down.
        soldiersGained = Math.max(
            2,
            Math.floor(defender.soldierValue / 2)
        );

        defender.owner = attacker.owner;
        defender.soldiers = soldiersGained;
    }

    // The attack ends when the country is conquered
    // or the attacker is left with a single soldier.
    const attackEnded = conquered || attacker.soldiers < 2;

    let endReason = null;

    if (conquered) {
        endReason = "conquered";
    } else if (attacker.soldiers < 2) {
        endReason = "attacker-exhausted";
    }

    return {
        attackerDice,
        defenderDice,
        pairs,
        attackerLosses,
        defenderLosses,
        conquered,
        soldiersGained,
        previousOwner,
        attackEnded,
        endReason
    };
}

// Receive 2 soldiers for every country controlled.
function calculateReinforcements(countries, owner) {
    const ownedCountries = countries.filter(
        country => country.owner === owner
    );

    return ownedCountries.length * 2;
}

// Reinforcements are only received from the second round onward.
function getTurnReinforcements(game, owner = game.currentPlayer) {
    if (game.round < 2) {
        return 0;
    }

    return calculateReinforcements(
        game.countries,
        owner
    );
}

// Place reinforcements in any combination.
// allocations example: [{ country: "India", amount: 3 }, { country: "Peru", amount: 1 }]
function allocateReinforcements(game, owner, allocations) {
    const total = getTurnReinforcements(game, owner);

    if (total === 0) {
        throw new Error("There are no reinforcements to place this turn.");
    }

    if (game.reinforcementsReceived) {
        throw new Error("Reinforcements have already been placed this turn.");
    }

    if (!Array.isArray(allocations) || allocations.length === 0) {
        throw new Error("Choose where to place your soldiers.");
    }

    let allocated = 0;

    for (const allocation of allocations) {
        const country = findCountry(game.countries, allocation.country);
        const amount = Number(allocation.amount);

        if (!country || country.owner !== owner) {
            throw new Error("You can only reinforce your own countries.");
        }

        if (!Number.isInteger(amount) || amount < 0) {
            throw new Error("Enter a valid number of soldiers.");
        }

        allocated += amount;
    }

    if (allocated !== total) {
        throw new Error(`You must place exactly ${total} soldiers.`);
    }

    // Everything is valid, so apply the changes.
    for (const allocation of allocations) {
        const country = findCountry(game.countries, allocation.country);

        country.soldiers += Number(allocation.amount);
    }

    game.reinforcementsReceived = true;

    return {
        amount: total,
        allocations: allocations.map(allocation => ({
            country: allocation.country,
            amount: Number(allocation.amount)
        }))
    };
}

// NPCs stack their reinforcements on their strongest country to build an attacking force.
function npcAllocateReinforcements(game, npcName) {
    const amount = getTurnReinforcements(game, npcName);

    if (amount === 0 || game.reinforcementsReceived) {
        return {
            amount: 0,
            country: null,
            reason: `${npcName} receives no reinforcements this turn.`
        };
    }

    const strongest = game.countries
        .filter(country => country.owner === npcName)
        .sort((a, b) => b.soldiers - a.soldiers)[0];

    allocateReinforcements(game, npcName, [
        {
            country: strongest.name,
            amount
        }
    ]);

    return {
        amount,
        country: strongest.name,
        reason: `${npcName} placed ${amount} reinforcements in ${strongest.name} to strengthen its best attacking position.`
    };
}

// Transfer soldiers between two countries owned by the same player.
// Not allowed while an attack is in progress (the caller must enforce this).
function transferSoldiers(
    countries,
    owner,
    fromName,
    targetName,
    amount
) {
    const from = findCountry(countries, fromName);
    const target = findCountry(countries, targetName);

    if (!from || !target) {
        throw new Error("Country not found.");
    }

    if (from.owner !== owner || target.owner !== owner) {
        throw new Error("You can only transfer between your own countries.");
    }

    if (from.name === target.name) {
        throw new Error("Source and destination must be different.");
    }

    const soldiers = Number(amount);

    if (!Number.isInteger(soldiers) || soldiers < 1) {
        throw new Error("Enter a valid number of soldiers.");
    }

    if (from.soldiers - soldiers < 1) {
        throw new Error("At least one soldier must remain in the source country.");
    }

    from.soldiers -= soldiers;
    target.soldiers += soldiers;

    return {
        from: from.name,
        target: target.name,
        amount: soldiers
    };
}

// Select an NPC action based on the available forces.
function npcDecision(countries, npcName) {
    const owned = countries
        .filter(country => country.owner === npcName)
        .sort((a, b) => b.soldiers - a.soldiers);

    const enemies = countries
        .filter(country => country.owner !== npcName);

    if (owned.length === 0) {
        return {
            action: "eliminated",
            reason: `${npcName} has no territories remaining and has been eliminated.`
        };
    }

    const attackers = owned.filter(
        country => country.soldiers >= 2
    );

    if (attackers.length === 0) {
        return {
            action: "skip",
            reason: `${npcName} has insufficient troops to launch an attack.`
        };
    }

    let bestAttack = null;

    for (const attacker of attackers) {
        for (const enemy of enemies) {
            const advantage = attacker.soldiers - enemy.soldiers;

            // Ties kill nobody and each pair is an even fight, so only
            // attack when the numbers are clearly in our favour.
            if (advantage < ATTACK_MARGIN) {
                continue;
            }

            const reward = Math.max(
                2,
                Math.floor(enemy.soldierValue / 2)
            );

            // Finishing off a player removes a rival from the game.
            const eliminatesRival = countries.filter(
                country => country.owner === enemy.owner
            ).length === 1;

            // Prefer the strongest enemy we can still beat: it removes the biggest
            // threat, whereas small countries only get captured back and forth.
            const score =
                enemy.soldiers +
                reward +
                (eliminatesRival ? 10 : 0);

            if (!bestAttack || score > bestAttack.score) {
                bestAttack = {
                    attacker,
                    enemy,
                    advantage,
                    score
                };
            }
        }
    }

    if (!bestAttack) {
        return {
            action: "skip",
            reason: `${npcName} is preserving its forces because no favourable attack is available.`
        };
    }

    return {
        action: "attack",
        from: bestAttack.attacker.name,
        target: bestAttack.enemy.name,
        reason: `${npcName} identified ${bestAttack.enemy.name} (${bestAttack.enemy.soldiers} soldiers) as a vulnerable target and is attacking from ${bestAttack.attacker.name} (${bestAttack.attacker.soldiers} soldiers).`
    };
}

// Decide whether an NPC should keep rolling after a round of dice.
function npcShouldContinueAttack(attacker, defender) {
    if (attacker.soldiers < 2) {
        return {
            continue: false,
            reason: `${attacker.owner} has only one soldier left in ${attacker.name} and must stop.`
        };
    }

    if (attacker.soldiers <= defender.soldiers) {
        return {
            continue: false,
            reason: `${attacker.owner} is calling off the attack on ${defender.name} because the advantage has been lost (${attacker.soldiers} vs ${defender.soldiers}).`
        };
    }

    return {
        continue: true,
        reason: `${attacker.owner} presses on against ${defender.name} (${attacker.soldiers} vs ${defender.soldiers}).`
    };
}

// Decide whether an NPC should move soldiers to build a stronger attacking force.
// Returns the move; the caller applies it with transferSoldiers.
function npcTransferDecision(countries, npcName) {
    const owned = countries
        .filter(country => country.owner === npcName)
        .sort((a, b) => b.soldiers - a.soldiers);

    const enemies = countries
        .filter(country => country.owner !== npcName);

    if (owned.length < 2 || enemies.length === 0) {
        return {
            action: "none",
            reason: `${npcName} has no soldiers to transfer.`
        };
    }

    const strongest = owned[0];
    const donors = owned.slice(1).filter(country => country.soldiers > 1);

    const totalSpare = donors.reduce(
        (sum, country) => sum + country.soldiers - 1,
        0
    );

    if (totalSpare < 1) {
        return {
            action: "none",
            reason: `${npcName} has no spare soldiers to transfer.`
        };
    }

    // The biggest enemy we could beat right now vs after consolidating.
    const biggestBeatable = limit => enemies
        .filter(country => limit - country.soldiers >= ATTACK_MARGIN)
        .sort((a, b) => b.soldiers - a.soldiers)[0];

    const current = biggestBeatable(strongest.soldiers);
    const boosted = biggestBeatable(strongest.soldiers + totalSpare);

    if (!boosted || (current && boosted.soldiers <= current.soldiers)) {
        return {
            action: "none",
            reason: `${npcName} gains nothing by moving soldiers this turn.`
        };
    }

    const needed =
        boosted.soldiers + ATTACK_MARGIN - strongest.soldiers;

    const donor = donors.sort((a, b) => b.soldiers - a.soldiers)[0];
    const amount = Math.min(needed, donor.soldiers - 1);

    return {
        action: "transfer",
        from: donor.name,
        target: strongest.name,
        amount,
        reason: `${npcName} is moving ${amount} soldiers from ${donor.name} to ${strongest.name} to prepare an attack on ${boosted.name}.`
    };
}

// Identify factions that still own territories.
function getAlivePlayers(countries) {
    return PLAYERS.filter(player =>
        countries.some(country => country.owner === player)
    );
}

// Whoever owns all ten countries wins.
function getWinner(countries) {
    if (countries.length === 0) {
        return null;
    }

    const firstOwner = countries[0].owner;

    return countries.every(country => country.owner === firstOwner)
        ? firstOwner
        : null;
}

function getNextPlayer(countries, currentPlayer) {
    const alive = getAlivePlayers(countries);

    if (alive.length === 0) {
        return null;
    }

    const currentIndex = PLAYERS.indexOf(currentPlayer);

    for (let i = 1; i <= PLAYERS.length; i++) {
        const nextIndex = (currentIndex + i) % PLAYERS.length;
        const candidate = PLAYERS[nextIndex];

        if (alive.includes(candidate)) {
            return candidate;
        }
    }

    return null;
}

// A round runs from the randomly chosen first player all the way around the table.
// Positions are measured from that first player, so a new round starts as soon
// as the turn order wraps back to (or past) the starting position.
function isNewRound(firstPlayer, previousPlayer, nextPlayer) {
    const start = Math.max(0, PLAYERS.indexOf(firstPlayer));

    const position = player =>
        (PLAYERS.indexOf(player) - start + PLAYERS.length) % PLAYERS.length;

    return position(nextPlayer) <= position(previousPlayer);
}

module.exports = {
    PLAYERS,
    soldierValue,
    getAvailableCountries,
    createInitialCountries,
    startGame,
    startAttack,
    battle,
    calculateReinforcements,
    getTurnReinforcements,
    allocateReinforcements,
    npcAllocateReinforcements,
    transferSoldiers,
    npcDecision,
    npcShouldContinueAttack,
    npcTransferDecision,
    getAlivePlayers,
    getWinner,
    getNextPlayer,
    isNewRound
};
