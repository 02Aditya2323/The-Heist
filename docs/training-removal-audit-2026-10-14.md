# Player training removed — 14 October 2026

Player job cards now expose only paid acquisition. Public training requests are rejected server-side, including direct shared-protocol WebSocket requests. Existing unfinished training copies are excluded from transmitted workbenches; their answers and simulation/probe requests are rejected. Old training cooldowns no longer mark paid stations locked. No training-acquisition path generates new player questions.

Previously earned completions, balances and compact checklist history are retained. Old training records remain marked unpaid; their prompts/workbenches are not sent. Paid contracts, reading/answer timers, locks, FIFO queues, release schedules, raid qualifications and prizes are unchanged. The role-protected admin review vault remains available to trusted staff, as requested previously. Removing training does not make previously seen questions unseen or introduce a guarantee of unique paid variants.

Validation: full build passed; 123 server tests and 71 bot tests passed. Tests cover blocked acquisition for all job templates in lobby/live phases, disabled old question copies/probes, retained historical credits, WebSocket rejection without creating a question, and normal paid solve/payment. Bot gameplay no longer requests practice copies; its deliberate negative training request verifies rejection.

Browser QA used a disposable in-memory game: Data Centre cards had no Train button/instructions, and normal paid SD-02 acquisition still opened its real workbench. Screenshot: `screenshots/training-disabled-2026-10-14/paid-only-contracts.jpg`.

Production port 8080 was restarted without Reset/Start. A private pre-update checkpoint is retained in `bot-runs/before-disable-training-P1CMeQ/`. Post-restart checks verified the same event generation/start time, all previous completion credits, live phase and conserved ₹4,000 pool. MongoDB data was not deleted or rebalanced. Production and the LAN frontend remain running.
