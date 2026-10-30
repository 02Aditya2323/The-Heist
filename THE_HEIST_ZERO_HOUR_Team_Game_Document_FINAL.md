# THE HEIST: ZERO HOUR. Team Game Document

Prepared for the build team. Version 1. Written in ASD-STE100 Simplified Technical English.

## 1. What this game is

THE HEIST is a live event for about 85 players. Each player starts with ₹0. Players use a web client. The server runs a city map. Players walk on the map. They solve technical challenges to earn money.

The money is real prize money. The final balance of a player is the score and the prize.

The world holds exactly ₹4,000. The server cannot create money. Money only moves from one account to another.

Story (for context only): The year is 2046. Veyra City runs on one financial system. At 14:00, a Great Reset sets all accounts to ₹0. NEXUS, the city intelligence, announces a lockdown. Each player is an Operator with temporary access to city systems. Operators try to rebuild wealth. NEXUS sends announcements during the event.

## 2. Quick facts

| Item | Value |
| --- | --- |
| Players | About 85. The Starter pool supports 90 |
| Event length | 180 minutes. The length can change (see section 14) |
| Total money in the world | ₹4,000.00 (400,000 paise- in game currency) |
| Start balance of a player | ₹0 |
| Wealth cap for one player | ₹800 (Home plus Bank; player remains active after cap) |
| Maximum pay for one challenge | ₹160 |
| Score | Home money plus Bank money |
| Leaving | A player can leave at any time (Checkout), unless in a raid or jail |
| Bank | Only one |
| Raid crew | Exactly 10 players |

## 3. Words used in this document

| Word | Meaning |
| --- | --- |
| Player | A person who plays. In the story, an Operator |
| Server | The program that holds all money and all rules. The client never decides money |
| Challenge | Any task that a player solves |
| Job | A challenge that pays money from a pool |
| Slot | One paid place in a job. One slot pays one player one time |
| Wave | A set time when the server adds new job slots |
| Lock | The server holds a challenge for one player for a short time. No other player can attempt it |
| Queue | A line of players who wait for a locked challenge |
| Variant | A copy of a challenge with different hidden data |
| Pool | A system account that holds money for one purpose |
| Home | The place where earned money goes first. Other players can steal from it |
| Bank | The one building where players keep money safe from burglary |
| Burglary | A player steals money from the Home of another player |
| Raid | A crew of 10 players attacks the Bank |
| Crew | The 10 players in one raid |
| Bank seed | Money that the system puts in the Bank to pay raid prizes |
| Treasury | A system account for fees and small bounties |
| Checkout | A player leaves the event and receives the balance |
| Completed challenge | A challenge that the player answered correctly. Training counts (see section 9) |
| Paise | One hundredth of a rupee. The server stores all money in paise |

## 4. What a player can do

| Action | Where | What the player does | Result |
| --- | --- | --- | --- |
| Solve a Starter job | Job Board | Solves one short challenge | ₹5 in Home. One time only |
| Solve a Standard job | Job Board | Solves a challenge of 3 to 6 minutes | ₹10 in Home |
| Solve an Expert job | Job Board | Gets a lock and solves a hard challenge | ₹80 in Home |
| Train | Job Board | Solves a job copy that pays no money | Counts toward completed challenges |
| Enter a Race | Exchange terminal | Solves the same challenge as all others, as fast as possible | Top 3 share ₹100 |
| Join a Golden Hour event | Place that NEXUS shows | Follows NEXUS clues and solves a short challenge | Money from a fixed event pool |
| Deposit or withdraw | Bank | Moves money between Home and Bank | Bank money is safe from burglary |
| Commit a burglary | Home of another player | Solves a lock-pick challenge | Takes a share of the money in that Home |
| Join a raid | Circle at the Bank | Stands in the circle for 1 minute. Then solves 5 hard questions | Share of the raid prize |
| Check out | Exchange terminal | Leaves the event | Receives Home money plus Bank money |

A player chooses what to do. No route is mandatory. One player can only do jobs. Another player can mostly steal. Another player can mostly raid.

## 5. The map

The map is a 2D city. Players walk to a terminal to use it. Walking takes time. This makes choices.

| District | What is there |
| --- | --- |
| Tech Quarter | Job Board for CP, debugging and logic jobs |
| Data Harbor | Job Board for SQL, network and OSINT jobs |
| Central Exchange | Bank, raid circle, Race terminal, Checkout, leaderboard |
| Black Grid | Job Board for CTF and cybersecurity jobs |
| Undercity | The Homes of all players |
| NEXUS | Announcement board. Golden Hour start points |

