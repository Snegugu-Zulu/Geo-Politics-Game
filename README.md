# GEO POLITICS — INF4001 Entrance Exam Game

A professional full-stack Risk-style single-player geopolitics game built with React, Express and MongoDB.

## Features
- Login and registration
- 10 randomly selected countries
- Starting armies based on population brackets
- Player vs NPC turns
- Dice-based battles
- Country conquest
- Transfer and skip actions
- Round-based reinforcements
- NPC strategic reasoning shown to the player
- Fast-forward NPC turns
- Battle history
- Game state stored on the server
- Responsive dark premium UI

## Requirements
- Node.js 18+
- MongoDB Atlas or local MongoDB

## Setup

### Backend
```bash
cd backend
npm install
cp .env.example .env
# Add your MongoDB connection string to MONGO_URL
npm run dev
```

### Frontend
```bash
cd frontend
npm install
npm run dev
```

Frontend: http://localhost:5173
Backend: http://localhost:5001

## Environment
Backend `.env`:
```env
MONGO_URL=mongodb+srv://USERNAME:PASSWORD@CLUSTER.mongodb.net/geopolitics
JWT_SECRET=change_this_secret
PORT=5001
```

## Game rules
- Ten countries are selected randomly.
- Soldiers are calculated from population.
- A country must keep at least one soldier when attacking.
- Up to three attacker dice and two defender dice are rolled.
- Dice are sorted and matched from highest to lowest.
- A higher attacker die removes one defending soldier.
- A higher defender die removes one attacking soldier.
- A tie favours the defender.
- Conquering a country awards a reinforcement bonus.
- From round two, surviving countries receive reinforcements.
- The player wins by controlling all territories.
