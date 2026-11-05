const mongoose = require("mongoose");

const DEFAULT_PLAYERS = [
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

const countrySchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true
        },

        population: {
            type: Number,
            required: true
        },

        soldierValue: {
            type: Number,
            required: true
        },

        soldiers: {
            type: Number,
            required: true,
            min: 0
        },

        owner: {
            type: String,
            default: "Unassigned"
        }
    },
    { _id: false }
);

const allocationSchema = new mongoose.Schema(
    {
        country: String,
        amount: Number
    },
    { _id: false }
);

const historySchema = new mongoose.Schema(
    {
        type: {
            type: String,
            enum: [
                "battle",
                "attack-decision",
                "attack-result",
                "reinforce",
                "transfer",
                "skip",
                "elimination",
                "conquest",
                "win",
                "event"
            ],
            default: "event"
        },

        message: {
            type: String,
            required: true
        },

        reason: String,
        player: String,
        round: Number,

        // Battle-specific
        attacker: String,
        defender: String,
        attackerDice: [Number],
        defenderDice: [Number],
        attackerLosses: Number,
        defenderLosses: Number,
        conquered: Boolean,
        soldiersGained: Number,
        previousOwner: String,
        endReason: String,

        // Reinforce / transfer specific
        amount: Number,
        allocations: [allocationSchema],
        from: String,
        target: String,

        timestamp: {
            type: Date,
            default: Date.now
        }
    },
    { _id: false }
);

const gameSchema = new mongoose.Schema(
    {
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },

        countries: [countrySchema],

        turnOrder: {
            type: [String],
            default: DEFAULT_PLAYERS
        },

        currentPlayer: {
            type: String,
            default: "You"
        },

        // The randomly chosen player who opens round 1. Rounds are counted
        // from this player, so every player gets one turn before round 2.
        firstPlayer: {
            type: String,
            default: null
        },

        round: {
            type: Number,
            default: 1
        },

        status: {
            type: String,
            enum: ["setup", "active", "finished"],
            default: "setup"
        },

        // "transfer" = the human has conquered a country this turn and may
        // move soldiers before ending the turn (no further attacks allowed).
        phase: {
            type: String,
            enum: ["setup", "attack", "transfer", "finished"],
            default: "setup"
        },

        winner: {
            type: String,
            default: null
        },

        selectedCountry: {
            type: String,
            default: null
        },

        shareId: {
            type: String,
            default: null
        },

        // Set to true once this turn's reinforcements are placed (or auto-applied).
        // Reset to false at the start of each new turn by advanceTurn().
        reinforcementsReceived: {
            type: Boolean,
            default: false
        },

        attackInProgress: {
            type: mongoose.Schema.Types.Mixed,
            default: null
        },

        history: [historySchema]
    },
    {
        timestamps: true
    }
);

gameSchema.index({ user: 1, updatedAt: -1 });
gameSchema.index({ shareId: 1 });

module.exports = mongoose.model("Game", gameSchema);