Each player owns one Home. All Homes show on the map.

## 6. Home and burglary

### 6.1 Home

When a player earns money, the server puts it in the Home of the player.

A player can spend Home money.

Other players can steal Home money. This is a burglary.

The server shows no warning before a burglary.

After a burglary, the server sends a message to the owner. The message shows the amount, the time and the name of the thief.

### 6.2 How a burglary works

The thief walks to the Home of a target.

The thief chooses a level.

The server locks the Home. Only one thief at a time can attempt it.

The thief solves a lock-pick challenge.

If the answer is correct, the server moves money from the target to the thief. If the thief is CAPPED, no money is transferred and the target keeps the money.

| Level | Share | Maximum | Challenge time | The thief needs |
| --- | --- | --- | --- | --- |
| 1 | 5% | ₹10 | 2 to 3 minutes | Nothing |
| 2 | 10% | ₹25 | 4 to 5 minutes | 5 completed challenges |
| 3 | 20% | ₹50 | 6 to 8 minutes | 12 completed challenges |

Formula for a non-capped target: Amount stolen = the smallest of (share × Home money), (maximum for the level) and (Home money − ₹5). For a capped target, ignore the ₹5 floor: Amount stolen = the smaller of (share × Home money) and (maximum for the level). The level share and maximum still apply.

### 6.3 Burglary rules

The Home must hold at least ₹20 when the lock-pick starts.

The owner must not be inside the Home.

The owner always keeps at least ₹5.

After a burglary, the Home has a 10-minute cooldown. No thief can attempt it.

The same thief cannot attempt the same Home again for 30 minutes.

If the thief fails, the thief pays ₹3 to the Treasury. The thief goes to jail for 3 minutes. In jail, a player cannot walk and cannot start a challenge.

A failed burglary costs the owner nothing.

Example: A Home holds ₹80. A thief does a level 2 burglary. Share = 10% × ₹80 = ₹8. Maximum = ₹25. Home − ₹5 = ₹75. The smallest value is ₹8. The thief gets ₹8. The Home now holds ₹72.

World bounty: When a player's combined Home and Bank balance first reaches ₹800, NEXUS immediately announces the player to all players. If the Treasury holds at least ₹20, the server posts one ₹20 world bounty on that player. The first eligible, uncapped thief who successfully burgles that player's Home receives the bounty. The Treasury cannot pay the bounty if it does not hold at least ₹20. CAPPED status ends only when the player's combined Home and Bank balance falls below ₹600 (see section 14.3). The cap bounty is posted only once for each player, even if the player later reaches ₹800 again.

## 7. The Bank

### 7.1 Rules

The Bank opens for deposits at minute 10.

A player moves money from Home to Bank at the Bank. The deposit is instant.

The maximum Bank balance for one player is ₹200.

Burglars cannot take Bank money.

A withdrawal takes 5 minutes. During these 5 minutes, the money is in transit. In-transit money counts as Bank money for a raid.

From the moment a raid crew is full until the raid ends, the Bank accepts no deposits and no withdrawal requests.

Bank money is in danger only from a raid. A raid takes at most 10% of the Bank money (see section 8).

## 8. The bank raid

### 8.1 Summary

A raid is the main group event. Exactly 10 players form a crew. Each player solves 5 hard questions alone. The money is shared by the number of questions that each player solves.

### 8.2 Raid windows

Only one raid can run at a time. There are 3 windows.

| Window | Time (minutes) | Bank seed |
| --- | --- | --- |
| 1 | 45 to 90 | ₹400 |
| 2 | 90 to 135 | ₹400 |
| 3 (the Black Ledger raid) | 150 to 175. The crew must be full by minute 160 | ₹700 |

A window can hold one raid.

If a window has no successful raid, its seed moves to the next window.

The Black Ledger raid is the final raid. It uses the same rules. Its questions are harder.

### 8.3 Who can join

A player can join the circle if all of these are true:

The player has 5 completed challenges.

The player did not join the previous raid.

The player did not fail the gate in the previous raid.

The player is not in jail.

### 8.4 Steps of a raid

Join. The player walks to the circle in front of the Bank. The player stands in the circle for 1 minute. Then the player joins the crew. If the player leaves the circle before 1 minute, the server removes the player.

Crew full. The raid starts when 10 players have joined. If the crew is not full when the window ends, no raid happens. The players leave the circle.

Bank lock. The Bank stops deposits and withdrawal requests (see section 7).

