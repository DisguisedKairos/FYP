# Digital wholesale banking scope

Green Link Digital Bank's customers in this project are registered companies, partnerships and institutions. People sign in as authorized business operators or bank operations staff. The project offers business savings accounts, liquidity separation, internal business transfers, business bill payments, scheduled instructions, company statements and fraud controls. It does not offer consumer or personal savings products.

## Business identity and registration

Registration requires the authorized contact's name and email, the registered business name, registration number/UEN, legal form, Singapore address and industry. These are syntax and completeness checks; they do not verify an official registry or establish a real KYC decision. Registration creates an empty active project banking account without staff approval. The legacy database value `approved` denotes access eligibility only.

Business onboarding, the application queue, approval/rejection forms and profile-submission/review APIs have been removed. Existing restricted profiles are not automatically activated; historical decisions, banking records and audit entries remain. Business profile is read-only for legal details, while company-specific news preferences remain editable. Legal identity amendments require bank assistance.

## Ownership and permissions

`businesses` stores the legal customer independently of `users`. `accounts.business_id` is the legal account owner; `accounts.user_id` is the authorized primary operator. A PostgreSQL trigger rejects an account binding to another operator's business. Existing balance and history records are retained. Legacy operators with missing or restricted profiles need operator assistance before financial writes can resume; the system does not invent a company name or registration number for them.

The internal role value `customer` means an authorized business operator. The `admin` role means bank operations access for payment reviews and fraud controls. A standalone bank staff login can be provisioned only through the local operator script; it receives no company or deposit account. Its dashboard is an operations workspace. The demo seed also retains broad administrator/customer scenarios for the FYP tests; these are explicitly test identities.

One authorized primary operator per business is supported. Duplicate registration identifiers cannot be used to join or take over another business. Multi-user company membership, business administrator roles, company payment mandates, corporate maker/checker approvals and batch payroll are future work. The existing independent fraud reviewer is a bank control, not a substitute for a corporate signing mandate.

## Financial and customer experience controls

Payment submission, current settlement, held-payment approval and schedule creation enforce approved business ownership. Recipient businesses must also be approved. Transfers name the legal business in the counterparty record; statements display its registered name and registration number while identifying the operator separately.

Standing schedules for restricted business profiles retain their original occurrence and consent. They do not debit funds, advance the due occurrence or consume transient scoring retries while waiting. They resume only when the business becomes eligible; cancellation remains available to their owner.

The private assistant shows only the signed-in business operator's owned records and prepares drafts requiring normal payment authorization. The dashboard, account products, activity, bills and test transactions use business terminology and operating/liquidity examples.

## Remaining project limitations

Funds, bill settlement and experimental OpenAI scoring are educational project flows. Official business registry integration, document-based KYB, sanctions/AML screening, beneficial owner verification, representative authority checks, real payment rails and corporate-model validation are not implemented. DIT infrastructure responsibilities remain outside this DFT package.

`tests/dft-business.test.js` checks entity validation, empty active registration, retained rejected/pending restrictions, source/recipient ownership, company uniqueness, takeover prevention, retired endpoints, staff provisioning and schedule waiting. Browser tests cover self-service registration, business-profile reads, account management and a dedicated desktop staff workspace.
