# Functional scope and contribution map

| Requirement | Implementation |
| --- | --- |
| Login and registration | Session-backed auth, password hashing, confirmation validation and user-owned accounts. |
| Savings account management | Open, rename and close an empty account while retaining historical records. |
| Account dashboard and balance enquiry | Live balances, account details, incoming/outgoing summary and history. |
| Internal transfers | Atomic debit/credit to own or another registered account with authorization and risk checks. |
| Bill payments | Supported biller, customer reference, review, authorization, screening and receipt. |
| Scheduled payments | One-time, weekly and monthly instructions, run history, cancellation and idempotent execution. |
| History and search | Account, date, status and text filters; transaction details. |
| Downloadable statements | Filtered CSV and print-ready account statements from stored records. |
| Notifications | Per-customer inbox, unread/read state and durable event delivery. |
| Transaction authorization | Password reauthorization and explicit consent to scheduled instructions. |
| Fraud rules and monitoring | Admin rule configuration and independent review of held transactions. |
| AI risk score and explanations | Historical features, trained baseline model, score/reasons on each new payment attempt. |
| Microservices and API gateway | Separate banking, risk, notification, gateway and worker processes/containers. |
| Event integration | Ledger outbox, leased delivery, retry and deduplicated consumption. |
| Database services and optimisation | Separate persistent stores, ACID ledger, WAL, indexes and bounded worker batches. |
| Container delivery and CI/CD | Dockerfile, private Compose topology, automated tests and versioned image delivery workflow. |
| Cloud deployment / AWS database | Deferred by user; the earlier `evergreen-site/` prototype is not the complete platform. |

DFT work is represented by banking workflow design, the transaction lifecycle, customer journeys, financial invariants, statements and fraud review. DECM work is represented by persisted backend services, query/index choices, HTTP service contracts, gateway, isolated containers and automated delivery. [Architecture](architecture.md) and [financial controls](financial-controls.md) describe these boundaries and constraints.