Questions. Each player gets 5 hard questions. The server makes a different variant for each player. The time limit is 15 minutes.

Gate. A player must solve at least 2 of the 5 questions. A player who solves fewer than 2 gets nothing.

Raid result. The raid succeeds if at least 5 players pass the gate. If fewer than 5 players pass, the raid fails. The Bank keeps all money. No player loses money. The seed moves to the next window.

Payout. The server pays the players who passed the gate (see 8.5). The money goes to the Home of each player.

### 8.5 Prize and payout

Prize (P) = the Bank seed of the window + 10% of all Bank money. The server counts Bank money and in-transit money when the crew becomes full.

Solved total (N) = the total number of questions that the players who passed the gate solved.

Value of one question (V) = P ÷ N, rounded down to paise. The server limits V to ₹160.

Payment to each player = V × the number of questions that the player solved.

Payment total = V × N. The remainder in paise goes to the player with the most solved questions. If two players tie, the player who finished first gets it.

Wealth-cap rule: The raid formula above does not change. A CAPPED player's answers still count toward the raid gate and the solved total N, but the server does not transfer that player's calculated payout. The unpaid share stays in its source account. If a payout takes an uncapped player to ₹800, the server pays only the amount needed to reach ₹800; the remainder stays in its source account.

Source of the money: The deposit share (10% of Bank money) pays first. The Bank seed pays the rest. The server takes the money only when the raid succeeds. If V is limited to ₹160, the unused money stays in the Bank. Unused seed money moves to the next window.

Example: The seed is ₹400. Bank money is ₹150. P = ₹400 + 10% × ₹150 = ₹415. 8 players pass the gate. They solve 5, 4, 3, 3, 2, 2, 2 and 2 questions. N = 23. V = ₹415 ÷ 23 = ₹18.04 (rounded down). The payment total is 23 × ₹18.04 = ₹414.92. The remainder is ₹0.08. The player with 5 questions gets 5 × ₹18.04 + ₹0.08 = ₹90.28. A player with 2 questions gets ₹36.08. A player who solved 1 question gets ₹0. The depositors lose ₹15 in total (10% each). The seed pays ₹400.

### 8.6 Raid questions

A raid has a pool of 10 hard question templates (BR-01 to BR-10). The server gives each player 5 different templates at random. The Black Ledger raid uses 5 harder templates (BL-01 to BL-05). Each player gets all 5.

If a player disconnects, the solved questions still count. The player can come back before the time ends.

A raid question can take 5 to 10 minutes for a strong player. The authors can make the questions stricter. The raid time limit is a setting. Change it after the tests (see section 17).

## 9. Jobs

### 9.1 Job types

| Type | Templates | Slots | Pay for each slot | Typical time | Lock |
| --- | --- | --- | --- | --- | --- |
| Starter | 3 | 90 claims in total. One claim for each player | ₹5 | 1 to 3 minutes | None |
| Standard | 10 | 45 in total. 9 in each wave | ₹10 | 3 to 6 minutes | 6 minutes |
| Expert | 5 | 1 for each template | ₹80 | 6 to 10 minutes | 10 minutes |
| Training | The same as all job templates | No limit | ₹0 | The same | None |

### 9.2 Rules

Starter. The player chooses one of 3 templates. Each player can claim one Starter job in the whole event. It stays open for the whole event.

Standard. The server adds 9 new slots at each wave. Each player can claim at most 1 Standard slot in each wave.

Expert. A player requests the job. The server locks it for that player. If the player fails, or the lock time ends, the server gives the lock to the next player in the queue. The head of the queue has 30 seconds to accept. A player can be in at most 2 queues.

Training. A training challenge pays no money. It counts toward the number of completed challenges. A player gets credit for at most 6 training challenges.

Variants. The server gives each player a different variant of a job. The hidden data and the flags are different. Players cannot share answers.

A wrong answer costs no money. A player can try again while the lock or slot is open. The server limits the answer rate (see section 16).

A player can start a new job at any time. A player can hold only one lock at a time.

### 9.3 Waves

A wave is a set time when the server adds new Standard slots. Waves keep jobs available for the whole event. Without waves, fast players take all slots in 30 minutes. Then other players have nothing to do.

### 9.4 How the server checks an answer

The first version does not run player code. The player solves the challenge on his or her own computer. The player submits an answer. The server checks the answer in one of these ways:

| Answer type | Example |
| --- | --- |
| Output match | The player submits the output of a program for the variant input |
| Flag match | The player submits a flag that the sandbox shows after a correct solution |
| Short text | The player submits a value, name or number from the data |

