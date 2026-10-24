# Digital wholesale banking scope

Green Link Digital Bank's customers in this project are registered companies, partnerships and institutions. People sign in as authorized business operators or bank operations staff. The project offers business savings accounts, liquidity separation, internal business transfers, business bill payments, scheduled instructions, company statements and fraud controls. It does not offer consumer or personal savings products.

## Business identity and onboarding

Registration requires the authorized contact's name and email, the registered business name, registration number/UEN, legal form, Singapore address and industry. These are syntax and completeness checks; they do not verify an official registry or establish a real KYC decision. A business starts at `pending_review`. Its zero-balance account record cannot send or receive money or create additional accounts until approved.

A bank administrator reviews the application, records a reason and explicitly confirms the project's business verification checks. Fresh password authorization, role checks, CSRF, current application version and a different reviewer are required. The business's own operator cannot approve its application, even with an administrator role. The review, actor and outcome are audited and delivered through the notification outbox.

Rejected applications can be corrected and resubmitted. Approved legal identity cannot be changed through self-service; a bank-assisted amendment workflow is future scope. Approval is final in this iteration; account suspension, formal offboarding and periodic KYB reviews are not implemented.

## Ownership and permissions

`businesses` stores the legal customer independently of `users`. `accounts.business_id` is the legal account owner; `accounts.user_id` is the authorized primary operator. A PostgreSQL trigger rejects an account binding to another operator's business. Existing balance and history records are retained. Legacy operators must submit business details and receive bank approval before financial writes resume; the system does not invent a company name or registration number for them.

The internal role value `customer` means an authorized business operator. The `admin` role means bank operations access for onboarding and fraud controls. A standalone bank staff login can be provisioned only through the local operator script; it receives no company or deposit account. Its dashboard is an operations workspace. The demo seed also retains broad administrator/customer scenarios for the FYP tests; these are explicitly sample identities.

One authorized primary operator per business is supported. Duplicate registration identifiers cannot be used to join or take over another business. Multi-user company membership, business administrator roles, company payment mandates, corporate maker/checker approvals and batch payroll are future work. The existing independent fraud reviewer is a bank control, not a substitute for a corporate signing mandate.

## Financial and customer experience controls

Payment submission, current settlement, held-payment approval and schedule creation enforce approved business ownership. Recipient businesses must also be approved. Transfers name the legal business in the counterparty record; statements display its registered name and registration number while identifying the operator separately.

Standing schedules waiting for business approval retain their original occurrence and consent. They do not debit funds, advance the due occurrence or consume transient scoring retries while waiting. They resume only after approval; cancellation remains available to their owner.

The private assistant shows only the signed-in business operator's owned records and prepares drafts requiring normal payment authorization. The dashboard, account products, activity, bills and sample transactions use business terminology and operating/liquidity examples.

## Remaining project limitations

Funds, bill settlement, business verification and experimental local Ollama scoring are educational project flows. Official business registry integration, document-based KYB, sanctions/AML screening, beneficial owner verification, representative authority checks, real payment rails and corporate-model validation are not implemented. DIT infrastructure responsibilities remain outside this DFT package.

`tests/dft-business.test.js` checks entity validation, registration eligibility, rejected/pending restrictions, approved source/recipient ownership, company uniqueness, takeover prevention, independent review, stale authorization, corrected applications, staff provisioning and schedule waiting. Browser tests cover the registration-to-bank-review flow and a dedicated mobile staff workspace.