### 9.5 Server steps for a paid claim

The player sends the challenge ID and the answer.

The server finds the variant of that player.

The server checks the answer.

The server checks the slot, the lock and the player limits.

In one database transaction, the server moves the money from the pool to the Home of the player and writes the ledger row.

The server closes the slot.

The server sends the new balance to the player.

If two players send a correct answer for the same locked slot at the same time, only one transaction can succeed. The other player gets the message "Already resolved".

## 10. Races

A race is a timed contest. All players who enter get the same challenge at the same moment.

There are 3 races (RC-01 to RC-03). They run at minutes 30, 90 and 135.

Each race has a pool of ₹100.

A player goes to the Race terminal at the Central Exchange. NEXUS announces the race 5 minutes before it starts.

When the race opens, all entered players see the same challenge. The window is 10 minutes.

The server ranks the first correct answers by the time since the race start.

The top 3 players split the pool: ₹50, ₹30 and ₹20.

If fewer than 3 players answer correctly, the unpaid places stay in the pool. They stay unclaimed.

A player can try again. Only the first correct answer counts.

## 11. Golden Hour events

A Golden Hour event is a surprise event. NEXUS announces it to all players. Each event has a fixed pool of ₹100. The events make players leave their plan and move.

| Event | Minute | What the players do | Pay |
| --- | --- | --- | --- |
| GH-01 Card hunt | 70 | NEXUS says that 5 key cards are hidden on 5 map tiles. The server picks the tiles at the start. NEXUS sends one clue each minute. A player walks to a card tile and solves a 1-minute challenge. The event lasts 8 minutes | The first 5 correct players get ₹20 each. One card for each player |
| GH-02 Courier chase | 115 | A courier character moves on the map for 10 minutes. NEXUS sends a location clue each minute. A player who stands next to the courier asks for the lock. The player solves a 3-minute challenge. If the player fails, the next player next to the courier gets the lock | The first correct player gets ₹100 |
| GH-03 Server sprint | 165 | All players get the same challenge of 2 to 3 minutes. The window is 5 minutes. The server ranks the first correct answers by time | Top 5 get ₹40, ₹25, ₹15, ₹10 and ₹10 |

Unclaimed money in an event stays in the event pool. It stays unclaimed.

## 12. Challenge list

The authors write about 42 challenge templates. Each template makes many variants with a seed.

| ID | Group | Topic idea | Answer type | Time |
| --- | --- | --- | --- | --- |
| ST-01 | Starter | CP: sum or count on a seeded list | Output match | 1 to 3 min |
| ST-02 | Starter | SQL: one simple query on a seeded table | Output match | 1 to 3 min |
| ST-03 | Starter | Logic: a short pattern or sequence | Short text | 1 to 3 min |
| SD-01 | Standard | CP: algorithm on a seeded array (for example, sliding window) | Output match | 3 to 6 min |
| SD-02 | Standard | CP: decode a cipher on seeded text | Output match | 3 to 6 min |
| SD-03 | Standard | Debugging: fix a broken function and give the output | Output match | 3 to 6 min |
| SD-04 | Standard | Debugging: find the input that breaks the code | Short text | 3 to 6 min |
| SD-05 | Standard | SQL: join and aggregate on seeded data | Output match | 3 to 6 min |
| SD-06 | Standard | SQL: find bad rows in seeded data and count them | Short text | 3 to 6 min |
| SD-07 | Standard | Network: read a packet log and find a value (port, protocol, hop) | Short text | 3 to 6 min |
| SD-08 | Standard | CTF: crack a weak hash in a sandbox | Flag match | 3 to 6 min |
| SD-09 | Standard | OSINT: find one fact in a set of city documents | Short text | 3 to 6 min |
| SD-10 | Standard | Logic: a logic grid or deduction puzzle | Short text | 3 to 6 min |
| EX-01 | Expert | DSA: hard graph or DP problem with a large seeded input | Output match | 6 to 10 min |
| EX-02 | Expert | Debugging: several bugs in one small service | Output match | 6 to 10 min |
| EX-03 | Expert | SQL: hard query (window functions or recursion) | Output match | 6 to 10 min |
| EX-04 | Expert | CTF: sandbox web app with a weak login | Flag match | 6 to 10 min |
| EX-05 | Expert | Forensics: read system logs and find the account and the time | Short text | 6 to 10 min |
| BG-01 | Burglary level 1 | Lock-pick: a keypad cipher | Short text | 2 to 3 min |
| BG-02 | Burglary level 2 | Lock-pick: a logic lock | Short text | 4 to 5 min |
| BG-03 | Burglary level 3 | Lock-pick: a multi-step pattern lock | Short text | 6 to 8 min |
| RC-01 to RC-03 | Race | Speed rounds: CP, SQL and debugging | Output match | 3 to 5 min |
| GH-01 to GH-03 | Golden Hour | One challenge for each event (see section 11) | Short text | 1 to 3 min |
| BR-01 to BR-10 | Raid question | Hard: DSA ×2, debugging ×2, SQL ×2, CTF or crypto ×2, forensics ×1, network ×1 | Mixed | 5 to 10 min |
| BL-01 to BL-05 | Black Ledger raid question | Harder: DSA, debugging, SQL, CTF, forensics | Mixed | 8 to 12 min |

Rules for the authors

Each template has an ID, a topic, a difficulty, a typical time, a variant generator, an answer type and a validator.

The variant generator takes a seed and makes the input and the correct answer. The seed comes from the player ID and the challenge ID.

Each template has a test with a known seed and a known answer.

All cybersecurity challenges use simulated targets that you build. No challenge touches a real system.

No challenge needs the internet.

The pay for a challenge is fixed in section 13. A harder challenge does not change the pay. If you want to change the pay, change the plan in section 13 and check the total again.

Challenges can be strict. The time limits are not strict. A strict challenge means fewer players finish. Unclaimed money stays with the organizers (see section 14).

## 13. Money: the ₹4,000 plan and the calculations

### 13.1 The money rule

The world holds exactly ₹4,000.00. This is 400,000 paise. The server stores money as whole numbers of paise. The server never uses decimals.

Invariant: Home + Bank + In transit + Pools + Bank seeds + Treasury + Payout = 400,000 paise.

This must be true at all times. No feature can create money.

### 13.2 Accounts

| Account | How many | Start balance |
| --- | --- | --- |
| HOME | One for each player | ₹0 |
| BANK | One for each player | ₹0 |
| TRANSIT | One for each player (withdrawals) | ₹0 |
| POOL_STARTER | 1 | ₹450 |
| POOL_STANDARD | 1 | ₹450 |
| POOL_EXPERT | 1 | ₹400 |
| POOL_RACE | 1 | ₹300 |
| POOL_EVENT (Golden Hour) | 1 | ₹300 |
| BANK_SEED_1 | 1 | ₹400 |
| BANK_SEED_2 | 1 | ₹400 |
| BANK_SEED_FINAL | 1 | ₹700 |
| TREASURY | 1 | ₹600 |
| PAYOUT | 1 | ₹0 |
| System total at start |  | ₹4,000 |

Check: 450 + 450 + 400 + 300 + 300 + 400 + 400 + 700 + 600 = 4,000.

### 13.3 The pool plan

| Pool | Calculation | ₹ |
| --- | --- | --- |
| Starter jobs | 90 claims × ₹5 | 450 |
| Standard jobs | 5 waves × 9 slots × ₹10 | 450 |
| Expert jobs | 5 jobs × ₹80 | 400 |
| Races | 3 races × ₹100 (₹50 + ₹30 + ₹20) | 300 |
| Golden Hour | GH-01 5 × ₹20 = 100. GH-02 = 100. GH-03 40 + 25 + 15 + 10 + 10 = 100 | 300 |
| Bank seed | Window 1 ₹400 + window 2 ₹400 | 800 |
| Black Ledger seed | Final raid | 700 |
| Treasury | Fees and bounties | 600 |
| Total |  | 4,000 |

| Group | ₹ | Share |
| --- | --- | --- |
| Challenges (jobs, races, events) | 1,900 | 47.5% |
| Bank raids (seeds) | 1,500 | 37.5% |
| Treasury | 600 | 15% |

### 13.4 Check against the ₹160 limit

| Source | Largest single payment | Within ₹160? |
| --- | --- | --- |
| Starter job | ₹5 | Yes |
| Standard job | ₹10 | Yes |
| Expert job | ₹80 | Yes |
| Race (first place) | ₹50 | Yes |
| GH-01 | ₹20 | Yes |
| GH-02 | ₹100 | Yes |
| GH-03 | ₹40 | Yes |
| Burglary (level 3) | ₹50 | Yes |
| World bounty at cap | ₹20 | Yes |
| Raid question | V is limited to ₹160 by rule | Yes |

Raid check: The largest prize is in window 3. P = ₹700 + ₹800 (two seeds that moved forward) + 10% of Bank money. If Bank money is ₹1,500, P = ₹1,650. The smallest N is 10 (5 players × 2 questions). V = ₹165. This is more than ₹160. The rule limits V to ₹160. In this example, the unused ₹50 remains in the final raid seed account because the Bank deposit share pays first.

### 13.5 The most that one player can earn from each source

| Source | Highest income for one player |
| --- | --- |
| Starter job | ₹5 (one claim) |
| Standard jobs | ₹50 (1 slot in each of 5 waves) |
| Expert jobs | ₹400 (all 5 jobs, not likely) |
| Races | ₹150 (first place in all 3 races) |
| Golden Hour | ₹160 (₹20 + ₹100 + ₹40) |
| Total from challenge pools | ₹765 |
| Raids and burglary | Not in this total. They move money from the Bank seeds and from other players |

The wealth cap is ₹800. A player who reaches ₹800 does not retire. The player remains active but cannot receive any further money while CAPPED. The server immediately places a ₹20 world bounty on the player if the Treasury has at least ₹20. The player becomes fully vulnerable to burglary while CAPPED. If one or more burglaries reduce the player's combined Home and Bank balance below ₹600, the player can earn money again (see section 14.3).

### 13.6 All money movements

| # | Movement | From | To | Creates money? |
| --- | --- | --- | --- | --- |
| 1 | Job pay | POOL_STARTER, POOL_STANDARD or POOL_EXPERT | HOME | No |
| 2 | Race or Golden Hour pay | POOL_RACE or POOL_EVENT | HOME | No |
| 3 | Deposit | HOME | BANK | No |
| 4 | Withdrawal | BANK, then TRANSIT after 5 minutes | HOME | No |
| 5 | Burglary | HOME of the target | HOME of the thief | No |
| 6 | Failed burglary fee | HOME of the thief (the smaller of ₹3 and the Home money) | TREASURY | No |
| 7 | World bounty payout at ₹800 cap | TREASURY | HOME of the first successful uncapped thief | No |
| 8 | Raid | BANK and TRANSIT (deposit share) and the BANK_SEED account | HOME of each winner | No |
| 9 | Checkout / freeze | HOME and BANK | PAYOUT | No |

### 13.7 Ledger rows

Each movement is one transaction. It writes one ledger row for each account that changes. Total debits must equal total credits.

| TX | From | To | Paise | Reason | Status |
| --- | --- | --- | --- | --- | --- |
| TX-000481 | POOL_STANDARD | HOME_P028 | 1000 | Job SD-05 slot 3 | Settled |
| TX-000502 | HOME_P041 | HOME_P072 | 800 | Burglary level 2 | Settled |
| TX-000731 | BANK_SEED_1 | HOME_P012 | 9028 | Raid window 1, 5 questions | Settled |

Each row also holds the event ID, the actor, the time and a verification hash. The server never changes a row. A correction is a new row.

### 13.8 Audit check

The server runs the audit check every 5 seconds. It must show 400,000 paise. Example at minute 100:

| Account group | ₹ |
| --- | --- |
| Homes | 1,000.50 |
| Banks | 245.50 |
| In transit | 25.00 |
| Challenge pools (Starter 150, Standard 250, Expert 240, Race 200, Event 200) | 1,040.00 |
| Bank seeds (window 1 spent. Window 2 400. Final 700) | 1,100.00 |
| Treasury | 589.00 |
| Payout | 0.00 |
| Total | 4,000.00 |

If the total is not 400,000 paise, the server freezes the economy. The team then finds the error.

### 13.9 What the organizers pay

The maximum prize cost is ₹4,000.

If every pool pays in full, the average balance is ₹4,000 ÷ 85 = ₹47.06. The balances are not equal.

The real cost is the PAYOUT total at the freeze.

Unclaimed money stays with the organizers. Some pools may not pay in full. Examples include unused Starter claims, unclaimed Expert jobs and unused raid seeds.

### 13.10 Rounding

The server uses whole paise.

Percentages round down.

The remainder in a raid goes to the top solver (see section 8.5).

The server never makes a fraction of a paisa.

### 13.11 Money rules for the team

The world holds exactly ₹4,000.00.

No feature creates money.

Each payment has a source account.

Each payment has a destination account.

Each movement writes ledger rows in one transaction. The whole transaction succeeds or it does not happen.

The server decides all money. The client only sends requests.

A slot pays one time.

Players cannot send money to each other. There is no transfer action.

Reputation, completed challenges and training never become money.

An administrator uses the same transfer function. Each change needs a reason and a second administrator to approve it. The server logs it.

## 14. Leaving, the wealth cap and the event length

### 14.1 Checkout

A player can leave at any time.

The player goes to the Checkout terminal at the Central Exchange.

The server stops any lock or queue place of the player.

The server waits for money in transit to arrive.

The server moves Home money and Bank money to PAYOUT.

The Home of the player leaves the map.

The player cannot come back to play. The player can watch the leaderboard.

A player cannot check out during a raid or in jail.

### 14.2 Disconnect

If a player loses the connection, the server waits 10 minutes.

In these 10 minutes, the Home is protected. No thief can attempt it. The Bank money stays in the Bank.

If the player comes back, the game continues.

After 10 minutes, the server does an automatic Checkout.

In a raid, the solved questions still count. The player can come back before the raid ends.

### 14.3 The wealth cap

When the player's combined Home and Bank balance reaches ₹800, the player enters CAPPED status. The player does not retire and may continue moving around the map, solving non-paying challenges, joining activities and interacting with the world. While CAPPED, the player cannot receive money from jobs, races, Golden Hour, raids, bounties, burglary or any other source. If a payment would take an uncapped player above ₹800, the server pays only the amount needed to reach ₹800; the remainder stays in its source account. The server immediately posts one world bounty of ₹20 on the capped player if the Treasury holds at least ₹20. The capped player's Home is fully vulnerable to burglary while the player is CAPPED: a thief may attempt it even if the owner is inside, the Home holds less than ₹20, or the normal 10-minute Home cooldown is active. The ₹5 floor does not apply to a capped target. The level-specific share and maximum stolen still apply. The same thief's 30-minute cooldown remains in force. Failed-burglary fees and jail still apply to the thief. If one or more successful burglaries reduce the player's combined Home and Bank balance below ₹600, CAPPED status ends and the player can earn money again. A combined balance of exactly ₹600 or more does not end CAPPED status. Once CAPPED status ends, normal Home burglary protections resume. The ₹20 cap bounty is posted at most once for each player, even if the player later reaches ₹800 again.

### 14.4 Late players

A player can start at any time before minute 120. The Starter job stays open for the whole event. Standard slots stay open until they are claimed.

### 14.5 The event length can change

The plan uses 180 minutes. The event can be shorter or longer.

Scale factor F = the real length ÷ 180. Example: for 120 minutes, F = 0.67.

Multiply all times in section 15 by F.

Do not change the money, the slot counts or the pool sizes.

Do not scale the lock time, the raid time limit or the challenge time. These are separate settings (see section 17).

### 14.6 Strict challenges and unclaimed money

You can make the challenges strict. Fewer players will earn the pay. The unclaimed money stays with the organizers. This does not break the economy. The total is still ₹4,000 or less.

## 15. Timeline (180 minutes)

| Minute | Event |
| --- | --- |
| 0 | Start. Starter jobs and Training open. Wave 1 |
| 10 | The Bank opens for deposits |
| 20 | Wave 2 |
| 30 | Race 1. Expert job 1 |
| 40 | Burglary opens |
| 45 | Raid window 1 opens |
| 50 | Wave 3 |
| 60 | Expert job 2 |
| 70 | Golden Hour GH-01 (card hunt) |
| 80 | Wave 4 |
| 90 | Race 2. Expert job 3. Raid window 2 opens |
| 115 | Golden Hour GH-02 (courier chase) |
| 120 | Wave 5. Expert job 4 |
| 135 | Race 3. Raid window 2 closes |
| 140 | Expert job 5 |
| 150 | Raid window 3 (Black Ledger raid) opens |
| 160 | Last time for a full crew in window 3 |
| 165 | Golden Hour GH-03 (server sprint) |
| 175 | No new burglary or raid |
| 180 | Freeze. The server stops all money movement |

At the freeze, the server voids pending items. The money stays with its owner. The balances become the final ranking. If two players have the same balance, the player with more completed challenges wins. If this is also equal, the player who reached the balance first wins.

## 16. Server rules and protection

Server authority. The server decides balances, rewards, answers, burglary, raids and rankings.

Variants. Each player gets a different variant. Flags use a hash of the player ID and the challenge ID.

Answer rate. One answer for each challenge every 5 seconds. After 20 wrong answers, the player waits 2 minutes for that challenge.

One session. One player has one session. A second login closes the first.

Locks. A lock ends at its time limit. The server then gives the challenge to the next player in the queue.

Race conditions. Two players who claim the same slot at the same time get one winner. The server uses one atomic transaction.

Duplicate requests. The same answer sent 10 times pays one time.

Collusion. Players cannot send money. Burglary has cooldowns. The same thief cannot attempt the same Home within 30 minutes.

Logs. The server logs all answers, locks, claims and transactions.

Administrator console shows:

the audit check and all pool balances;

the ledger and the history of each player;

active locks, queues and raids;

buttons to freeze the economy, release a stuck lock, start an event and send an announcement.

An administrator cannot type "give a player ₹50". Section 13.11, rule 10, applies.

## 17. Settings (all numbers in one place)

Change a money setting only with a new check of the totals in section 13.

| Setting | Default |
| --- | --- |
| Event length | 180 minutes |
| Total money | 400,000 paise |
| Wealth cap | 80,000 paise |
| Capped-player reactivation threshold | Combined Home + Bank balance below 60,000 paise |
| Maximum for one challenge | 16,000 paise |
| Starter pay and claims | 500 paise and 90 |
| Standard pay, slots in a wave, waves | 1,000 paise, 9 and 5 |
| Standard claims for each player in a wave | 1 |
| Expert pay and count | 8,000 paise and 5 |
| Lock time: Standard, Expert | 6 minutes, 10 minutes |
| Queue accept time | 30 seconds |
| Training credit limit | 6 |
| Burglary: minimum Home money, floor | 2,000 paise, 500 paise |
| Burglary: Home cooldown, same-thief cooldown | 10 minutes, 30 minutes |
| Burglary: failure fee, jail time | 300 paise, 3 minutes |
| Burglary levels | 5% / ₹10, 10% / ₹25, 20% / ₹50 |
| World bounty: wealth cap trigger, bounty | 80,000 paise, 2,000 paise |
| Bank: maximum balance, withdrawal delay | 20,000 paise, 5 minutes |
| Raid: crew size | 10 |
| Raid: questions for each player, gate | 5, 2 |
| Raid: players who must pass the gate | 5 |
| Raid: time limit | 15 minutes |
| Raid: circle time | 60 seconds |
| Raid: completed challenges to join | 5 |
| Raid: deposit share | 10% |
| Raid: seeds | 40,000, 40,000 and 70,000 paise |
| Offline grace time | 10 minutes |
| Late join limit | Minute 120 |

## 18. Build order and tests

Build order

EconomyEngine, ledger and audit check.

Challenge service: slots, locks, queues, variants and validators.

Scheduler for the timeline.

Home, Bank, deposit, withdrawal.

Burglary and the message after a theft.

Raid: circle, crew, questions and payout.

Races and Golden Hour.

Checkout, disconnect and the freeze.

Administrator console.

Tests before the event

| Test | Expected result |
| --- | --- |
| 10,000 random transactions | The total is always 400,000 paise |
| Two players claim one slot at the same time | One payment |
| One correct answer sent 10 times | One payment |
| Two thieves attempt one Home at the same time | One success. The other player gets a message |
| A player withdraws, then a raid starts | The in-transit money counts in the raid |
| A raid with only 4 players who pass the gate | The raid fails. No money moves |
| A raid with a large prize | V is limited to ₹160. Any unpaid amount remains in its source account under the raid source-order rules. |
| Checkout, then an old request | The server rejects the request |
| Disconnect for 10 minutes | Automatic Checkout. The Home is protected before that |
| A transaction that fails in the middle | The server rolls back all changes |
| Request after the freeze | The server rejects the request |
| Player reaches ₹800 | Player remains active and cannot receive further money. If the Treasury has at least ₹20, one world bounty is posted. |
| Capped player's Home is burgled | Capped player has no protected floor or normal Home cooldown; thief still pays the failure fee and serves jail on failure |
| Capped player's combined balance falls to ₹650 | Player remains CAPPED and cannot earn money. Normal protections do not resume. |
| Player reaches ₹800 when Treasury has less than ₹20 | The player becomes CAPPED and fully vulnerable; no unfunded bounty is created. |
| Capped player's combined balance falls below ₹600 | CAPPED status ends. The player can earn money again, and normal Home protections resume. |

## 19. Decisions to confirm

| # | Decision | Default in this document |
| --- | --- | --- |
| 1 | Players who must pass the gate for a raid to succeed | 5 of 10 |
| 2 | Minimum payout, and how the organizers pay real money | Not decided. The average is about ₹47 |
| 3 | Show ₹ or a scaled "credit" value to players | ₹ |
| 4 | More than 90 players | Starter pay = ₹450 ÷ number of players |
| 5 | A second raid circle in each window, for more players | One circle only |
